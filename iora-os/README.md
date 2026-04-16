# IORA OS - Custom Operating System for IORA

IORA OS is a custom Linux-based operating system built with Buildroot, designed specifically for running IORA as a complete smart home solution. Similar to Home Assistant Operating System, IORA OS provides a secure, minimal, and optimized environment for IORA services.

## Components

### Bootloader
- **GRUB** - For devices that support UEFI
- **U-Boot** - For devices that don't support UEFI (ARM, embedded systems)

### Operating System
- **Buildroot** - LTS Linux kernel
- Minimal userland with only essential tools
- Read-only root filesystem for security
- Optimized for embedded and server hardware

### File Systems
- **SquashFS** - Read-only root filesystem (using LZ4 compression)
  - Immutable system partition
  - A/B partition scheme for updates
  - Rollback capability
- **ZRAM** - Compressed RAM for `/tmp`, `/var`, and swap (using LZ4 compression)
  - Reduces disk I/O
  - Faster than traditional swap
  - No wear on storage media

### Container Platform
- **Docker Engine** - For running all IORA components in containers
  - iora-supervisor manages all containers
  - Isolated service environments
  - Easy updates and rollbacks

### Updates
- **RAUC** - Over The Air (OTA) and USB updates
  - A/B partition scheme
  - Atomic updates
  - Automatic rollback on failure
  - Signed update bundles
  - USB recovery mode

### Security
- **AppArmor** - Linux kernel security module
  - Mandatory Access Control (MAC)
  - Per-service security profiles
  - Limits container capabilities
  - Protects against privilege escalation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         IORA OS                                 │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Partition A │  │  Partition B │  │   Data Part  │         │
│  │  (SquashFS)  │  │  (SquashFS)  │  │    (ext4)    │         │
│  │   Read-only  │  │   Read-only  │  │  Read-write  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│         ▲                 │                   ▲                 │
│         │                 │                   │                 │
│         └─────────────────┴───────────────────┘                 │
│                           │                                     │
│                     RAUC Update                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Docker Engine (managed by systemd)         │   │
│  │                                                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │    iora-     │  │    iora-     │  │    iora-    │  │   │
│  │  │  supervisor  │→ │     core     │  │    home     │  │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │   │
│  │                                                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │    iora-     │  │    iora-     │  │    iora-    │  │   │
│  │  │   security   │  │   secrets    │  │  watchdog   │  │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │   │
│  │                                                         │   │
│  │         All services run as Docker containers          │   │
│  │         with AppArmor security profiles                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Buildroot Linux                      │   │
│  │              (LTS Kernel + minimal userland)            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Bootloader: GRUB (x86_64/UEFI) or U-Boot (ARM)                │
└─────────────────────────────────────────────────────────────────┘
```

## Building IORA OS

### Quick Start

```bash
# Install dependencies
sudo make install-deps

# For WSL specifically
make install-deps-wsl

# Build all image formats
make build
```

This creates a complete release in `releases/YYYYMMDD-HHMMSS/` with:
- **iora-os.img.xz** - Raw disk image (USB/SD cards)
- **iora-os-installer.iso** - ISO archive containing `iora-os.img.xz` + install note
- **iora-os.qcow2.xz** - QEMU/KVM image
- **iora-os.vdi.zip** - VirtualBox image
- **iora-os.vmdk.zip** - VMware image
- **iora-os.ova** - OVA (universal VM format)
- **iora-os-YYYYMMDD.raucb** - RAUC update bundle
- **SHA256SUMS** - Checksums for verification
- **README.txt** - Deployment instructions

See [BUILD_IMAGES.md](BUILD_IMAGES.md) for detailed build documentation.

### Alternative Build Methods

```bash
# Using the build script
./build-all-images.sh

# Using Make
make build

# Using the wrapper
./build.sh

# Resume interrupted build (with optional progress view)
./build.sh resume --progress

# Require full GPT/GRUB post-image flow (no fallback)
./build.sh all --force-full-image

# Always use fallback image creation (fastest for restricted WSL)
./build.sh all --force-fallback-image

# No prompts (CI/headless): auto-try install missing tools, continue without optional artifacts
./build.sh all --unattended
```

### Detailed Installation (Linux and WSL)

#### 1) Linux host preparation (Debian/Ubuntu)

```bash
cd iora/iora-os
chmod +x build.sh build-all-images.sh resume-build.sh \
  install-requirements-linux.sh install-requirements-wsl.sh

./install-requirements-linux.sh
```

This installs the full toolchain, conversion tools, and ISO tooling. Optional tools like VirtualBox and RAUC may still be skipped if packages are unavailable.

#### 2) WSL preparation (recommended path under Windows)

```bash
cd ~/iora-os/home-assistant-dashb/iora-os
chmod +x build.sh build-all-images.sh resume-build.sh \
  install-requirements-linux.sh install-requirements-wsl.sh

./install-requirements-wsl.sh
```

Notes for WSL:
- Use a Linux path in WSL for building (`~/...`) to avoid path/permission edge cases.
- Full GPT/loop/grub image assembly may require elevated loop/mount support.
- If loop devices are restricted, build uses a safe fallback image path automatically.

### Detailed Image Build Workflow

#### Standard build (recommended)

```bash
./build.sh all --allow-fallback
```

Artifacts are placed in `releases/<timestamp>/`.

#### Resume an interrupted build

```bash
./build.sh resume --progress
```

Useful recovery variants:

```bash
./build.sh resume --clean-linux --progress
./build.sh resume --clean-glibc --progress
./build.sh resume --reconfigure --progress
```

#### Post-image behavior modes

The post-image step supports three modes:
- `--allow-fallback` (default): tries full GPT/GRUB flow, falls back if environment blocks loop/mount/grub.
- `--force-full-image`: requires full GPT/GRUB flow; build fails if unavailable.
- `--force-fallback-image`: skips privileged full-image flow and directly creates `iora-os.img` from `rootfs.ext2`.

Examples:

```bash
./build.sh all --force-full-image
./build.sh all --force-fallback-image
./build.sh resume --force-full-image --progress
```

### ISO Output

If `xorriso` (or `genisoimage`/`mkisofs`) is available, the build creates:
- `iora-os-installer.iso`

This ISO is an installer/archive medium containing `iora-os.img.xz` and install notes. It is intended for easy distribution and transfer. The primary deployment artifact remains `iora-os.img.xz`.

### Interactive Tool Installation During Build

`build-all-images.sh` now performs an interactive preflight:

- If tools are missing, it asks whether it should try to install them automatically (`y/n`).
- If installation fails, it prints alternatives and asks whether to continue without that artifact.
- For required core dependencies, continuing is possible but may cause a later build failure.

Run without prompts (automation/CI):

```bash
./build.sh all --unattended
```

`--unattended` aliases: `--non-interactive`, `--unattachment`

### Prerequisites

- Linux host system (Debian/Ubuntu recommended)
- 20GB+ free disk space
- 4GB+ RAM
- Internet connection

### Install Build Dependencies

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    git \
    wget \
    cpio \
    unzip \
    rsync \
    bc \
    libncurses5-dev \
    libssl-dev \
    python3

# Clone the IORA repository
git clone https://github.com/your-org/iora.git
cd iora/iora-os
```

Or use the provided requirement scripts:

```bash
# Native Linux
./install-requirements-linux.sh

# WSL
./install-requirements-wsl.sh
```

### Configure Buildroot

```bash
# Download Buildroot
wget https://buildroot.org/downloads/buildroot-2024.02.tar.gz
tar xzf buildroot-2024.02.tar.gz
cd buildroot-2024.02

# Load IORA OS configuration
make BR2_EXTERNAL=.. iora_defconfig

# Optional: Customize configuration
make menuconfig
```

### Build the OS Image

```bash
# Build (this takes 1-2 hours depending on your hardware)
make

# Output will be in output/images/
ls output/images/
# - rootfs.squashfs    - Root filesystem
# - bzImage            - Linux kernel
# - iora-os.img        - Complete disk image
```

### Flash to Device

#### USB/SD Card
```bash
# Replace /dev/sdX with your device
sudo dd if=output/images/iora-os.img of=/dev/sdX bs=4M status=progress
sync
```

#### Virtual Machine (QEMU)
```bash
qemu-system-x86_64 \
    -enable-kvm \
    -m 2048 \
    -smp 2 \
    -drive file=output/images/iora-os.img,format=raw \
    -net nic,model=virtio \
    -net user,hostfwd=tcp::8080-:8080
```

## First Boot

1. Boot from the IORA OS image
2. System automatically starts Docker and iora-supervisor
3. iora-supervisor starts all IORA services
4. Access IORA Home at `http://[device-ip]:8080`

## Default Credentials

- **OS Login**: `root` / `iora` (change immediately!)
- **IORA Home**: Create admin account on first access

## System Configuration

### Network Configuration

IORA OS uses systemd-networkd:

```bash
# Edit network configuration
vi /etc/systemd/network/20-wired.network

# Apply changes
systemctl restart systemd-networkd
```

### Docker Configuration

Docker is managed by systemd:

```bash
# Check Docker status
systemctl status docker

# View running containers
docker ps

# Access iora-supervisor API
curl http://localhost:8097/api/supervisor/status
```

### Update System

```bash
# Via OTA (automatic)
# iora-supervisor checks for updates every 24 hours

# Manual update via USB
# 1. Download update bundle (*.raucb)
# 2. Copy to USB drive
# 3. Insert USB drive
# 4. System auto-detects and installs

# Manual update via command
rauc install /path/to/update.raucb
```

## Directory Structure

```
/
├── boot/              # Bootloader and kernel
├── etc/               # System configuration (persistent)
├── opt/               # IORA binaries (read-only)
├── var/               # Variable data (ZRAM)
│   └── lib/
│       └── docker/    # Docker data
├── mnt/
│   └── data/          # Persistent data partition
└── tmp/               # Temporary files (ZRAM)
```

## Partition Layout

| Partition | Size | Type | Mount | Purpose |
|-----------|------|------|-------|---------|
| boot | 512MB | ext4 | /boot | Bootloader, kernel, initramfs |
| rootfs-A | 2GB | squashfs | / | System partition A (active) |
| rootfs-B | 2GB | squashfs | - | System partition B (update) |
| data | Rest | ext4 | /mnt/data | Persistent data, Docker volumes |

## AppArmor Profiles

Each IORA service has a custom AppArmor profile:

```bash
# View loaded profiles
aa-status

# Profiles location
ls /etc/apparmor.d/iora.*
```

## Recovery Mode

Boot into recovery mode by:

1. Interrupt bootloader (press ESC during boot)
2. Select "IORA OS Recovery"
3. Access root shell
4. Mount data partition: `mount /dev/sda4 /mnt/data`
5. Fix issues or restore backup

## Backup and Restore

```bash
# Backup (creates tar.gz of data partition)
iora-backup create /mnt/usb/backup.tar.gz

# Restore
iora-backup restore /mnt/usb/backup.tar.gz

# Automatic daily backups to external USB
systemctl enable iora-backup.timer
```

## Troubleshooting

### Check Service Status
```bash
# All containers
docker ps -a

# iora-supervisor logs
docker logs iora-supervisor

# Specific service
docker logs iora-home
```

### System Logs
```bash
# System journal
journalctl -b

# Docker service
journalctl -u docker

# Real-time logs
journalctl -f
```

### Network Issues
```bash
# Check network
ip addr
ip route

# Test connectivity
ping 8.8.8.8
curl http://iora-core:8090/health
```

### Rollback Update
```bash
# If boot fails, system auto-rolls back
# Manual rollback:
rauc status
rauc mark-bad booted
reboot
```

## Security Hardening

- Root filesystem is read-only (SquashFS)
- AppArmor profiles limit container capabilities
- No SSH by default (enable only if needed)
- Automatic security updates via RAUC
- PostgreSQL runs in container with encrypted databases
- All secrets stored encrypted via iora-secrets

## Performance Tuning

- ZRAM reduces disk I/O
- LZ4 compression (fast)
- Docker overlay2 storage driver
- Kernel optimized for server workloads
- Minimal background services

## Supported Hardware

### Recommended
- x86_64 with UEFI (Intel/AMD)
- 2GB+ RAM
- 16GB+ storage
- Gigabit Ethernet

### ARM Support
- Raspberry Pi 4 (4GB+ model)
- Rock Pi 4
- Odroid N2+
- Generic ARMv8 boards

## License

IORA OS is based on:
- Linux kernel (GPL v2)
- Buildroot (GPL v2)
- Docker (Apache 2.0)
- RAUC (LGPL 2.1)

IORA components are licensed under MIT.
