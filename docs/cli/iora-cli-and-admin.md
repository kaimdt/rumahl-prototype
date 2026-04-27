# IORA Admin Center & CLI Tool - Implementation

## Implementiert (Done in commit 06c7dfa)

### 1. `iora` CLI Tool ✓

Ein vollständiges Command-Line Interface für IORA OS wurde erstellt:

**Binary**: `iora` (installiert nach `/usr/local/bin/iora`)

#### Verfügbare Befehle:

**System Management:**
```bash
iora system info               # Systeminformationen anzeigen
iora system resources          # CPU, RAM, Disk anzeigen
iora system version            # IORA OS Version
iora system reboot             # System neu starten
iora system shutdown           # System herunterfahren
```

**Service Management:**
```bash
iora service list              # Alle Services auflisten
iora service start <name>      # Service starten
iora service stop <name>       # Service stoppen
iora service restart <name>    # Service neu starten
iora service status <name>     # Service Status anzeigen
iora service logs <name>       # Service Logs anzeigen
```

**Container Management:**
```bash
iora container list            # Alle Container auflisten
iora container start <name>    # Container starten
iora container stop <name>     # Container stoppen
iora container restart <name>  # Container neu starten
iora container logs <name> -f  # Container Logs (follow)
iora container stats           # Container Statistiken
```

**Plugin Management:**
```bash
iora plugin list               # Installierte Plugins auflisten
iora plugin install <plugin>   # Plugin installieren
iora plugin remove <name>      # Plugin entfernen
iora plugin info <name>        # Plugin Information
iora plugin enable <name>      # Plugin aktivieren
iora plugin disable <name>     # Plugin deaktivieren
```

**Logs & Monitoring:**
```bash
iora logs system -f            # System Logs (follow)
iora logs service <name> -f    # Service Logs (follow)
iora status                    # Gesamtstatus anzeigen
iora status --verbose          # Detaillierter Status
```

**Security & Secrets:**
```bash
iora security status           # Security Status
iora security alerts           # Security Alerts
iora security secrets          # Secrets auflisten
iora security add-secret <name> --stdin  # Secret hinzufügen
```

**Updates:**
```bash
iora update --check            # Nach Updates suchen
iora update                    # Updates installieren
```

#### Features:

- ✅ **Farbige Terminal-Ausgabe** - Übersichtliche, farbcodierte Darstellung
- ✅ **Tabellen-Formatierung** - Listen werden als Tabellen dargestellt
- ✅ **Interaktive Bestätigungen** - Schutz vor versehentlichen Aktionen
- ✅ **REST API Integration** - Kommuniziert mit allen IORA Services
- ✅ **Systemd Integration** - Verwendet systemctl und journalctl
- ✅ **Shell Completion** - Unterstützung für Autocomplete

#### Technische Details:

- **Sprache**: Rust
- **CLI Framework**: clap v4 mit derive macros
- **HTTP Client**: reqwest (async)
- **Tabellen**: tabled crate
- **Farben**: colored crate
- **Dialog**: dialoguer crate
- **Kommunikation**:
  - iora-supervisor API (Port 8097) für Container Management
  - iora-core API (Port 8090) für Services & Plugins
  - iora-security API (Port 8095) für Security
  - iora-secrets API (Port 8093) für Secrets
  - systemctl für System-Befehle
  - journalctl für Logs

## Noch zu implementieren (TODO)

### 2. Admin Center Erweiterungen

Neue Tabs im IORA Home Admin Panel hinzufügen:

#### OS Management Tab
- System Info (Version, Uptime, Hardware)
- RAUC Updates (Check, Install, Rollback)
- System Controls (Reboot, Shutdown)
- Partition Info (A/B Partitions)

#### Container Management Tab
- Liste aller Container (Status, Image, Uptime)
- Start/Stop/Restart Buttons
- Logs Viewer (Echtzeit)
- Resource Usage (CPU, RAM)
- Update Containers (Pull & Recreate)

#### Plugin Management Tab
- Installierte Plugins Liste
- Plugin Installation (Upload/URL)
- Plugin Configuration
- Enable/Disable Plugins
- Plugin Marketplace (zukünftig)

### 3. API Endpoints

Neue Endpoints in iora-home für Frontend:

```typescript
// OS Management
GET  /api/admin/os/info
GET  /api/admin/os/version
POST /api/admin/os/reboot
POST /api/admin/os/shutdown
GET  /api/admin/os/updates
POST /api/admin/os/update

// Container Management (Proxy zu Supervisor)
GET  /api/admin/containers
POST /api/admin/containers/:name/start
POST /api/admin/containers/:name/stop
POST /api/admin/containers/:name/restart
GET  /api/admin/containers/:name/logs

// Plugin Management (Proxy zu Core)
GET  /api/admin/plugins
POST /api/admin/plugins
DELETE /api/admin/plugins/:id
GET  /api/admin/plugins/:id/config
POST /api/admin/plugins/:id/enable
POST /api/admin/plugins/:id/disable
```

## Verwendung

### CLI Tool Beispiele:

```bash
# Übersicht über das ganze System
iora status --verbose

# Service neu starten
iora service restart iora-home

# Container Logs live ansehen
iora container logs iora-supervisor -f

# Plugin installieren
iora plugin install https://github.com/example/iora-weather-plugin

# Secret hinzufügen
echo "my-secret-value" | iora security add-secret MY_API_KEY --stdin

# System neu starten
iora system reboot
```

### Admin Center Navigation:

Nach Implementierung:
1. IORA Home öffnen
2. Admin Center (Zahnrad-Icon)
3. Neue Tabs sichtbar:
   - **OS Management** - System-Steuerung
   - **Containers** - Docker Container Management
   - **Plugins** - Plugin Verwaltung

## Installation

### CLI Tool installieren:

```bash
# In IORA OS:
cd backend
cargo build --release -p iora-cli
sudo cp target/release/iora /usr/local/bin/
sudo chmod +x /usr/local/bin/iora

# Testen:
iora --version
iora status
```

### Shell Completion (optional):

```bash
# Für Bash:
iora --generate-completion bash > /etc/bash_completion.d/iora

# Für Zsh:
iora --generate-completion zsh > ~/.zfunc/_iora

# Für Fish:
iora --generate-completion fish > ~/.config/fish/completions/iora.fish
```

## Commit

Commit 06c7dfa: `feat: add iora CLI tool for system management`

Alles ready für die nächste Phase (Admin Center UI).
