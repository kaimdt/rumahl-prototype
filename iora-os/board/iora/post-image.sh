#!/bin/bash
# Post-image script for IORA OS
# Creates bootable disk image with partitions

set -e

BOARD_DIR="$(dirname $0)"
IMAGES_DIR=$1
HOST_BIN_DIR="$(cd "${IMAGES_DIR}/../host/bin" 2>/dev/null && pwd || true)"
POST_IMAGE_MODE="${IORA_POST_IMAGE_MODE:-auto}"
UNATTENDED_MODE="${IORA_UNATTENDED:-false}"
FALLBACK_MARKER="${IMAGES_DIR}/iora-os.fallback"

try_privileged() {
    if "$@"; then
        return 0
    fi

    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
        sudo -n "$@"
        return $?
    fi

    if [ "${UNATTENDED_MODE}" != "true" ] && [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
        echo "IORA OS: INFO: sudo authentication required for: $*"
        sudo "$@"
        return $?
    fi

    return 1
}

run_privileged() {
    if try_privileged "$@"; then
        return 0
    fi

    echo "IORA OS: ERROR: privilege escalation required for '$*'"
    echo "IORA OS: Re-run with sudo, allow passwordless sudo, or disable unattended mode."
    exit 1
}

can_run_privileged() {
    if "$@" >/dev/null 2>&1; then
        return 0
    fi

    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
        if sudo -n "$@" >/dev/null 2>&1; then
            return 0
        fi
    fi

    return 1
}

can_attach_loop() {
    local probe_img="$1"
    local loop_dev=""

    if loop_dev=$(try_privileged losetup -fP --show "${probe_img}" 2>/dev/null); then
        try_privileged losetup -d "${loop_dev}" >/dev/null 2>&1 || true
        return 0
    fi

    return 1
}

fallback_to_rootfs_ext2() {
    if [ "${POST_IMAGE_MODE}" = "full" ]; then
        echo "IORA OS: ERROR: full post-image mode enabled; fallback is disabled"
        exit 1
    fi

    if [ -f "${IMAGES_DIR}/rootfs.ext2" ]; then
        : > "${FALLBACK_MARKER}"
        echo "IORA OS: WARN: switching to rootfs.ext2 fallback image"
        cp -f "${IMAGES_DIR}/rootfs.ext2" "${IMG}"
        echo "IORA OS: Base disk image fallback created: ${IMG}"
        echo "IORA OS: Note: fallback image does not include custom GPT/GRUB post-image layout"
        exit 0
    fi

    echo "IORA OS: ERROR: fallback required but ${IMAGES_DIR}/rootfs.ext2 is missing"
    exit 1
}

is_mounted() {
    local mount_dir="$1"
    grep -qs " ${mount_dir} " /proc/mounts
}

echo "IORA OS: Creating bootable disk image..."
rm -f "${FALLBACK_MARKER}" 2>/dev/null || true

case "${POST_IMAGE_MODE}" in
    auto|full|fallback)
        ;;
    *)
        echo "IORA OS: ERROR: invalid IORA_POST_IMAGE_MODE='${POST_IMAGE_MODE}' (allowed: auto|full|fallback)"
        exit 1
        ;;
esac

if [ "${POST_IMAGE_MODE}" = "fallback" ]; then
    echo "IORA OS: INFO: forced fallback mode requested"
    IMG="${IMAGES_DIR}/iora-os.img"
    fallback_to_rootfs_ext2
fi

# Create disk image (8GB)
IMG="${IMAGES_DIR}/iora-os.img"

# Some environments (containers/restricted WSL) do not allow loop devices,
# even when running with sudo. Fall back to rootfs.ext2 as raw image.
LOOP_PROBE_FILE=$(mktemp)
printf 'x' > "${LOOP_PROBE_FILE}"
if ! can_attach_loop "${LOOP_PROBE_FILE}"; then
    rm -f "${LOOP_PROBE_FILE}"
    fallback_to_rootfs_ext2
fi
rm -f "${LOOP_PROBE_FILE}"

dd if=/dev/zero of="${IMG}" bs=1M count=8192

# Create partition table
if ! try_privileged parted -s "${IMG}" mklabel gpt; then
    echo "IORA OS: WARN: cannot create GPT partition table in current environment"
    fallback_to_rootfs_ext2
fi
run_privileged parted -s "${IMG}" mkpart ESP fat32 1MiB 513MiB
run_privileged parted -s "${IMG}" set 1 esp on
run_privileged parted -s "${IMG}" mkpart primary ext4 513MiB 2561MiB  # Root A
run_privileged parted -s "${IMG}" mkpart primary ext4 2561MiB 4609MiB # Root B
run_privileged parted -s "${IMG}" mkpart primary ext4 4609MiB 100%    # Data

# Setup loop device
if ! LOOP_DEV=$(try_privileged losetup -fP --show "${IMG}" 2>/dev/null); then
    echo "IORA OS: WARN: losetup failed for ${IMG}"
    fallback_to_rootfs_ext2
fi

if [ ! -b "${LOOP_DEV}p1" ] || [ ! -b "${LOOP_DEV}p2" ] || [ ! -b "${LOOP_DEV}p3" ] || [ ! -b "${LOOP_DEV}p4" ]; then
    echo "IORA OS: WARN: expected loop partitions are unavailable (${LOOP_DEV}p1..p4)"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Format partitions
run_privileged mkfs.vfat -F32 "${LOOP_DEV}p1"
run_privileged mkfs.ext4 -F "${LOOP_DEV}p2"
run_privileged mkfs.ext4 -F "${LOOP_DEV}p3"
run_privileged mkfs.ext4 -F -L iora-data "${LOOP_DEV}p4"

# Mount and install
MOUNT_DIR=$(mktemp -d)
if ! try_privileged mount "${LOOP_DEV}p1" "${MOUNT_DIR}"; then
    echo "IORA OS: WARN: mount failed for EFI partition"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi
if ! is_mounted "${MOUNT_DIR}"; then
    echo "IORA OS: WARN: EFI partition mount did not become active"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Install GRUB
HOST_GRUB_INSTALL=""
if [ -x "/usr/sbin/grub-install" ]; then
    HOST_GRUB_INSTALL="/usr/sbin/grub-install"
elif [ -x "/usr/bin/grub-install" ]; then
    HOST_GRUB_INSTALL="/usr/bin/grub-install"
else
    # PATH inside Buildroot often points to output/host/bin first; that grub-install
    # may be incomplete and fail with missing modinfo.sh for x86_64-efi.
    while IFS= read -r candidate; do
        case "${candidate}" in
            *"/buildroot-"*"/output/host/bin/grub-install")
                ;;
            *)
                HOST_GRUB_INSTALL="${candidate}"
                break
                ;;
        esac
    done < <(command -v -a grub-install 2>/dev/null || true)

    if [ -z "${HOST_GRUB_INSTALL}" ] && [ -x "${HOST_BIN_DIR}/grub-install" ]; then
        HOST_GRUB_INSTALL="${HOST_BIN_DIR}/grub-install"
    fi
fi

if [ -z "${HOST_GRUB_INSTALL}" ]; then
    echo "IORA OS: WARN: grub-install is unavailable"
    try_privileged umount "${MOUNT_DIR}" >/dev/null 2>&1 || true
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

if ! try_privileged "${HOST_GRUB_INSTALL}" --target=x86_64-efi --efi-directory="${MOUNT_DIR}" \
    --boot-directory="${MOUNT_DIR}/boot" --removable "${LOOP_DEV}"; then
    echo "IORA OS: WARN: grub-install failed in current environment"
    try_privileged umount "${MOUNT_DIR}" >/dev/null 2>&1 || true
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Create GRUB configuration
GRUB_CFG_TMP=$(mktemp)
cat > "${GRUB_CFG_TMP}" <<'EOF'
set default=0
set timeout=3

menuentry "IORA OS" {
    linux /vmlinuz root=/dev/sda2 ro rootfstype=squashfs quiet
    initrd /initrd.img
}

menuentry "IORA OS (Partition B)" {
    linux /vmlinuz root=/dev/sda3 ro rootfstype=squashfs quiet
    initrd /initrd.img
}

menuentry "IORA OS Recovery" {
    linux /vmlinuz root=/dev/sda2 ro rootfstype=squashfs init=/bin/bash
    initrd /initrd.img
}
EOF
run_privileged mkdir -p "${MOUNT_DIR}/boot/grub"
run_privileged cp "${GRUB_CFG_TMP}" "${MOUNT_DIR}/boot/grub/grub.cfg"
rm -f "${GRUB_CFG_TMP}"

# Copy kernel and initrd
run_privileged cp "${IMAGES_DIR}/bzImage" "${MOUNT_DIR}/vmlinuz"
if [ -f "${IMAGES_DIR}/rootfs.cpio.gz" ]; then
    run_privileged cp "${IMAGES_DIR}/rootfs.cpio.gz" "${MOUNT_DIR}/initrd.img"
fi

if ! try_privileged umount "${MOUNT_DIR}"; then
    echo "IORA OS: WARN: failed to unmount EFI partition"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Install root filesystem to partition A
if ! try_privileged mount "${LOOP_DEV}p2" "${MOUNT_DIR}"; then
    echo "IORA OS: WARN: mount failed for rootfs partition"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi
if ! is_mounted "${MOUNT_DIR}"; then
    echo "IORA OS: WARN: rootfs partition mount did not become active"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi
if [ -x "${HOST_BIN_DIR}/unsquashfs" ]; then
    run_privileged "${HOST_BIN_DIR}/unsquashfs" -f -d "${MOUNT_DIR}" "${IMAGES_DIR}/rootfs.squashfs"
else
    run_privileged unsquashfs -f -d "${MOUNT_DIR}" "${IMAGES_DIR}/rootfs.squashfs"
fi
if ! try_privileged umount "${MOUNT_DIR}"; then
    echo "IORA OS: WARN: failed to unmount rootfs partition"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Cleanup
run_privileged losetup -d "${LOOP_DEV}"
rmdir "${MOUNT_DIR}"

# Note: Compression and format conversion now handled by build-all-images.sh
echo "IORA OS: Base disk image created: ${IMG}"
echo "IORA OS: Use build-all-images.sh to create all image formats"
echo "IORA OS: Or compress manually: xz -9 -T0 ${IMG}"
