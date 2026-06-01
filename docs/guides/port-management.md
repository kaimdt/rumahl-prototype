# Port Management Guide

IORA manages 10,000+ ports across its system services and app containers. This guide covers how ports are assigned, configured, and managed.

## Table of Contents

- [System Port Map](#system-port-map)
- [App Port Assignment](#app-port-assignment)
- [Port Configuration in Manifests](#port-configuration-in-manifests)
- [Changing Ports](#changing-ports)
- [Troubleshooting Port Conflicts](#troubleshooting-port-conflicts)

## System Port Map

IORA system services use ports in the 8080–8099 range:

| Service | Port (Dev) | Port (Prod) | Protocol |
|---------|-----------|-------------|----------|
| iora-home | 3001 | 8126 | HTTP, WebSocket, SSE |
| iora-core | 8090 | 8090 | HTTP, SSE |
| iora-control | 8091 | 8091 | HTTP |
| iora-assist | 8092 | 8092 | HTTP |
| iora-secrets | 8093 | 8093 | HTTP |
| iora-watchdog | 8094 | 8094 | HTTP, SSE |
| iora-security | 8095 | 8095 | HTTP |
| iora-gateway | 8096 | 8096 | HTTP |
| iora-supervisor | 8097 | 8097 | HTTP |
| iora-appstore | – | 8098 | HTTP |

See the [Port Reference](../system/ports.md) for the complete port map.

## App Port Assignment

### Port Ranges

| Range | Purpose |
|-------|---------|
| 8080–8099 | System services (fixed) |
| 10000–19999 | App containers (random assignment from pool) |
| 50000–50999 | Reserved for special services |

### Assignment Modes

Apps declare port assignment in `manifest.json`:

#### Random (Recommended for Security)

```json
{
  "internal_ports": [
    {
      "port": 3000,
      "protocol": "tcp",
      "assignment_mode": "random",
      "description": "Web server"
    }
  ]
}
```

**Behavior:**
- A random host port (10000–19999) is assigned on each container start
- Changes on every restart
- Prevents port scanning predictability
- Best for internal app UIs

**Access the app:**
```
http://localhost:8126/api/apps/{app_id}/proxy/
```

The proxy automatically routes to the correct random port. You never need to know the actual port number.

#### Fixed (For External Integrations)

```json
{
  "internal_ports": [
    {
      "port": 8080,
      "protocol": "tcp",
      "assignment_mode": "fixed",
      "description": "API server (stable port)"
    }
  ]
}
```

**Behavior:**
- Uses the declared port directly
- Same port across restarts
- Required for apps that expose APIs consumed by external services
- Use sparingly and with caution

**Access the app directly:**
```
http://localhost:8080
```

## Port Configuration in Manifests

### Full Port Configuration

```json
{
  "internal_ports": [
    {
      "port": 3000,
      "protocol": "tcp",
      "assignment_mode": "random",
      "description": "Web UI",
      "health_check": {
        "endpoint": "/health",
        "interval": 30,
        "timeout": 10,
        "retries": 3
      }
    },
    {
      "port": 5432,
      "protocol": "tcp",
      "assignment_mode": "fixed",
      "description": "PostgreSQL"
    }
  ]
}
```

### Port Properties

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | (required) | Internal container port |
| `protocol` | string | `"tcp"` | Protocol (`tcp` or `udp`) |
| `assignment_mode` | string | `"random"` | Port assignment strategy |
| `description` | string | – | Human-readable description |
| `health_check` | object | – | Health check configuration |

## Changing Ports

### System Service Ports

Change via the `PORT` environment variable:

```env
# .env file
PORT=8080   # Override default
```

```bash
# Docker
docker compose -f deploy/docker-compose.yml up -d

# Or restart individual service
docker compose restart iora-home
```

### App Ports

Apps declare ports in their manifest. To change:

1. Update `manifest.json` with new port configuration
2. Reinstall or update the app
3. Restart the container

## Troubleshooting Port Conflicts

### Check Port Usage

```bash
# Check if a port is in use
lsof -i :8126
ss -tlnp | grep 8126

# Check all IORA ports
ss -tlnp | grep -E ':(808[0-9]|809[0-9]|8126)'
```

### Check Docker Ports

```bash
# List all container port mappings
docker ps --format "table {{.Names}}\t{{.Ports}}"

# Check specific container
docker port iora-home
```

### Common Issues

**"Address already in use" error:**
- Another service is using the port
- Solution: Change the `PORT` variable or stop the conflicting service

**App proxy not working:**
- Check if the app container is running: `docker ps | grep iora-app-`
- Check the assigned random port: `docker port iora-app-{app_id}`
- Verify the health check is passing

**Can't access app on fixed port:**
- Ensure `assignment_mode` is `"fixed"`
- Check firewall rules
- Verify no port conflict with other services

### Port Assignment Logs

```bash
# View supervisor logs for port assignment
docker compose logs iora-supervisor | grep -i port
journalctl -u iora-supervisor | grep -i port
```

## Best Practices

1. **Use random assignment** for app UIs – more secure
2. **Use fixed assignment only when necessary** – for external API consumers
3. **Always define health checks** – helps detect port issues early
4. **Use the proxy** – access apps through `/api/apps/{app_id}/proxy/` not direct ports
5. **Monitor port usage** – set up alerts for unexpected port allocations

## Related Documentation

- [Port Reference](../system/ports.md) – Complete port map
- [Docker Configuration](docker-config.md) – Docker networking
- [Network Security](../security/network.md) – Network access control
