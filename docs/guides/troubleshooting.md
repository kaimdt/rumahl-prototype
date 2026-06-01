# Troubleshooting Guide

Common issues and solutions for IORA.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Service Issues](#service-issues)
- [App Issues](#app-issues)
- [Plugin Issues](#plugin-issues)
- [Database Issues](#database-issues)
- [Network Issues](#network-issues)
- [Performance Issues](#performance-issues)
- [Diagnostic Tools](#diagnostic-tools)

## Installation Issues

### Docker Compose Fails to Start

**Symptom:** `docker compose up -d` fails with errors.

```bash
# Check Docker daemon is running
docker info

# Check port conflicts
ss -tlnp | grep -E ':(8126|8090|8091|8092|8093|8094|8095|8096|8097|5432)'

# Check disk space
df -h

# View specific service logs
docker compose logs iora-home
```

**Solutions:**
- Ensure Docker Engine 24+ is installed
- Free up port if another service is using it
- Check `.env` file for correct configuration
- Ensure at least 4 GB free disk space

### IORA OS Won't Boot

**Symptom:** Device doesn't boot after flashing IORA OS.

```bash
# Verify the image is not corrupted
sha256sum iora-os.img.xz

# Try re-flashing with a different USB port/SD card
# Check if your device is supported (x86_64 UEFI or ARM64)
```

### Permission Denied on Docker Socket

**Symptom:** `permission denied while trying to connect to the Docker daemon socket`

```bash
# Add your user to the docker group
sudo usermod -aG docker $USER
# Log out and back in, or run:
newgrp docker
```

## Service Issues

### Service Won't Start

**Symptom:** A specific IORA service doesn't start.

```bash
# Check service logs
docker compose logs iora-home
# Or for IORA OS:
journalctl -u iora-home -n 50

# Check if the service is running
docker compose ps | grep iora-home

# Check health endpoint
curl http://localhost:8126/health
```

**Common causes:**
- Port already in use
- Missing environment variables
- Database connection failure
- Insufficient memory

### Service Keeps Restarting

**Symptom:** Service enters a restart loop.

```bash
# Check restart count
docker compose ps

# View last crash logs
docker compose logs --tail=200 iora-home

# Check system resources
free -h
df -h
```

**Solutions:**
- Check the service logs for the error
- Verify database is reachable
- Check memory limits
- Try starting with increased verbosity: `RUST_LOG=debug`

### Health Check Failing

**Symptom:** Service shows as "unhealthy" in `docker compose ps`.

```bash
# Inspect health check details
docker inspect iora-home | jq '.[0].State.Health'

# Manually test health endpoint
curl -v http://localhost:8126/health
```

## App Issues

### App Won't Start

**Symptom:** App status shows "stopped" or "error".

```bash
# Check app status
curl http://localhost:8097/api/supervisor/apps/{app_id}

# Check app logs
curl http://localhost:8126/api/apps/{app_id}/logs

# Check Docker container
docker ps -a | grep iora-app-{app_id}
docker logs iora-app-{app_id}
```

**Common causes:**
- Invalid `start_cmd` in manifest
- Missing dependencies (install failed)
- Port conflict
- Environment variable issues
- Health check failing

### App Installed But Not Visible

**Symptom:** App installed but doesn't appear in navigation.

**Checklist:**
1. Is the app running? `GET /api/supervisor/apps/{app_id}`
2. Does the manifest have `custom_pages` with `show_in_nav: true`?
3. Does the user have sufficient role for the page?
4. Check app pages: `GET /api/apps/pages`

### App Shows Error Page

**Symptom:** Clicking an app page shows an error.

```bash
# Check app proxy health
curl http://localhost:8126/api/apps/{app_id}/proxy/

# Check container is running
docker ps | grep iora-app-{app_id}

# Check container IP and port
docker inspect iora-app-{app_id} | jq '.[0].NetworkSettings'
```

### App Container Build Fails

**Symptom:** Docker build fails during app installation.

```bash
# Check build logs
docker compose logs iora-supervisor | grep -i build

# Test the build manually
cd /var/lib/iora/local-apps/{app_id}
docker build -t test-build .
```

**Common causes:**
- Invalid `install_cmd` or `build_cmd`
- Unsupported base image
- Network issues during `npm install`/`pip install`
- Insufficient disk space for build

## Plugin Issues

### Plugin Won't Execute

**Symptom:** Plugin execution returns an error or timeout.

```bash
# Check plugin status
curl http://localhost:8090/api/core/plugins/{plugin_id}

# Check plugin logs
curl http://localhost:8090/api/core/plugins/{plugin_id}/logs

# Check sandbox status
curl http://localhost:8090/api/core/sandbox/status
```

**Common causes:**
- Plugin not enabled: `POST /api/core/plugins/{id}/enable`
- Missing `index.js` or `main.py` entry point
- Execution timeout (default 5s) – increase `sandbox.max_execution_time_ms`
- Memory limit exceeded (default 128 MB)
- Network access denied (plugins have no network by default)

### Plugin Returns Empty Output

**Symptom:** Plugin executes but returns no data.

**Check:**
- Your plugin must return JSON via the `execute()` function
- Check for syntax errors in the plugin code
- Verify the input format matches what your plugin expects
- Try running with higher verbosity

## Database Issues

### PostgreSQL Connection Failed

**Symptom:** Services log database connection errors.

```bash
# Check PostgreSQL is running
docker compose ps postgres
# Or for IORA OS:
systemctl status postgresql

# Test connection
docker compose exec postgres psql -U iora -d iora_home -c "SELECT 1"

# Check connection count
docker compose exec postgres psql -U iora -d iora_home -c \
  "SELECT count(*) FROM pg_stat_activity"
```

**Solutions:**
- Ensure PostgreSQL container is running and healthy
- Verify `DATABASE_URL` in `.env`
- Check PostgreSQL logs: `docker compose logs postgres`
- Check disk space for PostgreSQL data volume

### SQLite Database Corrupted

**Symptom:** App database operations fail.

```bash
# Check database integrity
sqlite3 /var/lib/iora/local-apps/{app_id}/database.sqlite "PRAGMA integrity_check"

# Restore from backup
curl -X POST http://localhost:8126/api/apps/{app_id}/database/backup
# Then check available backups:
curl http://localhost:8126/api/apps/{app_id}/database/backups
```

### Database Migration Failed

**Symptom:** Service logs migration errors on startup.

```bash
# Check migration status
docker compose logs iora-home | grep -i migration

# Manually run migrations (development)
cd iora-os/backend/services/iora-home
cargo run --bin migrate
```

**Solutions:**
- Never modify existing migrations – create new ones
- Check migration files in `services/iora-home/migrations/`
- Verify database user has sufficient permissions

## Network Issues

### Can't Access IORA

**Symptom:** Browser can't connect to IORA.

```bash
# Check service is listening
curl http://localhost:8126/health

# Check firewall
sudo ufw status
sudo iptables -L -n

# Check Docker network
docker network ls
docker network inspect iora_default
```

**Solutions:**
- Ensure the service port is not blocked by firewall
- Check the service is binding to `0.0.0.0`, not `127.0.0.1`
- For Docker, check port mapping: `docker port iora-home`

### App Can't Access External API

**Symptom:** App reports network errors when calling external services.

```bash
# Test connectivity from app container
docker exec iora-app-{app_id} wget -O- https://api.example.com

# Check DNS in container
docker exec iora-app-{app_id} nslookup api.example.com
```

**Solutions:**
- Check `network_access.allowed_domains` in manifest
- Verify the domain is in the whitelist
- Check if user has added domains: `allow_user_domains: true`
- Docker DNS issues: check `/etc/resolv.conf` in container

### Port Already in Use

**Symptom:** Service fails with "Address already in use".

```bash
# Find what's using the port
sudo lsof -i :8126
sudo ss -tlnp | grep 8126

# Change the port in .env
PORT=8080   # Use a different port
```

## Performance Issues

### High CPU Usage

```bash
# Check per-service CPU usage
docker stats --no-stream

# Check system load
top -bn1 | head -20

# Check which process is consuming CPU
docker top iora-home
```

**Solutions:**
- Check for infinite loops in plugins
- Reduce cron job frequency
- Check Home Assistant polling interval
- Scale down resource-intensive apps

### High Memory Usage

```bash
# Check memory usage
free -h
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Check for memory leaks
docker stats iora-home
```

**Solutions:**
- Increase Docker memory limit for the service
- Check for memory leaks in custom plugins
- Reduce the number of concurrently running apps
- Restart services periodically if needed

### Slow Dashboard

**Symptom:** Dashboard widgets load slowly.

```bash
# Check API response times
time curl http://localhost:8126/api/states

# Check database query performance
docker compose exec postgres psql -U iora -d iora_home -c \
  "SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10"
```

**Solutions:**
- Reduce number of widgets on a page
- Increase widget refresh intervals
- Check for slow database queries
- Verify Home Assistant connection is responsive

## Diagnostic Tools

### Health Check All Services

```bash
#!/bin/bash
SERVICES=(
  "8126:iora-home"
  "8090:iora-core"
  "8091:iora-control"
  "8092:iora-assist"
  "8093:iora-secrets"
  "8094:iora-watchdog"
  "8095:iora-security"
  "8096:iora-gateway"
  "8097:iora-supervisor"
)

for svc in "${SERVICES[@]}"; do
  port="${svc%%:*}"
  name="${svc##*:}"
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port/health" 2>/dev/null)
  if [ "$status" = "200" ]; then
    echo "✅ $name (port $port): healthy"
  else
    echo "❌ $name (port $port): $status"
  fi
done
```

### System Information

```bash
# IORA version
curl -s http://localhost:8126/health | jq .

# Docker info
docker info --format '{{.ServerVersion}}, {{.Containers}} containers'

# System resources
echo "CPU: $(top -bn1 | grep 'Cpu(s)' | awk '{print $2}')%"
echo "Memory: $(free -h | grep Mem | awk '{print $3 "/" $2}')"
echo "Disk: $(df -h / | tail -1 | awk '{print $3 "/" $2}')"
```

### Gather Logs for Support

```bash
# Export all service logs
docker compose logs > iora-logs-$(date +%Y%m%d).txt

# System info
uname -a > system-info.txt
docker info >> system-info.txt

# Compress
tar czf iora-support-$(date +%Y%m%d).tar.gz iora-logs-*.txt system-info.txt
```

### Reset to Default State

```bash
# Warning: This removes all data!
docker compose down -v   # Remove containers and volumes
docker compose up -d      # Fresh start
```

## Common Error Messages

| Error | Likely Cause | Solution |
|-------|-------------|----------|
| `Connection refused` | Service not running | Start the service |
| `401 Unauthorized` | Invalid/missing token | Re-login, check API key |
| `403 Forbidden` | Insufficient permissions | Check app permissions |
| `404 Not Found` | Invalid endpoint/ID | Verify URL and resource ID |
| `409 Conflict` | Duplicate resource | Use unique IDs |
| `429 Too Many Requests` | Rate limited | Reduce request frequency |
| `500 Internal Server Error` | Server bug | Check logs, report issue |
| `502 Bad Gateway` | Proxy error | Check upstream service |
| `503 Service Unavailable` | Service overloaded | Check resources, restart |

## Still Need Help?

1. **Check the logs** – Most issues are visible in service logs
2. **Search existing issues** – [GitHub Issues](https://github.com/kaimdt/home-assistant-dashb/issues)
3. **Ask the community** – [GitHub Discussions](https://github.com/kaimdt/home-assistant-dashb/discussions)
4. **Report a bug** – Include logs, system info, and steps to reproduce

## Related Documentation

- [Installation Guide](../getting-started/installation.md)
- [Configuration Guide](../getting-started/configuration.md)
- [Port Management](port-management.md)
- [Database Security](../database-security.md)
