import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  House,
  Cpu,
  Brain,
  CaretRight,
  CaretLeft,
  MagnifyingGlass,
  Gear,
  Lightning,
  Plugs,
  VideoCamera,
  Shield,
  Keyboard,
  Layout,
  Palette,
  Users,
  Globe,
  Robot,
  Broadcast,
  HardDrive,
  ArrowSquareOut,
  Info,
} from '@phosphor-icons/react'

// ─── rumahl Documentation Content ────────────────────────────────────────

interface DocArticle {
  id: string
  title: string
  icon: typeof BookOpen
  category: string
  content: string
}

interface DocCategory {
  id: string
  title: string
  subtitle: string
  icon: typeof BookOpen
  color: string
}

const DOC_CATEGORIES: DocCategory[] = [
  {
    id: 'rumahl-overview',
    title: 'rumahl Plattform',
    subtitle: 'Überblick & Architektur',
    icon: Globe,
    color: 'oklch(0.65 0.20 210)',
  },
  {
    id: 'rumahl-core',
    title: 'rumahl Core',
    subtitle: 'Systemkern & Backend',
    icon: Cpu,
    color: 'oklch(0.65 0.18 160)',
  },
  {
    id: 'rumahl-home',
    title: 'rumahl Home',
    subtitle: 'Smart Home & Geräte',
    icon: House,
    color: 'oklch(0.65 0.18 50)',
  },
  {
    id: 'rumahl-assist',
    title: 'rumahl Assist',
    subtitle: 'KI & Automatisierung',
    icon: Brain,
    color: 'oklch(0.65 0.18 300)',
  },
  {
    id: 'ui',
    title: 'Oberfläche',
    subtitle: 'Dashboard & Widgets',
    icon: Layout,
    color: 'oklch(0.65 0.15 230)',
  },
  {
    id: 'admin',
    title: 'Administration',
    subtitle: 'Sicherheit & Verwaltung',
    icon: Shield,
    color: 'oklch(0.65 0.15 25)',
  },
]

const DOC_ARTICLES: DocArticle[] = [
  // ── rumahl Overview ──
  {
    id: 'what-is-rumahl',
    title: 'Was ist rumahl?',
    icon: Globe,
    category: 'rumahl-overview',
    content: `# Was ist rumahl?

**rumahl** steht für **Interface for Optimized Residential Autonomy** — ein eigenständiges Ökosystem zur intelligenten Verwaltung deines Zuhauses und darüber hinaus.

rumahl ist kein einfaches Dashboard. Es ist ein **Betriebssystem für dein Zuhause**, das alle Aspekte der Hausautomation, Kommunikation und intelligenten Steuerung in einer einheitlichen Plattform vereint.

## Die drei Säulen von rumahl

### 🔧 rumahl Core
Das Fundament des Systems. rumahl Core ist der Systemkern, der alle Dienste koordiniert:
- **Backend-Server** (Rust/Axum) für maximale Performance
- **Echtzeitkommunikation** über WebSocket
- **Datenbankmanagement** (SQLite) für Konfigurationen und History
- **API-Gateway** für alle internen und externen Dienste
- **Streaming-Server** für Live-Video und Medien

### 🏠 rumahl Home
Die Smart-Home-Zentrale. rumahl Home verbindet sich mit Home Assistant und erweitert dessen Funktionalität:
- **Gerätesteuerung** – Lichter, Klima, Schalter, Sensoren und mehr
- **Szenen & Automatisierung** – Intelligente Abläufe und Zeitpläne
- **Protokoll-Integration** – MQTT, Zigbee, Z-Wave, Matter, BLE, HomeKit
- **Energieüberwachung** – Verbrauch und Statistiken
- **NINA-Warnungen** – Nationale Warnsystem-Integration

### 🤖 rumahl Assist
Die KI-Schicht von rumahl. rumahl Assist bietet intelligente Unterstützung:
- **Entity Watchdog** – Automatische Überwachung und Reaktion
- **Composite Sensors** – Berechnete Sensoren aus mehreren Quellen
- **Anomalie-Erkennung** – Erkennt ungewöhnliche Muster
- **Smart Scenes** – Kontextabhängige Szenarios mit Bedingungen
- **Scheduled Actions** – Zeitgesteuerte Automatisierungen

## Warum rumahl?

| Feature | Klassisches Dashboard | rumahl |
|---------|----------------------|------|
| Gerätesteuerung | ✅ | ✅ |
| Multi-User & Rollen | ❌ | ✅ |
| Live Streaming | ❌ | ✅ |
| KI-Unterstützung | ❌ | ✅ |
| Eigene Widget-Seiten | ❌ | ✅ |
| Protokoll-übergreifend | ❌ | ✅ |
| API & Webhooks | ❌ | ✅ |`,
  },
  {
    id: 'architecture',
    title: 'Architektur & Komponenten',
    icon: HardDrive,
    category: 'rumahl-overview',
    content: `# rumahl Architektur

## Systemübersicht

\`\`\`
┌─────────────────────────────────────────┐
│              rumahl Frontend              │
│         (React + TypeScript)            │
├─────────────────────────────────────────┤
│              rumahl Core                  │
│     (Rust/Axum Backend Server)          │
│  ┌──────────┬──────────┬──────────┐     │
│  │ REST API │ WebSocket│ Streaming│     │
│  └──────────┴──────────┴──────────┘     │
├─────────────────────────────────────────┤
│  rumahl Home          │    rumahl Assist    │
│  ┌────────────┐     │  ┌─────────────┐  │
│  │    Home    │     │  │  Watchdog   │  │
│  │  Assistant │     │  │  Scheduler  │  │
│  │ Integration│     │  │  Analytics  │  │
│  └────────────┘     │  └─────────────┘  │
│  ┌────────────┐     │  ┌─────────────┐  │
│  │   MQTT     │     │  │  Composite  │  │
│  │   Zigbee   │     │  │   Sensors   │  │
│  │   Z-Wave   │     │  │  Anomaly    │  │
│  │   Matter   │     │  │  Detection  │  │
│  └────────────┘     │  └─────────────┘  │
└─────────────────────────────────────────┘
\`\`\`

## Technologie-Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Rust, Axum 0.7, Tokio async runtime
- **Datenbank:** SQLite via sqlx
- **Echtzeit:** WebSocket (nativ + broadcast channels)
- **HA-Integration:** REST API + WebSocket zu Home Assistant
- **Streaming:** WebSocket-basierter Frame-Relay-Server
- **Auth:** JWT + API-Keys + PIN-Login

## Kommunikationswege

1. **Frontend ↔ Core:** REST API (CRUD) + WebSocket (Echtzeit-Updates)
2. **Core ↔ Home Assistant:** REST API + persistent WebSocket
3. **Core ↔ Protokolle:** MQTT, Zigbee, Z-Wave via native Clients
4. **Core → Streaming:** WebSocket Ingest/Watch Channels
5. **Core → Webhooks:** HTTP POST mit HMAC-SHA256 Signaturen`,
  },
  {
    id: 'getting-started',
    title: 'Erste Schritte',
    icon: Lightning,
    category: 'rumahl-overview',
    content: `# Erste Schritte mit rumahl

## Voraussetzungen

- **Home Assistant** Installation (Version 2023.1.0+)
- **Node.js** 18+ (für das Frontend)
- **Rust** toolchain (für das Backend)
- Ein moderner Browser (Chrome, Firefox, Safari, Edge)

## Installation

### 1. Backend starten
\`\`\`bash
cd backend
cargo run
\`\`\`
Der rumahl Core Server startet auf Port **3001**.

### 2. Frontend starten
\`\`\`bash
npm install
npm run dev
\`\`\`
Das Frontend ist unter **http://localhost:5173** erreichbar.

### 3. Home Assistant verbinden
Konfiguriere die Verbindung zu deiner Home Assistant Instanz über die Umgebungsvariablen:
- \`HA_URL\` – URL deiner Home Assistant Instanz
- \`HA_TOKEN\` – Long-Lived Access Token

### 4. Ersten Benutzer anlegen
Beim ersten Start wirst du aufgefordert, einen Administrator-Account zu erstellen. Dieser hat Zugriff auf alle Systemeinstellungen.

## Nächste Schritte

- **Seiten gestalten** → Öffne den Page Designer in den Einstellungen
- **Widgets hinzufügen** → Wähle aus 80+ Widget-Typen
- **Szenen erstellen** → Automatisiere dein Smart Home
- **Streaming einrichten** → Integriere OBS für Live-Übertragungen`,
  },

  // ── rumahl Core ──
  {
    id: 'core-backend',
    title: 'Backend-Server',
    icon: Cpu,
    category: 'rumahl-core',
    content: `# rumahl Core – Backend

Der rumahl Core Backend-Server ist das Herzstück des Systems, geschrieben in **Rust** mit dem **Axum** Framework für maximale Performance und Zuverlässigkeit.

## Funktionen

### REST API
Über 100 API-Endpunkte für:
- Authentifizierung & Benutzerverwaltung
- Entity-Steuerung & History
- Konfigurationsmanagement
- System-Monitoring
- Integration-Steuerung

### WebSocket Server
- **\`/ws\`** – Haupt-WebSocket für Entity-Updates und Service-Calls
- **\`/ws/realtime\`** – Namespace-basierter Echtzeit-Kanal
- **\`/ws/stream/ingest\`** – Stream-Quelle (OBS, Kameras)
- **\`/ws/stream/watch\`** – Stream-Viewer (Dashboard)

### SSE Event Streams
- **\`/api/events/stream\`** – Filterbare Entity-Events
- **\`/api/events/system\`** – System-Events

### Service Call Buffer
Intelligentes Batching von Service-Aufrufen:
- Erster Aufruf wird sofort gesendet
- Nachfolgende Aufrufe werden zusammengefasst
- Ideal für Slider-Steuerungen (z.B. Helligkeit)

## API-Dokumentation
Die vollständige API-Dokumentation ist unter **\`/api/docs\`** (Swagger UI) verfügbar.`,
  },
  {
    id: 'core-streaming',
    title: 'Streaming-Server',
    icon: VideoCamera,
    category: 'rumahl-core',
    content: `# rumahl Streaming — Einfach Live gehen

rumahl hat einen integrierten Streaming-Server. Du kannst **Video**, **Audio** oder **beides** direkt aus dem Browser streamen — ohne OBS, ohne Skripte, ohne Konfiguration.

## So geht's (3 Schritte)

### 1. Streaming-Seite öffnen
Klicke in der Navigation auf **Streaming** (📹-Icon) oder öffne \`/streaming\` im Browser.

### 2. Modus wählen
- **Video + Audio** — Kamera und Mikrofon zusammen
- **Nur Video** — Nur Kamerabild, kein Ton
- **Nur Audio** — Nur Mikrofon, kein Bild

### 3. „Stream starten" klicken
Fertig. Der Browser fragt nach Kamera-/Mikrofon-Berechtigung, dann ist der Stream live.

## Stream im Dashboard anzeigen

1. Öffne den **Page Designer** (Einstellungen → Dashboard)
2. Füge das **Live Stream** Widget hinzu (Kategorie: Standalone → Media)
3. Das Widget findet den aktiven Stream automatisch

Das Widget zeigt:
- **LIVE-Indikator** wenn aktiv
- **Zuschauer-Anzahl** in Echtzeit
- **Vollbild-Modus**
- **Stream-Auswahl** bei mehreren Streams

## Einstellungen

In der Streaming-Seite kannst du vor dem Start anpassen:
- **Kamera** — Zwischen verfügbaren Kameras wechseln
- **Mikrofon** — Audio-Eingangsgerät wählen
- **Qualität** — 480p, 720p oder 1080p
- **FPS** — 15, 24 oder 30 Bilder pro Sekunde

## Standalone Sender (für OBS oder zweiten PC)

Für fortgeschrittene Setups kannst du die Standalone-Sender-Seite nutzen:

1. Öffne \`http://dein-server:3001/api/streams/sender\` in einem Browser
2. Oder nutze sie als **Browser Source** in OBS

Die Standalone-Seite funktioniert identisch — Modus wählen, starten, fertig. Sie kann auf einem anderen Gerät im Netzwerk geöffnet werden.

## Externe Kamera-Streams

Für bestehende IP-Kameras oder RTMP-Quellen:

\`\`\`bash
POST /api/streams
{
  "name": "Haustür-Kamera",
  "source_type": "external_url",
  "source_url": "http://192.168.1.100:8080/stream.mjpg"
}
\`\`\`

## Technische Details

Der Streaming-Server arbeitet als **WebSocket-Relay**:

\`\`\`
Sender (Browser) → rumahl Core → Dashboard Widget
   Frames            Relay         Frames
\`\`\`

- Frames werden als JPEG über WebSocket gesendet
- Audio wird als WebM/Opus-Chunks übertragen
- Der Server verteilt alles in Echtzeit an alle Viewer
- Kein RTMP, kein FFmpeg, kein externer Server nötig

## Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| Kein Kamerabild | Browser-Berechtigung prüfen (Adressleiste → Kamera-Icon) |
| Kein Audio | Mikrofon-Berechtigung prüfen, richtiges Gerät in Einstellungen wählen |
| Hohe Latenz | Qualität oder FPS reduzieren |
| Kein Signal im Widget | Prüfe ob der Stream auf der Streaming-Seite aktiv ist |
| Stream bricht ab | Seite nicht schließen/minimieren während des Streams |`,
  },
  {
    id: 'core-api-keys',
    title: 'API-Schlüssel & Webhooks',
    icon: Keyboard,
    category: 'rumahl-core',
    content: `# API-Schlüssel & Webhooks

## API-Schlüssel

rumahl unterstützt API-Schlüssel für programmatischen Zugriff:

1. **Erstellen:** Einstellungen → Admin Panel → API Keys
2. **Verwenden:** Header \`X-API-Key: dein-schlüssel\`
3. **Berechtigungen:** Gleiche Rechte wie der zugehörige Benutzer

## Webhooks

Registriere Webhooks, um bei Events benachrichtigt zu werden:

### Webhook erstellen
\`\`\`bash
POST /api/webhooks
{
  "url": "https://dein-server.de/webhook",
  "events": ["state_changed", "config_changed"],
  "secret": "dein-geheimnis"
}
\`\`\`

### Sicherheit
- Alle Webhook-Payloads werden mit **HMAC-SHA256** signiert
- Signatur im Header \`X-Webhook-Signature\`
- Delivery-Log mit Retry-Mechanismus`,
  },

  // ── rumahl Home ──
  {
    id: 'home-entities',
    title: 'Geräte & Entitäten',
    icon: Plugs,
    category: 'rumahl-home',
    content: `# Geräte & Entitäten

rumahl Home integriert sich nahtlos mit Home Assistant und erweitert dessen Gerätesteuerung.

## Unterstützte Domains

| Domain | Beschreibung | Widget |
|--------|-------------|--------|
| \`light\` | Lichter & Lampen | LightWidget |
| \`climate\` | Heizung & Klima | ClimateWidget |
| \`switch\` | Schalter | SwitchWidget |
| \`sensor\` | Sensoren | SensorWidget |
| \`cover\` | Rollläden & Markisen | CoverWidget |
| \`fan\` | Ventilatoren | FanWidget |
| \`lock\` | Türschlösser | LockWidget |
| \`media_player\` | Mediengeräte | MediaPlayerWidget |
| \`camera\` | Kameras | CameraWidget |
| \`vacuum\` | Saugroboter | VacuumWidget |
| \`alarm_control_panel\` | Alarmanlagen | AlarmWidget |

## Entity-Suche

Über die API können Entitäten gesucht und gefiltert werden:
\`\`\`
GET /api/entities/search?q=wohnzimmer
GET /api/entities/domain/light
GET /api/entities/count
\`\`\`

## Entity History

rumahl speichert Zustandsänderungen lokal für schnellen Zugriff auf Statistiken und Diagramme, unabhängig von der Home Assistant History.`,
  },
  {
    id: 'home-protocols',
    title: 'Protokoll-Integration',
    icon: Broadcast,
    category: 'rumahl-home',
    content: `# Protokoll-Integration

rumahl Home unterstützt direkte Kommunikation mit verschiedenen Smart-Home-Protokollen.

## MQTT
- Direkte Verbindung zu einem MQTT Broker
- Topic-basierte Steuerung
- Integration mit Zigbee2MQTT, Tasmota, etc.

## Zigbee
- Zigbee-Netzwerk Management
- Gerätekopplung und -verwaltung
- Integration über Zigbee2MQTT

## Z-Wave
- Z-Wave Controller-Anbindung
- Netzwerk-Healing und Optimierung
- Node-Management

## Matter
- Matter-Protokoll Unterstützung
- Thread-Netzwerk Integration
- Geräte-Commissioning

## BLE (Bluetooth Low Energy)
- BLE-Geräteerkennung
- Proximity-basierte Automatisierung

## HomeKit
- HomeKit Bridge für iOS-Integration
- Automatische Geräteveröffentlichung
- Siri-Steuerung über Bridge`,
  },
  {
    id: 'home-scenes',
    title: 'Szenen & Automatisierung',
    icon: Lightning,
    category: 'rumahl-home',
    content: `# Szenen & Automatisierung

## Smart Scenes

rumahl Smart Scenes gehen weit über HA-Szenen hinaus:

### Sequenzen
Führe Aktionen nacheinander aus mit konfigurierbaren Verzögerungen:
\`\`\`json
{
  "steps": [
    { "domain": "light", "service": "turn_on", "entity_id": "light.wohnzimmer", "data": {"brightness": 255} },
    { "delay_ms": 2000 },
    { "domain": "light", "service": "turn_on", "entity_id": "light.flur", "data": {"brightness": 128} }
  ]
}
\`\`\`

### Bedingungen
Schritte nur ausführen, wenn bestimmte Bedingungen erfüllt sind:
\`\`\`json
{
  "condition": {
    "entity_id": "binary_sensor.anwesenheit",
    "state": "on"
  }
}
\`\`\`

## Entity Scheduler
Plane Aktionen für einen bestimmten Zeitpunkt:
\`\`\`bash
POST /api/integration/schedules
{
  "entity_id": "light.terrasse",
  "domain": "light",
  "service": "turn_off",
  "run_at_unix": 1700000000
}
\`\`\``,
  },

  // ── rumahl Assist ──
  {
    id: 'assist-watchdog',
    title: 'Entity Watchdog',
    icon: Shield,
    category: 'rumahl-assist',
    content: `# rumahl Assist – Entity Watchdog

Der Entity Watchdog überwacht automatisch den Zustand deiner Geräte und führt bei Problemen Aktionen aus.

## Funktionsweise

1. **Regeln definieren:** Welche Entität soll überwacht werden?
2. **Bedingungen festlegen:** Wann soll reagiert werden?
3. **Aktionen konfigurieren:** Was soll passieren?

## Beispiel: Offline-Erkennung

\`\`\`bash
POST /api/integration/watchdogs
{
  "entity_id": "sensor.temperatur_aussen",
  "condition": "unavailable",
  "timeout_seconds": 300,
  "action": {
    "type": "notification",
    "message": "Außensensor ist offline!"
  }
}
\`\`\`

## Verfügbare Aktionen

- **Benachrichtigung** – Push-Notification im Dashboard
- **Service Call** – HA Service ausführen
- **Webhook** – Externen Dienst benachrichtigen
- **Logging** – In Warning Log eintragen

## Dashboard

Aktive Watchdogs werden im rumahl Assist-Bereich der Admin-Oberfläche angezeigt.`,
  },
  {
    id: 'assist-composite',
    title: 'Composite Sensors',
    icon: Brain,
    category: 'rumahl-assist',
    content: `# rumahl Assist – Composite Sensors

Composite Sensors sind virtuelle Sensoren, die aus mehreren Entitäten berechnet werden.

## Konzept

Während Home Assistant Templates begrenzt sind, berechnet rumahl Core Composite Sensors direkt auf dem Backend mit Zugriff auf den Entity-Cache — schnell und zuverlässig.

## Beispiel: Durchschnittstemperatur

\`\`\`bash
POST /api/integration/composite
{
  "sensor_id": "avg_temperature",
  "name": "Durchschnittstemperatur",
  "formula": "avg",
  "entities": [
    "sensor.temperatur_wohnzimmer",
    "sensor.temperatur_schlafzimmer",
    "sensor.temperatur_kueche"
  ],
  "unit": "°C"
}
\`\`\`

## Verfügbare Formeln

- **avg** – Durchschnitt aller Werte
- **sum** – Summe
- **min** / **max** – Minimal-/Maximalwert
- **diff** – Differenz zwischen zwei Sensoren
- **custom** – Eigene JavaScript-ähnliche Ausdrücke`,
  },
  {
    id: 'assist-analytics',
    title: 'Analytics & Anomalien',
    icon: Robot,
    category: 'rumahl-assist',
    content: `# rumahl Assist – Analytics

rumahl Assist sammelt und analysiert Daten, um Muster zu erkennen und Anomalien zu detektieren.

## Analytics Dashboard

Zugriff auf Statistiken über die Integration API:
\`\`\`
GET /api/integration/analytics/top
GET /api/integration/analytics/entity/{entity_id}
GET /api/integration/analytics/history
\`\`\`

## Anomalie-Erkennung

rumahl Assist erkennt automatisch ungewöhnliche Muster:
- **Unerwartete Zustandsänderungen** außerhalb normaler Zeiten
- **Stale Entities** – Geräte, die keine Updates mehr senden
- **Wertausreißer** – Sensorwerte außerhalb des üblichen Bereichs

## Health Reports

Regelmäßige Systemgesundheitsberichte:
\`\`\`
GET /api/integration/health
\`\`\`

Enthält:
- Entity-Verfügbarkeitsrate
- Durchschnittliche Antwortzeiten
- Protokoll-Status
- Empfehlungen zur Optimierung`,
  },

  // ── UI ──
  {
    id: 'ui-widgets',
    title: 'Widgets & Seiten',
    icon: Layout,
    category: 'ui',
    content: `# Widgets & Seiten

rumahl bietet über **80 Widget-Typen** und einen visuellen Page Designer.

## Widget-Kategorien

### Geräte-Widgets
Direkte Steuerung von Smart-Home-Geräten:
- Lichter, Schalter, Klimaanlagen, Rollläden, Schlösser, Ventilatoren
- Mediaplayer, Kameras, Saugroboter, Alarmanlagen

### Standalone-Widgets
Kein Gerät erforderlich:
- **Begrüßung** – Personalisierte Willkommensnachricht
- **Uhren** – Analog & Digital
- **Kalender** – Termine aus Home Assistant
- **Live Stream** – rumahl Streaming Server
- **Karte** – Geräte-Standorte
- **IFrame** – Externe Websites einbetten
- **System-Monitor** – CPU, RAM, Uptime

### Premium-Widgets
- **Entity History** – Verlaufsdiagramme
- **Statistik-Charts** – Erweiterte Datenvisualisierung
- **Energie-Monitor** – Verbrauchsübersicht
- **NINA Warnungen** – Bundesweite Warnmeldungen

## Page Designer

1. Öffne **Einstellungen → Dashboard → Page Designer**
2. Erstelle neue Seiten mit eigenem Icon und Reihenfolge
3. Platziere Widgets im Raster
4. Konfiguriere jedes Widget individuell
5. Setze pro Seite eigene Hintergründe und Card-Styles`,
  },
  {
    id: 'ui-themes',
    title: 'Themes & Darstellung',
    icon: Palette,
    category: 'ui',
    content: `# Themes & Darstellung

## Automatische Themes

rumahl wechselt den Theme basierend auf der Tageszeit:
- **Day** – Heller Modus für tagsüber
- **Evening** – Warme Töne für den Abend
- **Night** – Dunkler Modus mit Blaulichtfilter
- **Sleep** – Minimaler Modus mit extremer Dimmung

## Glass-Morphism

Individuell einstellbar:
- **Blur** – Hintergrundunschärfe
- **Radius** – Eckenrundung
- **Border Alpha** – Randtransparenz

## Akzentfarbe

- **Auto** – Wird aus dem Hintergrundbild extrahiert
- **Manuell** – Eigene Farbe wählen

## Per-Page Overrides

Jede Seite kann eigene Darstellungseinstellungen haben:
- Eigener Hintergrund
- Eigener Card-Style
- Eigenes CSS
- Header ausblenden
- Individueller Padding-Wert

## Global CSS

Für fortgeschrittene Anpassungen:
- **Global CSS** – Gilt für alle Benutzer
- **User CSS** – Nur für den aktuellen Benutzer
- **Page CSS** – Nur für eine bestimmte Seite`,
  },

  // ── Administration ──
  {
    id: 'admin-users',
    title: 'Benutzerverwaltung',
    icon: Users,
    category: 'admin',
    content: `# Benutzerverwaltung

## Multi-User System

rumahl unterstützt mehrere Benutzer mit unterschiedlichen Rollen:

### Rollen
- **Admin** – Voller Zugriff auf alle Einstellungen und Admin-Panel
- **User** – Zugriff auf Dashboard und persönliche Einstellungen

### Authentifizierung
- **JWT Token** – Für Standard-Login
- **PIN-Login** – Schneller Benutzerwechsel (4-6 Ziffern)
- **API-Key** – Für programmatischen Zugriff
- **Geräte-Sperre** – Einstellungen pro Gerät sperren

## Quick-Login

Für Kiosk-Setups (Tablet an der Wand):
1. Erstelle PINs für jeden Benutzer
2. Tippe den PIN auf dem User-Switcher
3. Sofortiger Kontextwechsel ohne Passwort

## Geräte-Terminal-Modus

Geräte können in den Terminal-Modus versetzt werden:
- Einstellungen werden gesperrt
- Nur Dashboard-Interaktion möglich
- Ideal für gemeinsam genutzte Tablets`,
  },
  {
    id: 'admin-security',
    title: 'Sicherheit',
    icon: Shield,
    category: 'admin',
    content: `# Sicherheit

## Authentifizierung

- **Passwörter** werden mit bcrypt gehasht
- **JWT-Tokens** mit konfigurierbarer Ablaufzeit
- **API-Keys** mit HMAC-SHA256 Signierung
- **PIN-Hashes** separat gespeichert

## Netzwerk

- CORS-Konfiguration für API-Zugriff
- WebSocket-Authentifizierung
- Rate-Limiting für Service-Calls (30/Sekunde pro Client)

## Wartungsmodus

Admins können den Wartungsmodus aktivieren:
- Nicht-Admin-Benutzer sehen einen Wartungsbildschirm
- API bleibt für Admins erreichbar
- Nachricht individuell konfigurierbar

## Best Practices

1. Verwende starke Passwörter für Admin-Accounts
2. Erstelle separate API-Keys pro Anwendung
3. Aktiviere den Geräte-Sperr-Modus für öffentliche Tablets
4. Überprüfe regelmäßig die Webhook-Deliveries
5. Halte Home Assistant und rumahl aktuell`,
  },
]

// ─── Component ──────────────────────────────────────────────────────────

export function DocsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const currentCategory = DOC_CATEGORIES.find(c => c.id === selectedCategory)
  const currentArticle = DOC_ARTICLES.find(a => a.id === selectedArticle)

  const filteredArticles = useMemo(() => {
    if (!searchQuery.trim()) return DOC_ARTICLES
    const q = searchQuery.toLowerCase()
    return DOC_ARTICLES.filter(
      a => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)
    )
  }, [searchQuery])

  const categoryArticles = useMemo(() => {
    if (!selectedCategory) return []
    return filteredArticles.filter(a => a.category === selectedCategory)
  }, [selectedCategory, filteredArticles])

  // Render markdown-like content (simplified)
  const renderContent = (content: string) => {
    const lines = content.split('\n')
    const elements: ReactNode[] = []
    let inCodeBlock = false
    let codeContent: string[] = []
    let codeLanguage = ''
    let inTable = false
    let tableRows: string[][] = []
    let tableHeader: string[] = []

    const processInline = (text: string) => {
      // Bold, inline code, links
      const parts: (string | ReactNode)[] = []
      let remaining = text
      let keyIdx = 0

      while (remaining.length > 0) {
        // Code
        const codeMatch = remaining.match(/`([^`]+)`/)
        // Bold
        const boldMatch = remaining.match(/\*\*([^*]+)\*\*/)

        const matches = [
          codeMatch ? { type: 'code' as const, index: codeMatch.index!, match: codeMatch } : null,
          boldMatch ? { type: 'bold' as const, index: boldMatch.index!, match: boldMatch } : null,
        ].filter(Boolean).sort((a, b) => a!.index - b!.index)

        if (matches.length === 0) {
          parts.push(remaining)
          break
        }

        const first = matches[0]!
        if (first.index > 0) {
          parts.push(remaining.slice(0, first.index))
        }

        if (first.type === 'code') {
          parts.push(
            <code key={keyIdx++} className="px-1.5 py-0.5 rounded bg-foreground/8 text-[0.85em] font-mono text-accent/80">
              {first.match[1]}
            </code>
          )
        } else if (first.type === 'bold') {
          parts.push(<strong key={keyIdx++} className="font-semibold text-foreground">{first.match[1]}</strong>)
        }

        remaining = remaining.slice(first.index + first.match[0].length)
      }
      return parts
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Code blocks
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <pre key={i} className="my-3 p-4 rounded-xl bg-black/30 border border-foreground/8 overflow-x-auto">
              <code className="text-xs font-mono text-foreground/80 leading-relaxed whitespace-pre">
                {codeContent.join('\n')}
              </code>
            </pre>
          )
          codeContent = []
          inCodeBlock = false
        } else {
          inCodeBlock = true
          codeLanguage = line.slice(3)
        }
        continue
      }

      if (inCodeBlock) {
        codeContent.push(line)
        continue
      }

      // Table
      if (line.includes('|') && line.trim().startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim())
        if (!inTable) {
          inTable = true
          tableHeader = cells
          continue
        }
        // Skip separator row
        if (cells.every(c => /^[-:]+$/.test(c))) continue
        tableRows.push(cells)
        // Check if next line is not a table
        if (i + 1 >= lines.length || !lines[i + 1].trim().startsWith('|')) {
          elements.push(
            <div key={i} className="my-3 overflow-x-auto rounded-xl border border-foreground/8">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-foreground/5">
                    {tableHeader.map((h, j) => (
                      <th key={j} className="px-3 py-2 text-left font-medium text-foreground/60 uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri} className="border-t border-foreground/5">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-foreground/70">{processInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          inTable = false
          tableRows = []
          tableHeader = []
        }
        continue
      }

      // Headers
      if (line.startsWith('# ')) {
        elements.push(<h1 key={i} className="text-2xl font-bold text-foreground mt-2 mb-4">{line.slice(2)}</h1>)
        continue
      }
      if (line.startsWith('## ')) {
        elements.push(<h2 key={i} className="text-lg font-semibold text-foreground mt-6 mb-3 flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-accent/40" />
          {line.slice(3)}
        </h2>)
        continue
      }
      if (line.startsWith('### ')) {
        elements.push(<h3 key={i} className="text-sm font-semibold text-foreground mt-4 mb-2">{processInline(line.slice(4))}</h3>)
        continue
      }

      // List items
      if (line.match(/^- /)) {
        elements.push(
          <div key={i} className="flex items-start gap-2.5 ml-2 my-1">
            <div className="w-1 h-1 rounded-full bg-foreground/30 mt-[7px] shrink-0" />
            <p className="text-sm text-foreground/70 leading-relaxed">{processInline(line.slice(2))}</p>
          </div>
        )
        continue
      }

      // Numbered list
      const numMatch = line.match(/^(\d+)\. (.+)/)
      if (numMatch) {
        elements.push(
          <div key={i} className="flex items-start gap-2.5 ml-2 my-1">
            <span className="text-[10px] font-bold text-accent/60 mt-[3px] shrink-0 w-4 text-right">{numMatch[1]}.</span>
            <p className="text-sm text-foreground/70 leading-relaxed">{processInline(numMatch[2])}</p>
          </div>
        )
        continue
      }

      // Empty line
      if (!line.trim()) {
        elements.push(<div key={i} className="h-2" />)
        continue
      }

      // Regular paragraph
      elements.push(<p key={i} className="text-sm text-foreground/70 leading-relaxed my-1">{processInline(line)}</p>)
    }

    return elements
  }

  // Article view
  if (currentArticle) {
    return (
      <div className="glass-card rounded-2xl p-5 sm:p-6 page-transition-enter">
        <div className="space-y-4">
          <button
            onClick={() => setSelectedArticle(null)}
            className="flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground/70 transition-colors group"
          >
            <CaretLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
            {currentCategory?.title || 'Zurück'}
          </button>

          <div className="rounded-xl bg-foreground/[0.04] border border-foreground/8 p-5 sm:p-8">
            {renderContent(currentArticle.content)}
          </div>
        </div>
      </div>
    )
  }

  // Category view
  if (selectedCategory && currentCategory) {
    return (
      <div className="glass-card rounded-2xl p-5 sm:p-6 page-transition-enter">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedCategory(null)}
            className="flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground/70 transition-colors group"
          >
            <CaretLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
            Dokumentation
          </button>
        </div>

        {/* Category Header */}
        <div className="rounded-2xl p-5 border border-foreground/8" style={{ background: `linear-gradient(135deg, ${currentCategory.color}15, transparent)` }}>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${currentCategory.color}20` }}>
              <currentCategory.icon size={22} weight="duotone" style={{ color: currentCategory.color }} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{currentCategory.title}</h2>
              <p className="text-xs text-foreground/50">{currentCategory.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Articles */}
        <div className="space-y-2">
          {categoryArticles.map((article) => (
            <motion.button
              key={article.id}
              onClick={() => setSelectedArticle(article.id)}
              className="w-full flex items-center gap-3 p-4 rounded-xl bg-foreground/[0.03] border border-foreground/8 hover:bg-foreground/[0.06] hover:border-foreground/12 transition-all text-left group"
              whileTap={{ scale: 0.99 }}
            >
              <div className="w-9 h-9 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0">
                <article.icon size={18} weight="duotone" className="text-foreground/50 group-hover:text-accent transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{article.title}</p>
              </div>
              <CaretRight size={16} className="text-foreground/25 group-hover:text-foreground/50 group-hover:translate-x-0.5 transition-all shrink-0" />
            </motion.button>
          ))}
          {categoryArticles.length === 0 && (
            <p className="text-sm text-foreground/40 text-center py-8">Keine Artikel in dieser Kategorie</p>
          )}
        </div>
      </div>
      </div>
    )
  }

  // Main overview
  const searchResults = searchQuery.trim() ? filteredArticles : []

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 page-transition-enter">
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <BookOpen size={22} weight="duotone" className="text-accent" />
            rumahl Dokumentation
          </h3>
          <p className="text-xs text-foreground/40 mt-1">Anleitungen, Referenzen & Systemübersicht</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/30" />
        <input
          type="text"
          placeholder="Dokumentation durchsuchen..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-foreground/[0.04] border border-foreground/8 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/30 focus:bg-foreground/[0.06] transition-all"
        />
      </div>

      {/* Search Results */}
      <AnimatePresence mode="wait">
        {searchQuery.trim() && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-2"
          >
            <p className="text-xs text-foreground/40 px-1">{searchResults.length} Ergebnis{searchResults.length !== 1 ? 'se' : ''}</p>
            {searchResults.map((article) => {
              const cat = DOC_CATEGORIES.find(c => c.id === article.category)
              return (
                <button
                  key={article.id}
                  onClick={() => {
                    setSelectedCategory(article.category)
                    setSelectedArticle(article.id)
                    setSearchQuery('')
                  }}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-foreground/[0.03] border border-foreground/8 hover:bg-foreground/[0.06] transition-all text-left group"
                >
                  <article.icon size={16} weight="duotone" className="text-foreground/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{article.title}</p>
                    <p className="text-[10px] text-foreground/35">{cat?.title}</p>
                  </div>
                  <CaretRight size={14} className="text-foreground/20 shrink-0" />
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* rumahl System Overview Card */}
      {!searchQuery.trim() && (
        <>
          <div className="rounded-2xl overflow-hidden border border-foreground/8">
            <div className="p-5 sm:p-6" style={{ background: 'linear-gradient(135deg, oklch(0.65 0.20 210 / 0.08), oklch(0.65 0.18 300 / 0.05), transparent)' }}>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <Globe size={26} weight="duotone" className="text-accent" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">rumahl Ökosystem</h2>
                  <p className="text-xs text-foreground/50 leading-relaxed">
                    Interface for Optimized Residential Autonomy — dein Betriebssystem für intelligentes Wohnen.
                    Drei Module arbeiten zusammen, um dein Zuhause autonom, sicher und komfortabel zu gestalten.
                  </p>
                </div>
              </div>

              {/* Three pillars */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
                <button
                  onClick={() => setSelectedCategory('rumahl-core')}
                  className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 hover:bg-foreground/[0.07] transition-all text-left group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Cpu size={16} weight="duotone" style={{ color: 'oklch(0.65 0.18 160)' }} />
                    <span className="text-xs font-semibold text-foreground">rumahl Core</span>
                  </div>
                  <p className="text-[10px] text-foreground/40 leading-relaxed">Systemkern, API, Streaming, Datenbank</p>
                </button>
                <button
                  onClick={() => setSelectedCategory('rumahl-home')}
                  className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 hover:bg-foreground/[0.07] transition-all text-left group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <House size={16} weight="duotone" style={{ color: 'oklch(0.65 0.18 50)' }} />
                    <span className="text-xs font-semibold text-foreground">rumahl Home</span>
                  </div>
                  <p className="text-[10px] text-foreground/40 leading-relaxed">Smart Home, Geräte, Protokolle</p>
                </button>
                <button
                  onClick={() => setSelectedCategory('rumahl-assist')}
                  className="p-3.5 rounded-xl bg-foreground/[0.04] border border-foreground/8 hover:bg-foreground/[0.07] transition-all text-left group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Brain size={16} weight="duotone" style={{ color: 'oklch(0.65 0.18 300)' }} />
                    <span className="text-xs font-semibold text-foreground">rumahl Assist</span>
                  </div>
                  <p className="text-[10px] text-foreground/40 leading-relaxed">KI, Watchdog, Analytics, Automation</p>
                </button>
              </div>
            </div>
          </div>

          {/* Category Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {DOC_CATEGORIES.map((cat) => {
              const articleCount = DOC_ARTICLES.filter(a => a.category === cat.id).length
              return (
                <motion.button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className="p-4 rounded-xl bg-foreground/[0.03] border border-foreground/8 hover:bg-foreground/[0.06] hover:border-foreground/12 transition-all text-left group"
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${cat.color}15` }}>
                      <cat.icon size={18} weight="duotone" style={{ color: cat.color }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{cat.title}</p>
                      <p className="text-[10px] text-foreground/40">{cat.subtitle}</p>
                    </div>
                    <CaretRight size={14} className="text-foreground/20 group-hover:text-foreground/40 group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="text-[10px] text-foreground/30 ml-12">{articleCount} Artikel</p>
                </motion.button>
              )
            })}
          </div>
        </>
      )}
    </div>
    </div>
  )
}

export default DocsPage
