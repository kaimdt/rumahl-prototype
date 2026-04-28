# API Referenz

`iora-home` exponiert eine umfangreiche REST- und WebSocket-API.
Eine vollständige OpenAPI-3.0-Spezifikation ist unter

```
GET /api/docs/openapi.json
```

abrufbar (Swagger UI unter `/api/docs`).

## Wichtige Endpunkte

### Auth
- `POST /api/auth/register` — Benutzer registrieren
- `POST /api/auth/login` — Username + Passwort, gibt JWT zurück.
- `POST /api/auth/pin-login` — PIN-basierter Login.
- `GET /api/auth/verify` — JWT verifizieren.

### Admin
- `GET /api/admin/settings` — alle Settings + aktuelle Werte.
- `PUT /api/admin/settings/:key` — Wert setzen.
- `GET /api/admin/settings/schema` — vollständiges Schema.
- `GET /api/admin/control/services` — Live-Health aller Microservices.

### Home Assistant
- `GET /api/ha/states` — alle Entitäten.
- `POST /api/ha/services/:domain/:service` — Service aufrufen.
- `WS /api/ws` — Echtzeit-Event-Stream.

### Documentation
- `GET /api/documentation/config` — Navigation.
- `GET /api/documentation/*path` — einzelne Markdown-Datei.
- `GET /api/documentation/list` — Liste aller Pfade.
- `GET /api/docs` — Swagger UI (interaktive API-Dokumentation)

## App Capabilities (v2.1)

### App Storage (Dateien & Key-Value)
- `GET/POST /api/apps/:app_id/storage/files` — Dateien auflisten/hochladen
- `GET/DELETE /api/apps/:app_id/storage/files/:file_id` — Datei herunterladen/löschen
- `GET /api/apps/:app_id/storage/kv` — KV-Einträge auflisten
- `GET/PUT/DELETE /api/apps/:app_id/storage/kv/:key` — KV-Eintrag verwalten
- `GET /api/apps/:app_id/storage/usage` — Speichernutzung abfragen

### App Database (SQLite)
- `POST /api/apps/:app_id/database/provision` — SQLite-Datenbank bereitstellen
- `DELETE /api/apps/:app_id/database` — Datenbank löschen
- `GET /api/apps/:app_id/database/status` — Status abfragen
- `POST /api/apps/:app_id/database/execute` — SQL ausführen
- `POST /api/apps/:app_id/database/backup` — Backup auslösen
- `GET /api/apps/:app_id/database/backups` — Backups auflisten

### App Scheduler (Geplante Aufgaben)
- `GET/POST /api/apps/:app_id/schedules` — Aufgaben auflisten/erstellen
- `GET/PUT/DELETE /api/apps/:app_id/schedules/:task_id` — Aufgabe verwalten
- `POST /api/apps/:app_id/schedules/:task_id/trigger` — Manuell auslösen
- `GET /api/apps/:app_id/schedules/:task_id/logs` — Ausführungslogs

### App Webhooks
- `GET/POST /api/apps/:app_id/webhooks` — Webhooks auflisten/erstellen
- `GET/PUT/DELETE /api/apps/:app_id/webhooks/:hook_id` — Webhook verwalten
- `POST /api/apps/:app_id/webhooks/:hook_id/test` — Webhook testen
- `GET /api/apps/:app_id/webhooks/:hook_id/logs` — Zustellungslogs
- `GET /api/apps/:app_id/webhooks/:hook_id/stats` — Statistiken

### App Messaging (Inter-App Kommunikation)
- `GET/POST /api/apps/messaging/channels` — Kanäle auflisten/registrieren
- `POST /api/apps/messaging/publish` — Nachricht veröffentlichen
- `GET /api/apps/messaging/events` — SSE-Stream für Echtzeit-Nachrichten
- `POST /api/apps/:app_id/messaging/subscribe` — Kanal abonnieren
- `DELETE /api/apps/:app_id/messaging/subscriptions/:sub_id` — Abo kündigen
- `POST /api/apps/:app_id/messaging/direct` — Direktnachricht senden
- `GET /api/apps/:app_id/messaging/inbox` — Posteingang abrufen

## Webhooks

Ausgehende Webhooks werden im Admin-Panel unter "Webhooks" verwaltet.
HMAC-Signatur (`X-IORA-Signature-256`) wird mit dem konfigurierten
Secret berechnet (HMAC-SHA256 über den rohen Body).

Webhook-URLs für externe Dienste:
```
POST /api/webhooks/apps/{app_id}/{webhook_id}
```
