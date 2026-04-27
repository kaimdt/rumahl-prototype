# Dynamic Overview System - Benutzerhandbuch

## Übersicht

Das Dynamic Overview System ermöglicht es, die Startseite (Übersicht) automatisch basierend auf der Tageszeit oder Entitätszuständen anzupassen. Dies schafft eine kontextbezogene, intelligente Benutzeroberfläche.

## Funktionen

### 1. Zeitbasierte Ansichten

Das System enthält vordefinierte Ansichten für verschiedene Tageszeiten:

- **Morgen** (6:00 - 12:00)
  - Zeigt: Begrüßung, Wetter, Uhr, Kalender, Sensoren
  - Ideal für: Tagesplanung und Wetterinformationen

- **Nachmittag** (12:00 - 18:00)
  - Zeigt: Begrüßung, Wetter, Kalender, Szenen
  - Ideal für: Tagesaktivitäten und Szenensteuerung

- **Abend** (18:00 - 22:00)
  - Zeigt: Begrüßung, Szenen, Sensoren
  - Ideal für: Entspannung und Beleuchtungsszenen

- **Nacht** (22:00 - 6:00)
  - Zeigt: Uhr, Szenen
  - Ideal für: Minimale Informationen, fokussiert auf Schlafszenen

### 2. Konfiguration

#### Aktivierung

1. Navigiere zu **Einstellungen**
2. Finde den Abschnitt **Dynamische Übersicht**
3. Aktiviere den Schalter

#### Ansicht auswählen

- Klicke auf eine der Ansichtskarten (Morgen, Nachmittag, Abend, Nacht, Standard)
- Die aktive Ansicht wird hervorgehoben
- Die Konfigurationsvorschau zeigt, welche Abschnitte sichtbar sind

#### Automatische Umschaltung

- Das System prüft alle 30 Sekunden die Trigger
- Basierend auf der aktuellen Uhrzeit wird die passende Ansicht aktiviert
- Du kannst jederzeit manuell eine andere Ansicht auswählen

### 3. Konfigurierbare Abschnitte

Jede Ansicht kann folgende Abschnitte anzeigen/verstecken:

- **Begrüßung** - Persönliche Begrüßung mit Kontextinformation
- **Wetter** - Wetterwidget mit aktueller Temperatur
- **Uhr** - Digitale Uhr, analoge Uhr
- **Kalender** - Kalenderwidget
- **Szenen** - Szenenauswahl für Lichtsteuerung
- **Sensoren** - Sensorwerte (Temperatur, Luftfeuchtigkeit, etc.)

### 4. Trigger-Typen

Das System unterstützt verschiedene Trigger:

#### Zeitbasierte Trigger
```typescript
{
  type: 'time',
  hour: 18,        // Stunde (0-23)
  minute: 0,       // Minute (0-59)
  days: [1,2,3,4,5] // Optional: Wochentage (0=Sonntag)
}
```

#### Entitätszustands-Trigger
```typescript
{
  type: 'entity_state',
  entity_id: 'sun.sun',
  state: 'below_horizon',
  condition: 'equals'  // oder: not_equals, greater_than, less_than, contains
}
```

#### Manuelle Trigger
```typescript
{
  type: 'manual',
  name: 'Standard'
}
```

### 5. Prioritätssystem

- Ansichten haben eine Priorität (höher = wichtiger)
- Bei mehreren passenden Triggern wird die Ansicht mit der höchsten Priorität aktiviert
- Standard-Ansicht hat Priorität 0 (niedrigste)
- Vordefinierte Ansichten haben Priorität 10

## Widget-Anpassung

### Größe ändern

1. Öffne **Seiten-Designer** in den Einstellungen
2. Wähle eine Seite aus
3. Klicke auf **Widgets bearbeiten**
4. Klicke auf das **Bearbeiten-Symbol** (⇱) neben einem Widget
5. Verwende die Schieberegler für Breite und Höhe
6. Beobachte die Vorschau im 4×4-Raster
7. Klicke auf **Speichern**

### Grid-Einheiten

- Widgets können 1-4 Grid-Einheiten breit und hoch sein
- 1 Einheit = minimale Größe
- 4 Einheiten = maximale Größe (volle Breite)
- Die Vorschau zeigt visuell, wie viel Platz das Widget einnehmen wird

## Responsive Design

### Automatische Anpassung

Das Dashboard passt sich automatisch an die Bildschirmgröße an:

- **Desktop (≥1024px)**: 3-spaltige Layouts
- **Tablet (640px-1023px)**: 2-spaltige Layouts
- **Smartphone (<640px)**: 1-spaltige Layouts

### Touch-Optimierung

- Alle Bedienelemente haben ausreichend große Tippflächen
- Schieberegler funktionieren sowohl mit Maus als auch Touch
- Keine Hover-Effekte, die auf mobilen Geräten nicht funktionieren

## Technische Details

### Speicherung

- Ansichten: `localStorage` unter `ha-overview-variants`
- Aktive Ansicht: `localStorage` unter `ha-active-overview-variant`
- Widget-Größen: In `DashboardPage.widgets[].size`

### Architektur

```
DynamicOverviewContext
├── Variants (Ansichten)
│   ├── id, name, description
│   ├── triggers (Trigger-Regeln)
│   ├── priority (Priorität)
│   └── config (Sichtbarkeitseinstellungen)
├── evaluateTriggers() - Prüft alle Trigger
└── setActiveVariantId() - Wechselt Ansicht
```

### Integration

Das System ist in `App.tsx` integriert:
- Provider-Ebene: `DynamicOverviewProvider`
- Trigger-Evaluation: Bei jedem Entity-Update
- Rendering: Bedingte Darstellung basierend auf `currentVariant.config`

## Best Practices

1. **Teste verschiedene Tageszeiten**
   - Stelle die Systemzeit um, um verschiedene Ansichten zu testen
   - Prüfe, ob die Ansichten sinnvoll konfiguriert sind

2. **Widget-Größen sinnvoll wählen**
   - Wichtige Widgets: 2×2 oder größer
   - Nebensächliche Widgets: 1×1
   - Berücksichtige mobile Ansicht (max. 1 Spalte)

3. **Ansichten kontextbezogen gestalten**
   - Morgens: Informationen für den Tag
   - Abends: Steuerung für Entspannung
   - Nachts: Minimal, nur Essentielles

4. **Prioritäten clever nutzen**
   - Höhere Priorität für spezifischere Bedingungen
   - Niedrigere Priorität für allgemeine Fallbacks

## Fehlerbehebung

### Ansicht wechselt nicht automatisch

- Prüfe, ob "Dynamische Übersicht" aktiviert ist
- Überprüfe die Browser-Konsole auf Fehler
- Stelle sicher, dass Home Assistant erreichbar ist

### Widget-Größe wird nicht übernommen

- Klicke auf "Speichern" nach der Änderung
- Prüfe, ob die Änderung in `localStorage` gespeichert wurde
- Lade die Seite neu

### Ansicht bleibt auf "Standard"

- Prüfe, ob Trigger korrekt konfiguriert sind
- Stelle sicher, dass die Uhrzeit korrekt ist
- Höhere Priorität könnte eine andere Ansicht aktivieren

## Zukünftige Erweiterungen

Mögliche Erweiterungen (nicht implementiert):

- Custom Trigger-Editor in der UI
- Hintergrundbilder pro Ansicht
- Widget-Sichtbarkeit pro Ansicht
- Export/Import von Konfigurationen
- Trigger-Historie und Logging
- Granulare Zeitsteuerung (z.B. nur Werktags)
