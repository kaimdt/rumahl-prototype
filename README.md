# MDT HOME Dashboard

A modern, fully-featured **Home Assistant Dashboard** with real-time entity control, weather forecasts, history charts, drag-and-drop page design, and multi-user/multi-device support.

Built with **React + TypeScript + Tailwind CSS** (frontend) and **Rust + Axum + SQLite** (backend).

---

## Features

### Entity Control
- **Lights** -- brightness, color temperature, RGB/RGBW/RGBWW, effects, 2-zone sync
- **Climate** -- HVAC mode, target temperature, fan modes
- **Switches / Input Booleans** -- toggle with visual feedback
- **Covers** -- open/close/stop with position control
- **Fans** -- speed, direction, oscillation
- **Media Players** -- play/pause, volume, source selection
- **Locks, Timers, Counters, Vacuums, Humidifiers, Alarms**
- **Automations, Scripts, Scenes, Buttons** -- trigger and monitor
- **Sensors & Binary Sensors** -- live state with smart date/time formatting
- **Input Number, Select, Text, DateTime** -- interactive controls
- **Person / Device Tracker** -- presence with avatar display

### Dashboard Design
- **Drag-and-drop page designer** with widget palette
- **Widget groups** -- collapsible containers for organizing entities
- **Custom pages** -- unlimited pages with icons and navigation
- **Dynamic overview** -- time/entity-triggered view switching
- **Layout templates** -- quick-start dashboard layouts

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
- **Dynamic backgrounds** -- static images, slideshows, gradients
- **Screensaver** with configurable idle timeout
- **Haptic feedback** on interactions
- **Responsive** -- tablet, desktop, mobile
- **PWA support** -- installable as standalone app
- **German locale** -- date/time formatting in de-DE

### Backend
- **Rust + Axum** -- fast, memory-safe backend
- **SQLite** -- zero-config database with WAL mode
- **Persistent WebSocket** to Home Assistant for real-time state sync
- **Entity state cache** -- instant responses, no HA round-trips
- **Service call buffer** -- coalesces rapid slider/dial changes
- **JWT authentication** with bcrypt password hashing
- **Multi-user & multi-device** configuration profiles
- **Background media proxy** -- serves HA camera/agent images

---

## Quick Start

### Prerequisites
- **Node.js** 18+ and **npm**
- **Rust** 1.70+ and **Cargo**
- **Home Assistant** instance with a Long-Lived Access Token

### 1. Clone & Install

```bash
git clone <repo-url> && cd home-assistant-dashb
npm install
```

### 2. Configure Environment

```bash
# Backend configuration
cp backend/.env.example backend/.env
# Edit backend/.env:
#   HA_URL=http://homeassistant.local:8123
#   HA_TOKEN=your_long_lived_access_token
#   DATABASE_URL=sqlite:./data/ha-dashboard.db
```

### 3. Build & Run

```bash
# Build frontend
npm run build

# Build backend
cd backend && cargo build --release

# Run (from backend/ directory)
./target/release/ha-dashboard-backend
```

The dashboard is available at **http://localhost:3001**.

### Development Mode

```bash
# Terminal 1 -- Backend
cd backend && cargo run

# Terminal 2 -- Frontend (with hot reload)
npm run dev
# -> http://localhost:5173 (proxies API to :3001)
```

---

## Docker

```bash
docker build -t mdt-home-dashboard .
docker run -d \
  -p 3001:3001 \
  -e HA_URL=http://homeassistant.local:8123 \
  -e HA_TOKEN=your_token \
  -v dashboard-data:/app/backend/data \
  mdt-home-dashboard
```

---

## Architecture

```
+-------------+     WebSocket      +------------------+     WebSocket     +---------------+
|   Browser   |<------------------>|  Rust Backend    |<----------------->| Home Assistant|
|  React SPA  |     REST API       |  (Axum + SQLite) |     REST API     |   Instance    |
+-------------+                    +------------------+                   +---------------+
```

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Radix UI + Recharts
- **Backend**: Rust + Axum 0.7 + SQLx + SQLite + tokio-tungstenite
- **State sync**: Persistent WebSocket to HA, entity cache, 60s safety-net polling
- **Database**: SQLite with 5 migrations (users, devices, profiles, pages, widgets, history, preferences, weather cache)

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

---

## Project Structure

```
src/                        # React frontend
  components/
    widgets/                # 40+ entity widgets
    ui/                     # Radix-based UI primitives
    PageDesigner/           # Drag-and-drop editor
  contexts/                 # React context providers
  hooks/                    # Custom hooks
  lib/                      # Utilities, HA client, types
backend/                    # Rust backend
  src/
    main.rs                 # Routes, handlers, app state
    ha_client.rs            # HA REST client
    ha_websocket.rs         # Persistent HA WebSocket
    websocket.rs            # Frontend WebSocket manager
    db/                     # SQLite models & repositories
    auth.rs                 # JWT + bcrypt auth
    entity_cache.rs         # In-memory state cache
  migrations/               # SQL migration files
dist/                       # Built frontend (served by backend)
package.json
```

---

## License

MIT
