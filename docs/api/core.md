# Core API

The Core API is served by `rumahl-home` (port 8126) and `rumahl-core` (port 8090). It provides access to entities, users, pages, plugins, and the service registry.

## rumahl-home Endpoints (Port 8126 / 3001)

### Health Check

```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "version": "2.3.0",
  "uptime_seconds": 3600
}
```

### Authentication

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secure-password"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "uuid", "username": "admin", "is_admin": true }
}
```

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "newuser",
  "password": "secure-password",
  "email": "user@example.com"
}
```

```http
POST /api/auth/pin
Content-Type: application/json

{
  "pin": "1234",
  "device_id": "terminal-kitchen"
}
```

```http
GET /api/auth/me
Authorization: Bearer <token>
```

### Entity States

```http
GET /api/states
Authorization: Bearer <token>

# Filter by domain
GET /api/states?domain=light

# Get single entity
GET /api/states/light.living_room
```

Response:
```json
{
  "entity_id": "light.living_room",
  "state": "on",
  "attributes": {
    "brightness": 255,
    "color_temp": 4000,
    "friendly_name": "Living Room Light"
  },
  "last_changed": "2026-06-01T12:00:00Z",
  "last_updated": "2026-06-01T12:00:00Z"
}
```

### Service Calls

```http
POST /api/services/{domain}/{service}
Authorization: Bearer <token>
Content-Type: application/json

{
  "entity_id": "light.living_room",
  "brightness": 200,
  "color_temp": 3500
}
```

Common services:
- `light/turn_on`, `light/turn_off`, `light/toggle`
- `switch/turn_on`, `switch/turn_off`, `switch/toggle`
- `climate/set_temperature`, `climate/set_hvac_mode`
- `cover/open_cover`, `cover/close_cover`, `cover/stop_cover`
- `media_player/media_play`, `media_player/media_pause`

### Real-Time Streams

```http
# WebSocket
ws://localhost:8126/ws?token=<jwt>

# Server-Sent Events
GET /api/events/stream
Authorization: Bearer <token>
```

### Users & Profiles

```http
# List users (admin only)
GET /api/users
Authorization: Bearer <token>

# Get user profile
GET /api/users/{user_id}

# Update user
PUT /api/users/{user_id}
Content-Type: application/json

{
  "username": "newname",
  "avatar_url": "https://example.com/avatar.png"
}

# Delete user (admin only)
DELETE /api/users/{user_id}
```

### Pages & Widgets

```http
# List dashboard pages
GET /api/pages
Authorization: Bearer <token>

# Create page
POST /api/pages
Content-Type: application/json

{
  "title": "Living Room",
  "icon": "home",
  "show_in_nav": true,
  "order": 10
}

# Get page with widgets
GET /api/pages/{page_id}

# Update page
PUT /api/pages/{page_id}

# Delete page
DELETE /api/pages/{page_id}

# Add widget to page
POST /api/pages/{page_id}/widgets
Content-Type: application/json

{
  "type": "entity_card",
  "config": {
    "entity_id": "light.living_room",
    "show_name": true,
    "show_state": true
  },
  "position": { "x": 0, "y": 0, "width": 2, "height": 2 }
}

# Update widget
PUT /api/pages/{page_id}/widgets/{widget_id}

# Delete widget
DELETE /api/pages/{page_id}/widgets/{widget_id}
```

### Theme Settings

```http
# Get theme configuration
GET /api/theme

# Update theme
PUT /api/theme
Content-Type: application/json

{
  "mode": "dark",
  "primary_color": "#3B82F6",
  "glass_effect": true,
  "border_radius": 16
}
```

### Person Tracking

```http
# List tracked persons
GET /api/persons

# Person location history
GET /api/persons/{entity_id}/history?limit=100

# Daily summary
GET /api/persons/{entity_id}/daily-summary?date=2026-06-01

# Weekly report
GET /api/persons/{entity_id}/weekly-report

# Automation rules
GET /api/automation-rules
POST /api/automation-rules
PUT /api/automation-rules/{id}
DELETE /api/automation-rules/{id}
GET /api/automation-rules/{id}/executions
```

### File Uploads

```http
POST /api/files/upload
Content-Type: multipart/form-data

file: <binary>
```

### Personal System Folders (Downloads per user)

```http
# Personal system folder (Downloads, Documents, Photos, Videos) — found or
# created per user; legacy localized names (e.g. "Dokumente") are reused.
GET /api/files/system-folder?name=Downloads
→ { "folder": { "id": "…", "name": "Downloads", "created": false } }
```

### Notification System

```http
# Get notifications
GET /api/notifications

# Mark as read
POST /api/notifications/{id}/read

# Send notification
POST /api/notifications
Content-Type: application/json

{
  "title": "Alert",
  "message": "Front door opened",
  "priority": "high"
}
```

### System Warnings

```http
GET /api/warnings
```

### Webhooks

```http
# List webhooks
GET /api/webhooks

# Create webhook
POST /api/webhooks
Content-Type: application/json

{
  "name": "GitHub Push",
  "url": "https://example.com/hook",
  "events": ["push"]
}

# Delete webhook
DELETE /api/webhooks/{id}

# Delivery history
GET /api/webhooks/{id}/deliveries
```

### System Jobs (Job Center)

Background jobs (downloads, file operations, backups, updates, installs)
run system-wide and survive app switches. Backed by the `system_jobs` table
(migration 039); the UI lives in the Job Center (shell icon with active-job
badge) and the SDK exposes `ora.jobs`.

```http
# List jobs (optional ?status=running|queued|paused|completed|failed|cancelled)
GET /api/jobs

# Job details
GET /api/jobs/{id}

# Create a job (starts in "queued")
POST /api/jobs
Content-Type: application/json

{
  "name": "Download ubuntu.iso",
  "job_type": "download",
  "source": "my-app",
  "metadata": { "url": "https://releases.ubuntu.com/24.04/ubuntu.iso" }
}

# Advance progress / message / status (called by the executing side)
POST /api/jobs/{id}/progress
Content-Type: application/json

{ "progress": 78, "message": "Writing to disk…", "status": "running" }

# Lifecycle
POST /api/jobs/{id}/pause
POST /api/jobs/{id}/resume
POST /api/jobs/{id}/cancel

# Remove one job / bulk-clean terminal jobs
DELETE /api/jobs/{id}
DELETE /api/jobs
```

Status lifecycle: `queued → running → paused/completed/failed/cancelled`.
Terminal states (`completed`, `failed`, `cancelled`) are final; pause/resume
validate transitions (409 on invalid moves). Progress is an integer 0–100.

### Clipboard (history across devices)

Personal clipboard history per user, shared across devices through the same
API. The frontend captures copy/cut events automatically (passwords and
payloads > 64 KiB are skipped); the Clipboard panel opens with
Ctrl+Shift+V. Backed by the `clipboard_entries` table (migration 040); the
SDK exposes `ora.clipboard`.

```http
# List history (newest first, pinned on top)
GET /api/clipboard?limit=50

# Add an entry (deduplicates: same content moves to top)
POST /api/clipboard
Content-Type: application/json

{ "content": "text to remember", "content_type": "text", "source": "web" }

# Toggle pin
POST /api/clipboard/{id}/pin

# Remove one entry / clear history
DELETE /api/clipboard/{id}
DELETE /api/clipboard
```

### Session Restore (persisted OS windows)

Persists open OS windows (page, layout, geometry, z-order, minimized) per
user so the desktop comes back after login or reload. The frontend saves the
window set (debounced + flushed on pagehide); localStorage is the offline
fallback. Backed by the `session_windows` table (migration 041); layouts
include `window`, `maximized`, half/quarter snap variants and
`split-left`/`split-right`.

```http
# Load the user's persisted windows
GET /api/session/windows

# Replace the user's persisted windows (max 16)
PUT /api/session/windows
Content-Type: application/json

{
  "windows": [
    { "page_id": "os-files", "layout": "left", "x": 8, "y": 8,
      "width": 640, "height": 1000, "z": 11, "minimized": false }
  ]
}

# Clear the persisted session
DELETE /api/session/windows
```

### Runtime Permission Requests (Allow/Deny dialogs)

Android/iOS-style permission prompts. Components (apps, plugins, system
surfaces) request an OS permission the user has not granted yet; the shell
polls pending requests and shows one dialog at a time. Approving writes the
grant into `user_os_permissions` so `effective_os_permissions` sees it
immediately. Backed by the `permission_requests` table (migration 042); the
SDK exposes `ora.permissions`.

```http
# Catalog of all OS permissions with descriptions (UI translates labels)
GET /api/os/permissions/catalog

# Request a permission (409 if already granted; idempotent per permission)
POST /api/os/permissions/request
Content-Type: application/json

{
  "permission": "os.power",
  "requester": "Energy Optimizer",
  "scope": "energy-optimizer-plugin",
  "reason": "Schedule a nightly shutdown"
}

# List the user's requests (?status=pending|approved|denied)
GET /api/os/permissions/requests

# Answer a request — allow persists the grant (only the owner, pending only)
POST /api/os/permissions/requests/{id}/respond
Content-Type: application/json

{ "approved": true }
```

### User Profiles (family / child profiles)

Child profiles restrict which apps appear in the shell (dock, launcher,
command palette) via an `allowed_app_ids` whitelist. Fields live on the
`users` row (migration 043) and are attached to `/api/auth/verify` responses
as `profile_type` + `restrictions`, so the shell enforces them without extra
round trips. The UI lives in Settings → System → Family profiles.

```http
# All users with profile fields (admin only)
GET /api/admin/users

# Update a user's profile (admin only)
PUT /api/admin/users/{id}/profile
Content-Type: application/json

{
  "profile_type": "child",
  "restrictions": { "allowed_app_ids": ["rumahl-files", "os-images"] }
}
```

`profile_type`: `standard` | `child`. Empty/missing `allowed_app_ids` means
no app restrictions. Launcher, Home and Settings are always reachable.

### Guest Mode (password-free temporary access)

Opt-in (admin toggle: Settings → System → Family profiles → Guest mode,
backed by the `security.guest_mode_enabled` system setting, default off).
A guest is a real user row (`guest`, role `viewer`, no credentials) so all
per-user subsystems work unchanged; guests are filtered out of user lists.

```http
# Is the guest button shown on the login page?
GET /api/auth/guest-status

# Start/continue a guest session (403 when disabled)
POST /api/auth/guest
```

### Family Shares (shared files)

Files (and root folders) can be shared with the whole family: every
authenticated non-guest family member gets read access. Family-shared
entries appear in the root listing of other users, and family-shared folders
can be browsed. Backed by `file_permissions` with `grantee_type='family'`.

```http
# Share a file/folder with the family (read-only)
POST /api/files/permissions
Content-Type: application/json

{ "file_id": "...", "grantee_id": "family", "grantee_type": "family", "permission": "read" }

# Permission list of a file (find the family grant's id to revoke)
GET /api/files/permissions/{file_id}

# Revoke a permission
DELETE /api/files/permissions/revoke/{perm_id}
```

### Devices (registry + Wake-on-LAN)

Curated devices (gaming PC, NAS, TV, printer, …) with a MAC address for
Wake-on-LAN. Auto-discovered network devices remain in `GET /api/network/devices`;
this registry adds the human layer (friendly name, type, WOL capability).
Backed by the `device_registry` table (migration 044); the UI lives in the
Devices app (`/devices`, requires `os.network.write`).

```http
# List / create curated devices
GET  /api/devices
POST /api/devices
Content-Type: application/json

{
  "name": "Gaming PC",
  "device_type": "computer",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "ip_address": "192.168.1.10",
  "wake_enabled": true,
  "notes": "RTX 5080 rig"
}

# Update / remove
PUT    /api/devices/{id}
DELETE /api/devices/{id}

# Wake-on-LAN: sends a magic packet (UDP broadcast 255.255.255.255:9)
POST /api/devices/{id}/wake

# Reachability probe (tcp: host+port connect, http: GET url — migration 045)
POST /api/devices/{id}/probe
→ { "reachable": true, "latency_ms": 12, "detail": "tcp 192.168.1.10:22 reachable" }
```

`device_type`: `computer` | `nas` | `tv` | `printer` | `phone` | `tablet` | `other`.
MAC validation (`AA:BB:CC:DD:EE:FF` or dashed) happens server-side; wake
returns 400 when the device has no MAC or WOL is disabled.

### Universal Download Manager

Downloads run in the backend as system jobs (`job_type: download`) and are
saved into the user's personal Downloads folder — they survive tab closes
and app switches. The Job Center shows progress/cancel automatically;
the SDK exposes `ora.downloads`.

```http
# Start a download (SSRF-guarded: http/https, no loopback hosts)
POST /api/downloads
Content-Type: application/json

{ "url": "https://releases.ubuntu.com/24.04/ubuntu.iso", "filename": "ubuntu.iso" }
→ 202 { "job_id": "…", "status": "queued" }

# The user's download jobs (newest first)
GET /api/downloads

# Cancel a queued/running download
POST /api/downloads/{job_id}/cancel
```

Downloads stream server-side into a temp buffer and upload into the personal
Downloads folder (multipart) using the caller's token; cancelling skips the
final upload. Private LAN hosts are allowed (a home OS downloads from its
NAS); loopback/link-local/multicast are blocked.

### Media Hub (Jellyfin/Plex detection + continue-watching)

```http
# Detect local media servers (Jellyfin 8096, Plex 32400 or configured URLs)
GET /api/media/hub
→ { "jellyfin": { "reachable": true, "name": "…", "configured": false }, "plex": … }

# Jellyfin resume items (requires API key + user id in the config)
GET /api/media/continue-watching
→ { "configured": true, "items": [ { "id": "…", "title": "…", "series": "…", "season": 2, "episode": 4, "progress_percent": 61 } ] }

# Media server config (secrets redacted on GET; "••••••••" keeps the stored one)
GET /api/media/config
PUT /api/media/config
Content-Type: application/json

{ "jellyfin_url": "http://127.0.0.1:8096", "jellyfin_api_key": "…", "jellyfin_user_id": "…", "plex_url": "…", "plex_token": "…" }
```

Config is stored in `system_preferences` (`media.servers`); the Home dashboard
media widget shows continue-watching items and detected servers.

### Remote Access (Tailscale / WireGuard status)

```http
# Public share link (no auth — the download token is the credential)
# Mapped to rumahl-files /api/files/shared/:token for external access
GET /share/{token}

# External base URL for share links (domain/TLS, saved in remote.external_url)
GET /api/remote/config
PUT /api/remote/config   { "external_url": "https://ora.meinedomain.de" }

# Tunnel status (requires os.network.read)
GET /api/remote/status
→ { "tailscale": { "installed": true, "running": true, "online": true, "hostname": "ora", "ip": "100.x.y.z" },
    "wireguard": { "installed": true, "interfaces": ["wg0.conf"] } }
```

Detection is best-effort via the `tailscale` CLI and `/etc/wireguard`
presence. "External link" flows (file → share → remote URL) can build on the
returned tailnet IP.

### Web Terminal (Admin Center)

```http
# Interactive shell (requires os.terminal; authenticated via ?token=…)
WS  /api/os/terminal/ws?token=…

# Browser: new WebSocket(wsUrl + '/api/os/terminal/ws?token=' + token)
# The session runs `bash` in a PTY (util-linux `script`) on the rumahl host;
# the server streams the terminal output (ANSI included) and accepts raw
# input. Cancel = Ctrl+C (\u0003), exit = Ctrl+D.
```

`os.terminal` is a new OS permission (admin + maintenance by default, in the
permission request catalog). The Admin Center exposes it as its own
"Terminal" category.

### Logs (user-level viewer) + Services (systemd)

The Logs app (`/logs`, requires `os.system.read`) exposes the central log
sources; the Services app (`/services`, requires the new `os.services`
permission) lists and controls systemd units.

```http
# Log sources + entries per source
GET /api/os/logs/sources
GET /api/os/logs/source/{source_id}?lines=300

# systemd services (delegated to rumahl-control; os.services permission)
GET  /api/os/control/os/services
POST /api/os/control/os/services/{unit.service}/{start|stop|restart}
```

Unit names are validated (`*.service`, alphanumerics plus `_-.@`) to prevent
command injection; only `start`/`stop`/`restart` are accepted. `os.services`
is granted to admins and the maintenance role by default and appears in the
permission request catalog.

## rumahl-core Endpoints (Port 8090)

### Health

```http
GET /health
```

### Service Registry

```http
# List registered services
GET /api/core/services

# Register a service
POST /api/core/services/register
Content-Type: application/json

{
  "name": "rumahl-home",
  "port": 8126,
  "health_endpoint": "/health",
  "metadata": {
    "version": "2.3.0",
    "type": "core"
  }
}

# Proxy health check
GET /api/core/services/{name}/health
```

### Plugin Registry

```http
# List plugins
GET /api/core/plugins

# List with statistics
GET /api/core/plugins/with-stats

# Get plugin details
GET /api/core/plugins/{id}

# Enable plugin
POST /api/core/plugins/{id}/enable

# Disable plugin
POST /api/core/plugins/{id}/disable

# Delete plugin
DELETE /api/core/plugins/{id}

# Execute plugin
POST /api/core/plugins/{id}/execute
Content-Type: application/json

{
  "input": { "key": "value" },
  "timeout_ms": 3000
}

# Plugin logs
GET /api/core/plugins/{id}/logs

# Sandbox status
GET /api/core/sandbox/status
```

### System Events

```http
# SSE event stream
GET /api/core/events

# Broadcast event
POST /api/core/events
Content-Type: application/json

{
  "type": "service.started",
  "data": { "service": "rumahl-home" }
}
```

## App Runtime Endpoints

These are served by `rumahl-home` under the `/api/apps/{app_id}` prefix.

### App Pages

```http
GET /api/apps/pages
```

### App Details

```http
GET /api/apps/{app_id}/detail
```

### App Logs

```http
# Get logs
GET /api/apps/{app_id}/logs

# Live log stream (SSE)
GET /api/apps/{app_id}/logs/stream
```

### App Proxy

```http
# Proxy to app container
GET /api/apps/{app_id}/proxy/{path}
```

### App Configuration

```http
# Get settings schema
GET /api/apps/{app_id}/config/schema

# Get current config
GET /api/apps/{app_id}/config

# Update config
PUT /api/apps/{app_id}/config
Content-Type: application/json

{
  "api_key": "abc123",
  "refresh_interval": 120
}

# Reset a config key
DELETE /api/apps/{app_id}/config/{key}
```

### App Storage

```http
# File operations
GET    /api/apps/{app_id}/storage/files
POST   /api/apps/{app_id}/storage/files
GET    /api/apps/{app_id}/storage/files/{file_id}
DELETE /api/apps/{app_id}/storage/files/{file_id}

# KV operations
GET    /api/apps/{app_id}/storage/kv
PUT    /api/apps/{app_id}/storage/kv/{key}
GET    /api/apps/{app_id}/storage/kv/{key}
DELETE /api/apps/{app_id}/storage/kv/{key}

# Usage
GET    /api/apps/{app_id}/storage/usage
```

### App Database

```http
POST   /api/apps/{app_id}/database/provision
DELETE /api/apps/{app_id}/database
GET    /api/apps/{app_id}/database/status
POST   /api/apps/{app_id}/database/execute
POST   /api/apps/{app_id}/database/backup
GET    /api/apps/{app_id}/database/backups
```

### App Scheduler

```http
GET    /api/apps/{app_id}/schedules
POST   /api/apps/{app_id}/schedules
GET    /api/apps/{app_id}/schedules/{task_id}
PUT    /api/apps/{app_id}/schedules/{task_id}
DELETE /api/apps/{app_id}/schedules/{task_id}
POST   /api/apps/{app_id}/schedules/{task_id}/trigger
GET    /api/apps/{app_id}/schedules/{task_id}/logs
```

### App Webhooks

```http
GET    /api/apps/{app_id}/webhooks
POST   /api/apps/{app_id}/webhooks
GET    /api/apps/{app_id}/webhooks/{hook_id}
PUT    /api/apps/{app_id}/webhooks/{hook_id}
DELETE /api/apps/{app_id}/webhooks/{hook_id}
POST   /api/apps/{app_id}/webhooks/{hook_id}/test
GET    /api/apps/{app_id}/webhooks/{hook_id}/logs
GET    /api/apps/{app_id}/webhooks/{hook_id}/stats
```

### Inter-App Messaging

```http
GET    /api/apps/messaging/channels
POST   /api/apps/messaging/channels
POST   /api/apps/messaging/publish
GET    /api/apps/messaging/events              (SSE)
POST   /api/apps/{app_id}/messaging/subscribe
GET    /api/apps/{app_id}/messaging/subscriptions
DELETE /api/apps/{app_id}/messaging/subscriptions/{sub_id}
POST   /api/apps/{app_id}/messaging/direct
GET    /api/apps/{app_id}/messaging/inbox
POST   /api/apps/{app_id}/messaging/inbox/{msg_id}/read
```
