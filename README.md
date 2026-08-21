# rumahl — Home Assistant Dashboard

[![CI](https://github.com/rumahl/ora/actions/workflows/ci.yml/badge.svg)](https://github.com/rumahl/ora/actions/workflows/ci.yml)
[![Buildroot Release](https://github.com/rumahl/ora/actions/workflows/buildroot-release.yml/badge.svg)](https://github.com/rumahl/ora/actions/workflows/buildroot-release.yml)
[![Release](https://img.shields.io/github/v/release/rumahl/ora?sort=semver)](https://github.com/rumahl/ora/releases)
[![License](https://img.shields.io/github/license/rumahl/ora)](LICENSE)

A modern, fully-featured **Home Assistant Dashboard** with real-time entity control, weather forecasts, history charts, drag-and-drop page design, multi-user/multi-device support, and an embedded appliance OS.

Built with **React + TypeScript + Tailwind CSS** (frontend) and **Rust + Axum + SQLite** (backend microservices).

---

## Features

### Entity Control
- **Lights** — brightness, color temperature, RGB/RGBW/RGBWW, effects, 2-zone sync
- **Climate** — HVAC mode, target temperature, fan modes
- **Switches / Input Booleans** — toggle with visual feedback
- **Covers** — open/close/stop with position control
- **Fans** — speed, direction, oscillation
- **Media Players** — play/pause, volume, source selection
- **Locks, Timers, Counters, Vacuums, Humidifiers, Alarms**
- **Automations, Scripts, Scenes, Buttons** — trigger and monitor
- **Sensors & Binary Sensors** — live state with smart date/time formatting
- **Input Number, Select, Text, DateTime** — interactive controls
- **Person / Device Tracker** — presence with avatar display

### Dashboard Design
- **Drag-and-drop page designer** with widget palette
- **Widget groups** — collapsible containers for organizing entities
- **Custom pages** — unlimited pages with icons and navigation
- **Dynamic overview** — time/entity-triggered view switching
- **Layout templates** — quick-start dashboard layouts

### Weather
- **Current conditions** with large icon display
- **Daily & hourly forecasts** with German condition labels
- **Forecast caching** in SQLite (30-min TTL) for instant display
- **Responsive modal** with detailed weather information

### History & Statistics
- **Long-press any widget** to open history/statistics dialog
- **Local entity history** cached in SQLite
- **Interactive charts** (Recharts) with time range selection

### UI/UX
- **Glassmorphism design** with ambient glow effects
- **Night mode** with automatic scheduling
- **Dynamic backgrounds** — static images, slideshows, gradients
- **Screensaver** with configurable idle timeout
- **Haptic feedback** on interactions
- **Responsive** — tablet, desktop, mobile
- **PWA support** — installable as standalone app
- **German locale** — date/time formatting in de-DE

### Desktop App
- **rumahl Desktop** — Tauri shell for remote rumahl Home rendering, local system integration and tray control
- **Glass titlebar** — semi-transparent, borderless desktop titlebar with clean taskbar integration
- **Remote home embedding** — live rumahl Home page with desktop-sized viewport
- **Desktop-only settings** — tray, system, proxy, platform-specific features
- **System controls** — brightness, always-on-top, kiosk mode, screensaver
- **Proxy management** — automatically start local proxy, configure ports
- **Advanced desktop diagnostics** — live CPU/RAM/disk/battery metrics, network status

### Admin Control Center
- **Sidebar navigation** — system, users, HA integration, network, logs, and more
- **Service & task monitoring** — inspect running services, queue state
- **Control mode** — autonomous, manual, or supervised operation
- **Home Assistant integration** — HA config, entity explorer, scenes, automations, logbook
- **Device networks** — MQTT, Zigbee, Z-Wave, Matter, BLE, HomeKit diagnostics
- **API keys & webhooks** — manage external access, rate limits
- **Network, backup and database tools** — connectivity, export/import, SQLite health
- **Realtime streams** — SSE/WebSocket diagnostics and event stream inspection
- **Full admin feature set** — services, users, API keys, webhooks, integrations, entities, scenes, automations, scheduler, analytics, backups, network, logs, logbook, calendars, realtime, database, warnings, system notifications

### Backend (Microservice Architecture)
- **Rust + Axum** — fast, memory-safe backend microservices
- **SQLite** — zero-config database with WAL mode (per-service)
- **PostgreSQL** — for the App Store (rumahl-appstore)
- **Persistent WebSocket** to Home Assistant for real-time state sync
- **Entity state cache** — instant responses, no HA round-trips
- **Service call buffer** — coalesces rapid slider/dial changes
- **JWT authentication** with bcrypt password hashing
- **Multi-user & multi-device** configuration profiles
- **Background media proxy** — serves HA camera/agent images

### rumahl OS (Embedded Appliance)
- **Buildroot-based** embedded OS for dedicated hardware
- **Systemd services** — all microservices run natively (no Docker)
- **RAUC-based OTA updates** — dual-copy A/B partition scheme
- **Web-based installer** with guided setup
- **SPARK runtime** — sandboxed plugin execution (JS/TS)
- **App Store** — install community apps via `ora app install`

---

## Quick Start

### Prerequisites
- **Node.js** 18+ and **npm**
- **Rust** 1.70+ and **Cargo**
- **Home Assistant** instance with a Long-Lived Access Token

### 1. Clone & Install

```bash
git clone https://github.com/rumahl/ora.git && cd ora
cd frontend && npm install
```

### 2. Configure Environment

```bash
# Backend configuration
cp rumahl-os/backend/services/rumahl-home/.env.example rumahl-os/backend/services/rumahl-home/.env
# Edit .env:
#   HA_URL=http://homeassistant.local:8123
#   HA_TOKEN=your_long_lived_access_token
#   DATABASE_URL=sqlite:./data/ha-dashboard.db
```

### 3. Build & Run

```bash
# Build frontend
cd frontend && npm run build

# Build backend (rumahl-home service)
cd rumahl-os/backend && cargo build -p rumahl-home --release

# Run
./target/release/rumahl-home
```

The dashboard is available at **http://localhost:3001**.

### Development Mode

**Dev VM (production-like rumahl OS environment)**:

```bash
cd rumahl-os
./dev-local.sh --source-mode   # default: services run via cargo run from the 1:1 mirror
./dev-local.sh --build-mode    # alternative: run deployed binaries (/usr/bin/rumahl-*)
```

The dev VM keeps a **1:1 mirror of your repository** at `/home/ora/ora`:

```bash
./dev-sync.sh --once           # full mirror now
./dev-sync.sh --watch          # continuous mirror (~1s latency, fswatch/inotifywait)
```

- **Source mode**: Rust services run via `cargo run` from the mirror (incremental
  recompile on change); the frontend runs as a Vite dev server inside the VM with
  HMR (backend proxies via `RUMAHL_FRONTEND_DEV_URL`). The in-VM hot-reload daemon
  (`rumahl-hot-reload.service`) restarts the affected service automatically when
  its sources change.
- **Build mode**: `dev-watch.sh` builds inside the VM and ships the binaries
  through the mirror drop-box (`/home/ora/ora/.rumahl-dev/binaries`); the in-VM
  hot-reload daemon installs them to `/usr/bin/rumahl-*` and restarts the
  services – the classic production-like flow, fully mirror-based.
- **Windows**: run the scripts in PowerShell (`dev-local.ps1 -Mode source`); the
  mirror sync uses WSL rsync (incremental) – start the watcher with
  `wsl bash dev-sync.sh --watch`.

**Direct (no VM)**:

```bash
# Terminal 1 — Backend (with auto-reload)
cd rumahl-os/backend && cargo run -p rumahl-home

# Terminal 2 — Frontend (with hot reload)
cd frontend && npm run dev
# -> http://localhost:5173 (proxies API to :3001)
```

---

## Docker

### Standard Deployment

```bash
docker compose -f deploy/docker-compose.yml up -d
```

### Minimal Deployment

```bash
docker compose -f deploy/docker-compose.minimal.yml up -d
```

---

## Architecture

```
+-------------+     WebSocket      +------------------+     WebSocket     +---------------+
|   Browser   |<------------------>|  rumahl-home       |<----------------->| Home Assistant|
|  React SPA  |     REST API       |  (Axum + SQLite) |     REST API     |   Instance    |
+-------------+                    +------------------+                   +---------------+
                                           |
                                    +------+------+
                                    |             |
                              rumahl-core    rumahl-appstore
                           (Service Disc.)   (PostgreSQL)
                                    |
                              rumahl-supervisor
                           (Docker Container)
                                    |
                              rumahl-gateway
                           (Messaging/Webhooks)
```

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Radix UI + Recharts
- **Backend**: Rust + Axum + SQLx + SQLite + tokio-tungstenite (per-service DB)
- **State sync**: Persistent WebSocket to HA, entity cache, 60s safety-net polling
- **Database**: SQLite with migrations (users, devices, profiles, pages, widgets, history, preferences, weather cache) + PostgreSQL for App Store

---

## Project Structure

```
ora/
├── rumahl-os/backend/          # 🏠 MAIN BACKEND (Rust Workspace, 20+ Crates)
│   ├── shared/rumahl-shared/   # Shared types, traits, permissions
│   └── services/             # Microservices
│       ├── rumahl-home/        # Main API (Axum, Port 3001/8126)
│       ├── rumahl-core/        # Service discovery & plugin registry
│       ├── rumahl-appstore/    # App Store (PostgreSQL)
│       ├── rumahl-supervisor/  # Docker container management
│       └── ... (rumahl-files, rumahl-secrets, rumahl-security, etc.)
├── frontend/                 # React SPA (Vite + Tailwind)
├── desktop/                  # Tauri desktop app
├── sdks/                     # SDKs (JS, Go, Rust, C++, Python, PHP)
├── apps/                     # Example apps & configs
├── docs/                     # Documentation
├── deploy/                   # Docker Compose files
├── custom_components/        # Home Assistant integration
└── rumahl-os/                  # Buildroot-based embedded OS
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + HA connection status |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login (returns JWT) |
| GET | `/api/auth/verify` | Verify JWT token |
| GET | `/api/states` | All entity states (cached) |
| GET | `/api/states/:id` | Single entity state |
| POST | `/api/services/:domain/:service` | Call HA service (auth required) |
| GET | `/api/history/period/:start` | HA history for entities |
| GET | `/api/local-history/:id` | Local cached history |
| GET | `/api/weather/forecast/:id/:type` | Cached weather forecast |
| GET | `/ws` | WebSocket for real-time updates |
| GET | `/api/config/*` | Configuration CRUD |
| POST | `/api/appstore/install` | Install app from ZIP |

---

## License

MIT

---

## Bot Status

*Zuletzt geprüft: Sun Jun  7 05:15:59 PM CEST 2026 — Bot-Workflow intakt (Issue #68)*
