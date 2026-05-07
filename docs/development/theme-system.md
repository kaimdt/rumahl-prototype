# Theme System

> IORA unterstützt ein vollständiges Theme-System, mit dem das visuelle Erscheinungsbild des gesamten Dashboards angepasst werden kann.

## Übersicht

Das Theme-System erlaubt es, das Design von **IORA Home**, **Custom Pages** und **Control Center** zu verändern. Themes können wie Apps installiert werden und sind pro Benutzer wählbar.

### Features

- **CSS-Variablen** – Farben, Abstände, Radien und Glass-Effekte
- **Layout-Variablen** – Navigation (bottom/side/top), Header-Style, Content-Breite per CSS-Variable
- **HTML-Templates** – Komplette Seitenstruktur per HTML-Template überschreiben (Slots für React-Komponenten)
- **Custom Fonts** – Beliebige Webfonts (Google Fonts, selbst gehostet)
- **Icon Fonts** – Phosphor-Icons durch Font Awesome, Material Icons etc. ersetzen
- **Vollständiges CSS** – Komplette Kontrolle über jedes Element inkl. Animationen
- **Externe CSS-/JS-Dateien** – Für komplexe Themes mit eigenem JavaScript
- **Eltern-Theme-Vererbung** – Theme kann ein bestehendes erweitern

### Funktionsweise

1. **Basisthemes**: IORA kommt mit 7 integrierten Themes (Tag, Nacht, Hell, Abend, Schlaf, Klassisch, Automatisch)
2. **Custom Themes**: Apps und Plugins können eigene Themes bereitstellen
3. **File-based Themes (empfohlen)**: ZIP-Paket mit `manifest.json` + separaten CSS/JS/HTML-Dateien
4. **Inline Themes (einfach)**: Alles in der `manifest.json` für schnelle Prototypen
5. **CSS-Variablen**: Themes definieren CSS-Custom-Properties, die auf `:root` angewendet werden
6. **Fonts & Icons**: Werden via `<link>` und `<style>` in den `<head>` injiziert
7. **Vererbung**: Custom Themes können ein Eltern-Theme erweitern (z.B. "night" als Basis)

### Theme-Typen: Inline vs. File-based

| Feature | Inline (`"source": "inline"`) | File-based (`"source": "file"`) |
|---------|------|-------------|
| CSS | `additional_css` im Manifest (ein String) | `css_files: ["theme.css", ...]` – separate Dateien |
| JavaScript | ❌ Nicht möglich | `js_files: ["theme.js", ...]` – separate Dateien |
| HTML-Templates | ❌ Nicht möglich | `html_templates: {"layout": "html/layout.html"}` |
| Verteilung | Einzelne JSON-Datei | ZIP-Paket |
| Use Case | Schnelle Farb-Themes | Komplette Theme-Pakete |

### Architektur (File-based Theme)

```
Theme ZIP-Paket:
  ├── manifest.json              ← Theme-Definition + CSS-Variablen
  ├── theme.css                  ← Haupt-Stylesheet
  ├── components.css             ← Weitere Stylesheets (optional)
  ├── theme.js                   ← Client-seitige Interaktivität
  ├── i18n/                      ← Optional: Übersetzungen (Frontend lädt automatisch)
  │   ├── en.json
  │   └── de.json
  ├── html/
  │   └── layout.html            ← HTML-Seitenlayout (Slots)
  ├── fonts/                     ← Selbst gehostete Fonts (optional)
  │   └── custom-font.woff2
  └── images/                    ← Theme-Assets (optional)
      └── preview.png

manifest.json → ThemeDefinition
  ├── id, name, version
  ├── source: "file"
  ├── parent_theme: "night"
  ├── css_variables: { ... }     ← Design Tokens
  ├── css_files: ["theme.css"]   ← CSS-Dateien (aus ZIP extrahiert)
  ├── js_files: ["theme.js"]     ← JS-Dateien (client-only)
  ├── fonts: [ ... ]
  ├── icon_font: { ... }
  └── html_templates: {          ← HTML-Templates
        "layout": "html/layout.html"
      }

Installation:
  → ZIP wird entpackt nach data/themes/{id}/
  → Dateien werden statisch via /api/themes/assets/{id}/... serviert
  → DB-Eintrag in installed_themes Tabelle

Theme-Aktivierung (Frontend):
  → CSS-Variablen auf :root
  → CSS-Dateien via <link> geladen
  → JS-Dateien via <script> geladen
  → HTML-Templates via fetch() + TemplateRenderer
  → Fonts & Icons injiziert
```

## Übersetzungen (i18n) für Themes

Themes können eigene Sprachdateien mitliefern, wenn sie **eigene Texte** (z.B. für `capabilities.custom_settings`) hinzufügen.

### Dateikonvention

Lege im ZIP-Verzeichnis einen Ordner `i18n/` an:

- `i18n/en.json`
- `i18n/de.json`

Diese Dateien werden vom Frontend automatisch geladen, sobald das Theme aktiv ist.
Die Dateien werden unter dem Namespace `theme-<theme_id>` registriert.

### i18n-Keys in `capabilities.custom_settings`

Für Custom Settings können optional Übersetzungs-Keys angegeben werden:

- `name_key` statt `name`
- `description_key` statt `description`
- `options[].label_key` statt `options[].label`

Beispiel (Ausschnitt):

```json
{
  "capabilities": {
    "custom_settings": [
      {
        "id": "steam_particles",
        "name": "Steam Particles",
        "name_key": "settings.steamParticles.name",
        "description_key": "settings.steamParticles.desc",
        "setting_type": "toggle",
        "default_value": true
      }
    ]
  }
}
```

In `i18n/en.json`:

```json
{
  "settings": {
    "steamParticles": {
      "name": "Steam particles",
      "desc": "Adds subtle animated steam effects."
    }
  }
}
```

## Theme für eine App/Plugin definieren

### File-based Theme (empfohlen)

Ein Theme als ZIP-Paket mit separaten CSS/JS/HTML-Dateien:

**Ordnerstruktur:**
```
my-theme/
├── manifest.json
├── theme.css
├── theme.js          (optional)
└── html/
    └── layout.html   (optional)
```

**manifest.json:**
```json
{
  "id": "my-theme-app",
  "name": "My Theme",
  "type": "plugin",
  "plugin_type": "theme",
  "permissions": ["ThemeInstall"],
  "theme": {
    "id": "my-custom-theme",
    "name": "My Custom Theme",
    "version": "1.0.0",
    "source": "file",
    "parent_theme": "night",
    "css_files": ["theme.css"],
    "js_files": ["theme.js"],
    "html_templates": {
      "layout": "html/layout.html"
    },
    "css_variables": {
      "background": "oklch(0.15 0.02 260)",
      "accent": "oklch(0.6 0.22 260)"
    }
  }
}
```

**theme.css – eigenständiges Stylesheet:**
```css
/* Alle CSS-Regeln in einer separaten Datei */
.glass-card {
  border-radius: 16px;
  box-shadow: 0 4px 16px oklch(0 0 0 / 0.2);
}

.glass-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px oklch(0 0 0 / 0.3);
}

@keyframes card-enter {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```

**theme.js – client-seitige Interaktivität:**
```js
// Läuft NUR im Browser – kein Server-Zugriff
(function() {
  'use strict';
  window.__iora_theme = { id: 'my-custom-theme', version: '1.0.0' };
  
  // Ripple-Effekt auf Klicks
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.glass-card');
    if (card) {
      // Ripple-Logik...
    }
  });
})();
```

**Paketierung & Installation:**
```bash
# ZIP erstellen
zip -r my-theme.zip manifest.json theme.css theme.js html/

# Installieren
ora app install my-theme.zip
```

Vollständiges Beispiel: `apps/examples/material-sidebar-theme/`

### Inline-Theme (einfach, nur CSS-Variablen)

```json
{
  "id": "my-forest-app",
  "name": "Forest Dashboard",
  "type": "plugin",
  "plugin_type": "theme",
  "permissions": ["ThemeInstall"],
  "theme": {
    "id": "forest-green",
    "name": "Forest Green",
    "parent_theme": "day",
    "css_variables": {
      "background": "oklch(0.12 0.03 160)",
      "foreground": "oklch(0.85 0.02 160)",
      "accent": "oklch(0.55 0.2 150)"
    }
  }
}
```

### Vollständiges Beispiel (Fonts, Icons, Custom CSS)

Siehe `apps/examples/steampunk-theme/manifest.json` für ein vollständiges Steampunk-Theme mit:

- 3 Custom Fonts (Playfair Display, Cinzel Decorative, Courier Prime)
- Font Awesome Icons als Phosphor-Ersatz
- 50+ CSS-Variablen für Farben und Glass-Effekte
- 400+ Zeilen Custom CSS für komplette Steampunk-Optik
- Benutzerdefinierte Cursor, Scrollbars, Animationen

## Layout-System

Themes können das komplette Seitenlayout auf zwei Arten verändern:

### 1. Layout-CSS-Variablen (einfach)

Durch Setzen von Layout-Variablen in `css_variables` kann das Layout ohne HTML-Templates verändert werden:

| Variable | Werte | Beschreibung |
|----------|-------|-------------|
| `layout-nav-position` | `bottom`, `left`, `right`, `top`, `none` | Position der Navigation |
| `layout-nav-width` | z.B. `240px` | Breite der Sidebar-Navigation |
| `layout-header-style` | `glass`, `compact`, `hidden`, `floating` | Header-Darstellung |
| `layout-content-max-width` | z.B. `1200px` | Maximale Content-Breite |
| `layout-card-radius` | z.B. `1.5rem` | Widget-Card Border-Radius |
| `layout-widget-gap` | z.B. `1.5rem` | Abstand zwischen Widgets |

**Beispiel: Navigation von unten nach links verschieben**
```json
"css_variables": {
  "layout-nav-position": "left",
  "layout-nav-width": "240px",
  "layout-header-style": "compact"
}
```

### 2. HTML-Templates (vollständige Kontrolle)

Themes können das komplette Seiten-Markup per HTML-Template neu definieren.
Das Template verwendet `data-slot="name"` Attribute, an denen React-Komponenten
eingefügt werden.

**Verfügbare Slots:**

| Slot-Name | Inhalt |
|-----------|--------|
| `header` | Header-Bar (Uhr, Status, Titel) |
| `navigation` | Navigationskomponente |
| `content` | Hauptinhalt (Widgets, Seiten) |
| `sidebar` | Optionale Sidebar |
| `status-bar` | Status-/Benachrichtigungsleiste |
| `background` | Hintergrund-Ebene |
| `toast` | Toast-Benachrichtigungen |
| `assistant` | AI-Assistant Widget |

**Beispiel: Dreispaltiges Layout**
```html
<!-- html/layout.html -->
<div style="display:grid; grid-template-columns:240px 1fr 280px; min-height:100vh">
  <header data-slot="header" style="grid-column:1/-1"></header>
  <nav data-slot="navigation"></nav>
  <main data-slot="content"></main>
  <aside data-slot="sidebar"></aside>
</div>
```

```json
// manifest.json
{
  "theme": {
    "source": "file",
    "html_templates": {
      "layout": "html/layout.html"
    }
  }
}
```

Das Theme wird als ZIP mit `manifest.json` + `html/layout.html` (+ CSS/JS-Dateien) verteilt.

### Verfügbare CSS-Variablen

| Variable | Beschreibung | Standard (Day) |
|----------|-------------|----------------|
| `--background` | Hintergrundfarbe | `oklch(0.96 0.005 240)` |
| `--foreground` | Textfarbe | `oklch(0.18 0.02 240)` |
| `--card` | Kartenhintergrund | `oklch(0.98 0.002 240)` |
| `--card-foreground` | Kartentext | `oklch(0.18 0.02 240)` |
| `--accent` | Akzentfarbe | `oklch(0.55 0.22 210)` |
| `--accent-foreground` | Akzenttext | `oklch(0.98 0 0)` |
| `--muted` | Gedämpfter Hintergrund | `oklch(0.93 0.008 240)` |
| `--muted-foreground` | Gedämpfter Text | `oklch(0.45 0.02 240)` |
| `--border` | Rahmenfarbe | `oklch(0.86 0.008 240)` |
| `--success` | Erfolgsfarbe | `oklch(0.55 0.18 140)` |
| `--destructive` | Fehlerfarbe | `oklch(0.52 0.24 25)` |
| `--glass-bg` | Glass-Effekt Hintergrund | `oklch(...)` |
| `--radius` | Border-Radius | `0.75rem` |
| `--font-heading` | Überschriftenschrift | (nur Custom Themes) |
| `--font-mono` | Monospace-Schrift | (nur Custom Themes) |

### Fonts definieren

```json
"fonts": [
  {
    "name": "Playfair Display",
    "family": "'Playfair Display', 'Georgia', serif",
    "url": "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap",
    "weights": "400;700;900",
    "subsets": "latin",
    "is_primary": true,
    "is_heading": false,
    "is_monospace": false
  }
]
```

- `is_primary`: Wird als body-Schriftart gesetzt
- `is_heading`: Wird als `--font-heading` CSS-Variable gesetzt
- `is_monospace`: Wird als `--font-mono` CSS-Variable gesetzt

### Icon-Fonts konfigurieren

```json
"icon_font": {
  "font_name": "Font Awesome 6 Free",
  "font_url": "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
  "class_prefix": "fa-regular",
  "icon_map": {
    "Lightbulb": "fa-regular fa-lightbulb",
    "Gear": "fa-solid fa-gear",
    "Users": "fa-solid fa-users"
  }
}
```

## Theme Capabilities

Über das `capabilities`-Feld im Manifest können Themes weitreichende Kontrolle übernehmen:

### Design Modes

Themes können eigene Design-Modi hinzufügen, die im Theme-Picker erscheinen:

```json
"capabilities": {
  "design_modes": [
    {
      "id": "aurora",
      "name": "Aurora",
      "icon": "Fire",
      "time_start": "05:00", "time_end": "09:00",
      "css_variables": {
        "background": "oklch(0.20 0.05 300)",
        "accent": "oklch(0.65 0.25 320)"
      }
    }
  ]
}
```

### Auto-Verhalten

Das automatische Umschalten zwischen Modi kann angepasst werden:

```json
"capabilities": {
  "auto_behavior": {
    "mode": "time",
    "time_ranges": {
      "aurora": { "start": "05:00", "end": "09:00" },
      "day": { "start": "09:00", "end": "18:00" },
      "night": { "start": "18:00", "end": "05:00" }
    },
    "default_mode": "day"
  }
}
```

### Akzentfarbe

Themes können die Akzentfarbe:
- **Freigeben** (`"mode": "user"`) – Nutzer wählt selbst
- **Erzwingen** (`"mode": "force"`) – Theme legt Farbe fest
- **Vorgeben** (`"mode": "presets"`) – Theme bietet Auswahl

```json
"accent_control": {
  "mode": "force",
  "forced_color": "oklch(0.60 0.22 260)"
}
```

### Glaseffekt

Themes können den Glaseffekt:
- **Freigeben** (`"mode": "user"`) – Nutzer konfiguriert
- **Erzwingen** (`"mode": "force_on"`) – Immer an
- **Deaktivieren** (`"mode": "force_off"`) – Flat Design
- **Werte setzen** (`"mode": "force_values"`) – Spezifische Blur/Opacity

### Custom Settings

Themes können eigene Einstellungsfelder definieren, die im Settings-Tab
**unterhalb** des Theme-Wechslers erscheinen:

```json
"custom_settings": [
  {
    "id": "animation_speed",
    "name": "Animationsgeschwindigkeit",
    "description": "0 = aus, 100 = schnell",
    "setting_type": "slider",
    "default_value": 50,
    "min": 0, "max": 100, "step": 5,
    "css_variable": "theme-anim-speed"
  },
  {
    "id": "dark_widgets",
    "name": "Dunkle Widgets",
    "setting_type": "toggle",
    "default_value": false
  }
]
```

Unterstützte `setting_type`-Werte: `toggle`, `select`, `slider`, `color`, `text`.

Wenn `css_variable` gesetzt ist, wird der Wert automatisch als CSS-Variable
auf `:root` gesetzt (z.B. `--theme-anim-speed: 50`).

### JavaScript-Dateien

File-based Themes (ZIP) können JavaScript-Dateien enthalten, die automatisch
geladen werden:

```json
{
  "theme": {
    "source": "file",
    "js_files": ["js/theme.js", "js/animations.js"]
  }
}
```

Die JS-Dateien werden in Reihenfolge als `<script>`-Tags geladen und können:
- DOM-Manipulationen durchführen
- Event-Listener für Theme-Interaktionen registrieren
- Auf `window.__iora_theme` zugreifen (Theme-Metadaten)
- CSS-Variablen dynamisch ändern

**Beispiel `js/theme.js`:**
```js
// Theme-Initialisierung
console.log('[Theme] Geladen:', window.__iora_theme?.id)

// Partikel-Effekt auf Hintergrund
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.createElement('canvas')
  canvas.id = 'theme-particles'
  // ... Partikel-Animation
})
```

### Vollständiges CSS

Das `additional_css`-Feld erlaubt **jegliche CSS-Regeln**:

- Selektoren für Widgets, Karten, Header
- `@keyframes` Animationen
- `@import` für externe Stylesheets
- `::-webkit-scrollbar` für Custom Scrollbars
- Benutzerdefinierte Cursor via `url()`
- Responsive Design via `@media`
- `:hover`, `:active`, `:focus` Zustände
- `!important` wo nötig für Überschreibungen

## Themes verwalten

### Admin Panel (Control Center)

Im Admin Panel unter **Apps, Plugins & Themes > Themes** können Admins:
- Alle installierten Themes sehen
- Themes deinstallieren
- Status (aktiv/inaktiv) sehen

### Settings (pro Benutzer)

Jeder Benutzer wählt sein Theme in den **Settings > Darstellung > Design-Modus**:
- **Automatisch**: Wechselt nach Tageszeit zwischen Tag und Nacht
- **Festes Theme**: Ein bestimmtes Theme dauerhaft verwenden
- **Custom Themes**: Von Apps/Plugins installierte Themes

### API

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/api/themes` | Alle verfügbaren Themes auflisten |
| `POST` | `/api/themes/install` | Theme aus Manifest installieren |
| `DELETE` | `/api/themes/:id` | Custom Theme deinstallieren |
| `GET` | `/api/themes/user/:profile_id` | Benutzer-Auswahl abrufen |
| `POST` | `/api/themes/user/:profile_id` | Benutzer-Auswahl speichern |
| `GET` | `/api/themes/css/:profile_id` | Kompilierte Theme-Daten abrufen (CSS, Fonts, Icons) |

## Beispiel: Steampunk Theme

Das vollständige Steampunk-Theme befindet sich in `apps/examples/steampunk-theme/manifest.json`.

Es demonstriert:
- **3 Google Fonts**: Cinzel Decorative (UI), Playfair Display (Headings), Courier Prime (Monospace)
- **Font Awesome Icons**: Phosphor-Icons werden durch FA ersetzt
- **~50 CSS-Variablen**: Komplette Farbpalette in OKLCH (Messing, Kupfer, Bronze, Leder)
- **~400 Zeilen Custom CSS**: Alles von Widget-Karten über Scrollbars bis zu benutzerdefinierten Cursorn
- **CSS-Animationen**: Dampf-Effekte (`@keyframes steam-puff`) und Zahnrad-Drehungen
- **Responsive**: Weniger Dekoration auf Mobilgeräten

### Installation

```bash
# ZIP erstellen und per CLI installieren
cd apps/examples/steampunk-theme
zip -r steampunk-theme.zip manifest.json
ora app install steampunk-theme.zip

# Dann in Settings > Darstellung > Design-Modus auswählen
```

## Permissions

| Permission | Level | Beschreibung |
|-----------|-------|-------------|
| `ThemeInstall` | Medium | Themes aus App-/Plugin-Manifesten installieren |
| `ThemeManage` | Critical | Installierte Themes verwalten (löschen) |
| `ThemeSelect` | Low | Themes pro Benutzer auswählen |
