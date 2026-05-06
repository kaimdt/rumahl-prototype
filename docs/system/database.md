# IORA OS – Database Architecture

## Overview

| Service | Database | Type | Notes |
|---------|----------|------|-------|
| **iora-home** | `iora_home` | PostgreSQL | Main dashboard, users, pages, widgets, settings, themes |
| **iora-core** | `iora_core` | PostgreSQL | Service registry, plugins, heartbeat |
| **iora-assist** | `iora_assist` | PostgreSQL | AI providers, tasks, memory, briefings, evolution |
| **iora-appstore** | `iora_appstore` | PostgreSQL | App store, published apps |
| **iora-secrets** | `iora_secrets` | PostgreSQL | Encrypted secrets, API keys |
| **iora-domain-validator** | `iora_domain` | PostgreSQL | Domain whitelist |
| **iora-resource-manager** | `iora_resources` | PostgreSQL | Resource usage, metrics |
| **iora-network-monitor** | `iora_network` | PostgreSQL | Network devices, scan results |
| **iora-nginx** | `iora_nginx` | PostgreSQL | NGINX route configuration |
| **iora-backup** | `iora_backup` | PostgreSQL | Backup schedules, history |
| — | — | — | — |
| **iora-api** | `api.db` | SQLite | API gateway state (MCP, GraphQL, MQTT bridges) |
| **iora-security** | `security.db` | SQLite | Security events, intrusion logs |
| **iora-gateway** | `gateway.db` | SQLite | Gateway routing state |
| **iora-files** | `files.db` | SQLite | File metadata, shares |
| **iora-connector** | `connector.db` | SQLite | Cloud relay connection state |
| **iora-intelligence** | `intelligence.db` | SQLite | BI analytics, reports |
| — | — | — | — |
| **iora-control** | — | API-only | Communicates via REST APIs (no direct DB) |
| **iora-supervisor** | — | API-only | Docker daemon API (no direct DB) |
| **iora-watchdog** | — | API-only | Health checks via HTTP (no direct DB) |
| **iora-updater** | — | API-only | Update management (no direct DB) |

## Database URLs

### PostgreSQL (Production – IORA OS)
All PostgreSQL databases run on a **single PostgreSQL instance** at `localhost:5432`:

```
postgres://iora:<password>@localhost:5432/iora_home
postgres://iora:<password>@localhost:5432/iora_core
postgres://iora:<password>@localhost:5432/iora_assist
postgres://iora:<password>@localhost:5432/iora_appstore
postgres://iora:<password>@localhost:5432/iora_secrets
postgres://iora:<password>@localhost:5432/iora_domain
postgres://iora:<password>@localhost:5432/iora_resources
postgres://iora:<password>@localhost:5432/iora_network
postgres://iora:<password>@localhost:5432/iora_nginx
postgres://iora:<password>@localhost:5432/iora_backup
```

The password is auto-generated on first boot and stored in the system_preferences table.

### SQLite (Lightweight Services)
SQLite databases are stored per-service in `/var/lib/iora/<service>/`:

```
/var/lib/iora/iora-api/api.db
/var/lib/iora/iora-security/security.db
/var/lib/iora/iora-gateway/gateway.db
/var/lib/iora/iora-files/files.db
/var/lib/iora/iora-connector/connector.db
/var/lib/iora/iora-intelligence/intelligence.db
```

## Why Both?

| Database | Use Case |
|----------|----------|
| **PostgreSQL** | Multi-service shared data, complex queries, migrations, relational integrity |
| **SQLite** | Single-service state, simple key-value, no concurrent writers needed |

**Rule of thumb:** If multiple services need to read/write the same data → PostgreSQL. If only one service needs it and the data is simple → SQLite.

## Connection Details

- **PostgreSQL Port:** `5432`
- **PostgreSQL User:** `iora`
- **SQLite Directory:** `/var/lib/iora/<service>/`
- **API-only services** (control, supervisor, watchdog, updater) communicate via HTTP APIs to other services instead of direct DB access.
