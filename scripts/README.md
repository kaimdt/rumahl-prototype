# rumahl Validation Tools

Quick reference for rumahl installation validation and health checking.

## Available Tools

### 1. Health Check Script (`scripts/healthcheck.sh`)

Validates that all rumahl services are running and healthy.

**Usage:**
```bash
./scripts/healthcheck.sh
```

**What it checks:**
- Critical services (postgres, rumahl-core, rumahl-secrets, rumahl-home)
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

### 3. rumahl Home Migration Registration Check (`scripts/check-rumahl-migrations.ps1`)

Validates that every `rumahl-home/migrations/*.sql` file is embedded in
`rumahl-home/src/db/mod.rs` and that migration numbers have no gaps.

**Usage:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-rumahl-migrations.ps1
```

### 4. Local Development Health Suite (`scripts/rumahl-health-suite.ps1`)

Runs a fast local confidence suite for the current checkout.

**Usage:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/rumahl-health-suite.ps1
```

**Optional:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/rumahl-health-suite.ps1 -FullWorkspace
powershell -ExecutionPolicy Bypass -File scripts/rumahl-health-suite.ps1 -SkipFrontend
```

Linux/macOS:
```bash
bash scripts/rumahl-health-suite.sh --full-workspace
bash scripts/rumahl-health-suite.sh --skip-frontend
```

**What it checks:**
- `rumahl-home` migration registration
- warning scan for module-scope frontend URL caches
- cross-platform script coverage (`*.ps1` files must have sibling `*.sh` files)
- app/plugin/theme example manifests and build wrappers
- `cargo build -p rumahl-dev-watch`
- `cargo build -p rumahl-home`
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

Linux/macOS:
```bash
bash scripts/check-frontend-config-cache.sh
```

Use `-FailOnFinding` in CI once the existing findings have been cleaned up.
For Linux/macOS, use `--fail-on-finding`.

### 6. Cross-Platform Script Pair Check

Ensures every PowerShell script in the repository has a same-directory `.sh`
counterpart for Linux and macOS workflows.

**Usage:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-cross-platform-scripts.ps1
```

Linux/macOS:
```bash
bash scripts/check-cross-platform-scripts.sh
```

### 7. App/Plugin/Theme Example Check

Validates example app, plugin, and theme manifests and checks that each example
ships both `build.ps1` and `build.sh`.

**Usage:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-app-plugin-theme-examples.ps1
```

Linux/macOS:
```bash
bash scripts/check-app-plugin-theme-examples.sh
```

### 8. Minimal Configuration (`docker-compose.minimal.yml`)

Minimal rumahl configuration with only critical services.

**Usage:**
```bash
docker compose -f docker-compose.minimal.yml up -d
```

**Includes:**
- postgres (database)
- rumahl-core (orchestrator)
- rumahl-secrets (encrypted secrets)
- rumahl-home (smart home server)

**Resource usage:**
- RAM: ~500MB
- Disk: ~2GB
- CPU: <5% idle

### 9. rumahl OS Startup Validator (rumahl OS only)

Automatically validates services during rumahl OS boot.

**Location:** `/usr/bin/rumahl-startup-validator`

**Runs automatically** via systemd service on boot.

**Manual execution:**
```bash
/usr/bin/rumahl-startup-validator
```

**Logs:** `/var/log/rumahl-startup-validator.log`

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

# 6. Access rumahl
# rumahl Home: http://localhost:8080
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

# 4. Access rumahl
# rumahl Home: http://localhost:8080
```

### rumahl OS

```bash
# After installation and boot:

# 1. Check startup validation
journalctl -u rumahl-startup-validator

# 2. Run health check
/usr/bin/rumahl-healthcheck

# 3. Access rumahl
# rumahl Home: http://[device-ip]:8080
```

## Common Issues

### Services not starting

```bash
# Check logs
docker compose logs

# Check specific service
docker compose logs rumahl-home

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
docker compose exec postgres pg_isready -U ora

# Check databases exist
docker compose exec postgres psql -U ora -l
```

## Critical Service Requirements

These services MUST be running for rumahl to function:

| Service | Purpose | Can Remove? |
|---------|---------|-------------|
| postgres | Database | ❌ No |
| rumahl-core | Orchestration | ❌ No |
| rumahl-secrets | Encrypted storage | ❌ No |
| rumahl-home | Smart home UI/API | ❌ No |

## Optional Service Impact

| Service | Impact if Disabled |
|---------|-------------------|
| rumahl-supervisor | Cannot manage containers via API |
| rumahl-security | No security monitoring |
| rumahl-watchdog | No health alerting |
| rumahl-gateway | No external integrations |
| rumahl-control | No admin panel (use rumahl-home) |
| rumahl-assist | No AI features |
| rumahl-appstore | Cannot install apps |

## Documentation

- **Full validation guide:** [INSTALLATION_VALIDATION.md](../INSTALLATION_VALIDATION.md)
- **Docker setup:** [DOCKER_AND_RUMAHL_OS.md](../DOCKER_AND_RUMAHL_OS.md)
- **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)

## Support

If validation fails:

1. Check logs: `docker compose logs`
2. Verify environment: `cat .env`
3. Check disk space: `df -h`
4. Check RAM: `free -h`
5. Review [INSTALLATION_VALIDATION.md](../INSTALLATION_VALIDATION.md)
