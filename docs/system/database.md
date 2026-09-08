# rumahl OS – Database Architecture

## Overview

| Service | Database | Type | Notes |
|---------|----------|------|-------|
| **rumahl-home** | `rumahl_home` | PostgreSQL | Main dashboard, users, pages, widgets, settings, themes |
| **rumahl-core** | `rumahl_core` | PostgreSQL | Service registry, plugins, heartbeat |
| **rumahl-assist** | `rumahl_assist` | PostgreSQL | AI providers, tasks, memory, briefings, evolution |
| **rumahl-appstore** | `rumahl_appstore` | PostgreSQL | App store, published apps |
| **rumahl-secrets** | `rumahl_secrets` | PostgreSQL | Encrypted secrets, API keys |
| **rumahl-domain-validator** | `rumahl_domain` | PostgreSQL | Domain whitelist |
| **rumahl-resource-manager** | `rumahl_resources` | PostgreSQL | Resource usage, metrics |
| **rumahl-network-monitor** | `rumahl_network` | PostgreSQL | Network devices, scan results |
| **rumahl-nginx** | `rumahl_nginx` | PostgreSQL | NGINX route configuration |
| **rumahl-backup** | `rumahl_backup` | PostgreSQL | Backup schedules, history |
| — | — | — | — |
| **rumahl-api** | `api.db` | SQLite | API gateway state (MCP, GraphQL, MQTT bridges) |
| **rumahl-security** | `security.db` | SQLite | Security events, intrusion logs |
| **rumahl-gateway** | `gateway.db` | SQLite | Gateway routing state |
| **rumahl-files** | `files.db` | SQLite | File metadata, shares |
| **rumahl-connector** | `connector.db` | SQLite | Cloud relay connection state |
| **rumahl-intelligence** | `intelligence.db` | SQLite | BI analytics, reports |
| — | — | — | — |
| **rumahl-control** | — | API-only | Communicates via REST APIs (no direct DB) |
| **rumahl-supervisor** | — | API-only | Docker daemon API (no direct DB) |
| **rumahl-watchdog** | — | API-only | Health checks via HTTP (no direct DB) |
| **rumahl-updater** | — | API-only | Update management (no direct DB) |

## Database URLs

### PostgreSQL (Production – rumahl OS)
All PostgreSQL databases run on a **single PostgreSQL instance** at `localhost:5432`:

```
postgres://ora:<password>@localhost:5432/rumahl_home
postgres://ora:<password>@localhost:5432/rumahl_core
postgres://ora:<password>@localhost:5432/rumahl_assist
postgres://ora:<password>@localhost:5432/rumahl_appstore
postgres://ora:<password>@localhost:5432/rumahl_secrets
postgres://ora:<password>@localhost:5432/rumahl_domain
postgres://ora:<password>@localhost:5432/rumahl_resources
postgres://ora:<password>@localhost:5432/rumahl_network
postgres://ora:<password>@localhost:5432/rumahl_nginx
postgres://ora:<password>@localhost:5432/rumahl_backup
```

The password is auto-generated on first boot and stored in the system_preferences table.

### SQLite (Lightweight Services)
SQLite databases are stored per-service in `/var/lib/ora/<service>/`:

```
/var/lib/ora/rumahl-api/api.db
/var/lib/ora/rumahl-security/security.db
/var/lib/ora/rumahl-gateway/gateway.db
/var/lib/ora/rumahl-files/files.db
/var/lib/ora/rumahl-connector/connector.db
/var/lib/ora/rumahl-intelligence/intelligence.db
```

## Why Both?

| Database | Use Case |
|----------|----------|
| **PostgreSQL** | Multi-service shared data, complex queries, migrations, relational integrity |
| **SQLite** | Single-service state, simple key-value, no concurrent writers needed |

**Rule of thumb:** If multiple services need to read/write the same data → PostgreSQL. If only one service needs it and the data is simple → SQLite.

## Connection Details

- **PostgreSQL Port:** `5432`
- **PostgreSQL User:** `ora`
- **SQLite Directory:** `/var/lib/ora/<service>/`
- **API-only services** (control, supervisor, watchdog, updater) communicate via HTTP APIs to other services instead of direct DB access.
