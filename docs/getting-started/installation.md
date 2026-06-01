# Installation Guide

This guide covers installing IORA on various platforms.

## Table of Contents

- [System Requirements](#system-requirements)
- [Installation Methods](#installation-methods)
  - [IORA OS (Recommended for Hardware)](#iora-os-recommended-for-hardware)
  - [Docker Compose (Linux Servers)](#docker-compose-linux-servers)
  - [Development (Direct Host)](#development-direct-host)
  - [IORA Desktop (Tauri)](#iora-desktop-tauri)
- [Post-Installation](#post-installation)
- [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum

| Component | Requirement |
|-----------|------------|
| CPU | 2 cores (ARM64 or x86_64) |
| RAM | 512 MB (Raspberry Pi 4) / 900 MB (VM) |
| Disk | 8 GB free |
| OS | Debian 12+, Ubuntu 22.04+, macOS 13+, Raspberry Pi OS |

### Recommended

| Component | Requirement |
|-----------|------------|
| CPU | 4 cores |
| RAM | 2 GB+ (8 GB+ for AI features) |
| Disk | 20 GB+ SSD |

### Supported Hardware

- **x86_64** with UEFI (Intel/AMD servers, NUCs)
- **Raspberry Pi 4** (4 GB+ recommended)
- **Rock Pi 4**, **Odroid N2+**
- Generic ARM64 boards

## Installation Methods

### IORA OS (Recommended for Hardware)

IORA OS is a custom Buildroot-based operating system with a read-only SquashFS root filesystem, A/B partition updates via RAUC, and Docker Engine for all services.

```bash
# 1. Download the pre-built image
wget https://github.com/kaimdt/home-assistant-dashb/releases/latest/download/iora-os.img.xz

# 2. Verify the checksum
sha256sum iora-os.img.xz

# 3. Flash to your device (replace /dev/sdX with your device)
xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress

# 4. Boot the device
# Default credentials: root / iora (change immediately!)

# 5. Access the web interface
# http://[device-ip]:8126
```

**Key features of IORA OS:**
- Buildroot LTS Linux – minimal, secure kernel
- SquashFS root filesystem – read-only, compressed (LZ4)
- ZRAM – compressed RAM for `/tmp`, `/var`, swap
- RAUC A/B updates – atomic updates with rollback
- AppArmor – mandatory access control for all services

See the [IORA OS build guide](../deployment/docker-and-iora-os.md) for building from source.

### Docker Compose (Linux Servers)

For standard Linux servers, IORA runs as a fully containerized system managed by `iora-supervisor`.

```bash
# 1. Clone the repository
git clone https://github.com/kaimdt/home-assistant-dashb.git
cd home-assistant-dashb

# 2. Configure environment
cp .env.example .env
# Edit .env with your settings (see Configuration section)

# 3. Start the entire IORA stack
cd deploy
docker compose up -d

# 4. Check status
docker compose ps

# 5. View logs
docker compose logs -f

# 6. Access IORA
# Home Dashboard: http://localhost:8126
# Control Center: http://localhost:8091
# Supervisor:    http://localhost:8097
```

The docker-compose.yml includes:
- PostgreSQL database with automatic initialization
- All IORA services as containers
- iora-supervisor for Docker orchestration
- AppArmor security profiles
- Health checks and auto-restart
- Persistent volumes for data

**Docker Compose variants:**
- `deploy/docker-compose.yml` – Standard deployment
- `deploy/docker-compose.minimal.yml` – Minimal services (no AI)
- `deploy/docker-compose.os.yml` – IORA OS compatible

### Development (Direct Host)

For development without Docker:

```bash
# 1. Install prerequisites
# Rust (via rustup): https://rustup.rs
# Node.js 18+: https://nodejs.org
# PostgreSQL 16+

# 2. Clone and build
git clone https://github.com/kaimdt/home-assistant-dashb.git
cd home-assistant-dashb

# 3. Start IORA services
cd iora-os/backend

# Start orchestrator first
cargo run -p iora-core &
cargo run -p iora-security &

# Then other services
cargo run -p iora-watchdog &
cargo run -p iora-secrets &
cargo run -p iora-gateway &
cargo run -p iora-home &
cargo run -p iora-control &
cargo run -p iora-assist &

# 4. Start frontend dev server
cd ../../frontend
npm install
npm run dev
# Frontend: http://localhost:5173
# Backend API: http://localhost:3001
```

**Development port mapping:**
| Service | Dev Port |
|---------|----------|
| iora-home | 3001 |
| iora-core | 8090 |
| iora-control | 8091 |
| iora-assist | 8092 |
| Frontend (Vite) | 5173 |

### IORA Desktop (Tauri)

IORA Desktop is a Tauri v2 application that runs as a system tray app and provides local AI proxy capabilities.

```bash
# 1. Navigate to desktop directory
cd desktop

# 2. Install dependencies
npm install

# 3. Run in development mode
npm run tauri dev

# 4. Build for production
npm run tauri build
```

**Desktop features:**
- System tray integration
- LM Studio proxy (local AI on port 11435)
- Remote IORA Home embedding
- Desktop settings (brightness, kiosk, always-on-top)

## Post-Installation

### 1. Change Default Credentials

```bash
# IORA OS: Change root password immediately
passwd
```

### 2. Configure Home Assistant Integration

If you have a Home Assistant instance, configure it in the IORA Control Center:
1. Navigate to Control Center → Home Assistant
2. Enter your HA URL and Long-Lived Access Token
3. Test the connection

### 3. Install Apps and Plugins

Browse the App Store or install custom apps:
- [App Store Guide](../apps/store-guide.md)
- [Plugin Guide](../apps/plugin-guide.md)

### 4. Configure AI Assistant

Set up ORA AI for voice and chat:
- [ORA AI Configuration](../ai/README.md)

## Troubleshooting

### Service Won't Start

```bash
# Check individual service logs
docker compose logs iora-home

# Or on IORA OS:
journalctl -u iora-home -f
```

### Port Conflicts

See the [Port Reference](../system/ports.md) for all port assignments. Change ports via environment variables (e.g., `PORT=8080`).

### Database Connection Issues

```bash
# Verify PostgreSQL is running
docker compose ps postgres

# Check database connectivity
docker compose exec postgres psql -U iora -d iora_home -c "SELECT 1"
```

### Permission Denied

Ensure your API key has the correct permissions set in the Control Center.

## Next Steps

- [Quick Start Guide](quick-start.md) – First steps with IORA
- [Configuration Guide](configuration.md) – Customize your installation
- [Architecture Overview](architecture.md) – Understand IORA's design
- [App Development](../development/app-development.md) – Build your first app
