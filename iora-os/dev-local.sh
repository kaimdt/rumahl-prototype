#!/usr/bin/env bash
# ============================================================================
# dev-local.sh – IORA OS Local Dev VM (macOS / Linux / WSL2)
# ============================================================================
# Starts a Debian 12 cloud VM via QEMU that mirrors the IORA OS runtime
# layout (same /etc/iora, /opt/iora, /usr/bin/iora-*, same systemd services).
#
# Goals: maximum autonomy + idempotency + stability across re-runs.
#
# Usage:
#   ./dev-local.sh                  Start (provisions if needed)
#   ./dev-local.sh --clean          Drop cached VM disk + seed ISO (keep image)
#   ./dev-local.sh --clean-all      Also remove downloaded cloud image
#   ./dev-local.sh --status         Show whether VM is running, health check
#   ./dev-local.sh --stop           Stop the running VM
#   ./dev-local.sh --reboot          Stop VM + restart fresh
#   ./dev-local.sh --rebuild        Stop VM, clean cache, start fresh
#   ./dev-local.sh --log             Live cloud-init / system logs
#   ./dev-local.sh --ssh            SSH directly into the running VM
#   ./dev-local.sh --reprovision    Force re-running the in-VM setup steps
#   ./dev-local.sh --no-watch       Don't auto-launch dev-watch TUI
#   ./dev-local.sh --source-mode     Run services via cargo run from the 1:1
#                                    source mirror (default)
#   ./dev-local.sh --build-mode      Run deployed binaries (/usr/bin/iora-*)
#   ./dev-local.sh --watcher        Launch dev-watch TUI in new terminal (VM must be running)
#   ./dev-local.sh --foreground     Attach to QEMU process (Ctrl+C kills VM)
#   ./dev-local.sh --help
# ============================================================================
# shellcheck disable=SC2155,SC2034,SC2086

set -uo pipefail
# NOTE: deliberately NOT using `set -e`. We handle errors explicitly so a
# transient failure (e.g. apt mirror hiccup) doesn't abort the whole bootstrap.

# ── Version (Banner zeigt die laufende Version – erleichtert das Erkennen
#    veralteter Kopien; bei Fragen/Fixes immer hier hochzählen) ──────────────
DEV_LOCAL_VERSION="2.4.9"

# ── Colors & Logging (defined first – earlier versions crashed because
#    `log` was called before this point) ────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; C=$'\033[0;36m'; B=$'\033[1m'; N=$'\033[0m'
    D=$'\033[2m'  # Dim/gray for non-intrusive messages
else
    R=''; G=''; Y=''; C=''; B=''; N=''; D=''
fi
log()  { printf '%s[*]%s %s\n' "$C" "$N" "$*"; }
ok()   { printf '%s[+]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s[!]%s %s\n' "$Y" "$N" "$*" >&2; }
err()  { printf '%s[X]%s %s\n' "$R" "$N" "$*" >&2; }
dim()  { printf '%s%s%s\n' "$D" "$*" "$N"; }
die()  { err "$*"; exit 1; }

# ── Load Auto-Repair Library ───────────────────────────────────────────────
SCRIPT_DIR_TEMP="$(cd "$(dirname "$0")" && pwd)"
AUTO_REPAIR_LIB="$SCRIPT_DIR_TEMP/lib/dev-auto-repair.sh"
if [ -f "$AUTO_REPAIR_LIB" ]; then
    source "$AUTO_REPAIR_LIB"
    dim "Auto-repair enabled"
else
    # Define no-op fallbacks if library not found
    auto_resolve_port_conflict() { return 0; }
    detect_low_disk_space() { return 0; }
    auto_clean_disk_space() { :; }
    detect_missing_deps() { return 0; }
    auto_install_deps() { :; }
    run_auto_repairs() { :; }
    auto_install_qemu() { return 1; }
    auto_install_iso_tools() { return 1; }
    auto_fix_xcode_clt() { return 0; }
    auto_fix_apt_state() { :; }
    auto_fix_kvm_access() { return 1; }
    start_health_monitor() { :; }
    stop_health_monitor() { :; }
    send_notification() { :; }
fi

# ── Paths ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE="$SCRIPT_DIR/.cache"
mkdir -p "$CACHE"
LOG_FILE="$CACHE/dev-local.log"
# Rotate large log (>1MB)
if [ -f "$LOG_FILE" ] && [ "$(wc -c <"$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
fi

# Mirror everything to LOG_FILE (kept for post-mortem)
exec > >(tee -a "$LOG_FILE") 2>&1

IORA_DEV="$REPO_ROOT/.iora-dev"
IORA_BINS="$IORA_DEV/binaries"
IORA_SCC="$IORA_DEV/sccache"
mkdir -p "$IORA_BINS" "$IORA_SCC"
log "Dev shared folder: $IORA_DEV"

# ── Platform detection ─────────────────────────────────────────────────────
HOST_ARCH=$(uname -m)
IS_MACOS=false; IS_LINUX=false
case "$(uname -s)" in
    Darwin) IS_MACOS=true ;;
    Linux)  IS_LINUX=true ;;
    *) die "Unsupported host OS: $(uname -s). Use Linux, macOS, or WSL2." ;;
esac

if $IS_MACOS; then
    HOST_CPUS=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)
    HOST_RAM_MB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1048576}')
    [ -z "$HOST_RAM_MB" ] && HOST_RAM_MB=8192
else
    HOST_CPUS=$(nproc 2>/dev/null || echo 4)
    if [ -r /proc/meminfo ]; then
        HOST_RAM_MB=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo)
    else
        HOST_RAM_MB=8192
    fi
fi
HOST_RAM_GB=$(( (HOST_RAM_MB + 512) / 1024 ))

# Portable file-size helper (BSD vs GNU stat)
file_size() {
    if $IS_MACOS; then
        stat -f%z "$1" 2>/dev/null || echo 0
    else
        stat -c%s "$1" 2>/dev/null || echo 0
    fi
}

# Portable "is port in use?" helper (lsof not always installed on Linux)
port_in_use() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -i ":$port" -sTCP:LISTEN -t >/dev/null 2>&1
    elif command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"
    elif command -v netstat >/dev/null 2>&1; then
        netstat -an 2>/dev/null | grep -E "[:.]${port} " | grep -qi LISTEN
    else
        return 1
    fi
}

# ── VM sizing (auto-scaled to host) ────────────────────────────────────────
if [ -n "${IORA_DEV_RAM:-}" ]; then
    VM_RAM="$IORA_DEV_RAM"
else
    if [ "$HOST_RAM_GB" -lt 16 ]; then
        VM_RAM_GB=$(( HOST_RAM_GB * 70 / 100 ))
    else
        VM_RAM_GB=$(( HOST_RAM_GB * 60 / 100 ))
    fi
    [ "$VM_RAM_GB" -lt 4 ] && VM_RAM_GB=4
    [ "$VM_RAM_GB" -gt 16 ] && VM_RAM_GB=16
    VM_RAM="${VM_RAM_GB}G"
fi

VM_CPUS="${IORA_DEV_CPUS:-$(( HOST_CPUS / 2 ))}"
[ "$VM_CPUS" -lt 2 ] && VM_CPUS=2

if [ -n "${IORA_DEV_CARGO_JOBS:-}" ]; then
    CARGO_JOBS="$IORA_DEV_CARGO_JOBS"
else
    VM_RAM_NUM=${VM_RAM%G}
    CARGO_JOBS=$(( VM_RAM_NUM * 10 / 25 ))
    [ "$CARGO_JOBS" -lt 1 ] && CARGO_JOBS=1
    [ "$CARGO_JOBS" -gt "$VM_CPUS" ] && CARGO_JOBS=$VM_CPUS
fi

log "Host: ${HOST_RAM_GB}GB RAM, ${HOST_CPUS} CPUs ($(uname -s) $HOST_ARCH)"
log "VM:   ${VM_RAM} RAM, ${VM_CPUS} CPUs, cargo -j${CARGO_JOBS}"

# ── Ports (kept in sync with IORA OS nginx + service config) ───────────────
VM_HOST=127.0.0.1
VM_SSH=2222
VM_HOME=8126
VM_BRIDGE=8101
# Additional ports forwarded so host browser can reach all services directly.
# Match the IORA OS systemd unit ports.
FWD_PORTS=(80 443 3001 5432 8080 8090 8092 8094 8095 8096 8097 8098)

# ── QEMU binary + machine type ─────────────────────────────────────────────
case "$HOST_ARCH" in
    arm64|aarch64)
        IMG_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-arm64.qcow2"
        IMG_CACHE="$CACHE/debian-12-cloud-arm64.qcow2"
        QEMU_BIN="qemu-system-aarch64"
        QEMU_MACHINE="virt"
        QEMU_CPU="host"
        ;;
    x86_64|amd64)
        IMG_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
        IMG_CACHE="$CACHE/debian-12-cloud-amd64.qcow2"
        QEMU_BIN="qemu-system-x86_64"
        QEMU_MACHINE="q35"
        QEMU_CPU="host"
        ;;
    *) die "Unsupported host arch: $HOST_ARCH" ;;
esac

VM_DISK="$CACHE/iora-dev-vm.qcow2"
SEED_ISO="$CACHE/iora-dev-seed.iso"
SSH_KEY="$CACHE/iora-dev-key"
QEMU_PIDFILE="$CACHE/qemu.pid"
QEMU_MONITOR="$CACHE/qemu-monitor.sock"
PROVISIONED_MARKER="$CACHE/.provisioned"

# ── Argument parsing (done early but using only literal strings) ───────────
CLEAN=false
CLEAN_ALL=false
DO_STATUS=false
DO_STOP=false
DO_REBUILD=false
DO_REBOOT=false
DO_SSH=false
DO_LOG=false
REPROVISION=false
NO_WATCH=false
FOREGROUND=false
DO_WATCHER=false
RUN_MODE="source"
for a in "$@"; do
    case "$a" in
        --clean)        CLEAN=true ;;
        --clean-all)    CLEAN=true; CLEAN_ALL=true ;;
        --status)       DO_STATUS=true ;;
        --stop)         DO_STOP=true ;;
        --rebuild)      DO_REBUILD=true ;;
        --reboot)       DO_REBOOT=true ;;
        --ssh)          DO_SSH=true ;;
        --log)          DO_LOG=true ;;
        --reprovision)  REPROVISION=true ;;
        --no-watch)     NO_WATCH=true ;;
        --source-mode)  RUN_MODE="source" ;;
        --build-mode)   RUN_MODE="build" ;;
        --foreground)   FOREGROUND=true ;;
        --watcher)      DO_WATCHER=true ;;
        -h|--help)
            sed -n '4,26p' "$0"
            exit 0 ;;
        *) die "Unknown argument: $a (try --help)" ;;
    esac
done
log "Run mode: $RUN_MODE ($([ "$RUN_MODE" = "source" ] && echo 'cargo run from 1:1 mirror' || echo 'deployed binaries'))"
dim "dev-local.sh v$DEV_LOCAL_VERSION"

# ── Helpers for managing the VM lifecycle ──────────────────────────────────
vm_pid() {
    [ -f "$QEMU_PIDFILE" ] || { echo ""; return; }
    local pid
    pid=$(cat "$QEMU_PIDFILE" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "$pid"
    else
        rm -f "$QEMU_PIDFILE"
        echo ""
    fi
}

vm_stop() {
    local pid
    pid=$(vm_pid)
    if [ -z "$pid" ]; then
        warn "VM is not running (no live PID in $QEMU_PIDFILE)"
        return 0
    fi
    log "Stopping VM (PID $pid)..."
    # Try graceful via QEMU monitor first
    if [ -S "$QEMU_MONITOR" ] && command -v socat >/dev/null 2>&1; then
        printf 'system_powerdown\n' | socat - "UNIX-CONNECT:$QEMU_MONITOR" >/dev/null 2>&1 || true
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 1
        done
    fi
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        sleep 2
        kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$QEMU_PIDFILE" "$QEMU_MONITOR"
    ok "VM stopped"
}

# Cleanup trap: only kill OUR QEMU child if user asked for foreground mode.
# In normal (detached) mode the VM keeps running after the script exits.
cleanup() {
    if $FOREGROUND && [ -n "${QEMU_CHILD_PID:-}" ]; then
        kill "$QEMU_CHILD_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# Cleanup stale SSH host keys (regenerated on every `--clean`)
ssh_known_clear() {
    if [ -f "$HOME/.ssh/known_hosts" ]; then
        ssh-keygen -R "[127.0.0.1]:$VM_SSH" 2>/dev/null || true
        ssh-keygen -R "[localhost]:$VM_SSH"   2>/dev/null || true
    fi
}

# Common SSH options (declared once, used everywhere)
SSH_OPTS=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o IdentitiesOnly=yes
    -o BatchMode=yes
    -o ConnectTimeout=5
    -o ServerAliveInterval=15
    -o AddressFamily=inet
    -o LogLevel=ERROR
)
ssh_vm() { ssh "${SSH_OPTS[@]}" -i "$SSH_KEY" -p "$VM_SSH" root@127.0.0.1 "$@"; }
scp_to_vm() { scp "${SSH_OPTS[@]}" -i "$SSH_KEY" -P "$VM_SSH" "$@"; }

# ── --status / --stop / --rebuild / --ssh fast paths ────────────────────────
if $DO_STOP; then
    vm_stop
    exit 0
fi

if $DO_SSH; then
    pid=$(vm_pid)
    if [ -z "$pid" ]; then
        die "VM is not running. Start it first: ./dev-local.sh"
    fi
    log "Connecting to VM via SSH..."
    exec ssh "${SSH_OPTS[@]}" -i "$SSH_KEY" -p "$VM_SSH" root@127.0.0.1
    exit 0
fi

watcher_needs_build() {
    local binary="$1"
    local watcher_root="$REPO_ROOT/iora-os/backend/tools/iora-dev-watch"
    [ ! -f "$binary" ] && return 0
    find "$watcher_root/src" "$watcher_root/Cargo.toml" -type f -newer "$binary" -print -quit 2>/dev/null |
        grep -q .
}

if $DO_WATCHER; then
    pid=$(vm_pid)
    if [ -z "$pid" ]; then
        die "VM is not running. Start it first: ./dev-local.sh"
    fi
    # Build the Rust TUI binary when missing or older than its sources.
    DASH_BIN="$REPO_ROOT/iora-os/backend/target/debug/iora-dev-watch"
    if watcher_needs_build "$DASH_BIN"; then
        log "Building updated dev-watch TUI..."
        (cd "$REPO_ROOT/iora-os/backend" && cargo build -p iora-dev-watch 2>&1 | tail -5) || \
            die "Failed to build iora-dev-watch. Check: cd iora-os/backend && cargo build -p iora-dev-watch"
        ok "dev-watch TUI built"
    fi
    log "Launching IORA Dev Watch TUI..."
    if $IS_MACOS; then
        osascript -e "tell app \"Terminal\" to do script \"cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY\"" >/dev/null 2>&1 \
            || die "Couldn't auto-open Terminal.app. Run manually: $DASH_BIN"
    else
        if command -v gnome-terminal >/dev/null 2>&1; then
            gnome-terminal -- bash -c "cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY; exec bash" &
        elif command -v konsole >/dev/null 2>&1; then
            konsole -e bash -c "cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY; exec bash" &
        elif command -v xterm >/dev/null 2>&1; then
            xterm -e "cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY" &
        else
            die "No terminal emulator found. Run manually: $DASH_BIN"
        fi
    fi
    ok "Dev Watch TUI launched in new terminal"
    exit 0
fi

if $DO_REBOOT; then
    log "Reboot: stopping VM..."
    vm_stop || true
    log "Starting fresh..."
    # Fall through to normal start
fi

if $DO_REBUILD; then
    log "Rebuild: stopping VM..."
    vm_stop || true
    log "Cleaning cache..."
    rm -f "$VM_DISK" "$SEED_ISO" "$SSH_KEY" "$SSH_KEY.pub" "$PROVISIONED_MARKER"
    rm -rf "$CACHE/seed"
    ssh_known_clear
    log "Starting fresh provision..."
    # Fall through to normal start below
fi

if $DO_STATUS; then
    pid=$(vm_pid)
    if [ -z "$pid" ]; then
        warn "VM is not running"
        exit 1
    fi
    ok "VM running (PID $pid)"
    log "Forwarded ports: SSH=$VM_SSH, dashboard=$VM_HOME, bridge=$VM_BRIDGE"
    if ssh_vm "echo SSH_OK" 2>/dev/null | grep -q SSH_OK; then
        ok "SSH responsive"
    else
        warn "SSH not yet responsive"
    fi
    # Hit the home dashboard health endpoint
    if command -v curl >/dev/null 2>&1; then
        if curl -fsS --max-time 3 "http://127.0.0.1:${VM_HOME}/api/health" >/dev/null 2>&1 \
           || curl -fsS --max-time 3 "http://127.0.0.1:${VM_HOME}/health" >/dev/null 2>&1; then
            ok "iora-home health check OK (port $VM_HOME)"
        else
            warn "iora-home not responding on port $VM_HOME yet"
        fi
    fi
    exit 0
fi

# ── --log handler (live cloud-init / debian logs) ────────────────────────
if $DO_LOG; then
    SERIAL_LOG="$CACHE/qemu-serial.log"
    CLOUD_OUTPUT="/var/log/cloud-init-output.log"
    CLOUD_MAIN="/var/log/cloud-init.log"
    SYSLOG="/var/log/syslog"

    pid=$(vm_pid)
    if [ -z "$pid" ]; then
        warn "VM is not running. Showing last QEMU serial log:"
        echo "═══════════════ QEMU Serial Log ═══════════════"
        [ -f "$SERIAL_LOG" ] && tail -50 "$SERIAL_LOG" || echo "  (no serial log)"
        exit 0
    fi

    log "Following all logs continuously (Ctrl+C to stop)..."
    dim  "  Auto-switches: serial → cloud-init → syslog as VM boots"
    echo ""

    # Continuous log follower: tries serial first, then SSH logs when ready
    (
        SHOWN_SERIAL=false
        SHOWN_CLOUD=false
        while true; do
            # Check if VM died
            if ! kill -0 "$pid" 2>/dev/null; then
                echo ""
                warn "VM process ended."
                break
            fi

            # Try SSH first
            if ssh_vm "echo OK" 2>/dev/null | grep -q OK; then
                # Show cloud-init output if available
                if ssh_vm "test -f $CLOUD_OUTPUT && test -s $CLOUD_OUTPUT" 2>/dev/null; then
                    if ! $SHOWN_CLOUD; then
                        echo "═══════════════ Cloud-Init Output ═══════════════"
                        SHOWN_CLOUD=true
                    fi
                    ssh_vm "tail -n 200 $CLOUD_OUTPUT 2>/dev/null" 2>/dev/null | tail -5
                    # Check if cloud-init is still running
                    if ssh_vm "test -f /var/lib/cloud/instance/boot-finished" 2>/dev/null; then
                        if $SHOWN_CLOUD; then
                            echo "═══════════════ Cloud-Init Complete → Syslog ═══════════════"
                            SHOWN_CLOUD=false
                        fi
                        ssh_vm "journalctl -n 10 --no-pager 2>/dev/null || tail -10 $SYSLOG" 2>/dev/null
                    fi
                else
                    ssh_vm "journalctl -n 10 --no-pager 2>/dev/null || tail -10 $SYSLOG" 2>/dev/null
                fi
            else
                # SSH not ready — show serial
                if ! $SHOWN_SERIAL && [ -s "$SERIAL_LOG" ]; then
                    echo "═══════════════ QEMU Serial Console ═══════════════"
                    SHOWN_SERIAL=true
                fi
                [ -f "$SERIAL_LOG" ] && tail -3 "$SERIAL_LOG" 2>/dev/null
            fi
            sleep 5
        done
    )
    exit 0
fi

# ── --clean handling (now safe – all paths are defined) ────────────────────
if $CLEAN; then
    log "Cleaning cache..."
    vm_stop || true
    rm -f "$VM_DISK" "$SEED_ISO" "$SSH_KEY" "$SSH_KEY.pub" "$PROVISIONED_MARKER"
    rm -rf "$CACHE/seed"
    if $CLEAN_ALL; then
        rm -f "$IMG_CACHE"
        ok "Removed cloud image too."
    fi
    ssh_known_clear
    ok "Done. Re-run without --clean to provision a fresh VM."
    exit 0
fi

# ── Sanity: required host tools (with auto-install) ────────────────────────
log "Checking dependencies..."
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required tool: $1 ($2)"; }

# macOS: Xcode Command Line Tools are required by Homebrew (used for QEMU)
if $IS_MACOS; then
    if command -v auto_fix_xcode_clt >/dev/null 2>&1; then
        auto_fix_xcode_clt || true
    fi
fi

# Full auto-repair pass: apt self-heal, missing deps (QEMU/rsync/ISO tools), KVM group
if command -v run_auto_repairs >/dev/null 2>&1; then
    run_auto_repairs || warn "Auto-repair pass had issues – continuing anyway"
fi

# QEMU-specific retry (arch-aware) if still missing
if ! command -v "$QEMU_BIN" >/dev/null 2>&1 && command -v auto_install_qemu >/dev/null 2>&1; then
    warn "$QEMU_BIN still missing – trying dedicated auto-install..."
    auto_install_qemu || warn "QEMU auto-install failed"
fi

# Then verify critical tools
need_cmd "$QEMU_BIN" "Install QEMU (brew install qemu / apt install qemu-system-x86)"
need_cmd qemu-img   "Comes with QEMU"
need_cmd curl       "Install curl"
need_cmd ssh        "Install openssh-client"
need_cmd ssh-keygen "Install openssh-client"
need_cmd scp        "Install openssh-client"
need_cmd rsync      "Install rsync"
ok "All dependencies available"

# ── Accelerator + display selection (platform-aware) ───────────────────────
choose_accel() {
    # Allow override
    if [ -n "${IORA_DEV_ACCEL:-}" ]; then
        echo "$IORA_DEV_ACCEL"; return
    fi
    if $IS_MACOS; then
        echo "hvf"; return
    fi
    if $IS_LINUX; then
        if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
            echo "kvm"; return
        fi
        # Try to fix KVM access automatically before falling back to TCG
        if command -v auto_fix_kvm_access >/dev/null 2>&1; then
            dim "Attempting to fix KVM access..."
            if auto_fix_kvm_access; then
                log "KVM access fixed – using KVM acceleration"
                echo "kvm"; return
            fi
        fi
        warn "/dev/kvm not accessible – falling back to TCG (slow!). Add your user to the 'kvm' group."
        echo "tcg"; return
    fi
    echo "tcg"
}
ACCEL=$(choose_accel)
log "Accelerator: $ACCEL"

choose_display() {
    if [ -n "${IORA_DEV_DISPLAY:-}" ]; then
        echo "$IORA_DEV_DISPLAY"; return
    fi
    if $IS_MACOS; then
        echo "cocoa,show-cursor=on"; return
    fi
    # Linux: prefer headless serial; graphical only if DISPLAY/WAYLAND set
    if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
        if "$QEMU_BIN" -display help 2>/dev/null | grep -q '^gtk'; then
            echo "gtk,show-cursor=on"; return
        fi
        if "$QEMU_BIN" -display help 2>/dev/null | grep -q '^sdl'; then
            echo "sdl,show-cursor=on"; return
        fi
    fi
    echo "none"
}
DISPLAY_OPT=$(choose_display)
log "Display: $DISPLAY_OPT"

# ── Step 1: Download cloud image (with mirror fallback) ────────────────────
download_image() {
    log "Downloading Debian cloud image (~400MB, one-time)..."
    local img_name="${IMG_URL##*/}"
    local mirrors=(
        "$IMG_URL"
        "https://gemmei.ftp.acc.umu.se/images/cloud/bookworm/latest/$img_name"
        "https://cloud.debian.org/images/cloud/bookworm/latest/$img_name"
    )
    local got=false
    for url in "${mirrors[@]}"; do
        log "  trying $url"
        if curl -L --connect-timeout 15 --max-time 900 -o "$IMG_CACHE.tmp" "$url"; then
            local sz
            sz=$(file_size "$IMG_CACHE.tmp")
            if [ "$sz" -gt 1048576 ]; then
                mv "$IMG_CACHE.tmp" "$IMG_CACHE"
                ok "Downloaded ($((sz / 1048576))MB)"
                got=true; break
            fi
        fi
        rm -f "$IMG_CACHE.tmp"
    done
    $got || die "All mirrors failed. Check your internet connection."
}

if [ ! -f "$IMG_CACHE" ]; then
    download_image
fi

# ── Step 2: Create VM disk overlay ─────────────────────────────────────────
if [ ! -f "$VM_DISK" ]; then
    log "Creating VM disk overlay (qcow2 backed by base image, 20G)..."
    qemu-img create -f qcow2 -b "$IMG_CACHE" -F qcow2 "$VM_DISK" 20G >/dev/null \
        || die "qemu-img create failed"
fi

# ── Step 3: Generate SSH key + cloud-init seed ISO ─────────────────────────
generate_seed_iso() {
    local seed_dir="$CACHE/seed"
    rm -rf "$seed_dir"
    mkdir -p "$seed_dir"

    if [ ! -f "$SSH_KEY" ]; then
        log "Generating SSH key for VM access..."
        ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "iora-dev-vm" >/dev/null \
            || die "ssh-keygen failed"
        ok "SSH key created: $SSH_KEY"
    fi
    local pubkey
    pubkey=$(cat "$SSH_KEY.pub")

    cat > "$seed_dir/user-data" <<CLOUDEOF
#cloud-config
ssh_pwauth: true
disable_root: false
hostname: iora-dev

users:
  - name: root
    ssh_authorized_keys:
      - $pubkey
  - name: iora
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    groups: sudo, docker
    ssh_authorized_keys:
      - $pubkey

chpasswd:
  list:
    - root:iora
    - iora:iora
  expire: false

# Don't reach out to cloud metadata services
datasource_list: [ NoCloud ]

# Netzwerk IMMER konfigurieren (QEMU user-net = 10.0.2.0/24): DHCP plus
# statische Fallback-IP, damit die VM garantiert eine IP hat, selbst wenn
# der Slirp-DHCP-Server nicht antwortet.
network:
  version: 2
  ethernets:
    en-any:
      match:
        name: "en*"
      dhcp4: true
      dhcp6: false
      addresses: [10.0.2.15/24]
      gateway4: 10.0.2.2
      nameservers:
        addresses: [10.0.2.3, 1.1.1.1]
    eth-any:
      match:
        name: "eth*"
      dhcp4: true
      dhcp6: false
      addresses: [10.0.2.16/24]
      gateway4: 10.0.2.2
      nameservers:
        addresses: [10.0.2.3, 1.1.1.1]

# Give the network stack time to initialize before package installs
bootcmd:
  - sleep 3

# Update apt cache before installing packages
package_update: true
package_upgrade: false

# Speed up first boot: install the absolute minimum here; everything else
# is installed by dev-local from the host (so it can be retried/recovered).
packages:
  - rsync
  - curl
  - ca-certificates
  - qemu-guest-agent

runcmd:
  - mkdir -p /etc/iora && touch /etc/iora/ssh-ready
  - systemctl enable --now qemu-guest-agent 2>/dev/null || true
  - 'systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true'

final_message: "IORA Dev VM ready."
CLOUDEOF

    cat > "$seed_dir/meta-data" <<'METAEOF'
instance-id: iora-dev-vm
local-hostname: iora-dev
METAEOF

    # Auto-install a missing ISO creation tool instead of failing outright
    if ! command -v genisoimage >/dev/null 2>&1 && ! command -v mkisofs >/dev/null 2>&1 && ! command -v xorriso >/dev/null 2>&1 && ! { $IS_MACOS && command -v hdiutil >/dev/null 2>&1; }; then
        warn "No ISO creation tool found – attempting auto-install..."
        if command -v auto_install_iso_tools >/dev/null 2>&1; then
            auto_install_iso_tools || warn "ISO tool auto-install failed"
        fi
    fi
    log "Generating cloud-init seed ISO..."
    if command -v genisoimage >/dev/null 2>&1; then
        genisoimage -output "$SEED_ISO" -volid cidata -joliet -rock "$seed_dir" >/dev/null 2>&1 \
            || die "genisoimage failed"
    elif command -v mkisofs >/dev/null 2>&1; then
        mkisofs -output "$SEED_ISO" -volid cidata -joliet -rock "$seed_dir" >/dev/null 2>&1 \
            || die "mkisofs failed"
    elif command -v xorriso >/dev/null 2>&1; then
        xorriso -as mkisofs -output "$SEED_ISO" -volid cidata -joliet -rock "$seed_dir" >/dev/null 2>&1 \
            || die "xorriso failed"
    elif $IS_MACOS && command -v hdiutil >/dev/null 2>&1; then
        hdiutil makehybrid -o "$SEED_ISO" -hfs -joliet -iso -default-volume-name cidata "$seed_dir" >/dev/null 2>&1 \
            || die "hdiutil failed"
    else
        err "No ISO creation tool found."
        err "  macOS: brew install cdrtools  (or use hdiutil – already in macOS)"
        err "  Linux: apt-get install genisoimage  (or xorriso)"
        exit 1
    fi
    rm -rf "$seed_dir"
    ok "Seed ISO created: $SEED_ISO"
}

if [ ! -f "$SEED_ISO" ] || [ ! -f "$SSH_KEY" ]; then
    generate_seed_iso
fi

# ── Step 4: Start QEMU (only if not already running) ───────────────────────
ssh_known_clear

# Pre-flight checks: disk space and resources
if command -v detect_low_disk_space >/dev/null 2>&1; then
    if ! detect_low_disk_space "$CACHE" 5; then
        dim "Attempting automatic cache cleanup..."
        auto_clean_disk_space "$CACHE"
    fi
fi

EXISTING_PID=$(vm_pid)
if [ -n "$EXISTING_PID" ]; then
    ok "QEMU already running (PID $EXISTING_PID) – attaching to existing VM."
    QEMU_CHILD_PID=""  # don't kill someone else's process
else
    # Intelligent port conflict resolution
    if port_in_use "$VM_SSH"; then
        dim "Port $VM_SSH appears to be in use - checking..."
        if command -v auto_resolve_port_conflict >/dev/null 2>&1; then
            auto_resolve_port_conflict "$VM_SSH" "IORA VM"
            resolve_result=$?
            if [ $resolve_result -eq 2 ]; then
                # Existing IORA VM found - reuse it
                EXISTING_PID=$(vm_pid)
                ok "Reusing existing IORA VM"
                QEMU_CHILD_PID=""
            elif [ $resolve_result -ne 0 ]; then
                die "Port $VM_SSH could not be freed. Run './dev-local.sh --stop' or pick a free port."
            fi
        else
            die "Port $VM_SSH is in use by another process. Run './dev-local.sh --stop' or pick a free port."
        fi
    fi

    # Only start QEMU if we didn't find an existing VM
    if [ -z "$EXISTING_PID" ]; then
        log "Starting QEMU ($QEMU_BIN, $ACCEL)..."

        # ── Port availability: ANY busy forward port kills QEMU's user-net
        #    ("Could not set up host forwarding rule ..."). Check every port
        #    and skip busy ones with a warning instead of crashing.
        SKIPPED_PORTS=()
        add_fwd() {
            local host_port="$1" guest_port="$2"
            if port_in_use "$host_port"; then
                warn "Port $host_port is in use on the host – not forwarding it (the VM service stays reachable inside the VM)."
                SKIPPED_PORTS+=("$host_port")
            else
                NETDEV="${NETDEV},hostfwd=tcp::${host_port}-:${guest_port}"
            fi
        }
        NETDEV="user,id=n0,hostfwd=tcp::${VM_SSH}-:22,dns=1.1.1.1"
        add_fwd "$VM_HOME" 8126
        add_fwd "$VM_BRIDGE" 8101
        for p in "${FWD_PORTS[@]}"; do
            add_fwd "$p" "$p"
        done
        if [ "${#SKIPPED_PORTS[@]}" -gt 0 ]; then
            warn "Skipped forwarded ports: ${SKIPPED_PORTS[*]} (busy on host – free them and re-run, or use an SSH tunnel)"
        fi

        QEMU_ARGS=(
            -name "IORA-Dev"
            -m "$VM_RAM" -smp "$VM_CPUS"
            -cpu "$QEMU_CPU"
            -machine "${QEMU_MACHINE},accel=${ACCEL}"
            # Faster disk I/O: writeback caching, thread-pool AIO, online TRIM.
            -drive "file=$VM_DISK,format=qcow2,if=virtio,cache=writeback,aio=threads,discard=unmap,detect-zeroes=unmap"
            -drive "file=$SEED_ISO,format=raw,media=cdrom"
            -netdev "$NETDEV"
            # virtio-gpu replaces the default VGA; suppress the unused one.
            -vga none
            -device virtio-gpu
            -display "$DISPLAY_OPT"
            -serial "file:$CACHE/qemu-serial.log"
            -monitor "unix:$QEMU_MONITOR,server,nowait"
            -pidfile "$QEMU_PIDFILE"
            # Sync guest clock to host, avoids drift after suspend/resume.
            -rtc "base=utc,clock=host"
        )

        # arm64 needs a virtio-net-device variant and UEFI firmware
        if [ "$HOST_ARCH" = "arm64" ] || [ "$HOST_ARCH" = "aarch64" ]; then
            QEMU_ARGS+=(-device "virtio-net-device,netdev=n0")
            # Netzwerkunabhaengiger Host<->VM-Kanal (qemu-guest-agent)
            QEMU_ARGS+=(-device virtio-serial-device)
            QEMU_ARGS+=(-chardev "socket,id=qga0,path=$CACHE/qga.sock,server=on,wait=off")
            QEMU_ARGS+=(-device "virtserialport,chardev=qga0,id=qga0,name=org.qemu.guest_agent.0")
            # QMP: hypervisor control channel (status, pause, screenshot, ...)
            QEMU_ARGS+=(-qmp "unix:$CACHE/qmp.sock,server=on,wait=off")
            QEMU_ARGS+=(-device virtio-balloon-device)
            FW="/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
            if [ ! -f "$FW" ]; then
                FW=$(find /opt/homebrew /usr/share/qemu /usr/share/edk2 -name "edk2-aarch64-code.fd" 2>/dev/null | head -1)
            fi
            [ -n "$FW" ] && [ -f "$FW" ] && QEMU_ARGS+=(-bios "$FW")
            QEMU_ARGS+=(-boot order=d,menu=off)
        else
            QEMU_ARGS+=(-device "virtio-net-pci,netdev=n0")
            # Netzwerkunabhaengiger Host<->VM-Kanal (qemu-guest-agent)
            QEMU_ARGS+=(-device virtio-serial-pci)
            QEMU_ARGS+=(-chardev "socket,id=qga0,path=$CACHE/qga.sock,server=on,wait=off")
            QEMU_ARGS+=(-device "virtserialport,chardev=qga0,id=qga0,name=org.qemu.guest_agent.0")
            # QMP: hypervisor control channel (status, pause, screenshot, ...)
            QEMU_ARGS+=(-qmp "unix:$CACHE/qmp.sock,server=on,wait=off")
            QEMU_ARGS+=(-device virtio-balloon-pci)
        fi

        # Detach unless --foreground requested
        if $FOREGROUND; then
            "$QEMU_BIN" "${QEMU_ARGS[@]}" &
            QEMU_CHILD_PID=$!
            log "QEMU PID: $QEMU_CHILD_PID (foreground mode)"
        else
            nohup "$QEMU_BIN" "${QEMU_ARGS[@]}" </dev/null >>"$CACHE/qemu-stdout.log" 2>>"$CACHE/qemu-stderr.log" &
            QEMU_CHILD_PID=$!
            disown "$QEMU_CHILD_PID" 2>/dev/null || true
            log "QEMU PID: $QEMU_CHILD_PID (detached)"
        fi

        # Quick liveness check
        sleep 4
        if ! kill -0 "$QEMU_CHILD_PID" 2>/dev/null; then
            err "QEMU died immediately. Last 20 lines of stderr:"
            tail -20 "$CACHE/qemu-stderr.log" 2>/dev/null >&2 || true
            die "Check accelerator (currently '$ACCEL'). Set IORA_DEV_ACCEL=tcg to force software emulation."
        fi
    fi
fi

# ── Step 5: Wait for cloud-init to finish ──────────────────────────────────
log "Waiting for cloud-init to finish (first boot may take 3-10 min)..."
# Primärer Kontrollkanal: QEMU-Guest-Agent via virtio-serial (funktioniert
# OHNE IP/Netzwerk); SSH bleibt als Alternative.
# shellcheck source=./qga.sh
source "$SCRIPT_DIR/qga.sh" 2>/dev/null || true
WAITED=0
CLOUD_TIMEOUT=900
LAST_DIAG=0
while [ $WAITED -lt $CLOUD_TIMEOUT ]; do
    # Bail out if QEMU died during boot
    if [ -n "$QEMU_CHILD_PID" ] && ! kill -0 "$QEMU_CHILD_PID" 2>/dev/null; then
        err "QEMU exited during boot. Last 20 lines of stderr:"
        tail -20 "$CACHE/qemu-stderr.log" 2>/dev/null >&2 || true
        die "VM crashed."
    fi
    BOOT_READY=false
    if [ -S "$CACHE/qga.sock" ] && command -v socat >/dev/null 2>&1; then
        if qga_exec "test -f /var/lib/cloud/instance/boot-finished && echo READY" 2>/dev/null | grep -q READY; then
            BOOT_READY=true
        fi
    fi
    if ! $BOOT_READY && ssh_vm "test -f /var/lib/cloud/instance/boot-finished && echo READY" 2>/dev/null | grep -q READY; then
        BOOT_READY=true
    fi
    if $BOOT_READY; then
        ok "Cloud-init completed"
        break
    fi
    # Every 90s without SSH progress: show what the VM console is doing
    if [ $((WAITED - LAST_DIAG)) -ge 90 ]; then
        LAST_DIAG=$WAITED
        echo
        warn "No SSH response after ${WAITED}s – last VM console output:"
        tail -8 "$CACHE/qemu-serial.log" 2>/dev/null | sed 's/^/  /' >&2 || true
        warn "If the VM shows a login prompt: log in on the VM console (root / password iora) and run:"
        warn "  ip a ; journalctl -u ssh -n 20 ; tail -30 /var/log/cloud-init-output.log"
    fi
    sleep 5; WAITED=$((WAITED+5))
    printf '.'
    if [ $((WAITED % 60)) -eq 0 ] && [ $WAITED -gt 0 ]; then
        printf '[%ds]' "$WAITED"
    fi
done
echo

if [ $WAITED -ge $CLOUD_TIMEOUT ]; then
    err "Cloud-init did not finish within $((CLOUD_TIMEOUT/60)) minutes."
    err "  Manual SSH: ssh -i $SSH_KEY -p $VM_SSH root@127.0.0.1"
    err "  Then re-run this script (idempotent)."
    exit 1
fi

# ── Step 6: Provision the VM (idempotent, skipped on re-runs) ──────────────
need_provision=true
if [ -f "$PROVISIONED_MARKER" ] && ! $REPROVISION; then
    # Verify provisioning is still valid (compat scripts present)
    if ssh_vm "test -f /etc/iora/dev-vm-provisioned && test -d /opt/iora && test -f /home/iora/iora/iora-os/iora-dev-compat.sh" 2>/dev/null; then
        ok "VM already provisioned (use --reprovision to force re-run)"
        need_provision=false
    fi
fi

# Always sync source code (cheap, idempotent, picks up host edits)
log "Syncing repository to VM via rsync..."
ssh_vm "mkdir -p /home/iora/iora" 2>/dev/null || true

# Pre-flight: ensure rsync is installed in the VM (cloud-init may skip it)
if ! ssh_vm "command -v rsync >/dev/null 2>&1 && echo OK" 2>/dev/null | grep -q OK; then
    warn "rsync missing in VM (cloud-init may have skipped package install). Installing..."
    ssh_vm "apt-get update -qq && apt-get install -y -qq rsync" 2>/dev/null || {
        warn "Could not install rsync automatically. Trying scp fallback..."
    }
fi

if rsync -az --delete \
    --exclude='.git' --exclude='target' --exclude='node_modules' \
    --exclude='.cache' --exclude='buildroot-*' --exclude='releases' \
    --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' \
    --exclude='.iora-dev' \
    -e "ssh ${SSH_OPTS[*]} -i $SSH_KEY -p $VM_SSH" \
    "$REPO_ROOT/" "root@127.0.0.1:/home/iora/iora/" 2>&1 | tail -5
then
    ok "Project synced"
else
    die "rsync failed. Try: ssh -i $SSH_KEY -p $VM_SSH root@127.0.0.1"
fi
ssh_vm "chown -R iora:iora /home/iora/iora" 2>/dev/null || true

# ── Register systemd services (ALWAYS, not only on first provision): the
#    script is idempotent and this is what makes --source-mode/--build-mode
#    switches take effect on re-runs without --reprovision.
log "Registering IORA OS systemd services (mode: $RUN_MODE)..."
ssh_vm "bash /home/iora/iora/iora-os/iora-dev-services.sh --${RUN_MODE}-mode 2>&1" | tail -8 \
    || warn "iora-dev-services.sh reported errors"

if $need_provision; then
    log "Installing system packages (apt) – this is the slow first-run step..."
    ssh_vm bash -s <<'INSTEOF' || die "Package install failed"
set -e
export DEBIAN_FRONTEND=noninteractive
# Wait briefly if apt is locked (cloud-init may still hold it)
for i in 1 2 3 4 5 6 7 8 9 10; do
    fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
    sleep 3
done
apt-get update -qq
# --no-install-recommends + retries: smaller download, faster provisioning
apt-get install -y -qq --no-install-recommends -o Acquire::Retries=3 \
    curl git ca-certificates build-essential pkg-config libssl-dev \
    nodejs npm docker.io postgresql postgresql-client rsync \
    python3 python3-pip htop vim mold nginx openssl socat \
    sudo systemd-container
systemctl enable --now docker postgresql nginx 2>/dev/null || true
# Fix DNS: disable systemd-resolved which adds broken IPv6 resolver
systemctl disable systemd-resolved 2>/dev/null || true
systemctl stop systemd-resolved 2>/dev/null || true
rm -f /etc/resolv.conf
echo -e 'nameserver 1.1.1.1\nnameserver 8.8.8.8' > /etc/resolv.conf
INSTEOF

    log "Configuring PostgreSQL roles & dev-mode marker..."
    ssh_vm bash -s <<'PGEOF' || warn "PostgreSQL setup had non-fatal warnings"
set +e
# Create admin roles for dev environment
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='root'\"" | grep -q 1 \
    || su - postgres -c "psql -c \"CREATE ROLE root WITH LOGIN SUPERUSER PASSWORD 'iora'\""
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='postgres'\"" | grep -q 1 \
    && su - postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'iora'\""

# Mark as dev mode
mkdir -p /etc/iora /etc/iora/db-credentials
touch /etc/iora/os-dev-mode
chmod 700 /etc/iora/db-credentials

# Initialize database manager config (will be used by iora-db-manager)
cat > /etc/iora/db-config.toml <<'DBCFG'
# IORA Dev VM Database Configuration

[global]
default_conn_limit = 20
enable_rls = true
recommend_pooling = true
backup_retention_days = 7

[rotation]
interval_days = 90
min_password_length = 32
grace_period_hours = 24
auto_rotate = false  # Disabled in dev mode

[services.iora-home]
conn_limit = 30
allow_ddl = true
allow_temp_tables = true

[services.iora-core]
conn_limit = 25
allow_ddl = true
allow_temp_tables = true

[services.iora-secrets]
conn_limit = 20
allow_ddl = false
allow_temp_tables = false

[services.iora-security]
conn_limit = 20
allow_ddl = false
allow_temp_tables = true

[services.iora-watchdog]
conn_limit = 15
allow_ddl = false
allow_temp_tables = false

[services.iora-assist]
conn_limit = 25
allow_ddl = true
allow_temp_tables = true

[services.iora-appstore]
conn_limit = 20
allow_ddl = false
allow_temp_tables = true
DBCFG
PGEOF

    log "Installing Rust toolchain (for in-VM cargo if needed)..."
    ssh_vm "su - iora -c 'test -x ~/.cargo/bin/rustc || curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal'" \
        2>&1 | tail -5

    log "Configuring Cargo (mold linker + sparse registry)..."
    ssh_vm "su - iora -c 'mkdir -p ~/.cargo'"
    ssh_vm "cat > /home/iora/.cargo/config.toml" <<'CEOF'
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[target.aarch64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[registries.crates-io]
protocol = "sparse"

[net]
retry = 2
git-fetch-with-cli = true
CEOF
    ssh_vm "chown iora:iora /home/iora/.cargo/config.toml"

    log "Applying IORA OS compat layer + improvements (one SSH session)..."
    ssh_vm 'for s in iora-dev-compat.sh iora-dev-improvements.sh; do echo "=== $s ==="; bash "/home/iora/iora/iora-os/$s" 2>&1 | tail -n 8; echo; done' \
        || warn "compat/improvements reported errors"

    # Mark as provisioned
    ssh_vm "mkdir -p /etc/iora && touch /etc/iora/dev-vm-provisioned"
    touch "$PROVISIONED_MARKER"
    ok "Provisioning complete"
fi

# ── Step 7: Service enablement & DB init (always run; safe to repeat) ──────
log "Initializing databases with iora-db-manager..."
ssh_vm bash -s <<'DBEOF' 2>&1 | tail -10 || warn "Database initialization had warnings"
set +e

# Check if iora-db-manager is available (built services)
if command -v iora-db-manager >/dev/null 2>&1; then
    # Use the new database manager for proper security
    export POSTGRES_ADMIN_URL="postgres://postgres:iora@localhost:5432/postgres"
    iora-db-manager --config /etc/iora/db-config.toml init
    iora-db-manager --config /etc/iora/db-config.toml status
else
    # Fallback for dev VM before services are built
    echo "[INFO] iora-db-manager not yet available, using simple init"
    su - postgres -c "createuser -s root 2>/dev/null || true"

    # Create databases with simple permissions
    for db in iora_home iora_core iora_security iora_secrets iora_appstore iora_assist iora_watchdog; do
        su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1 \
            || su - postgres -c "createdb $db"
    done

    # Grant root superuser access for dev
    su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE iora_home TO root\" 2>/dev/null || true"
    su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE iora_core TO root\" 2>/dev/null || true"

    # Create simple credential files for compatibility
    mkdir -p /etc/iora/db-credentials
    for db in iora_home iora_core iora_security iora_secrets iora_appstore iora_assist iora_watchdog; do
        echo "DATABASE_URL=postgres://root:iora@localhost/$db" > /etc/iora/db-credentials/iora-${db#iora_}.env
    done
    chmod 600 /etc/iora/db-credentials/*.env

    # Pre-seed extensions and columns that migrations may miss
    for db in iora_home iora_core iora_security iora_secrets iora_appstore; do
        su - postgres -c "psql $db -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto'" 2>/dev/null || true
    done
    # Force widget_templates_json column (migration 028 sometimes skipped)
    su - postgres -c "psql iora_home -c 'ALTER TABLE installed_themes ADD COLUMN IF NOT EXISTS widget_templates_json TEXT DEFAULT NULL'" 2>/dev/null || true
fi

# iora-home systemd override for dev VM
mkdir -p /etc/systemd/system/iora-home.service.d /opt/iora/build/iora-home/data
if [ "$(cat /etc/iora/dev-run-mode 2>/dev/null || echo source)" = "build" ]; then
cat > /etc/systemd/system/iora-home.service.d/db.conf <<CFG
[Service]
# Database URL will be loaded from /etc/iora/db-credentials/iora-home.env
WorkingDirectory=/opt/iora/build/iora-home
CFG
else
# Source mode: no WorkingDirectory override (unit runs cargo run from the mirror)
rm -f /etc/systemd/system/iora-home.service.d/db.conf
fi

# Central log viewer: iora-home must be able to read other services' journals.
cat > /etc/systemd/system/iora-home.service.d/logs.conf <<CFG
[Service]
SupplementaryGroups=systemd-journal
CFG

# Bootstrap admin credentials for dev VM (idempotent)
mkdir -p /etc/iora
[ ! -f /etc/iora/iora-home.env ] && cat > /etc/iora/iora-home.env <<'ENVEOF'
DATABASE_URL=postgres://root:iora@localhost:5432/iora_home
RUST_LOG=iora-home=debug
IORA_BOOTSTRAP_ADMIN_USER=admin
IORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234
ENVEOF
# If file already exists, just ensure bootstrap vars are present
[ -f /etc/iora/iora-home.env ] && {
    grep -q 'IORA_BOOTSTRAP_ADMIN_USER' /etc/iora/iora-home.env 2>/dev/null || echo 'IORA_BOOTSTRAP_ADMIN_USER=admin' >> /etc/iora/iora-home.env
    grep -q 'IORA_BOOTSTRAP_ADMIN_PASSWORD' /etc/iora/iora-home.env 2>/dev/null || echo 'IORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234' >> /etc/iora/iora-home.env
}

systemctl daemon-reload
systemctl reset-failed iora-db-init iora-migrations 2>/dev/null
systemctl restart iora-home 2>/dev/null || true

# Enable services and timers
systemctl enable --now iora-hot-reload.path 2>/dev/null || true
systemctl enable --now iora-health-check.timer 2>/dev/null || true
systemctl enable iora-db-init.service 2>/dev/null || true
systemctl enable iora-migrations.service 2>/dev/null || true

echo "[OK] Database initialization complete"
DBEOF
ok "Databases initialized"

# ── Step 8: Hot-reload daemon (keeps services in sync with the mirror) ─────
log "Installing hot-reload daemon (mode: $RUN_MODE)..."
ssh_vm bash -s <<'HOTEOF' 2>&1 | tail -5 || warn "hot-reload daemon install had warnings"
set -e
install -m 0755 /home/iora/iora/iora-os/iora-dev-hot-reload.sh /usr/local/bin/iora-dev-hot-reload.sh
cat > /etc/systemd/system/iora-hot-reload.service <<'UNIT'
[Unit]
Description=IORA Dev VM Hot-Reload (1:1 mirror watcher)
After=multi-user.target

[Service]
Type=simple
ExecStart=/usr/local/bin/iora-dev-hot-reload.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now iora-hot-reload.service 2>/dev/null || true
systemctl restart iora-hot-reload.service 2>/dev/null || true
echo "[OK] hot-reload daemon active (mode: $(cat /etc/iora/dev-run-mode 2>/dev/null || echo source))"
HOTEOF

# ── Step 9: Frontend (source mode: Vite in VM / build mode: dist deploy) ────
if [ "$RUN_MODE" = "source" ]; then
    log "Source mode: setting up the Vite dev server in the VM..."
    ssh_vm bash -s <<'VITEEOF' 2>&1 | tail -5 || warn "Vite setup had warnings"
set +e
cd /home/iora/iora/frontend || exit 0
if [ -f package.json ]; then
    [ -d node_modules ] || npm install --no-audit --no-fund 2>&1 | tail -3
    cat > /etc/systemd/system/iora-frontend-dev.service <<'UNIT'
[Unit]
Description=IORA Frontend Vite Dev Server (source mode)
After=network.target

[Service]
Type=simple
User=iora
Group=iora
WorkingDirectory=/home/iora/iora/frontend
ExecStart=/usr/bin/npm run dev -- --host 0.0.0.0 --port 5173
Restart=always
RestartSec=3
Environment=NODE_ENV=development
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now iora-frontend-dev.service 2>/dev/null || true
    # iora-home proxies frontend requests to Vite (HMR)
    grep -q IORA_FRONTEND_DEV_URL /etc/iora/iora-home.env 2>/dev/null || \
        echo 'IORA_FRONTEND_DEV_URL=http://127.0.0.1:5173' >> /etc/iora/iora-home.env
    systemctl restart iora-home 2>/dev/null || true
    echo "[OK] Vite dev server unit created (HMR via iora-home proxy)"
fi
VITEEOF
else
FRONTEND_DIR="$REPO_ROOT/frontend"
if [ -f "$FRONTEND_DIR/package.json" ] && command -v npm >/dev/null 2>&1; then
    log "Build mode: building frontend..."
    if (cd "$FRONTEND_DIR" && npm install --silent && npm run build) 2>&1 | tail -5; then
        if [ -d "$FRONTEND_DIR/dist" ]; then
            log "Deploying frontend to VM..."
            ssh_vm "mkdir -p /opt/iora/build/dist"
            rsync -az -e "ssh ${SSH_OPTS[*]} -i $SSH_KEY -p $VM_SSH" \
                "$FRONTEND_DIR/dist/" "root@127.0.0.1:/opt/iora/build/dist/" \
                && ok "Frontend deployed"
        fi
    else
        warn "Frontend build failed (non-fatal). Run 'cd frontend && npm install' on the host to debug."
    fi
else
    warn "npm not found on host – skipping frontend build."
fi
fi

# ── Step 10: Verification ───────────────────────────────────────────────────
log "Verifying IORA OS services..."
SERVICES_CHECK=$(ssh_vm "systemctl list-unit-files --type=service 'iora-*' 2>/dev/null | grep -c '^iora-' || echo 0")
log "IORA services registered: ${SERVICES_CHECK//[!0-9]/}"

check() {
    local label="$1" cmd="$2"
    if ssh_vm "$cmd" 2>/dev/null | grep -q OK; then ok "$label"
    else warn "$label: missing"; fi
}
check "nginx reverse proxy"     'nginx -t >/dev/null 2>&1 && echo OK'
check "SSL certificates"        'test -f /etc/iora/ssl/server.crt && echo OK'
check "/etc/iora/os-dev-mode"   'test -f /etc/iora/os-dev-mode && echo OK'
check "Health monitor binary"   'test -f /usr/lib/iora/iora-health-check && echo OK'
check "Setup wizard binary"     'test -f /usr/lib/iora/iora-setup-wizard && echo OK'
check "Centralized logging"     'test -d /var/log/iora && echo OK'
check "Firewall script"         'test -f /usr/lib/iora/iora-firewall && echo OK'

# Final health check
log "Checking iora-home health endpoint..."
HEALTH_OK=false
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if curl -fsS --max-time 3 "http://127.0.0.1:${VM_HOME}/api/health" >/dev/null 2>&1 \
       || curl -fsS --max-time 3 "http://127.0.0.1:${VM_HOME}/health" >/dev/null 2>&1; then
        HEALTH_OK=true; break
    fi
    sleep 5
done
if $HEALTH_OK; then
    ok "iora-home is responding on http://127.0.0.1:${VM_HOME}"
else
    warn "iora-home not yet responding – it may still be building. Check: ssh -i $SSH_KEY -p $VM_SSH root@127.0.0.1 'journalctl -u iora-home -n 50'"
fi

# ── Step 11: Launch dev-watch TUI in a second terminal (best-effort) ─────
if ! $NO_WATCH; then
    DASH_BIN="$REPO_ROOT/iora-os/backend/target/debug/iora-dev-watch"
    if watcher_needs_build "$DASH_BIN"; then
        log "Building updated dev-watch TUI..."
        (cd "$REPO_ROOT/iora-os/backend" && cargo build -p iora-dev-watch 2>&1 | tail -5) || \
            warn "Failed to build dev-watch TUI. Run manually later."
    fi
    if [ -f "$DASH_BIN" ]; then
        log "Launching IORA Dev Watch TUI..."
        if $IS_MACOS; then
            osascript -e "tell app \"Terminal\" to do script \"cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY\"" >/dev/null 2>&1 \
                || warn "Couldn't auto-open Terminal.app. Run manually: $DASH_BIN"
        else
            if command -v gnome-terminal >/dev/null 2>&1; then
                gnome-terminal -- bash -c "cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY; exec bash" &
            elif command -v konsole >/dev/null 2>&1; then
                konsole -e bash -c "cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY; exec bash" &
            elif command -v xterm >/dev/null 2>&1; then
                xterm -e "cd '$REPO_ROOT' && '$DASH_BIN' --vm-host $VM_HOST --vm-port $VM_SSH --ssh-key $SSH_KEY" &
            else
                warn "No terminal emulator found. Run manually: $DASH_BIN"
            fi
        fi
    fi
fi

# ── Step 12: Start background health monitor ───────────────────────────────
HEALTH_MONITOR_LOG="$CACHE/health-monitor.log"
HEALTH_MONITOR_PID="$CACHE/health-monitor.pid"

if command -v start_health_monitor >/dev/null 2>&1; then
    start_health_monitor "127.0.0.1" "$VM_SSH" "$SSH_KEY" "$HEALTH_MONITOR_LOG" "$HEALTH_MONITOR_PID"
fi

# ── Step 13: Launch the 1:1 sync watcher (best-effort) ────────────────────
# Keeps the VM mirror in sync continuously (~1s latency) - the core of the
# fast dev loop. Reuses the same terminal-launch pattern as the dev-watch TUI.
if ! $NO_WATCH; then
    SYNC_BIN="$SCRIPT_DIR/dev-sync.sh"
    if [ -f "$SYNC_BIN" ]; then
        SYNC_EXTRA=""
        [ "$RUN_MODE" = "build" ] && SYNC_EXTRA="--with-binaries"
        SYNC_CMD="'$SYNC_BIN' --watch --vm-port $VM_SSH --ssh-key $SSH_KEY $SYNC_EXTRA"
        log "Launching 1:1 sync watcher (dev-sync.sh --watch)..."
        if $IS_MACOS; then
            osascript -e "tell app \"Terminal\" to do script \"cd '$REPO_ROOT' && $SYNC_CMD\"" >/dev/null 2>&1 \
                || warn "Couldn't auto-open Terminal.app. Run manually: $SYNC_BIN --watch"
        else
            if command -v gnome-terminal >/dev/null 2>&1; then
                gnome-terminal -- bash -c "cd '$REPO_ROOT' && $SYNC_CMD" &
            elif command -v konsole >/dev/null 2>&1; then
                konsole -e bash -c "cd '$REPO_ROOT' && $SYNC_CMD" &
            elif command -v xterm >/dev/null 2>&1; then
                xterm -e "cd '$REPO_ROOT' && $SYNC_CMD" &
            else
                warn "No terminal emulator found. Run manually: $SYNC_BIN --watch"
            fi
        fi
    fi
fi

# ── Banner ─────────────────────────────────────────────────────────────────
echo
cat <<EOF
  +====================================================================+
  |                    IORA Dev VM ready                                |
  +====================================================================+
  |  WEB                                                                |
  |    Dashboard (nginx) https://localhost                              |
  |    Dashboard direct  http://localhost:${VM_HOME}                            |
  |    Dev Bridge        http://localhost:${VM_BRIDGE}/dev/health               |
  |    Swagger API       http://localhost:${VM_HOME}/api/docs                   |
  |                                                                     |
  |  ACCESS                                                             |
  |    SSH               ssh -i ${SSH_KEY} -p ${VM_SSH} root@127.0.0.1
  |                                                                     |
  |  CONTROL (this script)                                              |
  |    Status            ./dev-local.sh --status                        |
  |    Stop the VM       ./dev-local.sh --stop                          |
  |    Reprovision       ./dev-local.sh --reprovision                   |
  |    Full reset        ./dev-local.sh --clean                         |
  |    Launch watcher    ./dev-local.sh --watcher                       |
  |                                                                     |
  |  MODE                                                               |
  |    Run mode:         $RUN_MODE (source = cargo run / build = binaries)   |
  |    Sync watcher:     dev-sync.sh --watch (~1s mirror latency)       |
  |    Guest agent:      socat - UNIX-CONNECT:<cache>/qga.sock         |
  |    QMP control:      ./qmp.sh status | screenshot | pause           |
$(if [ "${#SKIPPED_PORTS[@]}" -gt 0 ]; then printf '  |    NOT forwarded:   %s (busy on host)                         |\n' "${SKIPPED_PORTS[*]}"; fi)
  |    Dev Watch TUI     $REPO_ROOT/iora-os/backend/target/debug/iora-dev-watch
  |                                                                     |
  |  CO-BUDDY FEATURES                                                  |
  |    Auto-repair       Port conflicts, disk space, dependencies       |
  |    Health Monitor    Background monitoring (logs: health-monitor.log)|
  |    Smart Recovery    Auto-restart failed services                   |
  |                                                                     |
  |  Logs                                                               |
  |    Setup log         ${LOG_FILE}
  |    QEMU serial       ${CACHE}/qemu-serial.log
  |    QEMU stderr       ${CACHE}/qemu-stderr.log
  |    Health monitor    ${HEALTH_MONITOR_LOG}
  +====================================================================+
EOF
echo

# Send desktop notification
if command -v send_notification >/dev/null 2>&1; then
    send_notification "IORA Dev VM Ready" "Dashboard available at http://localhost:${VM_HOME}" "normal"
fi

if $FOREGROUND; then
    log "Foreground mode – Ctrl+C to stop the VM."
    wait "$QEMU_CHILD_PID" 2>/dev/null || true
else
    ok "VM running detached. The script exits now; the VM keeps running."
fi
