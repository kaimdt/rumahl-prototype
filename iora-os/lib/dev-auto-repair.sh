#!/usr/bin/env bash
# ============================================================================
# dev-auto-repair.sh – Intelligent Auto-Detection & Auto-Repair Library
# ============================================================================
# Provides autonomous problem detection and repair functions for IORA dev VMs.
# Designed to be non-intrusive and handle common development issues automatically.
#
# Usage: source this file from dev-local.sh or dev-watch.sh
# ============================================================================

# ── Logging helpers (fallbacks for standalone sourcing; the calling script's
#    log/ok/warn/dim functions take precedence when already defined) ────────
if ! declare -F log >/dev/null 2>&1; then
    log()  { printf '[*] %s\n' "$*"; }
    ok()   { printf '[+] %s\n' "$*"; }
    warn() { printf '[!] %s\n' "$*" >&2; }
    err()  { printf '[X] %s\n' "$*" >&2; }
    dim()  { printf '%s\n' "$*"; }
fi

# ── Auto-Detection Functions ───────────────────────────────────────────────

# Check if port is in use and identify the process
detect_port_conflict() {
    local port="$1"
    local process_info=""

    if command -v lsof >/dev/null 2>&1; then
        process_info=$(lsof -ti ":$port" 2>/dev/null | head -1)
    elif command -v ss >/dev/null 2>&1; then
        process_info=$(ss -lptn "sport = :$port" 2>/dev/null | grep -v State | awk '{print $6}')
    fi

    if [ -n "$process_info" ]; then
        echo "$process_info"
        return 0
    fi
    return 1
}

# Auto-resolve port conflicts
auto_resolve_port_conflict() {
    local port="$1"
    local service_name="$2"

    local conflict=$(detect_port_conflict "$port")
    if [ -n "$conflict" ]; then
        warn "Port $port is in use (PID: $conflict)"

        # Check if it's our own QEMU process
        if ps -p "$conflict" -o comm= 2>/dev/null | grep -q qemu; then
            log "Detected existing IORA VM on port $port - will reuse it"
            return 2  # Signal: reuse existing VM
        fi

        # Offer to kill conflicting process
        log "Attempting to free port $port..."
        if kill "$conflict" 2>/dev/null; then
            sleep 2
            ok "Freed port $port"
            return 0
        else
            warn "Could not free port $port automatically. Use: kill $conflict"
            return 1
        fi
    fi
    return 0
}

# Check disk space and warn if low
detect_low_disk_space() {
    local path="$1"
    local min_gb="${2:-5}"

    local avail_gb
    if command -v df >/dev/null 2>&1; then
        avail_gb=$(df -BG "$path" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//')
        if [ -n "$avail_gb" ] && [ "$avail_gb" -lt "$min_gb" ]; then
            warn "Low disk space: ${avail_gb}GB available (minimum: ${min_gb}GB)"
            return 1
        fi
    fi
    return 0
}

# Auto-clean disk space if needed
auto_clean_disk_space() {
    local cache_dir="$1"

    log "Cleaning old cache files to free disk space..."

    # Remove old log files (>7 days)
    find "$cache_dir" -name "*.log.*" -mtime +7 -delete 2>/dev/null || true

    # Clean old backup VM disks
    find "$cache_dir" -name "*.qcow2.bak" -mtime +3 -delete 2>/dev/null || true

    # Clean old cloud-init ISOs
    find "$cache_dir" -name "seed-*.iso" -mtime +7 -delete 2>/dev/null || true

    ok "Cache cleanup complete"
}

# Detect missing dependencies (arch-aware: macOS ARM needs qemu-system-aarch64;
# Debian/Ubuntu ship the qemu-system-x86 package while the binary is qemu-system-x86_64)
detect_missing_deps() {
    local missing=()
    local qemu_bin="qemu-system-x86_64"
    case "$(uname -m)" in
        arm64|aarch64) qemu_bin="qemu-system-aarch64" ;;
    esac

    for cmd in "$qemu_bin" ssh curl rsync; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing+=("$cmd")
        fi
    done

    # ISO creation tools: Linux needs genisoimage/xorriso, macOS has hdiutil built-in
    if [ "$(uname -s)" = "Linux" ]; then
        if ! command -v genisoimage >/dev/null 2>&1 && ! command -v mkisofs >/dev/null 2>&1 && ! command -v xorriso >/dev/null 2>&1; then
            missing+=("genisoimage")
        fi
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        echo "${missing[@]}"
        return 1
    fi
    return 0
}

# ── Generic retry helper (used by all auto-fix functions) ──────────────────
retry_cmd() {
    local max="${1:-3}"; shift
    local attempt=0
    until "$@"; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge "$max" ]; then
            return 1
        fi
        warn "Command failed (attempt $attempt/$max) – retrying: $*"
        sleep 3
    done
    return 0
}

# Verify a command becomes available after an install (retry loop)
verify_installed() {
    local cmd="$1"
    local tries="${2:-3}"
    local i=0
    while [ "$i" -lt "$tries" ]; do
        command -v "$cmd" >/dev/null 2>&1 && return 0
        i=$((i + 1))
        [ "$i" -lt "$tries" ] && sleep 3
    done
    return 1
}

# Fix broken dpkg/apt state (interrupted installs, stale locks)
auto_fix_apt_state() {
    command -v apt-get >/dev/null 2>&1 || return 0
    local sudo_cmd=""
    [ "$(id -u)" -ne 0 ] && sudo_cmd="sudo"
    log "Repairing apt/dpkg state (if needed)..."
    ${sudo_cmd} dpkg --configure -a >/dev/null 2>&1 || true
    ${sudo_cmd} apt-get install -y --fix-broken >/dev/null 2>&1 || true
    # Wait out stale dpkg locks (e.g. another apt process still running)
    if command -v fuser >/dev/null 2>&1; then
        for _ in 1 2 3 4 5; do
            fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
            warn "dpkg is locked by another process – waiting 5s..."
            sleep 5
        done
    fi
    return 0
}

# Ensure KVM is accessible on Linux hosts (load module, add user to kvm group)
auto_fix_kvm_access() {
    [ "$(uname -s)" = "Linux" ] || return 0
    [ -r /dev/kvm ] && [ -w /dev/kvm ] && return 0
    local sudo_cmd=""
    [ "$(id -u)" -ne 0 ] && sudo_cmd="sudo"

    if [ ! -e /dev/kvm ]; then
        warn "/dev/kvm missing – trying to load KVM module..."
        ${sudo_cmd} modprobe kvm_intel >/dev/null 2>&1 || ${sudo_cmd} modprobe kvm_amd >/dev/null 2>&1 || true
    fi
    if [ -e /dev/kvm ] && { [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; }; then
        if ! getent group kvm >/dev/null 2>&1; then
            ${sudo_cmd} groupadd -r kvm >/dev/null 2>&1 || true
        fi
        local user="${SUDO_USER:-$(id -un)}"
        if ! id -nG "$user" 2>/dev/null | grep -qw kvm; then
            log "Adding '$user' to the 'kvm' group..."
            ${sudo_cmd} usermod -aG kvm "$user" >/dev/null 2>&1 && \
                warn "Added '$user' to 'kvm' group – re-login or run 'newgrp kvm' to use KVM acceleration."
        fi
    fi
    [ -r /dev/kvm ] && [ -w /dev/kvm ]
}

# Ensure Xcode Command Line Tools on macOS (required by Homebrew for QEMU)
auto_fix_xcode_clt() {
    [ "$(uname -s)" = "Darwin" ] || return 0
    if xcode-select -p >/dev/null 2>&1; then
        return 0
    fi
    warn "Xcode Command Line Tools are missing - Homebrew (QEMU install) needs them."
    if [ -t 0 ] && [ -z "${CI:-}" ]; then
        local ans
        read -r -t 15 -p "[?] Install Xcode Command Line Tools now? (GUI prompt opens) [y/N] " ans || { echo; return 1; }
        case "$ans" in
            y|Y|yes|YES) ;;
            *) warn "Skipped - run 'xcode-select --install' manually when ready."; return 1 ;;
        esac
    else
        warn "Non-interactive run - skipping. Install with: xcode-select --install"
        return 1
    fi
    log "Starting Xcode CLT installation (GUI prompt may appear)..."
    xcode-select --install >/dev/null 2>&1 || true
    for _ in {1..120}; do
        xcode-select -p >/dev/null 2>&1 && { ok "Xcode Command Line Tools ready"; return 0; }
        sleep 5
    done
    warn "Xcode CLT still not ready after ~10 min - check the installer or run 'xcode-select --install'."
    return 1
}

# Install an ISO creation tool (genisoimage/xorriso on Linux; macOS has hdiutil)
auto_install_iso_tools() {
    command -v genisoimage >/dev/null 2>&1 && return 0
    command -v mkisofs >/dev/null 2>&1 && return 0
    command -v xorriso >/dev/null 2>&1 && return 0
    [ "$(uname -s)" = "Darwin" ] && command -v hdiutil >/dev/null 2>&1 && return 0

    if command -v brew >/dev/null 2>&1; then
        log "Installing ISO tools via Homebrew (cdrtools)..."
        brew install cdrtools >/dev/null 2>&1 || true
    elif command -v apt-get >/dev/null 2>&1; then
        auto_fix_apt_state
        local sudo_cmd=""
        [ "$(id -u)" -ne 0 ] && sudo_cmd="sudo"
        log "Installing ISO tools via apt (xorriso + genisoimage)..."
        # Fast path: install first - apt-get update only runs when the
        # package index is stale (saves 30-60s on fresh systems)
        if ! ${sudo_cmd} env DEBIAN_FRONTEND=noninteractive apt-get install -y xorriso genisoimage >/dev/null 2>&1; then
            warn "Package lists stale? Running apt-get update (one-time)..."
            ${sudo_cmd} apt-get update >/dev/null 2>&1 || true
            ${sudo_cmd} env DEBIAN_FRONTEND=noninteractive apt-get install -y xorriso genisoimage >/dev/null 2>&1 || \
                ${sudo_cmd} env DEBIAN_FRONTEND=noninteractive apt-get install -y xorriso >/dev/null 2>&1 || true
        fi
    else
        warn "No package manager found to install ISO tools."
        return 1
    fi
    command -v genisoimage >/dev/null 2>&1 || command -v mkisofs >/dev/null 2>&1 || command -v xorriso >/dev/null 2>&1
}

# Install QEMU when missing (platform-aware)
auto_install_qemu() {
    local qemu_bin="qemu-system-x86_64"
    case "$(uname -m)" in
        arm64|aarch64) qemu_bin="qemu-system-aarch64" ;;
    esac
    command -v "$qemu_bin" >/dev/null 2>&1 && return 0

    if command -v brew >/dev/null 2>&1; then
        log "Installing QEMU via Homebrew (large download, may take a while)..."
        retry_cmd 2 brew install qemu || warn "brew install qemu failed"
    elif command -v apt-get >/dev/null 2>&1; then
        auto_fix_apt_state
        local sudo_cmd=""
        [ "$(id -u)" -ne 0 ] && sudo_cmd="sudo"
        local apt_pkg="qemu-system-x86"
        case "$(uname -m)" in
            arm64|aarch64) apt_pkg="qemu-system-arm" ;;
        esac
        log "Installing QEMU via apt ($apt_pkg)..."
        retry_cmd 2 ${sudo_cmd} env DEBIAN_FRONTEND=noninteractive apt-get install -y "$apt_pkg" qemu-utils || \
            warn "apt install qemu failed"
    else
        warn "No package manager found to install QEMU."
        return 1
    fi
    verify_installed "$qemu_bin" 3
}

# Auto-install missing dependencies (best-effort, platform-aware package mapping)
auto_install_deps() {
    local deps=("$@")

    if [ ${#deps[@]} -eq 0 ]; then
        return 0
    fi

    log "Detected missing dependencies: ${deps[*]}"

    # macOS (Homebrew)
    if command -v brew >/dev/null 2>&1; then
        log "Installing via Homebrew..."
        local uniq_pkgs=() p
        for dep in "${deps[@]}"; do
            case "$dep" in
                qemu-system-x86_64|qemu-system-aarch64) p="qemu" ;;
                genisoimage|mkisofs) p="cdrtools" ;;
                *) p="$dep" ;;
            esac
            case " ${uniq_pkgs[*]} " in
                *" $p "*) ;;
                *) uniq_pkgs+=("$p") ;;
            esac
        done
        brew install "${uniq_pkgs[@]}" 2>&1 | grep -viE "warning|already installed" || true
        return 0
    fi

    # Debian/Ubuntu (apt-get)
    if command -v apt-get >/dev/null 2>&1; then
        auto_fix_apt_state
        local sudo_cmd=""
        [ "$(id -u)" -ne 0 ] && sudo_cmd="sudo"
        local apt_pkgs=()
        for dep in "${deps[@]}"; do
            case "$dep" in
                qemu-system-x86_64|qemu-system-aarch64)
                    case "$(uname -m)" in
                        arm64|aarch64) apt_pkgs+=("qemu-system-arm" "qemu-utils") ;;
                        *) apt_pkgs+=("qemu-system-x86" "qemu-utils") ;;
                    esac ;;
                genisoimage|mkisofs) apt_pkgs+=("xorriso" "genisoimage") ;;
                *) apt_pkgs+=("$dep") ;;
            esac
        done
        log "Installing via apt-get: ${apt_pkgs[*]}"
        retry_cmd 3 ${sudo_cmd} env DEBIAN_FRONTEND=noninteractive apt-get install -y "${apt_pkgs[@]}" >/dev/null 2>&1 || \
            warn "apt-get install failed for: ${apt_pkgs[*]}"
        return 0
    fi

    warn "Could not auto-install dependencies. Please install manually: ${deps[*]}"
    return 1
}

# ── Run all cheap host-level auto-repairs in one go ────────────────────────
run_auto_repairs() {
    log "Running automatic environment checks & repairs..."
    auto_fix_apt_state
    local missing
    missing=$(detect_missing_deps 2>/dev/null || echo "")
    if [ -n "$missing" ]; then
        log "Auto-installing missing dependencies: $missing"
        auto_install_deps $missing || warn "Some dependencies could not be auto-installed"
    fi
    auto_fix_kvm_access
    ok "Environment checks complete"
}

# Check VM health and attempt recovery
check_vm_health() {
    local vm_host="$1"
    local vm_port="$2"
    local ssh_key="$3"

    local ssh_opts=(
        -o StrictHostKeyChecking=no
        -o UserKnownHostsFile=/dev/null
        -o IdentitiesOnly=yes
        -o LogLevel=ERROR
        -o ConnectTimeout=5
        -o BatchMode=yes
        -i "$ssh_key"
    )

    # Test SSH connectivity
    if ! ssh "${ssh_opts[@]}" -p "$vm_port" "root@$vm_host" "true" 2>/dev/null; then
        warn "VM not responding on SSH port $vm_port"
        return 1
    fi

    # Check if systemd is healthy
    if ! ssh "${ssh_opts[@]}" -p "$vm_port" "root@$vm_host" "systemctl is-system-running --quiet" 2>/dev/null; then
        warn "VM systemd is not in healthy state"
        return 2
    fi

    return 0
}

# Auto-recover VM from common failures
auto_recover_vm() {
    local vm_host="$1"
    local vm_port="$2"
    local ssh_key="$3"

    local ssh_opts=(
        -o StrictHostKeyChecking=no
        -o UserKnownHostsFile=/dev/null
        -o IdentitiesOnly=yes
        -o LogLevel=ERROR
        -o ConnectTimeout=10
        -i "$ssh_key"
    )

    log "Attempting VM auto-recovery..."

    # Restart failed services
    local failed_services=$(ssh "${ssh_opts[@]}" -p "$vm_port" "root@$vm_host" \
        "systemctl list-units --state=failed 'iora-*' --plain --no-legend | awk '{print \$1}'" 2>/dev/null)

    if [ -n "$failed_services" ]; then
        log "Restarting failed services: $failed_services"
        while IFS= read -r service; do
            ssh "${ssh_opts[@]}" -p "$vm_port" "root@$vm_host" \
                "systemctl restart '$service'" 2>/dev/null && ok "Restarted $service" || warn "Could not restart $service"
        done <<< "$failed_services"
    fi

    # Clear journal if too large (>500MB)
    local journal_size=$(ssh "${ssh_opts[@]}" -p "$vm_port" "root@$vm_host" \
        "du -sm /var/log/journal 2>/dev/null | awk '{print \$1}'" 2>/dev/null)

    if [ -n "$journal_size" ] && [ "$journal_size" -gt 500 ]; then
        log "Vacuuming journal (${journal_size}MB)..."
        ssh "${ssh_opts[@]}" -p "$vm_port" "root@$vm_host" \
            "journalctl --vacuum-size=100M" >/dev/null 2>&1 && ok "Journal vacuumed"
    fi
}

# ── Resource Management ────────────────────────────────────────────────────

# Detect if system is under memory pressure
detect_memory_pressure() {
    local threshold_percent="${1:-90}"

    if [ -f /proc/meminfo ]; then
        local mem_total=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
        local mem_avail=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
        local used_percent=$(( 100 - (mem_avail * 100 / mem_total) ))

        if [ "$used_percent" -gt "$threshold_percent" ]; then
            warn "High memory usage: ${used_percent}%"
            return 0
        fi
    elif command -v vm_stat >/dev/null 2>&1; then
        # macOS
        local pages_free=$(vm_stat | awk '/Pages free:/ {print $3}' | tr -d '.')
        local pages_active=$(vm_stat | awk '/Pages active:/ {print $3}' | tr -d '.')
        local total_pages=$((pages_free + pages_active))

        if [ "$total_pages" -gt 0 ]; then
            local used_percent=$(( (pages_active * 100) / total_pages ))
            if [ "$used_percent" -gt "$threshold_percent" ]; then
                warn "High memory usage: ${used_percent}%"
                return 0
            fi
        fi
    fi

    return 1
}

# Auto-optimize VM resources based on system load
auto_optimize_vm_resources() {
    local current_cpus="$1"
    local current_ram="$2"
    local host_cpus="$3"
    local host_ram="$4"

    local suggested_cpus=$current_cpus
    local suggested_ram=$current_ram

    # Check if we're under memory pressure
    if detect_memory_pressure 85; then
        # Reduce VM RAM by 25%
        suggested_ram=$(( current_ram * 3 / 4 ))
        log "Memory pressure detected - suggesting reduced VM RAM: ${suggested_ram}MB"
    fi

    # Check CPU load (if available)
    if command -v uptime >/dev/null 2>&1; then
        local load=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | tr -d ',')
        local load_int=${load%.*}

        if [ -n "$load_int" ] && [ "$load_int" -gt "$((host_cpus * 2))" ]; then
            # High CPU load - reduce VM CPUs
            suggested_cpus=$(( current_cpus / 2 ))
            [ "$suggested_cpus" -lt 2 ] && suggested_cpus=2
            log "High CPU load detected - suggesting reduced VM CPUs: $suggested_cpus"
        fi
    fi

    # Return suggested values
    echo "$suggested_cpus $suggested_ram"
}

# ── Background Health Monitor ──────────────────────────────────────────────

# Start background health monitor (non-intrusive)
start_health_monitor() {
    local vm_host="$1"
    local vm_port="$2"
    local ssh_key="$3"
    local log_file="$4"
    local pid_file="$5"

    # Check if already running
    if [ -f "$pid_file" ]; then
        local old_pid=$(cat "$pid_file" 2>/dev/null)
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            return 0  # Already running
        fi
    fi

    # Start monitor in background
    (
        while true; do
            sleep 60  # Check every minute

            # Quick health check
            if ! check_vm_health "$vm_host" "$vm_port" "$ssh_key" 2>/dev/null; then
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Health check failed - attempting recovery" >> "$log_file"
                auto_recover_vm "$vm_host" "$vm_port" "$ssh_key" >> "$log_file" 2>&1
            fi
        done
    ) &

    local monitor_pid=$!
    echo "$monitor_pid" > "$pid_file"

    # Make monitor independent of parent
    disown "$monitor_pid" 2>/dev/null || true

    dim "Health monitor started (PID: $monitor_pid, logs: $log_file)"
}

# Stop background health monitor
stop_health_monitor() {
    local pid_file="$1"

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            rm -f "$pid_file"
        fi
    fi
}

# ── Smart Notifications ────────────────────────────────────────────────────

# Send desktop notification (non-intrusive)
send_notification() {
    local title="$1"
    local message="$2"
    local urgency="${3:-normal}"  # low, normal, critical

    # macOS
    if command -v osascript >/dev/null 2>&1; then
        osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null || true
        return
    fi

    # Linux - notify-send
    if command -v notify-send >/dev/null 2>&1; then
        notify-send -u "$urgency" "$title" "$message" 2>/dev/null || true
        return
    fi

    # Fallback: terminal bell + message
    printf '\a' 2>/dev/null || true
}

# Export all functions
export -f detect_port_conflict
export -f auto_resolve_port_conflict
export -f detect_low_disk_space
export -f auto_clean_disk_space
export -f detect_missing_deps
export -f auto_install_deps
export -f retry_cmd
export -f verify_installed
export -f auto_fix_apt_state
export -f auto_fix_kvm_access
export -f auto_install_iso_tools
export -f auto_install_qemu
export -f auto_fix_xcode_clt
export -f run_auto_repairs
export -f check_vm_health
export -f auto_recover_vm
export -f detect_memory_pressure
export -f auto_optimize_vm_resources
export -f start_health_monitor
export -f stop_health_monitor
export -f send_notification
