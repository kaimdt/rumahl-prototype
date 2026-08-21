---
title: API-Referenz
description: Die rumahl-REST-API — Basis-URLs, Authentifizierung, Endpunkt-Gruppen und das Berechtigungsmodell.
readTime: 7 min
updated: 2026-08-20
featured: true
---

rumahl stellt über mehrere Dienste eine umfassende REST-API bereit. Diese Referenz behandelt die Basis-URLs, die Authentifizierung und die wichtigsten Endpunkt-Gruppen.

## Basis-URLs

| Umgebung | rumahl-home | rumahl-core | rumahl-control |
| --- | --- | --- | --- |
| Entwicklung | `http://localhost:3001` | `http://localhost:8090` | `http://localhost:8091` |
| Produktion (Docker) | `http://localhost:8126` | `http://localhost:8090` | `http://localhost:8091` |

Die interaktive API-Dokumentation (Swagger UI) ist verfügbar unter `http://localhost:8126/api/docs`.

## Authentifizierung

Die meisten Endpunkte erfordern ein JWT-Token:

```bash
curl -X POST http://localhost:8126/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "admin", "password": "dein-passwort" }'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "username": "admin", "is_admin": true }
}
```

Jede Anfrage trägt das Token:

```bash
curl http://localhost:8126/api/os/services \
  -H "Authorization: Bearer <jwt-token>"
```

Für programmatischen Zugriff legst du im Control Center einen **API-Key** an und sendest ihn über den `X-API-Key`-Header.

## Endpunkt-Gruppen

| Gruppe | Endpunkte | Zweck |
| --- | --- | --- |
| Auth & Identität | `POST /api/auth/login`, `GET /api/auth/verify`, `POST /api/auth/guest` | Sitzungen, Verifikation, Gastmodus |
| System | `GET/POST /api/os/control/*`, `GET /api/os/logs/*`, `WS /api/os/terminal/ws` | Strom, Logs, Terminal, Dienste |
| Dateien & Speicher | `GET /api/files/*`, `POST /api/files/upload`, `POST /api/downloads` | Durchsuchen, Upload, Download-Manager |
| Jobs & Zwischenablage | `GET/POST /api/jobs/*`, `GET/POST/DELETE /api/clipboard/*` | System-Jobs, Zwischenablage |
| Geräte & Medien | `GET/POST /api/devices/*`, `POST /api/devices/:id/wake`, `GET /api/media/hub` | Geräte-Registry, WOL, Media-Hubs |
| Automatisierungen | `GET/POST /api/automations/*` | Visuelle Flow-Automatisierungen |
| App-Plattform | `GET /api/apps/:id/storage/kv/*`, `GET /api/core/registrations` | App-Speicher, Registrierungen |
| Remote & Netzwerk | `GET /api/remote/status`, `GET /share/:token`, `GET /api/network/devices` | Tunnel, Share-Links, Discovery |

## Das Berechtigungsmodell

Jeder Endpunkt ist einer Berechtigung zugeordnet — das Gateway erzwingt sie bei jeder Anfrage:

| Berechtigungsgruppe | Umfang |
| --- | --- |
| AppStorage[Read/Write/Delete/Manage] | App-Speicher: Key-Value, Dateien, Datenbank |
| AppDatabaseSqlite/Manage | App-SQLite-Datenbank |
| AppSchedule[Create/Read/Update/Delete] | Geplante Aufgaben |
| Messaging[Publish/Subscribe/Wildcard/Direct] | Messaging-System |
| Webhook[Create/Read/Update/Delete/Manage] | Webhooks |
| os.terminal, os.system.read, os.services, … | OS-Fähigkeiten |

## WebSockets & Events

Echtzeit-Updates laufen über WebSockets — das interaktive Terminal, Live-System-Events und Messaging zwischen Apps. Apps können System-Events über Lifecycle-Hooks mit glob-gefilterten Mustern abonnieren:

```json
{
  "lifecycle_hooks": {
    "hooks": [{ "event": "on_system_event", "filter": "security.*" }]
  }
}
```

> **Tipp:** Die vollständige Endpunkt-Dokumentation gibt es jederzeit in der Swagger-UI deiner laufenden Instanz.
