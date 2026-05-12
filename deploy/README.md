# deploy/

Docker Compose-Stacks für Entwicklung, Test und Fremdinstallation.

> **Hinweis:** Die kanonische Produktions-Installation ist das IORA OS Image
> (Buildroot-basiert, via `../iora-os/build.sh`). Diese Compose-Files sind für
> lokale Entwicklung und Umgebungen ohne IORA OS gedacht.

## Dateien

| Datei | Zweck |
|-------|-------|
| `docker-compose.yml` | Vollständiger Stack (Postgres + alle IORA-Dienste) |
| `docker-compose.minimal.yml` | Minimal-Stack (Postgres + Core + Home + Secrets) |
| `docker-compose.iora-os.yml` | IORA-OS-spezifische Dienste (Supervisor, Nginx, etc.) |
| `.env.example` | Vorlage für Umgebungsvariablen |
| `init-postgres.sh` | Postgres-Init-Script (DBs + User) |

## Schnellstart

```bash
# 1. Umgebungsvariablen einrichten
cp .env.example .env
# Passe .env an (mindestens Passwörter ändern!)

# 2a. Minimal-Stack starten (für Raspberry Pi / schwache Hardware)
docker compose -f docker-compose.minimal.yml up -d

# 2b. Voller Stack starten
docker compose up -d

# 2c. Voller Stack + IORA OS Dienste
docker compose -f docker-compose.yml -f docker-compose.iora-os.yml up -d

# 3. Status prüfen
docker compose ps
docker compose logs -f iora-home

# 4. Stoppen
docker compose down
```

## Profile

Einige Dienste sind über Docker Compose Profiles gesteuert:

```bash
# Nur Basis-Dienste (default)
docker compose up -d

# Mit Voice-Diensten (STT + TTS)
docker compose --profile voice up -d

# Mit IORA OS Diensten
docker compose --profile iora-os up -d

# Alles (full profile)
docker compose --profile full up -d

# Remote-Zugriff
docker compose --profile remote up -d
```

## Ports

| Dienst | Port | Beschreibung |
|--------|------|-------------|
| iora-home | 8126 | Dashboard + API |
| iora-core | 8090 | Service Discovery |
| iora-control | 8091 | Admin Panel |
| iora-assist | 8092 | AI Assistant |
| iora-secrets | 8093 | Secrets |
| iora-watchdog | 8094 | Health |
| iora-security | 8095 | Security |
| iora-gateway | 8096 | Gateway |
| iora-supervisor | 8097 | Container Mgmt |
| iora-appstore | 8098 | App Store |
| iora-intelligence | 8099 | AI Analysis |
| iora-backup | 8100 | Backup |
| iora-api | 8101 | API Gateway |
| iora-files | 8102 | Files |
| iora-updater | 8103 | Updates |
| iora-connector | 8104 | Remote |
| iora-nginx | 8080/443 | Reverse Proxy |
| iora-stt | 8110 | Speech-to-Text |
| iora-tts | 8111 | Text-to-Speech |
| postgres | 5432 | Database |
