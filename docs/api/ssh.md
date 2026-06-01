# Supervisor & Container Management API

The Supervisor API is served by `iora-supervisor` on port 8097. It manages Docker container orchestration, app lifecycle, and system updates.

## Base URL

```
http://localhost:8097
```

## Health Check

```http
GET /health
```

## System Status

```http
GET /api/supervisor/status
```

Response:
```json
{
  "supervisor_version": "2.3.0",
  "docker_version": "26.1.4",
  "system": {
    "hostname": "iora-server",
    "os": "Debian 12",
    "uptime_seconds": 86400
  },
  "containers": {
    "total": 12,
    "running": 10,
    "stopped": 1,
    "unhealthy": 1
  }
}
```

## Container Management

### List Containers

```http
GET /api/supervisor/containers
```

Response:
```json
{
  "containers": [
    {
      "id": "abc123",
      "name": "iora-home",
      "image": "iora-home:2.3.0",
      "status": "running",
      "health": "healthy",
      "ports": ["8126:8126"],
      "created": "2026-06-01T10:00:00Z",
      "uptime_seconds": 3600,
      "cpu_percent": 5.2,
      "memory_mb": 128
    }
  ]
}
```

### Container Lifecycle

```http
# Start container
POST /api/supervisor/containers/{name}/start

# Stop container
POST /api/supervisor/containers/{name}/stop

# Restart container
POST /api/supervisor/containers/{name}/restart

# Force restart
POST /api/supervisor/containers/{name}/restart?force=true
```

### Container Logs

```http
# Get container logs
GET /api/supervisor/containers/{name}/logs?tail=100

# Stream logs (SSE)
GET /api/supervisor/containers/{name}/logs/stream
```

Log response:
```json
{
  "logs": [
    {
      "timestamp": "2026-06-01T12:00:00Z",
      "stream": "stdout",
      "message": "[INFO] Server started on port 8126"
    }
  ]
}
```

### Container Details

```http
GET /api/supervisor/containers/{name}
```

Response includes:
- Container configuration
- Resource usage (CPU, memory, network I/O)
- Mount points and volumes
- Environment variables (sanitized)
- Health check status and history

## App Management

### List Apps

```http
GET /api/supervisor/apps
```

Response:
```json
{
  "apps": [
    {
      "id": "weather-app",
      "name": "Weather App",
      "version": "1.2.0",
      "status": "running",
      "container_name": "iora-app-weather-app",
      "ports": { "3000": 50123 },
      "uptime_seconds": 7200,
      "cpu_percent": 2.1,
      "memory_mb": 64
    }
  ]
}
```

### App Lifecycle

```http
# Start app
POST /api/supervisor/apps/{app_id}/start

# Stop app
POST /api/supervisor/apps/{app_id}/stop

# Restart app
POST /api/supervisor/apps/{app_id}/restart

# Uninstall app (removes container and data)
DELETE /api/supervisor/apps/{app_id}

# Get app details
GET /api/supervisor/apps/{app_id}
```

### App Bundle Management (v2.3)

For multi-container app bundles:

```http
# Start all bundle services
POST /api/supervisor/apps/{app_id}/bundle/start

# Stop all bundle services
POST /api/supervisor/apps/{app_id}/bundle/stop

# Restart all bundle services
POST /api/supervisor/apps/{app_id}/bundle/restart

# Get bundle status
GET /api/supervisor/apps/{app_id}/bundle/status

# Get docker-compose.yml for bundle
GET /api/supervisor/apps/{app_id}/compose
```

Bundle status response:
```json
{
  "app_id": "ha-bundle",
  "services": [
    {
      "name": "postgres",
      "status": "running",
      "health": "healthy",
      "uptime_seconds": 7200
    },
    {
      "name": "homeassistant",
      "status": "running",
      "health": "healthy",
      "uptime_seconds": 3600
    }
  ],
  "network": {
    "name": "iora-bundle-ha-bundle",
    "subnet": "172.28.0.0/24"
  }
}
```

## Service Updates

```http
# Update a service to latest image
POST /api/supervisor/services/update
Content-Type: application/json

{
  "service": "iora-home",
  "version": "latest"
}

# Update all services
POST /api/supervisor/services/update-all
```

Update process:
1. Pull new Docker image
2. Validate image integrity (SHA256)
3. Stop existing container
4. Create new container with updated image
5. Health check on new container
6. If healthy: remove old container
7. If unhealthy: rollback to old container

## System Information

```http
GET /api/supervisor/system/info
```

Response:
```json
{
  "docker": {
    "version": "26.1.4",
    "api_version": "1.45",
    "containers_total": 12,
    "containers_running": 10,
    "images_total": 15,
    "storage_driver": "overlay2"
  },
  "system": {
    "hostname": "iora-server",
    "kernel": "6.1.0",
    "arch": "x86_64",
    "cpu_count": 4,
    "memory_total_mb": 8192,
    "disk_total_gb": 128
  },
  "iora": {
    "version": "2.3.0",
    "services": [
      { "name": "iora-home", "version": "2.3.0", "status": "running" }
    ]
  }
}
```

## Resource Monitoring

```http
# Get resource usage for all containers
GET /api/supervisor/resources
```

Response:
```json
{
  "containers": [
    {
      "name": "iora-home",
      "cpu_percent": 5.2,
      "memory_mb": 128,
      "memory_limit_mb": 512,
      "network_rx_bytes": 1048576,
      "network_tx_bytes": 524288
    }
  ],
  "total": {
    "cpu_percent": 35.5,
    "memory_mb": 1024,
    "memory_total_mb": 8192
  }
}
```

## Image Management

```http
# List Docker images
GET /api/supervisor/images

# Pull image
POST /api/supervisor/images/pull
Content-Type: application/json

{
  "image": "iora-home:2.3.0"
}

# Remove unused images (prune)
POST /api/supervisor/images/prune
```

## WebSocket

Real-time container status updates:

```javascript
const ws = new WebSocket('ws://localhost:8097/ws/supervisor');
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  // Handle container status changes
  // event types: container.started, container.stopped, container.health_changed
};
```
