# rumahl Admin Center & CLI Tool - Implementation

## Implementiert (Done in commit 06c7dfa)

### 1. `ora` CLI Tool ✓

Ein vollständiges Command-Line Interface für rumahl OS wurde erstellt:

**Binary**: `ora` (installiert nach `/usr/local/bin/ora`)

#### Verfügbare Befehle:

**System Management:**
```bash
ora system info               # Systeminformationen anzeigen
ora system resources          # CPU, RAM, Disk anzeigen
ora system version            # rumahl OS Version
ora system reboot             # System neu starten
ora system shutdown           # System herunterfahren
```

**Service Management:**
```bash
ora service list              # Alle Services auflisten
ora service start <name>      # Service starten
ora service stop <name>       # Service stoppen
ora service restart <name>    # Service neu starten
ora service status <name>     # Service Status anzeigen
ora service logs <name>       # Service Logs anzeigen
```

**Container Management:**
```bash
ora container list            # Alle Container auflisten
ora container start <name>    # Container starten
ora container stop <name>     # Container stoppen
ora container restart <name>  # Container neu starten
ora container logs <name> -f  # Container Logs (follow)
ora container stats           # Container Statistiken
```

**Plugin Management:**
```bash
ora plugin list               # Installierte Plugins auflisten
ora plugin install <plugin>   # Plugin installieren
ora plugin remove <name>      # Plugin entfernen
ora plugin info <name>        # Plugin Information
ora plugin enable <name>      # Plugin aktivieren
ora plugin disable <name>     # Plugin deaktivieren
```

**Logs & Monitoring:**
```bash
ora logs system -f            # System Logs (follow)
ora logs service <name> -f    # Service Logs (follow)
ora status                    # Gesamtstatus anzeigen
ora status --verbose          # Detaillierter Status
```

**Security & Secrets:**
```bash
ora security status           # Security Status
ora security alerts           # Security Alerts
ora security secrets          # Secrets auflisten
ora security add-secret <name> --stdin  # Secret hinzufügen
```

**Updates:**
```bash
ora update --check            # Nach Updates suchen
ora update                    # Updates installieren
```

#### Features:

- ✅ **Farbige Terminal-Ausgabe** - Übersichtliche, farbcodierte Darstellung
- ✅ **Tabellen-Formatierung** - Listen werden als Tabellen dargestellt
- ✅ **Interaktive Bestätigungen** - Schutz vor versehentlichen Aktionen
- ✅ **REST API Integration** - Kommuniziert mit allen rumahl Services
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
  - rumahl-supervisor API (Port 8097) für Container Management
  - rumahl-core API (Port 8090) für Services & Plugins
  - rumahl-security API (Port 8095) für Security
  - rumahl-secrets API (Port 8093) für Secrets
  - systemctl für System-Befehle
  - journalctl für Logs

## Noch zu implementieren (TODO)

### 2. Admin Center Erweiterungen

Neue Tabs im rumahl Home Admin Panel hinzufügen:

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

Neue Endpoints in rumahl-home für Frontend:

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
ora status --verbose

# Service neu starten
ora service restart rumahl-home

# Container Logs live ansehen
ora container logs rumahl-supervisor -f

# Plugin installieren
ora plugin install https://github.com/example/rumahl-weather-plugin

# Secret hinzufügen
echo "my-secret-value" | ora security add-secret MY_API_KEY --stdin

# System neu starten
ora system reboot
```

### Admin Center Navigation:

Nach Implementierung:
1. rumahl Home öffnen
2. Admin Center (Zahnrad-Icon)
3. Neue Tabs sichtbar:
   - **OS Management** - System-Steuerung
   - **Containers** - Docker Container Management
   - **Plugins** - Plugin Verwaltung

## Installation

### CLI Tool installieren:

```bash
# In rumahl OS:
cd backend
cargo build --release -p rumahl-cli
sudo cp target/release/ora /usr/local/bin/
sudo chmod +x /usr/local/bin/ora

# Testen:
ora --version
ora status
```

### Shell Completion (optional):

```bash
# Für Bash:
ora --generate-completion bash > /etc/bash_completion.d/ora

# Für Zsh:
ora --generate-completion zsh > ~/.zfunc/_ora

# Für Fish:
ora --generate-completion fish > ~/.config/fish/completions/ora.fish
```

## Commit

Commit 06c7dfa: `feat: add ora CLI tool for system management`

Alles ready für die nächste Phase (Admin Center UI).
