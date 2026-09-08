---
title: Schnellstart
description: rumahl in unter fünf Minuten zum Laufen bringen — klonen, starten, Admin-Konto anlegen und das Dashboard erkunden.
readTime: 4 min
category: setup
updated: 2026-08-20
featured: true
---

Bring rumahl in unter fünf Minuten mit Docker zum Laufen. Du brauchst nur Docker Desktop oder Docker Engine und Git.

## Voraussetzungen

- Docker Desktop oder Docker Engine installiert
- Git installiert

## 1. Klonen und starten

```bash
git clone https://github.com/rumahl/rumahl.git
cd rumahl/deploy
cp ../.env.example ../.env
docker compose up -d
```

Warte 30–60 Sekunden, bis alle Dienste initialisiert sind.

## 2. Auf das Dashboard zugreifen

| Oberfläche | URL |
| --- | --- |
| **Dashboard** | `http://localhost:8126` |
| **Control Center** | `http://localhost:8091` |
| **API-Doku (Swagger)** | `http://localhost:8126/api/docs` |
| **Supervisor** | `http://localhost:8097` |

## 3. Erstes Admin-Konto anlegen

1. Öffne das Dashboard unter `http://localhost:8126`
2. Klicke auf **Create Account**
3. Trage deine Daten ein und vergib ein starkes Passwort
4. Melde dich mit deinen neuen Zugangsdaten an

## 4. Das Dashboard erkunden

Die linke Seitenleiste führt zu allen Bereichen:

- **Dashboard** – Widget-Raster für dein Smart Home
- **rumahl Control** – Admin-Panel (Benutzer, System, Plugins)
- **rumahl Assist** – KI-Chat-Oberfläche
- **App Store** – Apps und Plugins installieren

**Widget hinzufügen:** *Dashboard bearbeiten* → *Widget hinzufügen* → Typ wählen (Entity Card, Wetter, Uhr, …) → konfigurieren → speichern.

## 5. Home Assistant verbinden (optional)

1. Gehe zu **rumahl Control** → **Home Assistant**
2. Trage die Adresse deiner Instanz und deine Zugangsdaten ein
3. Geräte und Entitäten erscheinen automatisch im Dashboard

> **Tipp:** Der schnellste Weg durch das System ist die Spotlight-Suche — drücke `Ctrl+Space` und tippe, was du suchst.
