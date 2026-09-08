---
title: rumahl Developers Portal
description: Das zentrale Entwickler-Portal, Organisationen, Teams, App-Registrierung, Verifizierung und stufenweise Rollouts.
readTime: 8 min
updated: 2026-09-05
featured: true
category: develop
---

Das **rumahl Developers Portal** ist die zentrale Schaltstelle für Entwickler, Entwicklungsstudios und Unternehmen, die Anwendungen, Erweiterungen oder Clouddienste für das rumahl-Ökosystem bereitstellen. Hier verwaltest du deine Organisationen, registrierst Apps, konfigurierst OAuth-Clients, überwachst Veröffentlichungen und analysierst Nutzungsmetriken.

## Überblick: Das Entwickler-Portal

Das Entwickler-Portal ist über die Web-Oberfläche sowie programmatisch über die Developer REST-API zugänglich.

| Komponente | URL / Zugriff | Funktion |
| --- | --- | --- |
| Entwickler-Konsole | `https://developers.rumahl.com` | Web-Dashboard für Apps, Schlüssel, Teamverwaltung und Releases |
| Lokale Instanz | `http://localhost:8126/developers` | Lokale Entwicklungsumgebung in selbst gehosteten Instanzen |
| Developer API | `https://api.rumahl.com/api/v1/developer` | REST-Schnittstelle zur CI/CD-Automatisierung |
| Identitätsdienst | `https://account.rumahl.com/oauth` | rumahl Konto Single Sign-On (SSO) und Consent-Verwaltung |

> **Hinweis:** Für den Zugriff auf rumahl Developers wird ein verifiziertes **rumahl Konto** mit aktivierter Zwei-Faktor-Authentifizierung (Passkeys oder TOTP) vorausgesetzt.

## Organisationen & Rollen

Im Entwickler-Portal sind Projekte in **Organisationen** strukturiert. Eine Organisation bündelt Anwendungen, API-Keys, Webhooks und Abrechnungsinformationen für ein Team.

### Rollenmatrix

| Rolle | Berechtigungen | Anwendungsfall |
| --- | --- | --- |
| **Owner** | Vollzugriff, Organisationslöschung, Eigentümerwechsel, Abrechnung | Gründer, Hauptverantwortliche |
| **Admin** | Mitglieder einladen/entfernen, Rollen vergeben, API-Keys verwalten, Releases freigeben | Teamleiter, DevOps-Leads |
| **Developer** | Apps anlegen, Code & Releases hochladen, Webhooks anpassen | Software-Ingenieure |
| **Viewer** | Lesezugriff auf Metriken, Release-Status und Audit-Logs | Projektleiter, Stakeholder |

### Teamverwaltung & Audit-Log

Alle kritischen Aktionen (z. B. Rollenänderungen, Secret-Generierung, Veröffentlichungen im Store) werden unveränderlich im **Audit-Log** der Organisation protokolliert:

- Zeitstempel und IP-Adresse des Akteurs
- Ausgeführte Operation (z. B. `api_key.create`, `release.rollout_started`)
- Zielobjekt und Status

## Apps & Produkte registrieren

Jede Anwendung im rumahl-Ökosystem benötigt einen eindeutigen Eintrag im Entwickler-Portal.

1. Öffne im Portal den Bereich **Apps & Produkte**.
2. Wähle **Neue App erstellen** und vergib einen Bezeichner im Reverse-Domain-Format (z. B. `com.example.smarthome`).
3. Wähle den App-Typ:
   - **Containerized App:** Eigenständige App mit Docker-Container für rumahl-supervisor.
   - **Sandbox Plugin:** Leichtgewichtiges Plugin für die JavaScript/TypeScript-Runtime.
   - **Cloud Service:** Externe Web-Anwendung mit Anbindung an das rumahl-Ökosystem.
4. Nach der Erstellung erhältst du sofort:
   - **Client-ID:** Öffentlicher Bezeichner für OAuth-Flows.
   - **Client-Secret:** Streng geheimer Schlüssel für Backend-zu-Backend-Kommunikation.
   - **Redirect-URIs:** Zugelassene Callback-URLs (HTTPS oder App-Schemata wie `rumahl-app://callback`).

### Manifest & Berechtigungen

Im Reiter **Berechtigungen** definierst du die vom System angeforderten Scopes:

```json
{
  "app_id": "com.example.smarthome",
  "name": "SmartHome Pro",
  "version": "1.2.0",
  "requested_scopes": [
    "rumahl.devices.read",
    "rumahl.devices.control",
    "rumahl.notifications.send"
  ],
  "oauth": {
    "redirect_uris": [
      "https://smarthome.example.com/api/auth/callback"
    ]
  }
}
```

## App-Prüfung & Verifizierung

Apps, die im offiziellen **rumahl App Store** für alle Nutzer veröffentlicht werden sollen, durchlaufen einen Verifizierungsprozess.

### Prüfschritte

1. **Automatisierte Validierung:**
   - Syntax- und Manifestprüfung
   - Statische Sicherheitsanalyse (Erkennung unsicherer Abhängigkeiten und Hardcoded Secrets)
   - Sandbox-Konformitätstest
2. **Manuelle Sicherheits- & Richtlinienprüfung:**
   - Einhaltung der Datenschutzrichtlinien (Datensparsamkeit)
   - Funktionstest der deklarierten Berechtigungen
   - Vollständigkeit von Impressum, Datenschutzerklärung und Kontaktangaben
3. **Status:**
   - `draft`: App in Bearbeitung
   - `in_review`: Prüfung durch das rumahl-Sicherheitsteam läuft
   - `approved`: Freigegeben für den Store
   - `rejected`: Nachbesserungen erforderlich (detaillierte Rückmeldung im Dashboard)

## Release-Kanäle & Phased Rollouts

rumahl unterstützt mehrstufige Veröffentlichungszyklen, um Updates risikoarm an Endnutzer auszurollen.

| Kanal | Zielgruppe | Zweck |
| --- | --- | --- |
| **Alpha** | Interne Tester & Entwickler | Schnelle Iterationen, tägliche Builds |
| **Beta** | Öffentliche Vorab-Tester (Opt-in) | Erkennung von Grenzfällen und Feedback |
| **Staging** | Produktive Testumgebungen | Finale Validierung vor dem Rollout |
| **Production** | Alle Endnutzer | Stabile Freigabe |

### Stufenweises Ausrollen (Phased Rollout)

Bei Produktions-Releases kannst du die Verteilung schrittweise steuern:

- **10%:** Frühwarnphase zur Überwachung von Crash-Statistiken
- **25% & 50%:** Erweiterter Test auf heterogener Hardware
- **100%:** Vollständige Bereitstellung für die gesamte Installationsbasis

Tritt während des Rollouts eine erhöhte Fehlerrate auf, kann das Release per Knopfdruck oder via API-Aufruf (`POST /releases/:id/halt`) sofort pausiert werden.

## Entwickler-Sicherheitsrichtlinien

Für alle im Portal registrierten Entwickler gelten strikte Sicherheitsstandards:

- **Passkey- oder 2FA-Pflicht:** Für alle Konten mit Schreib- oder Freigaberechten.
- **Client-Secret-Geheimhaltung:** Client-Secrets dürfen niemals in clientseitigen Anwendungen (Mobile Apps, SPAs) hinterlegt werden. Nutze dort stets PKCE.
- **Regelmäßige Secret-Rotation:** API-Keys und Secrets sollten mindestens alle 180 Tage rotiert werden. Das Portal unterstützt nahtlose Rotationen mit Übergangsfristen.
