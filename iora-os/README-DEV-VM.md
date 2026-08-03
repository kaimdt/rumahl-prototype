# IORA OS Dev VM

> Lokale Entwicklungsumgebung für IORA OS - 1:1 identisch mit Produktions-Setup

## Übersicht

Die IORA OS Dev VM ist eine vollständige Debian 12 VM, die alle IORA OS Services in einer lokalen Entwicklungsumgebung bereitstellt. Sie ist **1:1 identisch** mit dem echten IORA OS Appliance-Image konfiguriert.

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

### 🏗️ IORA OS Services

Alle 20+ IORA OS Services mit korrekten Abhängigkeiten:

| Service | Port | Beschreibung |
|---------|------|--------------|
| iora-core | 8090 | Service Registry & Discovery |
| iora-home | 8126 | Haupt-API & Dashboard |
| iora-control | 8091 | Control Center |
| iora-assist | 8092 | AI Assistant |
| iora-secrets | 8093 | Secret Management |
| iora-watchdog | 8094 | Service Überwachung |
| iora-security | 8095 | Security Monitoring |
| iora-gateway | 8096 | API Gateway |
| iora-supervisor | 8097 | Docker Container Management |
| iora-appstore | 8098 | App Store |
| iora-api | 8099 | Public API |
| iora-backup | 8100 | Backup Service |
| iora-dev-bridge | 8101 | IDE Integration |
| iora-domain-validator | 8102 | Domain Whitelist |
| iora-files | 8103 | File Sharing |
| iora-network-monitor | 8104 | Netzwerk-Scanner |
| iora-nginx | 8089 | Reverse Proxy (intern) |
| iora-resource-manager | 8105 | Ressourcen-Überwachung |
| iora-updater | 8106 | Update Manager |
| iora-connector | 8088 | Remote Connect |

Alle Services laufen als systemd Services mit:
- Korrekten `After=` und `Wants=` Abhängigkeiten
- Security Hardening (NoNewPrivileges, PrivateTmp, ProtectSystem)
- Automatischem Restart bei Absturz
- Memory Limits (z.B. iora-assist: 1500M)

### 🔒 Hardened Docker

**Socket Restrictions:**
- Docker Socket nur für root zugänglich (Mode 0600)
- Kein docker-Group Zugriff (nur iora-supervisor als root)

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

**iora-dhcp-conflict-guard.service**

Überwacht alle physischen Netzwerk-Interfaces auf DHCP-Konflikte:
- Verwendet `arping -D` für Duplicate Address Detection (DAD)
- Erkennt IP-Konflikte mit anderen Hosts im LAN
- Fordert automatisch neue Lease an bei Konflikt
- Ignoriert Docker/Bridge/Virtual Interfaces
- Ausschluss von statisch konfigurierten IPs

### 🔍 Virtualisierungs-Erkennung

**iora-detect-virt.service**

Erkennt automatisch die Virtualisierungsplattform:
- VMware
- Oracle VirtualBox
- QEMU/KVM
- Microsoft Hyper-V
- Xen
- Parallels
- LXC/Container

Schreibt Ergebnisse nach:
- `/run/iora-virt.env` (sourceable)
- `/etc/iora-virt.conf` (persistent)
- `/etc/issue.d/10-iora-virt.issue` (Login-Banner)

### 🗄️ Hardened PostgreSQL

**PostgreSQL Hardening:**
```ini
[Service]
ExecStartPre=+/bin/sh -c 'mkdir -p /var/lib/pgsql && chown postgres:postgres /var/lib/pgsql && chmod 700 /var/lib/pgsql'
ExecStartPre=/bin/sh -c 'if [ ! -f /var/lib/pgsql/PG_VERSION ]; then /usr/bin/pg_ctl initdb -D /var/lib/pgsql -o "--locale=C --encoding=UTF8"; fi'
```

**pg_hba.conf Härtung:**
```
# IORA application role
host    all             iora            127.0.0.1/32            scram-sha-256
host    all             iora            ::1/128                 scram-sha-256
```

**Datenbanken:**
- iora_home (Haupt-DB)
- iora_core (Service Registry)
- iora_secrets (Secrets)
- iora_security (Security)
- iora_appstore (App Store)
- iora_assist (AI Assistant)

**Rollen:**
- `root` - PostgreSQL Superuser
- `iora` - Application User (Passwort: iora)

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

**iora-firewall.service**

Standard-Regeln:
- INPUT: DROP (default deny)
- FORWARD: DROP
- OUTPUT: ACCEPT
- Loopback: ACCEPT
- Established connections: ACCEPT
- SSH (22): ACCEPT
- HTTP (80) / HTTPS (443): ACCEPT
- IORA Services (3001, 5432, 8080-8126): nur localhost

### 🔄 Hot Reload

**iora-hot-reload.path/service**

Überwacht `/opt/iora/build/` auf Änderungen:
- Automatischer Service-Restart bei neuen Binaries
- Funktioniert mit dev-watch.ps1/sh

### 📊 Health Monitoring

**iora-health-check.timer/service**

- Läuft jede Minute
- Prüft alle IORA Services
- Schreibt Status nach `/var/log/iora/status.json`
- Logging nach `/var/log/iora/health.log`

### 🛡️ Security Features

1. **Binary Verification:** /etc/iora/binary-manifest.sha256 (Platzhalter für Dev)
2. **Integrity Checks:** iora-integrity.service (stub in Dev)
3. **Setup Wizard:** iora-setup-wizard.service (erstellt Default-User)
4. **Dev Mode Marker:** /etc/iora/os-dev-mode

## Verzeichnisstruktur

```
/etc/iora/              # OS-Konfiguration
├── os-release          # IORA_OS_COMPAT=1
├── os-dev-mode         # Dev Mode Marker
├── ssl/                # SSL Zertifikate
│   ├── server.crt
│   ├── server.key
│   └── dhparam.pem
├── binary-manifest.sha256
└── *.env               # Service Environment Files

/opt/iora/              # Service Daten
├── data/<service>/     # Service-spezifische Daten
├── build/dist/         # Frontend (nginx root)
└── docs/               # Dokumentation

/mnt/data/iora/         # Persistente Daten (tmpfs in Dev)
├── docker-compose.yml  # User Apps
└── .setup-complete     # Setup Marker

/usr/lib/iora/          # IORA System-Tools
├── iora-dhcp-conflict-guard.sh
├── iora-health-check
├── iora-watchdog-check
├── iora-setup-wizard
├── iora-data-unlock
├── iora-firewall
└── iora-zram-setup

/usr/bin/iora-*         # Service Binaries
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
rm .cache/iora-dev-key*
./dev-local.sh --clean
```

### Services starten nicht

```bash
# In VM (ssh -p 2222 root@localhost)
journalctl -u iora-* -f
systemctl status iora-core
```

### Datenbank-Fehler

```bash
# Datenbanken neu initialisieren
su - postgres -c "psql -c 'DROP DATABASE iora_home;'"
systemctl restart iora-db-init
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
# UEFI/OVMF erzwingen (z.B. für EFI-fähige IORA-OS-Images)
./dev-local.ps1 -Uefi

# Marker zurücksetzen (wieder UEFI zuerst versuchen)
rm .cache/boot-firmware

# Marker löschen + Boot-Log prüfen
cat .cache/qemu-serial.log
```

Hinweis: Das TCG-Fallback (`-SkipWhpx`) bootet immer über SeaBIOS; `-Uefi` wird dort ignoriert.

## Unterschiede zur Produktion

| Feature | Dev VM | IORA OS Produktion |
|---------|--------|-------------------|
| Virtualisierung | QEMU/KVM | Bare Metal |
| Storage | tmpfs (Dev) | LUKS-verschlüsselte Partition |
| SSL | Self-signed | Let's Encrypt / Custom |
| ZRAM | Optional | Standard (50% RAM) |
| Binary Verification | Deaktiviert | Aktiviert (Signatur-Check) |
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
        └─ iora-init-data.service
            └─ iora-stack.service

multi-user.target
    ├─ postgresql.service
    │   └─ iora-db-init.service
    ├─ docker.service
    │   └─ iora-stack.service
    ├─ iora-core.service (port 8090)
    │   └─ iora-home.service (port 8126)
    │       └─ iora-control.service
    └─ nginx.service
```

## Ressourcen

- **Dokumentation:** https://localhost/docs
- **API Docs:** http://localhost:8126/api/docs
- **GitHub:** (IORA OS Repository)

## Lizenz

Apache-2.0 - Siehe LICENSE Datei im Repository.

---

**Hinweis:** Diese Dev VM ist für Entwicklungszwecke optimiert. Für Produktions-Deployment verwenden Sie das offizielle IORA OS Appliance-Image.
