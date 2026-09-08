# Makro Tracker – rumahl App

**Protein-, Kalorien- und Fett-Rechner für Kraftsportler.** Verfolge deine täglichen Makros, plane Mahlzeiten und sieh auf einen Blick, was du noch essen solltest.

## Features

- **Makro-Dashboard** – Protein, Fett, Kohlenhydrate & Kalorien auf einen Blick mit Fortschrittsbalken
- **Mahlzeiten-Log** – Trage Mahlzeiten nach Typ ein (Frühstück, Mittag, Abendessen, Snack, Pre/Post-Workout)
- **Lebensmittel-Datenbank** – 20+ vordefinierte Lebensmittel, beliebig erweiterbar
- **Favoriten-System** – Markiere häufig genutzte Lebensmittel als Favoriten
- **Schnell-Eintrag** – Eigenes Lebensmittel direkt eintragen ohne es in der DB zu speichern
- **Tagesziele** – Individuell anpassbare Makro-Ziele (Protein, Fett, Carbs, Kalorien)
- **Makro-Verteilung** – Grafische Darstellung der Kalorien-Verteilung (Protein vs Fett vs Carbs)
- **7-Tage-Übersicht** – Vergleiche deine Tage und sieh Trends
- **Tastatur-Navigation** – Pfeiltasten zum Blättern durch Tage, `T` für heute, `ESC` für Modals
- **Offline-Fähig** – Nutzt SQLite (lokal oder rumahl-managed)

## Installation

### Als rumahl App (empfohlen)

1. App als ZIP packen:
```bash
cd apps/examples/macro-tracker
zip -r macro-tracker.zip manifest.json package.json server.js public/ README.md
```

2. In rumahl installieren:
```bash
ora app install macro-tracker.zip
```

Oder via rumahl Control Center → App Store → "Install Custom App".

### Lokale Entwicklung

```bash
cd apps/examples/macro-tracker
npm install
node server.js
```

Öffne `http://localhost:3000` im Browser.

## Zielgruppe

Diese App richtet sich an **Kraftsportler und Bodybuilder**, die:

- Muskeln aufbauen möchten
- Ihre tägliche Protein-, Fett- und Kohlenhydrat-Zufuhr tracken
- Mahlzeiten planen und optimieren wollen
- Einen einfachen Überblick über ihren Kalorienhaushalt brauchen

## Empfohlene Makro-Verteilung (Muskelaufbau)

| Makro | Empfehlung |
|-------|------------|
| Protein | 1.6–2.2 g pro kg Körpergewicht |
| Fett | 0.8–1.0 g pro kg Körpergewicht |
| Kohlenhydrate | Restliche Kalorien auffüllen |
| Kalorienüberschuss | +300–500 kcal über Erhaltung |

**Standard-Ziele (80kg Athlet):**
- Protein: 180g (720 kcal)
- Fett: 70g (630 kcal)
- Carbs: 250g (1000 kcal)
- **Gesamt: ~2500 kcal** (Erhaltung) – für Aufbau auf 2800–3000 erhöhen

## API-Endpunkte

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/goals` | Aktuelle Makro-Ziele |
| PUT | `/api/goals` | Makro-Ziele aktualisieren |
| GET | `/api/foods` | Lebensmittel-DB (mit ?category=&search=) |
| GET | `/api/foods/categories` | Alle Kategorien |
| POST | `/api/foods` | Neues Lebensmittel |
| PUT | `/api/foods/:id` | Lebensmittel bearbeiten |
| DELETE | `/api/foods/:id` | Lebensmittel löschen |
| POST | `/api/foods/:id/toggle-favorite` | Favorit umschalten |
| GET | `/api/meals?date=YYYY-MM-DD` | Mahlzeiten für Datum |
| POST | `/api/meals` | Mahlzeit eintragen |
| DELETE | `/api/meals/:id` | Mahlzeit löschen |
| GET | `/api/summary?date=YYYY-MM-DD` | Tages-Zusammenfassung |
| GET | `/api/history` | Letzte 7 Tage |
| GET | `/health` | Health Check |

## Technologie

- **Backend**: Node.js, Express, better-sqlite3
- **Frontend**: Vanilla JS, CSS Custom Properties, kein Framework
- **Datenbank**: SQLite (lokal oder rumahl-managed)
- **Container**: Docker (node:20-alpine), Auto-Build

## Struktur

```
macro-tracker/
├── manifest.json          # rumahl App Manifest
├── package.json           # Node.js Dependencies
├── server.js              # Express Backend + SQLite
├── public/
│   ├── index.html         # UI + CSS
│   └── app.js             # Frontend Logik
└── README.md              # Diese Datei
```

## License

MIT
