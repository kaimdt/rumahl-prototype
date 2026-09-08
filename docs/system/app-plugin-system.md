# rumahl App & Plugin System – Vollständige Referenz

> Stand: v2.3.0 | Gültig für Entwickler, Administratoren und KI-Agenten

---

## 1. Architektur-Überblick

```
┌─────────────────────────────────────────────────────────────────────┐
│                         rumahl HOME (rumahl-home)                       │
│  Port 3001/8126    ·    Haupt-API    ·    Axum (Rust)              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ LocalAppStore│  │  Supervisor  │  │  Plugin-Sandbox          │  │
│  │ (App/Plugin  │  │  (Docker     │  │  (Subprozess mit        │  │
│  │  Registry)   │  │   Manager)   │  │   Restriktionen)        │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘  │
│         │                 │                      │                  │
│         ▼                 ▼                      ▼                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  SQLite/JSON │  │  Docker      │  │ Node.js / Python3       │  │
│  │  (per App)   │  │  Container   │  │ (kein Shell, kein Net)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                      │
         ▼                    ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL (System-DB)                           │
│  · App-Config: system_preferences.app.config.{app_id}              │
│  · App-Datenbank: eigener PostgreSQL-User (via Proxy)              │
│  · Per-App SQLite: Datei im App-Verzeichnis                        │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. App vs. Plugin

| Merkmal | App | Plugin |
|---------|-----|--------|
| **Ausführung** | Eigener Docker-Container (oder lokaler Modus) | Sandbox-Subprozess (Node.js/Python) |
| **Lebensdauer** | Läuft dauerhaft (Service) | On-Demand, max. 5s (konfigurierbar) |
| **Sprache** | Beliebig (JS, Python, Rust, Go, …) | JavaScript/TypeScript oder Python |
| **Ressourcen** | Eigener Container (beliebig) | Max 128 MB RAM, kein Netzwerk (standard) |
| **UI** | Vollständige Web-App (Iframe) | Kein eigenes UI (nur Datenausgabe) |
| **API-Zugriff** | Vollständige rumahl API | Eingeschränkte rumahl API |
| **Datenbank** | PostgreSQL (Proxy) oder SQLite | Kein DB-Zugriff |
| **Use Case** | Dashboard-Erweiterungen, APIs | Automationen, Datenverarbeitung |

## 3. Manifest-Schema (vollständig)

```json
{
  "id": "meine-app",
  "name": "Meine App",
  "version": "1.0.0",
  "developer": "Entwickler Name",
  "description": "Kurzbeschreibung der App",
  "type": "app",
  "icon": "icon.png",
  "main": "index.js",

  "permissions": [
    "AppStorageRead",
    "AppDatabaseSqlite",
    "MessagingPublish"
  ],

  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "working_dir": "/app",
    "install_cmd": "npm install",
    "start_cmd": "node server.js",
    "internal_ports": [
      { "port": 3000, "protocol": "tcp", "assignment_mode": "random" }
    ],
    "environment": {
      "NODE_ENV": "production",
      "LOG_LEVEL": "info"
    },
    "health_check": {
      "endpoint": "/health",
      "interval": 30,
      "timeout": 10,
      "retries": 3
    }
  },

  "database": {
    "backend": "sqlite",
    "sqlite": {
      "auto_provision": true,
      "wal_mode": true,
      "max_size_bytes": 104857600,
      "init_sql": ["CREATE TABLE IF NOT EXISTS ..."]
    }
  },

  "storage": {
    "max_files": 100,
    "max_file_size_mb": 10,
    "max_total_size_mb": 100
  },

  "schedules": {
    "default_schedules": [
      {
        "name": "daily_cleanup",
        "schedule_type": "cron",
        "cron_expression": "0 3 * * *",
        "payload": { "action": "cleanup" }
      }
    ]
  },

  "webhooks": {
    "default_webhooks": [
      {
        "name": "github_webhook",
        "description": "Empfängt GitHub-Push-Events",
        "method": "POST",
        "target_url": "http://localhost:3000/webhook"
      }
    ]
  },

  "messaging": {
    "channels": [
      { "name": "notifications", "type": "pub_sub" }
    ]
  },

  "custom_pages": [
    {
      "id": "meine-app-seite",
      "title": "Meine App",
      "icon": "broadcast",
      "url": "/",
      "show_in_nav": true,
      "order": 100
    }
  ],

  "settings_schema": {
    "title": "App-Einstellungen",
    "description": "Konfiguriere deine App",
    "fields": [
      {
        "key": "api_key",
        "label": "API-Schlüssel",
        "type": "password",
        "required": true
      },
      {
        "key": "refresh_interval",
        "label": "Aktualisierungsintervall (Sekunden)",
        "type": "number",
        "default": 60,
        "validation": { "min": 10, "max": 3600 }
      },
      {
        "key": "theme",
        "label": "Design",
        "type": "select",
        "default": "dark",
        "options": [
          { "value": "dark", "label": "Dunkel" },
          { "value": "light", "label": "Hell" }
        ]
      },
      {
        "key": "notifications",
        "label": "Benachrichtigungen aktivieren",
        "type": "boolean",
        "default": true
      }
    ]
  },

  "sandbox": {
    "max_execution_time_ms": 5000,
    "max_memory_mb": 128,
    "allow_network": false,
    "allow_file_system": false
  }
}
```

### 3.1 Manifest-Felder im Detail

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| `id` | String | ✅ | Eindeutige ID (nur `[a-zA-Z0-9_-.]`) |
| `name` | String | ✅ | Anzeigename |
| `version` | String | ✅ | SemVer (z.B. "1.0.0") |
| `type` | String | ✅ | `"app"` oder `"plugin"` |
| `main` | String | ❌ | Einstiegspunkt (Default: `index.js`) |
| `permissions` | String[] | ❌ | Benötigte Berechtigungen |
| `docker` | Object | ❌ | Docker-Konfiguration (Einzel-Container) |
| `bundle` | Object | ❌ | 🆕 Multi-Container Bundle (v2.3) |
| `database` | Object | ❌ | DB-Konfiguration |
| `storage` | Object | ❌ | Storage-Konfiguration |
| `custom_pages` | Object[] | ❌ | Eigene Dashboard-Seiten |
| `settings_schema` | Object | ❌ | App-Konfigurations-Schema |
| `sandbox` | Object | ❌ | Sandbox-Konfiguration (nur Plugins) |

### 3.2 🆕 Multi-Container App Bundles (v2.3)

Apps können mehrere Docker-Container als **Bundle** definieren. Container im Bundle kommunizieren über ein internes Docker-Netzwerk und werden gemeinsam gestartet/gestoppt.

**Beispiel: Home Assistant Bundle (PostgreSQL + MQTT + HA Core):**
```json
{
  "type": "app",
  "bundle": {
    "version": "1.0",
    "services": [
      {
        "name": "postgres",
        "image": "postgres:16-alpine",
        "environment": { "POSTGRES_USER": "hass" },
        "internal_ports": [{ "port": 5432, "protocol": "tcp" }],
        "health_check": { "endpoint": "pg_isready -U hass", "interval": 10 }
      },
      {
        "name": "homeassistant",
        "image": "ghcr.io/home-assistant/home-assistant:stable",
        "internal_ports": [{ "port": 8123, "protocol": "tcp" }],
        "volumes": ["./ha-config:/config"],
        "depends_on": ["postgres"],
        "resources": { "memory": "1G", "cpu": "1.0" }
      }
    ],
    "network": { "driver": "bridge", "subnet": "172.28.0.0/24" },
    "auto_compose": true
  }
}
```

**Interne Kommunikation:** Container erreichen sich über den **Service-Namen** als DNS-Hostname:
- `postgres` → erreichbar unter `postgres:5432`
- `homeassistant` → erreichbar unter `homeassistant:8123`

**Bundle-API:**
```
GET  /api/supervisor/apps/{id}/compose         → docker-compose.yml downloaden
POST /api/supervisor/apps/{id}/bundle/start    → Alle Services starten
POST /api/supervisor/apps/{id}/bundle/stop     → Alle Services stoppen
POST /api/supervisor/apps/{id}/bundle/restart  → Alle Services neustarten
GET  /api/supervisor/apps/{id}/bundle/status   → Status aller Services
```

**UI:** Bundle-Apps erhalten ein **lila "Bundle"-Badge** und einen neuen **"Bundle"-Tab** im App-Detail-Dialog mit Service-Übersicht, Start/Stop-Buttons und docker-compose.yml Download.

**Bundle-Felder:**
| Feld | Typ | Beschreibung |
|------|-----|------------|
| `services[].name` | String | Name (auch DNS-Hostname im Netzwerk) |
| `services[].image` | String | Docker-Image (ODER build) |
| `services[].build` | Object | Build-Konfig (context, dockerfile, args) |
| `services[].depends_on` | String[] | Startup-Reihenfolge |
| `services[].health_check` | Object | Healthcheck |
| `services[].resources` | Object | CPU/Memory-Limits |
| `network.driver` | String | Netzwerk-Treiber (bridge) |
| `network.internal` | Bool | Nur internes Netzwerk? |
| `network.subnet` | String | Subnetz (z.B. "172.28.0.0/24") |
| `auto_compose` | Bool | docker-compose.yml generieren |

---

## 4. Datenbank-System

### 4.1 Option A: Per-App SQLite

Jede App kann ihre eigene SQLite-Datenbank haben. Die Datenbank wird in einem isolierten Verzeichnis pro App gespeichert.

```json
{
  "database": {
    "backend": "sqlite",
    "sqlite": {
      "auto_provision": true,
      "wal_mode": true,
      "max_size_bytes": 104857600,
      "init_sql": ["CREATE TABLE IF NOT EXISTS ..."]
    }
  }
}
```

**API:**
```
POST   /api/apps/{app_id}/database/provision   → DB anlegen
DELETE /api/apps/{app_id}/database              → DB löschen
GET    /api/apps/{app_id}/database/status       → Status abrufen
POST   /api/apps/{app_id}/database/execute      → SQL ausführen
POST   /api/apps/{app_id}/database/backup       → Backup erstellen
GET    /api/apps/{app_id}/database/backups      → Backups auflisten
```

**SDK-Beispiel (JavaScript):**
```javascript
const rumahlClient = require('rumahl-sdk');
const client = new rumahlClient('http://localhost:3001', 'api-key');

// Datenbank provisionieren
await client.appDatabase.provision({
  wal_mode: true,
  init_sql: [
    "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT, done BOOLEAN DEFAULT 0)"
  ]
});

// SQL ausführen
await client.appDatabase.execute(
  "INSERT INTO todos (title) VALUES ($1)", 
  ["Mein erster Eintrag"]
);

const result = await client.appDatabase.execute(
  "SELECT * FROM todos ORDER BY id DESC"
);
```

### 4.2 Option B: PostgreSQL (via Proxy)

> 🔒 **Sicherheitskritisch**: Apps erhalten NIEMALS direkten Datenbankzugriff.  
> Der gesamte PostgreSQL-Verkehr läuft durch einen rumahl-Proxy, der:
> - Queries validiert (kein `DROP TABLE`, `ALTER SYSTEM`, etc.)
> - Ressourcen-Limits durchsetzt
> - Zugriff auf den eigenen Schema-Namespace beschränkt

**Ablauf:**
1. App beantragt PostgreSQL-Zugriff im Manifest (`database.backend: "postgres"`)
2. rumahl erstellt einen **dedizierten DB-User** mit `GRANT USAGE ON SCHEMA app_{id}`
3. rumahl konfiguriert einen **Proxy-Endpunkt** (z.B. `localhost:5433?user=app_{id}&db=rumahl_apps`)
4. Die App verbindet sich NUR zum Proxy, nicht direkt zur PostgreSQL

```json
{
  "database": {
    "backend": "postgres",
    "postgres": {
      "auto_provision": true,
      "schema": "app_meine_app",
      "max_connections": 5,
      "max_storage_mb": 500,
      "init_sql": ["CREATE TABLE IF NOT EXISTS ..."]
    }
  }
}
```

**Sicherheitsrestriktionen (Proxy-Ebene):**
```sql
-- ✅ Erlaubt
SELECT * FROM todos
INSERT INTO entries (title) VALUES ('Hallo')
UPDATE users SET name = 'Test' WHERE id = 1
CREATE TABLE IF NOT EXISTS app_data (...)
CREATE INDEX ON app_data (created_at)

-- ❌ VERBOTEN (vom Proxy blockiert)
DROP TABLE todos              -- Kein DROP außerhalb eigener Tabellen
ALTER SYSTEM SET ...          -- Keine System-Änderungen
CREATE EXTENSION ...          -- Keine Extension-Installation
GRANT ALL ON ...              -- Keine Rechte-Verteilung
COPY ... FROM PROGRAM ...     -- Keine Command-Ausführung
```

**API (gleiche Endpoints wie SQLite):**
```
POST   /api/apps/{app_id}/database/provision   → PostgreSQL-User + Schema anlegen
DELETE /api/apps/{app_id}/database              → User + Schema löschen
POST   /api/apps/{app_id}/database/execute      → SQL via Proxy ausführen
```

---

## 5. Storage-System (File & KV)

Apps können Dateien und Key-Value-Daten speichern. Alles wird im App-Verzeichnis isoliert.

### File Storage
```
GET    /api/apps/{app_id}/storage/files             → Dateien auflisten
POST   /api/apps/{app_id}/storage/files             → Datei hochladen (Base64)
GET    /api/apps/{app_id}/storage/files/{file_id}   → Datei herunterladen
DELETE /api/apps/{app_id}/storage/files/{file_id}   → Datei löschen
GET    /api/apps/{app_id}/storage/usage             → Speicherverbrauch
```

### KV Storage
```
GET    /api/apps/{app_id}/storage/kv              → Alle Keys auflisten
PUT    /api/apps/{app_id}/storage/kv/{key}        → Key setzen
GET    /api/apps/{app_id}/storage/kv/{key}        → Key lesen
DELETE /api/apps/{app_id}/storage/kv/{key}        → Key löschen
```

**SDK:**
```javascript
// File speichern
await client.appStorage.uploadFile('config.json', JSON.stringify({ theme: 'dark' }), 'application/json');

// KV speichern
await client.appStorage.setKv('user_prefs', { theme: 'dark', lang: 'de' });

// KV lesen
const prefs = await client.appStorage.getKv('user_prefs');
```

---

## 6. Scheduling-System

Cron-Jobs und Intervall-Aufgaben pro App.

```json
{
  "schedules": {
    "default_schedules": [
      {
        "name": "mein_job",
        "schedule_type": "cron",
        "cron_expression": "*/5 * * * *",
        "payload": { "action": "refresh" }
      }
    ]
  }
}
```

**API:**
```
GET    /api/apps/{app_id}/schedules                    → Alle Jobs auflisten
POST   /api/apps/{app_id}/schedules                    → Job erstellen
GET    /api/apps/{app_id}/schedules/{task_id}          → Job-Details
PUT    /api/apps/{app_id}/schedules/{task_id}          → Job aktualisieren
DELETE /api/apps/{app_id}/schedules/{task_id}          → Job löschen
POST   /api/apps/{app_id}/schedules/{task_id}/trigger  → Manuell auslösen
GET    /api/apps/{app_id}/schedules/{task_id}/logs     → Ausführungslogs
```

---

## 7. Webhook-System

Externe Dienste können via Webhooks Daten an Apps senden.

```json
{
  "webhooks": {
    "default_webhooks": [
      {
        "name": "github_push",
        "method": "POST",
        "target_url": "http://localhost:3000/webhook/github"
      }
    ]
  }
}
```

**API:**
```
GET    /api/apps/{app_id}/webhooks                  → Alle Webhooks auflisten
POST   /api/apps/{app_id}/webhooks                  → Webhook erstellen
GET    /api/apps/{app_id}/webhooks/{hook_id}        → Webhook-Details
PUT    /api/apps/{app_id}/webhooks/{hook_id}        → Webhook aktualisieren
DELETE /api/apps/{app_id}/webhooks/{hook_id}        → Webhook löschen
POST   /api/apps/{app_id}/webhooks/{hook_id}/test   → Webhook testen
GET    /api/apps/{app_id}/webhooks/{hook_id}/logs   → Lieferlogs
```

---

## 8. Messaging-System (Inter-App)

Apps können untereinander Nachrichten austauschen (Pub/Sub + Direct Messages).

```json
{
  "messaging": {
    "channels": [
      { "name": "notifications", "type": "pub_sub" },
      { "name": "events", "type": "pub_sub" }
    ]
  }
}
```

**API:**
```
GET    /api/apps/messaging/channels                  → Alle Channels auflisten
POST   /api/apps/messaging/channels                  → Channel registrieren
POST   /api/apps/messaging/publish                   → Nachricht veröffentlichen
GET    /api/apps/messaging/events                    → SSE-Event-Stream
POST   /api/apps/{app_id}/messaging/subscribe        → Channel abonnieren
POST   /api/apps/{app_id}/messaging/direct           → Direktnachricht senden
GET    /api/apps/{app_id}/messaging/inbox            → Posteingang
```

---

## 9. App-Konfiguration (settings_schema)

Apps können ein Einstellungs-Schema definieren, das im UI als Konfigurationsformular angezeigt wird.

**Schema-Felder:**
| Type | UI-Control | Wert |
|------|-----------|------|
| `text` | Textfeld | String |
| `number` | Zahlenfeld | Number |
| `boolean` | Schalter | Boolean |
| `select` | Dropdown | String (aus options) |
| `password` | Passwortfeld | String (maskiert) |
| `url` | URL-Feld | String (Start mit http) |
| `textarea` | Mehrzeilig | String |
| `color` | Farbpicker | Hex-String |

**API:**
```
GET  /api/apps/{app_id}/config/schema   → Schema abrufen
GET  /api/apps/{app_id}/config          → Aktuelle Werte (mit Defaults)
PUT  /api/apps/{app_id}/config          → Werte aktualisieren
DEL  /api/apps/{app_id}/config/{key}    → Key zurücksetzen
```

**SDK:**
```javascript
// Schema abrufen
const schema = await client.appConfig.getSchema();

// Aktuelle Werte
const config = await client.appConfig.get();

// Konfiguration aktualisieren
await client.appConfig.update({
  api_key: 'abc123',
  refresh_interval: 120,
  notifications: true
});
```

---

## 10. Plugin-System & Sandbox

### 10.1 Funktionsweise

Plugins sind **kurzlebige Code-Einheiten**, die nur bei Bedarf ausgeführt werden:

```
Plugin registrieren → Warte auf Aufruf → Sandbox starten → 
Code ausführen → Ergebnis zurückgeben → Sandbox stoppen
```

### 10.2 Sandbox-Restriktionen

```
┌──────────────────────────────────────────────────┐
│                  Plugin-Sandbox                    │
│                                                    │
│  ❌ Kein Shell-Zugriff                             │
│  ❌ Keine Paketinstallation (npm/pip)             │
│  ❌ Kein child_process / subprocess               │
│  ❌ Kein Netzwerk (außer allow_network=true)      │
│  ❌ Kein Dateisystem (außer allow_fs=true)        │
│  ✅ Nur Ausgabe via stdout (JSON)                 │
│  ✅ Input via RUMAHL_PLUGIN_INPUT (Env)             │
│  ✅ Zeitlimit (Default 5000ms)                    │
│  ✅ Speicherlimit (Default 128MB)                 │
└──────────────────────────────────────────────────┘
```

### 10.3 Plugin-API

**JavaScript:**
```javascript
// plugin.js
module.exports = {
  execute: async (input) => {
    const { name } = input;
    return { 
      greeting: `Hallo ${name || 'Welt'}!`, 
      timestamp: new Date().toISOString() 
    };
  }
};

// Oder direkt als Funktion:
module.exports = async (input) => {
  return { processed: true, input };
};
```

**Python:**
```python
# main.py
def execute(input_data):
    name = input_data.get('name', 'Welt')
    return {
        'greeting': f'Hallo {name}!',
        'timestamp': __import__('datetime').datetime.now().isoformat()
    }

# Oder als handler-Funktion:
def handler(input_data):
    return {'processed': True, 'input': input_data}
```

### 10.4 Plugin-Ausführung via API

```
POST /api/core/plugins/{plugin_id}/execute
Content-Type: application/json

{
  "input": { "name": "Welt" },
  "timeout_ms": 3000
}

→ 200 OK
{
  "success": true,
  "plugin_id": "mein-plugin",
  "duration_ms": 42,
  "output": { "greeting": "Hallo Welt!", "timestamp": "..." }
}
```

### 10.5 Plugin-Logs

```
GET /api/core/plugins/{plugin_id}/logs

→ 200 OK
{
  "plugin_id": "mein-plugin",
  "logs": [
    { "timestamp": "...", "level": "INFO", "message": "Plugin ausgeführt", "source": "plugin" }
  ]
}
```

---

## 11. Supervisor (Docker-App-Management)

Apps (Typ `"app"`) laufen standardmäßig in Docker-Containern.

**API:**
```
GET    /api/supervisor/apps                    → Alle Apps mit Status
POST   /api/supervisor/apps/{id}/start         → App starten
POST   /api/supervisor/apps/{id}/stop          → App stoppen
POST   /api/supervisor/apps/{id}/restart       → App neustarten
GET    /api/supervisor/apps/{id}               → App-Details
DELETE /api/supervisor/apps/{id}               → App deinstallieren
GET    /api/supervisor/system/info             → System-Informationen
```

**Status-Codes:**
| Status | Bedeutung |
|--------|-----------|
| `running` | App läuft (Container aktiv) |
| `stopped` | App gestoppt (Container existiert) |
| `installing` | App wird installiert |
| `error` | Fehler beim Start |

---

## 12. Live-Logs

Jede App hat einen Live-Log-Stream (SSE = Server-Sent Events).

```
GET  /api/apps/{app_id}/logs           → Alle Logs abrufen
GET  /api/apps/{app_id}/logs/stream    → SSE-Live-Stream
```

**SSE-Format:**
```json
// Initialer Snapshot
{ "type": "snapshot", "app_id": "...", "logs": [...] }

// Live-Eintrag
{ "type": "log", "app_id": "...", "entry": {
    "timestamp": "2026-04-29T12:00:00Z",
    "level": "INFO",
    "message": "App gestartet",
    "source": "system"
}}
```

**Log-Level:**
| Level | Farbe (UI) | Bedeutung |
|-------|-----------|-----------|
| `DEBUG` | Grau | Detail-Informationen |
| `INFO` | Blau | Normale Betriebsinformationen |
| `WARNING` | Gelb | Warnungen |
| `ERROR` | Rot | Fehler |
| `CRITICAL` | Rot (fett) | Kritische Fehler |

---

## 12.5 Iframe-Kommunikation (postMessage)

Apps, die in einem Iframe laufen, können über `postMessage` bidirektional mit rumahl kommunizieren.

### Von der App → rumahl (SDK)

Das rumahl Iframe SDK (`rumahl-sdk/iframe.ts`) stellt Methoden bereit:

```javascript
import { createrumahlIframe } from 'rumahl-sdk';

const iframe = createrumahlIframe('meine-app');

// Auf Verbindung warten
await iframe.ready();

// Vollbild anfordern
await iframe.requestFullscreen();

// Vollbild beenden
await iframe.exitFullscreen();

// Toast-Nachricht anzeigen
await iframe.showToast('App wurde aktualisiert', 'success');

// Zu einer Seite navigieren
await iframe.navigateTo('home');

// App-Detail-Dialog öffnen (für den Proxy-Status-Placeholder)
await iframe.call('ui.openAppDetail', 'meine-app');

// Entitäten abfragen
const entities = await iframe.getEntities();

// Entität-Service aufrufen
await iframe.callService('light', 'turn_on', 'light.wohnzimmer');

// Benachrichtigung senden
await iframe.sendNotification('Titel', 'Nachricht', { priority: 'high' });

// Einstellungen lesen/schreiben
const settings = await iframe.getSettings();
await iframe.updateSettings({ theme: 'dark' });

// Storage
await iframe.setStorage('key', { value: 42 });
const data = await iframe.getStorage('key');

// Events abonnieren
const unsubscribe = iframe.on('entity.updated', (event) => {
  console.log('Entity updated:', event.data);
});
```

### Von rumahl → App (Status-Events)

Der App-Proxy-Status-Placeholder sendet Status-Updates:
```javascript
window.parent.postMessage({
  type: 'event',
  event: {
    type: 'app.proxy.status',
    data: { app_id: 'meine-app', status: 'running', name: 'Meine App' }
  }
}, '*');
```

### Unterstützte Methoden (postMessage-API)

| Methode | Parameter | Beschreibung |
|---------|-----------|-------------|
| `auth.requestToken` | `[appId]` | Sicherheitstoken anfordern (automatisch) |
| `ui.requestFullscreen` | – | Vollbildmodus aktivieren |
| `ui.exitFullscreen` | – | Vollbildmodus beenden |
| `ui.showToast` | `[message, type]` | Toast-Nachricht anzeigen (info/success/warning/error) |
| `ui.navigateTo` | `[pageId]` | Zu einer Dashboard-Seite navigieren |
| `ui.openAppDetail` | `[appId]` | App-Detail-Dialog öffnen (vom Proxy-Placeholder verwendet) |
| `entities.list` | – | Alle Entitäten abrufen |
| `entities.get` | `[token, entityId]` | Einzelne Entität abrufen |
| `entities.callService` | `[token, domain, service, entityId, data]` | Service aufrufen |
| `notifications.send` | `[token, payload]` | Benachrichtigung senden |
| `settings.get` | `[token, appId]` | App-Einstellungen abrufen |
| `settings.update` | `[token, appId, settings]` | App-Einstellungen aktualisieren |
| `storage.set` | `[token, key, value]` | Daten speichern |
| `storage.get` | `[token, key]` | Daten abrufen |
| `storage.delete` | `[token, key]` | Daten löschen |

> **Sicherheit:** Die iframe-Sandbox erlaubt `allow-scripts` und `allow-same-origin`. Das rumahl-Frontend validiert die Herkunft der Nachrichten.

### Fehlerbehandlung bei Iframes

Wenn ein Iframe nicht geladen werden kann (App-Container nicht erreichbar):
1. Das IFrameWidget zeigt eine **Fehler-Overlay** mit:
   - Warnsymbol und 

Wenn eine App `custom_pages` im Manifest definiert und gestartet wird, erscheinen diese Seiten automatisch in der rumahl-Navigation.

**Im Manifest:**
```json
{
  "custom_pages": [
    {
      "id": "scanner-dashboard",
      "title": "Network Scanner",
      "icon": "broadcast",
      "url": "/",
      "show_in_nav": true,
      "order": 150
    }
  ]
}
```

**Automatisch generierte Seite:**
Wenn die App gestartet wird, erzeugt rumahl automatisch eine Dashboard-Seite mit einem Iframe-Widget, das auf `/api/apps/{app_id}/proxy/{url}` zeigt.

### 13.2 App-Proxy

Der App-Proxy leitet Anfragen an den laufenden App-Container weiter:
```
GET /api/apps/{app_id}/proxy/{path}
```

**Verhalten:**
- Docker-Modus: Proxied an `http://app-container:{port}/{path}`
- Lokaler Modus: Zeigt Platzhalter-Seite (App als "lokal" markiert)

---

## 14. Berechtigungssystem

### Verfügbare Permissions (v2.2)

| Permission | App | Plugin | Beschreibung |
|-----------|:---:|:------:|-------------|
| `AppStorageRead` | ✅ | ❌ | Storage lesen |
| `AppStorageWrite` | ✅ | ❌ | Storage schreiben |
| `AppStorageDelete` | ✅ | ❌ | Storage löschen |
| `AppStorageManage` | ✅ | ❌ | Storage verwalten |
| `AppDatabaseSqlite` | ✅ | ❌ | SQLite-Datenbank |
| `AppDatabaseManage` | ✅ | ❌ | DB verwalten |
| `AppScheduleCreate` | ✅ | ❌ | Cron-Jobs erstellen |
| `AppScheduleRead` | ✅ | ❌ | Cron-Jobs lesen |
| `AppScheduleUpdate` | ✅ | ❌ | Cron-Jobs aktualisieren |
| `AppScheduleDelete` | ✅ | ❌ | Cron-Jobs löschen |
| `MessagingPublish` | ✅ | ✅ | Nachrichten senden |
| `MessagingSubscribe` | ✅ | ✅ | Nachrichten empfangen |
| `MessagingDirect` | ✅ | ✅ | Direktnachrichten |
| `WebhookCreate` | ✅ | ❌ | Webhooks erstellen |
| `WebhookRead` | ✅ | ❌ | Webhooks lesen |
| `WebhookUpdate` | ✅ | ❌ | Webhooks aktualisieren |
| `WebhookDelete` | ✅ | ❌ | Webhooks löschen |
| `NetworkAccess` | ✅ | ❌ | Netzwerkzugriff (App) |
| `NetworkScan` | ✅ | ❌ | Netzwerk-Scan |
| `ReadEntities` | ✅ | ❌ | HA-Entitäten lesen |
| `ControlEntities` | ✅ | ❌ | HA-Entitäten steuern |
| `SendNotifications` | ✅ | ✅ | Benachrichtigungen senden |

---

## 15. SDK-Referenz (JavaScript)

### Installation
```bash
npm install rumahl-sdk
# oder
yarn add rumahl-sdk
```

### Initialisierung
```javascript
const rumahlClient = require('rumahl-sdk');
// oder: import rumahlClient from 'rumahl-sdk';

const client = new rumahlClient(
  'http://localhost:3001',  // rumahl Backend URL
  'mein-api-key'            // Optional: API-Key
);
client.setAppId('meine-app');
```

### Vollständige API-Übersicht

```javascript
// ── Basis (Entities / HA) ──
client.entities.list()
client.entities.get('light.wohnzimmer')
client.entities.callService({ domain: 'light', service: 'turn_on', entity_id: 'light.wohnzimmer' })
client.entities.turnOn('light.wohnzimmer')
client.entities.turnOff('light.wohnzimmer')

// ── Notifications ──
client.notifications.send({ title: 'Hallo', message: 'Welt', priority: 'high' })
client.notifications.list()

// ── Storage ──
client.storage.set('key', { value: 42 })
client.storage.get('key')
client.storage.delete('key')

// ── App Storage (v2.1) ──
client.appStorage.listFiles()
client.appStorage.uploadFile('config.json', 'eyJ0aGVtZSI6ImRhcmsifQ==', 'application/json')
client.appStorage.getFile('file-uuid')
client.appStorage.deleteFile('file-uuid')
client.appStorage.listKv()
client.appStorage.setKv('user_prefs', { theme: 'dark' })
client.appStorage.getKv('user_prefs')
client.appStorage.deleteKv('user_prefs')
client.appStorage.getUsage()

// ── App Database (v2.1) ──
client.appDatabase.provision({ wal_mode: true, init_sql: ["CREATE TABLE ..."] })
client.appDatabase.status()
client.appDatabase.execute("SELECT * FROM todos")
client.appDatabase.backup()
client.appDatabase.listBackups()
client.appDatabase.drop()

// ── App Scheduler (v2.1) ──
client.appScheduler.list()
client.appScheduler.create({ name: 'job', schedule_type: 'cron', cron_expression: '*/5 * * * *' })
client.appScheduler.get('task-uuid')
client.appScheduler.update('task-uuid', { enabled: false })
client.appScheduler.delete('task-uuid')
client.appScheduler.trigger('task-uuid')
client.appScheduler.getLogs('task-uuid')

// ── App Webhooks (v2.1) ──
client.appWebhooks.list()
client.appWebhooks.create({ name: 'webhook', method: 'POST', target_url: '...' })
client.appWebhooks.get('hook-uuid')
client.appWebhooks.update('hook-uuid', { enabled: false })
client.appWebhooks.delete('hook-uuid')
client.appWebhooks.test('hook-uuid')
client.appWebhooks.getLogs('hook-uuid')

// ── Inter-App Messaging (v2.1) ──
client.appMessaging.publish('notifications', { text: 'Hallo' })
client.appMessaging.subscribe('notifications')
client.appMessaging.listSubscriptions()
client.appMessaging.unsubscribe('sub-uuid')
client.appMessaging.sendDirect('other-app', { hello: true })
client.appMessaging.getInbox()
client.appMessaging.markRead('msg-uuid')

// ── App Config (v2.2) ──
client.appConfig.getSchema()
client.appConfig.get()
client.appConfig.update({ api_key: '...' })
client.appConfig.reset('api_key')

// ── Plugin Execution (v2.2) ──
client.plugins.list()
client.plugins.get('plugin-id')
client.plugins.execute('plugin-id', { name: 'Test' }, 3000)
client.plugins.getLogs('plugin-id')
client.plugins.getSandboxStatus()
```

---

## 16. Vollständige API-Endpoint-Übersicht

### Supervisor (App-Management)
```
GET    /api/supervisor/apps
POST   /api/supervisor/apps/install
GET    /api/supervisor/apps/:app_id
POST   /api/supervisor/apps/:app_id/start
POST   /api/supervisor/apps/:app_id/stop
POST   /api/supervisor/apps/:app_id/restart
DELETE /api/supervisor/apps/:app_id
GET    /api/supervisor/system/info
```

### App Bundle (v2.3)
```
GET    /api/supervisor/apps/:app_id/compose
POST   /api/supervisor/apps/:app_id/bundle/start
POST   /api/supervisor/apps/:app_id/bundle/stop
POST   /api/supervisor/apps/:app_id/bundle/restart
GET    /api/supervisor/apps/:app_id/bundle/status
```

### App Store
```
GET    /api/appstore/installed
POST   /api/appstore/install
GET    /api/appstore/jobs
GET    /api/appstore/jobs/stream     (SSE)
GET    /api/appstore/apps/:app_id
DELETE /api/appstore/apps/:app_id
POST   /api/appstore/apps/:app_id/enable
POST   /api/appstore/apps/:app_id/disable
```

### App Runtime
```
GET    /api/apps/pages
GET    /api/apps/:app_id/detail
GET    /api/apps/:app_id/logs
GET    /api/apps/:app_id/logs/stream  (SSE)
GET    /api/apps/:app_id/proxy/*path
GET    /api/apps/:app_id/config/schema
GET    /api/apps/:app_id/config
PUT    /api/apps/:app_id/config
DELETE /api/apps/:app_id/config/:key
```

### App Storage (v2.1)
```
GET    /api/apps/:app_id/storage/files
POST   /api/apps/:app_id/storage/files
GET    /api/apps/:app_id/storage/files/:file_id
DELETE /api/apps/:app_id/storage/files/:file_id
GET    /api/apps/:app_id/storage/kv
PUT    /api/apps/:app_id/storage/kv/:key
GET    /api/apps/:app_id/storage/kv/:key
DELETE /api/apps/:app_id/storage/kv/:key
GET    /api/apps/:app_id/storage/usage
```

### App Database (v2.1)
```
POST   /api/apps/:app_id/database/provision
DELETE /api/apps/:app_id/database
GET    /api/apps/:app_id/database/status
POST   /api/apps/:app_id/database/execute
POST   /api/apps/:app_id/database/backup
GET    /api/apps/:app_id/database/backups
```

### App Scheduler (v2.1)
```
GET    /api/apps/:app_id/schedules
POST   /api/apps/:app_id/schedules
GET    /api/apps/:app_id/schedules/:task_id
PUT    /api/apps/:app_id/schedules/:task_id
DELETE /api/apps/:app_id/schedules/:task_id
POST   /api/apps/:app_id/schedules/:task_id/trigger
GET    /api/apps/:app_id/schedules/:task_id/logs
```

### App Webhooks (v2.1)
```
GET    /api/apps/:app_id/webhooks
POST   /api/apps/:app_id/webhooks
GET    /api/apps/:app_id/webhooks/:hook_id
PUT    /api/apps/:app_id/webhooks/:hook_id
DELETE /api/apps/:app_id/webhooks/:hook_id
POST   /api/apps/:app_id/webhooks/:hook_id/test
GET    /api/apps/:app_id/webhooks/:hook_id/logs
GET    /api/apps/:app_id/webhooks/:hook_id/stats
```

### Inter-App Messaging (v2.1)
```
GET    /api/apps/messaging/channels
POST   /api/apps/messaging/channels
POST   /api/apps/messaging/publish
GET    /api/apps/messaging/events        (SSE)
POST   /api/apps/:app_id/messaging/subscribe
GET    /api/apps/:app_id/messaging/subscriptions
DELETE /api/apps/:app_id/messaging/subscriptions/:sub_id
POST   /api/apps/:app_id/messaging/direct
GET    /api/apps/:app_id/messaging/inbox
POST   /api/apps/:app_id/messaging/inbox/:msg_id/read
```

### Plugin System (v2.2)
```
GET    /api/core/plugins
GET    /api/core/plugins/with-stats
GET    /api/core/plugins/:id
POST   /api/core/plugins/:id/enable
POST   /api/core/plugins/:id/disable
DELETE /api/core/plugins/:id
POST   /api/core/plugins/:id/execute
GET    /api/core/plugins/:id/logs
GET    /api/core/sandbox/status
```

---

## 17. Datenfluss: App-Installation bis -Ausführung

```
1. ZIP hochladen (Frontend)
   │
   ▼
2. Base64 → API POST /api/appstore/install
   │
   ▼
3. LocalAppStore: ZIP entpacken
   │  ├─ manifest.json parsen
   │  ├─ Dateien in /var/lib/ora/local-apps/{id}/ extrahieren
   │  └─ custom_pages + docker_config aus manifest.extra extrahieren
   │
   ▼
4. App in index.json registrieren (Status: "stopped")
   │
   ▼
5. App "Starten" (Frontend → POST /api/supervisor/apps/{id}/start)
   │
   ├─ Docker verfügbar: Container bauen + starten
   │  └─ Ports zuweisen, Healthcheck starten
   │
   └─ Docker nicht verfügbar (lokal): Status = "running"
      └─ App-Seiten in Navigation registrieren
   │
   ▼
6. App "Öffnen" (Frontend)
   │
   ├─ Docker-Modus: GET /api/apps/{id}/proxy/{path} → Container
   │
   └─ Lokaler Modus: Seite mit Iframe-Widget anzeigen
      └─ URL: /api/apps/{id}/proxy/{path} (Platzhalter)
```

---

## 18. Fehlerbehebung

### App startet nicht
1. Prüfe Docker: `docker ps` – läuft der Docker-Daemon?
2. Prüfe Logs: `GET /api/apps/{app_id}/logs`
3. Prüfe Status: `GET /api/supervisor/apps/{app_id}`
4. Prüfe Manifest: Ist `docker.auto_build` korrekt? Ist `type: "app"` gesetzt?

### Plugin wird nicht ausgeführt
1. Prüfe ob Plugin aktiviert: `POST /api/core/plugins/{id}/enable`
2. Prüfe Einstiegspunkt: Existiert `index.js` oder `main.py` im Plugin-Verzeichnis?
3. Prüfe Sandbox-Config: Ist `max_execution_time_ms` ausreichend?
4. Prüfe Logs: `GET /api/core/plugins/{id}/logs`

### Iframe-Seite zeigt nichts
1. Ist die App gestartet? (Status muss "running" sein)
2. Ist die URL im `custom_pages`-Eintrag korrekt?
3. **Lokaler Modus (kein Docker):** Wenn Docker nicht verfügbar ist (z.B. auf einem Mac-Dev-System), wird der App-Proxy durch eine **Statusseite** ersetzt, die den aktuellen App-Status anzeigt (Läuft/Gestoppt) und eine postMessage-Verbindung zur rumahl-Oberfläche herstellt. Die App-Inhalte können nicht geladen werden – das ist erwartetes Verhalten ohne Docker. Die Statusseite zeigt:
   - Aktuelle App-Status (Läuft/Gestoppt)
   - Erklärtext, warum der Inhalt nicht geladen wird
   - Button zur App-Detail-Seite (öffnet App-Dialog via postMessage)
   - Link zum Admin-Bereich
