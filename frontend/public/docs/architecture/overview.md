# IORA Architecture Overview

**IORA – Interface for Optimized Residential Autonomy** is an autonomous AI system designed
to manage and support both a smart home and the people living in it. The system is fully
independent of external services: Home Assistant is an optional integration, not a
dependency.

---

## High-Level System Map

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                         IORA OS (Browser UI)                         │
  │                                                                       │
  │   ┌─────────────────┐   ┌──────────────────┐   ┌───────────────┐    │
  │   │  IORA Dashboard  │   │  IORA Control    │   │  IORA Assist  │    │
  │   │  (Smart Home)    │   │  (Admin Panel)   │   │  (AI Chat)    │    │
  │   └────────┬────────┘   └────────┬─────────┘   └───────┬───────┘    │
  └────────────┼────────────────────┼──────────────────────┼────────────┘
               │          HTTP / WebSocket / SSE            │
  ┌────────────┼────────────────────┼────────────┐         │
  │ iora-home  │  iora-core  iora-  │  iora-     │         │ AI requests
  │  :8080     │  :8090     control │  assist    │         │
  │            │            :8091   │  :8092     │         │
  └────────────┴────────────────────┴────────────┘         │
                                                            ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │                    IORA Desktop (Tauri v2)                          │
  │                                                                      │
  │  System Tray App (background)  ·  Settings Window (React)           │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  LM Studio Proxy  →  http://localhost:11435  →  LM Studio    │   │
  │  │                          (OpenAI-compatible REST API)         │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  └────────────────────────────────────────────────────────────────────┘
               │

### `iora-desktop` — Desktop Shell (Tauri)

Desktop shell for IORA Home and admin tools, built with Tauri and React.

**Responsibilities:**
- Transparent glass titlebar and tray integration
- Remote IORA Home embedding with desktop viewport rendering
- Desktop-only settings for brightness, kiosk, always-on-top, proxy and diagnostics
- Local system metrics, proxy health and desktop lifecycle management
- LM Studio proxy startup and connection for local AI services

  ┌────────────┴────────────┐
  │  Home Assistant          │
  │  (Optional integration)  │
  └──────────────────────────┘
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
├── iora-assist/        ← AI assistant skeleton (port 8092)
├── iora-secrets/       ← Encrypted secrets storage (port 8093)
├── iora-watchdog/      ← Health monitoring and failover (port 8094)
├── iora-security/      ← Security monitoring and PostgreSQL management (port 8095)
├── iora-files/         ← Secure file sharing backend with share links and WebDAV access
├── iora-gateway/       ← Sandboxed external integration gateway (port 8096)
├── iora-supervisor/    ← Docker orchestration and container management (port 8097)
└── iora-installer/     ← Installation and update management (CLI)
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
- PostgreSQL database (16 migrations) for history, preferences, webhooks, etc.
- Person movement tracker: polls HA `person.*` entities every 30 s, stores location history, computes daily summaries
- Presence-based automation engine: fires HA service calls on arrival/departure events
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

**Background services (always-on):**
- `PersonTracker` – polls HA every 30 s for all `person.*` entities, writes location transitions to `person_location_history`, aggregates into `person_daily_summary`
- `AutomationEngine` – evaluates `arrival_light` / `departure_light` rules on each person state change and calls HA services automatically

### `iora-core` – Central Orchestrator (port 8090)

The system-wide command centre. All other IORA programs register themselves here on
startup so the dashboard and admin panel have a single source of truth for the whole
ecosystem.

**Responsibilities:**
- Service registry (other IORA programs self-register)
- Background health polling (every 30 s)
- Plugin registry (`PluginRegistry` from `iora-shared`)
- System-wide SSE event bus
- Optional PostgreSQL storage for analytics snapshots and system event log

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
- Home Assistant integration endpoints for config, connection status, entities, scenes and automations
- Network, backup, database and admin notification support
- MQTT / Zigbee / Z-Wave / Matter / BLE / HomeKit status aggregation
- System notifications and warning stream delivery
- Admin sidebar metadata and tabbed feature discovery

**Key endpoints:**
```
GET  /health
GET  /api/control/dashboard    ← overview (services + plugins)
GET  /api/control/system       ← CPU / memory / OS stats
GET  /api/control/services     ← all IORA services (via iora-core)
GET  /api/control/tasks        ← control task status and queue overview
GET  /api/control/mode         ← active control mode and available modes
GET  /api/control/users        ← users (via iora-home)
GET  /api/control/api-keys     ← API keys and rate limits
GET  /api/control/webhooks     ← registered webhooks
GET  /api/control/ha/config    ← Home Assistant configuration
GET  /api/control/ha/connection← HA connection status and integrations
GET  /api/control/ha/entities  ← entity explorer and metadata
GET  /api/control/ha/scenes    ← scenes and triggers
GET  /api/control/ha/automations ← automation status and history
GET  /api/control/ha/logbook   ← Home Assistant logbook stream
GET  /api/control/mqtt/status  ← MQTT broker connectivity
GET  /api/control/zigbee/status← Zigbee network status
GET  /api/control/zwave/status ← Z-Wave network status
GET  /api/control/matter/status← Matter bridge status
GET  /api/control/ble/status   ← BLE device status
GET  /api/control/homekit/status← HomeKit bridge status
GET  /api/control/network      ← network diagnostics
GET  /api/control/database     ← database health
GET  /api/control/warnings     ← system warnings
GET  /api/control/notifications← system notification feed
```

### `iora-assist` – ORA AI / IORA Assist (port 8092)

**ORA AI (IORA Assist)** is the AI platform for IORA, providing access to AI capabilities
through multiple providers: external AI services (OpenAI, Anthropic Claude), local AI
models (Ollama, LocalAI, LM Studio), or AI provided by the IORA Desktop client.

ORA AI functions as both a text-based AI assistant and a voice assistant, supporting:
- Speech-to-text (STT) for voice input
- Text-to-speech (TTS) for voice output
- Live audio AI processing
- Multi-provider architecture for flexibility

**Responsibilities:**
- Natural-language chat interface with contextual smart home awareness
- Automation suggestions based on entity history
- Home insights and anomaly detection
- Natural-language automation creation
- Voice interaction (speech-to-text and text-to-speech)
- Live audio streaming and processing
- Dynamic AI provider switching

**AI Provider Support:**

| Provider | Chat | STT | TTS | API Key Required | Notes |
|----------|------|-----|-----|------------------|-------|
| OpenAI | ✅ | ✅ (Whisper) | ✅ | Yes | GPT-4, GPT-3.5, Whisper, TTS-1 |
| Anthropic | ✅ | ❌ | ❌ | Yes | Claude 3.5 Sonnet, Claude 3 |
| LocalAI | ✅ | ✅ | ✅ | No | Ollama, LM Studio, LocalAI |
| DesktopAI | ✅ | ✅ | ✅ | No | Via IORA Desktop proxy |

**Key endpoints:**
```
GET  /health                              ← Service health + AI provider status
POST /api/assist/chat                     ← Chat with AI assistant
GET  /api/assist/history                  ← Chat history
POST /api/assist/history/clear            ← Clear chat history
GET  /api/assist/suggestions              ← Automation suggestions
POST /api/assist/automate                 ← Create automation from description
GET  /api/assist/insights                 ← Home insights and anomaly detection
GET  /api/assist/providers                ← List available AI providers
POST /api/assist/providers/switch         ← Switch active AI provider
POST /api/assist/voice/transcribe         ← Speech-to-text (multipart upload)
POST /api/assist/voice/synthesize         ← Text-to-speech (returns audio)
```

**Configuration:**

Configure ORA AI via environment variables:

```env
# Provider selection (openai, anthropic, local, desktop)
ORA_AI_PROVIDER=local

# Provider-specific settings
ORA_AI_API_KEY=sk-your-api-key-here      # For OpenAI/Anthropic
ORA_AI_BASE_URL=http://localhost:11434   # For Local/Desktop
ORA_AI_MODEL=llama3.2                    # Model name
ORA_AI_API_VERSION=2023-06-01            # For Anthropic

# Service port
PORT=8092
```

**Provider Examples:**

OpenAI:
```env
ORA_AI_PROVIDER=openai
ORA_AI_API_KEY=sk-proj-...
ORA_AI_MODEL=gpt-4o-mini
```

Anthropic Claude:
```env
ORA_AI_PROVIDER=anthropic
ORA_AI_API_KEY=sk-ant-...
ORA_AI_MODEL=claude-3-5-sonnet-20241022
```

Local AI (Ollama):
```env
ORA_AI_PROVIDER=local
ORA_AI_BASE_URL=http://localhost:11434
ORA_AI_MODEL=llama3.2
```

Desktop AI (via IORA Desktop):
```env
ORA_AI_PROVIDER=desktop
ORA_AI_BASE_URL=http://localhost:11435
```

**Voice Capabilities:**

ORA AI supports full voice interaction:

1. **Speech-to-Text (STT)**: Upload audio files (WebM, MP3, WAV, OGG) to `/api/assist/voice/transcribe`
   - Returns transcribed text and detected language
   - Supports multiple audio formats
   - Powered by Whisper (OpenAI, Local) or compatible STT engines

2. **Text-to-Speech (TTS)**: Send text to `/api/assist/voice/synthesize`
   - Returns audio file (MP3, WAV, or OGG)
   - Multiple voice options available (provider-dependent)
   - Configurable voice selection

3. **Live Audio Processing**: Real-time audio streaming for voice assistant mode
   - Stream audio chunks for continuous transcription
   - Immediate AI response generation
   - Voice feedback via TTS

**Architecture:**

ORA AI uses a trait-based provider abstraction layer:

```rust
trait AIProvider {
    fn name(&self) -> &str;
    async fn is_available(&self) -> bool;
    async fn chat(messages, system_prompt) -> ChatResponse;
    async fn transcribe_audio(audio_data, format) -> AudioTranscription;
    async fn synthesize_speech(text, voice) -> SpeechSynthesis;
}
```

Each provider implements this trait, allowing runtime switching between AI backends
without code changes.

**Integration with IORA Desktop:**

The Desktop AI provider connects to the IORA Desktop client, which:
- Runs LM Studio locally on the user's machine
- Proxies requests to local AI models
- Provides OpenAI-compatible API endpoint
- Enables fully offline AI operation

See `iora-desktop` documentation for proxy setup.

**Future Enhancements:**
- Streaming chat responses (SSE)
- Multimodal AI (image understanding)
- Voice activity detection (VAD)
- Conversation summarization
- Smart home context injection
- Automated entity discovery and control
- Personalized automation suggestions

### `iora-secrets` – Encrypted Secrets Storage (port 8093)

Centralized encrypted storage for sensitive data like API keys, passwords, and tokens.
Essential for AI-powered autonomous tasks that need to access external services securely.

**Responsibilities:**
- AES-256-GCM encryption of all stored secrets
- Access control per secret (which services can read)
- Comprehensive audit logging of all access
- Secret rotation and expiration management
- Master key derivation from environment variable

**Key endpoints:**
```
GET  /health
POST   /api/secrets              ← create encrypted secret
GET    /api/secrets              ← list secrets (metadata only)
GET    /api/secrets/:id          ← retrieve and decrypt secret
PUT    /api/secrets/:id          ← update secret
DELETE /api/secrets/:id          ← delete secret
POST   /api/secrets/:id/rotate   ← rotate secret value
GET    /api/secrets/:id/audit    ← view access audit log
```

**Security features:**
- Master key must be 32 bytes (64 hex chars) in `SECRETS_MASTER_KEY`
- Each secret encrypted with unique nonce
- No secrets in logs or error messages
- Audit trail for all operations
- PostgreSQL database: `iora_secrets`

### `iora-watchdog` – Health Monitoring & Failover (port 8094)

High-availability monitoring service that tracks all IORA programs and provides
failover event routing when `iora-core` is unavailable. Designed for maximum
stability with minimal complexity.

**Responsibilities:**
- Health check polling every 10 seconds for all registered services
- Detect service failures and recovery
- Backup event bus when `iora-core` is down
- System metrics collection (CPU, memory)
- Broadcast notifications on service state changes
- Circuit breaker to prevent cascade failures

**Key endpoints:**
```
GET  /health
GET  /api/watchdog/status        ← status of all monitored services
GET  /api/watchdog/services      ← list registered services
POST /api/watchdog/services      ← register a service for monitoring
POST /api/watchdog/heartbeat     ← receive heartbeat from service
GET  /api/watchdog/metrics       ← system resource metrics
GET  /api/watchdog/events        ← SSE event stream (backup for core)
POST /api/watchdog/events        ← broadcast event (backup for core)
```

**Monitored metrics:**
- Service health status (healthy, degraded, unhealthy, unreachable)
- Response time of health checks
- Consecutive failure count
- System CPU and memory usage

**Failover behavior:**
- Normal: `iora-core` handles events, watchdog monitors passively
- Core down: Watchdog detects failure, takes over event broadcasting
- Core recovered: Watchdog returns event bus control to core

### `iora-installer` – Installation & Update Manager (CLI)

Command-line tool for automated installation, updates, and management of IORA
on Debian servers. Handles dependencies, database setup, systemd integration,
and zero-downtime updates.

**Commands:**
```bash
iora-installer install              # Fresh installation
iora-installer update               # Update to latest version
iora-installer update --version X   # Update to specific version
iora-installer rollback             # Rollback to previous version
iora-installer config               # Interactive configuration
iora-installer status               # Show service status
iora-installer backup               # Create system backup
iora-installer restore <file>       # Restore from backup
iora-installer migrate              # Run database migrations
iora-installer validate             # Validate installation
```

**Installation process:**
1. Pre-flight checks (Debian version, permissions, disk space)
2. Install dependencies (PostgreSQL, build tools, SSL)
3. Create `iora` system user
4. Install IORA binaries to `/opt/iora/bin/`
5. Create PostgreSQL databases
6. Generate configuration files in `/etc/iora/`
7. Create systemd service units
8. Start and enable all services
9. Validate health of all services

**Files created:**
- `/opt/iora/bin/` – IORA binaries
- `/etc/iora/*.env` – Configuration files per service
- `/etc/systemd/system/iora-*.service` – Systemd units
- `/var/lib/iora/` – Runtime data (optional)

### `iora-security` – Security Monitoring & PostgreSQL Management (port 8095)

**THE MOST CRITICAL COMPONENT** - Comprehensive security system with encrypted audit logging,
PostgreSQL connection monitoring, automatic database user management with credential rotation,
intrusion detection, and automatic system lockdown capabilities.

**Responsibilities:**
- Real-time PostgreSQL connection monitoring (every 5 seconds)
- Automatic PostgreSQL user creation and 30-day credential rotation
- Encrypted, tamper-proof security audit logs (SQLite with AES-256-GCM)
- Hash-chained event logging (blockchain-style integrity verification)
- Intrusion detection system with threat intelligence
- Automatic system lockdown (4 severity levels)
- IP whitelist/blacklist management
- Frontend security alerts and notifications

**Key endpoints:**
```
GET  /health
GET  /api/security/status              ← System lockdown status
GET  /api/security/connections         ← Active PostgreSQL connections
GET  /api/security/events              ← Security event log (encrypted)
GET  /api/security/threats             ← Threat intelligence feed
GET  /api/security/alerts              ← Pending security alerts
POST /api/security/whitelist           ← Add IP to whitelist
POST /api/security/block/:ip           ← Block threatening IP
POST /api/security/lockdown            ← Manual lockdown trigger
POST /api/security/release             ← Release system lockdown
POST /api/security/users               ← Create PostgreSQL user
```

**Encrypted SQLite Database:**
- Location: `/var/lib/iora/security.db`
- Encryption: AES-256-GCM with master key from `SECURITY_DB_KEY`
- **COMPLETELY UNREADABLE** if database file is copied without the key
- Hash-chained events prevent tampering
- Append-only for forensic integrity

**PostgreSQL Management:**
- Full control over PostgreSQL server via admin connection
- Automatic user creation per service: `iora_servicename_<uuid>`
- Secure password generation (32-byte random hex)
- Automatic 30-day credential rotation
- Granular permission management (read, write, full)
- All credentials encrypted and stored in security database

**Connection Monitoring:**
- Queries `pg_stat_activity` every 5 seconds
- Tracks: PID, IP, username, database, application name
- Detects unauthorized connections immediately
- Auto-increments threat level for unknown IPs
- Logs all connections to encrypted audit trail

**Intrusion Detection System (IDS):**
- Threat scoring: 0-10 scale per IP address
- Automatic IP blocking at threat level ≥ 7
- Detection triggers:
  - Unauthorized database connections (+3 threat)
  - Failed authentication attempts (+2 threat)
  - SQL injection patterns (+5 threat)
  - Rate limiting violations (+1 threat)
  - Abnormal access patterns (+2 threat)

**Auto-Lockdown Levels:**
1. **Level 1 (Warning):** Enhanced monitoring, frontend notification
2. **Level 2 (Suspicious):** Elevated logging, IP tracking active
3. **Level 3 (Confirmed):** Partial service lockdown, external API blocked
4. **Level 4 (Critical):** Full system isolation, admin-only access

**When lockdown triggers:**
- All external API access blocked
- Only admin console accessible
- PostgreSQL connections frozen (except admin)
- Forensic snapshot created
- Critical alerts sent to all administrators
- All events logged to encrypted database

**Security Event Types:**
- `connection`: Database connection events
- `auth`: Authentication attempts
- `intrusion`: Detected attack attempts
- `anomaly`: Unusual behavior patterns
- `lockdown`: System lockdown events
- `user_rotation`: Credential rotation events
- `unauthorized_connection`: Unknown DB connections

**Environment Configuration:**
```env
SECURITY_DB_PATH=/var/lib/iora/security.db
SECURITY_DB_KEY=<64-hex-char-key>     # From iora-secrets
# Uses DATABASE_URL for PostgreSQL (same as iora-home). Optional override:
# POSTGRES_ADMIN_URL=postgres://postgres:<admin-pass>@localhost:5432/postgres
IORA_ENV=production                   # Or 'development' (default)
AUTO_LOCKDOWN_ENABLED=true
LOCKDOWN_THRESHOLD_CRITICAL=5
THREAT_LEVEL_THRESHOLD=7
WHITELIST_IPS=127.0.0.1,::1,10.0.0.0/8
PORT=8095
```

**Integration:**
- Works with `iora-secrets` for key management
- Monitored by `iora-watchdog` for health
- Sends alerts to `iora-home` frontend
- Controls access for all services
- Coordinates with `iora-core` during lockdown

**Database Schema Highlights:**
- `security_events`: Hash-chained immutable event log
- `database_connections`: All PostgreSQL connection tracking
- `threat_intelligence`: IP reputation and blocking
- `system_lockdowns`: Lockdown event history
- `postgres_users`: Managed database user credentials
- `ip_whitelist`: Authorized IP addresses
- `pending_alerts`: Unacknowledged security alerts
- `activity_baselines`: ML-ready anomaly detection data

**Security Best Practices:**
- Never store plaintext passwords
- All sensitive data encrypted before storage
- Hash chains prevent log tampering
- Separate encrypted database for security events
- Defense in depth with multiple detection layers
- Fail-secure: locks down on suspicious activity
- Comprehensive audit trail for forensics

### `iora-gateway` – Sandboxed External Integration Gateway (port 8096)

**Secure gateway for external integrations** - Provides sandboxed access to email sending, web search,
and HTTP data retrieval with comprehensive content validation, malware detection, and AI request monitoring.

**Responsibilities:**
- Email sending with content validation and sanitization
- Web search integration (placeholder for external APIs)
- HTTP GET requests with response validation
- Update integrity verification (SHA256 checksums)
- Code execution detection and prevention
- AI request logging and monitoring
- Rate limiting per service
- Sandboxed execution with timeout protection

**Key endpoints:**
```
GET  /health
POST /api/gateway/email                ← Send email with validation
POST /api/gateway/search               ← Web search (external API)
POST /api/gateway/http/get             ← HTTP GET with sanitization
POST /api/gateway/verify-update        ← Update checksum verification
GET  /api/gateway/requests             ← Request log
GET  /api/gateway/ai-requests          ← AI request monitoring
```

**Content Validation System:**
- **JavaScript Detection:** Detects `<script>` tags, `javascript:` URLs, event handlers, `eval()`, `setTimeout()`, `setInterval()`
- **SQL Injection Detection:** UNION/SELECT patterns, comment markers (--), equality checks
- **Shell Command Detection:** Command separators (`;`, `&`, `|`), command substitution (`$(...)`, backticks), variable expansion
- **Path Traversal Detection:** `../` and `..\` patterns
- **Threat Scoring:** 0-10 scale based on findings
- **HTML Sanitization:** Uses ammonia for safe HTML cleaning

**Sandbox Execution:**
- Process isolation wrapper for all external operations
- Configurable timeout protection (default: 30 seconds)
- All sandbox executions logged with PID, duration, exit code
- Timeout detection and cleanup

**Email Capabilities:**
- SMTP integration via lettre (tokio1-rustls-tls)
- Content validation before sending
- HTML sanitization of email bodies
- Configurable SMTP server, username, password
- All emails logged with request ID

**Web Search:**
- Placeholder for external search API integration
- Designed for DuckDuckGo, Google Custom Search, or SearX
- Query logging and validation
- Result content validation

**HTTP GET Features:**
- Custom headers support
- Response content validation
- HTML sanitization before returning
- URL whitelist support
- Timeout protection

**Update Integrity Verification:**
- SHA256 checksum verification
- Package download and hash calculation
- Supports custom checksum types
- All verifications logged
- Prevents supply chain attacks

**Rate Limiting:**
- Per-service rate limiting
- Default: 100 requests/hour, 1000 requests/day
- Configurable via environment variables
- Tracked in SQLite database

**AI Request Monitoring:**
- Dedicated logging for all AI-initiated requests
- Tracks service name, request type, destination
- Threat level tracking
- Used for AI behavior analysis

**SQLite Database:**
- Location: Configured via `GATEWAY_DB_PATH`
- Tables:
  - `gateway_requests`: All external request tracking
  - `content_validations`: Security validation results
  - `sandbox_executions`: Sandboxed process tracking
  - `blocked_content`: Blocked malicious content log
  - `ai_request_log`: AI tool usage monitoring
  - `url_whitelist`: Allowed domains/URLs
  - `update_verifications`: Package update integrity checks
  - `rate_limits`: Service-level rate limiting

**Environment Configuration:**
```env
GATEWAY_DB_PATH=/var/lib/iora/gateway.db
SMTP_SERVER=smtp.example.com:587
SMTP_USERNAME=noreply@example.com
SMTP_PASSWORD=<secure-password>
ENABLE_SANDBOXING=true
ALLOWED_DOMAINS=example.com,api.trusted.com
REQUEST_TIMEOUT_SECS=30
MAX_REQUEST_SIZE=1048576              # 1MB default
PORT=8096
```

**Security Features:**
- All external content validated for malicious patterns
- Responses sanitized before returning to caller
- Sandbox execution with process isolation
- Rate limiting prevents abuse
- Threat level scoring (0-10)
- Auto-blocking of unsafe content
- Update integrity verification with SHA256
- AI request monitoring and analysis

**Integration:**
- Available to `iora-assist` for AI tool usage
- Monitored by `iora-watchdog` for health
- Uses `iora-security` for threat intelligence
- Logs critical events to security system

### `iora-supervisor` – Docker Orchestration (port 8097)

**THE CONTAINER MANAGER** - Controls the entire IORA Docker ecosystem. Manages all service containers, handles updates, restarts, and provides a unified API for container operations.

**Responsibilities:**
- Docker container orchestration and lifecycle management
- Container health monitoring and automatic restarts
- Over-the-air (OTA) updates for all services
- Container logs aggregation and access
- Service start/stop/restart operations
- Image pull and update management
- Integration with RAUC for system-wide updates
- Container resource monitoring

**Key endpoints:**
```
GET  /health
GET  /api/supervisor/status              ← Supervisor and system status
GET  /api/supervisor/containers          ← List all IORA containers
POST /api/supervisor/containers/{name}/start   ← Start container
POST /api/supervisor/containers/{name}/stop    ← Stop container
POST /api/supervisor/containers/{name}/restart ← Restart container
POST /api/supervisor/services/update    ← Pull new image and update service
GET  /api/supervisor/containers/{name}/logs    ← Get container logs
```

**Container Management:**
- Lists all containers with `iora.managed=true` label
- Monitors container state (running, stopped, unhealthy)
- Provides start/stop/restart operations
- Aggregates logs from all services
- Tracks container uptime and resource usage

**Update System:**
- Pulls new Docker images from registry
- Recreates containers with new images
- Coordinates with RAUC for OS-level updates
- Automatic rollback on update failure
- Zero-downtime updates with health checks

**Docker Socket Access:**
- Runs with privileged access to Docker socket
- Required for container management operations
- Protected by AppArmor profile
- Only accessible from within IORA network

**Environment Configuration:**
```env
PORT=8097
RUST_LOG=info
```

**Integration:**
- Managed by RAUC for system updates
- Monitored by `iora-watchdog` for health
- Controls all other IORA service containers
- Critical service - must always be running
- Coordinates with `iora-core` for service registry

**Docker Compose Configuration:**
```yaml
iora-supervisor:
  container_name: iora-supervisor
  ports: ["8097:8097"]
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  privileged: true
  labels:
    iora.managed: "true"
    iora.service: "supervisor"
    iora.critical: "true"
```

**Security Considerations:**
- Requires Docker socket access (high privilege)
- Protected by AppArmor mandatory access control
- Only allows container operations on IORA services
- No arbitrary container creation allowed
- Logs all operations for audit trail
- Rate limiting on update operations

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

## Person Tracking & Presence Automation

`iora-home` runs a `PersonTracker` background service that provides long-term analytics
and autonomous device control based on person movements.

### How it works

```
Home Assistant (person.* entities)
  │  polled every 30 s via REST API
  ▼
PersonTracker (iora-home background task)
  │  detects location changes
  ├──► person_location_history (PostgreSQL)
  │       → who, where, when, how long
  ├──► person_daily_summary (aggregated per day)
  │       → time at home, most visited locations, departure/return times
  └──► AutomationEngine
           → evaluates automation_rules
           → calls HA services (e.g. turn_on lights)
```

### Location States

Person entities in HA report a `state` that can be:
- `home` – at home
- `not_home` – away, location unknown
- A named zone (e.g. `work`, `gym`, `school`)

### Automation Rule Types

| Rule type | Trigger | Example action |
|-----------|---------|----------------|
| `arrival_light` | Person arrives home (within 2 min) | Turn on lights in their room |
| `departure_light` | Person leaves home (within 2 min) | Turn off all their lights |
| `presence_light` | Custom presence condition | Dim lights when person is in living room after 22:00 |

### Creating an Automation Rule (API)

```json
POST /api/automation-rules
{
  "name": "Alice arrives home – turn on bedroom light",
  "rule_type": "arrival_light",
  "trigger_config": {
    "person_entity_id": "person.alice"
  },
  "action_config": {
    "entity_id": "light.alice_bedroom",
    "service": "light/turn_on",
    "data": { "brightness": 200, "color_temp": 4000 }
  },
  "cooldown_seconds": 300
}
```

### Person Analytics API

```
GET /api/persons                           ← list all tracked persons
GET /api/persons/:entity_id/history        ← location history (paginated)
GET /api/persons/:entity_id/daily-summary  ← daily summaries
GET /api/persons/:entity_id/weekly-report  ← weekly stats
GET /api/automation-rules                  ← list automation rules
POST /api/automation-rules                 ← create rule
PUT /api/automation-rules/:id              ← update rule
DELETE /api/automation-rules/:id           ← delete rule
GET /api/automation-rules/:id/executions   ← execution history
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
| iora-secrets | 8093 | HTTP |
| iora-watchdog | 8094 | HTTP, SSE |
| iora-security | 8095 | HTTP |
| iora-gateway | 8096 | HTTP |
| iora-supervisor | 8097 | HTTP |
| iora-installer | N/A | CLI only |

Ports can be overridden with the `PORT` environment variable in each service.

---

## Deployment

### Docker Compose (recommended for production)

IORA is designed to run as a fully containerized system. All services are Docker containers managed by `iora-supervisor`.

```bash
# Clone repository
git clone https://github.com/your-org/iora.git
cd iora

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start entire IORA stack
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f

# Access IORA
# - Home: http://localhost:8080
# - Control: http://localhost:8091
# - Supervisor: http://localhost:8097
```

The full docker-compose.yml includes:
- PostgreSQL database with automatic initialization
- All 9 IORA services as containers
- iora-supervisor for Docker orchestration
- AppArmor security profiles
- Health checks and auto-restart
- Persistent volumes for data

### IORA OS (production hardware deployment)

**IORA OS** is a custom operating system based on Buildroot, similar to Home Assistant OS. It provides a complete, secure, and optimized environment for running IORA.

#### Key Features:
- **Buildroot LTS Linux** - Minimal, secure kernel
- **SquashFS root filesystem** - Read-only, compressed (LZ4)
- **ZRAM** - Compressed RAM for /tmp, /var, swap
- **Docker Engine** - All IORA services run in containers
- **RAUC updates** - A/B partitions with atomic updates and rollback
- **AppArmor** - Mandatory Access Control for all services
- **GRUB/U-Boot** - Support for x86_64 and ARM devices

#### Supported Hardware:
- x86_64 with UEFI (Intel/AMD servers, NUCs)
- Raspberry Pi 4 (4GB+ recommended)
- Rock Pi 4, Odroid N2+
- Generic ARM64 boards

#### Quick Start:
```bash
# Download pre-built image
wget https://github.com/your-org/iora/releases/latest/iora-os.img.xz

# Flash to device (replace /dev/sdX with your device)
xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress

# Boot device
# Default credentials: root / iora (change immediately!)
# Web interface: http://[device-ip]:8080
```

See [iora-os/README.md](iora-os/README.md) for building from source.

### Development (run services directly)

For development without Docker:

```bash
cd backend
cargo run -p iora-core     &   # start orchestrator first
cargo run -p iora-security &   # security monitoring (requires PostgreSQL admin access)
cargo run -p iora-watchdog &   # health monitoring
cargo run -p iora-secrets  &   # encrypted secrets storage
cargo run -p iora-gateway  &   # sandboxed external integrations
cargo run -p iora-home     &   # smart home service
cargo run -p iora-control  &   # admin panel backend
cargo run -p iora-assist   &   # AI assistant (optional)
```

### Build individual programs

```bash
cd backend
cargo build --release -p iora-home
cargo build --release -p iora-core
cargo build --release -p iora-control
cargo build --release -p iora-assist
cargo build --release -p iora-secrets
cargo build --release -p iora-watchdog
cargo build --release -p iora-security
cargo build --release -p iora-gateway
cargo build --release -p iora-installer
```

### Production Installation (Debian)

Use the `iora-installer` tool for automated installation:

```bash
# Download installer
wget https://github.com/your-org/iora/releases/latest/download/iora-installer
chmod +x iora-installer

# Run installation
sudo ./iora-installer install

# Check status
./iora-installer status
```

---

## Performance

| Technique | Where |
|-----------|-------|
| In-memory entity state cache | iora-home |
| ServiceCallBuffer (coalesces slider drags) | iora-home |
| PostgreSQL connection pooling (sqlx) | iora-home, iora-core |
| JSONB columns for flexible attributes | person_location_history |
| Partial index on open location records | person_location_history |
| Broadcast channel for SSE / WS | iora-home, iora-core |
| Separate poll/cmd HTTP clients | iora-home HA client |
| Native OS APIs via Tauri (no Electron overhead) | iora-desktop |

---

## IORA Desktop

IORA Desktop is a **Tauri v2** application that runs silently in the system tray and acts
as a bridge between IORA and a locally running **LM Studio** instance.

### Why a desktop client?

- **Local AI processing** — LM Studio runs AI models fully on-device. IORA Desktop proxies
  requests from `iora-assist` to LM Studio, keeping all data local.
- **Background service** — the app runs invisibly after login; no terminal required.
- **Remote IORA Home shell** — the desktop window can embed the remote IORA Home UI with native window chrome and quick actions.
- **System integration** — desktop settings now expose brightness, always-on-top, kiosk mode, screensaver, notifications and proxy controls.
- **Admin sidebar** — the built-in Admin Panel now uses a side navigation layout for faster access to system, HA, network, logs and realtime tools.
- **Settings persistence** — desktop configuration is stored centrally and loaded on app startup.

### Directory structure

```
desktop/
├── package.json            # npm – Vite + React + @tauri-apps/api
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx             # Root component (settings window)
│   ├── index.css
│   ├── components/
│   │   ├── ConnectionStatus.tsx    # green/red indicator
│   │   ├── ModelSelector.tsx       # model dropdown + refresh
│   │   └── SettingsForm.tsx        # LM Studio + IORA settings
│   ├── hooks/
│   │   └── useLmStudio.ts          # config, models, connection state
│   └── lib/
│       └── tauri.ts                # typed invoke() wrappers
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json     # window, tray, bundle config
    ├── build.rs
    ├── icons/icon.png
    └── src/
        ├── main.rs         # tray setup, window management
        ├── lib.rs
        ├── commands.rs     # #[tauri::command] handlers
        ├── lm_studio.rs    # OpenAI-compatible HTTP client
        └── config.rs       # persist settings to OS app-data dir
```

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `lm_studio_url` | `http://localhost:1234` | LM Studio base URL |
| `lm_studio_api_key` | *(empty)* | API key (optional for local instances) |
| `selected_model` | *(empty)* | Model identifier selected from LM Studio |
| `iora_backend_url` | `http://localhost:8092` | iora-assist URL |
| `auto_start_proxy` | `true` | Start proxy on desktop app startup |
| `proxy_port` | `11435` | Local port for the IORA→LM Studio proxy |

Settings are persisted as JSON in the OS app-config directory:
- **Linux**: `~/.config/iora-desktop/config.json`
- **macOS**: `~/Library/Application Support/iora-desktop/config.json`
- **Windows**: `%APPDATA%\iora-desktop\config.json`

### Building

```bash
cd desktop
npm install
npm run tauri build
```

Or for development (live-reload):
```bash
cd desktop
npm install
npm run tauri dev
```

---

## Database

Both `iora-home` and `iora-core` use **PostgreSQL**. SQLite is no longer used.

### iora-home database (`iora_home`)

| Migration | Tables created/altered |
|-----------|------------------------|
| 001 | users, devices, user_devices, configuration_profiles, pages, widgets, theme_settings, background_configs, background_triggers, user_preferences, sync_metadata |
| 002 | `users.password_hash` |
| 003 | entity_history |
| 004 | system_preferences |
| 005 | weather_forecast_cache |
| 006 | `pages.show_in_nav`, `display_mode`, `parent_page_id` |
| 007 | `pages.modal_settings` |
| 008 | `users.pin_hash`, `avatar_url`, `role`; `devices.is_terminal`, `terminal_name`, `assigned_profile_id`; page_layouts |
| 009 | page_settings |
| 010 | `users.is_admin`; api_keys, api_key_rate_limits |
| 011 | warning_log |
| 012 | notifications |
| 013 | nina_warning_cache |
| 014 | webhooks, webhook_deliveries |
| **015** | **person_location_history**, **person_daily_summary** |
| **016** | **automation_rules**, **automation_executions** |

### iora-core database (`iora_core`)

| Migration | Tables |
|-----------|--------|
| 001 | background_tasks, analytics_snapshots, system_events_log |

### Docker Compose (quick-start with PostgreSQL)

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: iora
      POSTGRES_PASSWORD: iora_password
      POSTGRES_DB: iora_home
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  iora-home:
    build: { context: ./backend, target: iora-home }
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgres://iora:iora_password@postgres:5432/iora_home
      HA_URL: http://homeassistant.local:8123
      HA_TOKEN: ${HA_TOKEN}
    depends_on: [postgres]

  iora-core:
    build: { context: ./backend, target: iora-core }
    ports: ["8090:8090"]
    environment:
      DATABASE_URL: postgres://iora:iora_password@postgres:5432/iora_core
    depends_on: [postgres]

volumes:
  pgdata:
```

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
