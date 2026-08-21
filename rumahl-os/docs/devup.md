# devup.sh – rumahl OS Dev Inkrementelles Update

## Das Problem

Beim Entwickeln mit rumahl OS Dev schlägt der **Device-Build** (`--build-mode device`) fehl, weil das Buildroot-basierte rumahl OS Dev Image **kein `cargo`/`rustc`/`apt-get`** enthält. 

```
tooling bootstrap failed: apt-get is missing; cannot auto-install required tooling
Missing: build-essential, pkg-config, git, cargo, rustc.
Rebuild the Dev image with RUMAHL_OS_DEV=1 / BR2_PACKAGE_RUMAHL_DEV_TOOLCHAIN=y
```

Der bisherige Workaround war `./build.sh all --dev`, der das **komplette OS-Image neu baut** – sehr zeitaufwendig.

## Die Lösung: `devup.sh`

`devup.sh` läuft auf dem **Build-Host** und:
1. Erkennt via Git, welche Services sich geändert haben
2. Baut nur diese Services in **Docker** (GLIBC-sicher via Alpine/musl)
3. Lädt die fertigen Binaries per HTTP zur `rumahl-dev-bridge` hoch
4. Startet die Services auf dem Gerät neu

**Kein komplettes OS-Rebuild mehr nötig!**

## Architektur-Unterstützung

| Build-Host    | Target (Gerät) | Methode                                    |
|---------------|----------------|--------------------------------------------|
| x86_64 Linux  | x86_64         | Alpine/musl Docker-Image (vorhandenes Dockerfile) |
| x86_64 Linux  | aarch64 (ARM)  | ARM64 Docker-Image via QEMU-Emulation      |
| aarch64 Linux | aarch64        | Alpine/musl Docker-Image (nativ)           |

## Quick Start

```bash
# Voraussetzungen installieren
sudo apt-get install -y docker curl jq git

# 1. Device verbinden
./devup.sh --host 192.168.1.42 --save

# 2. Status anzeigen (Versionen vergleichen)
./devup.sh --status

# 3. Geänderte Services bauen und deployen
./devup.sh

# Oder bestimmte Services:
./devup.sh --service rumahl-home --service rumahl-control

# Nur bauen, nicht neustarten:
./devup.sh --no-restart

# Vorschau:
./devup.sh --dry-run
```

## Wie es funktioniert

1. **Git-Change-Detection**: Vergleicht den aktuellen HEAD mit dem letzten gespeicherten Build-Commit → nur geänderte Services werden gebaut
2. **Docker-Build**: Nutzt das vorhandene `backend/Dockerfile` (Alpine/musl) für native Architektur, oder erzeugt ein ARM64-Image via QEMU für `aarch64`-Targets
3. **Binary-Extraktion**: Holt das Binary aus dem Docker-Image heraus
4. **Upload via Bridge**: Sendet das Binary an `POST /dev/replace-binary` auf der rumahl-dev-bridge (Port 8101)
5. **Service-Restart**: Die Bridge führt `systemctl restart <service>` aus

## Konfiguration

Die Config wird in `~/.config/rumahl-devup/config` gespeichert:

```bash
RUMAHL_DEVUP_HOST="192.168.1.42:8101"
RUMAHL_DEVUP_TOKEN="abc123..."
```

Der Dev-Token wird beim OS-Build erzeugt und steht in `/var/lib/ora/dev-token` auf dem rumahl OS Dev Gerät.

## QEMU-Setup (für ARM-Cross-Compilation)

Wenn auf dem Build-Host (x86_64) für ein ARM-Gerät gebaut werden soll, wird QEMU-User-Emulation benötigt:

```bash
# Einmalig installieren:
docker run --rm --privileged tonistiigi/binfmt:latest --install arm64

# Verifizieren:
docker run --rm --platform linux/arm64 alpine:3.19 uname -m
# Sollte "aarch64" ausgeben
```

`devup.sh` installiert dies bei Bedarf automatisch.

## Zukunft: Device-Build fixen

Bei einem **kompletten OS-Rebuild** mit `./build.sh all --dev` wird das Buildroot-Image jetzt mit `BR2_PACKAGE_RUMAHL_DEV_TOOLCHAIN=y` gebaut (seit dem Fix in `build-all-images.sh`). Danach funktioniert auch der Device-Build wieder direkt auf dem Gerät.
