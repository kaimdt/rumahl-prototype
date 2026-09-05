---
title: Developer REST-API
description: Vollständige REST-API-Referenz für rumahl Developers: Apps, Releases, Binaries, Teammitglieder, Webhooks und API-Keys.
readTime: 10 min
updated: 2026-09-05
featured: true
category: develop
---

Die **rumahl Developer REST-API** ermöglicht Entwicklern und DevOps-Teams die vollständige Automatisierung von App-Verwaltung, Build-Uploads, Phased Rollouts, Webhook-Konfigurationen und Team-Berechtigungen.

## API-Grundlagen & Authentifizierung

| Umgebung | Basis-URL |
| --- | --- |
| Produktion | `https://api.rumahl.com/api/v1/developer` |
| Lokale Instanz | `http://localhost:8126/api/v1/developer` |

### Authentifizierung

Jeder API-Aufruf muss authentifiziert werden - entweder über ein OAuth-2.0-Access-Token oder über einen organisationsspezifischen API-Key:

```bash
# Variante 1: OAuth 2.0 Bearer Token
curl https://api.rumahl.com/api/v1/developer/products \
  -H "Authorization: Bearer <access_token>"

# Variante 2: Developer API-Key
curl https://api.rumahl.com/api/v1/developer/products \
  -H "X-API-Key: rk_live_9f8e7d6c5b4a3a2b1"
```

## Rate Limits & Fehlerbehandlung

Die API erzwingt dynamische Anfragelimits zur Wahrung der Systemstabilität. Jeder HTTP-Header liefert Auskunft über den aktuellen Kontingentstand:

| Header | Beschreibung |
| --- | --- |
| `X-RateLimit-Limit` | Maximale Anzahl an Anfragen im aktuellen Zeitfenster (z. B. `1000`) |
| `X-RateLimit-Remaining` | Verbleibende Anfragen im laufenden Fenster |
| `X-RateLimit-Reset` | Unix-Timestamp, wann das Kontingent zurückgesetzt wird |
| `Retry-After` | Sekunden bis zur Wiederholung bei Status 429 |

### Standard-Fehlerformat (RFC 7807)

Fehlerantworten werden stets im standardisierten Problem-Details-Format ausgeliefert:

```json
{
  "type": "https://api.rumahl.com/errors/invalid_manifest",
  "title": "Invalid App Manifest",
  "status": 400,
  "detail": "The required field 'version' does not follow semantic versioning standards.",
  "instance": "/api/v1/developer/products/prod_1029/releases"
}
```

## Produkte & App-Verwaltung

### 1. Alle Apps der Organisation abrufen
`GET /api/v1/developer/products`

```bash
curl -X GET https://api.rumahl.com/api/v1/developer/products \
  -H "X-API-Key: rk_live_9f8e7d6c5b4a3a2b1"
```

```json
{
  "products": [
    {
      "id": "prod_8829a",
      "app_id": "com.example.smarthome",
      "name": "SmartHome Pro",
      "status": "published",
      "current_version": "2.4.1",
      "created_at": "2026-01-15T10:00:00Z"
    }
  ]
}
```

### 2. Neue App registrieren
`POST /api/v1/developer/products`

```json
{
  "app_id": "com.example.sensorhub",
  "name": "Sensor Hub",
  "type": "container",
  "description": "Erweiterte Sensorfusion für rumahl Smart Home",
  "redirect_uris": ["https://sensorhub.example.com/oauth/callback"]
}
```

## Releases & Binär-Uploads

Releases werden in drei Schritten veröffentlicht: Erstellung des Release-Eintrags, Upload der Binärdatei/des Bundles und Start des Rollouts.

### 1. Release-Draft erstellen
`POST /api/v1/developer/products/:id/releases`

```json
{
  "version": "2.5.0",
  "channel": "beta",
  "changelog": "- Neuer Energiesparmodus\n- Unterstützung für Matter 1.4-Sensoren",
  "min_system_version": "2.0.0"
}
```

### 2. Release-Paket hochladen
`POST /api/v1/developer/products/:id/releases/:version/upload`

Das Paket muss als `tar.gz` oder `zip` hochgeladen werden. Die Prüfsumme (SHA-256) dient der Integritätsprüfung:

```bash
curl -X POST https://api.rumahl.com/api/v1/developer/products/prod_8829a/releases/2.5.0/upload \
  -H "X-API-Key: rk_live_9f8e7d6c5b4a3a2b1" \
  -H "X-File-SHA256: 4f8b...321c" \
  -F "bundle=@./dist/smarthome-2.5.0.tar.gz"
```

### 3. Rollout starten oder Prozentsatz aktualisieren
`POST /api/v1/developer/products/:id/releases/:version/rollout`

```json
{
  "target_percentage": 25,
  "auto_promote": true,
  "crash_threshold_percent": 1.5
}
```

## Organisationen & Mitglieder

Verwalte Teammitglieder und Berechtigungen programmatisch:

| Endpunkt | Methode | Beschreibung |
| --- | --- | --- |
| `/api/v1/developer/organizations` | `GET` | Liste der Organisationen des aktuellen Benutzers |
| `/api/v1/developer/organizations/:id/members` | `GET` | Alle Teammitglieder und zugewiesenen Rollen |
| `/api/v1/developer/organizations/:id/invites` | `POST` | Neues Teammitglied per E-Mail und Rolle einladen |
| `/api/v1/developer/organizations/:id/members/:userId` | `DELETE` | Mitglied aus der Organisation entfernen |

## API-Keys & Zugangsdaten

API-Keys ermöglichen CI/CD-Pipelines und externen Skripten den gesicherten Zugriff:

```bash
# Neuen Key anlegen mit Ablaufdatum und eingeschränktem Scope
curl -X POST https://api.rumahl.com/api/v1/developer/keys \
  -H "Authorization: Bearer <user_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "GitHub Actions Release Key",
    "scopes": ["developer.releases.publish"],
    "expires_in_days": 90
  }'
```

## Webhooks & Ereignisse

Webhooks informieren deine Server in Echtzeit über Ereignisse im rumahl-Ökosystem:

### Unterstützte Events
- `release.published`: Ein Release wurde erfolgreich für Endnutzer bereitgestellt.
- `release.halted`: Ein Rollout wurde automatisch wegen erhöhter Absturzrate gestoppt.
- `app.review_approved`: Die Store-Prüfung war erfolgreich.
- `app.review_rejected`: Nachbesserungen für den Store erforderlich.
- `user.consent_revoked`: Ein Nutzer hat den OAuth-Zugriff auf deine App widerrufen.

### Signaturprüfung (HMAC-SHA256)

Jeder Webhook-Request enthält den Header `X-Rumahl-Signature`. Dieser wird mit dem bei der Webhook-Registrierung erhaltenen Secret gebildet:

```
X-Rumahl-Signature: t=1757078400,v1=9b3a...78f0
```
