# Core API

The Core API is served by `iora-home` (port 8126) and `iora-core` (port 8090). It provides access to entities, users, pages, plugins, and the service registry.

## iora-home Endpoints (Port 8126 / 3001)

### Health Check

```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "version": "2.3.0",
  "uptime_seconds": 3600
}
```

### Authentication

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secure-password"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "uuid", "username": "admin", "is_admin": true }
}
```

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "newuser",
  "password": "secure-password",
  "email": "user@example.com"
}
```

```http
POST /api/auth/pin
Content-Type: application/json

{
  "pin": "1234",
  "device_id": "terminal-kitchen"
}
```

```http
GET /api/auth/me
Authorization: Bearer <token>
```

### Entity States

```http
GET /api/states
Authorization: Bearer <token>

# Filter by domain
GET /api/states?domain=light

# Get single entity
GET /api/states/light.living_room
```

Response:
```json
{
  "entity_id": "light.living_room",
  "state": "on",
  "attributes": {
    "brightness": 255,
    "color_temp": 4000,
    "friendly_name": "Living Room Light"
  },
  "last_changed": "2026-06-01T12:00:00Z",
  "last_updated": "2026-06-01T12:00:00Z"
}
```

### Service Calls

```http
POST /api/services/{domain}/{service}
Authorization: Bearer <token>
Content-Type: application/json

{
  "entity_id": "light.living_room",
  "brightness": 200,
  "color_temp": 3500
}
```

Common services:
- `light/turn_on`, `light/turn_off`, `light/toggle`
- `switch/turn_on`, `switch/turn_off`, `switch/toggle`
- `climate/set_temperature`, `climate/set_hvac_mode`
- `cover/open_cover`, `cover/close_cover`, `cover/stop_cover`
- `media_player/media_play`, `media_player/media_pause`

### Real-Time Streams

```http
# WebSocket
ws://localhost:8126/ws?token=<jwt>

# Server-Sent Events
GET /api/events/stream
Authorization: Bearer <token>
```

### Users & Profiles

```http
# List users (admin only)
GET /api/users
Authorization: Bearer <token>

# Get user profile
GET /api/users/{user_id}

# Update user
PUT /api/users/{user_id}
Content-Type: application/json

{
  "username": "newname",
  "avatar_url": "https://example.com/avatar.png"
}

# Delete user (admin only)
DELETE /api/users/{user_id}
```

### Pages & Widgets

```http
# List dashboard pages
GET /api/pages
Authorization: Bearer <token>

# Create page
POST /api/pages
Content-Type: application/json

{
  "title": "Living Room",
  "icon": "home",
  "show_in_nav": true,
  "order": 10
}

# Get page with widgets
GET /api/pages/{page_id}

# Update page
PUT /api/pages/{page_id}

# Delete page
DELETE /api/pages/{page_id}

# Add widget to page
POST /api/pages/{page_id}/widgets
Content-Type: application/json

{
  "type": "entity_card",
  "config": {
    "entity_id": "light.living_room",
    "show_name": true,
    "show_state": true
  },
  "position": { "x": 0, "y": 0, "width": 2, "height": 2 }
}

# Update widget
PUT /api/pages/{page_id}/widgets/{widget_id}

# Delete widget
DELETE /api/pages/{page_id}/widgets/{widget_id}
```

### Theme Settings

```http
# Get theme configuration
GET /api/theme

# Update theme
PUT /api/theme
Content-Type: application/json

{
  "mode": "dark",
  "primary_color": "#3B82F6",
  "glass_effect": true,
  "border_radius": 16
}
```

### Person Tracking

```http
# List tracked persons
GET /api/persons

# Person location history
GET /api/persons/{entity_id}/history?limit=100

# Daily summary
GET /api/persons/{entity_id}/daily-summary?date=2026-06-01

# Weekly report
GET /api/persons/{entity_id}/weekly-report

# Automation rules
GET /api/automation-rules
POST /api/automation-rules
PUT /api/automation-rules/{id}
DELETE /api/automation-rules/{id}
GET /api/automation-rules/{id}/executions
```

### File Uploads

```http
POST /api/files/upload
Content-Type: multipart/form-data

file: <binary>
```

### Notification System

```http
# Get notifications
GET /api/notifications

# Mark as read
POST /api/notifications/{id}/read

# Send notification
POST /api/notifications
Content-Type: application/json

{
  "title": "Alert",
  "message": "Front door opened",
  "priority": "high"
}
```

### System Warnings

```http
GET /api/warnings
```

### Webhooks

```http
# List webhooks
GET /api/webhooks

# Create webhook
POST /api/webhooks
Content-Type: application/json

{
  "name": "GitHub Push",
  "url": "https://example.com/hook",
  "events": ["push"]
}

# Delete webhook
DELETE /api/webhooks/{id}

# Delivery history
GET /api/webhooks/{id}/deliveries
```

## iora-core Endpoints (Port 8090)

### Health

```http
GET /health
```

### Service Registry

```http
# List registered services
GET /api/core/services

# Register a service
POST /api/core/services/register
Content-Type: application/json

{
  "name": "iora-home",
  "port": 8126,
  "health_endpoint": "/health",
  "metadata": {
    "version": "2.3.0",
    "type": "core"
  }
}

# Proxy health check
GET /api/core/services/{name}/health
```

### Plugin Registry

```http
# List plugins
GET /api/core/plugins

# List with statistics
GET /api/core/plugins/with-stats

# Get plugin details
GET /api/core/plugins/{id}

# Enable plugin
POST /api/core/plugins/{id}/enable

# Disable plugin
POST /api/core/plugins/{id}/disable

# Delete plugin
DELETE /api/core/plugins/{id}

# Execute plugin
POST /api/core/plugins/{id}/execute
Content-Type: application/json

{
  "input": { "key": "value" },
  "timeout_ms": 3000
}

# Plugin logs
GET /api/core/plugins/{id}/logs

# Sandbox status
GET /api/core/sandbox/status
```

### System Events

```http
# SSE event stream
GET /api/core/events

# Broadcast event
POST /api/core/events
Content-Type: application/json

{
  "type": "service.started",
  "data": { "service": "iora-home" }
}
```

## App Runtime Endpoints

These are served by `iora-home` under the `/api/apps/{app_id}` prefix.

### App Pages

```http
GET /api/apps/pages
```

### App Details

```http
GET /api/apps/{app_id}/detail
```

### App Logs

```http
# Get logs
GET /api/apps/{app_id}/logs

# Live log stream (SSE)
GET /api/apps/{app_id}/logs/stream
```

### App Proxy

```http
# Proxy to app container
GET /api/apps/{app_id}/proxy/{path}
```

### App Configuration

```http
# Get settings schema
GET /api/apps/{app_id}/config/schema

# Get current config
GET /api/apps/{app_id}/config

# Update config
PUT /api/apps/{app_id}/config
Content-Type: application/json

{
  "api_key": "abc123",
  "refresh_interval": 120
}

# Reset a config key
DELETE /api/apps/{app_id}/config/{key}
```

### App Storage

```http
# File operations
GET    /api/apps/{app_id}/storage/files
POST   /api/apps/{app_id}/storage/files
GET    /api/apps/{app_id}/storage/files/{file_id}
DELETE /api/apps/{app_id}/storage/files/{file_id}

# KV operations
GET    /api/apps/{app_id}/storage/kv
PUT    /api/apps/{app_id}/storage/kv/{key}
GET    /api/apps/{app_id}/storage/kv/{key}
DELETE /api/apps/{app_id}/storage/kv/{key}

# Usage
GET    /api/apps/{app_id}/storage/usage
```

### App Database

```http
POST   /api/apps/{app_id}/database/provision
DELETE /api/apps/{app_id}/database
GET    /api/apps/{app_id}/database/status
POST   /api/apps/{app_id}/database/execute
POST   /api/apps/{app_id}/database/backup
GET    /api/apps/{app_id}/database/backups
```

### App Scheduler

```http
GET    /api/apps/{app_id}/schedules
POST   /api/apps/{app_id}/schedules
GET    /api/apps/{app_id}/schedules/{task_id}
PUT    /api/apps/{app_id}/schedules/{task_id}
DELETE /api/apps/{app_id}/schedules/{task_id}
POST   /api/apps/{app_id}/schedules/{task_id}/trigger
GET    /api/apps/{app_id}/schedules/{task_id}/logs
```

### App Webhooks

```http
GET    /api/apps/{app_id}/webhooks
POST   /api/apps/{app_id}/webhooks
GET    /api/apps/{app_id}/webhooks/{hook_id}
PUT    /api/apps/{app_id}/webhooks/{hook_id}
DELETE /api/apps/{app_id}/webhooks/{hook_id}
POST   /api/apps/{app_id}/webhooks/{hook_id}/test
GET    /api/apps/{app_id}/webhooks/{hook_id}/logs
GET    /api/apps/{app_id}/webhooks/{hook_id}/stats
```

### Inter-App Messaging

```http
GET    /api/apps/messaging/channels
POST   /api/apps/messaging/channels
POST   /api/apps/messaging/publish
GET    /api/apps/messaging/events              (SSE)
POST   /api/apps/{app_id}/messaging/subscribe
GET    /api/apps/{app_id}/messaging/subscriptions
DELETE /api/apps/{app_id}/messaging/subscriptions/{sub_id}
POST   /api/apps/{app_id}/messaging/direct
GET    /api/apps/{app_id}/messaging/inbox
POST   /api/apps/{app_id}/messaging/inbox/{msg_id}/read
```
