#!/bin/bash
#
# IORA OS Complete Image Builder
# Creates all image formats for different deployment scenarios
#
# Generates:
#   - img.xz       - Raw disk image (USB/SD card, physical hardware)
#   - iso          - Archive ISO (contains compressed raw image; not directly bootable)
#   - installer-boot.iso - Bootable installer ISO (GRUB/UEFI)
#   - qcow2.xz     - QEMU/KVM image (compressed)
#   - vdi.zip      - VirtualBox image
#   - vmdk.zip     - VMware image
#   - ova          - Open Virtualization Archive (VirtualBox/VMware)
#   - raucb        - RAUC update bundle

set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/buildroot-2024.02"
OUTPUT_DIR="${BUILD_DIR}/output/images"
RELEASE_DIR="${SCRIPT_DIR}/releases/$(date +%Y%m%d-%H%M%S)"
BUILDROOT_VERSION="2024.02"
BUILDROOT_URL="https://buildroot.org/downloads/buildroot-${BUILDROOT_VERSION}.tar.gz"
POST_IMAGE_MODE="auto"
UNATTENDED=false
IMAGES_ONLY=false
PROGRESS=false
REQUIRE_ALL_ARTIFACTS=false

CREATED_ARTIFACTS=()
SKIPPED_ARTIFACTS=()

# VM image settings
VM_NAME="IORA-OS"
VM_VERSION="1.0"
VM_MEMORY_MB="2048"
VM_CPUS="2"
VM_DISK_SIZE="8G"

# RAUC signing (configure these for production)
RAUC_CERT="${SCRIPT_DIR}/rauc/cert.pem"
RAUC_KEY="${SCRIPT_DIR}/rauc/key.pem"
BUILDROOT_SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
FALLBACK_MARKER="${OUTPUT_DIR}/iora-os.fallback"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

mark_created() {
    CREATED_ARTIFACTS+=("$1")
}

mark_skipped() {
    SKIPPED_ARTIFACTS+=("$1")
}

xz_compress_file() {
    local src_file="$1"
    local dst_file="$2"
    local tmp_file="${dst_file}.tmp"

    rm -f "${tmp_file}" "${dst_file}"

    # Use streaming compression to avoid metadata/chgrp issues on some filesystems.
    if ! xz -9 -T0 -c "${src_file}" > "${tmp_file}"; then
        rm -f "${tmp_file}"
        return 1
    fi

    mv -f "${tmp_file}" "${dst_file}"
}

require_bootable_base_image() {
    if [ -f "${FALLBACK_MARKER}" ]; then
        log_error "Current base image was produced via fallback mode and is not a validated bootable disk image."
        log_info "Rebuild with privileges and full post-image flow: sudo ./build.sh all --force-full-image --progress"
        return 1
    fi

    if [ ! -f "${OUTPUT_DIR}/rootfs.cpio.gz" ] && [ ! -f "${OUTPUT_DIR}/rootfs.cpio" ]; then
        log_warn "No Buildroot cpio initramfs output detected; installer ISO may be incomplete until you run a reconfigure rebuild."
    fi

    return 0
}

show_progress_stream() {
    awk '
    BEGIN { step=0; width=28 }
    {
        print $0
        if ($0 ~ /^>>> /) {
            step++
            label=$0
            sub(/^>>> /, "", label)

            pos = step % width
            bar = ""
            for (i=0; i<width; i++) {
                if (i == pos) {
                    bar = bar ">"
                } else {
                    bar = bar "="
                }
            }

            printf "\r[%s] steps:%4d | %s", bar, step, label > "/dev/stderr"
            fflush("/dev/stderr")
        }
    }
    END {
        if (step > 0) {
            printf "\n" > "/dev/stderr"
        }
    }'
}

normalize_shell_scripts() {
    # Keep all project shell scripts executable and with LF endings.
    find "${SCRIPT_DIR}" \
        -path "${SCRIPT_DIR}/buildroot-*" -prune -o \
        -type f -name "*.sh" -print0 | while IFS= read -r -d '' file; do
        sed -i 's/\r$//' "${file}" || true
        chmod +x "${file}" || true
    done
}

prompt_yes_no() {
    local question="$1"
    local default_answer="${2:-N}"
    local reply

    if [ "${UNATTENDED}" = true ]; then
        if [ "${default_answer}" = "Y" ]; then
            return 0
        fi
        return 1
    fi

    if [ ! -t 0 ]; then
        log_warn "No interactive terminal detected, defaulting to '${default_answer}' for: ${question}"
        if [ "${default_answer}" = "Y" ]; then
            return 0
        fi
        return 1
    fi

    while true; do
        read -r -p "${question} [y/n]: " reply
        case "${reply}" in
            [Yy]|[Yy][Ee][Ss]) return 0 ;;
            [Nn]|[Nn][Oo]) return 1 ;;
            *) echo "Please answer y or n." ;;
        esac
    done
}

dep_to_package() {
    case "$1" in
        xz) echo "xz-utils" ;;
        qemu-img) echo "qemu-utils" ;;
        libelf) echo "libelf-dev" ;;
        *) echo "$1" ;;
    esac
}

try_apt_install() {
    local package_list=("$@")
    local installer=""

    if ! command -v apt-get &> /dev/null; then
        return 1
    fi

    if [ "${EUID}" -eq 0 ]; then
        installer=""
    elif command -v sudo &> /dev/null; then
        installer="sudo"
    else
        return 1
    fi

    if [ -n "${installer}" ]; then
        ${installer} DEBIAN_FRONTEND=noninteractive apt-get update && \
            ${installer} DEBIAN_FRONTEND=noninteractive apt-get install -y "${package_list[@]}"
    else
        DEBIAN_FRONTEND=noninteractive apt-get update && \
            DEBIAN_FRONTEND=noninteractive apt-get install -y "${package_list[@]}"
    fi
}

offer_install_missing_packages() {
    local reason="$1"
    shift
    local packages=("$@")

    if [ ${#packages[@]} -eq 0 ]; then
        return 0
    fi

    if [ "${UNATTENDED}" = true ]; then
        log_info "Unattended mode: attempting automatic install for ${reason}: ${packages[*]}"
        try_apt_install "${packages[@]}" || true
        return 0
    fi

    if prompt_yes_no "Missing ${reason}. Try automatic install now (${packages[*]})?" "N"; then
        if ! try_apt_install "${packages[@]}"; then
            log_warn "Automatic installation failed for ${reason}."
            return 1
        fi
    fi

    return 0
}

show_install_alternatives() {
    local feature="$1"
    local package_hint="$2"

    log_warn "Alternative options for ${feature}:"
    log_warn "  1) Install manually: sudo apt-get install -y ${package_hint}"
    log_warn "  2) Build in a native Linux VM/host with full tooling"
    log_warn "  3) Continue without this artifact if optional"
}

refresh_optional_tool_flags() {
    ISO_TOOL_AVAILABLE=false
    HAS_VBOXMANAGE=false
    HAS_RAUC=false
    HAS_GRUB_MKRESCUE=false

    if command -v xorriso &> /dev/null || command -v genisoimage &> /dev/null || command -v mkisofs &> /dev/null; then
        ISO_TOOL_AVAILABLE=true
    fi

    if command -v grub-mkrescue &> /dev/null; then
        HAS_GRUB_MKRESCUE=true
    fi

    if command -v VBoxManage &> /dev/null; then
        HAS_VBOXMANAGE=true
    fi

    if command -v rauc &> /dev/null; then
        HAS_RAUC=true
    fi
}

check_dependencies() {
    log_info "Checking build dependencies..."

    local missing_deps=()
    local missing_packages=()

    # Core build tools
    local core_cmds=(tar gzip xz zip)
    if [ "${IMAGES_ONLY}" = false ]; then
        core_cmds+=(make gcc g++ patch wget)
    fi

    for cmd in "${core_cmds[@]}"; do
        if ! command -v $cmd &> /dev/null; then
            missing_deps+=($cmd)
        fi
    done

    # Kernel tools (objtool) need libelf headers via pkg-config only for full build.
    if [ "${IMAGES_ONLY}" = false ]; then
        if command -v pkg-config &> /dev/null; then
            if ! pkg-config --exists libelf; then
                missing_deps+=("libelf")
            fi
        else
            missing_deps+=("pkg-config")
        fi
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        for dep in "${missing_deps[@]}"; do
            missing_packages+=("$(dep_to_package "$dep")")
        done

        log_warn "Missing required dependencies: ${missing_deps[*]}"

        offer_install_missing_packages "required dependencies" "${missing_packages[@]}" || true

        local still_missing=()
        for dep in "${missing_deps[@]}"; do
            if [ "$dep" = "libelf" ]; then
                if ! command -v pkg-config &> /dev/null || ! pkg-config --exists libelf; then
                    still_missing+=("$dep")
                fi
            elif ! command -v "$dep" &> /dev/null; then
                still_missing+=("$dep")
            fi
        done

        if [ ${#still_missing[@]} -ne 0 ]; then
            log_error "Still missing required dependencies: ${still_missing[*]}"
            show_install_alternatives "required build dependencies" "${missing_packages[*]}"

            if [ "${UNATTENDED}" = true ]; then
                log_error "Unattended mode: cannot continue with missing required dependencies."
                exit 1
            fi

            if ! prompt_yes_no "Continue anyway? Build may fail." "N"; then
                exit 1
            fi
        fi
    fi

    refresh_optional_tool_flags

    if [ "${ISO_TOOL_AVAILABLE}" = false ]; then
        log_warn "No ISO creator found (xorriso/genisoimage/mkisofs) - ISO creation will be skipped"
        if offer_install_missing_packages "ISO creation tools" "xorriso"; then
            refresh_optional_tool_flags
        fi
        if [ "${ISO_TOOL_AVAILABLE}" = false ]; then
            show_install_alternatives "ISO generation" "xorriso"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "ISO cannot be generated right now. Continue build without ISO?" "Y"; then
                exit 1
            fi
        fi
    fi

    if [ "${HAS_GRUB_MKRESCUE}" = false ]; then
        log_warn "grub-mkrescue not found - bootable installer ISO will be skipped"
        if offer_install_missing_packages "bootable ISO tooling" "grub-pc-bin grub-common mtools"; then
            refresh_optional_tool_flags
        fi
        if [ "${HAS_GRUB_MKRESCUE}" = false ]; then
            show_install_alternatives "bootable installer ISO" "grub-pc-bin grub-common mtools"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "Bootable installer ISO cannot be generated right now. Continue without it?" "Y"; then
                exit 1
            fi
        fi
    fi

    if [ "${HAS_VBOXMANAGE}" = false ]; then
        log_warn "VBoxManage not found - OVA export will be skipped"
        if offer_install_missing_packages "OVA export tools" "virtualbox"; then
            refresh_optional_tool_flags
        fi
        if [ "${HAS_VBOXMANAGE}" = false ]; then
            show_install_alternatives "OVA export" "virtualbox"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "OVA cannot be generated right now. Continue build without OVA?" "Y"; then
                exit 1
            fi
        fi
    fi

    if [ "${HAS_RAUC}" = false ]; then
        log_warn "RAUC not found - update bundle creation will be skipped"
        if offer_install_missing_packages "RAUC tooling" "rauc"; then
            refresh_optional_tool_flags
        fi
        if [ "${HAS_RAUC}" = false ]; then
            show_install_alternatives "RAUC bundle creation" "rauc"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "RAUC bundle cannot be generated right now. Continue build without RAUC bundle?" "Y"; then
                exit 1
            fi
        fi
    fi

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not found - qcow2/vdi/vmdk export will be skipped"
        if offer_install_missing_packages "VM conversion tooling" "qemu-utils"; then
            if ! command -v qemu-img &> /dev/null; then
                show_install_alternatives "VM image conversion" "qemu-utils"
                if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "VM images cannot be generated right now. Continue build without qcow2/vdi/vmdk?" "Y"; then
                    exit 1
                fi
            fi
        fi
    fi

    log_success "All dependencies available"
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --force-full-image)
                POST_IMAGE_MODE="full"
                ;;
            --allow-fallback)
                POST_IMAGE_MODE="auto"
                ;;
            --force-fallback-image)
                POST_IMAGE_MODE="fallback"
                ;;
            --images-only)
                IMAGES_ONLY=true
                ;;
            --progress)
                PROGRESS=true
                ;;
            --require-all-artifacts)
                REQUIRE_ALL_ARTIFACTS=true
                ;;
            --unattended|--non-interactive|--unattachment)
                UNATTENDED=true
                ;;
            -h|--help)
                cat <<EOF
Usage: $(basename "$0") [OPTIONS]

OPTIONS:
  --force-full-image     Require full GPT/loop/grub post-image flow (fail if unavailable)
  --allow-fallback       Allow automatic fallback to rootfs.ext2 image (default)
  --force-fallback-image Always use rootfs.ext2 fallback for iora-os.img
    --images-only          Skip Buildroot compile, generate release artifacts from existing output/images
    --progress             Show build step progress while running make
    --require-all-artifacts Fail build if any optional artifact is skipped
    --unattended           No interactive prompts; auto-attempt install and continue when optional tooling is missing
  -h, --help             Show this help
EOF
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
        shift
    done
}

download_buildroot() {
    if [ -d "${BUILD_DIR}" ]; then
        log_info "Buildroot already downloaded"
        return
    fi

    log_info "Downloading Buildroot ${BUILDROOT_VERSION}..."
    cd "${SCRIPT_DIR}"

    if [ ! -f "buildroot-${BUILDROOT_VERSION}.tar.gz" ]; then
        wget "${BUILDROOT_URL}"
    fi

    log_info "Extracting Buildroot..."
    tar xzf "buildroot-${BUILDROOT_VERSION}.tar.gz"

    log_success "Buildroot ready"
}

configure_buildroot() {
    log_info "Configuring Buildroot for IORA OS..."

    cd "${BUILD_DIR}"
    PATH="${BUILDROOT_SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make BR2_EXTERNAL="${SCRIPT_DIR}" iora_defconfig

    log_success "Buildroot configured"
}

build_base_image() {
    log_info "Building IORA OS base image (this may take 1-2 hours)..."
    log_info "Post-image mode: ${POST_IMAGE_MODE}"

    cd "${BUILD_DIR}"
    if [ "${PROGRESS}" = true ]; then
        PATH="${BUILDROOT_SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" IORA_UNATTENDED="${UNATTENDED}" make -j"$(nproc)" 2>&1 | show_progress_stream
    else
        PATH="${BUILDROOT_SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" IORA_UNATTENDED="${UNATTENDED}" make -j"$(nproc)"
    fi

    log_success "Base image built successfully"
}

create_iso_image() {
    log_info "Creating archive ISO image (not directly bootable)..."

    if [ ! -f "${RELEASE_DIR}/iora-os.img.xz" ]; then
        log_warn "iora-os.img.xz not found in release directory, skipping ISO"
        return
    fi

    local iso_tool=""
    if command -v xorriso &> /dev/null; then
        iso_tool="xorriso"
    elif command -v genisoimage &> /dev/null; then
        iso_tool="genisoimage"
    elif command -v mkisofs &> /dev/null; then
        iso_tool="mkisofs"
    else
        log_warn "No ISO creation tool available, skipping ISO"
        mark_skipped "iora-os-installer.iso (missing xorriso/genisoimage/mkisofs)"
        return
    fi

    local ISO_STAGE_DIR
    ISO_STAGE_DIR=$(mktemp -d)

    cp "${RELEASE_DIR}/iora-os.img.xz" "${ISO_STAGE_DIR}/"

    cat > "${ISO_STAGE_DIR}/INSTALL.txt" <<'EOF'
IORA OS installer/archive ISO

This ISO contains:
- iora-os.img.xz (compressed raw image)

Write image to disk:
  xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
  sync

Replace /dev/sdX with your target device.
EOF

    if [ "${iso_tool}" = "xorriso" ]; then
        xorriso -as mkisofs -r -J -V "IORA_OS" -o "${RELEASE_DIR}/iora-os-installer.iso" "${ISO_STAGE_DIR}" >/dev/null 2>&1
    else
        "${iso_tool}" -r -J -V "IORA_OS" -o "${RELEASE_DIR}/iora-os-installer.iso" "${ISO_STAGE_DIR}" >/dev/null 2>&1
    fi

    rm -rf "${ISO_STAGE_DIR}"

    local size
    size=$(du -h "${RELEASE_DIR}/iora-os-installer.iso" | cut -f1)
    log_success "ISO created: iora-os-installer.iso (${size})"
    mark_created "iora-os-installer.iso"
}

resolve_installer_initrd() {
    if [ -f "${OUTPUT_DIR}/rootfs.cpio.gz" ]; then
        echo "${OUTPUT_DIR}/rootfs.cpio.gz"
        return 0
    fi

    if [ -f "${OUTPUT_DIR}/rootfs.cpio" ]; then
        if command -v gzip &> /dev/null; then
            local generated_cpio_gz="${OUTPUT_DIR}/rootfs.generated.cpio.gz"
            gzip -c "${OUTPUT_DIR}/rootfs.cpio" > "${generated_cpio_gz}"
            echo "${generated_cpio_gz}"
            return 0
        fi
    fi

    return 1
}

build_installer_runtime_initrd() {
    local source_initrd="$1"
    local runtime_initrd="$2"

    if ! command -v cpio &> /dev/null || ! command -v gzip &> /dev/null; then
        log_warn "cpio or gzip not available"
        return 1
    fi

    # Strategy: concatenate a tiny cpio containing /init AFTER the original
    # rootfs.cpio.gz. The Linux kernel initramfs loader processes multiple
    # concatenated cpio archives sequentially; later entries override earlier
    # ones. This means our /init replaces whatever init was in the original.
    #
    # This avoids extracting the original archive entirely, which fails on
    # non-root builds because cpio cannot mknod device nodes like /dev/console.
    # Concatenated gzip streams are valid gzip: cat a.gz b.gz | gunzip works.

    local work_dir
    work_dir=$(mktemp -d)

    cat > "${work_dir}/init" <<'INITEOF'
#!/bin/sh
export PATH=/sbin:/usr/sbin:/bin:/usr/bin
export TERM=linux
export NCURSES_NO_UTF8_ACS=1

# ── Mount virtual filesystems ──────────────────────────────────────
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true

if [ ! -e /dev/console ]; then
    mknod -m 600 /dev/console c 5 1 2>/dev/null || true
fi
if [ ! -e /dev/null ]; then
    mknod -m 666 /dev/null c 1 3 2>/dev/null || true
fi

mkdir -p /mnt/iso /tmp /run

# Load CD-ROM modules
modprobe cdrom 2>/dev/null || true
modprobe sr_mod 2>/dev/null || true
modprobe iso9660 2>/dev/null || true
modprobe loop 2>/dev/null || true
modprobe isofs 2>/dev/null || true

# ── Configuration ──────────────────────────────────────────────────
ISO_MOUNT="/mnt/iso"
ISO_IMAGE="iora-os.img.xz"
MIN_DISK_GB=8
BACKTITLE="IORA OS Installer"

# ── Dialog helpers ─────────────────────────────────────────────────
# Detect dialog or fall back to plain text
DIALOG_BIN=""
if command -v dialog >/dev/null 2>&1; then
    DIALOG_BIN="dialog"
elif command -v whiptail >/dev/null 2>&1; then
    DIALOG_BIN="whiptail"
fi

dlg() {
    if [ -n "$DIALOG_BIN" ]; then
        $DIALOG_BIN --backtitle "$BACKTITLE" "$@"
    fi
}

dlg_msg() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --msgbox "$1" 12 60
    else
        echo ""; echo "=== $title ==="; echo "$1"; echo ""
        echo "Press ENTER to continue..."; read _
    fi
}

dlg_yesno() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --yesno "$1" 12 60
        return $?
    else
        echo ""; echo "=== $title ==="; echo "$1"
        printf "[y/n]: "; read ans
        case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
    fi
}

dlg_info() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --infobox "$1" 8 60
    else
        echo "$1"
    fi
}

# ── Mount the installation media ───────────────────────────────────
mount_iso() {
    # Try CD-ROM devices first
    for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
        [ -b "$dev" ] || continue
        mount -t iso9660 -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || \
            mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        if [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ]; then
            return 0
        fi
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done

    # Try USB/disk partitions
    for dev in /dev/sd*[0-9] /dev/vd*[0-9] /dev/nvme*p[0-9]*; do
        [ -b "$dev" ] || continue
        mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        if [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ]; then
            return 0
        fi
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done

    return 1
}

# Find the device hosting the ISO (to exclude from target list)
get_iso_parent_disk() {
    local iso_dev=""
    iso_dev=$(grep " ${ISO_MOUNT} " /proc/mounts 2>/dev/null | awk '{print $1}' | head -1)
    [ -z "$iso_dev" ] && return
    iso_dev=$(basename "$iso_dev")
    echo "$iso_dev" | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//'
}

# ── Enumerate installable disks ────────────────────────────────────
get_disks() {
    local iso_parent
    iso_parent=$(get_iso_parent_disk)

    for disk_path in /sys/block/sd* /sys/block/vd* /sys/block/nvme*; do
        [ -e "$disk_path" ] || continue
        local name
        name=$(basename "$disk_path")

        case "$name" in
            sr*|loop*|ram*|zram*|dm-*|md*) continue ;;
        esac

        [ -n "$iso_parent" ] && [ "$name" = "$iso_parent" ] && continue

        local size_sectors
        size_sectors=$(cat "${disk_path}/size" 2>/dev/null || echo 0)
        local size_gb=$(( size_sectors / 2097152 ))

        [ "$size_gb" -lt "$MIN_DISK_GB" ] && continue

        echo "$name"
    done
}

get_disk_size_gb() {
    local disk="$1"
    local sz=$(cat "/sys/block/${disk}/size" 2>/dev/null || echo 0)
    echo $(( sz / 2097152 ))
}

get_disk_model() {
    local disk="$1"
    cat "/sys/block/${disk}/device/model" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_vendor() {
    local disk="$1"
    cat "/sys/block/${disk}/device/vendor" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_partitions() {
    local disk="$1"
    local parts=0
    for p in /sys/block/${disk}/${disk}*; do
        [ -e "$p" ] && parts=$((parts + 1))
    done
    echo "$parts"
}

# ── Main Wizard ────────────────────────────────────────────────────
run_wizard() {
    # ── Welcome screen ─────────────────────────────────────────────
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title " Welcome " --msgbox "\
    ╦╔═╗╦═╗╔═╗   ╔═╗╔═╗
    ║║ ║╠╦╝╠═╣   ║ ║╚═╗
    ╩╚═╝╩╚═╩ ╩   ╚═╝╚═╝

    IORA OS Installation Wizard

This wizard will guide you through the
installation of IORA OS on your system.

  - Select a target disk
  - Confirm the installation
  - Write the OS image to disk

Press OK to begin." 18 48
    else
        clear 2>/dev/null || true
        echo ""
        echo "  IORA OS Installation Wizard"
        echo "  ==========================="
        echo ""
        echo "  Press ENTER to begin..."
        read _
    fi

    # ── Search for installation media ──────────────────────────────
    dlg_info " Searching " "Searching for installation media...\n\nPlease wait..."
    sleep 1

    # Retry mounting with delays (device might not be ready)
    local mounted=false
    local attempt=0
    while [ "$attempt" -lt 5 ]; do
        if mount_iso; then
            mounted=true
            break
        fi
        attempt=$((attempt + 1))
        dlg_info " Searching " "Waiting for installation media... (attempt ${attempt}/5)"
        sleep 2
    done

    if [ "$mounted" = false ]; then
        dlg_msg " Error " "\
Could not find IORA OS installation image.

Ensure the installer ISO/USB is connected
and contains the file '${ISO_IMAGE}'.

The system will drop to a shell.
Type 'install' to retry."
        return 1
    fi

    local img_size
    img_size=$(ls -lh "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '{print $5}')

    # ── Verify image integrity ─────────────────────────────────────
    if [ -f "${ISO_MOUNT}/${ISO_IMAGE}.sha256" ]; then
        dlg_info " Verifying " "Verifying image integrity (SHA256)...\n\nPlease wait..."
        if (cd "${ISO_MOUNT}" && sha256sum -c "${ISO_IMAGE}.sha256" >/dev/null 2>&1); then
            dlg_info " Verified " "Image integrity: OK  (${img_size})"
            sleep 1
        else
            dlg_msg " Warning " "\
Image checksum verification FAILED!

The installation image may be corrupted.
Re-download or re-create the installer ISO.

Installation will not continue."
            return 1
        fi
    else
        dlg_info " Info " "No checksum file found - skipping verification.\nImage size: ${img_size}"
        sleep 1
    fi

    # Show version info if available
    if [ -f "${ISO_MOUNT}/VERSION" ]; then
        local ver_info
        ver_info=$(cat "${ISO_MOUNT}/VERSION" 2>/dev/null)
        if [ -n "$DIALOG_BIN" ]; then
            dlg --title " Build Info " --msgbox "${ver_info}" 10 50
        fi
    fi

    # ── Step 1: Disk selection ─────────────────────────────────────
    local disk_list
    disk_list=$(get_disks)

    if [ -z "$disk_list" ]; then
        dlg_msg " Error " "\
No suitable target disks found.

IORA OS requires at least ${MIN_DISK_GB} GB
of disk space.

Connect a disk and type 'install' to retry."
        return 1
    fi

    # Build dialog menu items
    if [ -n "$DIALOG_BIN" ]; then
        local menu_args=""
        local disk_count=0
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            local label="/dev/${disk} - ${sz}GB"
            [ -n "$mdl" ] && label="${label} [${mdl}]"
            menu_args="${menu_args} ${disk} \"${label}\""
            disk_count=$((disk_count + 1))
        done

        local sel_disk=""
        local menu_height=$((disk_count + 8))
        [ "$menu_height" -gt 20 ] && menu_height=20

        sel_disk=$(eval $DIALOG_BIN --backtitle '"$BACKTITLE"' \
            --title '" Step 1: Select Target Disk "' \
            --menu '"\nInstallation image: ${ISO_IMAGE} (${img_size})\n\nSelect the disk to install IORA OS on:\n"' \
            "$menu_height" 60 "$disk_count" \
            $menu_args \
            3>&1 1>&2 2>&3)

        if [ $? -ne 0 ] || [ -z "$sel_disk" ]; then
            dlg_msg " Cancelled " "Installation cancelled by user."
            return 1
        fi
    else
        # Plain text fallback
        echo ""
        echo "  === Step 1: Select Target Disk ==="
        echo ""
        local i=1
        local disk_array=""
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            printf "    %d)  /dev/%-8s  %4d GB" "$i" "$disk" "$sz"
            [ -n "$mdl" ] && printf "  [%s]" "$mdl"
            echo ""
            disk_array="${disk_array}${disk} "
            i=$((i + 1))
        done
        local disk_count=$((i - 1))
        echo ""
        printf "  Select disk [1-%d]: " "$disk_count"
        read choice
        sel_disk=$(echo "$disk_array" | tr ' ' '\n' | sed -n "${choice}p")
        if [ -z "$sel_disk" ]; then
            echo "  Invalid selection."
            return 1
        fi
    fi

    # ── Step 2: Confirmation ───────────────────────────────────────
    local sz=$(get_disk_size_gb "$sel_disk")
    local mdl=$(get_disk_model "$sel_disk")
    local vendor=$(get_disk_vendor "$sel_disk")
    local parts=$(get_disk_partitions "$sel_disk")

    local disk_info="Device:     /dev/${sel_disk}\nSize:       ${sz} GB"
    [ -n "$mdl" ] && disk_info="${disk_info}\nModel:      ${mdl}"
    [ -n "$vendor" ] && disk_info="${disk_info}\nVendor:     ${vendor}"
    [ "$parts" -gt 0 ] && disk_info="${disk_info}\nPartitions: ${parts} existing"

    if ! dlg_yesno " Step 2: Confirm Installation " "\
${disk_info}

╔════════════════════════════════════╗
║  WARNING: ALL data on             ║
║  /dev/${sel_disk} will be ERASED!       ║
╚════════════════════════════════════╝

Do you want to proceed?"; then
        dlg_msg " Cancelled " "Installation cancelled.\nNo changes were made."
        return 1
    fi

    # ── Step 3: Install ────────────────────────────────────────────

    # Unmount any partitions on target disk
    for part in /dev/${sel_disk}*; do
        [ -b "$part" ] && umount "$part" 2>/dev/null || true
    done

    if [ -n "$DIALOG_BIN" ]; then
        # Use a gauge for progress display
        (
            echo "5"
            echo "XXX"
            echo "Preparing disk /dev/${sel_disk}..."
            echo "XXX"

            # Wipe partition table
            dd if=/dev/zero of="/dev/${sel_disk}" bs=1M count=1 >/dev/null 2>&1
            sleep 1

            echo "10"
            echo "XXX"
            echo "Writing IORA OS image to /dev/${sel_disk}..."
            echo "This may take several minutes."
            echo "XXX"

            # Write image with progress estimation
            local img_bytes
            img_bytes=$(xz --robot --list "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '/^totals/{print $5}' || echo 0)
            [ "$img_bytes" -eq 0 ] && img_bytes=2000000000  # fallback ~2GB

            xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${sel_disk}" bs=4M conv=fsync 2>/tmp/dd_progress &
            local dd_pid=$!

            # Monitor progress
            local written=0
            while kill -0 "$dd_pid" 2>/dev/null; do
                if [ -f /tmp/dd_progress ]; then
                    written=$(grep -o '[0-9]* bytes' /tmp/dd_progress 2>/dev/null | tail -1 | awk '{print $1}' || echo 0)
                fi
                if [ "$img_bytes" -gt 0 ] && [ "$written" -gt 0 ]; then
                    local pct=$((10 + written * 80 / img_bytes))
                    [ "$pct" -gt 90 ] && pct=90
                    echo "$pct"
                fi
                sleep 3
            done
            wait "$dd_pid"
            local dd_rc=$?

            echo "95"
            echo "XXX"
            echo "Syncing disk..."
            echo "XXX"
            sync
            sleep 1

            if [ "$dd_rc" -eq 0 ]; then
                echo "100"
                echo "XXX"
                echo "Installation complete!"
                echo "XXX"
            else
                echo "100"
                echo "XXX"
                echo "ERROR: Installation failed!"
                echo "XXX"
            fi

            echo "$dd_rc" > /tmp/install_result
        ) | dlg --title " Step 3: Installing IORA OS " --gauge \
            "Preparing installation..." 10 60 0

        local result
        result=$(cat /tmp/install_result 2>/dev/null || echo 1)

        if [ "$result" -eq 0 ]; then
            dlg_msg " Installation Complete " "\
IORA OS has been installed successfully
on /dev/${sel_disk}!

Please remove the installation media
before rebooting.

Press OK to reboot."

            umount "${ISO_MOUNT}" 2>/dev/null || true
            sync
            reboot -f
        else
            dlg_msg " Installation Failed " "\
The image could not be written to
/dev/${sel_disk}.

Check the disk and try again."
            return 1
        fi
    else
        # Plain text fallback
        echo ""
        echo "  === Step 3: Installing IORA OS ==="
        echo ""
        echo "  Writing image to /dev/${sel_disk}..."
        echo "  (This may take several minutes)"
        echo ""

        if xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${sel_disk}" bs=4M status=progress conv=fsync 2>&1; then
            sync
            echo ""
            echo "  IORA OS installed successfully!"
            echo ""
            echo "  Remove the installation media and press ENTER to reboot..."
            read _
            umount "${ISO_MOUNT}" 2>/dev/null || true
            sync
            reboot -f
        else
            echo ""
            echo "  ERROR: Installation failed!"
            return 1
        fi
    fi
}

# ── Entry point ────────────────────────────────────────────────────

# Create 'install' command to re-run wizard from shell
echo '#!/bin/sh' > /bin/install
echo 'exec /init' >> /bin/install
chmod +x /bin/install 2>/dev/null || true

run_wizard
rc=$?

echo ""
echo "  Type 'install' to restart the installation wizard."
echo "  Type 'reboot' to reboot the system."
echo ""

if [ -x /bin/bash ]; then
    exec /bin/bash
elif [ -x /bin/sh ]; then
    exec /bin/sh
elif [ -x /bin/busybox ]; then
    exec /bin/busybox sh
else
    exec sh
fi
INITEOF
    chmod +x "${work_dir}/init"

    # Build a tiny cpio archive containing only our /init
    local supplement="${work_dir}/supplement.cpio.gz"
    if ! (cd "${work_dir}" && echo init | cpio -ov --format=newc 2>/dev/null | gzip -9 > "${supplement}"); then
        log_warn "Failed to create init supplement cpio"
        rm -rf "${work_dir}"
        return 1
    fi

    # Concatenate: original rootfs cpio + our init override
    cat "${source_initrd}" "${supplement}" > "${runtime_initrd}"

    rm -rf "${work_dir}"
    log_info "Installer runtime initrd created ($(du -h "${runtime_initrd}" | cut -f1)) via cpio concatenation"
    return 0
}

create_bootable_installer_iso() {
    log_info "Creating bootable installer ISO (UEFI/GRUB)..."

    if ! command -v grub-mkrescue &> /dev/null; then
        log_warn "grub-mkrescue not available, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (missing grub-mkrescue)"
        return
    fi

    if [ ! -f "${OUTPUT_DIR}/bzImage" ]; then
        log_warn "bzImage missing, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (missing bzImage)"
        return
    fi

    local installer_initrd=""
    if ! installer_initrd=$(resolve_installer_initrd); then
        log_warn "No usable initrd source found (tried rootfs.cpio.gz/rootfs.cpio), skipping bootable installer ISO"
        log_warn "Run: ./build.sh resume --reconfigure --progress to regenerate Buildroot cpio initramfs outputs"
        mark_skipped "iora-os-installer-boot.iso (missing initrd source)"
        return
    fi

    local runtime_initrd="${OUTPUT_DIR}/installer-runtime.cpio.gz"
    if ! build_installer_runtime_initrd "${installer_initrd}" "${runtime_initrd}"; then
        log_warn "Failed to build installer runtime initrd, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (failed to create runtime initrd)"
        return
    fi

    if [ ! -f "${RELEASE_DIR}/iora-os.img.xz" ]; then
        log_warn "iora-os.img.xz missing in release directory, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (missing iora-os.img.xz)"
        return
    fi

    local stage_dir
    stage_dir=$(mktemp -d)
    mkdir -p "${stage_dir}/boot/grub"

    cp "${OUTPUT_DIR}/bzImage" "${stage_dir}/boot/vmlinuz"
    cp "${runtime_initrd}" "${stage_dir}/boot/initrd.img"
    cp "${RELEASE_DIR}/iora-os.img.xz" "${stage_dir}/iora-os.img.xz"

    # Generate SHA256 checksum for integrity verification
    log_info "Generating SHA256 checksum for iora-os.img.xz..."
    (cd "${stage_dir}" && sha256sum iora-os.img.xz > iora-os.img.xz.sha256)

    # Copy additional release artifacts if present
    for f in "${RELEASE_DIR}/iora-os.qcow2.xz" \
             "${RELEASE_DIR}/iora-os.vdi.xz" \
             "${RELEASE_DIR}/iora-os.vmdk.xz" \
             "${RELEASE_DIR}/iora-os-update.raucb"; do
        if [ -f "$f" ]; then
            log_info "Including $(basename "$f") in installer ISO"
            cp "$f" "${stage_dir}/"
            (cd "${stage_dir}" && sha256sum "$(basename "$f")" >> checksums.sha256)
        fi
    done

    # Append main image checksum to combined checksums file
    cat "${stage_dir}/iora-os.img.xz.sha256" >> "${stage_dir}/checksums.sha256" 2>/dev/null || true

    # Version & build metadata
    local kernel_ver=""
    kernel_ver=$(file "${OUTPUT_DIR}/bzImage" 2>/dev/null | grep -oP 'version \K[0-9.]+' || echo "unknown")
    cat > "${stage_dir}/VERSION" <<VEOF
IORA OS
Build:   $(date '+%Y-%m-%d %H:%M:%S')
Kernel:  ${kernel_ver}
Image:   iora-os.img.xz ($(du -h "${stage_dir}/iora-os.img.xz" | cut -f1))
VEOF

    cat > "${stage_dir}/README-INSTALLER.txt" <<'EOF'
IORA OS Bootable Installer ISO

This ISO boots into an interactive installation wizard.
Follow the on-screen prompts to select a target disk and install.

Included files:
- iora-os.img.xz           Compressed raw disk image
- iora-os.img.xz.sha256    SHA256 checksum
- checksums.sha256          All checksums
- VERSION                   Build information

If you need manual control, choose "Drop to shell" from the menu.
You can re-launch the wizard at any time by typing: install

Manual install from shell:
  mkdir -p /mnt/iso
  mount /dev/sr0 /mnt/iso
  sha256sum -c /mnt/iso/iora-os.img.xz.sha256
  xzcat /mnt/iso/iora-os.img.xz | dd of=/dev/sdX bs=4M status=progress
  sync && reboot
EOF

    cat > "${stage_dir}/boot/grub/grub.cfg" <<'EOF'
set timeout=10
set default=0

menuentry "IORA OS Installer" {
    linux /boot/vmlinuz nomodeset
    initrd /boot/initrd.img
}

menuentry "IORA OS Installer (serial console)" {
    linux /boot/vmlinuz console=tty0 console=ttyS0,115200 nomodeset
    initrd /boot/initrd.img
}

menuentry "IORA OS Installer (safe mode)" {
    linux /boot/vmlinuz nomodeset noapic acpi=off
    initrd /boot/initrd.img
}
EOF

    local grub_log
    grub_log=$(mktemp)
    local grub_ok=0

    # Try grub-mkrescue. If it fails, fall back to a manual xorriso-based approach.
    # grub-mkrescue generates a hybrid BIOS+UEFI bootable ISO.
    if grub-mkrescue \
        -o "${RELEASE_DIR}/iora-os-installer-boot.iso" \
        "${stage_dir}" >"${grub_log}" 2>&1; then
        grub_ok=1
    fi

    if [ "${grub_ok}" -eq 0 ]; then
        log_warn "grub-mkrescue failed. Output:"
        cat "${grub_log}" | while IFS= read -r line; do log_warn "  ${line}"; done

        # Fallback: create a simple UEFI-only bootable ISO using xorriso directly
        if command -v xorriso &> /dev/null && [ -d /usr/lib/grub/x86_64-efi ]; then
            log_info "Attempting fallback: manual xorriso UEFI ISO..."
            local efi_img="${stage_dir}/boot/efi.img"

            # Create a FAT EFI system partition image
            dd if=/dev/zero of="${efi_img}" bs=1M count=4 2>/dev/null
            mkfs.vfat "${efi_img}" >/dev/null 2>&1
            local efi_mount
            efi_mount=$(mktemp -d)
            if mount -o loop "${efi_img}" "${efi_mount}" 2>/dev/null || sudo mount -o loop "${efi_img}" "${efi_mount}" 2>/dev/null; then
                mkdir -p "${efi_mount}/EFI/BOOT"
                # Build a standalone GRUB EFI binary
                if grub-mkstandalone --format=x86_64-efi \
                    --output="${efi_mount}/EFI/BOOT/BOOTX64.EFI" \
                    --locales="" --fonts="" \
                    "boot/grub/grub.cfg=${stage_dir}/boot/grub/grub.cfg" 2>/dev/null; then
                    umount "${efi_mount}" 2>/dev/null || sudo umount "${efi_mount}" 2>/dev/null || true
                    rmdir "${efi_mount}" 2>/dev/null || true

                    if xorriso -as mkisofs \
                        -r -J -V "IORA_INSTALLER" \
                        -e boot/efi.img -no-emul-boot \
                        -o "${RELEASE_DIR}/iora-os-installer-boot.iso" \
                        "${stage_dir}" >/dev/null 2>&1; then
                        grub_ok=1
                        log_info "Fallback xorriso UEFI ISO succeeded"
                    fi
                else
                    umount "${efi_mount}" 2>/dev/null || sudo umount "${efi_mount}" 2>/dev/null || true
                    rmdir "${efi_mount}" 2>/dev/null || true
                fi
            else
                rmdir "${efi_mount}" 2>/dev/null || true
            fi
        fi
    fi

    rm -f "${grub_log}"
    rm -rf "${stage_dir}"

    if [ "${grub_ok}" -eq 0 ]; then
        mark_skipped "iora-os-installer-boot.iso (grub-mkrescue and fallback both failed)"
        return
    fi

    local size
    size=$(du -h "${RELEASE_DIR}/iora-os-installer-boot.iso" | cut -f1)
    log_success "Bootable installer ISO created: iora-os-installer-boot.iso (${size})"
    mark_created "iora-os-installer-boot.iso"
}

create_raw_image() {
    log_info "Creating raw disk image (img.xz)..."

    if [ ! -f "${OUTPUT_DIR}/iora-os.img" ]; then
        log_error "Base image not found at ${OUTPUT_DIR}/iora-os.img"
        return 1
    fi

    # Always regenerate compressed output to avoid stale artifacts.
    cd "${OUTPUT_DIR}"
    rm -f iora-os.img.xz
    log_info "Compressing raw image with xz..."
    xz_compress_file "iora-os.img" "iora-os.img.xz"

    cp iora-os.img.xz "${RELEASE_DIR}/"

    local size=$(du -h "${RELEASE_DIR}/iora-os.img.xz" | cut -f1)
    log_success "Raw image created: iora-os.img.xz (${size})"
    mark_created "iora-os.img.xz"
}

create_qcow2_image() {
    log_info "Creating QEMU qcow2 image..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.qcow2.xz (base image not validated bootable)"
        return
    fi

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping qcow2"
        mark_skipped "iora-os.qcow2.xz (missing qemu-img)"
        return
    fi

    cd "${OUTPUT_DIR}"
    rm -f iora-os.qcow2 iora-os.qcow2.xz

    # Convert to qcow2
    log_info "Converting to qcow2 format..."
    qemu-img convert -f raw -O qcow2 -c iora-os.img iora-os.qcow2

    # Compress with xz
    log_info "Compressing qcow2 with xz..."
    xz_compress_file "iora-os.qcow2" "iora-os.qcow2.xz"

    cp iora-os.qcow2.xz "${RELEASE_DIR}/"
    rm -f iora-os.qcow2  # Clean up uncompressed intermediate file

    local size=$(du -h "${RELEASE_DIR}/iora-os.qcow2.xz" | cut -f1)
    log_success "QEMU image created: iora-os.qcow2.xz (${size})"
    mark_created "iora-os.qcow2.xz"
}

create_vdi_image() {
    log_info "Creating VirtualBox VDI image..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.vdi.zip (base image not validated bootable)"
        return
    fi

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping VDI"
        mark_skipped "iora-os.vdi.zip (missing qemu-img)"
        return
    fi

    cd "${OUTPUT_DIR}"
    rm -f iora-os.vdi iora-os.vdi.zip

    # Convert to VDI
    log_info "Converting to VDI format..."
    qemu-img convert -f raw -O vdi iora-os.img iora-os.vdi

    # Create zip archive
    log_info "Creating VDI zip archive..."
    zip -9 iora-os.vdi.zip iora-os.vdi

    cp iora-os.vdi.zip "${RELEASE_DIR}/"
    rm -f iora-os.vdi  # Clean up intermediate file

    local size=$(du -h "${RELEASE_DIR}/iora-os.vdi.zip" | cut -f1)
    log_success "VirtualBox image created: iora-os.vdi.zip (${size})"
    mark_created "iora-os.vdi.zip"
}

create_vmdk_image() {
    log_info "Creating VMware VMDK image..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.vmdk.zip (base image not validated bootable)"
        return
    fi

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping VMDK"
        mark_skipped "iora-os.vmdk.zip (missing qemu-img)"
        return
    fi

    cd "${OUTPUT_DIR}"
    rm -f iora-os.vmdk iora-os.vmdk.zip

    # Convert to VMDK
    log_info "Converting to VMDK format..."
    qemu-img convert -f raw -O vmdk iora-os.img iora-os.vmdk

    # Create zip archive
    log_info "Creating VMDK zip archive..."
    zip -9 iora-os.vmdk.zip iora-os.vmdk

    cp iora-os.vmdk.zip "${RELEASE_DIR}/"
    rm -f iora-os.vmdk  # Clean up intermediate file

    local size=$(du -h "${RELEASE_DIR}/iora-os.vmdk.zip" | cut -f1)
    log_success "VMware image created: iora-os.vmdk.zip (${size})"
    mark_created "iora-os.vmdk.zip"
}

create_ova_image() {
    log_info "Creating OVA (Open Virtualization Archive)..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.ova (base image not validated bootable)"
        return
    fi

    if ! command -v VBoxManage &> /dev/null; then
        log_warn "VBoxManage not available, skipping OVA"
        mark_skipped "iora-os.ova (missing VBoxManage)"
        return
    fi

    cd "${OUTPUT_DIR}"

    # Create temporary VM
    local VM_UUID="${VM_NAME}-temp-$(date +%s)"

    log_info "Creating temporary VirtualBox VM..."
    VBoxManage createvm --name "${VM_UUID}" --ostype "Linux_64" --register

    # Configure VM
    VBoxManage modifyvm "${VM_UUID}" \
        --memory ${VM_MEMORY_MB} \
        --cpus ${VM_CPUS} \
        --nic1 nat \
        --boot1 disk \
        --acpi on \
        --ioapic on \
        --rtcuseutc on

    # Create and attach storage
    if [ ! -f "iora-os.vdi" ]; then
        qemu-img convert -f raw -O vdi iora-os.img iora-os.vdi
    fi

    VBoxManage storagectl "${VM_UUID}" --name "SATA" --add sata --controller IntelAhci
    VBoxManage storageattach "${VM_UUID}" \
        --storagectl "SATA" \
        --port 0 \
        --device 0 \
        --type hdd \
        --medium "$(pwd)/iora-os.vdi"

    # Export to OVA
    log_info "Exporting to OVA format..."
    VBoxManage export "${VM_UUID}" \
        --output "${RELEASE_DIR}/iora-os.ova" \
        --vsys 0 \
        --product "${VM_NAME}" \
        --producturl "https://github.com/your-org/iora" \
        --vendor "IORA Project" \
        --version "${VM_VERSION}" \
        --description "IORA - Interface for Optimized Residential Autonomy"

    # Cleanup
    log_info "Cleaning up temporary VM..."
    VBoxManage unregistervm "${VM_UUID}" --delete

    local size=$(du -h "${RELEASE_DIR}/iora-os.ova" | cut -f1)
    log_success "OVA created: iora-os.ova (${size})"
    mark_created "iora-os.ova"
}

create_rauc_bundle() {
    log_info "Creating RAUC update bundle..."

    if ! command -v rauc &> /dev/null; then
        log_warn "RAUC not available, skipping update bundle"
        mark_skipped "iora-os-YYYYMMDD.raucb (missing rauc)"
        return
    fi

    # Check for signing keys
    if [ ! -f "${RAUC_CERT}" ] || [ ! -f "${RAUC_KEY}" ]; then
        log_warn "RAUC signing keys not found"
        log_info "Generate with: openssl req -x509 -newkey rsa:4096 -nodes -keyout rauc/key.pem -out rauc/cert.pem -days 3650"
        log_warn "Skipping RAUC bundle creation"
        mark_skipped "iora-os-YYYYMMDD.raucb (missing signing keys)"
        return
    fi

    if [ ! -f "${OUTPUT_DIR}/rootfs.squashfs" ]; then
        log_error "rootfs.squashfs not found"
        return 1
    fi

    cd "${SCRIPT_DIR}/rauc"

    # Create bundle directory
    local BUNDLE_DIR=$(mktemp -d)

    # Copy files
    cp "${OUTPUT_DIR}/rootfs.squashfs" "${BUNDLE_DIR}/"
    cp manifest.raucm "${BUNDLE_DIR}/"
    cp hook.sh "${BUNDLE_DIR}/"
    chmod +x "${BUNDLE_DIR}/hook.sh"

    # Update SHA256 in manifest
    local SHA256=$(sha256sum "${BUNDLE_DIR}/rootfs.squashfs" | awk '{print $1}')
    sed -i "s/sha256=auto/sha256=${SHA256}/" "${BUNDLE_DIR}/manifest.raucm"

    # Create bundle
    log_info "Signing and creating RAUC bundle..."
    rauc bundle \
        --cert="${RAUC_CERT}" \
        --key="${RAUC_KEY}" \
        "${BUNDLE_DIR}" \
        "${RELEASE_DIR}/iora-os-$(date +%Y%m%d).raucb"

    # Cleanup
    rm -rf "${BUNDLE_DIR}"

    local size=$(du -h "${RELEASE_DIR}/iora-os-"*.raucb | cut -f1)
    log_success "RAUC bundle created: iora-os-$(date +%Y%m%d).raucb (${size})"
    mark_created "iora-os-$(date +%Y%m%d).raucb"
}

create_checksums() {
    log_info "Creating checksums file..."

    cd "${RELEASE_DIR}"
    sha256sum * > SHA256SUMS

    log_success "Checksums created: SHA256SUMS"
    mark_created "SHA256SUMS"
}

create_readme() {
    log_info "Creating release README..."

    cat > "${RELEASE_DIR}/README.txt" <<'EOF'
IORA OS - Release Images

This release includes multiple image formats for different deployment scenarios:

1. iora-os.img.xz
   - Raw disk image for USB/SD cards and physical hardware
   - Usage: xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress

2. iora-os-installer.iso
    - Archive ISO containing iora-os.img.xz and install notes
    - Not directly bootable as an installer medium
    - Usage: Mount/extract the ISO, then flash iora-os.img.xz to your target disk

3. iora-os-installer-boot.iso
    - Bootable installer ISO (GRUB/UEFI, hybrid BIOS+UEFI)
    - Includes kernel, initrd, and iora-os.img.xz payload
    - Boot menu with normal, serial console, and safe mode entries
    - From the installer shell: mount /dev/sr0, then dd the image to disk

4. iora-os.qcow2.xz
   - QEMU/KVM virtual machine image (UEFI boot required)
   - Usage:
     xz -d iora-os.qcow2.xz
     qemu-system-x86_64 -enable-kvm -m 2048 \\
       -bios /usr/share/ovmf/OVMF.fd \\
       -drive file=iora-os.qcow2,format=qcow2

5. iora-os.vdi.zip
   - VirtualBox virtual machine image
   - Usage:
     unzip iora-os.vdi.zip
     Import into VirtualBox using the .vdi file

6. iora-os.vmdk.zip
   - VMware virtual machine image
   - Usage:
     unzip iora-os.vmdk.zip
     Import into VMware using the .vmdk file

7. iora-os.ova
   - Open Virtualization Archive (VirtualBox/VMware)
   - Usage: Double-click to import into VirtualBox/VMware
   - Recommended: 2GB RAM, 2 CPUs

8. iora-os-YYYYMMDD.raucb
   - RAUC update bundle for existing IORA OS installations
   - Usage: rauc install iora-os-YYYYMMDD.raucb

Default Credentials:
- Username: root
- Password: iora
- CHANGE IMMEDIATELY AFTER FIRST BOOT!

Network Access:
- IORA Home: http://[device-ip]:8080
- IORA Control: http://[device-ip]:8091
- Supervisor API: http://[device-ip]:8097

System Requirements:
- CPU: x86_64 or ARM64
- RAM: 2GB minimum, 4GB recommended
- Storage: 16GB minimum, 32GB recommended
- Network: Ethernet recommended

Documentation:
- https://github.com/your-org/iora
- See ARCHITECTURE.md for system architecture
- See iora-os/README.md for detailed OS documentation

Verification:
- Check SHA256SUMS file for integrity verification
- sha256sum -c SHA256SUMS

Support:
- Issues: https://github.com/your-org/iora/issues
- Discussions: https://github.com/your-org/iora/discussions
EOF

    log_success "README created"
    mark_created "README.txt"
}

print_summary() {
    echo ""
    log_success "============================================"
    log_success "IORA OS Build Complete!"
    log_success "============================================"
    echo ""
    log_info "Release directory: ${RELEASE_DIR}"
    echo ""
    log_info "Generated images:"
    ls -lh "${RELEASE_DIR}" | grep -v "^total" | awk '{printf "  %-30s %10s\n", $9, $5}'

    if [ ${#SKIPPED_ARTIFACTS[@]} -gt 0 ]; then
        echo ""
        log_warn "Skipped artifacts:"
        for entry in "${SKIPPED_ARTIFACTS[@]}"; do
            echo "  - ${entry}"
        done
    fi

    echo ""
    log_info "Total release size: $(du -sh ${RELEASE_DIR} | cut -f1)"
    echo ""
    log_success "All images ready for deployment!"
    echo ""

    if [ "${REQUIRE_ALL_ARTIFACTS}" = true ] && [ ${#SKIPPED_ARTIFACTS[@]} -gt 0 ]; then
        log_error "--require-all-artifacts set and some artifacts were skipped."
        exit 1
    fi
}

# Main build process
main() {
    parse_args "$@"
    normalize_shell_scripts

    log_info "Starting IORA OS complete image build..."
    log_info "Build time: $(date)"
    log_info "Unattended mode: ${UNATTENDED}"
    log_info "Images-only mode: ${IMAGES_ONLY}"
    log_info "Progress mode: ${PROGRESS}"
    log_info "Require all artifacts: ${REQUIRE_ALL_ARTIFACTS}"
    echo ""

    # Create release directory
    mkdir -p "${RELEASE_DIR}"

    # Run build steps
    check_dependencies
    if [ "${IMAGES_ONLY}" = false ]; then
        download_buildroot
        configure_buildroot
        build_base_image
    else
        log_info "Skipping Buildroot compile steps (images-only mode)."
        if [ ! -f "${OUTPUT_DIR}/iora-os.img" ]; then
            log_error "Missing base image: ${OUTPUT_DIR}/iora-os.img"
            log_info "Run a full build once: ./build.sh all"
            exit 1
        fi
    fi

    log_info ""
    log_info "Creating release images..."
    log_info ""

    create_raw_image
    create_iso_image
    create_bootable_installer_iso
    create_qcow2_image
    create_vdi_image
    create_vmdk_image
    create_ova_image
    create_rauc_bundle
    create_checksums
    create_readme

    print_summary
}

# Run main function
main "$@"
