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
MIN_DISK_GB=8
TMPDIR="${TMPDIR:-/tmp}"
WORK_DIR="${TMPDIR}/iora-netinstall"

# ── Colors ─────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Functions ──────────────────────────────────────────────────────────────────

msg()  { echo -e "${GREEN}[IORA]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()  { err "$*"; exit 1; }

show_banner() {
    echo -e "${CYAN}"
    cat <<'BANNER'
  ___ ___  ____    _      ___  ____
 |_ _/ _ \|  _ \  / \    / _ \/ ___|
  | | | | | |_) |/ _ \  | | | \___ \
  | | |_| |  _ </ ___ \ | |_| |___) |
 |___\___/|_| \_/_/   \_\ \___/|____/

BANNER
    echo -e "${NC}"
    echo -e "${BOLD}  IORA OS Net Installer${NC}"
    echo -e "  Server: ${BLUE}${UPDATE_SERVER}${NC}"
    echo ""
}

check_dependencies() {
    local missing=()
    for cmd in curl xz dd; do
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

fetch_manifest() {
    msg "Fetching installer manifest from update server..."

    local url="${UPDATE_SERVER}/v1/iora/installer?arch=${ARCH}&channel=${CHANNEL}"
    local response
    response=$(curl -sSf "$url" 2>/dev/null) || die "Failed to contact update server at ${UPDATE_SERVER}"

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

get_disks() {
    local disks=""
    for dev in /sys/block/sd* /sys/block/vd* /sys/block/nvme*; do
        [ -e "$dev" ] || continue
        local name=$(basename "$dev")
        # Skip partitions
        [[ "$name" =~ [0-9]p[0-9] ]] && continue
        # Skip removable/CD-ROM
        [ "$(cat "$dev/removable" 2>/dev/null)" = "1" ] && continue
        # Check minimum size
        local sectors=$(cat "$dev/size" 2>/dev/null || echo 0)
        local size_gb=$((sectors * 512 / 1024 / 1024 / 1024))
        [ "$size_gb" -lt "$MIN_DISK_GB" ] && continue
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

    if curl -fL --progress-bar -o "$image_file" "$IMAGE_URL"; then
        msg "Download complete."
    else
        die "Download failed!"
    fi

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

    # Write with progress
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
    sleep 2

    msg "${GREEN}Image written successfully!${NC}"
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
                echo "  --yes, -y             Skip confirmation prompts"
                echo "  --server URL          Update server URL (default: ${UPDATE_SERVER})"
                echo "  --download-server URL Download server URL (default: ${DOWNLOAD_SERVER})"
                echo "  --help, -h            Show this help"
                exit 0
                ;;
            *)
                die "Unknown option: $1 (use --help)"
                ;;
        esac
    done
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"
    show_banner
    check_dependencies
    fetch_manifest
    select_disk
    confirm_install
    download_image
    install_image
    show_complete
}

main "$@"
