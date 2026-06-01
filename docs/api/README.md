# API Overview

IORA exposes a comprehensive REST API across multiple services. This section documents all available endpoints.

## API Base URLs

| Environment | iora-home | iora-core | iora-control |
|-------------|-----------|-----------|-------------|
| Development | `http://localhost:3001` | `http://localhost:8090` | `http://localhost:8091` |
| Production (Docker) | `http://localhost:8126` | `http://localhost:8090` | `http://localhost:8091` |

## Authentication

### JWT Tokens

Most endpoints require authentication via JWT:

```http
Authorization: Bearer <jwt-token>
```

Obtain a token:
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "...",
    "username": "admin",
    "is_admin": true
  }
}
```

### API Keys

For programmatic access, create an API key in the Control Center:

```http
X-API-Key: <api-key>
```

### PIN Authentication (Terminal Devices)

For kiosk/terminal devices:
```http
POST /api/auth/pin
Content-Type: application/json

{
  "pin": "1234",
  "device_id": "terminal-living-room"
}
```

## API Documentation (Swagger)

Interactive API documentation is available at:

```
http://localhost:8126/api/docs
```

The Swagger UI provides:
- Try-it-out functionality for all endpoints
- Request/response schemas
- Authentication configuration

## Service APIs

Each IORA service exposes its own API:

| Service | Port | API Section |
|---------|------|-------------|
| iora-home | 8126 | [Core API](core.md) – Entities, users, pages, files |
| iora-core | 8090 | [Core API](core.md) – Plugins, service registry, events |
| iora-control | 8091 | [Control Center API](control.md) – System stats, admin |
| iora-appstore | 8098 | [App Store API](appstore.md) – App installation, catalog |
| iora-security | 8095 | [Security API](security.md) – Threats, lockdown, audit |
| iora-gateway | 8096 | [Network Monitor API](network.md) – Email, HTTP, search |
| iora-supervisor | 8097 | [SSH Management API](ssh.md) – Container management |

## Common Patterns

### Pagination

```http
GET /api/entities?limit=50&offset=100
```

Response includes pagination metadata:
```json
{
  "data": [...],
  "total": 250,
  "limit": 50,
  "offset": 100
}
```

### Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ENTITY_NOT_FOUND",
    "message": "Entity 'light.invalid' not found",
    "status": 404
  }
}
```

Common status codes:
| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (invalid input) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 409 | Conflict (duplicate resource) |
| 429 | Rate limited |
| 500 | Internal server error |

### Server-Sent Events (SSE)

Several endpoints provide real-time updates via SSE:

```http
GET /api/events/stream
Accept: text/event-stream
```

Event format:
```
event: entity_updated
data: {"entity_id": "light.living_room", "state": "on"}

event: entity_updated
data: {"entity_id": "sensor.temperature", "state": "22.5"}
```

### WebSocket

Real-time bidirectional communication:

```javascript
const ws = new WebSocket('ws://localhost:8126/ws?token=<jwt>');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

## API Sections

- [Core API](core.md) – Entities, users, pages, plugins, widgets
- [Control Center API](control.md) – System administration
- [App Store API](appstore.md) – App lifecycle management
- [Security API](security.md) – Security monitoring and management
- [Network Monitor API](network.md) – Network and gateway operations
- [SSH Management API](ssh.md) – Container and service management
