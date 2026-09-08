# deploy/

Docker Compose-Stacks für Entwicklung, Test und Fremdinstallation.

> **Hinweis:** Die kanonische Produktions-Installation ist das rumahl OS Image
> (Buildroot-basiert, via `../rumahl-os/build.sh`). Diese Compose-Files sind für
> lokale Entwicklung und Umgebungen ohne rumahl OS gedacht.

## Dateien

| Datei | Zweck |
|-------|-------|
| `docker-compose.yml` | Vollständiger Stack (Postgres + alle rumahl-Dienste) |
| `docker-compose.minimal.yml` | Minimal-Stack (Postgres + Core + Home + Secrets) |
| `docker-compose.rumahl-os.yml` | rumahl-OS-spezifische Dienste (Supervisor, Nginx, etc.) |
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

# 2c. Voller Stack + rumahl OS Dienste
docker compose -f docker-compose.yml -f docker-compose.rumahl-os.yml up -d

# 3. Status prüfen
docker compose ps
docker compose logs -f rumahl-home

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

# Mit rumahl OS Diensten
docker compose --profile rumahl-os up -d

# Alles (full profile)
docker compose --profile full up -d

# Remote-Zugriff
docker compose --profile remote up -d
```

## Ports

| Dienst | Port | Beschreibung |
|--------|------|-------------|
| rumahl-home | 8126 | Dashboard + API |
| rumahl-core | 8090 | Service Discovery |
| rumahl-control | 8091 | Admin Panel |
| rumahl-assist | 8092 | AI Assistant |
| rumahl-secrets | 8093 | Secrets |
| rumahl-watchdog | 8094 | Health |
| rumahl-security | 8095 | Security |
| rumahl-gateway | 8096 | Gateway |
| rumahl-supervisor | 8097 | Container Mgmt |
| rumahl-appstore | 8098 | App Store |
| rumahl-intelligence | 8099 | AI Analysis |
| rumahl-backup | 8100 | Backup |
| rumahl-api | 8101 | API Gateway |
| rumahl-files | 8102 | Files |
| rumahl-updater | 8103 | Updates |
| rumahl-connector | 8104 | Remote |
| rumahl-nginx | 8080/443 | Reverse Proxy |
| rumahl-stt | 8110 | Speech-to-Text |
| rumahl-tts | 8111 | Text-to-Speech |
| postgres | 5432 | Database |
