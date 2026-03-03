# MDT HOME Dashboard - Home Assistant Integration

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
[![GitHub Release](https://img.shields.io/github/release/kaimdt/home-assistant-dashb.svg)](https://github.com/kaimdt/home-assistant-dashb/releases)
[![License](https://img.shields.io/github/license/kaimdt/home-assistant-dashb.svg)](LICENSE)

Die offizielle Home Assistant Custom Integration für das MDT HOME Dashboard. Diese Integration ermöglicht eine nahtlose Verbindung zwischen Home Assistant und dem MDT HOME Dashboard mit erweiterten Funktionen und bidirektionaler Kommunikation.

## 🌟 Features

- **🔄 Bidirektionale Kommunikation** - Synchronisation zwischen Dashboard und Home Assistant
- **📊 Dashboard Sensoren** - Überwachung des Dashboard-Status in Home Assistant
- **🔔 Benachrichtigungen** - Sende Benachrichtigungen direkt an das Dashboard
- **⚡ Events & Webhooks** - Echtzeit-Updates und Event-Handling
- **🎨 Custom Services** - Erweiterte Steuerungsmöglichkeiten
- **🔧 UI-Konfiguration** - Einfache Einrichtung über die Home Assistant UI
- **📱 HACS-kompatibel** - Installation mit einem Klick über HACS

## 📦 Installation

### Via HACS (empfohlen)

1. Öffnen Sie HACS in Ihrer Home Assistant Instanz
2. Klicken Sie auf "Integrationen"
3. Klicken Sie auf die drei Punkte oben rechts
4. Wählen Sie "Custom repositories"
5. Fügen Sie diese URL hinzu: `https://github.com/kaimdt/home-assistant-dashb`
6. Wählen Sie die Kategorie "Integration"
7. Klicken Sie auf "Hinzufügen"
8. Suchen Sie nach "MDT HOME Dashboard"
9. Klicken Sie auf "Download"
10. Starten Sie Home Assistant neu

### Manuelle Installation

1. Laden Sie die neueste Version von den [Releases](https://github.com/kaimdt/home-assistant-dashb/releases) herunter
2. Entpacken Sie das Archiv
3. Kopieren Sie den Ordner `custom_components/mdt_home_dashboard` in Ihr `custom_components` Verzeichnis
4. Starten Sie Home Assistant neu

## ⚙️ Konfiguration

### Über die UI (empfohlen)

1. Gehen Sie zu **Einstellungen** → **Geräte & Dienste**
2. Klicken Sie auf **+ Integration hinzufügen**
3. Suchen Sie nach **"MDT HOME Dashboard"**
4. Folgen Sie dem Konfigurationsassistenten:
   - **Name**: Ein Name für Ihre Dashboard-Integration
   - **Dashboard URL** (optional): URL Ihres Dashboards
   - **Webhooks aktivieren**: Aktiviert Webhook-Support
   - **Sensoren aktivieren**: Aktiviert Dashboard-Sensoren

### Über configuration.yaml (optional)

```yaml
mdt_home_dashboard:
  dashboard_url: "http://localhost:5173"
  enable_webhooks: true
```

## 📊 Sensoren

Die Integration erstellt folgende Sensoren:

### `sensor.mdt_home_dashboard_connected_clients`
Anzahl der verbundenen Dashboard-Clients

### `sensor.mdt_home_dashboard_last_update`
Zeitstempel der letzten Dashboard-Aktualisierung

### `sensor.mdt_home_dashboard_dashboard_state`
Aktueller Status des Dashboards
- **Zustände**: `active`, `idle`, `disconnected`, `unknown`
- **Attribute**:
  - `connected_clients`: Anzahl verbundener Clients
  - `last_update`: Zeitstempel der letzten Aktualisierung

## 🛠️ Services

### `mdt_home_dashboard.update_dashboard`

Sendet ein Update an das Dashboard.

**Parameter**:
- `entity_id` (erforderlich): Die zu aktualisierende Entity
- `data` (optional): Zusätzliche Daten für das Update

**Beispiel**:
```yaml
service: mdt_home_dashboard.update_dashboard
data:
  entity_id: light.living_room
  data:
    brightness: 255
    color_temp: 370
```

### `mdt_home_dashboard.refresh_state`

Fordert das Dashboard auf, seinen Status zu aktualisieren.

**Beispiel**:
```yaml
service: mdt_home_dashboard.refresh_state
```

### `mdt_home_dashboard.send_notification`

Sendet eine Benachrichtigung an das Dashboard.

**Parameter**:
- `message` (erforderlich): Benachrichtigungstext
- `title` (optional): Benachrichtigungstitel
- `type` (optional): Benachrichtigungstyp (`info`, `warning`, `error`, `success`)

**Beispiel**:
```yaml
service: mdt_home_dashboard.send_notification
data:
  message: "System-Update verfügbar"
  title: "MDT HOME Dashboard"
  type: "info"
```

## 🔔 Events

Die Integration feuert folgende Events:

### `mdt_home_dashboard_update`
Wird gefeuert, wenn ein Dashboard-Update angefordert wird.

**Event-Daten**:
```json
{
  "entity_id": "light.living_room",
  "data": {
    "brightness": 255
  }
}
```

### `mdt_home_dashboard_refresh`
Wird gefeuert, wenn ein State-Refresh angefordert wird.

### `mdt_home_dashboard_notification`
Wird gefeuert, wenn eine Benachrichtigung gesendet wird.

**Event-Daten**:
```json
{
  "message": "System-Update verfügbar",
  "title": "MDT HOME Dashboard",
  "type": "info"
}
```

## 📝 Automationsbeispiele

### Dashboard-Benachrichtigung bei niedrigem Batteriestand

```yaml
automation:
  - alias: "Dashboard: Batterie niedrig"
    trigger:
      - platform: numeric_state
        entity_id: sensor.smoke_detector_battery
        below: 20
    action:
      - service: mdt_home_dashboard.send_notification
        data:
          message: "Batterie des Rauchmelders ist niedrig ({{ states('sensor.smoke_detector_battery') }}%)"
          title: "Batteriewarnung"
          type: "warning"
```

### Dashboard aktualisieren bei Lichtänderung

```yaml
automation:
  - alias: "Dashboard: Licht aktualisieren"
    trigger:
      - platform: state
        entity_id: light.living_room
    action:
      - service: mdt_home_dashboard.update_dashboard
        data:
          entity_id: "{{ trigger.entity_id }}"
          data:
            state: "{{ trigger.to_state.state }}"
            brightness: "{{ state_attr(trigger.entity_id, 'brightness') }}"
```

### Tägliche Dashboard-Aktualisierung

```yaml
automation:
  - alias: "Dashboard: Tägliche Aktualisierung"
    trigger:
      - platform: time
        at: "00:00:00"
    action:
      - service: mdt_home_dashboard.refresh_state
```

## 🔗 Dashboard-Integration

Um das Dashboard mit dieser Integration zu verbinden, fügen Sie folgenden Code in Ihr Dashboard ein:

```typescript
// Dashboard Event-Listener
import { homeAssistant } from '@/lib/homeAssistant'

// Event-Listener für Updates
homeAssistant.subscribeEvents((event) => {
  if (event.event_type === 'mdt_home_dashboard_update') {
    const { entity_id, data } = event.data
    // Handle update
    console.log('Dashboard update:', entity_id, data)
  }

  if (event.event_type === 'mdt_home_dashboard_notification') {
    const { message, title, type } = event.data
    // Show notification in dashboard
    showNotification(title, message, type)
  }

  if (event.event_type === 'mdt_home_dashboard_refresh') {
    // Refresh dashboard state
    refreshDashboardState()
  }
}, 'mdt_home_dashboard_*')
```

## 🐛 Fehlerbehebung

### Integration wird nicht gefunden

1. Stellen Sie sicher, dass Sie Home Assistant neu gestartet haben
2. Überprüfen Sie, ob der `custom_components` Ordner korrekt ist
3. Prüfen Sie die Logs auf Fehler: **Einstellungen** → **System** → **Protokolle**

### Sensoren zeigen keine Daten

1. Überprüfen Sie, ob das Dashboard läuft
2. Prüfen Sie die Dashboard-URL in der Konfiguration
3. Stellen Sie sicher, dass Webhooks aktiviert sind

### Services funktionieren nicht

1. Überprüfen Sie die Service-Aufrufe in den Developer Tools
2. Prüfen Sie die Logs auf Fehler
3. Stellen Sie sicher, dass das Dashboard die Events empfängt

## 📚 Weitere Ressourcen

- [MDT HOME Dashboard Repository](https://github.com/kaimdt/home-assistant-dashb)
- [Dashboard Dokumentation](https://github.com/kaimdt/home-assistant-dashb/blob/main/README.md)
- [Issue Tracker](https://github.com/kaimdt/home-assistant-dashb/issues)
- [Plugin Guide](https://github.com/kaimdt/home-assistant-dashb/blob/main/PLUGIN_GUIDE.md)

## 🤝 Mitwirken

Beiträge sind willkommen! Bitte lesen Sie die [Contribution Guidelines](https://github.com/kaimdt/home-assistant-dashb/blob/main/CONTRIBUTING.md).

## 📄 Lizenz

MIT License - siehe [LICENSE](LICENSE) für Details.

## ⭐ Support

Wenn Ihnen diese Integration gefällt, geben Sie dem Repository einen Stern auf GitHub!
