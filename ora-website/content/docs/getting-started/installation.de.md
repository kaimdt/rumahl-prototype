---
title: Installation
description: rumahl OS auf jeder Plattform installieren — Systemanforderungen, Image flashen, Docker Compose und Entwicklungsmodus.
readTime: 8 min
category: setup
updated: 2026-08-20
featured: true
---

Dieser Leitfaden behandelt die Installation von rumahl auf allen unterstützten Plattformen. Wähle die Methode, die zu deiner Hardware passt — ein eigenes Gerät, ein vorhandener Linux-Server oder ein Entwicklungsrechner.

## Schnellinstallation (One-Liner)

Der schnellste Weg — das Skript erkennt dein System und installiert automatisch:

```bash
curl -fsSL https://rumahl.com/install | bash
```

Nicht-interaktive Server-Installation mit Docker:

```bash
curl -fsSL https://rumahl.com/install | bash -s -- --server
```

Image auf ein Gerät flashen:

```bash
curl -fsSL https://rumahl.com/install | bash -s -- --device /dev/sdX
```

## Systemanforderungen

| Komponente | Minimum | Empfohlen |
| --- | --- | --- |
| CPU | 2 Kerne (ARM64 oder x86_64) | 4 Kerne |
| RAM | 512 MB (Raspberry Pi 4) / 900 MB (VM) | 2 GB+ (8 GB+ für ORA AI) |
| Speicher | 8 GB frei | 20 GB+ SSD |
| OS | Debian 12+, Ubuntu 22.04+, macOS 13+, Raspberry Pi OS | gleich |

**Unterstützte Hardware:** x86_64 mit UEFI (Intel/AMD-Server, NUCs), Raspberry Pi 4 (4 GB+ empfohlen), Rock Pi 4, Odroid N2+, generische ARM64-Boards.

## rumahl OS auf Hardware installieren

rumahl OS ist ein benutzerdefiniertes Buildroot-Betriebssystem mit schreibgeschütztem SquashFS-Root, A/B-Partitions-Updates über RAUC und Docker Engine für alle Dienste.

```bash
# 1. Vorgefertigtes Image herunterladen
wget https://github.com/rumahl/rumahl/releases/latest/download/rumahl-os.img.xz

# 2. Prüfsumme verifizieren
sha256sum rumahl-os.img.xz

# 3. Auf das Gerät flashen (/dev/sdX ersetzen)
xzcat rumahl-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress

# 4. Booten und Weboberfläche unter http://[geräte-ip]:8126 öffnen
```

> **Wichtig:** Die Standard-Zugangsdaten sind `root / ora` — ändere sie sofort beim ersten Login.

Wichtige Eigenschaften von rumahl OS:

- Buildroot-LTS-Linux — minimaler, sicherer Kernel
- SquashFS-Root-Dateisystem — schreibgeschützt, komprimiert (LZ4)
- ZRAM — komprimierter RAM für `/tmp`, `/var`, Swap
- RAUC-A/B-Updates — atomare Updates mit Rollback
- AppArmor — obligatorische Zugriffskontrolle für alle Dienste

## Docker Compose auf Linux-Servern

Auf Standard-Linux-Servern läuft rumahl als vollständig containerisiertes System, verwaltet vom `rumahl-supervisor`.

```bash
# 1. Repository klonen
git clone https://github.com/rumahl/rumahl.git
cd rumahl/deploy

# 2. Konfigurieren und starten
cp ../.env.example ../.env
docker compose up -d
```

Warte 30–60 Sekunden, bis alle Dienste initialisiert sind, und öffne dann das Dashboard unter `http://localhost:8126`.

## Entwicklungsmodus (direkt auf dem Host)

Für die Entwicklung direkt auf dem Host siehe die Entwicklungsdokumentation — das Backend ist ein Rust-Workspace, gestartet über `start.bat`/`start.sh`; das Frontend läuft auf Port 5173, das Backend auf Port 3001.

## Checkliste nach der Installation

1. Standard-Zugangsdaten ändern
2. Admin-Konto im Dashboard anlegen
3. Update-Center auf die neueste Version prüfen
4. Automatisches Backup einrichten (Einstellungen → Backup)
5. Optional Home Assistant verbinden

> **Tipp:** Eine DHCP-Reservierung im Router hält die Geräte-IP stabil — sonst kann sich die IP nach einem Neustart ändern.
