# Home Assistant Integration Guide

## rumahl Home Dashboard - HACS Integration

Das rumahl Home Dashboard verfügt über eine offizielle Home Assistant Custom Integration, die über HACS installiert werden kann. Diese Integration ermöglicht eine nahtlose bidirektionale Kommunikation zwischen Home Assistant und dem Dashboard.

## 🎯 Funktionsübersicht

Die Integration bietet folgende Hauptfunktionen:

### 📊 Dashboard-Sensoren
- **Connected Clients**: Anzahl verbundener Dashboard-Clients
- **Last Update**: Zeitstempel der letzten Aktualisierung
- **Dashboard State**: Aktueller Status des Dashboards

### 🔔 Services
- **update_dashboard**: Dashboard-Updates triggern
- **refresh_state**: Dashboard-State neu laden
- **send_notification**: Benachrichtigungen ans Dashboard senden

### ⚡ Events
- **rumahl_home_dashboard_update**: Update-Events vom Dashboard
- **rumahl_home_dashboard_refresh**: Refresh-Anforderungen
- **rumahl_home_dashboard_notification**: Benachrichtigungs-Events

## 📦 Installation über HACS

### Voraussetzungen
- Home Assistant 2023.1.0 oder neuer
- [HACS](https://hacs.xyz/) installiert

### Schritt-für-Schritt Anleitung

1. **HACS öffnen**
   - Navigieren Sie in Home Assistant zu **HACS**

2. **Custom Repository hinzufügen**
   - Klicken Sie auf die drei Punkte (⋮) oben rechts
   - Wählen Sie **"Custom repositories"**
   - Fügen Sie folgende URL hinzu:
     ```
     https://github.com/rumahl/home-assistant-dashb
     ```
   - Kategorie: **Integration**
   - Klicken Sie auf **"Hinzufügen"**

3. **Integration installieren**
   - Suchen Sie nach **"rumahl Home Dashboard"**
   - Klicken Sie auf **"Download"**
   - Starten Sie Home Assistant neu

4. **Integration konfigurieren**
   - Gehen Sie zu **Einstellungen** → **Geräte & Dienste**
   - Klicken Sie auf **"+ Integration hinzufügen"**
   - Suchen Sie nach **"rumahl Home Dashboard"**
   - Folgen Sie dem Konfigurationsassistenten

## ⚙️ Konfiguration

### UI-Konfiguration (empfohlen)

Die Integration kann komplett über die Home Assistant UI konfiguriert werden:

**Einstellungen**:
- **Name**: Eindeutiger Name für die Integration
- **Dashboard URL**: Optional - URL des Dashboards für direkte Kommunikation
- **Webhooks aktivieren**: Aktiviert Event-basierte Kommunikation
- **Sensoren aktivieren**: Aktiviert Dashboard-Monitoring-Sensoren

### YAML-Konfiguration (optional)

Für erweiterte Konfigurationen kann auch `configuration.yaml` verwendet werden:

```yaml
rumahl_home_dashboard:
  dashboard_url: "http://rumahl.local:5173"  # Optional
  enable_webhooks: true                    # Default: true
```

## 🔌 Dashboard-Anbindung

### Backend-Integration

Wenn Sie den Rust-Backend verwenden, fügen Sie in der Backend-Konfiguration hinzu:

```env
# .env im backend/ Ordner
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token
```

### Frontend-Integration

Im Dashboard können Sie auf die Integration zugreifen:

```typescript
// src/lib/integrations/haIntegration.ts
import { haService } from '@/lib/homeAssistant'

// Event-Listener für Integration-Events
export function setupIntegrationListeners() {
  // Subscribe zu Dashboard-Updates
  haService.subscribeEvents((event) => {
    if (event.event_type === 'rumahl_home_dashboard_update') {
      handleDashboardUpdate(event.data)
    }

    if (event.event_type === 'rumahl_home_dashboard_notification') {
      showNotification(event.data)
    }

    if (event.event_type === 'rumahl_home_dashboard_refresh') {
      refreshDashboard()
    }
  }, 'rumahl_home_dashboard_*')
}

async function handleDashboardUpdate(data: any) {
  const { entity_id, data: updateData } = data
  console.log('Dashboard update received:', entity_id, updateData)
  // Handle update in dashboard
}

async function showNotification(data: any) {
  const { message, title, type } = data
  // Show toast notification
  toast[type](message, { description: title })
}

async function refreshDashboard() {
  // Reload entity states
  await haService.getStates()
}
```

## 📝 Verwendungsbeispiele

### 1. Benachrichtigung bei Türöffnung

```yaml
automation:
  - alias: "Dashboard: Türbenachrichtigung"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door
        to: "on"
    action:
      - service: rumahl_home_dashboard.send_notification
        data:
          message: "Haustür wurde geöffnet"
          title: "Sicherheit"
          type: "warning"
```

### 2. Dashboard-Update bei Wetteränderung

```yaml
automation:
  - alias: "Dashboard: Wetter-Update"
    trigger:
      - platform: state
        entity_id: weather.home
    action:
      - service: rumahl_home_dashboard.update_dashboard
        data:
          entity_id: weather.home
          data:
            temperature: "{{ state_attr('weather.home', 'temperature') }}"
            condition: "{{ states('weather.home') }}"
```

### 3. Täglicher Dashboard-Refresh

```yaml
automation:
  - alias: "Dashboard: Morgendliche Aktualisierung"
    trigger:
      - platform: time
        at: "07:00:00"
    action:
      - service: rumahl_home_dashboard.refresh_state
      - service: rumahl_home_dashboard.send_notification
        data:
          message: "Guten Morgen! Dashboard wurde aktualisiert."
          type: "success"
```

### 4. Status-Monitoring

```yaml
automation:
  - alias: "Dashboard: Status überwachen"
    trigger:
      - platform: state
        entity_id: sensor.rumahl_home_dashboard_dashboard_state
        to: "disconnected"
    action:
      - service: notify.mobile_app
        data:
          message: "Dashboard ist nicht mehr verbunden"
```

## 🔧 Erweiterte Funktionen

### Custom Services in Automationen

Die Integration kann mit anderen Services kombiniert werden:

```yaml
script:
  dashboard_scene_activate:
    sequence:
      # 1. Szene aktivieren
      - service: scene.turn_on
        target:
          entity_id: scene.movie_night

      # 2. Dashboard benachrichtigen
      - service: rumahl_home_dashboard.send_notification
        data:
          message: "Film-Szene aktiviert"
          type: "info"

      # 3. Dashboard aktualisieren
      - service: rumahl_home_dashboard.update_dashboard
        data:
          entity_id: scene.movie_night
          data:
            state: "activated"
```

### Event-basierte Kommunikation

Erstellen Sie Automationen, die auf Dashboard-Events reagieren:

```yaml
automation:
  - alias: "HA: Dashboard Event Handler"
    trigger:
      - platform: event
        event_type: rumahl_home_dashboard_update
    condition:
      - condition: template
        value_template: "{{ trigger.event.data.entity_id == 'light.living_room' }}"
    action:
      - service: light.turn_on
        target:
          entity_id: light.living_room
        data:
          brightness: "{{ trigger.event.data.data.brightness }}"
```

## 🐛 Problemlösung

### Integration nicht gefunden

**Problem**: Integration erscheint nicht in der Liste

**Lösung**:
1. Home Assistant neu starten
2. HACS-Cache leeren: **HACS** → **⋮** → **"Custom repositories"** → Repository entfernen und neu hinzufügen
3. Logs prüfen: **Einstellungen** → **System** → **Protokolle**

### Sensoren zeigen keine Daten

**Problem**: Dashboard-Sensoren bleiben auf "unknown"

**Lösung**:
1. Dashboard muss laufen und erreichbar sein
2. Dashboard-URL in der Konfiguration prüfen
3. Webhooks müssen aktiviert sein
4. Firewall-Regeln prüfen

### Services funktionieren nicht

**Problem**: Service-Aufrufe haben keine Wirkung

**Lösung**:
1. Event-Listener im Dashboard prüfen (siehe Frontend-Integration oben)
2. Service-Syntax in Developer Tools testen
3. Logs auf Fehler prüfen

## 📚 API-Referenz

### Verfügbare Sensoren

| Sensor | Entity ID | Beschreibung |
|--------|-----------|--------------|
| Connected Clients | `sensor.rumahl_home_dashboard_connected_clients` | Anzahl verbundener Clients |
| Last Update | `sensor.rumahl_home_dashboard_last_update` | Zeitstempel der letzten Aktualisierung |
| Dashboard State | `sensor.rumahl_home_dashboard_dashboard_state` | Status: active, idle, disconnected |

### Service-Parameter

#### `rumahl_home_dashboard.update_dashboard`
```yaml
entity_id: string (required)  # Entity die aktualisiert werden soll
data: object (optional)        # Zusätzliche Update-Daten
```

#### `rumahl_home_dashboard.send_notification`
```yaml
message: string (required)     # Benachrichtigungstext
title: string (optional)       # Titel (default: "rumahl Home Dashboard")
type: string (optional)        # Typ: info, warning, error, success
```

### Event-Datenstruktur

#### `rumahl_home_dashboard_update`
```json
{
  "entity_id": "light.living_room",
  "data": {
    "brightness": 255,
    "color_temp": 370
  }
}
```

#### `rumahl_home_dashboard_notification`
```json
{
  "message": "System-Update verfügbar",
  "title": "rumahl Home Dashboard",
  "type": "info"
}
```

## 🔗 Weitere Ressourcen

- [Integration README](custom_components/rumahl_home_dashboard/README.md)
- [Backend Documentation](backend/README.md)
- [Plugin Guide](PLUGIN_GUIDE.md)
- [Architecture Overview](ARCHITECTURE.md)

## 🆘 Support

Bei Problemen oder Fragen:
1. [GitHub Issues](https://github.com/rumahl/home-assistant-dashb/issues)
2. [Discussions](https://github.com/rumahl/home-assistant-dashb/discussions)
3. Integration README: `custom_components/rumahl_home_dashboard/README.md`
