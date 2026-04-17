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
    PATH="${BUILDROOT_SAFE_PATH}" make BR2_EXTERNAL="${SCRIPT_DIR}" iora_defconfig

    log_success "Buildroot configured"
}

build_base_image() {
    log_info "Building IORA OS base image (this may take 1-2 hours)..."
    log_info "Post-image mode: ${POST_IMAGE_MODE}"

    cd "${BUILD_DIR}"
    if [ "${PROGRESS}" = true ]; then
        PATH="${BUILDROOT_SAFE_PATH}" IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" IORA_UNATTENDED="${UNATTENDED}" make -j"$(nproc)" 2>&1 | show_progress_stream
    else
        PATH="${BUILDROOT_SAFE_PATH}" IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" IORA_UNATTENDED="${UNATTENDED}" make -j"$(nproc)"
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
    local work_dir

    if ! command -v cpio &> /dev/null || ! command -v gzip &> /dev/null; then
        return 1
    fi

    work_dir=$(mktemp -d)

    if ! gzip -dc "${source_initrd}" | (cd "${work_dir}" && cpio -idm --quiet); then
        rm -rf "${work_dir}"
        return 1
    fi

    cat > "${work_dir}/init" <<'EOF'
#!/bin/sh
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
echo "IORA installer initramfs started"
echo "Starting emergency installer shell..."
exec /bin/sh
EOF
    chmod +x "${work_dir}/init"

    if ! (cd "${work_dir}" && find . -print0 | cpio --null -ov --format=newc 2>/dev/null | gzip -9 > "${runtime_initrd}"); then
        rm -rf "${work_dir}"
        return 1
    fi

    rm -rf "${work_dir}"
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

    cat > "${stage_dir}/README-INSTALLER.txt" <<'EOF'
IORA OS Bootable Installer ISO

This ISO is bootable and provides a minimal environment.
Installation payload file on ISO root:
  /iora-os.img.xz

Typical manual install from installer shell:
  mkdir -p /mnt/iso
  mount /dev/sr0 /mnt/iso
  xzcat /mnt/iso/iora-os.img.xz | dd of=/dev/sda bs=4M status=progress
  sync

Replace /dev/sda with your target disk.
EOF

    cat > "${stage_dir}/boot/grub/grub.cfg" <<'EOF'
set timeout=8
set default=1

menuentry "IORA OS Installer (normal boot)" {
    linux /boot/vmlinuz console=tty0 console=ttyS0,115200 loglevel=7 ignore_loglevel nomodeset pci=nommconf
    initrd /boot/initrd.img
}

menuentry "IORA OS Installer (safe VM boot)" {
    linux /boot/vmlinuz console=tty0 console=ttyS0,115200 loglevel=7 ignore_loglevel nomodeset pci=nommconf acpi=off noapic nolapic
    initrd /boot/initrd.img
}

menuentry "IORA OS Installer (rescue shell)" {
    linux /boot/vmlinuz init=/bin/sh console=tty0 console=ttyS0,115200 loglevel=7 ignore_loglevel nomodeset pci=nommconf
    initrd /boot/initrd.img
}
EOF

    if ! grub-mkrescue -o "${RELEASE_DIR}/iora-os-installer-boot.iso" "${stage_dir}" >/dev/null 2>&1; then
        rm -rf "${stage_dir}"
        log_warn "grub-mkrescue failed, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (grub-mkrescue failed)"
        return
    fi

    rm -rf "${stage_dir}"

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

    local size=$(du -h "${RELEASE_DIR}/iora-os.qcow2.xz" | cut -f1)
    log_success "QEMU image created: iora-os.qcow2.xz (${size})"
    mark_created "iora-os.qcow2.xz"
}

create_vdi_image() {
    log_info "Creating VirtualBox VDI image..."

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

    local size=$(du -h "${RELEASE_DIR}/iora-os.vdi.zip" | cut -f1)
    log_success "VirtualBox image created: iora-os.vdi.zip (${size})"
    mark_created "iora-os.vdi.zip"
}

create_vmdk_image() {
    log_info "Creating VMware VMDK image..."

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

    local size=$(du -h "${RELEASE_DIR}/iora-os.vmdk.zip" | cut -f1)
    log_success "VMware image created: iora-os.vmdk.zip (${size})"
    mark_created "iora-os.vmdk.zip"
}

create_ova_image() {
    log_info "Creating OVA (Open Virtualization Archive)..."

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
    - Bootable installer ISO (GRUB/UEFI)
    - Includes kernel/initrd and iora-os.img.xz payload
    - Default boot entry uses safe VM parameters (pci=nommconf)
    - Use rescue/safe menu entry for manual disk install via dd

4. iora-os.qcow2.xz
   - QEMU/KVM virtual machine image
   - Usage:
     xz -d iora-os.qcow2.xz
     qemu-system-x86_64 -enable-kvm -m 2048 -drive file=iora-os.qcow2,format=qcow2

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
