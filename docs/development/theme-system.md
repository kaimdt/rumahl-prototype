# Theme System

> IORA unterstützt ein vollständiges Theme-System, mit dem das visuelle Erscheinungsbild des gesamten Dashboards angepasst werden kann.

## Übersicht

Das Theme-System erlaubt es, das Design von **IORA Home**, **Custom Pages** und **Control Center** zu verändern. Themes können wie Apps installiert werden und sind pro Benutzer wählbar.

### Features

- **CSS-Variablen** – Farben, Abstände, Radien und Glass-Effekte
- **Custom Fonts** – Beliebige Webfonts (Google Fonts, selbst gehostet)
- **Icon Fonts** – Phosphor-Icons durch Font Awesome, Material Icons etc. ersetzen
- **Vollständiges CSS** – Komplette Kontrolle über jedes Element inkl. Animationen
- **Externe CSS-Dateien** – CSS-URLs für sehr große Themes
- **Eltern-Theme-Vererbung** – Theme kann ein bestehendes erweitern

### Funktionsweise

1. **Basisthemes**: IORA kommt mit 7 integrierten Themes (Tag, Nacht, Hell, Abend, Schlaf, Klassisch, Automatisch)
2. **Custom Themes**: Apps und Plugins können eigene Themes über ihr Manifest bereitstellen
3. **CSS-Variablen**: Themes definieren CSS-Custom-Properties, die auf `:root` angewendet werden
4. **Fonts & Icons**: Werden via `<link>` und `<style>` in den `<head>` injiziert
5. **Vererbung**: Custom Themes können ein Eltern-Theme erweitern (z.B. "night" als Basis)

### Architektur

```
App/Plugin Manifest
  └── theme: ThemeDefinition
       ├── id: "steampunk"
       ├── name: "Steampunk"
       ├── fonts: [                    ← Custom Webfonts
       │     { name, family, url, is_primary, is_heading, ... }
       │   ]
       ├── icon_font: {               ← Icon-Font-Ersatz
       │     font_name, font_url,
       │     class_prefix,
       │     icon_map: { "Lightbulb": "fa-regular fa-lightbulb", ... }
       │   }
       ├── css_variables: { ... }     ← CSS-Custom-Properties
       ├── additional_css: "..."       ← Volle CSS-Regeln
       └── css_url: "..."              ← Externe CSS-Datei

Beim Installieren der App/Plugin:
  → Theme wird in `installed_themes` Tabelle gespeichert
  → Theme erscheint im Theme-Picker der Settings-Seite

Benutzer wählt Theme in Settings:
  → Auswahl wird in `user_theme_selections` gespeichert
  → Frontend lädt Fonts, CSS-Variablen, zusätzliches CSS
  → Alles wird dynamisch in den <head> injiziert
```

## Theme für eine App/Plugin definieren

### Minimal-Beispiel (nur CSS-Variablen)

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
