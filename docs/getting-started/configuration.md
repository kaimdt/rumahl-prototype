# Configuration Guide

This guide covers all configuration options for rumahl services.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Service Configuration](#service-configuration)
- [Database Configuration](#database-configuration)
- [AI Provider Configuration](#ai-provider-configuration)
- [Security Configuration](#security-configuration)
- [Network Configuration](#network-configuration)

## Environment Variables

rumahl services are configured through environment variables. Create a `.env` file in the repository root (copy from `.env.example`).

### Shared Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RUMAHL_ENV` | Environment mode (`development` or `production`) | `development` |
| `RUST_LOG` | Log level (`debug`, `info`, `warn`, `error`) | `info` |

### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://ora:rumahl_password@localhost:5432/rumahl_home` |
| `POSTGRES_USER` | PostgreSQL user | `ora` |
| `POSTGRES_PASSWORD` | PostgreSQL password | *(required)* |
| `POSTGRES_DB` | PostgreSQL database name | `rumahl_home` |

### Home Assistant Integration

| Variable | Description | Default |
|----------|-------------|---------|
| `HA_URL` | Home Assistant URL | `http://homeassistant.local:8123` |
| `HA_TOKEN` | Long-Lived Access Token | *(optional)* |

### JWT Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for JWT token signing | *(auto-generated in dev)* |
| `JWT_EXPIRY_HOURS` | Token expiry time | `24` |

## Service Configuration

### rumahl-home (Main API)

Port: `3001` (dev) / `8126` (production)

```env
PORT=8126
DATABASE_URL=postgres://ora:password@localhost:5432/rumahl_home
HA_URL=http://homeassistant.local:8123
HA_TOKEN=eyJ...
JWT_SECRET=your-secret-key
RUST_LOG=info
```

### rumahl-core (Orchestrator)

Port: `8090`

```env
PORT=8090
DATABASE_URL=postgres://ora:password@localhost:5432/rumahl_core
```

### rumahl-assist (AI Assistant)

Port: `8092`

```env
PORT=8092
RUMAHL_AI_PROVIDER=local          # openai, anthropic, local, desktop
RUMAHL_AI_API_KEY=sk-...          # For OpenAI/Anthropic
RUMAHL_AI_BASE_URL=http://localhost:11434  # For local/desktop
RUMAHL_AI_MODEL=llama3.2
```

### rumahl-security

Port: `8095`

```env
PORT=8095
SECURITY_DB_PATH=/var/lib/ora/security.db
SECURITY_DB_KEY=<64-hex-char-key>
AUTO_LOCKDOWN_ENABLED=true
LOCKDOWN_THRESHOLD_CRITICAL=5
THREAT_LEVEL_THRESHOLD=7
```

### rumahl-supervisor

Port: `8097`

```env
PORT=8097
RUST_LOG=info
```

### rumahl-gateway

Port: `8096`

```env
PORT=8096
GATEWAY_DB_PATH=/var/lib/ora/gateway.db
SMTP_SERVER=smtp.example.com:587
SMTP_USERNAME=noreply@example.com
SMTP_PASSWORD=<secure-password>
ENABLE_SANDBOXING=true
```

## Database Configuration

### PostgreSQL

rumahl uses PostgreSQL 16. The database is configured in `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ora
      POSTGRES_PASSWORD: rumahl_password
      POSTGRES_DB: rumahl_home
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
```

**Multiple databases:**
- `rumahl_home` – Main application data (users, pages, entities)
- `rumahl_core` – Service registry, system events
- `rumahl_secrets` – Encrypted secrets

**Connection string format:**
```
postgres://<user>:<password>@<host>:<port>/<database>
```

### App SQLite Databases

Individual apps can have their own SQLite database:

```json
{
  "database": {
    "backend": "sqlite",
    "sqlite": {
      "wal_mode": true,
      "max_size_bytes": 104857600
    }
  }
}
```

See [App Database Guide](../development/app-database.md).

## AI Provider Configuration

rumahl AI supports multiple providers. Configure via `RUMAHL_AI_PROVIDER`:

### OpenAI

```env
RUMAHL_AI_PROVIDER=openai
RUMAHL_AI_API_KEY=sk-proj-...
RUMAHL_AI_MODEL=gpt-4o-mini
```

### Anthropic Claude

```env
RUMAHL_AI_PROVIDER=anthropic
RUMAHL_AI_API_KEY=sk-ant-...
RUMAHL_AI_MODEL=claude-3-5-sonnet-20241022
```

### Local AI (Ollama)

```env
RUMAHL_AI_PROVIDER=local
RUMAHL_AI_BASE_URL=http://localhost:11434
RUMAHL_AI_MODEL=llama3.2
```

### Desktop AI (via rumahl Desktop)

```env
RUMAHL_AI_PROVIDER=desktop
RUMAHL_AI_BASE_URL=http://localhost:11435
```

## Security Configuration

### Secrets Master Key

The secrets service requires a 32-byte (64 hex characters) master key:

```env
SECRETS_MASTER_KEY=<64-hex-char-key>
```

Generate one:
```bash
openssl rand -hex 32
```

### Security Database Key

```env
SECURITY_DB_KEY=<64-hex-char-key>
```

### IP Whitelist

```env
WHITELIST_IPS=127.0.0.1,::1,10.0.0.0/8,192.168.1.0/24
```

## Network Configuration

### Port Management

See the [Port Reference](../system/ports.md) for the complete port map.

Change service ports via the `PORT` environment variable:

```env
PORT=8080   # Override default port
```

### Reverse Proxy

For production deployments behind NGINX, see [Port Management & System Enhancements](../architecture/port-management-and-system-enhancements.md).

### Domain Access Control

Apps can be restricted to specific domains:

```json
{
  "network_access": {
    "allowed_domains": ["api.example.com", "*.cdn.example.com"],
    "allowed_local_ips": ["192.168.1.100", "10.0.0.0/24"]
  }
}
```

## Configuration File Locations

### rumahl OS

| File | Location |
|------|----------|
| Service configs | `/etc/ora/*.env` |
| Binaries | `/opt/rumahl/bin/` |
| Runtime data | `/var/lib/ora/` |
| Security DB | `/var/lib/ora/security.db` |
| Gateway DB | `/var/lib/ora/gateway.db` |
| App data | `/var/lib/ora/local-apps/{app_id}/` |

### Docker

Configuration is passed via environment variables in `docker-compose.yml` or `.env` file.

### Development

Configuration via `.env` in the repository root or environment variables.

## Next Steps

- [App Development Guide](../development/app-development.md)
- [Security Guide](../security/README.md)
- [Docker Configuration Guide](../guides/docker-config.md)
- [Troubleshooting Guide](../guides/troubleshooting.md)
