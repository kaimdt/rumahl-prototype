# Architecture Overview

A high-level introduction to rumahl's architecture. For the complete system reference, see the [full Architecture Overview](../architecture/overview.md).

## System Design

rumahl follows a **microservices architecture** where each concern runs as an independent service that can be deployed and scaled separately.

```
┌──────────────────────────────────────────────────────────────────┐
│                        rumahl OS (Browser UI)                       │
│                                                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │  rumahl Dashboard   │  │  rumahl Control    │  │  rumahl Assist  │   │
│  │  (Smart Home)     │  │  (Admin Panel)   │  │  (AI Chat)    │   │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘   │
└───────────┼────────────────────┼──────────────────────┼──────────┘
            │      HTTP / WS / SSE                      │
┌───────────┼────────────────────┼────────────┐         │
│ rumahl-home │  rumahl-core  rumahl-  │  rumahl-    │         │
│  :8126    │  :8090     control │  assist   │         │
│           │            :8091   │  :8092    │         │
└───────────┴────────────────────┴───────────┘         │
                                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                   Supporting Services                         │
│                                                               │
│  rumahl-secrets  rumahl-security  rumahl-watchdog  rumahl-gateway   │
│  rumahl-supervisor  rumahl-files  rumahl-installer (CLI)           │
└──────────────────────────────────────────────────────────────┘
```

## Core Services

| Service | Port | Role |
|---------|------|------|
| **rumahl-home** | 8126 (prod) / 3001 (dev) | Main API server, entity cache, user auth, dashboard backend |
| **rumahl-core** | 8090 | Central orchestrator, service registry, plugin registry, event bus |
| **rumahl-control** | 8091 | Admin panel backend, system stats, service management |
| **rumahl-assist** | 8092 | AI assistant (chat, voice, automations) |
| **rumahl-supervisor** | 8097 | Docker container orchestration, app lifecycle |
| **rumahl-secrets** | 8093 | Encrypted secrets storage (AES-256-GCM) |
| **rumahl-watchdog** | 8094 | Health monitoring, failover for rumahl-core |
| **rumahl-security** | 8095 | Security monitoring, intrusion detection, lockdown |
| **rumahl-gateway** | 8096 | Sandboxed external integrations (email, HTTP, web search) |

## Key Design Decisions

### App vs Plugin

rumahl distinguishes between two extension types:

| | App | Plugin |
|---|-----|--------|
| **Execution** | Docker container | Sandbox subprocess |
| **Language** | Any | JavaScript / Python |
| **Resources** | Container-level | Max 128 MB RAM |
| **UI** | Full web app | No UI (data only) |
| **Use Case** | Dashboards, APIs | Automations, processing |

See the [App & Plugin System](../system/app-plugin-system.md) for details.

### Data Flow

```
Home Assistant (optional)
  │  WebSocket / REST
  ▼
rumahl-home (EntityStateCache)
  │  in-memory update
  ├──► WebSocket broadcast → browsers
  └──► SSE /api/events/stream → browsers
```

### Service Discovery

All services self-register with `rumahl-core` on startup. `rumahl-core` maintains the registry and polls health every 30 seconds. The dashboard queries `rumahl-core` for a single source of truth.

### Database Strategy

- **PostgreSQL** – System databases (users, pages, entity history)
- **SQLite** – Per-app databases (isolated per app)
- **Encrypted SQLite** – Security audit logs (AES-256-GCM, hash-chained)

See [Database Architecture](../system/database.md).

## Directory Structure

```
home-assistant-dashb/
├── rumahl-os/backend/           ← Rust backend (workspace)
│   ├── shared/rumahl-shared/    ← Shared types & traits
│   └── services/              ← Microservices
│       ├── rumahl-home/         ← Main API (Axum, Port 3001/8126)
│       ├── rumahl-core/         ← Orchestrator
│       └── ...                ← Other services
├── frontend/                  ← React frontend (Vite + Tailwind)
├── desktop/                   ← Tauri desktop app
├── sdks/                      ← SDKs (JS, Go, CPP, PHP)
├── apps/                      ← Example apps & configs
├── docs/                      ← Documentation
├── custom_components/         ← Home Assistant integration
└── deploy/                    ← Docker Compose files
```

## Deployment Modes

### rumahl OS (Production Hardware)

Custom Buildroot-based OS with:
- SquashFS read-only root
- A/B RAUC updates (atomic, rollback-capable)
- Docker Engine for all services
- AppArmor security profiles

### Docker Compose (Standard Linux)

All services as Docker containers managed by `rumahl-supervisor`.

### Development

Services run directly on the host:
- Backend: `cargo run -p rumahl-home`
- Frontend: `npm run dev` (Vite on port 5173)

## Next Steps

- [Full Architecture Overview](../architecture/overview.md) – Detailed service descriptions
- [App & Plugin System](../system/app-plugin-system.md) – Complete extension API
- [Port Reference](../system/ports.md) – All port assignments
- [Database Architecture](../system/database.md) – Database design
