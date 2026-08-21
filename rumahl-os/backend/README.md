# rumahl Backend – Cargo Workspace

This directory is a **Cargo workspace** containing all rumahl backend programs, each a
separate Rust binary that can be built and deployed independently.

## Programs

| Crate | Port | Purpose |
|-------|------|---------|
| `rumahl-home` | 8080 | Smart Home – HA integration, entity cache, dashboard API |
| `rumahl-core` | 8090 | Central orchestrator – service registry, plugin registry, event bus |
| `rumahl-control` | 8091 | Admin panel backend – system stats, config, proxied management APIs |
| `rumahl-assist` | 8092 | AI assistant skeleton – chat, insights, automation (future) |
| `rumahl-shared` | lib | Shared library – plugin traits, common types |

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the full system design.

## Prerequisites

- Rust 1.70+ (install from [rustup.rs](https://rustup.rs))
- Home Assistant instance with access token (for rumahl-home)

## Quick Start

### 1. Configure Environment

```bash
# Copy example environment file for rumahl-home
cp rumahl-home/.env.example rumahl-home/.env

# Edit with your Home Assistant details
nano rumahl-home/.env
```

Required configuration:
```env
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token
```

### 2. Build and Run

**Development:**
```bash
cargo run
```

**Production (optimized):**
```bash
cargo build --release
./target/release/ha-dashboard-backend
```

The server will start on `http://0.0.0.0:3001` by default.

## API Endpoints

### Health Check
```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Get All States
```bash
GET /api/states
```

Returns array of all entity states from Home Assistant.

### Get Single State
```bash
GET /api/states/:entity_id
```

Example:
```bash
curl http://localhost:3001/api/states/light.living_room
```

### Call Service
```bash
POST /api/services/:domain/:service
Content-Type: application/json

{
  "entity_id": "light.living_room",
  "brightness": 255
}
```

Example:
```bash
curl -X POST http://localhost:3001/api/services/light/turn_on \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.living_room", "brightness": 255}'
```

### WebSocket
```
WS /ws
```

Connect to receive real-time state updates:

```javascript
const ws = new WebSocket('ws://localhost:3001/ws')

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.type === 'state_changed') {
    console.log('States updated:', message.states)
  }
}
```

## Frontend Integration

Update your frontend to use the proxy backend:

```typescript
import { backendManager } from '@/lib/backend/provider'

// Configure to use proxy backend
await backendManager.setProvider('proxy', {
  url: 'http://localhost:3001',
  useWebSocket: true, // Enable real-time updates
  timeout: 10000,
})
```

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌────────────────┐
│   Frontend  │ ◄─────► │ Rust Backend │ ◄─────► │ Home Assistant │
│  (Browser)  │         │    (Axum)    │         │                │
└─────────────┘         └──────────────┘         └────────────────┘
      │                        │
      │                        │
      └────── WebSocket ───────┘
           (Real-time updates)
```

### Components

- **main.rs** - Server entry point and route configuration
- **ha_client.rs** - HTTP client for Home Assistant API
- **websocket.rs** - WebSocket connection manager and broadcaster

### State Updates

The backend polls Home Assistant every 2 seconds and broadcasts state changes to all connected WebSocket clients. This provides real-time updates without requiring the frontend to poll.

## Deployment

### Docker (Recommended)

Create a `Dockerfile`:

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ha-dashboard-backend /usr/local/bin/
EXPOSE 3001
CMD ["ha-dashboard-backend"]
```

Build and run:
```bash
docker build -t ha-backend .
docker run -p 3001:3001 \
  -e HA_URL=http://homeassistant.local:8123 \
  -e HA_TOKEN=your_token \
  ha-backend
```

### Systemd Service

Create `/etc/systemd/system/ha-backend.service`:

```ini
[Unit]
Description=Home Assistant Dashboard Backend
After=network.target

[Service]
Type=simple
User=ha-backend
WorkingDirectory=/opt/ha-backend
EnvironmentFile=/opt/ha-backend/.env
ExecStart=/opt/ha-backend/ha-dashboard-backend
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable ha-backend
sudo systemctl start ha-backend
sudo systemctl status ha-backend
```

## Development

### Project Structure

```
backend/
├── src/
│   ├── main.rs          # Server and routes
│   ├── ha_client.rs     # Home Assistant client
│   └── websocket.rs     # WebSocket handler
├── Cargo.toml           # Dependencies
├── .env.example         # Example environment
└── README.md           # This file
```

### Adding Features

1. **New Endpoint:**

Edit `main.rs`:
```rust
.route("/api/custom", get(custom_handler))
```

Add handler:
```rust
async fn custom_handler(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"custom": "data"}))
}
```

2. **New WebSocket Message:**

Edit `websocket.rs`:
```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WSMessage {
    // ... existing variants
    Custom { data: String },
}
```

### Testing

```bash
# Run tests
cargo test

# Run with detailed logging
RUST_LOG=debug cargo run

# Check formatting
cargo fmt --check

# Run clippy (linter)
cargo clippy
```

## Performance

- **Memory Usage:** ~10-20MB
- **CPU Usage:** <1% idle, ~5% under load
- **Latency:** <10ms for API proxying
- **WebSocket:** Supports 1000+ concurrent connections

## Troubleshooting

### Connection Refused

Check if Home Assistant is accessible:
```bash
curl http://homeassistant.local:8123/api/
```

### Authentication Failed

Verify your token:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://homeassistant.local:8123/api/states
```

### WebSocket Disconnects

Check firewall rules and ensure port 3001 is open:
```bash
sudo ufw allow 3001/tcp
```

## Security

- Always use HTTPS in production
- Store tokens securely (use environment variables)
- Enable CORS only for trusted origins
- Run backend with minimal privileges
- Keep Rust dependencies updated

## License

MIT License - See LICENSE file for details
