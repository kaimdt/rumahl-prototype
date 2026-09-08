+# Launcher and widget packages

rumahl OS discovers launcher and widget extensions from the normal App Store installation catalogue. No separate installer or service is required.

## Launcher package

A launcher is an app or plugin manifest with a `launcher` object:

```json
{
  "id": "example-launcher",
  "name": "Example Launcher",
  "version": "1.0.0",
  "developer": "Example",
  "description": "An rumahl OS launcher",
  "type": "plugin",
  "plugin_type": "integration",
  "permissions": [],
  "launcher": {
    "id": "example-launcher",
    "name": "Example Launcher",
    "base": "default",
    "accent": "oklch(0.68 0.17 250)"
  }
}
```

`base` must be `default`, `deck`, or `canvas`. The installed package can specialize the base layout through its name and accent while preserving rumahl OS accessibility, touch, keyboard, portrait, and landscape behavior.

## Widget package

Widgets use the existing manifest `widgets` array:

```json
{
  "id": "example-widgets",
  "name": "Example Widgets",
  "version": "1.0.0",
  "developer": "Example",
  "description": "Widgets for the rumahl OS homescreen",
  "type": "plugin",
  "plugin_type": "widget",
  "permissions": [],
  "widgets": [
    {
      "id": "air-quality",
      "name": "Air quality",
      "type": "iframe",
      "component_url": "widget/index.html",
      "description": "Current indoor air quality"
    }
  ]
}
```

Relative component URLs are served from the installed package assets endpoint. Launcher widgets run in a sandboxed iframe. API access still requires the permissions declared by the package.

## Installation and removal

Package installation, updates, trust decisions, and removal use the existing rumahl App Store. Enabled packages appear automatically in the Launcher settings. Disabled or removed packages are no longer offered.

## Cross-device synchronization

The selected launcher, imported launcher manifests, and enabled widget IDs are stored as user preferences:

- `rumahl-os-launcher`
- `rumahl-os-custom-launchers`
- `rumahl-os-launcher-widgets`

rumahl OS restores these preferences on sign-in, refreshes them when the window regains focus, and checks for remote changes periodically. Local settings remain usable while the backend is unavailable.

