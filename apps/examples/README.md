# IORA Example Apps

> Beispiel-Anwendungen und Plugins zur Demonstration der IORA-Funktionen

## Verfügbare Beispiele

### 1. Themed Weather App
**Pfad:** `themed-weather-app/`

Demonstriert das IORA Theme-System:
- Theme Inheritance von IORA
- Custom CSS Variables
- Dynamische Theme-Updates
- Interaktive Farbänderungen
- Variable Inspector

**Features:**
- ☀️ Wetter-Widget mit Theme-Integration
- 🎨 Custom Wetter-Farben (sunny, cloudy, rainy, stormy)
- 🔄 Echtzeit Theme-Synchronisation
- 🎛️ Interaktive Theme-Kontrollen
- 📊 Live CSS Variable Viewer

**Lernziele:**
- Verwendung des `IoraThemeClient`
- CSS Variable Overrides
- PostMessage-basierte Theme-Kommunikation
- Responsive Design mit Theme-Variablen

[→ Zur App](./themed-weather-app/)

### 2. Weather App (Basic)
**Pfad:** `weather-app/`

Einfache Wetter-App ohne Theme-System (Legacy-Beispiel).

### 3. Network Scanner App
**Pfad:** `network-scanner-app/`

Rust-basierte App für Netzwerk-Scanning.

### 4. Notification Plugin
**Pfad:** `notification-plugin/`

Rust-basiertes Plugin für System-Benachrichtigungen.

### 5. Energy Optimizer Plugin
**Pfad:** `energy-optimizer-plugin/`

TypeScript-basiertes Plugin für Energie-Optimierung.

## Kategorien

### Apps (Docker Container)
- `themed-weather-app/` - Theme-System Demo
- `weather-app/` - Basic Weather App
- `network-scanner-app/` - Network Scanner (Rust)

### Plugins (Runtime Sandbox)
- `notification-plugin/` - Notifications (Rust)
- `energy-optimizer-plugin/` - Energy Optimizer (TS)

## Installation

### Einzelne App installieren:

1. Kopiere den App-Ordner nach `/var/lib/iora/apps/installed/`
2. Öffne den IORA App Store
3. Die App erscheint automatisch in der Liste
4. Klicke auf "Installieren"

### Alle Beispiele installieren:

```bash
# Alle Beispiele kopieren
sudo cp -r apps/examples/* /var/lib/iora/apps/installed/

# IORA neu starten (damit Apps erkannt werden)
sudo systemctl restart iora-home
```

## Entwicklung

### Neue Beispiel-App erstellen:

1. Erstelle einen neuen Ordner: `apps/examples/my-app/`
2. Erstelle `manifest.json` (siehe [App Development Guide](../../docs/development/app-development.md))
3. Entwickle deine App (HTML/JS, React, oder Docker-Container)
4. Teste lokal mit `cp -r my-app /var/lib/iora/apps/installed/`
5. Erstelle eine README.md mit Erklärungen

### Beispiel-Struktur:

```
my-app/
├── manifest.json       # App-Manifest (PFLICHT)
├── index.html          # Entry Point (für Web-Apps)
├── Dockerfile          # Für Container-Apps
├── package.json        # Für Node.js-Apps
├── README.md           # Dokumentation
└── assets/            # Optional: Bilder, Styles, etc.
```

## Best Practices

### 1. Theme-Integration
✅ **DO:** Verwende IORA CSS-Variablen für konsistente UI
```css
.my-element {
  background: var(--card);
  color: var(--foreground);
  border: 1px solid var(--border);
}
```

❌ **DON'T:** Hartkodierte Farben verwenden
```css
.my-element {
  background: #1e2230;
  color: #ffffff;
}
```

### 2. Permissions
✅ **DO:** Nur benötigte Permissions anfordern
```json
{
  "permissions": ["DeviceRead"]
}
```

❌ **DON'T:** Alle Permissions anfordern
```json
{
  "permissions": ["*"]
}
```

### 3. Dokumentation
✅ **DO:** README mit Features, Installation, API-Nutzung
❌ **DON'T:** Keine Dokumentation

### 4. Manifest
✅ **DO:** Vollständige Metadaten (Name, Version, Developer, Icon)
❌ **DON'T:** Minimales Manifest ohne Beschreibung

## Testing

### Lokales Testing:

```bash
# 1. App nach installed/ kopieren
sudo cp -r my-app /var/lib/iora/apps/installed/

# 2. IORA neu starten
sudo systemctl restart iora-home

# 3. Logs überprüfen
journalctl -u iora-home -f

# 4. App im Browser testen
# http://localhost:8126/
```

### Docker Testing:

```bash
# In App-Verzeichnis
docker build -t my-app .
docker run -p 8080:8080 my-app

# Test: http://localhost:8080
```

## Ressourcen

### Dokumentation
- [App Development Guide](../../docs/development/app-development.md)
- [Plugin Development Guide](../../docs/development/plugin-development.md)
- [App Theming Guide](../../docs/development/app-theming.md)
- [Permissions System](../../docs/security/permissions.md)

### SDKs
- [JavaScript/TypeScript SDK](../../sdks/javascript/)
- [Go SDK](../../sdks/go/)
- [C++ SDK](../../sdks/cpp/)
- [PHP SDK](../../sdks/php/)

### Tools
- [IORA CLI](../../iora-os/backend/tools/iora-cli/)
- [App Signing](../../iora-os/backend/tools/iora-sign/)
- [App Verification](../../iora-os/backend/tools/iora-verify/)

## Support

- **GitHub Issues:** [https://github.com/iora/iora/issues](https://github.com/iora/iora/issues)
- **Dokumentation:** [https://docs.iora.io](https://docs.iora.io)
- **Community:** [https://community.iora.io](https://community.iora.io)

## Lizenz

Alle Beispiel-Apps sind unter der MIT-Lizenz verfügbar und können frei verwendet, modifiziert und verteilt werden.
