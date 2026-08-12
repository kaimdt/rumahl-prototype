# ORA Home OS Roadmap

**Status:** Draft v1 — live document, updated as packages ship
**Owner:** ORA OS Team
**Last updated:** 2026-02-11

---

## 1. Vision

ORA OS is evolving from a home-automation dashboard + Docker frontend into a
**true Home Operating System**. The goal is a platform — not a container list:

- Apps are **first-class citizens** with an OS-provided API (`ora.*` SDK),
  permissions, background jobs, notifications and lifecycle — not just
  embedded web pages.
- The shell provides desktop-grade UX: windows, spotlight, notifications,
  clipboard, drag & drop, share sheet, session restore.
- Devices (NAS, gaming PC, laptops, TVs, printers) are first-class citizens.
- Users get real profiles: personal desktops, apps, files, permissions,
  guest mode, family areas.
- Third parties can build apps **without knowing how ORA implements storage,
  users, notifications or windows internally**.

### Core principle: ORA Core vs. ORA Apps

```
ORA Apps          ← installable, permissioned, replaceable
─────────────────────────────────────────────
Window Manager / Desktop  (shell UX, session)
Files / Notifications / Jobs / Users          ← OS services & SDK
Permissions                                    ← trust boundary
ORA Runtime (plugin sandbox, app lifecycle)   ← iora-shared, plugin.rs
System Services (control, network, backup…)   ← microservices
Kernel / Linux
```

Everything above the *Permissions* line is app territory. Everything below is
ORA Core and must be kept stable, tested and documented.

---

## 2. Current State (verified inventory)

### 2.1 Frontend shell (React + Vite)

| Area | Status | Location |
|---|---|---|
| Multi-window + split view (left/right) | ✅ exists | `OsWindowContext`, `OsAppWindow`, `OsSystemShell` |
| Alt+Tab recents switcher | ✅ exists | `OsSystemShell` |
| Power menu (shutdown/reboot w/ delay) | ✅ exists | `OsSystemShell` → `/api/os/control/*` |
| Command palette ⌘K (apps, actions) | ✅ exists | `CommandPalette.tsx` |
| Notification center | ✅ exists | `NotificationCenter.tsx`, `NotificationContext` |
| Files app + universal file picker | ✅ exists | `OsFileExplorer`, `OsAppFilePickerDialog` |
| Move/copy dialogs, drag & drop in Files | ✅ exists | `OsFileMoveCopyDialog`, `OsFileExplorer` |
| Share sheet (iora-share) | ✅ exists | `NativeShare.tsx`, `SharePage.tsx` |
| Themes, splash, session lock, screensaver | ✅ exists | `ThemeContext`, `OsSessionLock`, `Screensaver` |
| Widget registry (dashboard widgets) | ✅ exists | `lib/widgetRegistry.ts`, `components/widgets/*` |
| Admin panel (ai/core/network/os/services/tools/… ) | ✅ exists | `AdminPanel*`, `adminTabs/*` |
| Scheduled-task panel (pause/resume) | ⚠️ partial | `ActiveTasksPanel.tsx` (Assist tasks, **not** a system job manager) |
| **Global spotlight search (files/devices/settings/containers)** | ❌ missing | — |
| **System-wide job manager (downloads/backups/updates)** | ❌ missing | — |
| **Clipboard manager + cross-device clipboard** | ❌ missing | — |
| **Session restore (windows/tabs/positions)** | ❌ missing | — |
| **Snap layouts (grid), virtual desktops** | ❌ missing (only left/right split) | — |
| **Default apps / MIME associations** | ❌ missing | — |
| **Deep links (`/app/files/path/…`)** | ❌ missing | — |
| **Drag & drop between apps** | ❌ missing (within Files only) | — |
| **Control Center (unified quick settings)** | ⚠️ partial (quick-settings popover) | `OsSystemShell` |

### 2.2 Backend (Rust workspace, `iora-os/backend`)

| Area | Status | Location |
|---|---|---|
| App manifest, plugins, capabilities | ✅ exists | `iora-shared`: `app_manifest.rs`, `plugin.rs`, `app_capabilities.rs` |
| Inter-app RPC (exposed services) | ✅ exists | `app_capabilities.rs` |
| App storage (files + KV), app SQLite DB | ✅ exists | `app_storage.rs`, `app_database.rs` |
| App scheduler (cron), webhooks, messaging (pub/sub/direct) | ✅ exists | `app_scheduler.rs`, `app_webhooks.rs`, `app_messaging.rs` |
| Permission system (~80 perms) | ✅ exists | `permissions.rs` (incl. Camera, Mic, Location, Media, Network, Files, Users, Docker, Secrets, Queue/Jobs) |
| OS control (stats, services, logs, power) | ✅ exists | `iora-control` → `/api/os/control/*` |
| Network device discovery/scan | ✅ exists | `iora-network-monitor` → `/api/network/*` |
| Cloud relay (Nabu-Casa-style tunnel) | ✅ exists | `iora-connector` |
| Backups | ✅ exists | `iora-backup` → `/api/os/backups/*` |
| Secrets service | ✅ exists | `iora-secrets` (UI/vault UX missing) |
| System event log (dedup, occurrences) | ✅ exists | migration `031_system_events` |
| Refresh tokens, user OS permissions | ✅ exists | migrations `032`, `033` |
| App store (PostgreSQL) | ✅ exists | `iora-appstore`, `schema.sql` |
| **System-wide job bus (progress, cancel, resume)** | ❌ missing | — |
| **Devices service (WOL/SNMP/MQTT/agents)** | ❌ missing | — |
| **Automation flow editor (visual)** | ❌ missing (scheduler + widgets only) | — |
| **Secrets vault UI + app credential provisioning** | ❌ missing | — |
| **Remote access pack (WireGuard/TLS/domains)** | ⚠️ partial (relay + nginx + tailscale example) | — |

### 2.3 JS SDK (`sdks/javascript/src/client.ts`)

Currently exposed: entities, notifications, storage (files/KV), app database
(SQLite), scheduler, webhooks, messaging, settings, plugin execution, STT,
TTS, assist tools.

**Missing from the `ora.*` vision:** system events, jobs/queues, permissions
request flow, secrets, users/profiles, devices, clipboard, window manager
hooks, share sheet, file picker, deep-link handling.

---

## 3. Gap analysis (vision → today)

| Vision item | Today | Gap |
|---|---|---|
| Notification center | ✅ | Aggregation of app/system events; per-app opt-out & priority |
| Global search / Spotlight | ⚠️ ⌘K app launcher | Search across **files, devices, settings, containers, people, commands**; Ctrl+Space |
| Quick actions / command palette | ⚠️ ⌘K actions | System actions as **installable app-provided commands** |
| System job manager | ❌ | Jobs bus (progress/cancel/pause), UI panel, survives app switches |
| Clipboard manager | ❌ | History, cross-device clipboard |
| Share sheet | ✅ iora-share | Broader targets: mail, links, SMB, devices, apps |
| Drag & drop between apps | ⚠️ within Files | Cross-app payload protocol (file refs → apps) |
| Default apps / MIME | ❌ | File-type → app routing table |
| Deep links | ❌ | `/app/<id>/<path>` resolution + app-internal navigation |
| Universal file picker | ✅ | Standardize across apps (SDK call) |
| Global keyboard shortcuts | ⚠️ few hardcoded | Registered, per-app, configurable |
| Multi-window / snap layouts | ⚠️ windows + left/right split | Snap grid, maximize, move shortcuts |
| Virtual desktops / workspaces | ❌ | Deferred (nice-to-have) |
| Session restore | ❌ | Persist windows/tabs/positions per user |
| User profiles (personal desktop, guest, family) | ⚠️ user switching + perms | Profiles, guest mode, family shared areas, per-user app sets |
| ORA app framework / SDK | ✅ strong core | `ora.*` API surface, jobs, secrets, users, devices, events |
| Permissions (Android/iOS-style) | ✅ ~80 perms + editor | **Runtime request dialogs**, background-use grants, per-user grants |
| Devices as first-class citizens | ⚠️ network discovery only | Devices app: WOL, SNMP, MQTT, HA, Tailscale, agents |
| Home dashboard | ✅ widgets | Widget registration API for apps, sections (storage/media/energy) |
| Automation engine | ⚠️ scheduler | Visual flow editor, triggers/conditions/actions, app hooks |
| Secrets / credential vault | ⚠️ service exists | Vault UI, app credential provisioning, rotation |
| Native apps (Monitor/Storage/Containers/…) | ⚠️ admin tabs | Standalone apps with widgets & deep links |
| Home/lifestyle apps (Calendar, Notes, …) | ❌ | App-store apps (installable, not core) |
| Media Hub (Jellyfin/Plex detection) | ❌ | Continue-watching on home, universal downloads |
| Downloads manager | ❌ | Global queue, survives browser close |
| Remote access | ⚠️ relay + nginx | Tailscale/WireGuard/domains/TLS pack, remote share links |
| Device-to-device (AirDrop-like) | ❌ | Agents on Windows/macOS/Linux, send/clipboard/wake/terminal |
| Control Center | ⚠️ quick settings popover | Wi-Fi/BT/VPN/audio/displays/focus + load/media/downloads |
| AI system ops ("why is my NAS slow?") | ⚠️ Assist | System-analysis tools, permissioned installs |

---

## 4. Prioritized roadmap

Priorities were chosen so that **each package delivers standalone value while
building the foundation for the next**. Implementation order per package:
backend/API first where a service boundary exists, frontend first where the
value is purely UX.

### Package 0 — OS Foundation ⭐ (first package)

> **Status:** ✅ **COMPLETE** — all seven features shipped

> The desktop-grade fundamentals every other feature builds on.

1. **Global Spotlight search (Ctrl+Space)** ✅
   - Search sources: apps (existing ⌘K), files (iora-files), devices
     (iora-network-monitor), settings (settings registry), containers
     (iora-supervisor), people/contacts, commands (app-provided).
   - Fuse.js-style fuzzy matching; grouped results; keyboard navigation.
   - `SpotlightSearch.tsx` reusing the ⌘K overlay pattern; keep ⌘K as alias.
   - **Shipped:** `CommandPalette` extended — Ctrl+Space + Ctrl+K, debounced
     async search over files (`/api/files`) + devices (`/api/network/devices`)
     gated by OS permissions, settings deep links, installed-app status
     sublabels. Follow-up: folder deep links, `/api/resources/containers`.
2. **System-wide Job Manager** ✅
   - Backend: jobs table + `/api/jobs/*` (create, list, progress, cancel,
     pause, resume, logs). Sources: downloads, file operations, backups,
     updates, imports.
   - Frontend: `JobCenterPanel.tsx` (shell icon with active-job badge),
     job cards with progress bars, survives app switches (state in backend).
   - App SDK hook: `ora.jobs.create(...)` (permission: `AppQueueManage`).
   - **Shipped:** migration `039_system_jobs`, `iora-shared::system_jobs`
     types, `job_handler.rs` + `/api/jobs/*` routes, `JobCenterPanel` with
     pause/resume/cancel/delete/cleanup + app-store install jobs,
     `ora.jobs` in the JS SDK. Follow-up: wire real sources (backups,
     updater, downloads) into the job bus; per-user job visibility (P1).
3. **Clipboard manager + cross-device clipboard** ✅
   - Backend: clipboard store + `/api/clipboard/*` (history, sync channel via
     `app_messaging`).
   - Frontend: history popover (Ctrl+Shift+V), device sync toggle.
   - **Shipped:** migration `040_clipboard`, `iora-shared::clipboard` types,
     `clipboard_handler.rs` + `/api/clipboard/*` routes (add with dedup, list
     per user, pin, delete, clear), `ClipboardManager.tsx` with system-wide
     copy/cut capture (passwords + > 64 KiB skipped), search, pin, click-to-
     copy and a shell button; `ora.clipboard` in the JS SDK. Cross-device
     sync is implicit (shared per-user store); a push channel via
     `app_messaging` and a device-sync toggle are follow-ups.
4. **Session restore** ✅
   - Persist windows (pageId, layout, position, size, z) + open tabs per user
     to backend (per-user table) and localStorage fallback; restore on login.
   - **Shipped:** migration `041_session_windows`, `iora-shared::session`
     types, `session_handler.rs` + `/api/session/windows` GET/PUT/DELETE
     (per-user, transactional replace), `OsWindowContext` saves debounced
     (+ pagehide flush) and restores on boot; localStorage offline fallback.
5. **Snap layouts** ✅
   - Extend `OsWindowLayout` with a snap grid (left/right/top/bottom/quarters,
     maximize); keyboard + drag-to-edge triggers.
   - **Shipped:** `OsSnapLayout` (`maximized`, left/right/top/bottom, four
     quarters) in `OsWindowContext` + `snapWindow`/`toggleMaximize`;
     drag-to-edge with **live snap-preview overlay**, double-click title bar
     to maximize, dedicated toggle button; Alt+Arrow shortcuts on the
     top-most window. Follow-up: snap-grid selector overlay on the maximize
     button (like Windows 11).
6. **Default apps / MIME + deep links + cross-app drag & drop** ✅
   - **Shipped:** `fileTypeRegistry` gains `FILE_TYPE_CATEGORIES`
     (image/video/audio/pdf/text/table/presentation/archive), per-user default
     bindings (`setDefaultAppForType`, localStorage) and default-first
     resolution in `fileTypeAppFor`; built-in Bilder app registered statically;
     Settings → System → **Default apps** UI.
   - **Deep links ✅:** `/app/os-files/folder/<id>` opens the targeted folder
     (Spotlight folder results deep-link into it; `OsFileExplorer` reads the
     sub-path on mount).
   - **Drag & drop ✅:** `lib/fileDrop.ts` protocol
     (`application/x-iora-file` carrying the file id); Files tags drags;
     **Bilder** accepts drops and copies into the current folder (cross-app
     demo). Follow-up: more drop targets (Mail, Backup, Docker upload).
7. **Global keyboard shortcut registry** ✅
   - **Shipped:** `lib/shortcutRegistry.ts` — 9 defined shortcuts
     (spotlight, clipboard, task-switcher, 4× snap, lock, sleep) with
     canonical combo syntax, per-user overrides (localStorage), `comboMatches`
     + recorder (`comboFromEvent`) and `formatCombo` (⌘/Ctrl-aware);
     Settings → System → **Keyboard shortcuts** UI (re-record + reset);
     the OS shell and command palette now consume registry combos
     (Mod+Space opens Spotlight via `iora:spotlight-toggle`).

**Dependencies:** none (uses existing window context, notification center).
**Exit criteria:** Spotlight searches files+devices+containers; a download or
backup runs as a visible, resumable job; windows survive logout/login.

### Package 1 — User Profiles & Permissions

> **Status:** in progress — runtime permission requests ✅, child profiles ✅,
> guest mode ✅, route guard ✅, family shares ✅ shipped; per-profile page
> layouts + shared family pages still open.

- Profile model: personal desktop, app set, files (home dir per user), HA
  dashboards per user, shared family areas.
  - **Shipped (child profiles):** migration `043_user_profiles`
    (`profile_type` + JSONB `restrictions` on `users`), `iora-shared::user_profiles`
    types, `user_profiles_handler.rs` (`GET /api/admin/users` with profile
    fields, `PUT /api/admin/users/:id/profile`), profile fields attached to
    `/api/auth/verify`; `lib/userRestrictions.ts` filters dock, launcher and
    command palette by `allowed_app_ids`; Settings → System → **Family
    profiles** admin UI (Standard/Child per user + app whitelist).
    Follow-ups: per-profile page layouts, guest mode, shared family areas.
- Guest mode (temporary, no persistence), child/family profiles (restrictions). ✅
  - **Shipped:** `POST /api/auth/guest` + `GET /api/auth/guest-status` (real
    `guest` viewer row, filtered out of user lists), `security.guest_mode_enabled`
    setting with Settings toggle, "Continue as guest" on the login page.
- **Route guard (child profiles)** ✅ — `PageNavigationContext` redirects
  restricted users to the launcher on disallowed pages/deep links
  (Launcher/Home/Settings always reachable).
- **Family shares** ✅ — `file_permissions` with `grantee_type='family'`
  (read-only for all family members): share/revoke via the Files context
  menu, shared entries appear in other users' root listing, shared folders
  are browsable. Follow-up: shared family pages/dashboard.
- Permission grants per user (migration 033 extension) + **runtime request
  dialogs** ("App X wants access to files" → allow/deny, like Android/iOS). ✅
  - **Shipped:** migration `042_permission_requests`, `iora-shared::permission_requests`
    types, `permission_requests_handler.rs` (catalog / request with idempotency
    + already-granted 409 / list / respond → upserts grant into
    `user_os_permissions`), `PermissionRequestDialog.tsx` (polls pending,
    oldest-first, Allow/Deny, refreshes grants), `ora.permissions` in the JS
    SDK, i18n labels for all 8 OS permissions.
- User switcher → real profile switcher with per-profile session restore.

### Package 2 — App Framework & SDK (`ora.*`)

> **Status:** ✅ **COMPLETE** — `ora.*` SDK surface, system-events hooks and
> example apps all shipped.

- SDK modules: `ora.notifications`, `ora.files` (picker), `ora.storage`,
  `ora.clipboard`, `ora.windows`, `ora.permissions` (request flow),
  `ora.jobs`, `ora.secrets` (credential provisioning), `ora.users`,
  `ora.devices`, `ora.home` (automation), `ora.system.events`.
  - **Shipped:** `sdks/javascript/src/client.ts` now exposes `ora.jobs`,
    `ora.clipboard`, `ora.permissions` (from Package 0/1) plus **`ora.files`
    (list/info/downloadUrl/remove/move/copy/rename/restore/quota/createFolder/
    multipart upload)**, **`ora.secrets`** (app-scoped credential vault via
    `setAppId`), **`ora.users`**, **`ora.devices`** (network) and
    **`ora.system`** (event report/resolve + stats). Also fixed a request-body
    serialization bug in the new modules (nested `{ body: … }` payloads).
    `ora.windows` is a shell concept with no HTTP surface (documented).
- Backend: expose the Package-0 job bus, secrets vault and device registry to
  apps; system-events subscription for apps. ✅
  - **Shipped:** `LifecycleEvent::OnSystemEvent` + `app_system_event_hooks.rs`
    dispatcher (glob-filtered, 3 s timeout) wired to `SystemEventLog` via a
    fan-out channel; apps declare `lifecycle_hooks.hooks[].event =
    on_system_event` in their manifest.
- Docs + examples for third-party apps. ✅
  - **Shipped:** full `ora.*` module reference + runnable example +
    `on_system_event` hook docs in `docs/sdks/iora-sdk.md`; the energy
    optimizer plugin now exercises `ora.permissions.request`, `ora.jobs`,
    app secrets and `ora.system.reportEvent`; the weather runtime example
    uses jobs/permissions/system; all example-app manifests declare the
    system-event hook.

### Package 3 — Devices & Home Dashboard

> **Status:** in progress — Devices app ✅ shipped; Home Dashboard v2 still open.

- **Devices app:** registry for gaming PC, MacBook, NAS, TV, printer, …
  backends: WOL, SSH, SNMP, MQTT, Home Assistant, Tailscale, local agents
  (desktop agent for Win/macOS/Linux later).
  - **Shipped:** migration `044_device_registry`, `iora-shared::devices`
    types, `device_handler.rs` (`/api/devices` CRUD + `/wake` sending a WOL
    magic packet to 255.255.255.255:9 with MAC validation), `OsDevicesApp`
    (`/devices`): curated devices with add/edit/remove + Wake buttons, plus
    the auto-discovered network-device list (online/offline). Requires
    `os.network.write`.
  - **Agents ✅ (migration `045_device_agents`):** reachability probes —
    `tcp` (host:port connect) and `http` (GET) agents configured per device;
    `POST /api/devices/:id/probe` returns reachable/latency/detail and the
    Devices app shows a per-device Check button with the last result.
    Follow-ups: SSH/SNMP agents, desktop device agents.
- **Home Dashboard v2:** sections (time/weather/calendar/presence, storage,
  server state, downloads, smart home, music, recent files, cameras, energy)
  with **app-registered widgets** (`RegisterWidget` permission already exists).
  - **Shipped (presence + system sections):** `ora_presence` widget
    aggregates Home Assistant `person`/`device_tracker` entities ("X of Y
    home") on the home row; four ORA-native dashboard widgets —
    `ora_storage` (quota), `ora_system` (CPU/RAM/uptime), `ora_jobs`
    (active jobs), `ora_recent_files` — added to the widget registry, the
    widget palette and the default home layout under a "System" section.
    **ORA Home stays dependent on Home Assistant:** the smart-home widgets
    (weather, scenes, calendar, entities) remain the core; the system
    widgets are purely additive ORA data.

### Package 4 — Automation Engine ✅ implemented (Codex)

> **Ownership:** implemented by an external Codex session and merged — visual
> flow editor (`AutomationEditorApp`), `automationApi.ts`, `automation_handler.rs`
> + `/api/automations/*`, migrations `034_automation_flows` +
> `035_automation_flow_edges`. Status details live in the Codex change log;
> this section keeps the roadmap-level scope.

- Visual flow editor (trigger → condition → action), triggers from devices,
  jobs, files, schedules, apps; actions incl. notifications, jobs, scripts.
- Reuses `app_scheduler`, `RunAutomations`, `CreateAutomations` permissions.

### Package 5 — Storage, NAS & Native Home OS Apps

> **Status:** in progress — Storage ✅ (Codex), Containers ✅; Network/System
> apps exist; Logs/Services/Updates apps still open.

> Turn ORA OS into a complete, safety-first NAS operating system while moving
> the existing administration surfaces into standalone system apps.

1. **Storage inventory and health**
   - Native Storage app for physical disks, partitions, filesystems, mounts,
     temperatures, SMART/NVMe health, wear level, bad sectors and capacity.
   - Background health checks, predictive warnings and notifications with
     direct links to the affected disk, pool or share.
2. **Software RAID lifecycle**
   - Linux `mdadm` support for RAID 0, 1, 5, 6 and 10: create, inspect,
     assemble, start, stop, expand, replace failed disks and monitor rebuilds.
   - RAID creation and recovery use the system-wide Job Manager so long-running
     initialization, reshape, scrub and rebuild operations remain visible.
   - Degraded arrays stay accessible when safe; ORA explains the failure,
     identifies a suitable replacement and guides the repair workflow.
3. **Pools, filesystems and data integrity**
   - Storage pools and volumes on ext4, XFS and Btrfs; optional ZFS integration
     is feature-detected and never assumed to be installed.
   - Btrfs/ZFS capabilities expose snapshots, checksums, scrub, quotas and
     replication only when supported by the selected backend.
   - Scheduled scrubs, SMART tests and filesystem checks with persistent
     results, alerting and audit history.
4. **NAS shares and access control**
   - SMB/Samba and NFS share management; per-user and per-group read/write
     access, guest access off by default, quotas and recycle-bin policies.
   - Shared family areas and app storage resolve through the Package-1 user and
     permission model; credentials and mount secrets use the secrets vault.
   - Service discovery for shares on the local network and stable deep links
     from Files, Users, Backup and the Home Dashboard.
5. **Backup, snapshots and replication**
   - Snapshot policies are not treated as backups: the UI distinguishes local
     rollback, external backup and off-device replication.
   - Backup targets include USB disks, another ORA/NAS system and permissioned
     remote targets; restore workflows verify data before replacing live data.
6. **Native system apps** ✅
   - System Monitor ✅ (`os-system`), Storage ✅ (`os-storage`, Codex),
     Containers ✅ (`os-containers`), Network ✅ (`os-network`), Backup/Updates
     ✅ (`os-maintenance`), Logs ✅ (`os-logs` — user-level source viewer via
     `GET /api/os/logs/*`, `os.system.read`), Services ✅ (`os-services` —
     systemd list + start/stop/restart via iora-control, new `os.services`
     permission). The Admin Center keeps an administrative view of the same
     APIs instead of separate implementations.

**Safety requirements:** destructive storage operations always show the exact
source disks, affected arrays/volumes, data-loss impact and generated command
plan before execution. They require an explicit typed confirmation and fresh
admin authorization; they cannot be initiated autonomously by AI, apps or
background automations. ORA never formats a mounted disk, never silently
reuses a disk with signatures and never marks a rebuild complete before the
kernel reports a healthy array.

**Dependencies:** Package 0 Job Manager and notifications; Package 1 user and
permission model for shares. Basic local RAID management can ship before
Package 1, but multi-user NAS sharing cannot.

**Exit criteria:** ORA can create and monitor a RAID1 array, detect and report a
degraded member, guide a disk replacement and rebuild, schedule a scrub,
create an authenticated SMB share, and restore a verified backup without
requiring SSH or direct configuration-file edits.

### Package 6 — Home & Lifestyle Apps + Media Hub

> **Status:** in progress — per-user Downloads ✅, download manager ✅, Media
> Hub ✅, first lifestyle app (Notes) ✅; more lifestyle apps still open.

- App-store apps: Calendar, Notes, Tasks, Contacts, Photos, Music, Videos,
  Recipes, Shopping List, Documents, Password Manager, Home Assistant,
  Camera Viewer, Downloads, Torrent Client, Printer Manager, Scanner,
  Family Dashboard, Shared Calendar, Shared Storage.
  - **Reference app ✅ (`apps/examples/apps/ora-notes`):** installable Notes
    app (own Docker container + web UI) demonstrating the App Framework:
    notes persisted via App Storage KV (`/api/apps/:id/storage/kv/notes`),
    custom launcher page, supervisor health check, app token auth. This is
    the template for further lifestyle apps.
- **Per-user Downloads folder ✅** — `GET /api/files/system-folder`
  (iora-files) finds or creates the personal Downloads/Documents/Photos/
  Videos folders per user (legacy localized names are reused via aliases);
  the Files sidebar shows them with i18n labels and guarantees their
  existence on app open. This folder is the anchor for the download manager.
- **Universal download manager ✅** — `POST /api/downloads` starts a backend
  download as a system job (SSRF-guarded: no loopback); the file streams
  server-side and is uploaded into the user's personal Downloads folder
  (multipart, caller token), so downloads survive tab closes. Cancel skips
  the upload. Files app has a "Download from URL" dialog; the Job Center
  shows progress; SDK exposes `ora.downloads`.
- **Media Hub ✅** — `GET /api/media/hub` probes Jellyfin (8096) and Plex
  (32400) or configured URLs; `GET /api/media/continue-watching` returns
  Jellyfin resume items (API key + user id config, stored redacted in
  `media.servers`); the `ora_media` Home widget shows continue-watching with
  progress bars + detected server chips; Settings → System → **Media Hub**
  configures the connections. Plex continue-watching is a follow-up.

### Package 7 — Remote Access & Device-to-Device

- Remote access pack: Tailscale/WireGuard, reverse proxy, domains, TLS,
  "create external link" for shares (file → share → external link).
- Device agents (Windows/macOS/Linux): send-to-device, open-on-device,
  clipboard sync, wake, remote terminal (AirDrop + KDE Connect feel).

### Package 8 — Control Center & AI System Ops

- Unified Control Center: Wi-Fi, Bluetooth, VPN, dark mode, audio, displays,
  focus, home + server load, downloads, playing media, notifications, ORA
  Assistant.
- AI ops ("why is my NAS slow?" → CPU/disks/network/logs analysis;
  "install Immich with 500 GB" → storage+container+proxy+permissions).

### Package 9 — Terminal & Admin Center Redesign (deferred)

- Complete overhaul of the Admin Center; Terminal moves into it as a deeply
  integrated, permissioned component. *Explicitly deferred by decision.*

### Deferred backlog

- Virtual desktops / workspaces (after snap layouts prove out).
- ORA agent binaries for Win/macOS/Linux (blocked on Package 7 protocol).

---

## 5. Guiding principles

1. **Backend/API before frontend** where a service boundary exists; frontend
   first for pure-UX packages — decided **per feature**, not dogmatically.
2. **Apps install features; core ships the platform.** Lifestyle apps live in
   the app store, not in the base image.
3. **Permissions are the trust boundary.** New OS capabilities ship with a
   permission (see `permissions.rs`), runtime request dialogs in Package 1.
4. **Migrations are append-only.** New schema via new numbered files in
   `iora-home/migrations/` (current: `033`).
5. **i18n**: every new UI string ships with `en.json` + `de.json`.
6. **No emojis in UI**; Phosphor/Lucide icons only.
7. **Maintain the 12k-line guard:** `iora-home/src/main.rs` is never read or
   rewritten wholesale — routes are added via targeted edits.

---

## 6. How to contribute / track

- Kanban tasks for ORA use `--workspace worktree:wt/<task-name>`, branches
  `feat/<task-name>`, push + PR on completion.
- Each package gets a dedicated branch and its own docs page once shipped.
- Update this roadmap (and `docs/docs-config.json` + `frontend/public/docs/`)
  when a package is started, scoped or shipped.
