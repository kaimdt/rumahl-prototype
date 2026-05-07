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
BOOTMODE_MARKER="${IMAGES_DIR}/iora-os.bootmode"

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
        echo "none" > "${BOOTMODE_MARKER}"
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
rm -f "${BOOTMODE_MARKER}" 2>/dev/null || true

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

# Create partition table (BIOS + UEFI dual boot)
# p1: BIOS Boot Partition (required for GRUB i386-pc on GPT disks)
# p2: EFI System Partition (UEFI boot)
# p3: Root A, p4: Root B (A/B update slots)
# p5: Data partition
if ! try_privileged parted -s "${IMG}" mklabel gpt; then
    echo "IORA OS: WARN: cannot create GPT partition table in current environment"
    fallback_to_rootfs_ext2
fi
run_privileged parted -s "${IMG}" mkpart bios_boot 1MiB 2MiB           # BIOS Boot
run_privileged parted -s "${IMG}" set 1 bios_grub on
run_privileged parted -s "${IMG}" mkpart ESP fat32 2MiB 514MiB          # EFI System
run_privileged parted -s "${IMG}" set 2 esp on
run_privileged parted -s "${IMG}" mkpart primary ext4 514MiB 2562MiB    # Root A
run_privileged parted -s "${IMG}" mkpart primary ext4 2562MiB 4610MiB   # Root B
run_privileged parted -s "${IMG}" mkpart primary ext4 4610MiB 100%      # Data

# Setup loop device
if ! LOOP_DEV=$(try_privileged losetup -fP --show "${IMG}" 2>/dev/null); then
    echo "IORA OS: WARN: losetup failed for ${IMG}"
    fallback_to_rootfs_ext2
fi

if [ ! -b "${LOOP_DEV}p1" ] || [ ! -b "${LOOP_DEV}p2" ] || [ ! -b "${LOOP_DEV}p3" ] || [ ! -b "${LOOP_DEV}p4" ] || [ ! -b "${LOOP_DEV}p5" ]; then
    echo "IORA OS: WARN: expected loop partitions are unavailable (${LOOP_DEV}p1..p5)"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Format partitions (p1 = BIOS boot, no filesystem needed)
run_privileged mkfs.vfat -F32 "${LOOP_DEV}p2"
run_privileged mkfs.ext4 -F "${LOOP_DEV}p3"
run_privileged mkfs.ext4 -F "${LOOP_DEV}p4"
run_privileged mkfs.ext4 -F -L iora-data "${LOOP_DEV}p5"

# Mount and install
MOUNT_DIR=$(mktemp -d)
if ! try_privileged mount "${LOOP_DEV}p2" "${MOUNT_DIR}"; then
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
    echo "IORA OS: WARN: grub-install (UEFI) failed in current environment"
    try_privileged umount "${MOUNT_DIR}" >/dev/null 2>&1 || true
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Install GRUB for BIOS (i386-pc) — uses the BIOS Boot Partition (p1, bios_grub)
BOOT_MODE="uefi-only"
if [ -d /usr/lib/grub/i386-pc ]; then
    if try_privileged "${HOST_GRUB_INSTALL}" --target=i386-pc \
        --boot-directory="${MOUNT_DIR}/boot" "${LOOP_DEV}"; then
        echo "IORA OS: GRUB BIOS (i386-pc) installed successfully"
        BOOT_MODE="dual"
    else
        echo "IORA OS: WARN: grub-install (BIOS) failed — system will be UEFI-only"
    fi
else
    echo "IORA OS: INFO: i386-pc GRUB modules not found — system will be UEFI-only"
fi

echo "${BOOT_MODE}" > "${BOOTMODE_MARKER}"

# Create GRUB configuration
# NOTE: Disk images boot directly from root partition - NO initrd.
# The rootfs.cpio.gz generated by Buildroot is a full root filesystem
# (~100-200MB) and NOT a proper boot initramfs. Loading it as initrd
# causes GRUB to fail or the kernel to boot from RAM instead of disk.
# The installer ISO uses its own purpose-built minimal initrd separately.

# Capture partition UUIDs for robust root= references.
# /dev/sda* can shift depending on disk controller order; PARTUUID is stable.
PARTUUID_A=$(try_privileged blkid -s PARTUUID -o value "${LOOP_DEV}p3" 2>/dev/null || true)
PARTUUID_B=$(try_privileged blkid -s PARTUUID -o value "${LOOP_DEV}p4" 2>/dev/null || true)

# Fall back to /dev/sda* if blkid is unavailable or returned empty.
if [ -n "${PARTUUID_A}" ]; then
    ROOT_A="PARTUUID=${PARTUUID_A}"
else
    ROOT_A="/dev/sda3"
fi
if [ -n "${PARTUUID_B}" ]; then
    ROOT_B="PARTUUID=${PARTUUID_B}"
else
    ROOT_B="/dev/sda4"
fi

GRUB_CFG_TMP=$(mktemp)
cat > "${GRUB_CFG_TMP}" <<GRUBEOF
set default=0
set timeout=3

# IORA OS cmdline notes:
#   quiet splash                   : suppress kernel log, hand framebuffer
#     to Plymouth for the branded boot animation.
#   plymouth.enable=1              : explicitly enable Plymouth daemon.
#   plymouth.ignore-serial-consoles: prevents Plymouth from trying to render
#     on the serial console (ttyS0) — Plymouth only owns tty0/framebuffer.
#     Without this, dual console= params cause Plymouth to pick the wrong
#     output and nothing is displayed.
#   vt.handoff=1                   : smooth VT/framebuffer handoff between
#     the GRUB/kernel decompressor screen and Plymouth. Tells Plymouth which
#     virtual terminal to take over (VT1 = tty1, the default getty VT).
#   systemd.show_status=auto : systemd reports starting/failed units in the
#     journal but not on the console (Plymouth owns that during boot; after
#     Plymouth quits the normal getty prompt appears cleanly).
#   (We intentionally do NOT use systemd.log_target=console — that keeps
#   piping post-boot systemd state changes like mount activations onto the
#   tty, overwriting the getty login prompt so the screen looks "frozen".)
#   loglevel=4 keeps the kernel log at KERN_WARNING — same volume as before.
#   printk.devkmsg=on lets userspace write to /dev/kmsg during boot which
#     is useful for iora scripts that want to log boot progress.

menuentry "IORA OS" {
    linux /vmlinuz root=${ROOT_A} rootwait ro rootfstype=ext4 console=tty0 console=ttyS0,115200n8 quiet splash loglevel=4 systemd.show_status=auto printk.devkmsg=on plymouth.enable=1 plymouth.ignore-serial-consoles vt.handoff=1
}

menuentry "IORA OS (Partition B)" {
    linux /vmlinuz root=${ROOT_B} rootwait ro rootfstype=ext4 console=tty0 console=ttyS0,115200n8 quiet splash loglevel=4 systemd.show_status=auto printk.devkmsg=on plymouth.enable=1 plymouth.ignore-serial-consoles vt.handoff=1
}

menuentry "IORA OS (verbose)" {
    linux /vmlinuz root=${ROOT_A} rootwait ro rootfstype=ext4 console=tty0 console=ttyS0,115200n8 loglevel=7 systemd.show_status=true printk.devkmsg=on
}

menuentry "IORA OS Recovery" {
    linux /vmlinuz root=${ROOT_A} rootwait rw rootfstype=ext4 console=tty0 console=ttyS0,115200n8 init=/bin/bash
}
GRUBEOF
run_privileged mkdir -p "${MOUNT_DIR}/boot/grub"
run_privileged cp "${GRUB_CFG_TMP}" "${MOUNT_DIR}/boot/grub/grub.cfg"
rm -f "${GRUB_CFG_TMP}"

# Copy kernel only - no initrd for disk images (see note above)
run_privileged cp "${IMAGES_DIR}/bzImage" "${MOUNT_DIR}/vmlinuz"

if ! try_privileged umount "${MOUNT_DIR}"; then
    echo "IORA OS: WARN: failed to unmount EFI partition"
    try_privileged losetup -d "${LOOP_DEV}" >/dev/null 2>&1 || true
    rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
    fallback_to_rootfs_ext2
fi

# Install root filesystem to partition A (p3)
if ! try_privileged mount "${LOOP_DEV}p3" "${MOUNT_DIR}"; then
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

# Also place the kernel in rootfs so the system can find it for kexec/recovery.
run_privileged cp "${IMAGES_DIR}/bzImage" "${MOUNT_DIR}/boot/vmlinuz" 2>/dev/null || true

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
