---
title: API Reference
description: The rumahl REST API — base URLs, authentication, endpoint groups and the permission model.
readTime: 7 min
updated: 2026-08-20
featured: true
---

rumahl exposes a comprehensive REST API across multiple services. This reference covers the base URLs, authentication and the most important endpoint groups.

## Base URLs

| Environment | rumahl-home | rumahl-core | rumahl-control |
| --- | --- | --- | --- |
| Development | `http://localhost:3001` | `http://localhost:8090` | `http://localhost:8091` |
| Production (Docker) | `http://localhost:8126` | `http://localhost:8090` | `http://localhost:8091` |

The interactive API documentation (Swagger UI) is available at `http://localhost:8126/api/docs`.

## Authentication

Most endpoints require a JWT token:

```bash
curl -X POST http://localhost:8126/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "admin", "password": "your-password" }'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "username": "admin", "is_admin": true }
}
```

Every request carries the token:

```bash
curl http://localhost:8126/api/os/services \
  -H "Authorization: Bearer <jwt-token>"
```

For programmatic access, create an **API key** in the Control Center and send it via the `X-API-Key` header.

## Endpoint groups

| Group | Endpoints | Purpose |
| --- | --- | --- |
| Auth & identity | `POST /api/auth/login`, `GET /api/auth/verify`, `POST /api/auth/guest` | Sessions, verification, guest mode |
| System | `GET/POST /api/os/control/*`, `GET /api/os/logs/*`, `WS /api/os/terminal/ws` | Power, logs, terminal, services |
| Files & storage | `GET /api/files/*`, `POST /api/files/upload`, `POST /api/downloads` | Browse, upload, download manager |
| Jobs & clipboard | `GET/POST /api/jobs/*`, `GET/POST/DELETE /api/clipboard/*` | System jobs, clipboard store |
| Devices & media | `GET/POST /api/devices/*`, `POST /api/devices/:id/wake`, `GET /api/media/hub` | Device registry, WOL, media hubs |
| Automations | `GET/POST /api/automations/*` | Visual flow automations |
| App platform | `GET /api/apps/:id/storage/kv/*`, `GET /api/core/registrations` | App storage, registrations |
| Remote & network | `GET /api/remote/status`, `GET /share/:token`, `GET /api/network/devices` | Tunnels, share links, discovery |

## The permission model

Every endpoint maps to a permission — the gateway enforces it on every request:

| Permission group | Scope |
| --- | --- |
| AppStorage[Read/Write/Delete/Manage] | App storage: key-value, files, database |
| AppDatabaseSqlite/Manage | App SQLite database |
| AppSchedule[Create/Read/Update/Delete] | Scheduled tasks |
| Messaging[Publish/Subscribe/Wildcard/Direct] | Messaging system |
| Webhook[Create/Read/Update/Delete/Manage] | Webhooks |
| os.terminal, os.system.read, os.services, … | OS capabilities |

## WebSockets & events

Real-time updates flow over WebSockets — the interactive terminal, live system events and messaging between apps. Apps can subscribe to system events via lifecycle hooks with glob-filtered patterns:

```json
{
  "lifecycle_hooks": {
    "hooks": [{ "event": "on_system_event", "filter": "security.*" }]
  }
}
```

> **Tip:** the full endpoint documentation is always available in the Swagger UI of your running instance.


## Developer & Cloud APIs

For cloud and store automation as well as federated Single Sign-On, rumahl provides dedicated developer APIs:

- **[Developer REST API](/docs/guides/developer-api):** Programmatically manage apps, releases, binary bundles, team members, webhooks, and scoped API keys.
- **[OAuth 2.0 & rumahl Account](/docs/guides/oauth-identity):** OpenID Connect (OIDC), PKCE authorization flow, Passkeys (FIDO2), and consent management.
- **[SDKs & CI/CD Integration](/docs/guides/sdks-integration):** Official SDKs for TypeScript and Python, cURL release recipes, and GitHub Actions workflows.
