# App Theming Guide

> Vollständige Anleitung zum Verwenden, Anpassen und Erstellen von Themes in IORA Apps

## Übersicht

Das IORA Theme-System ermöglicht es Apps:
1. **Das IORA Theme zu übernehmen** - Nahtlose Integration mit dem aktuellen Theme
2. **Themes anzupassen** - Einzelne Farben und Variablen zu überschreiben
3. **Eigene Themes zu erstellen** - Vollständig benutzerdefinierte Designs

## Schnellstart

### 1. Theme-Client in deiner App einrichten

```typescript
import { IoraThemeClient } from '@iora/sdk'

// Theme-Client initialisieren
const themeClient = new IoraThemeClient('my-app-id', {
  inherit: true,  // IORA Theme übernehmen
})

// Auf Theme-Änderungen reagieren
themeClient.onThemeChange((theme) => {
  console.log('Theme aktualisiert:', theme.id, theme.mode)
})
```

### 2. IORA Theme verwenden (Standard)

Wenn deine App das IORA Theme verwenden soll, musst du nichts weiter tun:

```typescript
const themeClient = new IoraThemeClient('my-app-id', {
  inherit: true,  // Standard - übernimmt alle IORA CSS-Variablen
})
```

Alle CSS-Variablen von IORA sind automatisch verfügbar:

```css
.my-element {
  background: var(--background);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.accent-button {
  background: var(--accent);
  color: var(--accent-foreground);
}
```

### 3. Theme anpassen

Überschreibe einzelne Variablen für deine App:

```typescript
const themeClient = new IoraThemeClient('my-app-id', {
  inherit: true,
  variables: {
    // Hauptfarben anpassen
    'accent': '#ff6b6b',
    'accent-foreground': '#ffffff',
    
    // Abstände anpassen
    'spacing': '16px',
    
    // Benutzerdefinierte Variablen
    'my-custom-color': '#00ff00',
  },
})
```

### 4. Komplett eigenes Theme

Erstelle ein vollständig benutzerdefiniertes Theme:

```typescript
const themeClient = new IoraThemeClient('my-app-id', {
  inherit: false,  // Kein IORA Theme übernehmen
  variables: {
    // Definiere alle benötigten Variablen
    'background': '#1a1a2e',
    'foreground': '#eee',
    'card': '#16213e',
    'accent': '#0f3460',
    'border': '#e94560',
  },
  customCss: `
    body {
      font-family: 'Comic Sans MS', cursive;
    }
    
    .custom-widget {
      box-shadow: 0 0 20px var(--accent);
    }
  `,
  fonts: [
    {
      family: 'Roboto',
      url: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700',
      weights: '400;700',
    },
  ],
})
```

## Verfügbare CSS-Variablen

### Farben

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `--background` | Haupt-Hintergrundfarbe | `#1a1d2e` |
| `--foreground` | Haupt-Textfarbe | `#ffffff` |
| `--card` | Karten-Hintergrund | `#1e2230` |
| `--card-foreground` | Karten-Text | `#ffffff` |
| `--muted` | Sekundäre Flächen | `#2a2d3e` |
| `--muted-foreground` | Sekundärer Text | `#888888` |
| `--accent` | Akzentfarbe | `#6366f1` |
| `--accent-foreground` | Akzent-Text | `#ffffff` |
| `--border` | Rahmenfarbe | `#ffffff22` |
| `--input` | Input-Rahmen | `#ffffff33` |
| `--ring` | Fokus-Ring | `#6366f1` |
| `--success` | Erfolgsfarbe | `#22c55e` |
| `--destructive` | Fehlerfarbe | `#ef4444` |
| `--warning` | Warnfarbe | `#f59e0b` |
| `--info` | Info-Farbe | `#3b82f6` |

### Layout & Spacing

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `--radius` | Border-Radius | `0.75rem` |
| `--spacing` | Standard-Abstand | `1rem` |
| `--gap` | Grid/Flex-Gap | `0.75rem` |

### Effekte

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `--glass-blur` | Glass-Effekt Blur | `40px` |
| `--glass-opacity` | Glass-Effekt Opazität | `0.35` |
| `--transition-duration` | Standard-Übergang | `0.4s` |
| `--shadow-sm` | Kleiner Schatten | `0 1px 2px rgba(0,0,0,0.05)` |
| `--shadow-md` | Mittlerer Schatten | `0 4px 6px rgba(0,0,0,0.1)` |
| `--shadow-lg` | Großer Schatten | `0 10px 15px rgba(0,0,0,0.2)` |

### Typografie

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `--font-sans` | Sans-Serif Font | `'Inter', sans-serif` |
| `--font-heading` | Überschriften-Font | `'Cinzel', serif` |
| `--font-mono` | Monospace Font | `'JetBrains Mono', monospace` |

## API-Referenz

### IoraThemeClient

#### Konstruktor

```typescript
new IoraThemeClient(appId: string, config?: ThemeConfig)
```

**ThemeConfig:**

```typescript
interface ThemeConfig {
  inherit: boolean              // IORA Theme übernehmen (Standard: true)
  variables?: Record<string, string>  // Variable-Overrides
  customCss?: string           // Zusätzliches CSS
  cssFiles?: string[]          // CSS-Datei-URLs
  fonts?: Array<{
    family: string
    url: string
    weights?: string
    subsets?: string
  }>
  designModes?: Record<string, Record<string, string>>  // Design-Modi
}
```

#### Methoden

##### getTheme()

Gibt das aktuelle Theme zurück:

```typescript
const theme = themeClient.getTheme()
console.log(theme.id, theme.mode, theme.variables)
```

##### updateConfig()

Aktualisiert die Theme-Konfiguration:

```typescript
themeClient.updateConfig({
  variables: {
    'accent': '#00ff00',
  },
})
```

##### setVariables()

Setzt einzelne Variablen:

```typescript
themeClient.setVariables({
  'accent': '#ff0000',
  'border': '#ffffff44',
})
```

##### getVariable()

Liest eine Variable:

```typescript
const accentColor = themeClient.getVariable('accent')
// => '#6366f1'
```

##### getAllVariables()

Liest alle verfügbaren Variablen:

```typescript
const allVars = themeClient.getAllVariables()
// => { background: '#1a1d2e', foreground: '#ffffff', ... }
```

##### onThemeChange()

Reagiert auf Theme-Änderungen:

```typescript
const unsubscribe = themeClient.onThemeChange((theme) => {
  console.log('Theme geändert:', theme)
  // UI aktualisieren
})

// Später: unsubscribe()
```

##### isDark()

Prüft, ob das Theme dunkel ist:

```typescript
if (themeClient.isDark()) {
  // Dark Mode UI
} else {
  // Light Mode UI
}
```

##### exportConfig()

Exportiert die aktuelle Konfiguration:

```typescript
const config = themeClient.exportConfig()
// Kann gespeichert und später wiederhergestellt werden
```

##### destroy()

Räumt den Theme-Client auf:

```typescript
themeClient.destroy()
```

## Beispiele

### Beispiel 1: Einfache App mit IORA Theme

```html
<!DOCTYPE html>
<html>
<head>
  <title>My IORA App</title>
  <style>
    body {
      background: var(--background);
      color: var(--foreground);
      font-family: var(--font-sans);
      padding: 20px;
    }
    
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 12px;
    }
    
    .button {
      background: var(--accent);
      color: var(--accent-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: var(--radius);
      cursor: pointer;
      transition: opacity var(--transition-duration);
    }
    
    .button:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <h1>Meine App</h1>
  <div class="card">
    <h2>Status</h2>
    <p>Diese App verwendet das IORA Theme automatisch.</p>
    <button class="button">Aktion</button>
  </div>

  <script type="module">
    import { IoraThemeClient } from '@iora/sdk'
    
    // Theme-Client initialisieren
    const theme = new IoraThemeClient('my-app', { inherit: true })
    
    // Auf Theme-Änderungen reagieren
    theme.onThemeChange((t) => {
      console.log('Theme geändert:', t.id)
      document.body.setAttribute('data-theme', t.id)
    })
  </script>
</body>
</html>
```

### Beispiel 2: Angepasstes Farbschema

```typescript
import { IoraThemeClient } from '@iora/sdk'

const themeClient = new IoraThemeClient('weather-app', {
  inherit: true,
  variables: {
    // Wetterapp-spezifische Farben
    'accent': '#3b82f6',           // Himmelblau für Akzente
    'success': '#22c55e',          // Grün für sonnige Tage
    'warning': '#f59e0b',          // Orange für Warnungen
    'destructive': '#ef4444',      // Rot für Unwetter
    
    // Benutzerdefiniert
    'weather-sunny': '#fbbf24',
    'weather-cloudy': '#9ca3af',
    'weather-rainy': '#60a5fa',
    'weather-stormy': '#7c3aed',
  },
  customCss: `
    .weather-icon {
      filter: drop-shadow(0 0 10px var(--weather-sunny));
    }
    
    .temperature {
      font-size: 3rem;
      font-weight: 700;
      color: var(--accent);
    }
  `,
})

// React-Komponente
function WeatherWidget() {
  const [theme, setTheme] = useState(themeClient.getTheme())
  
  useEffect(() => {
    return themeClient.onThemeChange(setTheme)
  }, [])
  
  return (
    <div style={{
      background: `var(--card)`,
      color: `var(--foreground)`,
      padding: '20px',
      borderRadius: `var(--radius)`,
    }}>
      <div className="weather-icon">☀️</div>
      <div className="temperature">24°C</div>
      <p>Sonnig und warm</p>
    </div>
  )
}
```

### Beispiel 3: Vollständig eigenes Theme

```typescript
import { IoraThemeClient } from '@iora/sdk'

const themeClient = new IoraThemeClient('retro-app', {
  inherit: false,  // Kein IORA Theme
  variables: {
    // Retro Terminal Theme
    'background': '#000000',
    'foreground': '#00ff00',
    'card': '#001100',
    'accent': '#00ff00',
    'border': '#00ff00',
    'muted': '#003300',
    'radius': '0px',  // Keine abgerundeten Ecken
  },
  customCss: `
    * {
      font-family: 'Courier New', monospace !important;
      text-shadow: 0 0 2px var(--foreground);
    }
    
    body {
      background: var(--background);
      background-image: 
        repeating-linear-gradient(
          0deg,
          rgba(0, 255, 0, 0.05),
          rgba(0, 255, 0, 0.05) 1px,
          transparent 1px,
          transparent 2px
        );
    }
    
    .card {
      border: 2px solid var(--accent);
      box-shadow: 0 0 10px var(--accent);
    }
    
    button {
      border: 2px solid var(--accent);
      text-transform: uppercase;
      letter-spacing: 2px;
    }
  `,
})
```

### Beispiel 4: React Hook für Theme

```typescript
import { useEffect, useState } from 'react'
import { IoraThemeClient, ThemeInfo } from '@iora/sdk'

// Custom Hook
export function useIoraTheme(appId: string, config?: ThemeConfig) {
  const [client] = useState(() => new IoraThemeClient(appId, config))
  const [theme, setTheme] = useState<ThemeInfo | null>(client.getTheme())
  
  useEffect(() => {
    return client.onThemeChange(setTheme)
  }, [client])
  
  useEffect(() => {
    return () => client.destroy()
  }, [client])
  
  return {
    theme,
    isDark: client.isDark(),
    getVariable: (name: string) => client.getVariable(name),
    setVariables: (vars: Record<string, string>) => client.setVariables(vars),
  }
}

// Verwendung
function MyComponent() {
  const { theme, isDark, getVariable, setVariables } = useIoraTheme('my-app')
  
  const accentColor = getVariable('accent')
  
  return (
    <div>
      <p>Current theme: {theme?.name}</p>
      <p>Dark mode: {isDark ? 'Yes' : 'No'}</p>
      <p>Accent: {accentColor}</p>
      
      <button onClick={() => setVariables({ accent: '#ff0000' })}>
        Change Accent
      </button>
    </div>
  )
}
```

## Manifest-Integration

Du kannst Theme-Overrides auch im App-Manifest definieren:

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "theme": {
    "inherit": true,
    "variables": {
      "accent": "#ff6b6b",
      "accent-foreground": "#ffffff"
    },
    "fonts": [
      {
        "family": "Roboto",
        "url": "https://fonts.googleapis.com/css2?family=Roboto",
        "is_primary": true
      }
    ]
  }
}
```

## Best Practices

### 1. Immer IORA Theme als Basis verwenden

Für konsistente UX sollte deine App das IORA Theme als Basis verwenden:

```typescript
✅ const theme = new IoraThemeClient('app', { inherit: true })
❌ const theme = new IoraThemeClient('app', { inherit: false })
```

### 2. Nur notwendige Variablen überschreiben

```typescript
✅ variables: { 'accent': '#ff0000' }  // Nur Akzentfarbe ändern
❌ variables: { /* alle 50 Variablen neu definieren */ }
```

### 3. Responsive CSS verwenden

```css
.my-element {
  padding: var(--spacing);
  gap: var(--gap);
  border-radius: var(--radius);
}

@media (max-width: 640px) {
  .my-element {
    padding: calc(var(--spacing) * 0.75);
  }
}
```

### 4. Theme-Änderungen respektieren

```typescript
themeClient.onThemeChange((theme) => {
  // UI aktualisieren
  updateUI()
  
  // Analytics
  if (theme.mode === 'dark') {
    trackEvent('theme_dark')
  }
})
```

### 5. Dark/Light Mode unterstützen

```css
/* Automatisch anhand von var(--foreground) */
.text {
  color: var(--foreground);
  opacity: 0.8;
}

/* Oder programmatisch */
.icon {
  filter: brightness(
    ${themeClient.isDark() ? 0.8 : 1.2}
  );
}
```

## Troubleshooting

### Problem: CSS-Variablen funktionieren nicht

**Lösung:** Stelle sicher, dass der ThemeClient initialisiert ist:

```typescript
// ❌ Zu früh
const accent = getComputedStyle(document.documentElement)
  .getPropertyValue('--accent')

// ✅ Nach Initialisierung
const theme = new IoraThemeClient('app')
theme.onThemeChange(() => {
  const accent = theme.getVariable('accent')
})
```

### Problem: Theme-Änderungen werden nicht übernommen

**Lösung:** Prüfe, ob `inherit: true` gesetzt ist und kein Override existiert:

```typescript
themeClient.updateConfig({
  inherit: true,  // IORA Theme aktivieren
})
```

### Problem: Custom CSS wird nicht angewendet

**Lösung:** Verwende `!important` für Overrides:

```typescript
customCss: `
  .my-element {
    background: var(--accent) !important;
  }
`
```

## Weitere Ressourcen

- [Theme System Dokumentation](./theme-system.md)
- [App Development Guide](./app-development.md)
- [CSS Variables Reference](./css-variables.md)
- [Example Apps](../../apps/examples/)

## Support

Bei Fragen zum Theme-System:
- GitHub Issues: https://github.com/iora/iora/issues
- Dokumentation: https://docs.iora.io
- Community: https://community.iora.io
