#!/bin/bash
# ============================================================================
# IORA OS Net Installer
# ============================================================================
# Downloads and installs IORA OS directly from the update server.
# Can be used for PXE boot, USB boot, or direct installation.
#
# Usage:
#   curl -sSL https://dist.kaimdt.com/v1/iora/netinstall.sh | bash
#   -- or --
#   ./netinstall.sh [--disk /dev/sdX] [--channel stable|beta] [--yes]
#
# Requirements: bash, curl, xz, dialog (optional)
# ============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

UPDATE_SERVER="https://update.kaimdt.com"
DOWNLOAD_SERVER="https://dist.kaimdt.com"
CHANNEL="stable"
ARCH="x86_64"
TARGET_DISK=""
AUTO_CONFIRM=false
FORCE_SYSTEM_DISK=false
MIN_DISK_GB=8
MIN_RAM_MB=1024
DOWNLOAD_RETRIES=3
DOWNLOAD_TIMEOUT=300
TMPDIR="${TMPDIR:-/tmp}"
WORK_DIR="${TMPDIR}/iora-netinstall"
LOG_FILE="/var/log/iora-netinstall.log"
BOOT_MODE="unknown"  # uefi | bios
INSTALL_STARTED_AT="$(date -Iseconds 2>/dev/null || date)"

# ── Wizard state (collected during interactive setup) ──────────────────────────
IORA_HOSTNAME="iora"
IORA_TIMEZONE=""            # Europe/Berlin, UTC, ...
IORA_KEYBOARD="us"          # us, de, fr, ...
IORA_LOCALE="en_US.UTF-8"
WIPE_METHOD="quick"         # quick | zero | random | secure-erase
SWAP_SIZE_MB=0              # 0 = no swap file
PARTITION_MODE="auto"       # auto | auto-encrypted | keep
ENABLE_LUKS=false           # disk encryption (LUKS) toggle
LUKS_PASSPHRASE=""          # only kept in memory for the current run
ROOT_SIZE_GB=0              # 0 = use full disk
ACCEPT_RESCUE_PROMPT=false  # drop into rescue shell on failure
NETWORK_MODE="dhcp"         # dhcp | static
STATIC_IP=""
STATIC_GW=""
STATIC_DNS=""

# User accounts (hashed before being written to disk)
IORA_ROOT_PW=""             # empty = keep default
IORA_USER=""                # empty = no extra user
IORA_USER_PW=""
IORA_USER_FULLNAME=""
IORA_USER_SUDO=true

# Virtualization / container platform (filled by detect_virtualization)
IORA_VIRT_TYPE="none"
IORA_VIRT_VENDOR=""
IORA_VIRT_CONTAINER="none"
IORA_VIRT_LABEL="Bare metal"

# Navigation / control flow
NAV_BACK=10      # step requested "go back"
NAV_RESTART=11   # step requested "restart wizard"
NAV_SHELL=12     # user chose "exit to CLI"
CANCEL_REQUESTED=false
WIZARD_REQUEST="continue"   # set by on_sigint, consumed by ask()

# ── Colors ─────────────────────────────────────────────────────────────────────

RED='\033[38;5;203m'
GREEN='\033[38;5;42m'
YELLOW='\033[38;5;221m'
BLUE='\033[38;5;39m'
CYAN='\033[38;5;45m'
BOLD='\033[1m'
NC='\033[0m'

# ── Functions ──────────────────────────────────────────────────────────────────

# Initialise logging early (best-effort, works even without /var/log on ramdisk)
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || LOG_FILE="${TMPDIR}/iora-netinstall.log"
: > "$LOG_FILE" 2>/dev/null || true

_log() {
    local level="$1"; shift
    local line="[$(date -Iseconds 2>/dev/null || date)] [${level}] $*"
    printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
}

msg()  { echo -e "${GREEN}[IORA]${NC} $*";  _log INFO  "$*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; _log WARN  "$*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; _log ERROR "$*"; }
die()  { err "$*"; report_status "failed" "$*" || true; exit 1; }

# Trap any unexpected error so we always leave a log line
on_error() {
    local ec=$?
    local ln=${1:-?}
    err "Installer aborted at line ${ln} (exit ${ec}). See ${LOG_FILE}"
    report_status "failed" "aborted at line ${ln} exit ${ec}" || true
    exit "$ec"
}
trap 'on_error $LINENO' ERR

# Best-effort telemetry back to the update server. Never fails the install.
report_status() {
    local status="$1"
    local detail="${2:-}"
    local device_id
    device_id=$(cat /etc/machine-id 2>/dev/null || hostname 2>/dev/null || echo "unknown")
    curl -fsS --max-time 10 -X POST "${UPDATE_SERVER}/v1/iora/os/report" \
        -H "Content-Type: application/json" \
        -d "{\"device_id\":\"${device_id}\",\"version\":\"${OS_VERSION:-unknown}\",\"status\":\"${status}\",\"channel\":\"${CHANNEL}\",\"detail\":\"${detail//\"/\'}\"}" \
        >/dev/null 2>&1 || true
}

# ── Cancel / navigation helpers ────────────────────────────────────────────────
#
# Every interactive prompt accepts the reserved tokens below so a user can
# navigate without hitting Ctrl+C.  The wizard loop translates the special
# return codes into step transitions.
#
#   b / back     -> previous step              (return $NAV_BACK)
#   r / restart  -> restart the wizard         (return $NAV_RESTART)
#   c / cancel   -> open the cancel menu       (show_cancel_menu)
#
# The cancel menu asks twice before actually aborting ("manchmal verklickt man
# sich") and offers — in this order — Continue, Back, Restart, and finally
# "Exit to CLI" as the last option.

# Ask a yes/no question twice before really cancelling.
confirm_cancel() {
    local prompt1="${1:-Really cancel the installation?}"
    local answer
    echo ""
    echo -e "${YELLOW}${BOLD}${prompt1}${NC}"
    read -rp "$(echo -e "${BOLD}Cancel install? [y/N]:${NC} ")" answer || answer=""
    case "$answer" in
        [yY]|[yY][eE][sS]) ;;
        *) return 1 ;;
    esac
    read -rp "$(echo -e "${BOLD}Are you absolutely sure? [y/N]:${NC} ")" answer || answer=""
    case "$answer" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

# Present the cancel menu. The last option (and only the last one) drops the
# user to an interactive shell so support staff can inspect the system.
show_cancel_menu() {
    while true; do
        echo ""
        echo -e "${CYAN}${BOLD}─── Cancel / Navigation ───${NC}"
        echo "  1) Continue installation  (resume current step)"
        echo "  2) Go back one step"
        echo "  3) Restart the installer"
        echo "  4) Cancel and power off"
        echo "  5) Cancel and reboot"
        echo -e "  ${YELLOW}6) Exit to CLI shell (advanced)${NC}"
        echo ""
        local choice
        read -rp "$(echo -e "${BOLD}Your choice [1-6]:${NC} ")" choice || choice=""
        case "$choice" in
            1|"") return 0 ;;                                   # continue
            2)    return "$NAV_BACK" ;;
            3)    return "$NAV_RESTART" ;;
            4)
                if confirm_cancel "You are about to POWER OFF the machine."; then
                    report_status "cancelled" "user power-off from menu" || true
                    msg "Powering off..."
                    command -v poweroff >/dev/null 2>&1 && poweroff || exit 0
                fi
                ;;
            5)
                if confirm_cancel "You are about to REBOOT the machine."; then
                    report_status "cancelled" "user reboot from menu" || true
                    msg "Rebooting..."
                    command -v reboot >/dev/null 2>&1 && reboot || exit 0
                fi
                ;;
            6)
                if confirm_cancel "Drop into an interactive shell (installer will exit)?"; then
                    return "$NAV_SHELL"
                fi
                ;;
            *) echo "Invalid selection." ;;
        esac
    done
}

# SIGINT handler: a single Ctrl+C never aborts any more. Instead the user
# is asked once with a normal confirm, then the cancel menu opens.
on_sigint() {
    if [ "$CANCEL_REQUESTED" = true ]; then
        # Second Ctrl+C within the handler → actually bail out hard.
        err "Double interrupt received — aborting."
        exit 130
    fi
    CANCEL_REQUESTED=true
    echo ""
    warn "Interrupt received. The installer will NOT cancel automatically."
    local rc=0
    show_cancel_menu || rc=$?
    CANCEL_REQUESTED=false
    case "$rc" in
        "$NAV_BACK")    WIZARD_REQUEST="back"    ;;
        "$NAV_RESTART") WIZARD_REQUEST="restart" ;;
        "$NAV_SHELL")   WIZARD_REQUEST="shell"   ;;
        *)              WIZARD_REQUEST="continue" ;;
    esac
}
trap 'on_sigint' INT

# Parse a single free-text answer for reserved navigation tokens.
# Returns one of: continue | back | restart | cancel
nav_token() {
    case "${1:-}" in
        b|B|back|BACK)       echo back ;;
        r|R|restart|RESTART) echo restart ;;
        c|C|cancel|CANCEL|q|Q|quit|QUIT) echo cancel ;;
        *) echo continue ;;
    esac
}

# Prompt helper that honours the reserved navigation tokens. Sets REPLY on
# success. On nav tokens: returns $NAV_BACK / $NAV_RESTART or runs the cancel
# menu and propagates its return code.
ask() {
    local prompt="$1"; shift
    local default="${1:-}"
    local input
    local suffix=""
    if [ -n "$default" ]; then
        suffix=" [${default}]"
    fi
    while true; do
        WIZARD_REQUEST="continue"
        read -rp "$(echo -e "${BOLD}${prompt}${suffix} (or b/r/c for back/restart/cancel):${NC} ")" input || input=""
        # A Ctrl+C during read triggered on_sigint, which may have set
        # WIZARD_REQUEST.  Honour that before looking at the typed input.
        case "$WIZARD_REQUEST" in
            back)    WIZARD_REQUEST="continue"; return "$NAV_BACK" ;;
            restart) WIZARD_REQUEST="continue"; return "$NAV_RESTART" ;;
            shell)   WIZARD_REQUEST="continue"; return "$NAV_SHELL" ;;
        esac
        case "$(nav_token "$input")" in
            back)    return "$NAV_BACK" ;;
            restart) return "$NAV_RESTART" ;;
            cancel)
                local rc=0
                show_cancel_menu || rc=$?
                case "$rc" in
                    "$NAV_BACK")    return "$NAV_BACK" ;;
                    "$NAV_RESTART") return "$NAV_RESTART" ;;
                    "$NAV_SHELL")   return "$NAV_SHELL" ;;
                    *) continue ;;
                esac
                ;;
            *)
                REPLY="${input:-$default}"
                return 0
                ;;
        esac
    done
}

show_banner() {
    echo -e "${CYAN}"
    cat <<'BANNER'
           ___    ___    _____      _
          |_ _|  / _ \  |  __ \    / \
           | |  | | | | | |__) |  / _ \
           | |  | | | | |  _  /  / ___ \
          |___|  \___/  |_| \_\ /_/   \_\

BANNER
    echo -e "${NC}"
    echo -e "${BOLD}${CYAN}  IORA OS Net Installer${NC}"
    echo -e "  Server: ${BLUE}${UPDATE_SERVER}${NC}"
    echo ""
}

check_dependencies() {
    local missing=()
    for cmd in curl xz dd sha256sum lsblk blockdev sync; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        die "Missing required tools: ${missing[*]}"
    fi

    # Must be root for disk operations
    if [ "$(id -u)" -ne 0 ]; then
        die "This installer must be run as root (use sudo)"
    fi
}

detect_boot_mode() {
    if [ -d /sys/firmware/efi ]; then
        BOOT_MODE="uefi"
    else
        BOOT_MODE="bios"
    fi
    msg "Boot mode: ${BOOT_MODE}"
}

check_system_resources() {
    # RAM check
    local ram_kb
    ram_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
    local ram_mb=$((ram_kb / 1024))
    if [ "$ram_mb" -lt "$MIN_RAM_MB" ]; then
        warn "Low RAM: ${ram_mb} MB (recommended >= ${MIN_RAM_MB} MB)"
    else
        msg "RAM: ${ram_mb} MB"
    fi

    # Network connectivity
    if ! curl -fsS --max-time 10 --head "${UPDATE_SERVER}" >/dev/null 2>&1; then
        warn "Update server not reachable directly; will retry during manifest fetch."
    fi

    # Free memory check for decompress buffer (xz needs ~200MB for large images)
    local free_mem_mb=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
    if [ "$free_mem_mb" -lt 256 ]; then
        warn "Available memory is low (${free_mem_mb} MB). Decompression may fail."
    fi
}

fetch_manifest() {
    msg "Fetching installer manifest from update server..."

    local url="${UPDATE_SERVER}/v1/iora/installer?arch=${ARCH}&channel=${CHANNEL}"
    local response=""
    local attempt
    for attempt in $(seq 1 "$DOWNLOAD_RETRIES"); do
        if response=$(curl -fsS --max-time 30 --retry 2 --retry-delay 3 "$url" 2>/dev/null); then
            break
        fi
        warn "Manifest fetch attempt ${attempt}/${DOWNLOAD_RETRIES} failed"
        response=""
        sleep $((attempt * 2))
    done
    [ -z "$response" ] && die "Failed to contact update server at ${UPDATE_SERVER}"

    # Parse JSON response (portable: use grep/sed if jq not available)
    if command -v jq >/dev/null 2>&1; then
        OS_VERSION=$(echo "$response" | jq -r '.os_version')
        IMAGE_URL=$(echo "$response" | jq -r '.image_url')
        IMAGE_SHA256=$(echo "$response" | jq -r '.image_sha256')
        IMAGE_SIZE=$(echo "$response" | jq -r '.image_size')
        MIN_RAM_MB=$(echo "$response" | jq -r '.min_ram_mb')
        MIN_DISK_GB=$(echo "$response" | jq -r '.min_disk_gb')
        RELEASE_NOTES=$(echo "$response" | jq -r '.release_notes // empty')
    else
        # Fallback: basic JSON parsing with grep/sed
        OS_VERSION=$(echo "$response" | grep -o '"os_version":"[^"]*"' | head -1 | cut -d'"' -f4)
        IMAGE_URL=$(echo "$response" | grep -o '"image_url":"[^"]*"' | head -1 | cut -d'"' -f4)
        IMAGE_SHA256=$(echo "$response" | grep -o '"image_sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
        IMAGE_SIZE=$(echo "$response" | grep -o '"image_size":[0-9]*' | head -1 | cut -d: -f2)
        MIN_DISK_GB=$(echo "$response" | grep -o '"min_disk_gb":[0-9]*' | head -1 | cut -d: -f2)
        RELEASE_NOTES=""
    fi

    [ -z "$OS_VERSION" ] && die "Could not parse manifest (no os_version)"
    [ -z "$IMAGE_URL" ] && die "Could not parse manifest (no image_url)"

    local size_mb=$((IMAGE_SIZE / 1024 / 1024))
    msg "Found IORA OS ${OS_VERSION} (${CHANNEL})"
    msg "  Image: ${size_mb} MB compressed"
    msg "  SHA256: ${IMAGE_SHA256:0:16}..."
    echo ""
}

# Find the disk that currently hosts the running system (so we don't wipe it
# accidentally when running the installer from a live/rescue environment that
# happens to be booted from an internal disk).
get_system_disk() {
    local root_src
    root_src=$(findmnt -n -o SOURCE / 2>/dev/null || true)
    [ -z "$root_src" ] && return 0
    # Resolve LVM / mapper / partition to parent disk
    local pkname
    pkname=$(lsblk -no PKNAME "$root_src" 2>/dev/null | head -1)
    if [ -n "$pkname" ]; then
        echo "$pkname"
    else
        # e.g. /dev/sda1 -> sda, /dev/nvme0n1p2 -> nvme0n1
        basename "$root_src" | sed -E 's/p?[0-9]+$//'
    fi
}

get_disks() {
    local disks=""
    local system_disk
    system_disk=$(get_system_disk)
    for dev in /sys/block/sd* /sys/block/vd* /sys/block/nvme* /sys/block/mmcblk*; do
        [ -e "$dev" ] || continue
        local name=$(basename "$dev")
        # Skip partitions
        [[ "$name" =~ [0-9]p[0-9] ]] && continue
        # Skip removable/CD-ROM/loop/ram
        [ "$(cat "$dev/removable" 2>/dev/null)" = "1" ] && continue
        [[ "$name" == loop* || "$name" == ram* || "$name" == sr* ]] && continue
        # Check minimum size
        local sectors=$(cat "$dev/size" 2>/dev/null || echo 0)
        local size_gb=$((sectors * 512 / 1024 / 1024 / 1024))
        [ "$size_gb" -lt "$MIN_DISK_GB" ] && continue
        # Skip the running system disk unless forced
        if [ "$FORCE_SYSTEM_DISK" != true ] && [ -n "$system_disk" ] && [ "$name" = "$system_disk" ]; then
            continue
        fi
        disks="${disks} ${name}"
    done
    echo "$disks"
}

select_disk() {
    if [ -n "$TARGET_DISK" ]; then
        # Validate user-provided disk
        local dev_name=$(basename "$TARGET_DISK")
        if [ ! -b "/dev/${dev_name}" ]; then
            die "Disk ${TARGET_DISK} does not exist"
        fi
        local system_disk
        system_disk=$(get_system_disk)
        if [ "$FORCE_SYSTEM_DISK" != true ] && [ -n "$system_disk" ] && [ "$dev_name" = "$system_disk" ]; then
            die "Refusing to install onto system disk /dev/${dev_name}. Use --force-system-disk to override."
        fi
        # Make sure no partitions of the disk are currently mounted
        if lsblk -no MOUNTPOINT "/dev/${dev_name}" 2>/dev/null | grep -q .; then
            die "Disk /dev/${dev_name} has mounted partitions. Unmount before installing."
        fi
        return
    fi

    local available_disks=$(get_disks)
    if [ -z "$available_disks" ]; then
        die "No suitable disks found (need >= ${MIN_DISK_GB} GB)"
    fi

    echo -e "${BOLD}Available disks:${NC}"
    echo ""
    local i=1
    local disk_array=()
    for disk in $available_disks; do
        local size_gb=$(cat "/sys/block/${disk}/size" 2>/dev/null || echo 0)
        size_gb=$((size_gb * 512 / 1024 / 1024 / 1024))
        local model=$(cat "/sys/block/${disk}/device/model" 2>/dev/null | tr -s ' ' || echo "Unknown")
        printf "  ${CYAN}%d)${NC} /dev/%-8s  %4d GB  %s\n" "$i" "$disk" "$size_gb" "$model"
        disk_array+=("$disk")
        i=$((i + 1))
    done
    echo ""

    if [ ${#disk_array[@]} -eq 1 ]; then
        TARGET_DISK="/dev/${disk_array[0]}"
        msg "Only one disk found: ${TARGET_DISK}"
    else
        while true; do
            read -rp "$(echo -e "${BOLD}Select disk [1-$((i-1))]:${NC} ")" choice
            if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le $((i-1)) ]; then
                TARGET_DISK="/dev/${disk_array[$((choice-1))]}"
                break
            fi
            echo "Invalid selection."
        done
    fi
}

confirm_install() {
    if [ "$AUTO_CONFIRM" = true ]; then
        return 0
    fi

    local disk_size_gb=$(cat "/sys/block/$(basename "$TARGET_DISK")/size" 2>/dev/null || echo 0)
    disk_size_gb=$((disk_size_gb * 512 / 1024 / 1024 / 1024))

    echo ""
    echo -e "${RED}${BOLD}  WARNING: ALL DATA ON ${TARGET_DISK} WILL BE DESTROYED!${NC}"
    echo ""
    echo -e "  Version:  ${BOLD}IORA OS ${OS_VERSION}${NC} (${CHANNEL})"
    echo -e "  Target:   ${BOLD}${TARGET_DISK}${NC} (${disk_size_gb} GB)"
    echo -e "  Source:   ${BLUE}${DOWNLOAD_SERVER}${NC}"
    echo ""

    read -rp "$(echo -e "${BOLD}Continue? [y/N]:${NC} ")" answer
    case "$answer" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) die "Installation cancelled." ;;
    esac
}

download_image() {
    mkdir -p "$WORK_DIR"

    local image_file="${WORK_DIR}/iora-os.img.xz"

    if [ -f "$image_file" ]; then
        msg "Verifying existing download..."
        local existing_sha256
        existing_sha256=$(sha256sum "$image_file" | awk '{print $1}')
        if [ "$existing_sha256" = "$IMAGE_SHA256" ]; then
            msg "Using cached image (checksum OK)"
            return 0
        fi
        warn "Cached image checksum mismatch, re-downloading..."
        rm -f "$image_file"
    fi

    msg "Downloading IORA OS image..."
    msg "  URL: ${IMAGE_URL}"

    local attempt
    local ok=false
    for attempt in $(seq 1 "$DOWNLOAD_RETRIES"); do
        if curl -fL --progress-bar \
                --retry 2 --retry-delay 5 \
                --connect-timeout 30 --max-time "$DOWNLOAD_TIMEOUT" \
                -C - \
                -o "$image_file" "$IMAGE_URL"; then
            ok=true
            break
        fi
        warn "Download attempt ${attempt}/${DOWNLOAD_RETRIES} failed, retrying..."
        sleep $((attempt * 5))
    done
    if [ "$ok" != true ]; then
        rm -f "$image_file"
        die "Download failed after ${DOWNLOAD_RETRIES} attempts!"
    fi
    msg "Download complete."

    # Verify checksum
    msg "Verifying integrity (SHA256)..."
    local dl_sha256
    dl_sha256=$(sha256sum "$image_file" | awk '{print $1}')
    if [ "$dl_sha256" != "$IMAGE_SHA256" ]; then
        rm -f "$image_file"
        die "Checksum verification FAILED! Expected: ${IMAGE_SHA256}, Got: ${dl_sha256}"
    fi
    msg "Integrity check: ${GREEN}OK${NC}"
}

install_image() {
    local image_file="${WORK_DIR}/iora-os.img.xz"

    msg "Writing image to ${TARGET_DISK}..."
    warn "This will take several minutes. Do not interrupt!"
    echo ""

    # Ensure no stale mounts / swap on target
    swapoff -a 2>/dev/null || true
    for part in $(lsblk -ln -o NAME "${TARGET_DISK}" 2>/dev/null | tail -n +2); do
        umount -f "/dev/${part}" 2>/dev/null || true
    done

    # Honour the chosen wipe method.  The image write that follows will lay
    # down a fresh partition table anyway; the wipe protects leftover data
    # in unallocated areas of the disk.
    case "$WIPE_METHOD" in
        zero)
            msg "Zero-filling ${TARGET_DISK} (this takes a while)..."
            dd if=/dev/zero of="$TARGET_DISK" bs=4M status=progress conv=fsync 2>&1 || true
            ;;
        random)
            msg "Random-filling ${TARGET_DISK} (this takes a long while)..."
            dd if=/dev/urandom of="$TARGET_DISK" bs=4M status=progress conv=fsync 2>&1 || true
            ;;
        secure-erase)
            if command -v hdparm >/dev/null 2>&1; then
                msg "Attempting ATA secure erase on ${TARGET_DISK}..."
                hdparm --user-master u --security-set-pass iora "${TARGET_DISK}" 2>&1 || true
                hdparm --user-master u --security-erase      iora "${TARGET_DISK}" 2>&1 || \
                    warn "Secure erase not supported / failed, falling back to quick wipe."
            else
                warn "hdparm missing, skipping secure erase."
            fi
            ;;
        quick|*) : ;;
    esac

    # Write with progress. set -o pipefail already inherited from top.
    if command -v pv >/dev/null 2>&1; then
        xzcat "$image_file" | pv -s "$(xz --robot --list "$image_file" 2>/dev/null | awk '/^totals/{print $5}' || echo 0)" | dd of="$TARGET_DISK" bs=4M conv=fsync 2>/dev/null
    else
        xzcat "$image_file" | dd of="$TARGET_DISK" bs=4M status=progress conv=fsync 2>&1
    fi

    msg "Syncing..."
    sync
    sleep 1

    # Re-read partition table
    blockdev --rereadpt "$TARGET_DISK" 2>/dev/null || true
    partprobe "$TARGET_DISK" 2>/dev/null || true
    sleep 2

    msg "${GREEN}Image written successfully!${NC}"
}

# ── Virtualization / container detection (mirrors build-all-images.sh) ──
detect_virtualization() {
    IORA_VIRT_TYPE="none"
    IORA_VIRT_VENDOR=""
    IORA_VIRT_CONTAINER="none"
    IORA_VIRT_LABEL="Bare metal"

    if command -v systemd-detect-virt >/dev/null 2>&1; then
        local _vm _ct
        _vm=$(systemd-detect-virt --vm 2>/dev/null || true)
        _ct=$(systemd-detect-virt --container 2>/dev/null || true)
        [ -n "$_vm" ] && [ "$_vm" != "none" ] && IORA_VIRT_TYPE="$_vm"
        [ -n "$_ct" ] && [ "$_ct" != "none" ] && IORA_VIRT_CONTAINER="$_ct"
    fi

    if [ "$IORA_VIRT_CONTAINER" = "none" ]; then
        if [ -f /.dockerenv ] || grep -qa 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
            IORA_VIRT_CONTAINER="docker"
        elif [ -n "${container:-}" ]; then
            IORA_VIRT_CONTAINER="$container"
        elif grep -qa 'lxc\|lxcfs' /proc/1/cgroup 2>/dev/null; then
            IORA_VIRT_CONTAINER="lxc"
        elif grep -qi 'microsoft\|wsl' /proc/sys/kernel/osrelease 2>/dev/null; then
            IORA_VIRT_CONTAINER="wsl"
        fi
    fi

    local sys_vendor="" product="" bios_version=""
    [ -r /sys/class/dmi/id/sys_vendor ]   && sys_vendor=$(tr -d '\0' < /sys/class/dmi/id/sys_vendor   2>/dev/null)
    [ -r /sys/class/dmi/id/product_name ] && product=$(tr -d '\0' < /sys/class/dmi/id/product_name   2>/dev/null)
    [ -r /sys/class/dmi/id/bios_version ] && bios_version=$(tr -d '\0' < /sys/class/dmi/id/bios_version 2>/dev/null)

    if [ "$IORA_VIRT_TYPE" = "none" ]; then
        case "${sys_vendor} ${product}" in
            *VMware*)               IORA_VIRT_TYPE="vmware" ;;
            *VirtualBox*|*innotek*) IORA_VIRT_TYPE="oracle" ;;
            *QEMU*)                 IORA_VIRT_TYPE="qemu" ;;
            *Xen*)                  IORA_VIRT_TYPE="xen" ;;
            *Microsoft*|*Hyper-V*)  IORA_VIRT_TYPE="microsoft" ;;
            *Parallels*)            IORA_VIRT_TYPE="parallels" ;;
            *Bochs*)                IORA_VIRT_TYPE="bochs" ;;
        esac
        if [ "$IORA_VIRT_TYPE" = "none" ] && grep -qa '^flags.*\bhypervisor\b' /proc/cpuinfo 2>/dev/null; then
            IORA_VIRT_TYPE="kvm"
        fi
    fi

    case "$IORA_VIRT_TYPE" in
        vmware)    IORA_VIRT_VENDOR="VMware" ;;
        oracle)    IORA_VIRT_VENDOR="Oracle VirtualBox" ;;
        qemu|kvm)
            case "$bios_version" in
                *pve*|*roxmox*) IORA_VIRT_VENDOR="Proxmox VE (KVM)" ;;
                *)              IORA_VIRT_VENDOR="QEMU/KVM" ;;
            esac ;;
        xen)       IORA_VIRT_VENDOR="Xen" ;;
        microsoft) IORA_VIRT_VENDOR="Microsoft Hyper-V" ;;
        parallels) IORA_VIRT_VENDOR="Parallels" ;;
        bochs)     IORA_VIRT_VENDOR="Bochs" ;;
        none)      IORA_VIRT_VENDOR="" ;;
        *)         IORA_VIRT_VENDOR="$IORA_VIRT_TYPE" ;;
    esac

    if [ "$IORA_VIRT_CONTAINER" != "none" ]; then
        IORA_VIRT_LABEL="Container: ${IORA_VIRT_CONTAINER}"
    elif [ "$IORA_VIRT_TYPE" != "none" ]; then
        IORA_VIRT_LABEL="VM: ${IORA_VIRT_VENDOR}"
    else
        IORA_VIRT_LABEL="Bare metal"
    fi
}

# Persist the user's choices into the freshly-written image so the booted
# system picks them up on first start.  Best-effort: we don't fail the
# install if mounting the data partition doesn't work (some images reserve
# that for the setup wizard).
apply_system_config() {
    # Try to find the data partition (ext4 label iora-data) and write a
    # setup-hints file that the first-boot wizard + iora-home consume.
    local data_part
    data_part=$(blkid -L iora-data 2>/dev/null || true)
    if [ -z "$data_part" ]; then
        # Fallback: largest partition of the target disk
        data_part=$(lsblk -ln -b -o NAME,SIZE "${TARGET_DISK}" 2>/dev/null | tail -n +2 \
            | sort -k2 -n | tail -1 | awk '{print "/dev/"$1}')
    fi
    [ -z "$data_part" ] && return 0

    local mnt="${WORK_DIR}/mnt"
    mkdir -p "$mnt"
    if ! mount "$data_part" "$mnt" 2>/dev/null; then
        warn "Could not mount ${data_part}; system will fall back to first-boot wizard."
        return 0
    fi

    # Hash passwords with SHA-512 (-6). Never store the cleartext on disk.
    local root_hash="" user_hash=""
    if [ -n "$IORA_ROOT_PW" ] && command -v openssl >/dev/null 2>&1; then
        root_hash=$(printf '%s' "$IORA_ROOT_PW" | openssl passwd -6 -stdin 2>/dev/null || echo "")
    fi
    if [ -n "$IORA_USER_PW" ] && command -v openssl >/dev/null 2>&1; then
        user_hash=$(printf '%s' "$IORA_USER_PW" | openssl passwd -6 -stdin 2>/dev/null || echo "")
    fi

    mkdir -p "$mnt/iora"
    # JSON escape helper
    _j() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

    cat > "$mnt/iora/setup-hints.json" <<EOF
{
  "hostname": "$(_j "$IORA_HOSTNAME")",
  "timezone": "$(_j "$IORA_TIMEZONE")",
  "keyboard": "$(_j "$IORA_KEYBOARD")",
  "locale":   "$(_j "$IORA_LOCALE")",
  "network":  { "mode": "$(_j "$NETWORK_MODE")", "ip": "$(_j "$STATIC_IP")", "gateway": "$(_j "$STATIC_GW")", "dns": "$(_j "$STATIC_DNS")" },
  "disk":     { "target": "$(_j "$TARGET_DISK")", "wipe": "$(_j "$WIPE_METHOD")", "layout": "$(_j "$PARTITION_MODE")", "encrypted": ${ENABLE_LUKS}, "swap_mb": ${SWAP_SIZE_MB} },
  "users": {
    "root":   { "password_hash": "$(_j "$root_hash")" },
    "first":  {
      "name":          "$(_j "$IORA_USER")",
      "full_name":     "$(_j "$IORA_USER_FULLNAME")",
      "password_hash": "$(_j "$user_hash")",
      "sudo":          ${IORA_USER_SUDO}
    }
  },
  "installed_at": "${INSTALL_STARTED_AT}",
  "installer_version": "netinstall-2",
  "platform": {
    "label":     "$(_j "$IORA_VIRT_LABEL")",
    "vm_type":   "$(_j "$IORA_VIRT_TYPE")",
    "vm_vendor": "$(_j "$IORA_VIRT_VENDOR")",
    "container": "$(_j "$IORA_VIRT_CONTAINER")"
  }
}
EOF
    chmod 600 "$mnt/iora/setup-hints.json" 2>/dev/null || true

    # Swap file
    if [ "${SWAP_SIZE_MB:-0}" -gt 0 ] && command -v dd >/dev/null 2>&1; then
        msg "Creating ${SWAP_SIZE_MB} MB swap file on data partition..."
        if dd if=/dev/zero of="$mnt/swapfile" bs=1M count="${SWAP_SIZE_MB}" status=none 2>/dev/null; then
            chmod 600 "$mnt/swapfile" 2>/dev/null || true
            command -v mkswap >/dev/null 2>&1 && mkswap "$mnt/swapfile" >/dev/null 2>&1 || true
            # Hint so first-boot can enable it via /etc/fstab
            echo "SWAPFILE=/iora-data/swapfile SIZE_MB=${SWAP_SIZE_MB}" > "$mnt/iora/swap.conf"
        else
            warn "Swap file creation failed."
        fi
    fi
    sync
    umount "$mnt" 2>/dev/null || true
    msg "System configuration written to data partition."
}

# Optional: encrypt the root partitions of the freshly-written image with LUKS2.
# Runs only when ENABLE_LUKS=true and cryptsetup is available. Best-effort —
# logs a warning and returns 0 on failure so the user still has a bootable
# unencrypted system.
apply_luks_encryption() {
    [ "$ENABLE_LUKS" = true ] || return 0
    [ -n "$LUKS_PASSPHRASE" ] || { warn "No LUKS passphrase set, skipping encryption."; return 0; }
    if ! command -v cryptsetup >/dev/null 2>&1; then
        warn "cryptsetup not available; skipping LUKS encryption."
        warn "Use the ISO installer for encrypted installations or install"
        warn "cryptsetup in the live environment before running netinstall."
        return 0
    fi

    # Identify root-A / root-B partitions by label iora-root-a / iora-root-b,
    # falling back to partition ordering (p3/p4 on GPT images).
    local root_a root_b
    root_a=$(blkid -L iora-root-a 2>/dev/null || true)
    root_b=$(blkid -L iora-root-b 2>/dev/null || true)
    if [ -z "$root_a" ]; then
        local base="$TARGET_DISK"
        case "$base" in *[0-9]) sep="p" ;; *) sep="" ;; esac
        root_a="${base}${sep}3"
        root_b="${base}${sep}4"
    fi
    [ -b "$root_a" ] || { warn "Root-A partition not found, cannot encrypt."; return 0; }

    msg "Encrypting ${root_a}${root_b:+ and $root_b} with LUKS2..."
    local rc=0
    printf '%s' "$LUKS_PASSPHRASE" | cryptsetup reencrypt --encrypt --type luks2 \
        --reduce-device-size 32M --cipher aes-xts-plain64 --hash sha256 \
        --key-size 512 --pbkdf argon2id --batch-mode --key-file=- "$root_a" \
        2>>"$LOG_FILE" || rc=$?
    if [ "$rc" -ne 0 ]; then
        warn "LUKS encryption of ${root_a} failed (rc=$rc); root is unencrypted."
        return 0
    fi
    if [ -b "$root_b" ]; then
        printf '%s' "$LUKS_PASSPHRASE" | cryptsetup reencrypt --encrypt --type luks2 \
            --reduce-device-size 32M --cipher aes-xts-plain64 --hash sha256 \
            --key-size 512 --pbkdf argon2id --batch-mode --key-file=- "$root_b" \
            2>>"$LOG_FILE" || warn "LUKS encryption of ${root_b} failed."
    fi
    # Clear in-memory passphrase
    LUKS_PASSPHRASE=""
    msg "${GREEN}LUKS encryption applied.${NC} A boot-time initramfs is required"
    msg "to unlock the volume; this is included in images built with --encrypt."
    return 0
}

verify_install() {
    msg "Verifying installed image..."
    # Wait for partition table to settle and check expected partitions exist.
    local tries=0
    while [ $tries -lt 10 ]; do
        if lsblk -ln -o NAME "${TARGET_DISK}" 2>/dev/null | tail -n +2 | grep -q .; then
            break
        fi
        sleep 1
        tries=$((tries + 1))
    done

    local parts
    parts=$(lsblk -ln -o NAME "${TARGET_DISK}" 2>/dev/null | tail -n +2 | wc -l)
    if [ "$parts" -lt 2 ]; then
        warn "Unexpected partition count (${parts}) on ${TARGET_DISK}; verification inconclusive"
        return 0
    fi
    msg "Detected ${parts} partitions on ${TARGET_DISK}"

    # Optional: look for typical IORA labels (e.g. iora-data / boot)
    if command -v lsblk >/dev/null 2>&1; then
        lsblk -o NAME,SIZE,LABEL,FSTYPE "${TARGET_DISK}" 2>/dev/null | tee -a "$LOG_FILE" || true
    fi

    report_status "completed" "installed ${OS_VERSION} onto ${TARGET_DISK}" || true
    msg "Verification done."
}

show_complete() {
    # Try to determine IP address
    local ip="<this-device>"
    for iface in /sys/class/net/*; do
        local name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        local addr
        addr=$(ip -4 addr show "$name" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
        if [ -n "$addr" ]; then
            ip="$addr"
            break
        fi
    done

    echo ""
    echo -e "${GREEN}${BOLD}  ============================================${NC}"
    echo -e "${GREEN}${BOLD}     IORA OS ${OS_VERSION} installed!${NC}"
    echo -e "${GREEN}${BOLD}  ============================================${NC}"
    echo ""
    echo -e "  After rebooting, open a browser:"
    echo ""
    echo -e "    ${CYAN}${BOLD}http://${ip}:8080${NC}"
    echo ""
    echo -e "  The first-boot setup wizard will guide you"
    echo -e "  through configuring IORA Home."
    echo ""
    echo -e "  ${BOLD}Target:${NC}  ${TARGET_DISK}"
    echo -e "  ${BOLD}Channel:${NC} ${CHANNEL}"
    echo ""

    # Cleanup
    rm -rf "$WORK_DIR"
}


# ── Live-system network check ──────────────────────────────────────────────────
#
# Checks whether the live installer environment has obtained an IP address.
# If DHCP failed (common with VMware Host-Only adapters), the user is offered
# three options: retry DHCP, configure a temporary static IP, or continue
# without network (download step will fail, but config steps work offline).
#
check_live_network() {
    # Skip in non-interactive mode — caller is responsible for pre-networking.
    [ "$AUTO_CONFIRM" = true ] && return 0

    local ip=""
    local iface=""

    # Find first non-loopback interface with an IPv4 address
    _get_live_ip() {
        for _iface in /sys/class/net/*; do
            local _name
            _name=$(basename "$_iface")
            [ "$_name" = "lo" ] && continue
            local _addr
            _addr=$(ip -4 addr show "$_name" 2>/dev/null \
                    | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
            if [ -n "$_addr" ]; then
                printf '%s' "$_addr"
                return
            fi
        done
    }

    # Find the interface used for the default route, if any.
    _get_default_iface() {
        ip route show default 2>/dev/null | awk '/default/{print $5; exit}'
    }

    ip=$(_get_live_ip)
    if [ -n "$ip" ]; then
        msg "Network: IP address ${ip} detected."
        return 0
    fi

    # No IP found — warn and offer choices.
    echo ""
    echo -e "${YELLOW}${BOLD}  ⚠  No IP address detected on this system.${NC}"
    if [ "$IORA_VIRT_TYPE" = "vmware" ]; then
        echo -e "${YELLOW}     VMware Host-Only networks sometimes do not provide DHCP leases.${NC}"
    fi
    echo ""

    while true; do
        echo -e "${CYAN}${BOLD}─── Network setup ───${NC}"
        echo "  1) Retry DHCP  (request a new lease)"
        echo "  2) Configure a static IP  (for this installer session only)"
        echo "  3) Continue without IP  (download will fail; offline config only)"
        echo ""
        local choice
        read -rp "$(echo -e "${BOLD}Choice [1-3]:${NC} ")" choice || choice="3"
        case "$choice" in
            1)
                iface=$(_get_default_iface)
                if [ -z "$iface" ]; then
                    # Pick first non-loopback interface
                    for _f in /sys/class/net/*; do
                        local _n; _n=$(basename "$_f")
                        [ "$_n" != "lo" ] && { iface="$_n"; break; }
                    done
                fi
                if [ -z "$iface" ]; then
                    warn "No network interface found."
                    continue
                fi
                echo "  Requesting DHCP lease on ${iface}..."
                # Bring interface up and request DHCP (udhcpc preferred, dhclient fallback)
                ip link set "$iface" up 2>/dev/null || true
                if command -v udhcpc >/dev/null 2>&1; then
                    udhcpc -i "$iface" -t 10 -n -q 2>/dev/null || true
                elif command -v dhclient >/dev/null 2>&1; then
                    dhclient -1 -v "$iface" 2>/dev/null || true
                else
                    warn "No DHCP client (udhcpc/dhclient) found. Cannot request lease."
                fi
                ip=$(_get_live_ip)
                if [ -n "$ip" ]; then
                    msg "DHCP: obtained IP ${ip} on ${iface}."
                    return 0
                fi
                warn "DHCP lease not obtained. Try again or choose another option."
                ;;
            2)
                local sip sgw sdns siface
                iface=$(_get_default_iface)
                if [ -z "$iface" ]; then
                    for _f in /sys/class/net/*; do
                        local _n; _n=$(basename "$_f")
                        [ "$_n" != "lo" ] && { iface="$_n"; break; }
                    done
                fi
                echo ""
                read -rp "$(echo -e "${BOLD}Interface [${iface}]:${NC} ")" siface || siface=""
                [ -n "$siface" ] && iface="$siface"
                read -rp "$(echo -e "${BOLD}Static IPv4 (CIDR, e.g. 192.168.56.10/24):${NC} ")" sip || sip=""
                read -rp "$(echo -e "${BOLD}Gateway (e.g. 192.168.56.1):${NC} ")" sgw || sgw=""
                read -rp "$(echo -e "${BOLD}DNS (e.g. 1.1.1.1):${NC} ")" sdns || sdns="1.1.1.1"
                [ -z "$sip" ] && { warn "IP address required."; continue; }
                ip link set "$iface" up 2>/dev/null || true
                ip addr flush dev "$iface" 2>/dev/null || true
                ip addr add "$sip" dev "$iface" 2>/dev/null \
                    || { warn "Failed to set IP ${sip} on ${iface}."; continue; }
                if [ -n "$sgw" ]; then
                    ip route add default via "$sgw" dev "$iface" 2>/dev/null || true
                fi
                if [ -n "$sdns" ]; then
                    printf 'nameserver %s\n' "$sdns" > /etc/resolv.conf 2>/dev/null || true
                fi
                ip=$(_get_live_ip)
                if [ -n "$ip" ]; then
                    msg "Static IP ${ip} configured on ${iface}."
                    return 0
                fi
                warn "Static IP not visible yet. Verify your settings and retry."
                ;;
            3)
                warn "Continuing without network. The image download will fail."
                warn "You can install from a local file with --disk and an offline image."
                return 0
                ;;
            *)
                echo "Invalid choice. Please enter 1, 2, or 3."
                ;;
        esac
    done
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --disk|-d)
                TARGET_DISK="$2"
                shift 2
                ;;
            --channel|-c)
                CHANNEL="$2"
                shift 2
                ;;
            --arch|-a)
                ARCH="$2"
                shift 2
                ;;
            --yes|-y)
                AUTO_CONFIRM=true
                shift
                ;;
            --force-system-disk)
                FORCE_SYSTEM_DISK=true
                shift
                ;;
            --server)
                UPDATE_SERVER="$2"
                shift 2
                ;;
            --download-server)
                DOWNLOAD_SERVER="$2"
                shift 2
                ;;
            --help|-h)
                echo "IORA OS Net Installer"
                echo ""
                echo "Usage: $0 [options]"
                echo ""
                echo "Options:"
                echo "  --disk, -d DISK       Target disk (e.g. /dev/sda)"
                echo "  --channel, -c CHAN     Release channel: stable, beta, alpha (default: stable)"
                echo "  --arch, -a ARCH       Architecture (default: x86_64)"
                echo "  --yes, -y             Skip interactive wizard (use defaults)"
                echo "  --force-system-disk   Allow writing to the disk that hosts the live system"
                echo "  --server URL          Update server URL (default: ${UPDATE_SERVER})"
                echo "  --download-server URL Download server URL (default: ${DOWNLOAD_SERVER})"
                echo "  --help, -h            Show this help"
                echo ""
                echo "Interactive navigation (wizard):"
                echo "  At any prompt, type:"
                echo "    b / back     -> previous step"
                echo "    r / restart  -> restart wizard"
                echo "    c / cancel   -> open cancel menu (double-confirm)"
                echo "  Ctrl+C           -> open cancel menu instead of aborting"
                exit 0
                ;;
            *)
                die "Unknown option: $1 (use --help)"
                ;;
        esac
    done
}

# ── Interactive wizard steps ───────────────────────────────────────────────
#
# Each step function returns:
#   0             -> advance to next step
#   $NAV_BACK     -> previous step
#   $NAV_RESTART  -> restart the wizard
#   $NAV_SHELL    -> exit to CLI
#
# Steps re-ask only on clearly invalid input.  They honour the reserved
# navigation tokens via the ask() helper.

# Read a password twice, echo the plain password on fd 1 (caller captures).
_read_password_twice() {
    local label="$1"
    local p1 p2
    while true; do
        read -rsp "$(echo -e "${BOLD}${label}:${NC} ")" p1 || p1=""
        echo ""
        if [ -z "$p1" ]; then
            echo "(empty — leaving unchanged)" >&2
            printf ''
            return 0
        fi
        if [ ${#p1} -lt 6 ]; then
            warn "Password must be at least 6 characters."
            continue
        fi
        read -rsp "$(echo -e "${BOLD}${label} (again):${NC} ")" p2 || p2=""
        echo ""
        if [ "$p1" != "$p2" ]; then
            warn "Passwords do not match, try again."
            continue
        fi
        printf '%s' "$p1"
        return 0
    done
}

step_disk_options() {
    local rc answer

    # 1) Partitioning strategy
    echo ""
    echo -e "${CYAN}${BOLD}─── Disk options ───${NC}"
    echo "  1) Guided - Use entire disk (default)"
    echo "  2) Guided - Use entire disk and encrypt (LUKS)"
    echo "  3) Keep existing partitions (advanced — install into existing layout)"
    echo ""
    ask "Partition mode [1-3]" "1" || return $?
    case "$REPLY" in
        2)  PARTITION_MODE="auto-encrypted"; ENABLE_LUKS=true ;;
        3)  PARTITION_MODE="keep"; ENABLE_LUKS=false
            warn "Keep-mode writes into an existing partition. The downloaded"
            warn "image already contains a full partition table; keep-mode for"
            warn "the net installer is only supported via the ISO installer."
            ask "Switch to guided (entire disk)? [Y/n]" "Y" || return $?
            case "$REPLY" in
                [nN]*) warn "Keep-mode selected - installer will abort later if unsafe." ;;
                *)     PARTITION_MODE="auto" ;;
            esac
            ;;
        *)  PARTITION_MODE="auto"; ENABLE_LUKS=false ;;
    esac

    # 2) LUKS passphrase
    if [ "$ENABLE_LUKS" = true ]; then
        echo ""
        echo -e "${YELLOW}You chose full-disk encryption. Choose a strong passphrase;${NC}"
        echo -e "${YELLOW}without it your data cannot be recovered.${NC}"
        local pw
        pw=$(_read_password_twice "LUKS passphrase") || return 1
        if [ -z "$pw" ]; then
            warn "Empty passphrase - disabling LUKS."
            ENABLE_LUKS=false
            PARTITION_MODE="auto"
        else
            LUKS_PASSPHRASE="$pw"
        fi
    fi

    # 3) Wipe method
    echo ""
    echo "  How should the disk be prepared?"
    echo "    1) Quick (just overwrite with the new image)"
    echo "    2) Zero-fill entire disk (slow, deletes all residual data)"
    echo "    3) Random-fill (very slow)"
    echo "    4) ATA secure-erase (if the drive supports it)"
    echo ""
    ask "Wipe method [1-4]" "1" || return $?
    case "$REPLY" in
        2) WIPE_METHOD="zero" ;;
        3) WIPE_METHOD="random" ;;
        4) WIPE_METHOD="secure-erase" ;;
        *) WIPE_METHOD="quick" ;;
    esac

    # 4) Swap
    echo ""
    ask "Swap file size in MB (0 = none)" "0" || return $?
    if [[ "$REPLY" =~ ^[0-9]+$ ]]; then
        SWAP_SIZE_MB="$REPLY"
    else
        SWAP_SIZE_MB=0
    fi

    return 0
}

step_system_options() {
    # Hostname
    ask "Hostname" "${IORA_HOSTNAME}" || return $?
    # Enforce RFC 1123-ish hostname: alphanumerics and hyphens, <=63 chars
    if [[ "$REPLY" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$ ]]; then
        IORA_HOSTNAME="$REPLY"
    else
        warn "Invalid hostname; keeping '${IORA_HOSTNAME}'."
    fi

    # Timezone
    local tz_default="${IORA_TIMEZONE:-$(cat /etc/timezone 2>/dev/null || echo UTC)}"
    ask "Timezone (e.g. Europe/Berlin, UTC)" "$tz_default" || return $?
    IORA_TIMEZONE="$REPLY"

    # Keyboard
    ask "Keyboard layout (us, de, fr, ...)" "${IORA_KEYBOARD}" || return $?
    IORA_KEYBOARD="$REPLY"

    # Locale
    ask "Locale" "${IORA_LOCALE}" || return $?
    IORA_LOCALE="$REPLY"

    # Root password
    echo ""
    echo -e "${CYAN}${BOLD}─── Root password ───${NC}"
    echo "  Press Enter on both prompts to keep the image default."
    local rpw
    rpw=$(_read_password_twice "Root password (leave blank to keep default)") || return 1
    IORA_ROOT_PW="$rpw"

    # User account
    echo ""
    echo -e "${CYAN}${BOLD}─── First user account ───${NC}"
    ask "Username (leave empty to skip)" "" || return $?
    IORA_USER="$REPLY"
    if [ -n "$IORA_USER" ]; then
        # POSIX username rules: [a-z_][a-z0-9_-]*$
        if ! [[ "$IORA_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
            warn "Invalid username - must start with a lowercase letter or _ and"
            warn "contain only lowercase letters, digits, _ or -."
            IORA_USER=""
            return 0
        fi
        ask "Full name" "" || return $?
        IORA_USER_FULLNAME="$REPLY"
        local upw
        upw=$(_read_password_twice "Password for ${IORA_USER}") || return 1
        if [ -z "$upw" ]; then
            warn "Empty password - user will be created with account LOCKED."
        fi
        IORA_USER_PW="$upw"

        ask "Grant sudo/admin rights to ${IORA_USER}? [Y/n]" "Y" || return $?
        case "$REPLY" in
            [nN]*) IORA_USER_SUDO=false ;;
            *)     IORA_USER_SUDO=true ;;
        esac
    fi

    return 0
}

step_network_options() {
    echo ""
    echo -e "${CYAN}${BOLD}─── Network configuration ───${NC}"
    echo "  1) DHCP - automatic (default)"
    echo "  2) Static IP"
    echo ""
    ask "Network mode [1-2]" "1" || return $?
    case "$REPLY" in
        2)
            NETWORK_MODE="static"
            ask "Static IPv4 address (CIDR e.g. 192.168.1.50/24)" "$STATIC_IP" || return $?
            STATIC_IP="$REPLY"
            ask "Default gateway" "$STATIC_GW" || return $?
            STATIC_GW="$REPLY"
            ask "DNS servers (space-separated)" "${STATIC_DNS:-1.1.1.1 8.8.8.8}" || return $?
            STATIC_DNS="$REPLY"
            ;;
        *)
            NETWORK_MODE="dhcp"
            STATIC_IP=""; STATIC_GW=""; STATIC_DNS=""
            ;;
    esac
    return 0
}

step_review() {
    local disk_size_gb=0
    if [ -n "$TARGET_DISK" ]; then
        disk_size_gb=$(cat "/sys/block/$(basename "$TARGET_DISK")/size" 2>/dev/null || echo 0)
        disk_size_gb=$((disk_size_gb * 512 / 1024 / 1024 / 1024))
    fi

    echo ""
    echo -e "${CYAN}${BOLD}─── Installation summary ───${NC}"
    printf "  %-22s %s\n" "Target disk:"    "${TARGET_DISK} (${disk_size_gb} GB)"
    printf "  %-22s %s\n" "Boot mode:"      "${BOOT_MODE}"
    printf "  %-22s %s\n" "Channel:"        "${CHANNEL}"
    printf "  %-22s %s\n" "IORA version:"   "${OS_VERSION:-<from server>}"
    printf "  %-22s %s\n" "Partition mode:" "${PARTITION_MODE}"
    printf "  %-22s %s\n" "Disk wipe:"      "${WIPE_METHOD}"
    printf "  %-22s %s\n" "Encryption:"     "$([ "$ENABLE_LUKS" = true ] && echo "LUKS (enabled)" || echo "none")"
    printf "  %-22s %s\n" "Swap file:"      "$([ "$SWAP_SIZE_MB" -gt 0 ] && echo "${SWAP_SIZE_MB} MB" || echo "none")"
    printf "  %-22s %s\n" "Hostname:"       "${IORA_HOSTNAME}"
    printf "  %-22s %s\n" "Timezone:"       "${IORA_TIMEZONE:-<system>}"
    printf "  %-22s %s\n" "Locale:"         "${IORA_LOCALE}"
    printf "  %-22s %s\n" "Keyboard:"       "${IORA_KEYBOARD}"
    printf "  %-22s %s\n" "Network:"        "${NETWORK_MODE}"
    if [ "$NETWORK_MODE" = static ]; then
        printf "  %-22s %s\n" "  Static IP:"    "${STATIC_IP}"
        printf "  %-22s %s\n" "  Gateway:"      "${STATIC_GW}"
        printf "  %-22s %s\n" "  DNS:"          "${STATIC_DNS}"
    fi
    printf "  %-22s %s\n" "Root password:"  "$([ -n "$IORA_ROOT_PW" ] && echo "(changed)" || echo "(image default)")"
    if [ -n "$IORA_USER" ]; then
        printf "  %-22s %s\n" "User account:"    "${IORA_USER} ($([ "$IORA_USER_SUDO" = true ] && echo sudo || echo nosudo))"
    else
        printf "  %-22s %s\n" "User account:"    "(none)"
    fi
    echo ""
    echo -e "${RED}${BOLD}  ALL DATA ON ${TARGET_DISK} WILL BE ERASED!${NC}"
    echo ""

    ask "Start installation? [y/N]" "N" || return $?
    case "$REPLY" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return "$NAV_BACK" ;;
    esac
}

# ── Main ───────────────────────────────────────────────────────────────────────
#
# The installer is a linear wizard with a fixed step list. Each step may
# return:
#   0             -> go to the next step
#   $NAV_BACK     -> go to the previous step (stays at step 0 if already there)
#   $NAV_RESTART  -> restart the wizard from the first interactive step
#   $NAV_SHELL    -> drop the user into a CLI shell
#
# STEPS_INTERACTIVE is the list of steps the user can navigate with back.
# Pre-flight (banner, deps, manifest) is fixed and not rewindable.

STEPS_INTERACTIVE=(
    select_disk
    step_disk_options
    step_system_options
    step_network_options
    step_review
)

run_wizard() {
    local idx=0
    local total=${#STEPS_INTERACTIVE[@]}
    while [ "$idx" -lt "$total" ]; do
        local step="${STEPS_INTERACTIVE[$idx]}"
        _log INFO "Entering step ${step} (index ${idx}/${total})"
        local rc=0
        "$step" || rc=$?
        case "$rc" in
            0)
                idx=$((idx + 1))
                ;;
            "$NAV_BACK")
                if [ "$idx" -gt 0 ]; then
                    idx=$((idx - 1))
                else
                    warn "Already at first step."
                fi
                ;;
            "$NAV_RESTART")
                msg "Restarting wizard..."
                idx=0
                ;;
            "$NAV_SHELL")
                msg "Dropping to interactive shell. Run 'exit' to resume or reboot."
                report_status "cancelled" "user exited to shell" || true
                exec "${SHELL:-/bin/bash}"
                ;;
            *)
                err "Step ${step} failed with unexpected code ${rc}"
                local mrc=0
                show_cancel_menu || mrc=$?
                case "$mrc" in
                    "$NAV_BACK")    idx=$(( idx > 0 ? idx - 1 : 0 )) ;;
                    "$NAV_RESTART") idx=0 ;;
                    "$NAV_SHELL")   exec "${SHELL:-/bin/bash}" ;;
                    *) idx=$((idx + 1)) ;;
                esac
                ;;
        esac
    done
}

main() {
    parse_args "$@"
    show_banner
    check_dependencies
    detect_boot_mode
    detect_virtualization
    if [ "$IORA_VIRT_TYPE" != "none" ] || [ "$IORA_VIRT_CONTAINER" != "none" ]; then
        msg "${CYAN}Platform detected:${NC} ${IORA_VIRT_LABEL}"
    fi
    check_system_resources
    check_live_network
    fetch_manifest

    # Interactive wizard (disk/system/network/review). Skipped in --yes mode
    # apart from the validation calls inside each step.
    run_wizard

    report_status "started" "netinstall ${OS_VERSION} -> ${TARGET_DISK} (${BOOT_MODE})" || true
    download_image
    install_image
    apply_luks_encryption
    apply_system_config
    verify_install
    show_complete
}

main "$@"
