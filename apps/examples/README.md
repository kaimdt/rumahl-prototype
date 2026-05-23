# IORA Example Apps

> Beispiel-Anwendungen, Plugins und Themes zur Demonstration der IORA-Funktionen

## Ordnerstruktur

```
apps/examples/
├── themes/             # 11 Theme-Plugins
├── apps/               # 6 Beispiel-Apps
├── plugins/            # 2 Funktions-Plugins
└── README.md
```

## Themes (11)

Jedes Theme ist ein Plugin vom Typ `plugin_type: "theme"` und enthält:
- `manifest.json` – Theme-Metadaten & Capabilities
- `css/theme.css` – Theme-Variablen & Styles
- `js/theme.js` – Theme-Logik & Mode-Switching
- `build.sh` / `build.ps1` – Build-Script zum Erstellen einer `.zip`-Distribution

| Theme | Beschreibung |
|-------|-------------|
| `cyberpunk-neon` | Neon-Pink/Cyan, CRT-Scanlines, Glitch-Effekte |
| `forest-cabin` | Warme Holztöne, Waldgrün, Laternenlicht |
| `full-layout-theme` | Dreispaltiges Profi-Layout (HTML-Template) |
| `material-sidebar-theme` | Material Design mit Sidebar & Ripple-Effekten |
| `monochrome-pro` | Graustufen-Design, barrierefrei & produktiv |
| `nordic-light` | Skandinavischer Minimalismus, helle Cremetöne |
| `ocean-theme` | Tiefblaues Ozean-Theme mit Wellen-Animationen |
| `sidebar-theme` | Minimalistisches Dark-Theme mit CSS-Sidebar |
| `steampunk-theme` | Viktorianisch mit Messing, Zahnrädern & Dampf |
| `synthwave-sunset` | 80s-Retro-Outrun, Neon auf Sonnenuntergang |
| `terminal-theme` | Unix-Shell-Look, Monospace, grüner Cursor |

[→ Alle Themes](./themes/)

## Apps (6)

Apps laufen in Docker-Containern und bieten vollständige UIs oder Backend-Dienste.

| App | Beschreibung |
|-----|-------------|
| `themed-weather-app` | Theme-System Demo mit CSS-Variablen & Live-Viewer |
| `weather-app` | Einfache Wetter-App (Legacy, ohne Theme) |
| `network-scanner-app` | Netzwerk-Scanner (Rust, Docker) |
| `home-assistant-bundle` | HA Core + PostgreSQL + MQTT Bundle |
| `idle-game` | Idle-Settlement-Spiel mit Prestige-System |
| `macro-tracker` | Makro-Tracker mit SQLite-Datenbank |

[→ Alle Apps](./apps/)

## Plugins (2)

Funktions-Plugins laufen in der IORA-Runtime-Sandbox.

| Plugin | Beschreibung |
|--------|-------------|
| `notification-plugin` | Benachrichtigungs-Formatierer (Rust) |
| `energy-optimizer-plugin` | Energie-Optimierung mit AI (TypeScript) |

[→ Alle Plugins](./plugins/)

## Installation

### Build: .zip erstellen

Jedes Theme, jede App und jedes Plugin enthält Build-Scripts:

```bash
# Linux / macOS
cd themes/cyberpunk-neon
./build.sh
# Erstellt: cyberpunk-neon-v1.0.0.zip
```

```powershell
# Windows PowerShell
cd themes\cyberpunk-neon
.\build.ps1
# Erstellt: cyberpunk-neon-v1.0.0.zip
```

Die `.zip`-Datei kann dann im IORA App Store installiert werden.

### Einzelne App/Plugin/Theme installieren:

1. Baue die `.zip`-Datei mit `build.sh` oder `build.ps1`
2. Öffne den IORA App Store
3. Klicke auf "Aus Datei installieren" und wähle die `.zip`-Datei
4. Alternativ: Entpacke nach `/var/lib/iora/apps/installed/`

### Alle Beispiele installieren:

```bash
# Alle .zip-Dateien bauen
for dir in themes/*/ apps/*/ plugins/*/; do
  (cd "$dir" && ./build.sh)
done

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
├── build.sh            # Build-Script (Linux/macOS)
├── build.ps1           # Build-Script (Windows)
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
