---
title: Installation
description: Install rumahl OS on any platform — system requirements, flashing images, Docker Compose and development mode.
readTime: 8 min
category: setup
updated: 2026-08-20
featured: true
---

This guide covers installing rumahl on all supported platforms. Choose the method that fits your hardware — a dedicated device, an existing Linux server or a development machine.

## One-line installer

The fastest way — the script detects your system and installs automatically:

```bash
curl -fsSL https://rumahl.com/install | bash
```

Non-interactive server install with Docker:

```bash
curl -fsSL https://rumahl.com/install | bash -s -- --server
```

Flash an image to a device:

```bash
curl -fsSL https://rumahl.com/install | bash -s -- --device /dev/sdX
```

## System requirements

| Component | Minimum | Recommended |
| --- | --- | --- |
| CPU | 2 cores (ARM64 or x86_64) | 4 cores |
| RAM | 512 MB (Raspberry Pi 4) / 900 MB (VM) | 2 GB+ (8 GB+ for ORA AI) |
| Disk | 8 GB free | 20 GB+ SSD |
| OS | Debian 12+, Ubuntu 22.04+, macOS 13+, Raspberry Pi OS | same |

**Supported hardware:** x86_64 with UEFI (Intel/AMD servers, NUCs), Raspberry Pi 4 (4 GB+ recommended), Rock Pi 4, Odroid N2+, generic ARM64 boards.

## Install rumahl OS on hardware

rumahl OS is a custom Buildroot-based operating system with a read-only SquashFS root filesystem, A/B partition updates via RAUC and Docker Engine for all services.

```bash
# 1. Download the pre-built image
wget https://github.com/rumahl/rumahl/releases/latest/download/rumahl-os.img.xz

# 2. Verify the checksum
sha256sum rumahl-os.img.xz

# 3. Flash to your device (replace /dev/sdX)
xzcat rumahl-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress

# 4. Boot and open the web interface at http://[device-ip]:8126
```

> **Important:** the default credentials are `root / ora` — change them immediately on first login.

Key features of rumahl OS:

- Buildroot LTS Linux — minimal, secure kernel
- SquashFS root filesystem — read-only, compressed (LZ4)
- ZRAM — compressed RAM for `/tmp`, `/var`, swap
- RAUC A/B updates — atomic updates with rollback
- AppArmor — mandatory access control for all services

## Docker Compose on Linux servers

For standard Linux servers, rumahl runs as a fully containerized system managed by `rumahl-supervisor`.

```bash
# 1. Clone the repository
git clone https://github.com/rumahl/rumahl.git
cd rumahl/deploy

# 2. Configure and start
cp ../.env.example ../.env
docker compose up -d
```

Wait 30–60 seconds for all services to initialize, then open the dashboard at `http://localhost:8126`.

## Development mode (direct host)

For development directly on the host, see the development documentation — the backend is a Rust workspace started via `start.bat`/`start.sh`, the frontend runs on port 5173, the backend on port 3001.

## Post-installation checklist

1. Change the default credentials
2. Create your admin account in the dashboard
3. Check the update center for the latest version
4. Set up an automatic backup (Settings → Backup)
5. Optionally connect Home Assistant

> **Tip:** a DHCP reservation in your router keeps the device IP stable — otherwise the IP can change after a reboot.
