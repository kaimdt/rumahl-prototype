# Frontend Hot Reload Integration

> Seamless frontend development with Hot Module Replacement (HMR) during IORA development

## Overview

IORA supports multiple frontend development workflows:

1. **Pure Frontend Dev** (Fastest) — Vite dev server with instant HMR
2. **Integrated Dev** (Recommended) — Vite dev server + Backend API integration
3. **Production-like** — Build once, test with production assets

## Quick Start

### Method 1: Vite Dev Server (Fastest HMR)

Start the Vite dev server directly for fastest hot reload:

```bash
cd frontend
npm run dev
```

Access at: `http://localhost:5173`

**Benefits:**
- ⚡ Instant Hot Module Replacement
- 🔄 Sub-second reload times
- 🎨 Perfect for UI/styling work

**Limitations:**
- API calls proxy to backend (configurable in `vite.config.ts`)
- Backend must be running separately

### Method 2: Frontend Dev Proxy Mode (Integrated)

Run backend with frontend dev proxy enabled:

```bash
# Terminal 1: Start Vite dev server
cd frontend
npm run dev

# Terminal 2: Start backend with dev proxy
cd iora-os/backend/services/iora-home
IORA_FRONTEND_DEV_URL=http://localhost:5173 cargo run
```

Access at: `http://localhost:3001` or `http://localhost:8126`

**Benefits:**
- ✅ Full backend integration
- 🔗 Real API calls, WebSocket connections
- 🎯 Realistic testing environment
- 💡 See dev mode indicator

**How it works:**
- Backend detects `IORA_FRONTEND_DEV_URL`
- Displays dev mode info page
- Directs you to Vite dev server for HMR

### Method 3: Dev All Services (Complete System)

Use the integrated dev runner:

```bash
# From project root
npm run dev:all

# Or with watch mode
npm run dev:watch
```

This starts:
- ✅ Frontend (Vite dev server)
- ✅ Backend (iora-home)
- ✅ Other services as needed

**Interactive controls:**
- `Space` — Toggle service on/off
- `w` — Toggle hot-reload
- `r` — Restart selected service
- `l` — View service logs

## Environment Variables

### IORA_FRONTEND_DEV_URL

Points backend to Vite dev server for development.

```bash
# Linux/macOS
export IORA_FRONTEND_DEV_URL=http://localhost:5173

# Windows PowerShell
$env:IORA_FRONTEND_DEV_URL="http://localhost:5173"

# Windows CMD
set IORA_FRONTEND_DEV_URL=http://localhost:5173
```

**Default Vite port:** 5173
**Can be changed in:** `frontend/vite.config.ts`

### VITE_IORA_BACKEND_URL

Configures Vite proxy target for API calls.

```bash
# Default (set in vite.config.ts)
VITE_IORA_BACKEND_URL=http://iora.local:3001

# For local development
VITE_IORA_BACKEND_URL=http://localhost:3001
```

This controls where Vite proxies `/api/*`, `/ws/*`, `/health`, and `/uploads/*` requests.

## Production Build

Build frontend for production:

```bash
cd frontend
npm run build
```

Output: `frontend/dist/`

The backend automatically serves from `dist/` when:
- `IORA_FRONTEND_DEV_URL` is **not set**
- `dist/index.html` exists

## Development Workflows

### UI Development (Styling, Components)

**Best: Method 1 (Pure Vite)**

```bash
cd frontend
npm run dev
```

- Fastest feedback loop
- Instant HMR
- Perfect for CSS, React components

### API Integration Testing

**Best: Method 2 (Dev Proxy) or Method 3 (Dev All)**

```bash
# Start both frontend and backend
npm run dev:all
```

- Test real API responses
- Verify WebSocket connections
- Check authentication flows

### Full System Testing

**Best: Method 3 (Dev All) or Production Build**

```bash
# Option A: Dev all services
npm run dev:all

# Option B: Production build
cd frontend && npm run build
cd ../iora-os/backend/services/iora-home && cargo run
```

- Test production bundle
- Verify build optimizations
- Check static asset serving

## How Frontend Dev Proxy Works

1. **Detection**: iora-home checks for `IORA_FRONTEND_DEV_URL` on startup
2. **Info Page**: When detected, shows dev mode indicator at root
3. **Vite Access**: Directs you to Vite dev server for actual frontend
4. **API Proxy**: Vite proxies API calls back to iora-home (configured in `vite.config.ts`)

### Request Flow

```
Browser → Vite Dev Server (localhost:5173)
           ↓ (HMR WebSocket)
        Frontend (React, instant reload)
           ↓ (/api/* requests)
        Vite Proxy → iora-home (localhost:3001)
           ↓
        Backend API
```

## Advanced: VS Code Integration

### Launch Configurations

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "🎨 Frontend Dev Only",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}/frontend",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "console": "integratedTerminal"
    },
    {
      "name": "🔧 Backend + Frontend Dev",
      "type": "lldb",
      "request": "launch",
      "program": "${workspaceFolder}/iora-os/backend/target/debug/iora-home",
      "cwd": "${workspaceFolder}/iora-os/backend/services/iora-home",
      "env": {
        "IORA_FRONTEND_DEV_URL": "http://localhost:5173"
      },
      "preLaunchTask": "Start Frontend Dev Server"
    }
  ]
}
```

### Tasks

Add to `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Start Frontend Dev Server",
      "type": "shell",
      "command": "npm run dev",
      "options": {
        "cwd": "${workspaceFolder}/frontend"
      },
      "isBackground": true,
      "problemMatcher": {
        "pattern": {
          "regexp": "^$"
        },
        "background": {
          "activeOnStart": true,
          "beginsPattern": "VITE.*ready in",
          "endsPattern": "Local:.*http://localhost:5173"
        }
      }
    }
  ]
}
```

## Troubleshooting

### Frontend not loading / blank page

**Check:**
1. Is Vite dev server running? `curl http://localhost:5173`
2. Is `IORA_FRONTEND_DEV_URL` set correctly?
3. Check browser console for errors

**Fix:**
```bash
# Restart Vite dev server
cd frontend
npm run dev
```

### API calls failing (CORS errors)

**Issue:** Vite proxy not configured correctly

**Fix:** Check `frontend/vite.config.ts`:
```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',  // Must match backend port
      changeOrigin: true,
    },
  },
}
```

### Changes not reflecting / no HMR

**Check:**
1. Are you accessing Vite dev server directly? (localhost:5173)
2. Is the HMR WebSocket connected? (Check browser console)
3. Are you editing files outside `frontend/src/`?

**Fix:**
- Always use `http://localhost:5173` for HMR
- Hard refresh if HMR connection lost: `Ctrl+Shift+R` / `Cmd+Shift+R`

### "Cannot connect to Vite dev server" error

**Issue:** Backend can't reach Vite dev server

**Check:**
```bash
# Test if Vite is accessible
curl http://localhost:5173

# Check Vite is bound to all interfaces
# In vite.config.ts, ensure: server: { host: '0.0.0.0' }
```

### Build works but dev doesn't

**Issue:** Environment-specific code or configuration

**Debug:**
```bash
# Check what Vite sees
cd frontend
npm run dev -- --debug

# Check backend environment
cd iora-os/backend/services/iora-home
RUST_LOG=debug cargo run
```

## Best Practices

### ✅ DO

- Use Vite dev server directly for UI work (fastest HMR)
- Keep Vite running in background during development
- Use production builds for final testing
- Commit `frontend/dist/` for deployments (if needed)

### ❌ DON'T

- Don't proxy WebSocket connections through nginx/reverse proxy (breaks HMR)
- Don't edit files outside `frontend/src/` expecting HMR
- Don't use production builds for rapid iteration
- Don't forget to rebuild before deployment testing

## Architecture

### Development Mode

```
┌─────────────────────┐
│  Vite Dev Server    │ ← Developer accesses here
│  localhost:5173     │ ← HMR WebSocket
└──────────┬──────────┘
           │ Proxy /api/*
           ↓
┌─────────────────────┐
│  iora-home          │
│  localhost:3001     │ ← Backend API
└─────────────────────┘
```

### Production Mode

```
┌─────────────────────┐
│  iora-home          │ ← User accesses here
│  localhost:8126     │
│  ├─ /api/* → API    │
│  └─ /* → dist/      │ ← Serves built frontend
└─────────────────────┘
```

## Related Documentation

- [IORA Dev Runner](../../scripts/dev/README.md) — Multi-service dev manager
- [Hot-Reload for Backend](./dev-bridge-hot-reload.md) — Backend service hot reload
- [Vite Configuration](../../frontend/vite.config.ts) — Frontend build config
- [Development Setup](./development-setup.md) — Complete dev environment guide

## FAQ

**Q: Can I use HMR with the backend serving the frontend?**
A: Not directly. For HMR, access Vite dev server at localhost:5173. The backend dev proxy mode just provides awareness that dev mode is active.

**Q: Do I need to rebuild frontend for every change?**
A: No! Use Vite dev server (Method 1 or 2) for instant HMR without rebuilds.

**Q: What's the difference between `npm run dev` and `npm run dev:all`?**
A: `npm run dev` starts only the frontend Vite server. `npm run dev:all` starts all services (frontend + backend + others) with auto-discovery.

**Q: Can I use hot reload in production?**
A: No. Hot reload is dev-only. Production uses pre-built assets from `dist/`.

**Q: How do I switch between dev and production modes?**
A: Simply unset `IORA_FRONTEND_DEV_URL` and ensure `frontend/dist/` exists:
```bash
unset IORA_FRONTEND_DEV_URL  # Linux/macOS
$env:IORA_FRONTEND_DEV_URL=""  # Windows PS
```

## Version History

- **v2.1** — Frontend dev proxy mode with IORA_FRONTEND_DEV_URL
- **v2.0** — Vite migration, separate dev server
- **v1.x** — Embedded frontend build

---

**Need help?** Check [GitHub Issues](https://github.com/iora/iora/issues) or [Community Forum](https://community.iora.io)
