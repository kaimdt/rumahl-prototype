# ORA Notes (Notizen)

Eine einfache, installierbare Notizen-App für ORA — das Referenzbeispiel für
**Lifestyle-Apps (Package 6)** und für Drittanbieter, die das **ORA App
Framework** (Package 2) nutzen wollen.

## Was die App demonstriert

| Framework-Fähigkeit | Verwendung |
|---|---|
| **App Storage (KV)** | Alle Notizen liegen als ein KV-Eintrag `notes` in der app-eigenen Storage-API (`/api/apps/ora-notes/storage/kv/notes`) — die App berührt die ORA-Datenbank nie direkt |
| **Custom Page** | Die App registriert eine Launcher-Seite (`/apps/ora-notes/`), die nach der Installation im ORA-Launcher erscheint |
| **Docker-Lifecycle** | `manifest.json` beschreibt Container, Health-Check und Ports — der Supervisor startet/stoppt die App |
| **App-Token** | `IORA_API_KEY` wird vom Supervisor injiziert; der Server authentifiziert damit alle Storage-Aufrufe |

## Installation

Die App wird wie jede App-Store-App installiert (App Store oder
Developer-Mode/ZIP-Installation). Danach erscheint **Notizen** im Launcher und
öffnet die eingebettete Web-UI.

## Entwicklung

```bash
# Lokal (ohne ORA): Storage-Aufrufe schlagen fehl, die App startet trotzdem
npm install
npm start            # http://localhost:3000

# In ORA: IORA_HOME_URL + IORA_API_KEY werden vom Supervisor gesetzt
```

## API

```
GET    /api/notes          → alle Notizen (neueste zuerst)
POST   /api/notes          { title, content } → neue Notiz
PUT    /api/notes/:id      { title?, content? } → aktualisieren
DELETE /api/notes/:id      → löschen
GET    /health             → Health-Check für den Supervisor
```

## Wie es funktioniert (App-Framework-Nutzung)

```js
// Persistenz: alles über die app-eigene Storage-API
await fetch(`${IORA_HOME}/api/apps/ora-notes/storage/kv/notes`, {
  headers: { 'Authorization': 'Bearer ' + process.env.IORA_API_KEY },
})
```

Das ist das empfohlene Muster für Drittanbieter-Apps: eigener Container,
eigene Web-UI, Daten über die ORA-App-APIs (Storage, DB, Scheduler,
Webhooks, Messaging) — ohne Wissen über die ORA-Interna.
