# Themed Weather App

> Beispiel-App, die zeigt, wie man das IORA Theme-System verwendet und anpasst

## Features

- **IORA Theme Inheritance** - Verwendet automatisch das aktuelle IORA Theme
- **Custom Color Variables** - Definiert eigene Wetter-spezifische Farben
- **Dynamic Theme Updates** - Reagiert auf Theme-Änderungen in Echtzeit
- **Interactive Controls** - Buttons zum Ändern der Akzentfarbe
- **Variable Inspector** - Zeigt alle aktiven CSS-Variablen an

## Verwendete Theme-Features

### 1. Theme Inheritance
Die App übernimmt alle CSS-Variablen von IORA:

```json
{
  "theme": {
    "inherit": true
  }
}
```

### 2. Custom Variables
Zusätzliche wetterspezifische Farben:

```json
{
  "variables": {
    "accent": "#3b82f6",
    "weather-sunny": "#fbbf24",
    "weather-cloudy": "#9ca3af",
    "weather-rainy": "#60a5fa",
    "weather-stormy": "#7c3aed"
  }
}
```

### 3. Theme Client Usage
Die App verwendet den `IoraThemeClient` (vereinfachte Inline-Version):

```javascript
const themeClient = new SimpleThemeClient('themed-weather-app', {
  inherit: true,
  variables: { /* custom vars */ }
})

// Auf Theme-Änderungen reagieren
themeClient.onThemeChange((theme) => {
  console.log('Theme updated:', theme)
  updateUI()
})

// Variablen dynamisch ändern
themeClient.setVariables({ accent: '#ff0000' })
```

## CSS Variables Verwendet

### Standard IORA Variables
- `--background`, `--foreground` - Haupt-Hintergrund und Text
- `--card`, `--card-foreground` - Karten-Styling
- `--muted`, `--muted-foreground` - Sekundäre Elemente
- `--accent`, `--accent-foreground` - Akzentfarben
- `--border` - Rahmenfarben
- `--radius` - Ecken-Rundung
- `--font-sans`, `--font-mono` - Schriftarten

### Custom Weather Variables
- `--weather-sunny` - Sonnen-Farbe (#fbbf24)
- `--weather-cloudy` - Wolken-Farbe (#9ca3af)
- `--weather-rainy` - Regen-Farbe (#60a5fa)
- `--weather-stormy` - Gewitter-Farbe (#7c3aed)

## Installation

1. Kopiere den Ordner nach `apps/installed/themed-weather-app/`
2. Die App wird automatisch im App Store erkannt
3. Installiere die App über den IORA App Store
4. Die App läuft im Iframe und übernimmt das aktuelle Theme

## Struktur

```
themed-weather-app/
├── manifest.json    # App-Manifest mit Theme-Config
├── index.html       # Haupt-App-Datei
└── README.md        # Diese Datei
```

## Theme-Integration

Die App zeigt verschiedene Theme-Integrationsmuster:

### Pattern 1: Standard-Elemente
```css
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
}
```

### Pattern 2: Karten-Design
```css
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
```

### Pattern 3: Custom Variables
```css
.weather-icon {
  filter: drop-shadow(0 0 10px var(--weather-sunny));
}
```

### Pattern 4: Dynamische Anpassung
```javascript
themeClient.setVariables({
  'accent': '#3b82f6'  // Himmelblau
})
```

## Lernziele

Diese App demonstriert:

1. ✅ **Theme Inheritance** - Wie man das IORA Theme übernimmt
2. ✅ **Variable Overrides** - Wie man einzelne Variablen anpasst
3. ✅ **Custom Variables** - Wie man eigene Variablen definiert
4. ✅ **Dynamic Updates** - Wie man auf Theme-Änderungen reagiert
5. ✅ **Interactive Controls** - Wie man Theme-Variablen zur Laufzeit ändert
6. ✅ **Variable Inspection** - Wie man alle aktiven Variablen anzeigt

## Weiterführende Ressourcen

- [App Theming Guide](../../../docs/development/app-theming.md)
- [Theme System Dokumentation](../../../docs/development/theme-system.md)
- [IORA SDK Dokumentation](../../../sdks/javascript/)

## Lizenz

MIT - Teil der IORA Beispiel-Apps
