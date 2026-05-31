# IORA Validation Tools

Quick reference for IORA installation validation and health checking.

## Available Tools

### 1. Health Check Script (`scripts/healthcheck.sh`)

Validates that all IORA services are running and healthy.

**Usage:**
```bash
./scripts/healthcheck.sh
```

**What it checks:**
- Critical services (postgres, iora-core, iora-secrets, iora-home)
- Optional services (supervisor, security, watchdog, etc.)
- Service health endpoints
- Database connectivity
- Container status

**Exit codes:**
- `0` - All critical services healthy
- `1` - One or more critical services failed

### 2. Service Dependency Validator (`scripts/validate-services.sh`)

Validates service dependencies and configuration before starting.

**Usage:**
```bash
./scripts/validate-services.sh
```

**What it checks:**
- All critical services are defined in docker-compose.yml
- Service dependencies are correct
- Service startup order is valid

### 3. IORA Home Migration Registration Check (`scripts/check-iora-migrations.ps1`)

Validates that every `iora-home/migrations/*.sql` file is embedded in
`iora-home/src/db/mod.rs` and that migration numbers have no gaps.

**Usage:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-iora-migrations.ps1
```

### 4. Local Development Health Suite (`scripts/iora-health-suite.ps1`)

Runs a fast local confidence suite for the current checkout.

**Usage:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/iora-health-suite.ps1
```

**Optional:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/iora-health-suite.ps1 -FullWorkspace
powershell -ExecutionPolicy Bypass -File scripts/iora-health-suite.ps1 -SkipFrontend
```

**What it checks:**
- `iora-home` migration registration
- warning scan for module-scope frontend URL caches
- `cargo build -p iora-dev-watch`
- `cargo build -p iora-home`
- optional full Rust workspace build
- frontend build unless `-SkipFrontend` is used

### 5. Frontend Config Cache Scan (`scripts/check-frontend-config-cache.ps1`)

Warns when frontend files appear to cache `getBackendUrl()` or `getAssistUrl()`
in module-scope constants. Those values can be stale because global config loads
asynchronously.

**Usage:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-frontend-config-cache.ps1
```

Use `-FailOnFinding` in CI once the existing findings have been cleaned up.

### 6. Minimal Configuration (`docker-compose.minimal.yml`)

Minimal IORA configuration with only critical services.

**Usage:**
```bash
docker compose -f docker-compose.minimal.yml up -d
```

**Includes:**
- postgres (database)
- iora-core (orchestrator)
- iora-secrets (encrypted secrets)
- iora-home (smart home server)

**Resource usage:**
- RAM: ~500MB
- Disk: ~2GB
- CPU: <5% idle

### 7. IORA OS Startup Validator (IORA OS only)

Automatically validates services during IORA OS boot.

**Location:** `/usr/bin/iora-startup-validator`

**Runs automatically** via systemd service on boot.

**Manual execution:**
```bash
/usr/bin/iora-startup-validator
```

**Logs:** `/var/log/iora-startup-validator.log`

## Quick Start Workflows

### Docker Compose - Full Stack

```bash
# 1. Configure environment
cp .env.example .env
nano .env  # Edit with your settings

# 2. Validate configuration
./scripts/validate-services.sh

# 3. Start services
docker compose up -d

# 4. Wait for startup (30-60 seconds)
sleep 60

# 5. Run health check
./scripts/healthcheck.sh

# 6. Access IORA
# IORA Home: http://localhost:8080
```

### Docker Compose - Minimal

```bash
# 1. Configure environment
cp .env.example .env
nano .env

# 2. Start minimal services
docker compose -f docker-compose.minimal.yml up -d

# 3. Run health check
./scripts/healthcheck.sh

# 4. Access IORA
# IORA Home: http://localhost:8080
```

### IORA OS

```bash
# After installation and boot:

# 1. Check startup validation
journalctl -u iora-startup-validator

# 2. Run health check
/usr/bin/iora-healthcheck

# 3. Access IORA
# IORA Home: http://[device-ip]:8080
```

## Common Issues

### Services not starting

```bash
# Check logs
docker compose logs

# Check specific service
docker compose logs iora-home

# Restart services
docker compose restart
```

### Health checks failing

```bash
# Wait longer (some services need 60+ seconds)
sleep 60
./scripts/healthcheck.sh

# Check individual service
curl http://localhost:8080/health
```

### Database connection errors

```bash
# Check PostgreSQL
docker compose logs postgres

# Verify it's running
docker compose exec postgres pg_isready -U iora

# Check databases exist
docker compose exec postgres psql -U iora -l
```

## Critical Service Requirements

These services MUST be running for IORA to function:

| Service | Purpose | Can Remove? |
|---------|---------|-------------|
| postgres | Database | ❌ No |
| iora-core | Orchestration | ❌ No |
| iora-secrets | Encrypted storage | ❌ No |
| iora-home | Smart home UI/API | ❌ No |

## Optional Service Impact

| Service | Impact if Disabled |
|---------|-------------------|
| iora-supervisor | Cannot manage containers via API |
| iora-security | No security monitoring |
| iora-watchdog | No health alerting |
| iora-gateway | No external integrations |
| iora-control | No admin panel (use iora-home) |
| iora-assist | No AI features |
| iora-appstore | Cannot install apps |

## Documentation

- **Full validation guide:** [INSTALLATION_VALIDATION.md](../INSTALLATION_VALIDATION.md)
- **Docker setup:** [DOCKER_AND_IORA_OS.md](../DOCKER_AND_IORA_OS.md)
- **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)

## Support

If validation fails:

1. Check logs: `docker compose logs`
2. Verify environment: `cat .env`
3. Check disk space: `df -h`
4. Check RAM: `free -h`
5. Review [INSTALLATION_VALIDATION.md](../INSTALLATION_VALIDATION.md)
