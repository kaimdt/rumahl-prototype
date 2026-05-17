# IORA Monorepo – AGENTS.md

> Schnelle Orientierung für KI-Agenten in diesem Monorepo.

## 📁 Projektstruktur

```
C:\tmp\home-assistant-dashb\
├── AGENTS.md                    ← Diese Datei – Orientierungshilfe
├── AI_INSTRUCTIONS.md           ← **START HERE**: Anleitung für AI-Agenten zum Entwickeln von Apps/Plugins
├── .env                         ← Lokale Umgebungsvariablen
├── .env.example                 ← Vorlage für Umgebungsvariablen
│
├── backend/                     ← Legacy (leer, alles in iora-os/)
│
├── iora-os/                     ← 🏠 **HAUPT-BACKEND** (Rust Workspace)
│   └── backend/
│       ├── Cargo.toml           ← Rust Workspace mit 20+ Crates
│       ├── start.bat            ← Lokaler Dev-Start (Windows)
│       ├── shared/iora-shared/  ← Gemeinsame Typen & Traits
│       │   └── src/
│       │       ├── app_manifest.rs   ← AppManifest Struktur
│       │       ├── app_storage.rs    ← App Storage (v2.1)
│       │       ├── app_database.rs   ← App SQLite DB (v2.1)
│       │       ├── app_scheduler.rs  ← App Scheduling (v2.1)
│       │       ├── app_webhooks.rs   ← App Webhooks (v2.1)
│       │       ├── app_messaging.rs  ← App Messaging (v2.1)
│       │       ├── permissions.rs    ← Permission System
│       │       ├── plugin.rs        ← Plugin-Traits & Registry
│       │       ├── port_manager.rs  ← Dynamische Port-Verwaltung
│       │       ├── settings.rs      ← Settings Registry
│       │       ├── types.rs         ← Basistypen
│       │       └── lib.rs           ← Exporte
│       │
│       ├── services/            ← 🔧 **Microservices**
│       │   ├── iora-home/       ← 🏠 Haupt-API (Axum, Port 3001/8126)
│       │   │   ├── Cargo.toml   ← rusqlite, cron, utoipa, sqlx
│       │   │   ├── migrations/  ← SQL-Migrationen (001-022)
│       │   │   ├── docs_embedded/ ← Eingebettete Basisdokumentation
│       │   │   └── src/
│       │   │       ├── main.rs              ← Router, 12k+ Zeilen
│       │   │       ├── db/mod.rs            ← DB-Init & Migrationen
│       │   │       ├── auth.rs              ← JWT-/PIN-Auth
│       │   │       ├── documentation.rs     ← Docs-API-Endpoints
│       │   │       ├── local_appstore.rs    ← Lokaler App-Store
│       │   │       ├── app_storage_handler.rs    ← Storage API (v2.1)
│       │   │       ├── app_database_handler.rs   ← DB API (v2.1)
│       │   │       ├── app_scheduler_handler.rs  ← Scheduler API (v2.1)
│       │   │       ├── app_webhooks_handler.rs   ← Webhooks API (v2.1)
│       │   │       └── app_messaging_handler.rs  ← Messaging API (v2.1)
│       │   │
│       │   ├── iora-core/       ← ⚙️ Service-Discovery, Plugin-Registry
│       │   ├── iora-appstore/   ← 📦 App Store (PostgreSQL)
│       │   ├── iora-supervisor/ ← Docker-Container-Management
│       │   ├── iora-files/      ← 📁 Datei-Sharing
│       │   ├── iora-secrets/    ← 🔐 Secret-Management
│       │   ├── iora-security/   ← 🛡️ Security-Monitoring
│       │   ├── iora-gateway/    ← 🌐 API-Gateway
│       │   ├── iora-assist/     ← 🤖 ORA AI-Assistant
│       │   ├── iora-control/    ← 🎮 Control Center
│       │   ├── iora-watchdog/   ← Überwachung
│       │   ├── iora-connector/  ← Remote-Connect
│       │   ├── iora-nginx/      ← Reverse Proxy
│       │   ├── iora-network-monitor/ ← Netzwerk-Scanner
│       │   ├── iora-domain-validator/ ← Domain-Whitelist
│       │   ├── iora-resource-manager/  ← Ressourcen-Überwachung
│       │   ├── iora-updater/    ← Update-Manager
│       │   └── iora-backup/     ← Backup-Service
│       │
│       ├── apps/system/         ← 📱 System-Apps
│       │   └── iora-developer-app/
│       │
│       ├── tools/               ← 🔧 CLI-Tools
│       │   ├── iora-cli/        ← `ora` CLI
│       │   ├── iora-sign/       ← App-Signing
│       │   └── iora-verify/     ← App-Verifikation
│       │
│       └── dev/                 ← 🧪 Dev-Image-only
│           └── iora-dev-bridge/ ← IDE-Integration
│
├── frontend/                    ← 🎨 React Frontend (Vite + Tailwind)
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── public/docs/             ← 📚 Statische Docs (kopiert von /docs)
│   └── src/
│       ├── App.tsx              ← Haupt-App
│       ├── components/
│       │   ├── DocsPageNew.tsx  ← Dokumentations-Viewer
│       │   ├── DocsPage.tsx     ← Legacy Docs-Viewer
│       │   ├── AppStoreTab.tsx  ← App-Store Tab
│       │   ├── AdminPanel.tsx   ← Admin-Panel
│       │   └── ...
│       └── ...
│
├── desktop/                     ← 🖥️ Tauri Desktop App
│   ├── package.json
│   └── src/
│       ├── components/
│       │   ├── DocsPage.tsx
│       │   └── ...
│       └── ...
│
├── sdks/                        ← 📦 **SDKs** für App-Entwickler
│   ├── javascript/              ← JS/TS SDK (IoraClient)
│   │   └── src/
│   │       ├── client.ts        ← Haupt-Client (alle APIs)
│   │       ├── types.ts         ← Typdefinitionen
│   │       ├── iframe.ts        ← Iframe-Kommunikation
│   │       ├── permissions.ts   ← Permission-Helper
│   │       ├── manifest.ts      ← Manifest-Helper
│   │       ├── runtime.ts       ← Plugin-Runtime
│   │       └── runtime-manager.ts
│   ├── go/                      ← Go SDK
│   ├── cpp/                     ← C++ SDK
│   └── php/                     ← PHP SDK
│
├── apps/                        ← 📱 Beispiel-Apps & Configs
│   ├── examples/
│   │   ├── weather-app/         ← Weather App Beispiel
│   │   ├── network-scanner-app/ ← Network Scanner (Rust)
│   │   ├── notification-plugin/ ← Notification Plugin (Rust)
│   │   └── energy-optimizer-plugin/ ← Energy Optimizer (TS)
│   ├── README.md
│   ├── homeassistant.json
│   └── tailscale.json
│
├── docs/                        ← 📚 **Dokumentation** (MD)
│   ├── README.md
│   ├── docs-config.json         ← Navigationsstruktur
│   ├── development/
│   │   ├── app-development.md   ← App-Entwicklung (Hauptguide)
│   │   ├── plugin-development.md← Plugin-Entwicklung
│   │   ├── app-storage.md       ← Storage Guide (v2.1)
│   │   ├── app-database.md      ← SQLite Guide (v2.1)
│   │   ├── app-scheduling.md    ← Scheduling Guide (v2.1)
│   │   ├── app-webhooks.md      ← Webhooks Guide (v2.1)
│   │   └── app-messaging.md     ← Messaging Guide (v2.1)
│   ├── api/
│   ├── guides/
│   ├── security/
│   └── deployment/
│
├── custom_components/           ← 🔌 Home Assistant Custom Components
│   └── mdt_home_dashboard/      ← IORA HA-Integration
│
├── deploy/                      ← 🐳 Docker Compose
│   ├── docker-compose.yml
│   ├── docker-compose.minimal.yml
│   └── docker-compose.iora-os.yml
│
├── scripts/                     ← Dev-Skripte
└── test_*.py                    ← Tests
```

## 🔑 Wichtige Konzepte

### App vs Plugin

| Aspekt | App | Plugin |
|--------|-----|--------|
| Läuft in | Docker-Container | IORA-Runtime (Sandbox) |
| Sprache | Beliebig (JS, Python, Rust...) | JS/TS |
| Ressourcen | Eigener Container | Beschränkt (Zeit/Speicher) |
| Use Case | Web-UI, API-Server | Widgets, Automationen |

### Port-Belegung

- **3001** – iora-home (Dev)
- **8126** – iora-home (Production/IORA OS)
- **8090** – iora-core
- **8092** – iora-assist (ORA AI)
- **8097** – iora-supervisor
- **8098** – iora-appstore

### API-Dokumentation

- **Swagger UI**: `http://localhost:3001/api/docs` oder `GET /docs` → redirect
- **Markdown Docs**: `http://localhost:3001/api/documentation/*path`
- **Statische Docs** (Frontend): `http://localhost:5173/docs/` (Dev) oder `/docs/` (Build)

### Wichtige Permissions (v2.1)

- `AppStorageRead/Write/Delete/Manage` – File & KV Storage
- `AppDatabaseSqlite/Manage` – SQLite DB
- `AppScheduleCreate/Read/Update/Delete` – Scheduled Tasks
- `MessagingPublish/Subscribe/Wildcard/Direct` – Inter-App Messaging
- `WebhookCreate/Read/Update/Delete/Manage` – Webhooks

### Manifest-Struktur (v2.1 Erweiterungen)

```json
{
  "id": "my-app",
  "type": "app",
  "storage": { ... },
  "database": { "backend": "sqlite", "sqlite": { ... } },
  "schedules": { "default_schedules": [ ... ] },
  "webhooks": { "default_webhooks": [ ... ] },
  "messaging": { "channels": [ ... ] }
}
```

## 🖥️ Deployment-Varianten

### IORA OS (Appliance-Image)
- **Alle Dienste laufen NATIV** (kein Docker!) als systemd-Services
- Gebaut mit Buildroot → bootfähiges Image für Bare-Metal / VM
- Ports: localhost / LAN (via iora-nginx Reverse-Proxy)
- Build: `cd iora-os && sudo ./build.sh all --dev`

### Docker Compose (Fremdinstallation)
- Für existierende Linux-Server: alle Dienste in Docker-Containern
- `deploy/docker-compose.yml` – vollständige Installation
- `deploy/docker-compose.minimal.yml` – reduzierte Variante
- Container kommunizieren via Docker-DNS (`iora-home:8126`, etc.)

### Entwicklung (Lokal)

**Option 1: IORA Dev VM (Empfohlen)**
- Vollständige IORA OS Umgebung in QEMU VM
- Alle 20+ Services mit 1:1 IORA OS Konfiguration
- **Dokumentation:** `iora-os/README-DEV-VM.md`
- **Start:** `cd iora-os && ./dev-local.ps1` (Windows) oder `./dev-local.sh` (Linux/macOS)

**Option 2: Direkt auf Host**
- Frontend: `cd frontend && npm run dev` (Port 5173, Vite-Proxy zu :3001)
- Backend: `cd iora-os/backend && cargo run -p iora-home` (Port 3001)
- Desktop: `cd desktop && npm run tauri dev`
- AI: `cargo run -p iora-assist` (Port 8092)

## 💾 RAM-Anforderungen

| Umgebung | Minimum | Empfohlen |
|----------|---------|-----------|
| Raspberry Pi 4 (2GB) | 512MB für IORA, Rest für OS | 1GB |
| VM (4GB) | Standard – alle Dienste (~900MB) | – |
| VM (8GB+) | Standard + AI-Tasks nutzen bis 2GB | – |

**AI Memory:** iora-assist hat `MemoryHigh=512M MemoryMax=1500M`.
Bei >8GB System-RAM kann MemoryMax auf 2-3GB erhöht werden:
```bash
mkdir -p /etc/systemd/system/iora-assist.service.d
echo '[Service]' > /etc/systemd/system/iora-assist.service.d/override.conf
echo 'MemoryMax=3G' >> /etc/systemd/system/iora-assist.service.d/override.conf
systemctl daemon-reload && systemctl restart iora-assist
```

1. **Neue App-API hinzufügen**: Types in `iora-shared/src/` definieren, Handler in `iora-home/src/` schreiben, Route in `main.rs` registrieren, Migration in `migrations/` erstellen
2. **Neue Permission**: In `permissions.rs` enum + description + risk_level + is_plugin_allowed ergänzen
3. **Dokumentation**: `.md`-Dateien in `docs/` erstellen, `docs/docs-config.json` aktualisieren, in `frontend/public/docs/` kopieren
4. **SDK erweitern**: Neue Methoden in `sdks/javascript/src/client.ts` hinzufügen
5. **Rust bauen**: `cargo build -p iora-home` (oder `cargo build` für alles)
6. **Frontend bauen**: `cd frontend && npm run build`

## 🎨 Design-Regeln (CRITICAL)

### Keine Emojis in der UI
- **NIEMALS** dekorative Emojis (🎨💡🔌🌡️📊🌤️👋🕐🎵📹🗺️⬜) in UI-Komponenten verwenden
- Stattdessen **Phosphor-Icons** (`@phosphor-icons/react`) oder **Lucide-Icons** (im NextJS Store) nutzen
- Für Kategorie-Indikatoren: Phosphor-Icons wie `<Lightbulb>`, `<PuzzlePiece>`, `<Ruler>`
- Für Widget-Icons: Die entsprechenden Phosphor-Icons aus der Icon-Map
- Unicode-Symbole für Richtungsindikatoren (⬇️⬅️➡️⬆️) und Status (✓, ★, ◆) sind erlaubt
- Im NextJS Store (`store/`): Lucide-Icons (`lucide-react`) statt Emojis

### Icon-Registry
- Widget-Icons werden über `WIDGET_ICON_MAP` in `widgetRegistry.ts` zugeordnet
- Neue Widgets registrieren ihr Icon dort – niemals als Emoji-String hartkodieren
- Theme-Kategorien verwenden Phosphor-Icons, keine Emojis

### Sprache & i18n
- **ALLE** sichtbaren Strings müssen `t('key.path')` verwenden
- Fallback ist immer Englisch (`en.json`)
- Deutsche Übersetzungen in `de.json`
- Neue Keys in BEIDEN Sprachdateien anlegen
- Backend-Nachrichten auf Englisch, Übersetzung im Frontend
- AI-Prompts immer auf Englisch (bessere Qualität), Antwort-Sprache via `language`-Parameter
