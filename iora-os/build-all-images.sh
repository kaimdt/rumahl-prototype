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
PUBLISH_RELEASE=false

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

write_payload_metadata() {
    local target_dir="$1"
    local payload_mode="full"
    local payload_bootable="yes"
    local payload_layout="gpt+bios+uefi+abroot+data"
    local payload_boot_mode="dual"

    if [ -f "${FALLBACK_MARKER}" ]; then
        payload_mode="fallback"
        payload_bootable="no"
        payload_layout="rootfs.ext2-only"
        payload_boot_mode="none"
    elif [ -f "${OUTPUT_DIR}/iora-os.bootmode" ]; then
        payload_boot_mode=$(cat "${OUTPUT_DIR}/iora-os.bootmode" 2>/dev/null | tr -d '\r\n' || echo "dual")
        case "${payload_boot_mode}" in
            dual|uefi-only|bios-only)
                ;;
            *)
                payload_boot_mode="dual"
                ;;
        esac
    fi

    cat > "${target_dir}/PAYLOAD-METADATA" <<EOF
PAYLOAD_MODE=${payload_mode}
PAYLOAD_BOOTABLE=${payload_bootable}
PAYLOAD_LAYOUT=${payload_layout}
PAYLOAD_BOOT_MODE=${payload_boot_mode}
EOF
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
            --publish)
                PUBLISH_RELEASE=true
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
    --publish              Publish release to IORA update server (requires IORA_UPDATE_API_KEY)
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
    write_payload_metadata "${ISO_STAGE_DIR}"

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
mount -t tmpfs tmpfs /tmp 2>/dev/null || true

if [ ! -e /dev/console ]; then
    mknod -m 600 /dev/console c 5 1 2>/dev/null || true
fi
if [ ! -e /dev/null ]; then
    mknod -m 666 /dev/null c 1 3 2>/dev/null || true
fi

mkdir -p /mnt/iso /mnt/target /tmp /run

# Load modules
for mod in cdrom sr_mod iso9660 loop isofs sd_mod ahci virtio_blk virtio_pci vfat fat nls_cp437 nls_iso8859_1 nls_utf8; do
    modprobe "$mod" 2>/dev/null || true
done

# ── Configuration ──────────────────────────────────────────────────
ISO_MOUNT="/mnt/iso"
ISO_IMAGE="iora-os.img.xz"
PAYLOAD_MODE="unknown"
PAYLOAD_BOOTABLE="unknown"
PAYLOAD_LAYOUT="unknown"
PAYLOAD_BOOT_MODE="unknown"
MIN_DISK_GB=8
BACKTITLE="IORA OS Installer  |  Use Tab/Arrow keys to navigate, Enter to confirm"
IORA_HOSTNAME="iora"
IORA_TIMEZONE="Europe/Berlin"
IORA_NETWORK="dhcp"
IORA_LOCALE="en_US.UTF-8"
IORA_KEYBOARD="de"
IORA_INSTALL_MODE="guided"

# Silence kernel log output that would pollute the UI
dmesg -n 1 2>/dev/null || echo 1 > /proc/sys/kernel/printk 2>/dev/null || true

# ── Dialog color theme (Ubuntu/Debian terminal-installer style) ──
setup_dialog_theme() {
    cat > /tmp/.dialogrc <<'DLGRC'
aspect = 0
separate_widget = ""
tab_len = 0
visit_items = OFF
use_shadow = ON
use_colors = ON
screen_color = (WHITE,BLUE,ON)
shadow_color = (BLACK,BLACK,ON)
dialog_color = (BLACK,WHITE,OFF)
title_color = (YELLOW,BLUE,ON)
border_color = (WHITE,BLUE,ON)
border2_color = (WHITE,BLUE,ON)
button_active_color = (WHITE,BLUE,ON)
button_inactive_color = (BLACK,WHITE,OFF)
button_key_active_color = (YELLOW,BLUE,ON)
button_key_inactive_color = (RED,WHITE,OFF)
button_label_active_color = (YELLOW,BLUE,ON)
button_label_inactive_color = (BLACK,WHITE,ON)
inputbox_color = (BLACK,WHITE,OFF)
inputbox_border_color = (WHITE,BLUE,ON)
searchbox_color = (BLACK,WHITE,OFF)
searchbox_title_color = (YELLOW,BLUE,ON)
searchbox_border_color = (WHITE,BLUE,ON)
position_indicator_color = (YELLOW,BLUE,ON)
menubox_color = (BLACK,WHITE,OFF)
menubox_border_color = (WHITE,BLUE,ON)
item_color = (BLACK,WHITE,OFF)
item_selected_color = (WHITE,BLUE,ON)
tag_color = (YELLOW,BLUE,ON)
tag_selected_color = (WHITE,BLUE,ON)
tag_key_color = (YELLOW,BLUE,ON)
tag_key_selected_color = (WHITE,BLUE,ON)
check_color = (BLACK,WHITE,OFF)
check_selected_color = (WHITE,BLUE,ON)
uarrow_color = (GREEN,BLUE,ON)
darrow_color = (GREEN,BLUE,ON)
gauge_color = (WHITE,BLUE,ON)
DLGRC
    export DIALOGRC=/tmp/.dialogrc
}

# ── Dialog helpers ─────────────────────────────────────────────────
DIALOG_BIN=""
if command -v dialog >/dev/null 2>&1; then
    DIALOG_BIN="dialog"
    setup_dialog_theme
elif command -v whiptail >/dev/null 2>&1; then
    DIALOG_BIN="whiptail"
fi

dlg() {
    $DIALOG_BIN --backtitle "$BACKTITLE" "$@"
}

dlg_msg() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --msgbox "$1" 14 64
    else
        echo ""; echo "=== $title ==="; echo "$1"; echo ""
        echo "Press ENTER to continue..."; read _
    fi
}

dlg_yesno() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --defaultno --yesno "$1" 14 64
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
        dlg --title "$title" --infobox "$1" 8 64
    else
        echo "$1"
    fi
}

dlg_input() {
    local title="$1"; local prompt="$2"; local default="$3"
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --inputbox "$prompt" 10 64 "$default" 3>&1 1>&2 2>&3
    else
        printf "  %s [%s]: " "$prompt" "$default"; read ans
        echo "${ans:-$default}"
    fi
}

is_uint() {
    case "$1" in
        ""|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

safe_uint() {
    if is_uint "$1"; then
        echo "$1"
    else
        echo "${2:-0}"
    fi
}

valid_hostname() {
    case "$1" in
        ""|*[!A-Za-z0-9-]*|-*|*-) return 1 ;;
        *) return 0 ;;
    esac
}

valid_ipv4() {
    local old_ifs octet
    old_ifs="$IFS"
    IFS=.
    set -- $1
    IFS="$old_ifs"

    [ $# -eq 4 ] || return 1
    for octet in "$@"; do
        is_uint "$octet" || return 1
        [ "$octet" -ge 0 ] && [ "$octet" -le 255 ] || return 1
    done
    return 0
}

valid_prefix_length() {
    is_uint "$1" || return 1
    [ "$1" -ge 1 ] && [ "$1" -le 32 ]
}

# ── System info helpers ────────────────────────────────────────────
get_cpu_info() {
    local model count
    model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')
    count=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "?")
    echo "${count}x ${model:-Unknown CPU}"
}

get_ram_info() {
    local total
    total=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "?")
    echo "${total} MB"
}

get_boot_mode() {
    if [ -d /sys/firmware/efi ]; then
        echo "UEFI"
    else
        echo "BIOS (Legacy)"
    fi
}

get_network_interfaces() {
    local ifaces=""
    for iface in /sys/class/net/*; do
        local name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        local state=$(cat "$iface/operstate" 2>/dev/null || echo "unknown")
        local mac=$(cat "$iface/address" 2>/dev/null || echo "??:??:??:??:??:??")
        ifaces="${ifaces}  ${name}: ${state} (${mac})\n"
    done
    echo "${ifaces:-  No network interfaces found}"
}

# ── Mount the installation media ───────────────────────────────────
mount_iso() {
    for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
        [ -b "$dev" ] || continue
        mount -t iso9660 -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || \
            mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ] && return 0
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done
    for dev in /dev/sd*[0-9] /dev/vd*[0-9] /dev/nvme*p[0-9]*; do
        [ -b "$dev" ] || continue
        mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ] && return 0
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done
    return 1
}

load_payload_metadata() {
    local metadata_file="${ISO_MOUNT}/PAYLOAD-METADATA"
    [ -f "$metadata_file" ] || return 1

    PAYLOAD_MODE=$(sed -n 's/^PAYLOAD_MODE=//p' "$metadata_file" 2>/dev/null | head -1)
    PAYLOAD_BOOTABLE=$(sed -n 's/^PAYLOAD_BOOTABLE=//p' "$metadata_file" 2>/dev/null | head -1)
    PAYLOAD_LAYOUT=$(sed -n 's/^PAYLOAD_LAYOUT=//p' "$metadata_file" 2>/dev/null | head -1)
    PAYLOAD_BOOT_MODE=$(sed -n 's/^PAYLOAD_BOOT_MODE=//p' "$metadata_file" 2>/dev/null | head -1)
    [ -n "$PAYLOAD_MODE" ] || PAYLOAD_MODE="unknown"
    [ -n "$PAYLOAD_BOOTABLE" ] || PAYLOAD_BOOTABLE="unknown"
    [ -n "$PAYLOAD_LAYOUT" ] || PAYLOAD_LAYOUT="unknown"
    [ -n "$PAYLOAD_BOOT_MODE" ] || PAYLOAD_BOOT_MODE="unknown"
    return 0
}

get_iso_parent_disk() {
    local iso_dev=""
    iso_dev=$(grep " ${ISO_MOUNT} " /proc/mounts 2>/dev/null | awk '{print $1}' | head -1)
    [ -z "$iso_dev" ] && return
    iso_dev=$(basename "$iso_dev")
    echo "$iso_dev" | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//'
}

# ── Disk helpers ───────────────────────────────────────────────────
get_disks() {
    local iso_parent
    iso_parent=$(get_iso_parent_disk)
    for disk_path in /sys/block/sd* /sys/block/vd* /sys/block/nvme*; do
        [ -e "$disk_path" ] || continue
        local name=$(basename "$disk_path")
        case "$name" in sr*|loop*|ram*|zram*|dm-*|md*) continue ;; esac
        [ -n "$iso_parent" ] && [ "$name" = "$iso_parent" ] && continue
        local size_sectors=$(cat "${disk_path}/size" 2>/dev/null || echo 0)
        size_sectors=$(safe_uint "$size_sectors" 0)
        local size_gb=$(( size_sectors / 2097152 ))
        [ "$size_gb" -lt "$MIN_DISK_GB" ] && continue
        echo "$name"
    done
}

get_disk_size_gb() {
    local sz=$(cat "/sys/block/$1/size" 2>/dev/null || echo 0)
    sz=$(safe_uint "$sz" 0)
    echo $(( sz / 2097152 ))
}

get_disk_model() {
    cat "/sys/block/$1/device/model" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_vendor() {
    cat "/sys/block/$1/device/vendor" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_partitions() {
    local parts=0
    for p in /sys/block/$1/$1*; do [ -e "$p" ] && parts=$((parts + 1)); done
    echo "$parts"
}

get_disk_transport() {
    local link=$(readlink -f "/sys/block/$1" 2>/dev/null || true)
    case "$link" in
        *usb*)   echo "USB" ;;
        *ata*)   echo "SATA" ;;
        *nvme*)  echo "NVMe" ;;
        *virtio*) echo "VirtIO" ;;
        *scsi*)  echo "SCSI" ;;
        *)       echo "Unknown" ;;
    esac
}

disk_part_name() {
    case "$1" in
        nvme*|mmcblk*|loop*) echo "/dev/${1}p$2" ;;
        *) echo "/dev/${1}$2" ;;
    esac
}

has_mbr_boot_signature() {
    local sig=""
    sig=$(dd if="/dev/$1" bs=1 skip=510 count=2 2>/dev/null | od -An -tx1 | tr -d ' \n' || true)
    [ "$sig" = "55aa" ]
}

is_gpt_disk() {
    local disk="$1"
    if command -v sgdisk >/dev/null 2>&1; then
        sgdisk -p "/dev/${disk}" 2>/dev/null | grep -qi "GPT:" && return 0
    fi
    parted -s "/dev/${disk}" print 2>/dev/null | grep -qi "Partition Table: gpt"
}

find_installer_grub_install() {
    local candidate=""

    for candidate in /usr/sbin/grub-install /usr/bin/grub-install /sbin/grub-install /bin/grub-install; do
        [ -x "$candidate" ] && echo "$candidate" && return 0
    done

    candidate=$(command -v grub-install 2>/dev/null || true)
    [ -x "$candidate" ] && echo "$candidate" && return 0

    return 1
}

disk_has_existing_data() {
    local disk="$1"
    local parts=0
    parts=$(get_disk_partitions "$disk")
    parts=$(safe_uint "$parts" 0)
    [ "$parts" -gt 0 ] && return 0

    if command -v blkid >/dev/null 2>&1; then
        blkid "/dev/${disk}" >/dev/null 2>&1 && return 0
    fi

    if command -v wipefs >/dev/null 2>&1; then
        [ -n "$(wipefs -n "/dev/${disk}" 2>/dev/null)" ] && return 0
    fi

    return 1
}

target_has_bootloader() {
    local target="$1"
    [ -f "${target}/boot/grub/grub.cfg" ] && return 0
    [ -f "${target}/boot/grub2/grub.cfg" ] && return 0
    [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ] && return 0
    [ -f "${target}/boot/efi/EFI/ubuntu/grubx64.efi" ] && return 0
    [ -f "${target}/boot/efi/EFI/debian/grubx64.efi" ] && return 0
    [ -f "${target}/boot/extlinux/extlinux.conf" ] && return 0
    return 1
}

detect_target_root_partition() {
    local disk="$1"
    local p target_probe
    target_probe="/mnt/target-probe"
    mkdir -p "$target_probe"

    for p in $(seq 1 16); do
        local part fstype
        part=$(disk_part_name "$disk" "$p")
        [ -b "$part" ] || continue

        # Skip partitions that are almost certainly not root filesystems.
        if command -v blkid >/dev/null 2>&1; then
            fstype=$(blkid -s TYPE -o value "$part" 2>/dev/null || true)
            case "$fstype" in
                vfat|fat|msdos|iso9660|squashfs|swap)
                    continue
                    ;;
            esac
        fi

        mount "$part" "$target_probe" 2>/dev/null || continue
        if [ -f "${target_probe}/etc/os-release" ] || [ -x "${target_probe}/sbin/init" ] || [ -x "${target_probe}/bin/sh" ] || [ -f "${target_probe}/etc/passwd" ]; then
            umount "$target_probe" 2>/dev/null || true
            echo "$part"
            return 0
        fi
        umount "$target_probe" 2>/dev/null || true
    done

    return 1
}

# ── Disk repair & bootloader auto-repair ───────────────────────────────────
# Called unconditionally after every dd-write.
# Mirrors what Ubuntu/Debian installers do post-write:
#   1. GPT header repair (sgdisk -e / gdisk / parted fix)
#   2. Kernel partition table reload
#   3. EFI partition filesystem repair (dosfsck)
#   4. GRUB reinstall with freshly-read PARTUUIDs
#   5. grub.cfg rewrite with real PARTUUIDs from the target disk
#   6. UEFI fallback loader copy (EFI/BOOT/BOOTX64.EFI)
#   7. Log every step to /tmp/boot-repair.log
repair_disk_and_bootloader() {
    local disk="$1"
    local logfile="/tmp/boot-repair.log"
    : > "$logfile"

    log_r() { echo "[$(date '+%H:%M:%S')] $*" >> "$logfile"; }

    log_r "=== IORA Boot Repair ==="
    log_r "Target: /dev/${disk}"

    # ── Step 1: GPT header repair ───────────────────────────────────
    # When an 8 GB image is written to a larger disk the GPT backup
    # header is at the wrong offset. sgdisk -e relocates it to the
    # real disk end. Fall back to gdisk 'v' + 'w' if sgdisk missing.
    echo "  [1/7] GPT header repair..." >> "$logfile"
    if command -v sgdisk >/dev/null 2>&1; then
        sgdisk -e "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "sgdisk -e OK" \
            || log_r "sgdisk -e returned non-zero (may be ignorable)"
        sgdisk --verify "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "sgdisk verify OK" \
            || log_r "sgdisk verify: problems remain"
    elif command -v gdisk >/dev/null 2>&1; then
        # gdisk fallback: enter experts menu, relocate backup GPT header, write.
        printf 'x\ne\nm\nw\nY\n' | gdisk "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "gdisk expert fix OK" \
            || log_r "gdisk expert fix returned non-zero"
    else
        # parted can also rewrite GPT without questions
        parted -s "/dev/${disk}" print fix >> "$logfile" 2>&1 \
            && log_r "parted fix OK" \
            || log_r "parted fix returned non-zero"
        log_r "WARN: sgdisk not available; GPT backup-header may still be wrong"
    fi

    # ── Step 2: Re-read partition table ────────────────────────────
    echo "  [2/7] Refresh partition table..." >> "$logfile"
    sync
    blockdev --rereadpt "/dev/${disk}" >> "$logfile" 2>&1 || true
    partprobe "/dev/${disk}" >> "$logfile" 2>&1 || true
    sleep 2
    # Wait until expected partitions appear (up to 10 s)
    local waited=0
    while [ "$waited" -lt 10 ]; do
        local p2; p2=$(disk_part_name "$disk" 2)
        [ -b "$p2" ] && break
        sleep 1; waited=$((waited + 1))
    done
    log_r "Partition nodes present: $(ls /dev/${disk}* 2>/dev/null | tr '\n' ' ')"

    # ── Step 3: EFI filesystem repair ──────────────────────────────
    local efi_part; efi_part=$(disk_part_name "$disk" 2)
    echo "  [3/7] EFI partition fsck..." >> "$logfile"
    if [ -b "$efi_part" ]; then
        if command -v dosfsck >/dev/null 2>&1; then
            dosfsck -a -r "$efi_part" >> "$logfile" 2>&1 \
                && log_r "dosfsck OK" \
                || log_r "dosfsck: errors found (attempted auto-fix)"
        elif command -v fsck.vfat >/dev/null 2>&1; then
            fsck.vfat -a "$efi_part" >> "$logfile" 2>&1 \
                && log_r "fsck.vfat OK" \
                || log_r "fsck.vfat: errors found (attempted auto-fix)"
        else
            log_r "No vfat fsck available – skipping"
        fi
    else
        log_r "EFI partition ${efi_part} not found – skipping"
    fi

    # ── Step 4: Mount EFI + root ────────────────────────────────────
    echo "  [4/7] Mounting partitions..." >> "$logfile"
    local target="/mnt/repair-target"
    local efi_mounted=false
    local root_part=""
    root_part=$(detect_target_root_partition "$disk" 2>/dev/null || true)
    [ -z "$root_part" ] && root_part=$(disk_part_name "$disk" 3)

    # Ensure vfat driver is available for EFI partition
    modprobe vfat 2>/dev/null || true
    modprobe fat 2>/dev/null || true
    modprobe nls_cp437 2>/dev/null || true
    modprobe nls_iso8859_1 2>/dev/null || true
    modprobe nls_utf8 2>/dev/null || true

    mkdir -p "$target"

    if ! mount "$root_part" "$target" 2>>"$logfile"; then
        log_r "ERROR: cannot mount root partition ${root_part}"
        return 1
    fi
    log_r "Root mounted: ${root_part} → ${target}"

    mkdir -p "${target}/boot/efi" 2>/dev/null || true

    if [ -b "$efi_part" ]; then
        # Load vfat driver – may be a module or built-in
        modprobe vfat      2>/dev/null || true
        modprobe fat       2>/dev/null || true
        modprobe nls_cp437 2>/dev/null || true
        modprobe nls_utf8  2>/dev/null || true

        if mount -t vfat "$efi_part" "${target}/boot/efi" 2>>"$logfile" || \
           mount          "$efi_part" "${target}/boot/efi" 2>>"$logfile"; then
            efi_mounted=true
            log_r "EFI mounted: ${efi_part} → ${target}/boot/efi"
        else
            log_r "WARN: vfat mount failed – reformatting EFI partition to fix corrupted/unreadable filesystem"
            # If the vfat FS is unreadable (e.g. wrong offsets after image resize),
            # re-create it and reinstall GRUB from scratch.
            if command -v mkfs.vfat >/dev/null 2>&1 || command -v mkdosfs >/dev/null 2>&1; then
                local mkfscmd="mkdosfs"
                command -v mkfs.vfat >/dev/null 2>&1 && mkfscmd="mkfs.vfat"
                if ${mkfscmd} -F 32 -n EFI "$efi_part" >> "$logfile" 2>&1; then
                    log_r "EFI partition reformatted (FAT32)"
                    if mount -t vfat "$efi_part" "${target}/boot/efi" 2>>"$logfile"; then
                        efi_mounted=true
                        log_r "EFI mounted after reformat"
                    else
                        log_r "WARN: EFI mount still failing after reformat – UEFI boot may not work"
                    fi
                else
                    log_r "WARN: mkfs.vfat failed – EFI partition not accessible"
                fi
            else
                log_r "WARN: mkfs.vfat not available – cannot repair EFI partition"
                log_r "      Install dosfstools in the installer initramfs"
            fi
        fi
    fi

    # ── Step 5: Rewrite grub.cfg with real PARTUUIDs ────────────────
    echo "  [5/7] grub.cfg with real PARTUUIDs..." >> "$logfile"
    local puuid_a="" puuid_b=""
    local pa pb
    pa=$(disk_part_name "$disk" 3)
    pb=$(disk_part_name "$disk" 4)
    if [ -b "$pa" ]; then
        puuid_a=$(blkid -s PARTUUID -o value "$pa" 2>/dev/null || true)
    fi
    if [ -b "$pb" ]; then
        puuid_b=$(blkid -s PARTUUID -o value "$pb" 2>/dev/null || true)
    fi

    local root_a_ref="/dev/sda3"
    local root_b_ref="/dev/sda4"
    [ -n "$puuid_a" ] && root_a_ref="PARTUUID=${puuid_a}"
    [ -n "$puuid_b" ] && root_b_ref="PARTUUID=${puuid_b}"

    log_r "Root-A: ${root_a_ref}  Root-B: ${root_b_ref}"

    # Prefer kernel under rootfs /boot; keep /vmlinuz fallback for legacy layouts.
    local kernel_path="/boot/vmlinuz"
    if [ ! -f "${target}/boot/vmlinuz" ] && [ -f "${target}/vmlinuz" ]; then
        kernel_path="/vmlinuz"
    elif [ ! -f "${target}/boot/vmlinuz" ] && [ -f "${target}/boot/bzImage" ]; then
        kernel_path="/boot/bzImage"
    fi
    log_r "Kernel: ${kernel_path}"

    mkdir -p "${target}/boot/grub"
    cat > "${target}/boot/grub/grub.cfg" <<GRUBCFG
set default=0
set timeout=5

menuentry "IORA OS" {
    search --no-floppy --partuuid ${puuid_a:-00000000-0000-0000-0000-000000000000} --set=root 2>/dev/null || true
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${root_a_ref} rootwait ro rootfstype=ext4 nomodeset quiet
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${root_a_ref} rootwait ro rootfstype=ext4 nomodeset quiet
    elif [ -f /boot/bzImage ]; then
        linux /boot/bzImage root=${root_a_ref} rootwait ro rootfstype=ext4 nomodeset quiet
    fi
}

menuentry "IORA OS (second slot)" {
    search --no-floppy --partuuid ${puuid_b:-00000000-0000-0000-0000-000000000000} --set=root 2>/dev/null || true
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${root_b_ref} rootwait ro rootfstype=ext4 nomodeset quiet
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${root_b_ref} rootwait ro rootfstype=ext4 nomodeset quiet
    elif [ -f /boot/bzImage ]; then
        linux /boot/bzImage root=${root_b_ref} rootwait ro rootfstype=ext4 nomodeset quiet
    fi
}

menuentry "IORA OS Recovery" {
    search --no-floppy --partuuid ${puuid_a:-00000000-0000-0000-0000-000000000000} --set=root 2>/dev/null || true
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${root_a_ref} rootwait rw rootfstype=ext4 nomodeset init=/bin/sh
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${root_a_ref} rootwait rw rootfstype=ext4 nomodeset init=/bin/sh
    elif [ -f /boot/bzImage ]; then
        linux /boot/bzImage root=${root_a_ref} rootwait rw rootfstype=ext4 nomodeset init=/bin/sh
    fi
}
GRUBCFG
    log_r "grub.cfg written"

    # Copy grub.cfg also to EFI boot directory for UEFI GRUB
    if [ "$efi_mounted" = true ]; then
        mkdir -p "${target}/boot/efi/boot/grub" 2>/dev/null || true
        cp "${target}/boot/grub/grub.cfg" "${target}/boot/efi/boot/grub/grub.cfg" 2>/dev/null || true
    fi

    # ── Step 6: bind-mount proc/dev/sys and (re)install GRUB ───────
    echo "  [6/7] GRUB reinstall..." >> "$logfile"
    local did_bind=false
    local bios_ok=false uefi_ok=false

    mkdir -p "${target}/dev" "${target}/proc" "${target}/sys" "${target}/run"
    if mount --bind /dev  "${target}/dev"  2>/dev/null && \
       mount --bind /proc "${target}/proc" 2>/dev/null && \
       mount --bind /sys  "${target}/sys"  2>/dev/null && \
       mount --bind /run  "${target}/run"  2>/dev/null; then
        did_bind=true
    fi

    local installer_grub_install=""
    installer_grub_install=$(find_installer_grub_install || true)

    if chroot "$target" /bin/sh -c "command -v grub-install >/dev/null 2>&1" 2>/dev/null; then
        # BIOS (i386-pc)
        if chroot "$target" /bin/sh -c \
            "grub-install --target=i386-pc --recheck --no-floppy /dev/${disk}" \
            >> "$logfile" 2>&1; then
            bios_ok=true; log_r "grub-install i386-pc OK"
        else
            log_r "grub-install i386-pc failed (may be UEFI-only system)"
        fi
        # UEFI (x86_64-efi)
        if [ "$efi_mounted" = true ] && [ -d /sys/firmware/efi ]; then
            if chroot "$target" /bin/sh -c \
                "grub-install --target=x86_64-efi --efi-directory=/boot/efi --boot-directory=/boot --removable --recheck /dev/${disk}" \
                >> "$logfile" 2>&1; then
                uefi_ok=true; log_r "grub-install x86_64-efi OK"
            else
                log_r "grub-install x86_64-efi failed"
            fi
        fi
        # grub-mkconfig
        chroot "$target" /bin/sh -c \
            "command -v grub-mkconfig >/dev/null 2>&1 && grub-mkconfig -o /boot/grub/grub.cfg" \
            >> "$logfile" 2>&1 || true
        log_r "grub-mkconfig done"
    elif [ -n "$installer_grub_install" ]; then
        log_r "grub-install not found in target; using installer copy: ${installer_grub_install}"
        if "$installer_grub_install" --target=i386-pc --boot-directory="${target}/boot" --recheck --no-floppy "/dev/${disk}" >> "$logfile" 2>&1; then
            bios_ok=true; log_r "installer grub-install i386-pc OK"
        else
            log_r "installer grub-install i386-pc failed"
        fi

        if [ "$efi_mounted" = true ] && [ -d /sys/firmware/efi ]; then
            if "$installer_grub_install" --target=x86_64-efi --efi-directory="${target}/boot/efi" --boot-directory="${target}/boot" --removable --recheck "/dev/${disk}" >> "$logfile" 2>&1; then
                uefi_ok=true; log_r "installer grub-install x86_64-efi OK"
            else
                log_r "installer grub-install x86_64-efi failed"
            fi
        fi
    else
        log_r "WARN: grub-install not found in target or installer – using pre-written grub.cfg only"
    fi

    # ── Step 7: UEFI fallback loader ────────────────────────────────
    echo "  [7/7] UEFI fallback loader..." >> "$logfile"
    if [ "$efi_mounted" = true ]; then
        mkdir -p "${target}/boot/efi/EFI/BOOT" 2>/dev/null || true
        local efi_src=""
        for _candidate in \
            "${target}/boot/efi/EFI/ubuntu/grubx64.efi" \
            "${target}/boot/efi/EFI/debian/grubx64.efi" \
            "${target}/boot/efi/EFI/grub/grubx64.efi" \
            "${target}/boot/efi/EFI/GRUB/grubx64.efi"; do
            [ -f "$_candidate" ] && efi_src="$_candidate" && break
        done
        if [ -n "$efi_src" ] && [ ! -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ]; then
            cp -f "$efi_src" "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" 2>>"$logfile" \
                && log_r "BOOTX64.EFI copied from ${efi_src}" \
                || log_r "WARN: BOOTX64.EFI copy failed"
        elif [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ]; then
            log_r "BOOTX64.EFI already present"
        else
            log_r "WARN: No grubx64.efi source found for UEFI fallback"
        fi

        # Presence of a removable UEFI loader is sufficient for UEFI boot attempt.
        if [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ] && [ -d /sys/firmware/efi ]; then
            uefi_ok=true
        fi

        # efibootmgr: register IORA OS boot entry if running in UEFI installer
        if command -v efibootmgr >/dev/null 2>&1 && [ -d /sys/firmware/efi ]; then
            local efi_disk_part; efi_disk_part=$(basename "$efi_part")
            local efi_part_num; efi_part_num=$(echo "$efi_disk_part" | grep -o '[0-9]*$')
            efibootmgr --create --disk "/dev/${disk}" \
                --part "$efi_part_num" \
                --label "IORA OS" \
                --loader "\\EFI\\BOOT\\BOOTX64.EFI" \
                >> "$logfile" 2>&1 \
                && log_r "efibootmgr entry created" \
                || log_r "efibootmgr failed (non-fatal)"
        fi
    fi

    # ── Cleanup ─────────────────────────────────────────────────────
    [ "$efi_mounted" = true ] && umount "${target}/boot/efi" 2>/dev/null || true
    if [ "$did_bind" = true ]; then
        umount "${target}/run"  2>/dev/null || true
        umount "${target}/sys"  2>/dev/null || true
        umount "${target}/proc" 2>/dev/null || true
        umount "${target}/dev"  2>/dev/null || true
    fi
    sync
    umount "$target" 2>/dev/null || true

    # Only toggle active flag on DOS/MBR disks. Doing this on GPT mutates the PMBR
    # and creates warnings that can break EFI implementations.
    if ! is_gpt_disk "$disk"; then
        sfdisk --activate "/dev/${disk}" 1 >> "$logfile" 2>&1 \
            || parted -s "/dev/${disk}" set 1 boot on >> "$logfile" 2>&1 \
            || true
    else
        log_r "Skipping active-flag changes on GPT disk"
    fi

    # Final GPT verify
    if command -v sgdisk >/dev/null 2>&1; then
        sgdisk --verify "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "Final GPT verify: OK" \
            || log_r "Final GPT verify: issues remain (check log)"
    fi

    # If BIOS grub-install wasn't possible, but GPT has a BIOS boot partition,
    # keep BIOS status as possible because the dd-written image may already
    # contain embedded core.img from post-image creation.
    if [ "$bios_ok" = false ] && is_gpt_disk "$disk" && command -v sgdisk >/dev/null 2>&1; then
        if sgdisk -i 1 "/dev/${disk}" 2>/dev/null | grep -qi "EF02\|BIOS boot"; then
            bios_ok=true
            log_r "BIOS boot partition detected (EF02); BIOS boot may be available"
        fi
    fi

    log_r "=== Boot repair complete ==="
    log_r "BIOS-boot: ${bios_ok}  UEFI-boot: ${uefi_ok}"
    return 0
}

install_bootloader_fallback() {
    local disk="$1"
    local target="$2"
    local did_bind=false
    local efi_part=""
    local efi_mounted=false
    local bios_install_ok=false
    local uefi_install_ok=false
    local efi_has_loader=false
    local target_has_grub_install=false
    local boot_ok=1
    efi_part=$(disk_part_name "$disk" 2)

    mkdir -p "${target}/dev" "${target}/proc" "${target}/sys" "${target}/run" "${target}/boot/efi"
    mount --bind /dev "${target}/dev" 2>/dev/null || true
    mount --bind /proc "${target}/proc" 2>/dev/null || true
    mount --bind /sys "${target}/sys" 2>/dev/null || true
    mount --bind /run "${target}/run" 2>/dev/null || true
    did_bind=true

    if [ -b "$efi_part" ]; then
        modprobe vfat 2>/dev/null || true
        modprobe fat  2>/dev/null || true
        mount -t vfat "$efi_part" "${target}/boot/efi" 2>/dev/null && efi_mounted=true || \
        mount          "$efi_part" "${target}/boot/efi" 2>/dev/null && efi_mounted=true || true
    fi

    if chroot "$target" /bin/sh -c "command -v grub-install >/dev/null 2>&1" >/dev/null 2>&1; then
        target_has_grub_install=true

        if chroot "$target" /bin/sh -c "grub-install --target=i386-pc --recheck /dev/${disk}" >/dev/null 2>&1; then
            bios_install_ok=true
        fi

        if [ "$efi_mounted" = true ] && [ -d /sys/firmware/efi ]; then
            if chroot "$target" /bin/sh -c "grub-install --target=x86_64-efi --efi-directory=/boot/efi --boot-directory=/boot --removable --recheck" >/dev/null 2>&1; then
                uefi_install_ok=true
            fi
        fi

        chroot "$target" /bin/sh -c "command -v grub-mkconfig >/dev/null 2>&1 && grub-mkconfig -o /boot/grub/grub.cfg >/dev/null 2>&1 || true" >/dev/null 2>&1 || true
    fi

    # BIOS fallback: only set active flag on DOS/MBR disks. GPT uses bios_grub/ESP instead.
    if ! is_gpt_disk "$disk"; then
        sfdisk --activate "/dev/${disk}" 1 2>/dev/null || parted -s "/dev/${disk}" set 1 boot on 2>/dev/null || true
    fi

    # Keep removable-path fallback for UEFI firmware lookups.
    if [ "$efi_mounted" = true ]; then
        mkdir -p "${target}/boot/efi/EFI/BOOT" 2>/dev/null || true
        if [ -f "${target}/boot/efi/EFI/ubuntu/grubx64.efi" ] && [ ! -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ]; then
            cp -f "${target}/boot/efi/EFI/ubuntu/grubx64.efi" "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" 2>/dev/null || true
        elif [ -f "${target}/boot/efi/EFI/debian/grubx64.efi" ] && [ ! -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ]; then
            cp -f "${target}/boot/efi/EFI/debian/grubx64.efi" "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" 2>/dev/null || true
        fi

        if [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ] || [ -f "${target}/boot/efi/EFI/ubuntu/grubx64.efi" ] || [ -f "${target}/boot/efi/EFI/debian/grubx64.efi" ]; then
            efi_has_loader=true
        fi
    fi

    if [ "$efi_mounted" = true ]; then
        umount "${target}/boot/efi" 2>/dev/null || true
    fi
    if [ "$did_bind" = true ]; then
        umount "${target}/run" 2>/dev/null || true
        umount "${target}/sys" 2>/dev/null || true
        umount "${target}/proc" 2>/dev/null || true
        umount "${target}/dev" 2>/dev/null || true
    fi

    if target_has_bootloader "$target" || [ "$bios_install_ok" = true ] || [ "$uefi_install_ok" = true ] || [ "$efi_has_loader" = true ]; then
        boot_ok=0
    elif [ "$target_has_grub_install" = false ]; then
        boot_ok=1
    fi

    return "$boot_ok"
}

# ── Post-install configuration ─────────────────────────────────────
apply_post_install_config() {
    local disk="$1"
    local target="/mnt/target"

    dlg_info " Configuring " "  Applying settings..."

    # Probe partitions to find the installed root filesystem.
    local root_part=""
    root_part=$(detect_target_root_partition "$disk" 2>/dev/null || true)
    [ -z "$root_part" ] && root_part=$(disk_part_name "$disk" 3)
    [ -b "$root_part" ] || root_part=""

    if [ -z "$root_part" ]; then
        return 0  # skip silently if partition layout differs
    fi

    mkdir -p "$target"
    if ! mount "$root_part" "$target" 2>/dev/null; then
        return 0
    fi

    # Set hostname
    if [ -n "$IORA_HOSTNAME" ] && [ "$IORA_HOSTNAME" != "iora" ]; then
        echo "$IORA_HOSTNAME" > "${target}/etc/hostname" 2>/dev/null || true
        if [ -f "${target}/etc/hosts" ]; then
            sed -i "s/iora/${IORA_HOSTNAME}/g" "${target}/etc/hosts" 2>/dev/null || true
        fi
    fi

    # Set timezone
    if [ -n "$IORA_TIMEZONE" ] && [ -f "${target}/usr/share/zoneinfo/${IORA_TIMEZONE}" ]; then
        ln -sf "/usr/share/zoneinfo/${IORA_TIMEZONE}" "${target}/etc/localtime" 2>/dev/null || true
        echo "$IORA_TIMEZONE" > "${target}/etc/timezone" 2>/dev/null || true
    fi

    # Set root password if changed
    if [ -n "$IORA_ROOT_PW" ]; then
        local salt=$(head -c 16 /dev/urandom 2>/dev/null | od -A n -t x1 | tr -d ' \n' | head -c 16)
        local hash=$(echo "$IORA_ROOT_PW" | openssl passwd -6 -stdin -salt "$salt" 2>/dev/null || true)
        if [ -n "$hash" ] && [ -f "${target}/etc/shadow" ]; then
            sed -i "s|^root:[^:]*:|root:${hash}:|" "${target}/etc/shadow" 2>/dev/null || true
        fi
    fi

    # Configure static network if chosen
    if [ "$IORA_NETWORK" = "static" ] && [ -n "$IORA_IP" ]; then
        mkdir -p "${target}/etc/systemd/network" 2>/dev/null || true
        cat > "${target}/etc/systemd/network/10-static.network" <<NETEOF
[Match]
Name=eth* en*

[Network]
Address=${IORA_IP}/${IORA_NETMASK:-24}
Gateway=${IORA_GATEWAY:-}
DNS=${IORA_DNS:-8.8.8.8}
NETEOF
    fi

    # Locale / keyboard defaults similar to common installers
    if [ -n "$IORA_LOCALE" ]; then
        mkdir -p "${target}/etc" 2>/dev/null || true
        if [ -f "${target}/etc/locale.conf" ] || [ ! -f "${target}/etc/default/locale" ]; then
            echo "LANG=${IORA_LOCALE}" > "${target}/etc/locale.conf" 2>/dev/null || true
        fi
        mkdir -p "${target}/etc/default" 2>/dev/null || true
        echo "LANG=${IORA_LOCALE}" > "${target}/etc/default/locale" 2>/dev/null || true
    fi

    if [ -n "$IORA_KEYBOARD" ]; then
        mkdir -p "${target}/etc" 2>/dev/null || true
        echo "KEYMAP=${IORA_KEYBOARD}" > "${target}/etc/vconsole.conf" 2>/dev/null || true
        mkdir -p "${target}/etc/default" 2>/dev/null || true
        cat > "${target}/etc/default/keyboard" <<KBDCONF
XKBMODEL="pc105"
XKBLAYOUT="${IORA_KEYBOARD}"
XKBVARIANT=""
XKBOPTIONS=""
BACKSPACE="guess"
KBDCONF
    fi

    local efi_part=""
    local efi_mounted=false
    efi_part=$(disk_part_name "$disk" 2)
    if [ -b "$efi_part" ]; then
        modprobe vfat 2>/dev/null || true
        modprobe fat  2>/dev/null || true
        mkdir -p "${target}/boot/efi" 2>/dev/null || true
        if mount -t vfat "$efi_part" "${target}/boot/efi" 2>/dev/null || \
           mount "$efi_part" "${target}/boot/efi" 2>/dev/null; then
            efi_mounted=true
        fi
    fi

    # Detect existing bootloader in the installed system; install only if missing.
    if target_has_bootloader "$target"; then
        dlg_info " Boot " "  Bootloader found."
    else
        dlg_info " Boot " "  No bootloader found. Installing..."
        if install_bootloader_fallback "$disk" "$target"; then
            dlg_info " Boot " "  Bootloader installed."
        else
            dlg_info " Boot " "  Bootloader install could not be confirmed."
        fi
    fi

    if [ "$efi_mounted" = true ]; then
        umount "${target}/boot/efi" 2>/dev/null || true
    fi

    sync
    umount "$target" 2>/dev/null || true
    return 0
}

# ── Wizard screens ─────────────────────────────────────────────────

screen_welcome() {
    if [ -n "$DIALOG_BIN" ]; then
                dlg --title " IORA OS Setup " --msgbox "\
 Ready to deploy IORA OS.

 This guided setup will:
     1. Inspect this system
     2. Configure hostname and timezone
     3. Configure network settings
     4. Set the root password
     5. Write the image to the selected drive

 Expect the installation itself to take a few minutes.
 All data on the selected target drive will be erased.

 Select OK to continue." 18 68
    else
        clear 2>/dev/null || true
        echo ""
                echo "  IORA OS Setup"
                echo "  ============="
        echo ""
        echo "  Press ENTER to begin..."
        read _
    fi
}

screen_sysinfo() {
    [ -z "$DIALOG_BIN" ] && return 0

    local cpu=$(get_cpu_info)
    local ram=$(get_ram_info)
    local boot=$(get_boot_mode)
    local net=$(get_network_interfaces)

    local ver_line=""
    if [ -f "${ISO_MOUNT}/VERSION" ]; then
        ver_line=$(head -3 "${ISO_MOUNT}/VERSION" 2>/dev/null | tr '\n' ' ')
    fi

    dlg --title " System Information " --msgbox "\
 Hardware
 --------
 CPU:       ${cpu}
 Memory:    ${ram}
 Boot:      ${boot}

 Network Interfaces
 ------------------
${net}
 Image
 -----
 Package:   Installation payload (${img_size})
 Layout:    ${PAYLOAD_LAYOUT}
 ${ver_line}" 22 64
}

screen_hostname() {
    if [ -z "$DIALOG_BIN" ]; then
        while true; do
            printf "  Hostname [iora]: "; read ans
            ans="${ans:-iora}"
            if valid_hostname "$ans"; then
                IORA_HOSTNAME="$ans"
                return 0
            fi
            echo "  Invalid hostname. Use only letters, numbers, and hyphens."
        done
    fi

    while true; do
        local result
        result=$(dlg --title " Hostname " --inputbox \
            "\n Choose a hostname for this device.\n\n Allowed: letters, numbers, hyphens.\n" \
            12 60 "$IORA_HOSTNAME" 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 0

        if valid_hostname "$result"; then
            IORA_HOSTNAME="$result"
            return 0
        fi

        dlg_msg " Invalid Hostname " "Use only letters, numbers, and hyphens."
    done
}

screen_timezone() {
    [ -z "$DIALOG_BIN" ] && return 0

    local tz
    tz=$(dlg --title " Timezone " --menu \
        "\n Select the system timezone.\n" 20 60 10 \
        "Europe/Berlin"    "Germany" \
        "Europe/Vienna"    "Austria" \
        "Europe/Zurich"    "Switzerland" \
        "Europe/London"    "United Kingdom" \
        "Europe/Paris"     "France" \
        "Europe/Amsterdam" "Netherlands" \
        "Europe/Rome"      "Italy" \
        "Europe/Madrid"    "Spain" \
        "US/Eastern"       "US East Coast" \
        "US/Pacific"       "US West Coast" \
        "UTC"              "Coordinated Universal Time" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$tz" ] && IORA_TIMEZONE="$tz"
}

screen_locale() {
    [ -z "$DIALOG_BIN" ] && return 0

    local locale
    locale=$(dlg --title " Language " --menu \
        "\n Select the system language/locale.\n" 18 60 8 \
        "de_DE.UTF-8" "German" \
        "en_US.UTF-8" "English (US)" \
        "en_GB.UTF-8" "English (UK)" \
        "fr_FR.UTF-8" "French" \
        "es_ES.UTF-8" "Spanish" \
        "it_IT.UTF-8" "Italian" \
        "nl_NL.UTF-8" "Dutch" \
        "pl_PL.UTF-8" "Polish" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$locale" ] && IORA_LOCALE="$locale"
}

screen_keyboard() {
    [ -z "$DIALOG_BIN" ] && return 0

    local kb
    kb=$(dlg --title " Keyboard Layout " --menu \
        "\n Select the keyboard layout.\n" 16 60 7 \
        "de" "German" \
        "us" "English (US)" \
        "gb" "English (UK)" \
        "fr" "French" \
        "es" "Spanish" \
        "it" "Italian" \
        "nl" "Dutch" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$kb" ] && IORA_KEYBOARD="$kb"
}

screen_installation_type() {
    [ -z "$DIALOG_BIN" ] && return 0

    local mode
    mode=$(dlg --title " Installation Type " --menu \
        "\n Choose installation type.\n" 15 64 3 \
        "guided" "Guided - erase selected disk and install" \
        "guided-safe" "Guided - ask extra confirmation before erase" \
        "shell" "Manual - drop to shell for custom partitioning" \
        3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    IORA_INSTALL_MODE="$mode"
    if [ "$mode" = "shell" ]; then
        dlg_msg " Manual Mode " "\
 You selected manual mode.\n\n\
 The installer will return to shell now.\n\n\
 After preparing disks manually, run 'install' again."
        return 1
    fi
    return 0
}

screen_network() {
    [ -z "$DIALOG_BIN" ] && return 0

    local mode
    mode=$(dlg --title " Network " --menu \
        "\n Choose how IORA OS should configure networking.\n" 15 60 3 \
        "dhcp"   "Automatic via DHCP" \
        "static" "Manual IPv4 configuration" \
        "skip"   "Leave networking unchanged" \
        3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    IORA_NETWORK="$mode"

    if [ "$mode" = "static" ]; then
        while true; do
            IORA_IP=$(dlg --title " Static IPv4 " --inputbox \
                "\n Enter the IPv4 address for this device.\n" \
                10 60 "${IORA_IP:-192.168.1.100}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_IP" && break
            dlg_msg " Invalid Address " "Enter a valid IPv4 address such as 192.168.1.100."
        done

        while true; do
            IORA_NETMASK=$(dlg --title " Prefix Length " --inputbox \
                "\n Enter the subnet prefix length.\n Example: 24\n" \
                10 60 "${IORA_NETMASK:-24}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_prefix_length "$IORA_NETMASK" && break
            dlg_msg " Invalid Prefix " "Enter a number between 1 and 32."
        done

        while true; do
            IORA_GATEWAY=$(dlg --title " Gateway " --inputbox \
                "\n Enter the default gateway IPv4 address.\n" \
                10 60 "${IORA_GATEWAY:-192.168.1.1}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_GATEWAY" && break
            dlg_msg " Invalid Gateway " "Enter a valid IPv4 address such as 192.168.1.1."
        done

        while true; do
            IORA_DNS=$(dlg --title " DNS Server " --inputbox \
                "\n Enter the preferred DNS server IPv4 address.\n" \
                10 60 "${IORA_DNS:-8.8.8.8}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_DNS" && break
            dlg_msg " Invalid DNS " "Enter a valid IPv4 address such as 8.8.8.8."
        done
    fi
}

screen_password() {
    [ -z "$DIALOG_BIN" ] && return 0

    local pw1 pw2

    pw1=$(dlg --title " Root Password " --insecure --passwordbox \
        "\n Set a new root password.\n Leave this blank to keep the default.\n" \
        12 60 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0
    [ -z "$pw1" ] && return 0

    pw2=$(dlg --title " Confirm Password " --insecure --passwordbox \
        "\n Enter the password again for verification.\n" \
        10 60 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    if [ "$pw1" != "$pw2" ]; then
        dlg_msg " Password Mismatch " "The passwords do not match. The default password will remain active."
        return 0
    fi

    IORA_ROOT_PW="$pw1"
}

screen_select_disk() {
    local disk_list
    disk_list=$(get_disks)

    if [ -z "$disk_list" ]; then
        dlg_msg " Error " "\
 No suitable target disks found.\n\n\
 IORA OS requires at least ${MIN_DISK_GB} GB.\n\n\
 Connect a disk and type 'install' to retry."
        return 1
    fi

    if [ -n "$DIALOG_BIN" ]; then
        local disk_count=0
        set --
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            local bus=$(get_disk_transport "$disk")
            local label="${sz}GB ${bus}"
            [ -n "$mdl" ] && label="${label} - ${mdl}"
            set -- "$@" "/dev/${disk}" "$label"
            disk_count=$((disk_count + 1))
        done

        local menu_h=$((disk_count + 12))
        [ "$menu_h" -gt 22 ] && menu_h=22

        SEL_DISK=$(dlg --title " Installation Target " \
            --menu "\n Payload size: ${img_size}\n\n Select the drive that should receive the system.\n All existing data on the selected drive will be erased.\n" \
            "$menu_h" 64 "$disk_count" \
            "$@" \
            3>&1 1>&2 2>&3)

        [ $? -ne 0 ] && return 1
        SEL_DISK=$(basename "$SEL_DISK")
    else
        echo ""
        echo "  === Select Target Disk ==="
        echo ""
        local i=1 disk_array=""
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
        if ! is_uint "$choice" || [ "$choice" -lt 1 ] || [ "$choice" -gt "$disk_count" ]; then
            return 1
        fi
        SEL_DISK=$(printf '%s\n' $disk_array | sed -n "${choice}p")
        [ -z "$SEL_DISK" ] && return 1
    fi
    return 0
}

screen_confirm() {
    local disk="$SEL_DISK"
    local sz=$(get_disk_size_gb "$disk")
    local mdl=$(get_disk_model "$disk")
    local vendor=$(get_disk_vendor "$disk")
    local parts=$(get_disk_partitions "$disk")
    local bus=$(get_disk_transport "$disk")
    parts=$(safe_uint "$parts" 0)

    local summary="Target Disk\n"
    summary="${summary}  Device:     /dev/${disk}\n"
    summary="${summary}  Size:       ${sz} GB\n"
    summary="${summary}  Bus:        ${bus}\n"
    [ -n "$mdl" ] && summary="${summary}  Model:      ${mdl}\n"
    [ -n "$vendor" ] && summary="${summary}  Vendor:     ${vendor}\n"
    [ "$parts" -gt 0 ] && summary="${summary}  Partitions: ${parts} (will be erased)\n"

    summary="${summary}\nSystem Settings\n"
    summary="${summary}  Hostname:   ${IORA_HOSTNAME}\n"
    summary="${summary}  Timezone:   ${IORA_TIMEZONE}\n"
    summary="${summary}  Locale:     ${IORA_LOCALE}\n"
    summary="${summary}  Keyboard:   ${IORA_KEYBOARD}\n"
    if [ "$IORA_NETWORK" = "static" ]; then
        summary="${summary}  Network:    Static (${IORA_IP}/${IORA_NETMASK})\n"
    else
        summary="${summary}  Network:    DHCP (automatic)\n"
    fi
    if [ -n "$IORA_ROOT_PW" ]; then
        summary="${summary}  Password:   (custom)\n"
    else
        summary="${summary}  Password:   (default)\n"
    fi

    summary="${summary}\n +------------------------------------+"
    summary="${summary}\n |  WARNING: ALL data on /dev/${disk}    |"
    summary="${summary}\n |  will be permanently ERASED!       |"
    summary="${summary}\n +------------------------------------+"
    summary="${summary}\n\n Proceed with installation?"

    if ! dlg_yesno " Confirm " "$summary"; then
        return 1
    fi
    return 0
}

screen_install() {
    local disk="$SEL_DISK"

    # Unmount any partitions on target
    for part in /dev/${disk}*; do
        [ -b "$part" ] && umount "$part" 2>/dev/null || true
    done

    if [ -n "$DIALOG_BIN" ]; then
        (
            echo "2"
            echo "XXX"
            echo "  Preparing drive /dev/${disk}..."
            echo "XXX"
            dd if=/dev/zero of="/dev/${disk}" bs=1M count=1 >/dev/null 2>&1
            sleep 1

            echo "5"
            echo "XXX"
            echo "  Writing operating system to /dev/${disk}..."
            echo "  This may take a few minutes."
            echo "XXX"

            local img_bytes
            img_bytes=$(xz --robot --list "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '/^totals/{print $5}' || echo 0)
            img_bytes=$(safe_uint "$img_bytes" 0)
            [ "$img_bytes" -eq 0 ] && img_bytes=2000000000

            xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${disk}" bs=4M conv=fsync 2>/tmp/dd_progress &
            local dd_pid=$!

            local written=0 pct=5 ticks=0
            local start_written_sectors=0
            local now_written_sectors=0
            start_written_sectors=$(awk '{print $7}' "/sys/block/${disk}/stat" 2>/dev/null || echo 0)
            start_written_sectors=$(safe_uint "$start_written_sectors" 0)
            while kill -0 "$dd_pid" 2>/dev/null; do
                sleep 1
                # Read sector writes directly from kernel block stats for reliable progress.
                if [ -f "/sys/block/${disk}/stat" ]; then
                    now_written_sectors=$(awk '{print $7}' "/sys/block/${disk}/stat" 2>/dev/null || echo 0)
                    now_written_sectors=$(safe_uint "$now_written_sectors" 0)
                    if [ "$now_written_sectors" -gt "$start_written_sectors" ]; then
                        written=$(( (now_written_sectors - start_written_sectors) * 512 ))
                    fi
                fi

                # Fallback: parse dd stderr when no block stat progress is available.
                if [ "$written" -eq 0 ] && [ -f /tmp/dd_progress ]; then
                    local fb
                    fb=$(grep -o '[0-9][0-9]* bytes' /tmp/dd_progress 2>/dev/null | tail -1 | awk '{print $1}')
                    fb=$(safe_uint "$fb" 0)
                    [ "$fb" -gt 0 ] && written=$fb
                fi
                # Percentage; if bytes unknown, animate steadily forward
                if [ "$img_bytes" -gt 0 ] && [ "$written" -gt 0 ]; then
                    pct=$((5 + written * 74 / img_bytes))
                    [ "$pct" -gt 79 ] && pct=79
                else
                    ticks=$((ticks + 1))
                    pct=$((5 + ticks * 2))
                    [ "$pct" -gt 79 ] && pct=79
                fi
                echo "$pct"
            done
            wait "$dd_pid"
            local dd_rc=$?

            if [ "$dd_rc" -ne 0 ]; then
                echo "$dd_rc" > /tmp/install_result
                echo "100"; echo "XXX"; echo "  Write failed."; echo "XXX"
                exit 1
            fi

            echo "82"
            echo "XXX"
            echo "  Saving write buffer..."
            echo "XXX"
            sync
            sleep 1

            echo "84"
            echo "XXX"
            echo "  Repairing GPT partition header..."
            echo "  (required when image is smaller than target disk)"
            echo "XXX"
            # ── GPT backup-header repair ──────────────────────────────────
            # After dd-writing an 8 GB image onto a larger disk the GPT
            # secondary header sits at the wrong offset. Move it.
            if command -v sgdisk >/dev/null 2>&1; then
                sgdisk -e "/dev/${disk}" >/dev/null 2>&1 || true
                sgdisk --verify "/dev/${disk}" >/dev/null 2>&1 || true
            elif command -v gdisk >/dev/null 2>&1; then
                printf 'v\nw\nY\n' | gdisk "/dev/${disk}" >/dev/null 2>&1 || true
            else
                parted -s "/dev/${disk}" print fix >/dev/null 2>&1 || true
            fi

            echo "87"
            echo "XXX"
            echo "  Refreshing partition table..."
            echo "XXX"
            sync
            blockdev --rereadpt "/dev/${disk}" >/dev/null 2>&1 || true
            partprobe "/dev/${disk}" >/dev/null 2>&1 || true
            sleep 3

            echo "90"
            echo "XXX"
            echo "  Applying system settings..."
            echo "XXX"
            echo "0" > /tmp/install_result

            echo "93"
            echo "XXX"
            echo "  Repairing bootloader..."
            echo "  This ensures the system can boot correctly."
            echo "XXX"
            repair_disk_and_bootloader "${disk}" >/dev/null 2>&1 || true

            echo "97"
            echo "XXX"
            echo "  Finalizing..."
            echo "XXX"
            sync
            sleep 1

            echo "100"
            echo "XXX"
            echo "  Installation complete."
            echo "XXX"
        ) | dlg --title " Writing to Drive " --gauge \
            "  Starting..." 10 64 0

        local result=$(cat /tmp/install_result 2>/dev/null || echo 1)
        result=$(safe_uint "$result" 1)

        if [ "$result" -eq 0 ]; then
            repair_disk_and_bootloader "$disk" || true
            apply_post_install_config "$disk"
            # Show repair log summary if there were warnings
            if [ -n "$DIALOG_BIN" ] && [ -f /tmp/boot-repair.log ]; then
                if grep -qi "WARN\|ERROR\|failed" /tmp/boot-repair.log 2>/dev/null; then
                    # Use textbox for proper scrollable log display (avoids text cramming)
                    dlg --title " Boot Repair Summary " --textbox /tmp/boot-repair.log 22 78 || true
                fi
            fi
            return 0
        else
            dlg_msg " Failed " "\
 The drive could not be written.\n\n Verify the drive is connected and retry."
            return 1
        fi
    else
        echo ""
        echo "  Writing image to /dev/${disk}..."
        echo ""
        if xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${disk}" bs=4M status=progress conv=fsync 2>&1; then
            sync
            echo "  Repairing GPT header..."
            if command -v sgdisk >/dev/null 2>&1; then
                sgdisk -e "/dev/${disk}" 2>/dev/null || true
            elif command -v gdisk >/dev/null 2>&1; then
                printf 'v\nw\nY\n' | gdisk "/dev/${disk}" 2>/dev/null || true
            else
                parted -s "/dev/${disk}" print fix 2>/dev/null || true
            fi
            blockdev --rereadpt "/dev/${disk}" 2>/dev/null || true
            partprobe "/dev/${disk}" 2>/dev/null || true
            sleep 3
            echo "  Repairing bootloader..."
            repair_disk_and_bootloader "$disk"
            apply_post_install_config "$disk"
            return 0
        else
            echo "  ERROR: Installation failed!"
            return 1
        fi
    fi
}

screen_complete() {
    # Determine expected IP address
    local iora_ip="<IP>"
    if [ "$IORA_NETWORK" = "static" ] && [ -n "$IORA_IP" ]; then
        iora_ip="$IORA_IP"
    else
        # Try to guess from first active interface
        for iface in /sys/class/net/*; do
            local name=$(basename "$iface")
            [ "$name" = "lo" ] && continue
            local addr=$(ip -4 addr show "$name" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
            if [ -n "$addr" ]; then
                iora_ip="$addr"
                break
            fi
        done
        [ "$iora_ip" = "<IP>" ] && iora_ip="${IORA_HOSTNAME}.local"
    fi

    if [ -n "$DIALOG_BIN" ]; then
        local action
                action=$(dlg --title " Setup Complete " --menu "\
 IORA OS has been written to /dev/${SEL_DISK}.

 Next step after reboot:
     http://${iora_ip}:8080

 First-boot settings:
     Hostname: ${IORA_HOSTNAME}
     Timezone: ${IORA_TIMEZONE}

 Remove the installation media before continuing.\n" \
                        18 64 3 \
            "reboot"   "Reboot now (recommended)" \
            "shell"    "Drop to shell" \
            "poweroff" "Shut down" \
            3>&1 1>&2 2>&3)

        case "$action" in
            reboot)   umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f ;;
            poweroff) umount "${ISO_MOUNT}" 2>/dev/null; sync; poweroff -f ;;
            shell)    return 0 ;;
            *)        umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f ;;
        esac
    else
        echo ""
        echo "  IORA OS installed successfully!"
        echo ""
        echo "  After rebooting, open a browser:"
        echo "    http://${iora_ip}:8080"
        echo ""
        echo "  Remove the media and press ENTER to reboot..."
        read _
        umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f
    fi
}

# ── Main wizard flow ───────────────────────────────────────────────
run_wizard() {
    # Step 0: Welcome
    screen_welcome

    # Mount media with retries
    dlg_info " Scanning " "  Searching for installation media..."
    sleep 1

    local mounted=false attempt=0
    while [ "$attempt" -lt 5 ]; do
        if mount_iso; then mounted=true; break; fi
        attempt=$((attempt + 1))
        dlg_info " Scanning " "  Scanning for devices... attempt ${attempt} of 5"
        sleep 2
    done

    if [ "$mounted" = false ]; then
        dlg_msg " Error " "\
 Could not find the IORA OS image.\n\n\
 Make sure the installer ISO or USB\n\
 is connected and contains the installer payload.\n\n\
 Type 'install' to retry."
        return 1
    fi

    img_size=$(ls -lh "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '{print $5}')
    load_payload_metadata || true

    if [ "$PAYLOAD_BOOTABLE" = "no" ] || [ "$PAYLOAD_MODE" = "fallback" ]; then
        dlg_msg " Unsupported Payload " "\
 This installer media contains a fallback payload.\n\n\
 It can write data to the target disk, but it does not contain\n\
 the validated partition table and bootloader layout required\n\
 for a bootable installation.\n\n\
 Rebuild the image with full post-image flow:\n\
   sudo ./build.sh all --force-full-image --progress"
        return 1
    fi

        if [ ! -d /sys/firmware/efi ] && [ "$PAYLOAD_BOOT_MODE" = "uefi-only" ]; then
                dlg_msg " Firmware Mismatch " "\
 This installer was booted in Legacy BIOS mode,\n\
 but the payload supports UEFI boot only.\n\n\
 Result would be non-bootable on BIOS firmware.\n\n\
 Options:\n\
     1) Boot the installer in UEFI mode and install again\n\
     2) Rebuild with BIOS GRUB modules available (grub-pc-bin)"
                return 1
        fi

    # Integrity check
    if [ -f "${ISO_MOUNT}/${ISO_IMAGE}.sha256" ]; then
        dlg_info " Integrity Check " "  Verifying SHA256 checksum..."
        if (cd "${ISO_MOUNT}" && sha256sum -c "${ISO_IMAGE}.sha256" >/dev/null 2>&1); then
            dlg_info " Verified " "  Image integrity: OK  [${img_size}]"
            sleep 1
        else
            dlg_msg " Checksum Error " "\
 Image checksum verification FAILED!\n\n\
 The installation image may be corrupted.\n\
 Re-download or re-create the installer.\n\n\
 Installation will not continue."
            return 1
        fi
    fi

    # Step 1: System info
    screen_sysinfo

    # Step 2: Hostname
    screen_hostname

    # Step 3: Timezone
    screen_timezone

    # Step 4: Language
    screen_locale

    # Step 5: Keyboard
    screen_keyboard

    # Step 6: Network
    screen_network

    # Step 7: Root password
    screen_password

    # Step 8: Installation type
    if ! screen_installation_type; then
        return 1
    fi

    # Step 9: Disk selection
    if ! screen_select_disk; then
        dlg_msg " Cancelled " "Setup was cancelled."
        return 1
    fi

    if disk_has_existing_data "$SEL_DISK"; then
        if ! dlg_yesno " Existing Data Detected " "\
 Data or partitions were found on /dev/${SEL_DISK}.\n\n\
 Continuing will delete everything on this drive.\n\n\
 Do you want to erase the entire drive and continue?"; then
            dlg_msg " Cancelled " "No changes were made."
            return 1
        fi
    fi

    if [ "$IORA_INSTALL_MODE" = "guided-safe" ]; then
        if ! dlg_yesno " Final Erase Check " "\
 Final safety check for /dev/${SEL_DISK}.\n\n\
 Confirm again that all data on this drive\n\
 may be removed permanently."; then
            dlg_msg " Cancelled " "No changes were made."
            return 1
        fi
    fi

    # Step 10: Confirm
    if ! screen_confirm; then
        dlg_msg " Cancelled " "No changes were made."
        return 1
    fi

    # Step 11: Install
    if ! screen_install; then
        return 1
    fi

    # Step 12: Done
    screen_complete
}

# ── Entry point ────────────────────────────────────────────────────

# Helper commands for the recovery shell
cat > /bin/install <<'SHEOF'
#!/bin/sh
exec /init
SHEOF
chmod +x /bin/install 2>/dev/null || true

cat > /bin/sysinfo <<'SHEOF'
#!/bin/sh
echo ""
echo "  === System Information ==="
echo "  CPU:     $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')"
echo "  Cores:   $(grep -c '^processor' /proc/cpuinfo 2>/dev/null)"
echo "  Memory:  $(awk '/MemTotal/{printf "%.0f MB", $2/1024}' /proc/meminfo 2>/dev/null)"
echo "  Boot:    $([ -d /sys/firmware/efi ] && echo UEFI || echo BIOS)"
echo ""
echo "  === Block Devices ==="
lsblk 2>/dev/null || ls -l /sys/block/
echo ""
echo "  === Network ==="
ip -brief addr 2>/dev/null || ifconfig 2>/dev/null || echo "  (no ip/ifconfig)"
echo ""
SHEOF
chmod +x /bin/sysinfo 2>/dev/null || true

cat > /bin/netsetup <<'SHEOF'
#!/bin/sh
echo "  Bringing up network interfaces..."
for iface in /sys/class/net/*; do
    name=$(basename "$iface")
    [ "$name" = "lo" ] && continue
    ip link set "$name" up 2>/dev/null
    udhcpc -i "$name" -n -q 2>/dev/null && echo "  $name: DHCP OK" && exit 0
    dhclient "$name" 2>/dev/null && echo "  $name: DHCP OK" && exit 0
done
echo "  No DHCP lease obtained."
SHEOF
chmod +x /bin/netsetup 2>/dev/null || true

run_wizard
rc=$?

echo ""
echo "  Available commands:"
echo "    install  - Restart the installation wizard"
echo "    sysinfo  - Show system information"
echo "    netsetup - Configure network via DHCP"
echo "    reboot   - Reboot the system"
echo "    poweroff - Shut down"
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

    if [ -f "${FALLBACK_MARKER}" ]; then
        log_error "Base image is in fallback mode and is not safe to ship inside the bootable installer ISO."
        log_error "The installer would write a non-partitioned/non-validated payload to disk."
        log_info "Rebuild with privileges and full post-image flow: sudo ./build.sh all --force-full-image --progress"
        mark_skipped "iora-os-installer-boot.iso (fallback payload not bootable)"
        return
    fi

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
    write_payload_metadata "${stage_dir}"

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

    if [ -f "${FALLBACK_MARKER}" ]; then
        log_warn "Raw image was generated from fallback mode (rootfs.ext2-only)."
        log_warn "This artifact is not a validated bootable disk image."
        log_warn "Rebuild with: sudo ./build.sh all --force-full-image --progress"
    fi

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

# ── Publish to IORA Update Server ─────────────────────────────────────────────

publish_to_update_server() {
    if [ -z "${IORA_UPDATE_API_KEY:-}" ]; then
        log_info "Skipping update server publish (IORA_UPDATE_API_KEY not set)"
        log_info "  To publish, set: export IORA_UPDATE_API_KEY=<your-api-key>"
        return 0
    fi

    local update_server="${IORA_UPDATE_SERVER:-https://update.kaimdt.com}"
    local download_server="${IORA_DOWNLOAD_SERVER:-https://dist.kaimdt.com}"
    local version
    version=$(date +%Y%m%d)
    local channel="${IORA_RELEASE_CHANNEL:-stable}"

    log_info "Publishing to update server: ${update_server}"
    log_info "  Version: ${version}"
    log_info "  Channel: ${channel}"

    # Publish RAUC bundle if it exists
    local raucb_file="${RELEASE_DIR}/iora-os.raucb"
    if [ -f "$raucb_file" ]; then
        local raucb_size
        raucb_size=$(stat -c%s "$raucb_file" 2>/dev/null || stat -f%z "$raucb_file" 2>/dev/null)
        local raucb_sha256
        raucb_sha256=$(sha256sum "$raucb_file" | awk '{print $1}')

        log_info "  Publishing RAUC bundle (${raucb_size} bytes)..."

        # Upload artifact to download server
        local upload_resp
        upload_resp=$(curl -sSf -X POST "${download_server}/v1/admin/upload" \
            -H "Authorization: Bearer ${IORA_UPDATE_API_KEY}" \
            -F "file=@${raucb_file}" \
            -F "project=iora-os" \
            -F "version=${version}" \
            -F "platform=ioraos-x86_64" \
            2>/dev/null) || {
            log_warn "Failed to upload RAUC bundle to download server"
        }

        # Publish OS release metadata to update server
        curl -sSf -X POST "${update_server}/v1/admin/iora/os/publish" \
            -H "Authorization: Bearer ${IORA_UPDATE_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{
                \"version\": \"${version}\",
                \"channel\": \"${channel}\",
                \"platform\": \"ioraos-x86_64\",
                \"file_name\": \"iora-os.raucb\",
                \"file_size\": ${raucb_size},
                \"sha256_checksum\": \"${raucb_sha256}\",
                \"file_path\": \"iora-os/${version}/ioraos-x86_64/iora-os.raucb\",
                \"rauc_compatible\": \"iora-os\",
                \"rauc_version\": \"${version}\",
                \"bootloader_type\": \"grub\",
                \"uefi_capable\": true,
                \"rootfs_type\": \"squashfs\",
                \"compression\": \"lz4\"
            }" 2>/dev/null && log_success "  RAUC bundle published" || log_warn "  Failed to publish RAUC bundle metadata"
    fi

    # Publish installer manifest (for net installer)
    local img_xz="${RELEASE_DIR}/iora-os.img.xz"
    if [ -f "$img_xz" ]; then
        local img_size
        img_size=$(stat -c%s "$img_xz" 2>/dev/null || stat -f%z "$img_xz" 2>/dev/null)
        local img_sha256
        img_sha256=$(sha256sum "$img_xz" | awk '{print $1}')

        log_info "  Publishing installer manifest..."

        curl -sSf -X POST "${update_server}/v1/admin/iora/installer" \
            -H "Authorization: Bearer ${IORA_UPDATE_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{
                \"os_version\": \"${version}\",
                \"os_channel\": \"${channel}\",
                \"architecture\": \"x86_64\",
                \"image_url\": \"${download_server}/v1/iora-os/${version}/ioraos-x86_64\",
                \"image_sha256\": \"${img_sha256}\",
                \"image_size\": ${img_size},
                \"min_ram_mb\": 2048,
                \"min_disk_gb\": 8
            }" 2>/dev/null && log_success "  Installer manifest published" || log_warn "  Failed to publish installer manifest"
    fi

    log_success "Update server publish complete"
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

    if [ "${PUBLISH_RELEASE}" = true ]; then
        publish_to_update_server
    fi

    print_summary
}

# Run main function
main "$@"
