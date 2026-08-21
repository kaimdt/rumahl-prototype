# rumahl OS Dev VM

> Recommended Windows entry point: run `pwsh .\dev-manager.ps1` from `rumahl-os`. The central manager validates QMP/QGA, restores the current Bridge or Slirp connection from persistent runtime state, exposes VM/service/diagnostic actions, and reports `Ready` only after internal and host health checks pass. See [rumahl Dev Manager](docs/dev-manager.md).

> Lokale Entwicklungsumgebung für rumahl OS - 1:1 identisch mit Produktions-Setup

## Übersicht

Die rumahl OS Dev VM ist eine vollständige Debian 12 VM, die alle rumahl OS Services in einer lokalen Entwicklungsumgebung bereitstellt. Sie ist **1:1 identisch** mit dem echten rumahl OS Appliance-Image konfiguriert.

## Schnellstart

```bash
# Windows (PowerShell)
.\dev-local.ps1

# Linux/macOS/WSL
./dev-local.sh
```

Nach dem Start ist das Dashboard verfügbar unter:
- **HTTPS:** https://localhost
- **HTTP:** http://localhost:8126
- **Swagger API:** http://localhost:8126/api/docs

## Features

### 🏗️ rumahl OS Services

Alle 20+ rumahl OS Services mit korrekten Abhängigkeiten:

| Service | Port | Beschreibung |
|---------|------|--------------|
| rumahl-core | 8090 | Service Registry & Discovery |
| rumahl-home | 8126 | Haupt-API & Dashboard |
| rumahl-control | 8091 | Control Center |
| rumahl-assist | 8092 | AI Assistant |
| rumahl-secrets | 8093 | Secret Management |
| rumahl-watchdog | 8094 | Service Überwachung |
| rumahl-security | 8095 | Security Monitoring |
| rumahl-gateway | 8096 | API Gateway |
| rumahl-supervisor | 8097 | Docker Container Management |
| rumahl-appstore | 8098 | App Store |
| rumahl-api | 8099 | Public API |
| rumahl-backup | 8100 | Backup Service |
| rumahl-dev-bridge | 8101 | IDE Integration |
| rumahl-domain-validator | 8102 | Domain Whitelist |
| rumahl-files | 8103 | File Sharing |
| rumahl-network-monitor | 8104 | Netzwerk-Scanner |
| rumahl-nginx | 8089 | Reverse Proxy (intern) |
| rumahl-resource-manager | 8105 | Ressourcen-Überwachung |
| rumahl-updater | 8106 | Update Manager |
| rumahl-connector | 8088 | Remote Connect |

Alle Services laufen als systemd Services mit:
- Korrekten `After=` und `Wants=` Abhängigkeiten
- Security Hardening (NoNewPrivileges, PrivateTmp, ProtectSystem)
- Automatischem Restart bei Absturz
- Memory Limits (z.B. rumahl-assist: 1500M)

### 🔒 Hardened Docker

**Socket Restrictions:**
- Docker Socket nur für root zugänglich (Mode 0600)
- Kein docker-Group Zugriff (nur rumahl-supervisor als root)

**Service Hardening:**
```ini
[Service]
Restart=always
RestartSec=5
StartLimitBurst=10
StartLimitIntervalSec=60
LimitNOFILE=1048576
LimitNPROC=1048576
```

**Daemon Konfiguration:**
- storage-driver: overlay2
- log-driver: json-file (max 10m, 3 files)
- live-restore: true
- userland-proxy: false
- native.cgroupdriver: systemd
- icc: false (inter-container communication disabled)

### 🌐 DHCP Konflikt-Erkennung

**rumahl-dhcp-conflict-guard.service**

Überwacht alle physischen Netzwerk-Interfaces auf DHCP-Konflikte:
- Verwendet `arping -D` für Duplicate Address Detection (DAD)
- Erkennt IP-Konflikte mit anderen Hosts im LAN
- Fordert automatisch neue Lease an bei Konflikt
- Ignoriert Docker/Bridge/Virtual Interfaces
- Ausschluss von statisch konfigurierten IPs

### 🔍 Virtualisierungs-Erkennung

**rumahl-detect-virt.service**

Erkennt automatisch die Virtualisierungsplattform:
- VMware
- Oracle VirtualBox
- QEMU/KVM
- Microsoft Hyper-V
- Xen
- Parallels
- LXC/Container

Schreibt Ergebnisse nach:
- `/run/rumahl-virt.env` (sourceable)
- `/etc/rumahl-virt.conf` (persistent)
- `/etc/issue.d/10-rumahl-virt.issue` (Login-Banner)

### 🗄️ Hardened PostgreSQL

**PostgreSQL Hardening:**
```ini
[Service]
ExecStartPre=+/bin/sh -c 'mkdir -p /var/lib/pgsql && chown postgres:postgres /var/lib/pgsql && chmod 700 /var/lib/pgsql'
ExecStartPre=/bin/sh -c 'if [ ! -f /var/lib/pgsql/PG_VERSION ]; then /usr/bin/pg_ctl initdb -D /var/lib/pgsql -o "--locale=C --encoding=UTF8"; fi'
```

**pg_hba.conf Härtung:**
```
# rumahl application role
host    all             ora            127.0.0.1/32            scram-sha-256
host    all             ora            ::1/128                 scram-sha-256
```

**Datenbanken:**
- rumahl_home (Haupt-DB)
- rumahl_core (Service Registry)
- rumahl_secrets (Secrets)
- rumahl_security (Security)
- rumahl_appstore (App Store)
- rumahl_assist (AI Assistant)

**Rollen:**
- `root` - PostgreSQL Superuser
- `ora` - Application User (Passwort: ora)

### ⏰ Korrekte Chrony Zeit-Synchronisation

**/etc/chrony.conf:**
```
pool 2.pool.ntp.org iburst maxsources 4
pool time.cloudflare.com iburst maxsources 2

makestep 1.0 3
rtcsync
driftfile /var/lib/chrony/drift
logdir /var/log/chrony
allow 127.0.0.1/32
allow ::1/128
```

Mit automatischer Verzeichnis-Erstellung und Berechtigungen.

### 🔥 Firewall (iptables)

**rumahl-firewall.service**

Standard-Regeln:
- INPUT: DROP (default deny)
- FORWARD: DROP
- OUTPUT: ACCEPT
- Loopback: ACCEPT
- Established connections: ACCEPT
- SSH (22): ACCEPT
- HTTP (80) / HTTPS (443): ACCEPT
- rumahl Services (3001, 5432, 8080-8126): nur localhost

### 🔄 Hot Reload

**rumahl-hot-reload.path/service**

Überwacht `/opt/rumahl/build/` auf Änderungen:
- Automatischer Service-Restart bei neuen Binaries
- Funktioniert mit dev-watch.ps1/sh

### 📊 Health Monitoring

**rumahl-health-check.timer/service**

- Läuft jede Minute
- Prüft alle rumahl Services
- Schreibt Status nach `/var/log/ora/status.json`
- Logging nach `/var/log/ora/health.log`

### 🛡️ Security Features

1. **Binary Verification:** /etc/ora/binary-manifest.sha256 (Platzhalter für Dev)
2. **Integrity Checks:** rumahl-integrity.service (stub in Dev)
3. **Setup Wizard:** rumahl-setup-wizard.service (erstellt Default-User)
4. **Dev Mode Marker:** /etc/ora/os-dev-mode

## Verzeichnisstruktur

```
/etc/ora/              # OS-Konfiguration
├── os-release          # RUMAHL_OS_COMPAT=1
├── os-dev-mode         # Dev Mode Marker
├── ssl/                # SSL Zertifikate
│   ├── server.crt
│   ├── server.key
│   └── dhparam.pem
├── binary-manifest.sha256
└── *.env               # Service Environment Files

/opt/rumahl/              # Service Daten
├── data/<service>/     # Service-spezifische Daten
├── build/dist/         # Frontend (nginx root)
└── docs/               # Dokumentation

/mnt/data/ora/         # Persistente Daten (tmpfs in Dev)
├── docker-compose.yml  # User Apps
└── .setup-complete     # Setup Marker

/usr/lib/ora/          # rumahl System-Tools
├── rumahl-dhcp-conflict-guard.sh
├── rumahl-health-check
├── rumahl-watchdog-check
├── rumahl-setup-wizard
├── rumahl-data-unlock
├── rumahl-firewall
└── rumahl-zram-setup

/usr/bin/rumahl-*         # Service Binaries
```

## Entwicklungs-Workflow

### 1. VM Starten

```powershell
.\dev-local.ps1        # Windows
./dev-local.sh          # Linux/macOS
```

### 2. Code Änderungen Überwachen

Automatisch im zweiten Terminal:

```powershell
.\dev-watch.ps1        # Windows
./dev-watch.sh          # Linux/macOS
```

Features:
- Wacht auf .rs und .toml Änderungen
- Cross-compiliert für Linux
- Deployed via SCP
- Restartet Services automatisch
- Unterstützt Frontend-Builds

### 3. Manuelle Builds

Im dev-watch Terminal:
- `B` - Build alle Services
- `F` - Build Frontend
- `R` - Nur Rust
- `S` - sccache Stats
- `Q` - Quit

### 4. VM Stoppen

- `Ctrl+C` in dev-local Terminal
- QEMU wird automatisch beendet

## Troubleshooting

### SSH Verbindung fehlschlägt

```bash
# Key neu generieren
rm .cache/rumahl-dev-key*
./dev-local.sh --clean
```

### Services starten nicht

```bash
# In VM (ssh -p 2222 root@localhost)
journalctl -u rumahl-* -f
systemctl status rumahl-core
```

### Datenbank-Fehler

```bash
# Datenbanken neu initialisieren
su - postgres -c "psql -c 'DROP DATABASE rumahl_home;'"
systemctl restart rumahl-db-init
```

### Port-Konflikte

```bash
# Prüfen welcher Prozess einen Port blockiert
lsof -i :8126
```

### VM bleibt in der „UEFI Interactive Shell“ hängen

Symptom: Das QEMU-Fenster zeigt die UEFI-Shell (`Shell>`) statt Debian zu booten.

Ursache: Die OVMF-NVRAM (`OVMF_VARS.fd`) enthält keine Boot-Reihenfolge mit der VM-Disk
(typisch nach einem Cache-Reset, z.B. `-Clean`), und ohne explizites `bootindex` wird die
Disk von OVMF nicht in den BootOrder aufgenommen. Das Debian-Cloud-Image bootet dann nicht.

Der Dev-Server behebt das seit v2.5.0 **automatisch**:

1. Die VM wird mit explizitem `bootindex` auf der Disk gestartet → OVMF bootet GRUB direkt.
2. Falls die VM trotzdem in der UEFI-Shell landet, erkennt das Skript das im Serial-Log
   („UEFI Interactive Shell“), startet die VM mit **SeaBIOS** neu und merkt sich das in
   `.cache/boot-firmware` (Inhalt `seabios`) für künftige Starts.
3. Nach einer erfolgreichen Provisionierung wird der Marker entfernt → beim nächsten Start
   wird UEFI erneut versucht (selbstkorrigierendes System).

Manuell steuern:

```bash
# UEFI/OVMF erzwingen (z.B. für EFI-fähige rumahl-OS-Images)
./dev-local.ps1 -Uefi

# Marker zurücksetzen (wieder UEFI zuerst versuchen)
rm .cache/boot-firmware

# Marker löschen + Boot-Log prüfen
cat .cache/qemu-serial.log
```

Hinweis: Das TCG-Fallback (`-SkipWhpx`) bootet immer über SeaBIOS; `-Uefi` wird dort ignoriert.

### Bridge-Modus: eigene LAN-IP wie rumahl OS Produktion

Die VM bekommt per TAP-Treiber + Netzwerkbrücke eine eigene IP vom LAN-Router (DHCP) –
erreichbar vom PC und allen Geräten im Netz, genau wie ein echtes rumahl OS:

```powershell
# Einmalig als Administrator (TAP-Treiber + Brücke werden automatisch eingerichtet):
# (PowerShell als Admin starten)
.\dev-local.ps1 -Bridge

# Danach reicht ein normaler Start – Brücke und Treiber bleiben bestehen:
.\dev-local.ps1 -Bridge
```

Voraussetzungen: kabelgebundenes Ethernet (WLAN-Adapter können nicht gebrückt werden),
Internet beim ersten Mal (TAP-Treiber-Download). Das Skript:

1. installiert den TAP-Windows6-Treiber (falls fehlt),
2. erstellt die Netzwerkbrücke (LAN-Adapter + TAP) via `netsh bridge create`,
3. startet QEMU mit dem TAP-Adapter statt slirp – die VM holt sich eine LAN-IP per DHCP,
4. ermittelt die IP automatisch über den QEMU-Gast-Agenten und nutzt sie für SSH,
   Sync und Health-Checks (SSH direkt auf Port 22).

Ohne `-Bridge` gilt weiterhin der slirp-Modus mit Port-Forwards (`localhost:8126` etc.).

### Golden-Snapshot: Reset in Sekunden statt Neuprovisionierung

Nach einer erfolgreichen Provisionierung kann der komplette VM-Zustand als Golden-Snapshot
konserviert werden – danach sind Resets quasi kostenlos:

```bash
# Aktuellen provisionierten Zustand einfrieren (~5-10 Min, einmalig)
./dev-local.ps1 -Freeze

# Reset auf den Golden-Zustand (Sekunden, keine Neuprovisionierung!)
./dev-local.ps1 -Clean && ./dev-local.ps1

# Golden-Snapshot verwerfen (kompletter Neuaufbau)
./dev-local.ps1 -CleanAll
# oder
./dev-local.ps1 -Rebuild
```

Der Golden-Snapshot (`.cache/rumahl-dev-golden.qcow2`) enthält auch das vorab gebaute
`target/` – Services starten nach einem Reset sofort, ohne Rebuild-Sturm. Auch ein echter
WHPX-Fehler setzt auf den Golden zurück statt neu zu provisionieren.

## Dev-Server-Features (v2.5.0+)

- **ZRAM wie Produktion**: 50% RAM als zstd-komprimierter Swap (`zramswap`).
- **rumahl-Boot-Identität**: ASCII-rumahl-Logo als Login-Banner (SSH + Konsole) und GRUB-Menü als „rumahl OS".
- **AppArmor**: Starter-Profile für rumahl-home/-core/-watchdog in `apparmor/dev-vm/`, geladen im
  complain-Mode (loggt, blockiert nicht) – Enforcement wie Produktion testen: `flags=(complain)`
  entfernen und `apparmor_parser -r /etc/apparmor.d/rumahl-*` ausführen.
- **Dev-Signatur**: `/usr/local/bin/rumahl-dev-sign` in der VM signiert Dateien mit dem Dev-Schlüssel
  `/etc/ora/dev-signing/rumahl-dev.key` (rumahl-sign-Parität, baut das Tool beim ersten Aufruf).
- **Firewall-Parität**: Die rumahl-Firewall erlaubt DHCP + alle Host-Forward-Ports (QEMU-slirp-
  Subnetz 10.0.2.0/24) – ohne diese Anpassung verliert die VM nach dem ersten Reboot ihre IP
  und kein Forward-Port ist erreichbar.
- **Schneller Sync**: rsync-Fast-Path erkennt das WSL2-Gateway automatisch (NAT-Modus),
  tar+scp-Fallback nutzt System32-tar mit sauberen Excludes; `dev-sync.sh --watch` funktioniert
  damit auch aus WSL.
- **Vorab gebaute Services**: Die Provisionierung baut das komplette Workspace einmal vor
  (cargo build --workspace) – der erste Boot nach einem Reset startet alle Services sofort.

## Unterschiede zur Produktion

| Feature | Dev VM | rumahl OS Produktion |
|---------|--------|-------------------|
| Virtualisierung | QEMU/KVM | Bare Metal |
| Storage | tmpfs (Dev) | LUKS-verschlüsselte Partition |
| SSL | Self-signed | Let's Encrypt / Custom |
| ZRAM | Standard (50% RAM, zstd) | Standard (50% RAM) |
| Binary Verification | Dev-Signaturschlüssel (rumahl-dev-sign) | Aktiviert (Signatur-Check) |
| AppArmor | Starter-Profile (complain mode) | Aktiviert |
| Recovery Mode | Nicht verfügbar | Verfügbar (PIN-geschützt) |
| Auto-Updates | Deaktiviert | Aktiviert |

## Technische Details

### QEMU Einstellungen

- **RAM:** 60-70% des Host-RAM (6-16GB)
- **CPUs:** Host-CPUs / 2 (min 2)
- **Disk:** 20GB qcow2 (overlay auf Debian Cloud Image)
- **Netzwerk:** User-mode NAT mit Port Forwarding
- **Architektur:** x86_64 oder ARM64 (automatisch erkannt)

### Cross-Compilation

```bash
# Windows
cargo build --target x86_64-unknown-linux-musl

# Linux/macOS
cargo build --target x86_64-unknown-linux-gnu
```

Alternativ: `cargo-zigbuild` für einfacheres Cross-Compiling.

### Systemd Targets

```
local-fs.target
    └─ mnt-data.mount
        └─ rumahl-init-data.service
            └─ rumahl-stack.service

multi-user.target
    ├─ postgresql.service
    │   └─ rumahl-db-init.service
    ├─ docker.service
    │   └─ rumahl-stack.service
    ├─ rumahl-core.service (port 8090)
    │   └─ rumahl-home.service (port 8126)
    │       └─ rumahl-control.service
    └─ nginx.service
```

## Ressourcen

- **Dokumentation:** https://localhost/docs
- **API Docs:** http://localhost:8126/api/docs
- **GitHub:** (rumahl OS Repository)

## Lizenz

Apache-2.0 - Siehe LICENSE Datei im Repository.

---

**Hinweis:** Diese Dev VM ist für Entwicklungszwecke optimiert. Für Produktions-Deployment verwenden Sie das offizielle rumahl OS Appliance-Image.
