#!/bin/bash
# Post-image script for IORA OS
# Creates bootable disk image with partitions

set -e

BOARD_DIR="$(dirname $0)"
IMAGES_DIR=$1

echo "IORA OS: Creating bootable disk image..."

# Create disk image (8GB)
IMG="${IMAGES_DIR}/iora-os.img"
dd if=/dev/zero of="${IMG}" bs=1M count=8192

# Create partition table
parted -s "${IMG}" mklabel gpt
parted -s "${IMG}" mkpart ESP fat32 1MiB 513MiB
parted -s "${IMG}" set 1 esp on
parted -s "${IMG}" mkpart primary ext4 513MiB 2561MiB  # Root A
parted -s "${IMG}" mkpart primary ext4 2561MiB 4609MiB # Root B
parted -s "${IMG}" mkpart primary ext4 4609MiB 100%    # Data

# Setup loop device
LOOP_DEV=$(losetup -fP --show "${IMG}")

# Format partitions
mkfs.vfat -F32 "${LOOP_DEV}p1"
mkfs.ext4 -F "${LOOP_DEV}p2"
mkfs.ext4 -F "${LOOP_DEV}p3"
mkfs.ext4 -F -L iora-data "${LOOP_DEV}p4"

# Mount and install
MOUNT_DIR=$(mktemp -d)
mount "${LOOP_DEV}p1" "${MOUNT_DIR}"

# Install GRUB
grub-install --target=x86_64-efi --efi-directory="${MOUNT_DIR}" \
    --boot-directory="${MOUNT_DIR}/boot" --removable "${LOOP_DEV}"

# Create GRUB configuration
mkdir -p "${MOUNT_DIR}/boot/grub"
cat > "${MOUNT_DIR}/boot/grub/grub.cfg" <<'EOF'
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

# Copy kernel and initrd
cp "${IMAGES_DIR}/bzImage" "${MOUNT_DIR}/vmlinuz"
if [ -f "${IMAGES_DIR}/rootfs.cpio.gz" ]; then
    cp "${IMAGES_DIR}/rootfs.cpio.gz" "${MOUNT_DIR}/initrd.img"
fi

umount "${MOUNT_DIR}"

# Install root filesystem to partition A
mount "${LOOP_DEV}p2" "${MOUNT_DIR}"
unsquashfs -f -d "${MOUNT_DIR}" "${IMAGES_DIR}/rootfs.squashfs"
umount "${MOUNT_DIR}"

# Cleanup
losetup -d "${LOOP_DEV}"
rmdir "${MOUNT_DIR}"

# Note: Compression and format conversion now handled by build-all-images.sh
echo "IORA OS: Base disk image created: ${IMG}"
echo "IORA OS: Use build-all-images.sh to create all image formats"
echo "IORA OS: Or compress manually: xz -9 -T0 ${IMG}"
