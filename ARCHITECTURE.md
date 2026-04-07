# IORA Architecture Overview

**IORA – Interface for Optimized Residential Autonomy** is an autonomous AI system designed
to manage and support both a smart home and the people living in it. The system is fully
independent of external services: Home Assistant is an optional integration, not a
dependency.

---

## High-Level System Map

```
                    ┌─────────────────────────────────────────────────┐
                    │                  IORA OS (UI)                   │
                    │                                                 │
                    │   ┌─────────────────┐   ┌──────────────────┐   │
                    │   │  IORA Dashboard  │   │  IORA Control    │   │
                    │   │  (Smart Home)    │   │  (Admin Panel)   │   │
                    │   └────────┬────────┘   └────────┬─────────┘   │
                    │            │                      │             │
                    │   ┌────────┴──────────────────────┴──────────┐  │
                    │   │            IORA Assist (future)           │  │
                    │   │         (AI assistant – chat, insights)   │  │
                    │   └───────────────────────────────────────────┘  │
                    └──────────────────┬──────────────────────────────┘
                                       │  HTTP / WebSocket / SSE
          ┌────────────────────────────┼───────────────────────────────┐
          │                            │                               │
  ┌───────┴────────┐        ┌──────────┴──────────┐        ┌──────────┴──────────┐
  │  iora-home     │        │   iora-core          │        │  iora-control       │
  │  :8080         │◄───────┤   :8090              ├───────►│  :8091              │
  │                │        │                      │        │                     │
  │ Smart Home     │        │ Central Orchestrator │        │ Admin Panel API     │
  │ HA Integration │        │ Service Registry     │        │ System Stats        │
  │ Entity Cache   │        │ Plugin Registry      │        │ Config Management   │
  │ WebSocket/SSE  │        │ SSE Event Bus        │        │ Log Aggregation     │
  └───────┬────────┘        └──────────────────────┘        └─────────────────────┘
          │
  ┌───────┴────────┐        ┌──────────────────────┐
  │  iora-assist   │        │  Home Assistant       │
  │  :8092         │        │  (Optional)           │
  │                │        │                       │
  │  AI Assistant  │        │  REST + WebSocket     │
  │  Chat, Insights│        │  Integrated via       │
  │  Automation    │        │  iora-home only       │
  └────────────────┘        └──────────────────────┘
```

---

## Backend Programs (Cargo Workspace)

The entire backend lives in the `backend/` directory as a Cargo workspace. Each program is
an independent Rust binary that can be deployed and scaled separately.

```
backend/
├── Cargo.toml          ← workspace manifest
├── iora-shared/        ← shared library (plugin system, types)
├── iora-home/          ← Smart Home server (port 8080)
├── iora-core/          ← Central orchestrator (port 8090)
├── iora-control/       ← Admin panel backend (port 8091)
└── iora-assist/        ← AI assistant skeleton (port 8092)
```

### `iora-shared` – Shared Library

Common types and infrastructure used by every IORA program.

| Module | Contents |
|--------|----------|
| `types` | `EntityState`, `IoraEvent`, `ServiceHealth`, `HealthStatus` |
| `plugin` | `IPlugin`, `IApiPlugin`, `IServicePlugin`, `IIntegrationPlugin` traits; `PluginRegistry` |

### `iora-home` – Smart Home (port 8080)

The core Smart Home server. Manages the connection to Home Assistant and exposes a full
REST + WebSocket API consumed by the IORA OS dashboard.

**Responsibilities:**
- Home Assistant REST / WebSocket client
- In-memory entity-state cache with real-time push
- JWT + PIN authentication and user/profile management
- Device integrations: MQTT, Zigbee, Z-Wave, BLE, Matter, HomeKit
- SQLite database (14 migrations) for history, preferences, webhooks, etc.
- File uploads, SSE event streams, Swagger UI

**Key endpoints:**
```
GET  /health
POST /api/auth/login
GET  /api/states
POST /api/services/{domain}/{service}
GET  /ws                       ← WebSocket real-time
GET  /api/events/stream        ← SSE entity updates
GET  /api/docs                 ← Swagger UI
```

### `iora-core` – Central Orchestrator (port 8090)

The system-wide command centre. All other IORA programs register themselves here on
startup so the dashboard and admin panel have a single source of truth for the whole
ecosystem.

**Responsibilities:**
- Service registry (other IORA programs self-register)
- Background health polling (every 30 s)
- Plugin registry (`PluginRegistry` from `iora-shared`)
- System-wide SSE event bus

**Key endpoints:**
```
GET  /health
GET  /api/core/services                    ← list registered services
POST /api/core/services/register           ← self-registration endpoint
GET  /api/core/services/:name/health       ← proxy health check
GET  /api/core/plugins                     ← list installed plugins
POST /api/core/plugins                     ← install plugin
DELETE /api/core/plugins/:id               ← remove plugin
GET  /api/core/events                      ← SSE event bus
POST /api/core/events                      ← broadcast event
```

### `iora-control` – Admin Panel Backend (port 8091)

The backend for the IORA Control admin dashboard. Aggregates data from `iora-core` and
`iora-home` to provide a single admin API.

**Responsibilities:**
- System stats (CPU, RAM, OS info via `sysinfo`)
- Proxied service and plugin management (via iora-core)
- Proxied user management (via iora-home)
- System-wide configuration store

**Key endpoints:**
```
GET  /health
GET  /api/control/dashboard    ← overview (services + plugins)
GET  /api/control/system       ← CPU / memory / OS stats
GET  /api/control/services     ← all IORA services (via iora-core)
GET  /api/control/logs         ← aggregated logs (placeholder)
GET  /api/control/plugins      ← plugin list (via iora-core)
POST /api/control/plugins      ← install plugin
DELETE /api/control/plugins/:id
GET  /api/control/users        ← users (via iora-home)
GET  /api/control/config       ← system config
PUT  /api/control/config       ← update system config
```

### `iora-assist` – AI Assistant (port 8092)

Skeleton service for the future IORA Assist AI component. All AI endpoints return
`501 Not Implemented` with instructions for connecting an AI backend.

**Responsibilities (future):**
- Natural-language chat interface
- Automation suggestions based on entity history
- Home insights and anomaly detection
- Natural-language automation creation

**Key endpoints:**
```
GET  /health
POST /api/assist/chat          ← chat with AI (requires AI backend)
GET  /api/assist/history       ← chat history
GET  /api/assist/suggestions   ← automation suggestions
POST /api/assist/automate      ← create automation from description
GET  /api/assist/insights      ← home insights
```

To enable AI features set `ASSIST_AI_BACKEND_URL` and `ASSIST_AI_API_KEY` in the
environment.

---

## Plugin System

Every IORA program can be extended with plugins using the traits defined in
`iora-shared::plugin`.

### Plugin Types

| Type | Trait | Purpose |
|------|-------|---------|
| Widget | *(frontend)* | UI components on the dashboard |
| Service | `IServicePlugin` | Background workers |
| API | `IApiPlugin` | Additional HTTP endpoints |
| Integration | `IIntegrationPlugin` | External device/service connections |
| Theme | *(frontend)* | Visual customisation |

### Plugin Lifecycle

```
Load manifest → Validate metadata & permissions
    → IPlugin::on_load()
    → Register in PluginRegistry
    → (active)
    → IPlugin::on_config_changed()  ← when config updates
    → IPlugin::on_unload()
    → Remove from PluginRegistry
```

### Plugin Permissions

```rust
pub enum PluginPermission {
    ReadEntities,      // read HA entity states
    ControlEntities,   // call HA services
    Storage,           // persistent key-value storage
    Network,           // outbound HTTP requests
    Notifications,     // push notifications to users
    SystemInfo,        // CPU / memory data
    PluginManager,     // manage other plugins
}
```

### Writing a Plugin (Rust)

```rust
use iora_shared::plugin::{IPlugin, PluginMetadata, PluginType, PluginPermission};
use async_trait::async_trait;

struct MyPlugin { meta: PluginMetadata }

#[async_trait]
impl IPlugin for MyPlugin {
    fn metadata(&self) -> &PluginMetadata { &self.meta }

    async fn on_load(&self) -> anyhow::Result<()> {
        tracing::info!("MyPlugin loaded");
        Ok(())
    }
}

// Register with iora-core via POST /api/core/plugins
```

---

## Frontend (IORA OS)

The React frontend is the IORA OS user interface. It is served by `iora-home` and
communicates with all backend programs.

```
src/
├── components/
│   ├── AdminPanel.tsx        ← IORA Control UI
│   ├── PageDesigner.tsx      ← drag-and-drop dashboard editor
│   └── widgets/              ← smart-home widget library
├── hooks/                    ← data-fetching hooks
└── lib/                      ← shared utilities
```

**IORA OS sections:**

| Section | Description | Backend |
|---------|-------------|---------|
| Dashboard | Smart Home widget grid | iora-home |
| IORA Control | Admin panel (users, system, plugins) | iora-control + iora-core |
| IORA Assist | AI chat interface *(future)* | iora-assist |

---

## Data Flow

### Entity State Updates

```
Home Assistant
  │  WebSocket event_state_changed
  ▼
iora-home (EntityStateCache)
  │  in-memory update
  ├──► WebSocket broadcast → connected browsers
  └──► SSE /api/events/stream → browsers
```

### Service Calls (e.g. toggle a light)

```
Browser → POST /api/services/light/turn_on
  → iora-home (ServiceCallBuffer coalesces rapid calls)
  → HA REST API
  → SSE/WS state-changed broadcast
  → Browser updates UI
```

### Plugin Installation

```
Admin Panel → POST /api/control/plugins
  → iora-control proxies to iora-core
  → iora-core: PluginRegistry::register()
  → SSE event "plugin.installed" broadcast
```

---

## Security Model

### Authentication

- JWT tokens issued by `iora-home` (`/api/auth/login`)
- Optional short PIN for kiosk / terminal devices
- API keys for machine-to-machine access
- Admin endpoints protected by `is_admin` flag

### Plugin Security

Plugins declare required permissions in their metadata. `iora-core` validates these
before registration and enforces them at runtime. Plugins with `PluginManager` permission
can install/remove other plugins.

---

## Port Map

| Service | Default Port | Protocol |
|---------|-------------|----------|
| iora-home | 8080 | HTTP, WebSocket, SSE |
| iora-core | 8090 | HTTP, SSE |
| iora-control | 8091 | HTTP |
| iora-assist | 8092 | HTTP |

Ports can be overridden with the `PORT` environment variable in each service.

---

## Deployment

### Development (run all services)

```bash
cd backend
cargo run -p iora-core    &   # start orchestrator first
cargo run -p iora-home    &   # smart home service
cargo run -p iora-control &   # admin panel backend
cargo run -p iora-assist  &   # AI assistant (optional)
```

### Docker Compose (recommended)

```yaml
services:
  iora-core:
    build: { context: ./backend, target: iora-core }
    ports: ["8090:8090"]

  iora-home:
    build: { context: ./backend, target: iora-home }
    ports: ["8080:8080"]
    environment:
      - HA_URL=http://homeassistant.local:8123
      - HA_TOKEN=${HA_TOKEN}
    depends_on: [iora-core]

  iora-control:
    build: { context: ./backend, target: iora-control }
    ports: ["8091:8091"]
    depends_on: [iora-core, iora-home]

  iora-assist:
    build: { context: ./backend, target: iora-assist }
    ports: ["8092:8092"]
    environment:
      - ASSIST_AI_BACKEND_URL=${AI_URL}
      - ASSIST_AI_API_KEY=${AI_KEY}
```

### Build individual programs

```bash
cd backend
cargo build --release -p iora-home
cargo build --release -p iora-core
cargo build --release -p iora-control
cargo build --release -p iora-assist
```

---

## Performance

| Technique | Where |
|-----------|-------|
| In-memory entity state cache | iora-home |
| ServiceCallBuffer (coalesces slider drags) | iora-home |
| WAL mode SQLite | iora-home |
| Connection pooling (sqlx) | iora-home |
| Broadcast channel for SSE / WS | iora-home, iora-core |
| Separate poll/cmd HTTP clients | iora-home HA client |

---

## Contributing

- See [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) for plugin development.
- Add new IORA programs as additional workspace members in `backend/Cargo.toml`.
- Shared types belong in `iora-shared`; program-specific logic stays in the program crate.

For core contributions:
1. Fork repository
2. Create feature branch
3. Write tests
4. Submit pull request
