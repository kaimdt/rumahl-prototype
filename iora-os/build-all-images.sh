#!/bin/bash
#
# IORA OS Complete Image Builder
# Creates all image formats for different deployment scenarios
#
# Generates:
#   - img.xz       - Raw disk image (USB/SD card, physical hardware)
#   - iso          - Installer/archive ISO (contains compressed raw image)
#   - qcow2.xz     - QEMU/KVM image (compressed)
#   - vdi.zip      - VirtualBox image
#   - vmdk.zip     - VMware image
#   - ova          - Open Virtualization Archive (VirtualBox/VMware)
#   - raucb        - RAUC update bundle

set -e

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

    if command -v xorriso &> /dev/null || command -v genisoimage &> /dev/null || command -v mkisofs &> /dev/null; then
        ISO_TOOL_AVAILABLE=true
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
    for cmd in make gcc g++ patch wget tar gzip; do
        if ! command -v $cmd &> /dev/null; then
            missing_deps+=($cmd)
        fi
    done

    # Image conversion tools
    if ! command -v qemu-img &> /dev/null; then
        missing_deps+=("qemu-img")
    fi

    # Compression tools
    for cmd in xz zip; do
        if ! command -v $cmd &> /dev/null; then
            missing_deps+=($cmd)
        fi
    done

    # Kernel tools (objtool) need libelf headers via pkg-config.
    if command -v pkg-config &> /dev/null; then
        if ! pkg-config --exists libelf; then
            missing_deps+=("libelf")
        fi
    else
        missing_deps+=("pkg-config")
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
    PATH="${BUILDROOT_SAFE_PATH}" IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" make -j$(nproc)

    log_success "Base image built successfully"
}

create_iso_image() {
    log_info "Creating ISO image..."

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
}

create_raw_image() {
    log_info "Creating raw disk image (img.xz)..."

    if [ ! -f "${OUTPUT_DIR}/iora-os.img" ]; then
        log_error "Base image not found at ${OUTPUT_DIR}/iora-os.img"
        return 1
    fi

    # Compress with xz (high compression)
    cd "${OUTPUT_DIR}"
    if [ ! -f "iora-os.img.xz" ]; then
        log_info "Compressing raw image with xz..."
        xz -9 -T0 -k iora-os.img
    fi

    cp iora-os.img.xz "${RELEASE_DIR}/"

    local size=$(du -h "${RELEASE_DIR}/iora-os.img.xz" | cut -f1)
    log_success "Raw image created: iora-os.img.xz (${size})"
}

create_qcow2_image() {
    log_info "Creating QEMU qcow2 image..."

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping qcow2"
        return
    fi

    cd "${OUTPUT_DIR}"

    # Convert to qcow2
    log_info "Converting to qcow2 format..."
    qemu-img convert -f raw -O qcow2 -c iora-os.img iora-os.qcow2

    # Compress with xz
    log_info "Compressing qcow2 with xz..."
    xz -9 -T0 -k iora-os.qcow2

    cp iora-os.qcow2.xz "${RELEASE_DIR}/"

    local size=$(du -h "${RELEASE_DIR}/iora-os.qcow2.xz" | cut -f1)
    log_success "QEMU image created: iora-os.qcow2.xz (${size})"
}

create_vdi_image() {
    log_info "Creating VirtualBox VDI image..."

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping VDI"
        return
    fi

    cd "${OUTPUT_DIR}"

    # Convert to VDI
    log_info "Converting to VDI format..."
    qemu-img convert -f raw -O vdi iora-os.img iora-os.vdi

    # Create zip archive
    log_info "Creating VDI zip archive..."
    zip -9 iora-os.vdi.zip iora-os.vdi

    cp iora-os.vdi.zip "${RELEASE_DIR}/"

    local size=$(du -h "${RELEASE_DIR}/iora-os.vdi.zip" | cut -f1)
    log_success "VirtualBox image created: iora-os.vdi.zip (${size})"
}

create_vmdk_image() {
    log_info "Creating VMware VMDK image..."

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping VMDK"
        return
    fi

    cd "${OUTPUT_DIR}"

    # Convert to VMDK
    log_info "Converting to VMDK format..."
    qemu-img convert -f raw -O vmdk iora-os.img iora-os.vmdk

    # Create zip archive
    log_info "Creating VMDK zip archive..."
    zip -9 iora-os.vmdk.zip iora-os.vmdk

    cp iora-os.vmdk.zip "${RELEASE_DIR}/"

    local size=$(du -h "${RELEASE_DIR}/iora-os.vmdk.zip" | cut -f1)
    log_success "VMware image created: iora-os.vmdk.zip (${size})"
}

create_ova_image() {
    log_info "Creating OVA (Open Virtualization Archive)..."

    if ! command -v VBoxManage &> /dev/null; then
        log_warn "VBoxManage not available, skipping OVA"
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
}

create_rauc_bundle() {
    log_info "Creating RAUC update bundle..."

    if ! command -v rauc &> /dev/null; then
        log_warn "RAUC not available, skipping update bundle"
        return
    fi

    # Check for signing keys
    if [ ! -f "${RAUC_CERT}" ] || [ ! -f "${RAUC_KEY}" ]; then
        log_warn "RAUC signing keys not found"
        log_info "Generate with: openssl req -x509 -newkey rsa:4096 -nodes -keyout rauc/key.pem -out rauc/cert.pem -days 3650"
        log_warn "Skipping RAUC bundle creation"
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
}

create_checksums() {
    log_info "Creating checksums file..."

    cd "${RELEASE_DIR}"
    sha256sum * > SHA256SUMS

    log_success "Checksums created: SHA256SUMS"
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
    - Installer/archive ISO containing iora-os.img.xz and install notes
    - Usage: Mount/extract the ISO, then flash iora-os.img.xz to your target disk

3. iora-os.qcow2.xz
   - QEMU/KVM virtual machine image
   - Usage:
     xz -d iora-os.qcow2.xz
     qemu-system-x86_64 -enable-kvm -m 2048 -drive file=iora-os.qcow2,format=qcow2

4. iora-os.vdi.zip
   - VirtualBox virtual machine image
   - Usage:
     unzip iora-os.vdi.zip
     Import into VirtualBox using the .vdi file

5. iora-os.vmdk.zip
   - VMware virtual machine image
   - Usage:
     unzip iora-os.vmdk.zip
     Import into VMware using the .vmdk file

6. iora-os.ova
   - Open Virtualization Archive (VirtualBox/VMware)
   - Usage: Double-click to import into VirtualBox/VMware
   - Recommended: 2GB RAM, 2 CPUs

7. iora-os-YYYYMMDD.raucb
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
    echo ""
    log_info "Total release size: $(du -sh ${RELEASE_DIR} | cut -f1)"
    echo ""
    log_success "All images ready for deployment!"
    echo ""
}

# Main build process
main() {
    parse_args "$@"

    log_info "Starting IORA OS complete image build..."
    log_info "Build time: $(date)"
    log_info "Unattended mode: ${UNATTENDED}"
    echo ""

    # Create release directory
    mkdir -p "${RELEASE_DIR}"

    # Run build steps
    check_dependencies
    download_buildroot
    configure_buildroot
    build_base_image

    log_info ""
    log_info "Creating release images..."
    log_info ""

    create_raw_image
    create_iso_image
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
