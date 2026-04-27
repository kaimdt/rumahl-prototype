# API Referenz

`iora-home` exponiert eine umfangreiche REST- und WebSocket-API.
Eine vollständige OpenAPI-3.0-Spezifikation ist unter

```
GET /api/openapi.json
```

abrufbar (Dokumentations-Endpoint).

## Wichtige Endpunkte

### Auth
- `POST /api/auth/login` — Username + Passwort, gibt JWT zurück.
- `POST /api/auth/pin-login` — PIN-basierter Login.

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

## Webhooks

Ausgehende Webhooks werden im Admin-Panel unter "Webhooks" verwaltet.
HMAC-Signatur (`X-IORA-Signature`) wird mit dem konfigurierten
Secret berechnet (HMAC-SHA256 über den rohen Body).
