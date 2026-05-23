# Modal & Notification Configuration for All 10 Themes

## Summary

Added `modals` and `notifications` blocks to the `theme.capabilities` of all 10 theme manifests in `apps/examples/`.

## Files Modified

| # | Theme | Manifest File | Theme ID |
|---|-------|--------------|----------|
| 1 | Steampunk | `steampunk-theme/manifest.json` | `steampunk-revolution` |
| 2 | Ocean | `ocean-theme/manifest.json` | `ocean-blue` |
| 3 | Material | `material-sidebar-theme/manifest.json` | `material-sidebar` |
| 4 | Three Column | `full-layout-theme/manifest.json` | `three-column-dark` |
| 5 | Sidebar | `sidebar-theme/manifest.json` | `sidebar-dark` |
| 6 | Cyberpunk | `cyberpunk-neon/manifest.json` | `cyberpunk-neon` |
| 7 | Nordic | `nordic-light/manifest.json` | `nordic-light` |
| 8 | Forest | `forest-cabin/manifest.json` | `forest-cabin` |
| 9 | Synthwave | `synthwave-sunset/manifest.json` | `synthwave-sunset` |
| 10 | Monochrome | `monochrome-pro/manifest.json` | `monochrome-pro` |

## Modal Configs (per theme)

### Steampunk
```json
{
  "backdrop": "dim", "backdrop_blur": 4, "backdrop_opacity": 0.7,
  "radius": "3px", "border": "1px solid oklch(0.45 0.08 80)",
  "enter_animation": "scale", "exit_animation": "fade",
  "close_button": "circle", "shadow": "lg"
}
```

### Ocean
```json
{
  "backdrop": "blur", "backdrop_blur": 24, "backdrop_opacity": 0.5,
  "radius": "1rem",
  "enter_animation": "slide-up", "exit_animation": "slide-down",
  "close_button": "circle", "shadow": "md"
}
```

### Material
```json
{
  "backdrop": "dim", "backdrop_blur": 8, "backdrop_opacity": 0.5,
  "radius": "16px",
  "enter_animation": "scale", "exit_animation": "scale",
  "close_button": "circle", "shadow": "xl"
}
```

### Three Column
```json
{
  "backdrop": "blur", "backdrop_blur": 12, "backdrop_opacity": 0.6,
  "radius": "12px",
  "enter_animation": "slide-up", "exit_animation": "fade",
  "close_button": "x", "shadow": "md"
}
```

### Sidebar
```json
{
  "backdrop": "blur", "backdrop_blur": 20, "backdrop_opacity": 0.5,
  "radius": "16px",
  "enter_animation": "scale", "exit_animation": "slide-down",
  "close_button": "circle", "shadow": "lg"
}
```

### Cyberpunk
```json
{
  "backdrop": "solid", "backdrop_blur": 0, "backdrop_opacity": 0.85,
  "radius": "2px", "border": "1px solid oklch(0.65 0.28 0 / 0.5)",
  "enter_animation": "slide-up", "exit_animation": "fade",
  "close_button": "x", "shadow": "none"
}
```

### Nordic
```json
{
  "backdrop": "blur", "backdrop_blur": 16, "backdrop_opacity": 0.3,
  "radius": "1.5rem",
  "enter_animation": "scale", "exit_animation": "fade",
  "close_button": "circle", "shadow": "sm"
}
```

### Forest
```json
{
  "backdrop": "dim", "backdrop_blur": 8, "backdrop_opacity": 0.6,
  "radius": "1rem",
  "enter_animation": "slide-up", "exit_animation": "slide-down",
  "close_button": "pill", "shadow": "md"
}
```

### Synthwave
```json
{
  "backdrop": "solid", "backdrop_blur": 0, "backdrop_opacity": 0.8,
  "radius": "4px", "border": "1px solid oklch(0.62 0.28 340)",
  "enter_animation": "scale", "exit_animation": "scale",
  "close_button": "x", "shadow": "lg"
}
```

### Monochrome
```json
{
  "backdrop": "dim", "backdrop_blur": 0, "backdrop_opacity": 0.5,
  "radius": "6px",
  "enter_animation": "fade", "exit_animation": "fade",
  "close_button": "x", "shadow": "sm"
}
```

## Notification Configs (per theme)

### Steampunk
```json
{
  "position": "bottom-left", "enter": "slide-right", "exit": "slide-left",
  "radius": "3px", "accent_bar": true, "max": 3, "dismiss": 8000
}
```

### Ocean
```json
{
  "position": "bottom-right", "enter": "slide-up", "exit": "fade",
  "radius": "12px", "accent_bar": true, "max": 5, "dismiss": 5000
}
```

### Material
```json
{
  "position": "bottom-right", "enter": "slide-left", "exit": "slide-right",
  "radius": "12px", "accent_bar": false, "max": 4, "dismiss": 4000
}
```

### Three Column
```json
{
  "position": "top-right", "enter": "slide-right", "exit": "fade",
  "radius": "8px", "accent_bar": true, "max": 5, "dismiss": 6000
}
```

### Sidebar
```json
{
  "position": "bottom-left", "enter": "slide-up", "exit": "fade",
  "radius": "12px", "accent_bar": true, "max": 4, "dismiss": 5000
}
```

### Cyberpunk
```json
{
  "position": "top-right", "enter": "slide-left", "exit": "slide-right",
  "radius": "2px", "accent_bar": true, "max": 3, "dismiss": 3000
}
```

### Nordic
```json
{
  "position": "bottom-right", "enter": "fade", "exit": "fade",
  "radius": "16px", "accent_bar": false, "max": 5, "dismiss": 5000
}
```

### Forest
```json
{
  "position": "bottom-right", "enter": "slide-up", "exit": "slide-down",
  "radius": "12px", "accent_bar": true, "max": 4, "dismiss": 6000
}
```

### Synthwave
```json
{
  "position": "top-right", "enter": "slide-left", "exit": "slide-right",
  "radius": "4px", "accent_bar": true, "max": 3, "dismiss": 4000
}
```

### Monochrome
```json
{
  "position": "bottom-right", "enter": "fade", "exit": "fade",
  "radius": "6px", "accent_bar": false, "max": 5, "dismiss": 5000
}
```

## Validation Summary

- All 10 manifests remain valid JSON
- Each `theme.capabilities` now contains both `modals` and `notifications` blocks
- All specified keys (`backdrop`, `backdrop_blur`, `backdrop_opacity`, `radius`, `enter_animation`, `exit_animation`, `close_button`, `shadow`, optional `border`, and notification keys `position`, `enter`, `exit`, `radius`, `accent_bar`, `max`, `dismiss`) present with correct values
- `border` key only present on Steampunk, Cyberpunk, and Synthwave modals (as specified)
