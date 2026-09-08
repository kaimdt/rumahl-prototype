# rumahl - Complete Containerization and rumahl OS

This document describes the full containerization of rumahl and the rumahl OS custom operating system.

## Overview

rumahl is now a **fully containerized system** running on **rumahl OS**, a custom Linux-based operating system built with Buildroot. Every component runs as a Docker container, managed by the `rumahl-supervisor` service.

## Architecture Changes

### New Component: rumahl-supervisor (Port 8097)

The supervisor is the **master container** that controls Docker. It:
- Manages all rumahl service containers
- Handles container start/stop/restart operations
- Pulls updates and recreates containers
- Aggregates logs from all services
- Provides unified API for container operations
- Integrates with RAUC for OS updates

**API Endpoints:**
- `GET /api/supervisor/status` - System status
- `GET /api/supervisor/containers` - List containers
- `POST /api/supervisor/containers/{name}/start` - Start container
- `POST /api/supervisor/containers/{name}/stop` - Stop container
- `POST /api/supervisor/containers/{name}/restart` - Restart container
- `POST /api/supervisor/services/update` - Update service
- `GET /api/supervisor/containers/{name}/logs` - View logs

### rumahl OS Components

1. **Bootloader**
   - GRUB (x86_64 UEFI)
   - U-Boot (ARM devices)

2. **Operating System**
   - Buildroot LTS Linux kernel
   - Minimal userland with only essential tools
   - Read-only root filesystem (SquashFS with LZ4)
   - ZRAM for /tmp, /var, and swap

3. **Container Platform**
   - Docker Engine
   - All rumahl services run as containers
   - Managed by rumahl-supervisor

4. **Updates**
   - RAUC Over-The-Air (OTA) updates
   - A/B partition scheme
   - Atomic updates with automatic rollback
   - Signed update bundles

5. **Security**
   - AppArmor mandatory access control
   - Per-service security profiles
   - Read-only root filesystem
   - Encrypted databases (rumahl-security, rumahl-secrets)

## Quick Start with Docker Compose

### Prerequisites
- Docker and Docker Compose installed
- PostgreSQL (included in docker-compose.yml)
- 4GB+ RAM recommended

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/ora.git
   cd ora
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   nano .env
   ```

   Edit these critical values:
   ```env
   # PostgreSQL
   POSTGRES_PASSWORD=your_secure_password

   # Security keys (generate with: openssl rand -hex 32)
   JWT_SECRET=<64-char-hex>
   SECRETS_MASTER_KEY=<64-char-hex>
   SECURITY_DB_KEY=<64-char-hex>

   # Home Assistant
   HA_URL=http://homeassistant.local:8123
   HA_TOKEN=your_ha_token
   ```

3. **Start rumahl**
   ```bash
   docker compose up -d
   ```

4. **Check status**
   ```bash
   docker compose ps
   docker compose logs -f
   ```

5. **Access rumahl**
   - **rumahl Home**: http://rumahl.local:8080
   - **rumahl Control**: http://rumahl.local:8091
   - **Supervisor API**: http://rumahl.local:8097

### Docker Compose Services

The complete stack includes:

- `postgres` - PostgreSQL 16 database
- `rumahl-supervisor` - Docker orchestration
- `rumahl-core` - Central orchestrator
- `rumahl-security` - Security monitoring
- `rumahl-watchdog` - Health monitoring
- `rumahl-secrets` - Encrypted secrets
- `rumahl-gateway` - Sandboxed integrations
- `rumahl-home` - Smart Home server
- `rumahl-control` - Admin panel
- `rumahl-assist` - AI assistant

All services have:
- Health checks
- Automatic restart policies
- AppArmor security profiles
- Labeled with `ora.managed=true`

## Building rumahl OS

### Prerequisites

- Linux host (Debian/Ubuntu recommended)
- 20GB+ free disk space
- 4GB+ RAM
- Internet connection

## Building rumahl OS

### Quick Build (All Formats)

```bash
cd rumahl-os

# Install dependencies
sudo make install-deps

# Build all image formats
make build
```

This single command creates:
- Raw disk image (.img.xz)
- QEMU/KVM image (.qcow2.xz)
- VirtualBox image (.vdi.zip)
- VMware image (.vmdk.zip)
- OVA (universal VM format)
- RAUC update bundle (.raucb)

**Build time**: 1-2 hours (depending on hardware)

**Output**: `rumahl-os/releases/YYYYMMDD-HHMMSS/` directory

### Alternative Build Methods

```bash
# Method 1: Full automated build
./build-all-images.sh

# Method 2: Using Make
make build

# Method 3: Using wrapper
./build.sh all
```

See [rumahl-os/BUILD_IMAGES.md](rumahl-os/BUILD_IMAGES.md) for comprehensive build documentation.

### Manual Build Steps (Advanced)

For more control over the build:

1. **Install dependencies**
   ```bash
   sudo apt-get update
   sudo apt-get install -y \
       build-essential git wget cpio unzip rsync bc \
       libncurses5-dev libssl-dev python3
   ```

2. **Download Buildroot**
   ```bash
   cd rumahl-os
   wget https://buildroot.org/downloads/buildroot-2024.02.tar.gz
   tar xzf buildroot-2024.02.tar.gz
   cd buildroot-2024.02
   ```

3. **Configure for rumahl**
   ```bash
   make BR2_EXTERNAL=../configs rumahl_defconfig
   ```

4. **Build (1-2 hours)**
   ```bash
   make -j$(nproc)
   ```

5. **Output**
   ```
   output/images/
   ├── rootfs.squashfs    # Root filesystem
   ├── bzImage            # Linux kernel
   └── rumahl-os.img.xz     # Complete disk image
   ```

### Flash to Device

**USB/SD Card:**
```bash
xzcat output/images/rumahl-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
sync
```

**QEMU (testing):**
```bash
qemu-system-x86_64 \
    -enable-kvm -m 2048 -smp 2 \
    -drive file=output/images/rumahl-os.img,format=raw \
    -net nic,model=virtio \
    -net user,hostfwd=tcp::8080-:8080
```

### First Boot

1. Boot from rumahl OS image
2. Default login: `root` / `ora` (change immediately!)
3. System auto-starts Docker and rumahl-supervisor
4. rumahl-supervisor starts all rumahl containers
5. Access at http://[device-ip]:8080

## File Structure

```
ora/
├── backend/
│   ├── Dockerfile                 # Multi-stage build for all services
│   ├── rumahl-supervisor/          # New: Docker orchestration
│   ├── rumahl-home/
│   ├── rumahl-core/
│   ├── rumahl-control/
│   ├── rumahl-assist/
│   ├── rumahl-secrets/
│   ├── rumahl-watchdog/
│   ├── rumahl-security/
│   ├── rumahl-gateway/
│   └── ...
├── docker-compose.yml            # Full rumahl stack definition
├── init-postgres.sh              # PostgreSQL initialization
├── .env.example                  # Environment template
└── rumahl-os/                      # rumahl OS build system
    ├── README.md                 # Detailed OS documentation
    ├── configs/
    │   └── rumahl_defconfig       # Buildroot configuration
    ├── board/
    │   └── ora/
    │       ├── post-build.sh    # OS customization
    │       └── post-image.sh    # Image creation
    ├── rauc/                     # Update system
    │   ├── system.conf
    │   ├── manifest.raucm
    │   └── build-bundle.sh
    └── apparmor/                 # Security profiles
        ├── rumahl-supervisor
        ├── rumahl-security
        ├── rumahl-secrets
        ├── rumahl-gateway
        └── ...
```

## AppArmor Security

Each service has a custom AppArmor profile:

```bash
# View loaded profiles
aa-status

# Profiles applied in docker-compose.yml
security_opt:
  - apparmor=rumahl-service-name
```

Profiles enforce:
- Minimal file system access
- Controlled network access
- Capability restrictions (no sys_admin, sys_module)
- No privilege escalation

## Updates

### Container Updates (via rumahl-supervisor)

```bash
# Via API
curl -X POST http://rumahl.local:8097/api/supervisor/services/update \
  -H "Content-Type: application/json" \
  -d '{"service_name": "rumahl-home", "image_tag": "latest"}'

# Via Docker Compose
docker compose pull
docker compose up -d
```

### rumahl OS Updates (via RAUC)

```bash
# Download update bundle
wget https://releases.ora.io/updates/rumahl-os-v1.1.0.raucb

# Install update
rauc install rumahl-os-v1.1.0.raucb

# Reboot to apply
reboot

# Rollback if needed
rauc status
rauc mark-bad booted
reboot
```

## Supported Hardware

### Recommended
- x86_64 with UEFI (Intel NUC, servers)
- 2GB+ RAM (4GB+ recommended)
- 16GB+ storage (32GB+ recommended)
- Gigabit Ethernet

### ARM Support
- Raspberry Pi 4 (4GB+ model)
- Rock Pi 4
- Odroid N2+
- Generic ARMv8 boards with U-Boot

## Monitoring

### View all services
```bash
docker compose ps
```

### View logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f rumahl-home

# Via supervisor API
curl http://rumahl.local:8097/api/supervisor/containers/rumahl-home/logs
```

### Health checks
```bash
# All services
for port in 8080 8090 8091 8092 8093 8094 8095 8096 8097; do
  echo -n "Port $port: "
  curl -s http://rumahl.local:$port/health | jq -r .status
done
```

## Troubleshooting

### Containers won't start
```bash
# Check logs
docker compose logs

# Check supervisor
docker compose logs rumahl-supervisor

# Rebuild
docker compose build --no-cache
docker compose up -d
```

### Database connection issues
```bash
# Check PostgreSQL
docker compose logs postgres

# Verify databases
docker compose exec postgres psql -U ora -l
```

### Permission issues
```bash
# Check AppArmor
aa-status | grep ora

# View denials
dmesg | grep -i apparmor | grep DENIED
```

## Migration from Non-Containerized

If you have an existing rumahl installation:

1. **Backup data**
   ```bash
   pg_dump rumahl_home > rumahl_home_backup.sql
   pg_dump rumahl_core > rumahl_core_backup.sql
   ```

2. **Start containerized rumahl**
   ```bash
   docker compose up -d postgres
   # Wait for PostgreSQL to be ready
   docker compose up -d
   ```

3. **Restore data**
   ```bash
   docker compose exec -T postgres psql -U ora rumahl_home < rumahl_home_backup.sql
   docker compose exec -T postgres psql -U ora rumahl_core < rumahl_core_backup.sql
   ```

4. **Restart services**
   ```bash
   docker compose restart
   ```

## Security Notes

1. **Change default passwords** in `.env`
2. **Generate secure keys** with `openssl rand -hex 32`
3. **Restrict network access** to trusted IPs
4. **Enable firewall** on host system
5. **Regular updates** via RAUC
6. **Monitor logs** for security events
7. **Backup encrypted databases** regularly

## References

- [ARCHITECTURE.md](ARCHITECTURE.md) - Complete system architecture
- [rumahl-os/README.md](rumahl-os/README.md) - rumahl OS documentation
- [Home Assistant OS](https://github.com/home-assistant/operating-system) - Inspiration for rumahl OS
- [Buildroot User Manual](https://buildroot.org/downloads/manual/manual.html)
- [RAUC Documentation](https://rauc.readthedocs.io/)
- [AppArmor Documentation](https://apparmor.net/)
