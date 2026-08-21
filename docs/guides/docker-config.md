# Docker Configuration Guide

This guide covers Docker configuration for rumahl apps, including container setup, networking, health checks, and multi-container bundles.

## Table of Contents

- [Auto-Build vs Pre-Built Images](#auto-build-vs-pre-built-images)
- [Container Configuration](#container-configuration)
- [Health Checks](#health-checks)
- [Networking](#networking)
- [Volumes and Persistence](#volumes-and-persistence)
- [Resource Limits](#resource-limits)
- [Multi-Container Bundles](#multi-container-bundles)

## Auto-Build vs Pre-Built Images

### Auto-Build (Recommended for Development)

rumahl builds the Docker image from your app's source code:

```json
{
  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "working_dir": "/app",
    "install_cmd": "npm install",
    "start_cmd": "node server.js",
    "build_args": {
      "NODE_ENV": "production"
    }
  }
}
```

**Process:**
1. rumahl creates a Dockerfile from your configuration
2. Copies your app files to `/app`
3. Runs `install_cmd` (e.g., `npm install`)
4. Sets `start_cmd` as the container entrypoint
5. Builds and tags the image

### Pre-Built Image (For Published Apps)

Reference an existing Docker image:

```json
{
  "docker": {
    "auto_build": false,
    "image": "registry.example.com/my-app:1.0.0",
    "registry_auth": {
      "username": "${REGISTRY_USER}",
      "password": "${REGISTRY_PASS}"
    }
  }
}
```

### Custom Dockerfile

For complex builds, provide your own Dockerfile:

```json
{
  "docker": {
    "auto_build": true,
    "dockerfile": "./Dockerfile",
    "context": ".",
    "build_args": {
      "VERSION": "1.0.0"
    }
  }
}
```

## Container Configuration

### Full Docker Configuration

```json
{
  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "working_dir": "/app",
    "install_cmd": "npm install --production",
    "start_cmd": "node dist/server.js",
    "build_cmd": "npm run build",
    "internal_ports": [
      {
        "port": 3000,
        "protocol": "tcp",
        "assignment_mode": "random",
        "description": "Web server"
      }
    ],
    "environment": {
      "NODE_ENV": "production",
      "LOG_LEVEL": "info",
      "TZ": "Europe/Berlin"
    },
    "health_check": {
      "endpoint": "/health",
      "interval": 30,
      "timeout": 10,
      "retries": 3,
      "start_period": 15
    },
    "volumes": [
      {
        "name": "app-data",
        "container_path": "/app/data",
        "size_mb": 100
      }
    ],
    "resources": {
      "memory_limit_mb": 256,
      "memory_reservation_mb": 128,
      "cpu_limit": 1.0,
      "cpu_reservation": 0.5
    },
    "restart_policy": "unless-stopped",
    "network_mode": "bridge",
    "extra_hosts": [
      "api.internal:192.168.1.100"
    ]
  }
}
```

### Docker Properties Reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `auto_build` | boolean | `true` | Build image from source |
| `base_image` | string | – | Base Docker image |
| `working_dir` | string | `"/app"` | Container working directory |
| `install_cmd` | string | – | Dependency installation command |
| `build_cmd` | string | – | Build/compile command |
| `start_cmd` | string | – | Container entrypoint |
| `internal_ports` | array | – | Container port definitions |
| `environment` | object | – | Environment variables |
| `health_check` | object | – | Health check configuration |
| `volumes` | array | – | Persistent volumes |
| `resources` | object | – | CPU and memory limits |
| `restart_policy` | string | `"unless-stopped"` | Container restart behavior |
| `network_mode` | string | `"bridge"` | Docker network mode |

## Health Checks

Health checks determine if your app is running correctly:

```json
{
  "health_check": {
    "endpoint": "/health",
    "interval": 30,
    "timeout": 10,
    "retries": 3,
    "start_period": 15
  }
}
```

| Property | Default | Description |
|----------|---------|-------------|
| `endpoint` | – | HTTP endpoint returning 200 OK |
| `interval` | 30 | Seconds between checks |
| `timeout` | 10 | Seconds before check times out |
| `retries` | 3 | Consecutive failures before marked unhealthy |
| `start_period` | 15 | Grace period after container start |

**Command-based health check (non-HTTP apps):**

```json
{
  "health_check": {
    "command": "pg_isready -U postgres",
    "interval": 10,
    "timeout": 5,
    "retries": 3
  }
}
```

**Implementing a health endpoint:**

```javascript
// Express.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

## Networking

### Single Container

```json
{
  "internal_ports": [
    {
      "port": 3000,
      "protocol": "tcp",
      "assignment_mode": "random"
    }
  ]
}
```

The container is on the default bridge network. Access it through the app proxy:
```
http://localhost:8126/api/apps/{app_id}/proxy/
```

### Multi-Container Bundle Network

Bundles get their own isolated network:

```json
{
  "bundle": {
    "network": {
      "driver": "bridge",
      "subnet": "172.28.0.0/24",
      "internal": false
    },
    "services": [
      {
        "name": "postgres",
        "image": "postgres:16-alpine"
      },
      {
        "name": "app",
        "image": "my-app:latest",
        "depends_on": ["postgres"]
      }
    ]
  }
}
```

Containers communicate via service names as DNS hostnames:
- `postgres:5432` – PostgreSQL database
- `app:3000` – Application server

## Volumes and Persistence

### Named Volumes

```json
{
  "volumes": [
    {
      "name": "app-data",
      "container_path": "/app/data",
      "size_mb": 100
    },
    {
      "name": "app-config",
      "container_path": "/app/config",
      "size_mb": 10
    }
  ]
}
```

Volumes persist across container restarts and updates.

### Bind Mounts (Development Only)

```json
{
  "volumes": [
    {
      "name": "app-source",
      "container_path": "/app/src",
      "host_path": "./src",
      "read_only": true
    }
  ]
}
```

## Resource Limits

Control container resource usage:

```json
{
  "resources": {
    "memory_limit_mb": 256,
    "memory_reservation_mb": 128,
    "cpu_limit": 1.0,
    "cpu_reservation": 0.5
  }
}
```

| Property | Description |
|----------|-------------|
| `memory_limit_mb` | Hard memory limit (container killed if exceeded) |
| `memory_reservation_mb` | Soft memory reservation |
| `cpu_limit` | CPU cores limit (1.0 = 1 core) |
| `cpu_reservation` | CPU cores reservation |

**Recommended limits by app type:**
| App Type | Memory | CPU |
|----------|--------|-----|
| Simple UI | 64–128 MB | 0.25 |
| API Server | 128–256 MB | 0.5 |
| Database App | 256–512 MB | 1.0 |
| Bundle (all services) | 512 MB–2 GB | 1.0–2.0 |

## Multi-Container Bundles (v2.3)

Bundles allow multiple containers in a single app:

```json
{
  "type": "app",
  "bundle": {
    "version": "1.0",
    "network": {
      "driver": "bridge",
      "subnet": "172.28.0.0/24"
    },
    "auto_compose": true,
    "services": [
      {
        "name": "db",
        "image": "postgres:16-alpine",
        "environment": {
          "POSTGRES_USER": "app",
          "POSTGRES_PASSWORD": "secret",
          "POSTGRES_DB": "appdb"
        },
        "internal_ports": [
          { "port": 5432, "protocol": "tcp" }
        ],
        "volumes": [
          { "name": "db-data", "container_path": "/var/lib/postgresql/data" }
        ],
        "health_check": {
          "command": "pg_isready -U app",
          "interval": 10,
          "timeout": 5,
          "retries": 3
        }
      },
      {
        "name": "api",
        "image": "my-app:latest",
        "environment": {
          "DATABASE_URL": "postgres://app:secret@db:5432/appdb"
        },
        "internal_ports": [
          { "port": 3000, "protocol": "tcp" }
        ],
        "depends_on": ["db"],
        "resources": {
          "memory_limit_mb": 256,
          "cpu_limit": 0.5
        }
      }
    ]
  }
}
```

Bundle management:
```http
GET  /api/supervisor/apps/{id}/compose        # Download docker-compose.yml
POST /api/supervisor/apps/{id}/bundle/start    # Start all services
POST /api/supervisor/apps/{id}/bundle/stop     # Stop all services
POST /api/supervisor/apps/{id}/bundle/restart  # Restart all services
GET  /api/supervisor/apps/{id}/bundle/status   # Status of all services
```

## Best Practices

1. **Use alpine-based images** – Smaller, faster, more secure
2. **Implement health checks** – Enables automatic recovery
3. **Set resource limits** – Prevent one app from impacting others
4. **Use .dockerignore** – Exclude unnecessary files from build context
5. **Multi-stage builds** – Keep final images small
6. **Never run as root** – Use a non-root user in your Dockerfile
7. **Scan images for vulnerabilities** – Before publishing

## Example Dockerfile

```dockerfile
# Multi-stage build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

## Related Documentation

- [Port Management](port-management.md) – Port configuration
- [App Development Guide](../development/app-development.md) – Full manifest reference
- [Deployment Guide](../deployment/docker-and-rumahl-os.md) – Production deployment
