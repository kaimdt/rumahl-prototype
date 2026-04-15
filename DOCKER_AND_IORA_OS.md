# IORA - Complete Containerization and IORA OS

This document describes the full containerization of IORA and the IORA OS custom operating system.

## Overview

IORA is now a **fully containerized system** running on **IORA OS**, a custom Linux-based operating system built with Buildroot. Every component runs as a Docker container, managed by the `iora-supervisor` service.

## Architecture Changes

### New Component: iora-supervisor (Port 8097)

The supervisor is the **master container** that controls Docker. It:
- Manages all IORA service containers
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

### IORA OS Components

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
   - All IORA services run as containers
   - Managed by iora-supervisor

4. **Updates**
   - RAUC Over-The-Air (OTA) updates
   - A/B partition scheme
   - Atomic updates with automatic rollback
   - Signed update bundles

5. **Security**
   - AppArmor mandatory access control
   - Per-service security profiles
   - Read-only root filesystem
   - Encrypted databases (iora-security, iora-secrets)

## Quick Start with Docker Compose

### Prerequisites
- Docker and Docker Compose installed
- PostgreSQL (included in docker-compose.yml)
- 4GB+ RAM recommended

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/iora.git
   cd iora
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

3. **Start IORA**
   ```bash
   docker compose up -d
   ```

4. **Check status**
   ```bash
   docker compose ps
   docker compose logs -f
   ```

5. **Access IORA**
   - **IORA Home**: http://localhost:8080
   - **IORA Control**: http://localhost:8091
   - **Supervisor API**: http://localhost:8097

### Docker Compose Services

The complete stack includes:

- `postgres` - PostgreSQL 16 database
- `iora-supervisor` - Docker orchestration
- `iora-core` - Central orchestrator
- `iora-security` - Security monitoring
- `iora-watchdog` - Health monitoring
- `iora-secrets` - Encrypted secrets
- `iora-gateway` - Sandboxed integrations
- `iora-home` - Smart Home server
- `iora-control` - Admin panel
- `iora-assist` - AI assistant

All services have:
- Health checks
- Automatic restart policies
- AppArmor security profiles
- Labeled with `iora.managed=true`

## Building IORA OS

### Prerequisites

- Linux host (Debian/Ubuntu recommended)
- 20GB+ free disk space
- 4GB+ RAM
- Internet connection

### Build Steps

1. **Install dependencies**
   ```bash
   sudo apt-get update
   sudo apt-get install -y \
       build-essential git wget cpio unzip rsync bc \
       libncurses5-dev libssl-dev python3
   ```

2. **Download Buildroot**
   ```bash
   cd iora-os
   wget https://buildroot.org/downloads/buildroot-2024.02.tar.gz
   tar xzf buildroot-2024.02.tar.gz
   cd buildroot-2024.02
   ```

3. **Configure for IORA**
   ```bash
   make BR2_EXTERNAL=../configs iora_defconfig
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
   └── iora-os.img.xz     # Complete disk image
   ```

### Flash to Device

**USB/SD Card:**
```bash
xzcat output/images/iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
sync
```

**QEMU (testing):**
```bash
qemu-system-x86_64 \
    -enable-kvm -m 2048 -smp 2 \
    -drive file=output/images/iora-os.img,format=raw \
    -net nic,model=virtio \
    -net user,hostfwd=tcp::8080-:8080
```

### First Boot

1. Boot from IORA OS image
2. Default login: `root` / `iora` (change immediately!)
3. System auto-starts Docker and iora-supervisor
4. iora-supervisor starts all IORA containers
5. Access at http://[device-ip]:8080

## File Structure

```
iora/
├── backend/
│   ├── Dockerfile                 # Multi-stage build for all services
│   ├── iora-supervisor/          # New: Docker orchestration
│   ├── iora-home/
│   ├── iora-core/
│   ├── iora-control/
│   ├── iora-assist/
│   ├── iora-secrets/
│   ├── iora-watchdog/
│   ├── iora-security/
│   ├── iora-gateway/
│   └── ...
├── docker-compose.yml            # Full IORA stack definition
├── init-postgres.sh              # PostgreSQL initialization
├── .env.example                  # Environment template
└── iora-os/                      # IORA OS build system
    ├── README.md                 # Detailed OS documentation
    ├── configs/
    │   └── iora_defconfig       # Buildroot configuration
    ├── board/
    │   └── iora/
    │       ├── post-build.sh    # OS customization
    │       └── post-image.sh    # Image creation
    ├── rauc/                     # Update system
    │   ├── system.conf
    │   ├── manifest.raucm
    │   └── build-bundle.sh
    └── apparmor/                 # Security profiles
        ├── iora-supervisor
        ├── iora-security
        ├── iora-secrets
        ├── iora-gateway
        └── ...
```

## AppArmor Security

Each service has a custom AppArmor profile:

```bash
# View loaded profiles
aa-status

# Profiles applied in docker-compose.yml
security_opt:
  - apparmor=iora-service-name
```

Profiles enforce:
- Minimal file system access
- Controlled network access
- Capability restrictions (no sys_admin, sys_module)
- No privilege escalation

## Updates

### Container Updates (via iora-supervisor)

```bash
# Via API
curl -X POST http://localhost:8097/api/supervisor/services/update \
  -H "Content-Type: application/json" \
  -d '{"service_name": "iora-home", "image_tag": "latest"}'

# Via Docker Compose
docker compose pull
docker compose up -d
```

### IORA OS Updates (via RAUC)

```bash
# Download update bundle
wget https://releases.iora.io/updates/iora-os-v1.1.0.raucb

# Install update
rauc install iora-os-v1.1.0.raucb

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
docker compose logs -f iora-home

# Via supervisor API
curl http://localhost:8097/api/supervisor/containers/iora-home/logs
```

### Health checks
```bash
# All services
for port in 8080 8090 8091 8092 8093 8094 8095 8096 8097; do
  echo -n "Port $port: "
  curl -s http://localhost:$port/health | jq -r .status
done
```

## Troubleshooting

### Containers won't start
```bash
# Check logs
docker compose logs

# Check supervisor
docker compose logs iora-supervisor

# Rebuild
docker compose build --no-cache
docker compose up -d
```

### Database connection issues
```bash
# Check PostgreSQL
docker compose logs postgres

# Verify databases
docker compose exec postgres psql -U iora -l
```

### Permission issues
```bash
# Check AppArmor
aa-status | grep iora

# View denials
dmesg | grep -i apparmor | grep DENIED
```

## Migration from Non-Containerized

If you have an existing IORA installation:

1. **Backup data**
   ```bash
   pg_dump iora_home > iora_home_backup.sql
   pg_dump iora_core > iora_core_backup.sql
   ```

2. **Start containerized IORA**
   ```bash
   docker compose up -d postgres
   # Wait for PostgreSQL to be ready
   docker compose up -d
   ```

3. **Restore data**
   ```bash
   docker compose exec -T postgres psql -U iora iora_home < iora_home_backup.sql
   docker compose exec -T postgres psql -U iora iora_core < iora_core_backup.sql
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
- [iora-os/README.md](iora-os/README.md) - IORA OS documentation
- [Home Assistant OS](https://github.com/home-assistant/operating-system) - Inspiration for IORA OS
- [Buildroot User Manual](https://buildroot.org/downloads/manual/manual.html)
- [RAUC Documentation](https://rauc.readthedocs.io/)
- [AppArmor Documentation](https://apparmor.net/)
