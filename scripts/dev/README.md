# IORA Development Scripts

> Automation scripts for IORA development workflows

## Quick Start Scripts

### `start-full` — Frontend + Backend (Automated) ⚡

**Start both Vite dev server and iora-home backend with one command:**

```bash
# From frontend directory
npm run dev:full

# Or directly
node scripts/dev/start-full.mjs

# Windows
scripts\dev\start-full.bat

# Linux/macOS
./scripts/dev/start-full.sh
```

**What it does:**
1. Starts Vite dev server on port 5173
2. Waits for Vite to be ready
3. Starts iora-home backend on port 3001
4. Sets `IORA_FRONTEND_DEV_URL=http://localhost:5173` automatically
5. Aggregates logs from both processes
6. Graceful shutdown with Ctrl+C

**Access:**
- Frontend (with HMR): http://localhost:5173
- Backend API: http://localhost:3001
- Dev Info Page: http://localhost:3001/

### `iora-dev.mjs` — Interactive Service Manager

**Full-featured interactive service manager with hot reload:**

```bash
# Interactive mode
npm run dev:all

# Start all services
npm run dev:start

# Start with hot reload enabled
npm run dev:watch

# List available services
npm run dev:list
```

**Interactive controls:**
- `↑/↓` — Navigate services
- `Space` — Toggle service on/off
- `Enter` — Show service info
- `w` — Toggle hot-reload
- `l` — Show logs
- `r` — Restart selected service
- `q` — Quit

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **start-full** | `npm run dev:full` | Start frontend + backend (automated) |
| **iora-dev** | `npm run dev:all` | Interactive service manager |
| **dev:start** | `npm run dev:start` | Start all services (non-interactive) |
| **dev:watch** | `npm run dev:watch` | Start all with hot reload |
| **dev:list** | `npm run dev:list` | List available services |

## Use Cases

### 1. Quick Frontend + Backend Development

**Best for:** UI development with backend API integration

```bash
npm run dev:full
```

**Features:**
- ✅ One command startup
- ✅ Auto-configured environment
- ✅ Aggregated logs
- ✅ Graceful shutdown

### 2. Full System Development

**Best for:** Multi-service development and testing

```bash
npm run dev:all
```

**Features:**
- ✅ Interactive service management
- ✅ Hot reload support
- ✅ Individual service control
- ✅ Live log viewing

### 3. Frontend Only

**Best for:** Pure UI/component development

```bash
cd frontend
npm run dev
```

**Features:**
- ✅ Fastest HMR
- ✅ Minimal setup
- ✅ API proxy to backend

## Script Details

### start-full.mjs

**Purpose:** Automated concurrent startup of frontend and backend

**Configuration:**
```bash
# Environment variables
VITE_PORT=5173                    # Vite dev server port
BACKEND_PORT=3001                 # iora-home port
RUST_LOG=info,iora_home=debug    # Backend log level

# Command line
node start-full.mjs --port=3002   # Custom backend port
```

**Process flow:**
1. Verify directories exist
2. Start Vite dev server
3. Monitor Vite startup (timeout: 30s)
4. Start iora-home with `cargo run`
5. Set `IORA_FRONTEND_DEV_URL` automatically
6. Display access URLs
7. Stream logs with prefixes
8. Handle Ctrl+C for clean shutdown

**Log format:**
```
[HH:MM:SS] VITE     Local:   http://localhost:5173/
[HH:MM:SS] BACKEND  Server listening on 0.0.0.0:3001
```

### iora-dev.mjs

**Purpose:** Full-featured interactive development service manager

**Auto-discovery:**
- Scans `iora-os/backend/services/` for Rust services
- Detects `frontend/package.json` for Vite
- Identifies other services automatically

**Features:**
- ✨ TUI with mouse support
- 🔄 Hot reload for Rust services (via iora-dev-bridge)
- 📊 Real-time service status
- 📝 Log streaming per service
- 🎨 Color-coded output
- 🖱️ Mouse navigation

## Platform Support

### Windows
- ✅ PowerShell
- ✅ CMD
- ✅ Git Bash
- Uses `.bat` wrappers

### Linux/macOS
- ✅ Bash
- ✅ Zsh
- ✅ Fish
- Uses `.sh` wrappers

### Requirements
- Node.js ≥ 18
- Rust + Cargo (for backend)
- npm (for frontend)

## Troubleshooting

### "Cannot find module" error

```bash
# Ensure you're in the correct directory
cd frontend
npm run dev:full

# Or from project root
node scripts/dev/start-full.mjs
```

### Frontend/Backend fails to start

**Check prerequisites:**
```bash
# Node.js version
node --version  # Should be ≥ 18

# Cargo installed
cargo --version

# Dependencies installed
cd frontend && npm install
cd iora-os/backend && cargo build
```

### Port already in use

**Find and kill process:**
```bash
# Linux/macOS
lsof -i :5173  # or :3001
kill -9 <PID>

# Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

**Or use custom ports:**
```bash
VITE_PORT=5174 npm run dev:full
# or
node start-full.mjs --port=3002
```

### Logs not showing / garbled output

**Issue:** Terminal doesn't support ANSI colors

**Fix:**
```bash
# Disable colors
NO_COLOR=1 npm run dev:full

# Or use a better terminal
# Windows: Windows Terminal
# macOS: iTerm2
# Linux: GNOME Terminal, Konsole
```

### Backend compilation errors

**Check Rust toolchain:**
```bash
# Update Rust
rustup update

# Clean and rebuild
cd iora-os/backend
cargo clean
cargo build -p iora-home
```

## Advanced Usage

### Custom Environment Variables

```bash
# Create .env.local in frontend/
VITE_IORA_BACKEND_URL=http://custom-host:3001

# Or set inline
RUST_LOG=trace npm run dev:full
```

### Debug Mode

```bash
# Enable verbose logging
RUST_LOG=debug,iora_home=trace npm run dev:full

# Enable Vite debug
DEBUG=vite:* npm run dev:full
```

### Production-like Testing

```bash
# Build frontend
cd frontend && npm run build

# Run backend (serves from dist/)
cd ../iora-os/backend/services/iora-home
cargo run

# Access at http://localhost:3001
```

## Related Documentation

- [Frontend Hot Reload](../../iora-os/docs/frontend-hot-reload.md) — Detailed hot reload guide
- [Backend Dev Bridge](../../iora-os/docs/dev-bridge-hot-reload.md) — Backend hot reload system
- [Frontend README](../../frontend/README.md) — Frontend development guide

## Contributing

When adding new scripts:

1. Follow naming convention: `start-*.mjs` for launchers
2. Include Windows (`.bat`) and Unix (`.sh`) wrappers
3. Add ANSI color output for better UX
4. Document in this README
5. Add npm script aliases in `package.json`

## License

MIT License — Part of IORA smart home system
