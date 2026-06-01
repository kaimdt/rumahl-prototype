# Control Center API

The Control Center API is served by `iora-control` on port 8091. It provides system administration, service management, and Home Assistant integration endpoints.

## Base URL

```
http://localhost:8091
```

## Health Check

```http
GET /health
```

## Dashboard Overview

```http
GET /api/control/dashboard
```

Returns a summary of all services, plugins, and system status:
```json
{
  "services": { "total": 9, "healthy": 9, "degraded": 0, "unhealthy": 0 },
  "plugins": { "total": 5, "active": 3 },
  "system": { "cpu_percent": 15.2, "memory_percent": 42.1 }
}
```

## System Information

```http
GET /api/control/system
```

Response:
```json
{
  "hostname": "iora-server",
  "os": "Debian 12",
  "kernel": "6.1.0",
  "cpu": { "model": "Intel Core i7", "cores": 4, "usage_percent": 15.2 },
  "memory": { "total_mb": 8192, "used_mb": 3450, "free_mb": 4742 },
  "disk": { "total_gb": 128, "used_gb": 22, "free_gb": 106 },
  "uptime_seconds": 86400,
  "docker_version": "26.1.4"
}
```

## Service Management

```http
# List all IORA services
GET /api/control/services

# Get service details
GET /api/control/services/{name}
```

Response includes health status, port, version, and uptime.

## Control Tasks

```http
# Task queue overview
GET /api/control/tasks

# Active control mode
GET /api/control/mode
```

## User Management

Proxied from `iora-home`:

```http
# List users
GET /api/control/users

# Create user
POST /api/control/users
Content-Type: application/json

{
  "username": "newuser",
  "password": "secure-password",
  "is_admin": false
}

# Update user
PUT /api/control/users/{user_id}

# Delete user
DELETE /api/control/users/{user_id}
```

## API Key Management

```http
# List API keys
GET /api/control/api-keys

# Create API key
POST /api/control/api-keys
Content-Type: application/json

{
  "name": "My App Key",
  "permissions": ["ReadEntities", "ControlEntities"],
  "rate_limit": { "requests_per_hour": 1000 }
}

# Revoke API key
DELETE /api/control/api-keys/{key_id}
```

## Webhook Management

```http
# List registered webhooks
GET /api/control/webhooks
```

## Home Assistant Integration

### Configuration

```http
# Get HA configuration
GET /api/control/ha/config

# Update HA configuration
PUT /api/control/ha/config
Content-Type: application/json

{
  "url": "http://homeassistant.local:8123",
  "token": "eyJ..."
}
```

### Connection Status

```http
GET /api/control/ha/connection
```

Response:
```json
{
  "connected": true,
  "ha_version": "2026.5.0",
  "entities_count": 245,
  "integrations": ["mqtt", "zigbee", "zwave"]
}
```

### Entity Explorer

```http
# List all entities
GET /api/control/ha/entities

# Filter by domain
GET /api/control/ha/entities?domain=light

# Search entities
GET /api/control/ha/entities?search=living
```

### Scenes

```http
# List scenes
GET /api/control/ha/scenes

# Activate scene
POST /api/control/ha/scenes/{scene_id}/activate
```

### Automations

```http
# List automations
GET /api/control/ha/automations

# Automation status
GET /api/control/ha/automations/{id}/status

# Trigger automation
POST /api/control/ha/automations/{id}/trigger
```

### Logbook

```http
GET /api/control/ha/logbook?limit=100
```

## Device Integration Status

```http
# MQTT broker status
GET /api/control/mqtt/status

# Zigbee network status
GET /api/control/zigbee/status

# Z-Wave network status
GET /api/control/zwave/status

# Matter bridge status
GET /api/control/matter/status

# BLE device status
GET /api/control/ble/status

# HomeKit bridge status
GET /api/control/homekit/status
```

Each returns status information about the respective integration:
```json
{
  "available": true,
  "connected": true,
  "devices_count": 12,
  "status": "operational"
}
```

## Network Diagnostics

```http
GET /api/control/network
```

Response includes:
- Network interfaces and IPs
- Internet connectivity check
- DNS resolution status
- Gateway reachability

## Database Health

```http
GET /api/control/database
```

Response:
```json
{
  "status": "healthy",
  "connections_active": 5,
  "connections_max": 100,
  "size_mb": 42,
  "uptime_seconds": 86400
}
```

## System Warnings

```http
# Get warnings
GET /api/control/warnings

# Acknowledge warning
POST /api/control/warnings/{id}/acknowledge
```

Warning types:
- `low_disk_space` – Disk usage above 90%
- `high_memory_usage` – Memory usage above 85%
- `service_unhealthy` – A service is degraded or down
- `security_threat` – Security threat detected
- `update_available` – New IORA version available

## Notifications

```http
# Get notification feed
GET /api/control/notifications

# Send admin notification
POST /api/control/notifications
Content-Type: application/json

{
  "title": "Maintenance",
  "message": "System update scheduled for 02:00 UTC",
  "priority": "high",
  "target": "all"
}
```

## WebSocket

Real-time control updates:

```javascript
const ws = new WebSocket('ws://localhost:8091/ws/control');
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  // Handle system updates
};
```
