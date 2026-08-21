---
title: App-Entwicklung
description: Apps und Plugins für rumahl bauen — das Manifest, Apps vs. Plugins, das ora.*-SDK und die Veröffentlichung im Store.
readTime: 7 min
updated: 2026-08-20
featured: true
---

rumahl bietet eine sichere, isolierte Umgebung zur Erweiterung der Plattform. Dieses Dokument ist der Einstiegspunkt für die Entwicklung von Apps und Plugins.

## Apps vs. Plugins

| | Apps | Plugins |
| --- | --- | --- |
| Laufzeit | Eigener Docker-Container | rumahl-Runtime-Sandbox |
| Sprache | Beliebig | JavaScript / TypeScript |
| Am besten für | Dienste, Datenbanken, Web-UIs | Widgets, Automatisierungen, KI-Tools |
| Ressourcenlimits | Container-Ebene | Strenge Sandbox-Limits |
| Verwaltet von | rumahl-supervisor | rumahl-Runtime |

**Entscheidungshilfe:** Brauchst du eine Datenbank, Hintergrundprozesse oder eine eigene UI? Baue eine **App**. Willst du ein Widget, eine Automatisierung oder ein ORA-Tool? Baue ein **Plugin**.

## Das App-Manifest

Jede App deklariert sich in einer `manifest.json` — Name, Berechtigungen und Lifecycle-Hooks:

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "permissions": ["AppStorageRead", "AppStorageWrite"],
  "lifecycle_hooks": {
    "hooks": [{ "event": "on_system_event", "filter": "security.*" }]
  }
}
```

Das Referenz-Beispiel ist die **Notes-App** (`apps/examples/apps/rumahl-notes`) — sie zeigt App-Speicher, Health-Checks und App-Token-Auth.

## Die ora.*-SDK-Oberfläche

| Modul | Zweck |
| --- | --- |
| `ora.notifications` | Benachrichtigungen senden |
| `ora.files` | Dateien auflisten, hochladen, verschieben, wiederherstellen |
| `ora.storage` | App-spezifischer Key-Value-Speicher |
| `ora.clipboard` | Zwischenablage-Verlauf, Anheften, Löschen |
| `ora.permissions` | Laufzeit-Berechtigungsanfragen |
| `ora.jobs` | System-Jobs erstellen und verfolgen |
| `ora.secrets` | App-spezifischer Geheimnis-Tresor |
| `ora.users` / `ora.devices` | Benutzer- und Geräteinformationen |
| `ora.home` | Automatisierungssteuerung |
| `ora.system.events` | System-Events abonnieren |

```js
import { rumahlClient } from "rumahl-sdk";

const ora = rumahlClient({ baseUrl: "http://localhost:8126" });
ora.setAppId("my-app");

await ora.notifications.send({ title: "Backup fertig", message: "Alles gut" });
const { files } = await ora.files.list({ folderId: null });
```

## Sicherheit & Berechtigungen

- Jeder SDK-Aufruf wird am API-Gateway berechtigungsgeprüft — bevor dein Code läuft
- Frage Berechtigungen zur Laufzeit mit `ora.permissions.request(...)` an — der Nutzer sieht einen Erlauben/Ablehnen-Dialog
- Speichere Zugangsdaten im Secrets-Tresor, niemals im Bundle oder in Logs
- Destruktive Operationen erfordern eine explizite Bestätigung durch den Nutzer

## Im Store veröffentlichen

1. Registriere dich als Entwickler im Entwickler-Dashboard
2. Reiche deine App ein — der Review prüft Sicherheit, Datenschutz, Inhalte und Qualität
3. Beantworte den Review; Ablehnungen sind begründet und innerhalb von 14 Tagen anfechtbar
4. Pflege deine App — Updates und Sicherheitspatches werden erwartet

> **Tipp:** Die vollständigen Regeln stehen in der Entwicklervereinbarung, den Review-Richtlinien und der Inhaltsrichtlinie unter /legal/app-store.
