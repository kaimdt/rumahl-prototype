# IORA Installation Validation Guide

This document ensures both IORA installation methods work securely and that IORA functions properly with minimal services.

## Installation Methods

IORA supports two primary installation methods:

1. **IORA OS** - Custom Linux operating system (**RECOMMENDED** for production)
2. **Docker Compose** - Containerized deployment on any Docker-compatible system

### Key Differences

| Feature | IORA OS | Docker Compose |
|---------|---------|----------------|
| **iora-supervisor** | ✅ Included (automatic container management) | ❌ Not available (manual management) |
| **AppArmor profiles** | ✅ Built-in security | ⚠️ Requires manual setup |
| **RAUC updates** | ✅ Atomic updates with rollback | ❌ Manual updates |
| **System integration** | ✅ Optimized OS | ⚠️ Depends on host OS |
| **App installation** | ✅ Full app store functionality | ⚠️ Limited (no supervisor) |
| **Ease of updates** | ✅ One-click updates | ⚠️ Manual docker compose pull |
| **Resource usage** | ✅ Minimal OS footprint | ⚠️ Depends on host OS |

**Recommendation**: Use **IORA OS** for production deployments. Use Docker Compose for development or testing.

## Minimal Service Requirements

### Critical Services (REQUIRED)

These services are essential for basic IORA functionality:

| Service | Port | Purpose | Can be Disabled? |
|---------|------|---------|------------------|
| `postgres` | 5432 | Database for all IORA data | ❌ No |
| `iora-core` | 8090 | Central orchestrator and API | ❌ No |
| `iora-secrets` | 8093 | Encrypted secrets storage | ❌ No |
| `iora-home` | 8080 | Smart home server and UI | ❌ No |

**Minimum viable configuration**: 4 services (postgres + iora-core + iora-secrets + iora-home)

### Optional Services

These services provide additional functionality but are not required for basic operation:

| Service | Port | Purpose | Can be Disabled? | IORA OS Only? |
|---------|------|---------|------------------|---------------|
| `iora-supervisor` | 8097 | Docker container orchestration | ✅ Yes | ✅ **Yes** (requires privileged Docker access) |
| `iora-security` | 8095 | Security monitoring and threat detection | ✅ Yes (reduces security features) | ❌ No |
| `iora-watchdog` | 8094 | Health monitoring and alerting | ✅ Yes (reduces monitoring) | ❌ No |
| `iora-gateway` | 8096 | External integrations (email, webhooks) | ✅ Yes (disables external notifications) | ❌ No |
| `iora-control` | 8091 | Admin panel for system management | ✅ Yes (use iora-home for basic admin) | ❌ No |
| `iora-assist` | 8092 | AI assistant | ✅ Yes (disables AI features) | ❌ No |
| `iora-appstore` | 8098 | App marketplace and management | ✅ Yes (limited without supervisor) | ❌ No |

**Important**: `iora-supervisor` is **ONLY** available on IORA OS as it requires privileged access to the Docker socket. On Docker Compose installations, containers must be managed manually via `docker compose` commands.

## Installation Method 1: Docker Compose

**Note**: This method does NOT include `iora-supervisor`. Container management must be done manually using `docker compose` commands. For automatic container management, use **IORA OS**.

### Full Stack Installation

**Prerequisites:**
- Docker 20.10+
- Docker Compose 2.0+
- 4GB+ RAM
- 20GB+ disk space

**Steps:**

1. **Clone repository**
   ```bash
   git clone https://github.com/your-org/iora.git
   cd iora
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   nano .env
   ```

   **Required environment variables:**
   ```env
   # PostgreSQL
   POSTGRES_PASSWORD=your_secure_password

   # Security keys (generate with: openssl rand -hex 32)
   JWT_SECRET=<64-char-hex>
   SECRETS_MASTER_KEY=<64-char-hex>

   # Home Assistant (if integrating)
   HA_URL=http://homeassistant.local:8123
   HA_TOKEN=your_ha_token
   ```

3. **Build and start all services**
   ```bash
   docker compose build
   docker compose up -d
   ```

4. **Verify installation**
   ```bash
   ./scripts/healthcheck.sh
   ```

5. **Access IORA**
   - IORA Home: http://iora.local:8080
   - IORA Control: http://iora.local:8091

**Expected behavior:**
- ✅ All containers start without errors
- ✅ Health checks pass within 30 seconds
- ✅ IORA Home UI accessible on port 8080
- ✅ Can register new user and log in
- ✅ Home Assistant entities visible (if configured)

### Minimal Installation

For testing or resource-constrained environments:

```bash
docker compose -f docker-compose.minimal.yml up -d
```

This starts only critical services:
- postgres
- iora-core
- iora-secrets
- iora-home

**Resource usage (minimal):**
- RAM: ~500MB
- CPU: <5% idle
- Disk: ~2GB

**Limitations:**
- No supervisor (manual Docker management required via `docker compose` commands)
- No automatic app installation (iora-appstore has limited functionality without supervisor)
- No security monitoring
- No health monitoring
- No external integrations
- No AI assistant

**Note**: Use `docker compose` commands to manage containers:
- Start: `docker compose -f docker-compose.minimal.yml up -d`
- Stop: `docker compose -f docker-compose.minimal.yml down`
- Restart: `docker compose -f docker-compose.minimal.yml restart`
- View logs: `docker compose -f docker-compose.minimal.yml logs`

## Installation Method 2: IORA OS

### Prerequisites

- x86_64 system with UEFI or ARM64 device
- 2GB+ RAM (4GB+ recommended)
- 16GB+ storage (32GB+ recommended)
- Network connection

### Installation Steps

1. **Download IORA OS image**
   ```bash
   wget https://releases.iora.io/iora-os-latest.img.xz
   ```

2. **Flash to USB/SD card**
   ```bash
   xzcat iora-os-latest.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
   sync
   ```

3. **Boot from device**
   - Insert USB/SD card
   - Boot from device (may need to change BIOS boot order)
   - Installer starts automatically

4. **Run installer**
   - Follow on-screen prompts
   - Configure hostname, network, timezone
   - Select installation disk
   - Set root password

5. **First boot**
   - System boots into IORA OS
   - Docker starts automatically
   - **iora-supervisor launches all services automatically**
   - Wait 2-3 minutes for all containers to start

6. **Verify installation**
   ```bash
   ssh root@iora-os-device
   /usr/bin/iora-healthcheck
   ```

7. **Access IORA**
   - IORA Home: http://[device-ip]:8080
   - IORA Control: http://[device-ip]:8091
   - **IORA Supervisor**: http://[device-ip]:8097

**Expected behavior:**
- ✅ System boots within 30 seconds
- ✅ Docker starts automatically
- ✅ **iora-supervisor starts and manages all containers**
- ✅ All containers launch within 2 minutes
- ✅ Health checks pass
- ✅ IORA Home accessible via network
- ✅ Can register and login
- ✅ **Apps can be installed via App Store**

### IORA OS Minimal Mode

IORA OS can be configured to run only critical services to reduce resource usage:

1. **Edit supervisor configuration**
   ```bash
   nano /etc/iora/supervisor.conf
   ```

2. **Disable optional services**
   ```ini
   [services]
   enable_security=false
   enable_watchdog=false
   enable_gateway=false
   enable_control=false
   enable_assist=false
   enable_appstore=false
   ```

3. **Restart supervisor**
   ```bash
   systemctl restart iora-supervisor
   ```

## Validation Checklist

### Pre-Installation Validation

- [ ] Sufficient disk space available
- [ ] Sufficient RAM available
- [ ] Docker installed (for Docker Compose method)
- [ ] Network connectivity available
- [ ] Environment variables configured
- [ ] Security keys generated

### Post-Installation Validation

#### Critical Services
- [ ] PostgreSQL running and healthy
- [ ] iora-core running and responding on port 8090
- [ ] iora-secrets running and responding on port 8093
- [ ] iora-home running and responding on port 8080
- [ ] Can access IORA Home UI
- [ ] Can register new user
- [ ] Can log in with credentials
- [ ] Database tables created successfully

#### Optional Services (if enabled)
- [ ] iora-supervisor accessible on port 8097
- [ ] iora-security accessible on port 8095
- [ ] iora-watchdog accessible on port 8094
- [ ] iora-gateway accessible on port 8096
- [ ] iora-control accessible on port 8091
- [ ] iora-assist accessible on port 8092
- [ ] iora-appstore accessible on port 8098

#### Security Validation
- [ ] Default passwords changed
- [ ] JWT secret is unique (not default)
- [ ] Secrets master key is unique (not default)
- [ ] AppArmor profiles loaded (IORA OS only)
- [ ] Containers running as non-root user
- [ ] Database credentials secure

#### Functionality Validation
- [ ] Home Assistant connection works (if configured)
- [ ] Entity states sync correctly
- [ ] Service calls execute successfully
- [ ] WebSocket connection stable
- [ ] User authentication works
- [ ] API endpoints respond correctly

## Health Check Script

Run the automated health check:

```bash
./scripts/healthcheck.sh
```

This script validates:
- All critical services are running
- Health endpoints respond correctly
- Database connections work
- Optional services status
- Overall system health

**Exit codes:**
- `0` - All critical services healthy
- `1` - One or more critical services failed

## Troubleshooting

### Docker Compose Installation Issues

**Problem: Containers fail to start**
```bash
# Check logs
docker compose logs

# Rebuild images
docker compose build --no-cache
docker compose up -d
```

**Problem: Database connection errors**
```bash
# Check PostgreSQL
docker compose logs postgres

# Verify databases
docker compose exec postgres psql -U iora -l
```

**Problem: Port conflicts**
```bash
# Check what's using ports
sudo lsof -i :8080
sudo lsof -i :8090

# Change ports in .env file
nano .env
# Modify HOME_PORT, CORE_PORT, etc.
```

### IORA OS Installation Issues

**Problem: Installer doesn't boot**
- Verify image was written correctly
- Check BIOS boot order
- Try different USB port
- Verify UEFI mode (for x86_64)

**Problem: Network not working**
- Check network cable connection
- Run `ip addr` to see interfaces
- Try DHCP: `dhclient eth0`
- Check installer network configuration

**Problem: Services don't start after installation**
```bash
# Check Docker status
systemctl status docker

# Check supervisor status
systemctl status iora-supervisor

# View supervisor logs
journalctl -u iora-supervisor -f

# Manually start services
docker compose -f /etc/iora/docker-compose.yml up -d
```

## Performance Benchmarks

### Minimal Configuration (4 services)

| Metric | Value |
|--------|-------|
| Startup time | 20-30 seconds |
| RAM usage (idle) | ~500MB |
| RAM usage (active) | ~800MB |
| CPU usage (idle) | <5% |
| CPU usage (active) | 10-20% |
| Disk usage | ~2GB |

### Full Configuration (11 services)

| Metric | Value |
|--------|-------|
| Startup time | 40-60 seconds |
| RAM usage (idle) | ~1.5GB |
| RAM usage (active) | ~2.5GB |
| CPU usage (idle) | <10% |
| CPU usage (active) | 20-40% |
| Disk usage | ~5GB |

## Security Best Practices

### For Both Installation Methods

1. **Change default passwords immediately**
   ```bash
   # Docker Compose: edit .env
   nano .env

   # IORA OS: change root password
   passwd
   ```

2. **Generate unique security keys**
   ```bash
   openssl rand -hex 32  # For JWT_SECRET
   openssl rand -hex 32  # For SECRETS_MASTER_KEY
   openssl rand -hex 32  # For SECURITY_DB_KEY
   ```

3. **Restrict network access**
   ```bash
   # Firewall rules
   ufw allow 8080/tcp  # IORA Home
   ufw enable
   ```

4. **Regular updates**
   ```bash
   # Docker Compose
   docker compose pull
   docker compose up -d

   # IORA OS
   rauc install /path/to/update.raucb
   reboot
   ```

5. **Monitor logs**
   ```bash
   # Docker Compose
   docker compose logs -f

   # IORA OS
   journalctl -f
   ```

## Support

If you encounter issues not covered in this guide:

1. Check logs: `docker compose logs` or `journalctl -f`
2. Run health check: `./scripts/healthcheck.sh`
3. Verify environment variables in `.env`
4. Consult [ARCHITECTURE.md](ARCHITECTURE.md) for system details
5. Check [DOCKER_AND_IORA_OS.md](DOCKER_AND_IORA_OS.md) for detailed setup

## Conclusion

Both installation methods are designed to work reliably with minimal configuration. The minimal service configuration (4 services) provides a fully functional smart home system with reduced resource requirements, while the full configuration adds monitoring, security features, and AI capabilities.

**Key takeaways:**
- ✅ IORA works with just 4 critical services
- ✅ Both Docker Compose and IORA OS methods are validated
- ✅ Automated health checks ensure system integrity
- ✅ Security best practices are documented
- ✅ Clear troubleshooting steps provided
