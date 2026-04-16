# IORA OS Image Formats

This directory contains scripts to build IORA OS in multiple image formats for different deployment scenarios.

## Quick Start

```bash
# Install dependencies (auto-detect Linux VM vs WSL)
./install-requirements.sh --auto

# One-command build (creates all formats)
./build.sh

# Or use the detailed script
./build-all-images.sh

# Force full GPT/GRUB post-image flow (no fallback)
./build-all-images.sh --force-full-image
```

This will create a `releases/YYYYMMDD-HHMMSS/` directory with all image formats.

The dependency installer supports both native Linux VMs and WSL.

## Generated Image Formats

### 1. **iora-os.img.xz** - Raw Disk Image
- **Use case**: USB drives, SD cards, physical hardware
- **Size**: ~600-800 MB compressed
- **Deployment**:
  ```bash
  xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
  sync
  ```

### 2. **iora-os.qcow2.xz** - QEMU/KVM Image
- **Use case**: KVM, QEMU, libvirt virtual machines
- **Size**: ~500-700 MB compressed
- **Deployment**:
  ```bash
  xz -d iora-os.qcow2.xz
  qemu-system-x86_64 \
    -enable-kvm \
    -m 2048 \
    -smp 2 \
    -drive file=iora-os.qcow2,format=qcow2 \
    -net nic,model=virtio \
    -net user,hostfwd=tcp::8080-:8080
  ```

### 3. **iora-os.vdi.zip** - VirtualBox Image
- **Use case**: Oracle VirtualBox
- **Size**: ~600-800 MB compressed
- **Deployment**:
  1. Unzip: `unzip iora-os.vdi.zip`
  2. Create new VM in VirtualBox
  3. Attach `iora-os.vdi` as disk
  4. Configure: 2GB RAM, 2 CPUs, Bridged Network

### 4. **iora-os.vmdk.zip** - VMware Image
- **Use case**: VMware Workstation, VMware Player, VMware ESXi
- **Size**: ~600-800 MB compressed
- **Deployment**:
  1. Unzip: `unzip iora-os.vmdk.zip`
  2. Create new VM in VMware
  3. Attach `iora-os.vmdk` as disk
  4. Configure: 2GB RAM, 2 CPUs, Bridged Network

### 5. **iora-os.ova** - Open Virtualization Archive
- **Use case**: VirtualBox, VMware (easiest import)
- **Size**: ~800-1000 MB
- **Deployment**:
  - **VirtualBox**: File → Import Appliance → Select .ova
  - **VMware**: File → Open → Select .ova
  - Double-click the .ova file (if associations configured)

### 6. **iora-os-YYYYMMDD.raucb** - RAUC Update Bundle
- **Use case**: Updating existing IORA OS installations
- **Size**: ~400-600 MB
- **Deployment**:
  ```bash
  # On running IORA OS system
  rauc install iora-os-20240415.raucb
  reboot
  ```

### 7. **iora-os-installer.iso** - Installer/Archive ISO
- **Use case**: Distribution medium containing the compressed raw image
- **Contents**: `iora-os.img.xz` and a short install instruction file
- **Creation tools**: `xorriso` (preferred) or `genisoimage`/`mkisofs`

### 8. **iora-os-installer-boot.iso** - Bootable Installer ISO
- **Use case**: Bootable installer/recovery medium for manual disk installation
- **Contents**: Kernel, initrd, GRUB menu, and `iora-os.img.xz` payload
- **Creation tools**: `grub-mkrescue` (+ ISO tooling)

## Build Requirements

### System Requirements
- **OS**: Debian 11/12 or Ubuntu 20.04/22.04/24.04
- **Disk Space**: 20GB+ free
- **RAM**: 4GB+ (8GB recommended)
- **CPU**: Multi-core recommended (build uses all cores)
- **Internet**: Required for downloading Buildroot and packages

### Software Dependencies

Install with:
```bash
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    git \
    wget \
    tar \
    gzip \
    xz-utils \
    cpio \
    unzip \
    rsync \
    bc \
    libncurses5-dev \
    libssl-dev \
    python3 \
    qemu-utils \
    xorriso \
    grub-pc-bin \
    grub-common \
    mtools \
    virtualbox \
    zip \
    rauc
```

**Optional (for specific formats):**
- `virtualbox` - For OVA export
- `rauc` - For update bundle creation
- `qemu-utils` - For qcow2/vdi/vmdk conversion

## Build Process

### Full Build (All Formats)

```bash
cd iora-os
./build-all-images.sh
```

**Build time**: 1-2 hours (depending on hardware)

**Process**:
1. Downloads Buildroot (if needed)
2. Configures for IORA OS
3. Builds base system (longest step)
4. Generates raw disk image
5. Converts to all formats
6. Creates checksums
7. Generates README

### Build Output

```
iora-os/releases/20240415-143022/
├── iora-os.img.xz          # Raw disk image
├── iora-os-installer.iso   # Installer/archive ISO
├── iora-os-installer-boot.iso # Bootable installer ISO
├── iora-os.qcow2.xz        # QEMU/KVM
├── iora-os.vdi.zip         # VirtualBox
├── iora-os.vmdk.zip        # VMware
├── iora-os.ova             # OVA (universal)
├── iora-os-20240415.raucb  # Update bundle
├── SHA256SUMS              # Checksums
└── README.txt              # Deployment guide
```

## Advanced Build Options

### Post-image mode controls

```bash
# Default: try full flow, fallback if loop/mount/grub is restricted
./build-all-images.sh --allow-fallback

# Require full GPT/GRUB post-image flow and fail on restrictions
./build-all-images.sh --force-full-image

# Always use rootfs.ext2 fallback for iora-os.img
./build-all-images.sh --force-fallback-image

# No prompts (CI/headless): auto-try missing installs, continue without optional artifacts
./build-all-images.sh --unattended

# Convert only from existing output/images/iora-os.img (no rebuild)
./build-all-images.sh --images-only --unattended
```

### Interactive dependency handling

During preflight, the script can:
- ask whether missing tools should be installed now (`y/n`),
- retry tool detection,
- if still missing: print alternatives and ask whether to continue.

Supported unattended aliases: `--non-interactive`, `--unattachment`.

If you use `./build.sh resume ...`, only the base build is resumed. To also generate release files in one run:

```bash
./build.sh resume --progress --with-images --unattended
```

### Custom Configuration

Before building, you can customize:

```bash
cd buildroot-2024.02
make menuconfig
# Make your changes
make
```

### Building Specific Format Only

Currently, the script builds all formats. To build specific formats, you'll need to modify `build-all-images.sh` and comment out unwanted `create_*_image()` calls.

### RAUC Signing Keys

For production RAUC bundles, generate signing keys:

```bash
cd iora-os/rauc

# Generate certificate and key (valid 10 years)
openssl req -x509 \
    -newkey rsa:4096 \
    -nodes \
    -keyout key.pem \
    -out cert.pem \
    -days 3650 \
    -subj "/CN=IORA OS Update/O=Your Organization"

# Keep key.pem SECRET!
chmod 600 key.pem
```

## Deployment Guides

### Physical Hardware (USB/SD)

```bash
# 1. Download and verify
wget https://releases.iora.io/iora-os.img.xz
sha256sum iora-os.img.xz

# 2. Identify your device
lsblk

# 3. Flash (replace /dev/sdX with your device)
xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
sync

# 4. Boot from device
```

### VirtualBox

```bash
# Method 1: OVA (easiest)
# - File → Import Appliance
# - Select iora-os.ova
# - Import

# Method 2: VDI
unzip iora-os.vdi.zip
# - Create new VM: Linux 64-bit, 2GB RAM
# - Use existing disk: iora-os.vdi
```

### QEMU/KVM

```bash
# Extract
xz -d iora-os.qcow2.xz

# Run
qemu-system-x86_64 \
    -enable-kvm \
    -m 2048 \
    -smp 2 \
    -drive file=iora-os.qcow2,format=qcow2 \
    -net nic,model=virtio \
    -net user,hostfwd=tcp::8080-:8080,hostfwd=tcp::8091-:8091

# Access: http://localhost:8080
```

### VMware

```bash
# Method 1: OVA
# - File → Open
# - Select iora-os.ova

# Method 2: VMDK
unzip iora-os.vmdk.zip
# - Create new VM: Linux, Other Linux 5.x 64-bit
# - Use existing disk: iora-os.vmdk
```

## Verification

All releases include `SHA256SUMS`:

```bash
# Verify all files
sha256sum -c SHA256SUMS

# Verify specific file
sha256sum iora-os.img.xz
grep iora-os.img.xz SHA256SUMS
```

## Troubleshooting

### Build Fails

```bash
# Clean and retry
./build.sh clean
./build-all-images.sh
```

### Out of Disk Space

Build requires ~20GB. Check available space:
```bash
df -h
```

### Missing Dependencies

```bash
# Re-run dependency check
sudo apt-get install -y build-essential git wget qemu-utils
```

### VirtualBox OVA Export Fails

If `VBoxManage` is not available:
- Install VirtualBox: `sudo apt-get install virtualbox`
- Or skip OVA: Comment out `create_ova_image` in `build-all-images.sh`

### RAUC Bundle Fails

If signing keys don't exist:
- Generate them (see "RAUC Signing Keys" above)
- Or skip RAUC: Comment out `create_rauc_bundle` in `build-all-images.sh`

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build IORA OS

on:
  release:
    types: [created]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential qemu-utils virtualbox

      - name: Build all images
        run: |
          cd iora-os
          ./build-all-images.sh

      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: iora-os-images
          path: iora-os/releases/*/
```

## Custom Modifications

To customize IORA OS before building:

1. **Add packages**: Edit `configs/iora_defconfig`
2. **Customize rootfs**: Edit `board/iora/rootfs-overlay/`
3. **Post-build scripts**: Edit `board/iora/post-build.sh`
4. **Kernel config**: Edit `board/iora/linux.config`

Then run `./build-all-images.sh` to rebuild with changes.

## Release Checklist

Before releasing images:

- [ ] Test boot on physical hardware
- [ ] Test VirtualBox OVA import
- [ ] Test VMware VMDK import
- [ ] Test QEMU qcow2
- [ ] Verify all checksums
- [ ] Test RAUC update bundle
- [ ] Update version numbers
- [ ] Tag git release
- [ ] Upload to release server
- [ ] Update documentation

## Support

- **Documentation**: [README.md](README.md)
- **Issues**: https://github.com/your-org/iora/issues
- **Discussions**: https://github.com/your-org/iora/discussions
