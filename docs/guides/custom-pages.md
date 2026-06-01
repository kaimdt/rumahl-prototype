# Creating Custom Pages

Apps can add custom pages to the IORA dashboard navigation. This guide covers how to define, configure, and manage app pages.

## Overview

When an app defines `custom_pages` in its manifest, IORA automatically:
1. Creates dashboard pages for each entry
2. Adds an Iframe widget pointing to the app's proxy URL
3. Registers the pages in the navigation sidebar

## Defining Custom Pages

### Basic Configuration

```json
{
  "custom_pages": [
    {
      "id": "my-app-dashboard",
      "title": "My App",
      "icon": "broadcast",
      "url": "/",
      "show_in_nav": true,
      "order": 100
    }
  ]
}
```

### Complete Configuration

```json
{
  "custom_pages": [
    {
      "id": "my-app-dashboard",
      "title": "My App Dashboard",
      "icon": "broadcast",
      "url": "/",
      "show_in_nav": true,
      "order": 10,
      "display_mode": "fullscreen",
      "requires_auth": true,
      "parent_page_id": null,
      "min_role": "user"
    },
    {
      "id": "my-app-settings",
      "title": "Settings",
      "icon": "gear",
      "url": "/settings",
      "show_in_nav": true,
      "order": 20,
      "parent_page_id": "my-app-dashboard"
    },
    {
      "id": "my-app-admin",
      "title": "Admin Panel",
      "icon": "shield",
      "url": "/admin",
      "show_in_nav": true,
      "order": 30,
      "min_role": "admin"
    }
  ]
}
```

### Page Properties

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | (required) | Unique page identifier |
| `title` | string | (required) | Display name in navigation |
| `icon` | string | `"broadcast"` | Phosphor icon name |
| `url` | string | `"/"` | Relative URL within your app |
| `show_in_nav` | boolean | `true` | Show in sidebar navigation |
| `order` | number | `100` | Sort order (lower = first) |
| `display_mode` | string | `"normal"` | `"normal"`, `"fullscreen"`, or `"modal"` |
| `requires_auth` | boolean | `true` | Require user authentication |
| `parent_page_id` | string | – | Parent page for nested navigation |
| `min_role` | string | `"user"` | Minimum role: `"user"` or `"admin"` |

## Page Display Modes

### Normal (Default)

The page appears in the standard dashboard layout with sidebar and header visible. The app content is shown in an Iframe within the main content area.

### Fullscreen

The app occupies the entire viewport. No sidebar or header is shown. Ideal for immersive experiences.

```json
{
  "display_mode": "fullscreen"
}
```

### Modal

The page opens as a modal dialog overlay. Useful for quick actions or wizards.

```json
{
  "display_mode": "modal"
}
```

## URL Routing

The `url` field defines the path within your app that gets proxied:

```
http://localhost:8126/api/apps/{app_id}/proxy/{url}
```

**Examples:**

| `url` | Proxied to |
|-------|-----------|
| `"/"` | App root |
| `"/settings"` | App's settings page |
| `"/api/data"` | App's API endpoint |
| `"/dashboard/sensors"` | Nested route |

Your app receives the full path after `/api/apps/{app_id}/proxy/`. For example, if your app serves a web app, configure your router accordingly:

```javascript
// Express.js example
app.get('/', (req, res) => {
  res.sendFile('index.html');
});

app.get('/settings', (req, res) => {
  res.sendFile('settings.html');
});
```

## Nested Pages

Create hierarchical navigation with `parent_page_id`:

```json
{
  "custom_pages": [
    {
      "id": "iot-hub",
      "title": "IoT Hub",
      "icon": "cpu",
      "url": "/",
      "order": 10
    },
    {
      "id": "iot-devices",
      "title": "Devices",
      "icon": "device-mobile",
      "url": "/devices",
      "parent_page_id": "iot-hub",
      "order": 10
    },
    {
      "id": "iot-rules",
      "title": "Rules",
      "icon": "git-branch",
      "url": "/rules",
      "parent_page_id": "iot-hub",
      "order": 20
    }
  ]
}
```

Navigation will show:
```
IoT Hub
  └── Devices
  └── Rules
```

## Page Access Control

### Role-Based Access

```json
{
  "id": "admin-settings",
  "title": "Admin Settings",
  "url": "/admin",
  "min_role": "admin"   // Only admins can access
}
```

### Authentication Required

```json
{
  "id": "public-status",
  "title": "Status",
  "url": "/status",
  "requires_auth": false   // Public page, no login needed
}
```

## Icon Reference

IORA uses Phosphor Icons. Available icon names:
- `broadcast` – App default
- `home`, `house` – Home/dashboard
- `gear`, `sliders` – Settings
- `chart-bar`, `chart-line` – Analytics
- `cpu`, `device-mobile` – Devices
- `shield`, `lock` – Security
- `cloud`, `database` – Data
- `bell`, `warning` – Alerts
- `sun`, `moon` – Environment
- `wifi`, `bluetooth` – Connectivity

Full list: [Phosphor Icons](https://phosphoricons.com/)

## Iframe Communication

Apps running in Iframes can communicate with IORA via postMessage. See the [App & Plugin System](../system/app-plugin-system.md#125-iframe-kommunikation-postmessage) for the complete API.

Quick example:
```javascript
// Tell IORA to navigate to a page
window.parent.postMessage({
  type: 'call',
  id: 'nav-1',
  method: 'ui.navigateTo',
  params: ['home']
}, '*');

// Open fullscreen
window.parent.postMessage({
  type: 'call',
  id: 'fs-1',
  method: 'ui.requestFullscreen',
  params: []
}, '*');
```

## Dynamic Page Updates

Pages are created/removed automatically when the app starts/stops. No manual page management needed.

## Best Practices

1. **Use descriptive titles** – Help users understand what each page does
2. **Organize with parent pages** – Group related pages under a parent
3. **Use appropriate icons** – Make navigation recognizable
4. **Set correct roles** – Hide admin pages from regular users
5. **Handle proxy paths** – Your app should work with any base path
6. **Implement health checks** – Pages appear only when the container is healthy
7. **Use fullscreen sparingly** – Only for truly immersive experiences

## Troubleshooting

### Page Not Appearing in Navigation

- Check app is running: `GET /api/supervisor/apps/{app_id}`
- Verify `show_in_nav` is `true` in manifest
- Check user has sufficient role (`min_role`)

### Page Shows Error

- Check app container logs: `GET /api/apps/{app_id}/logs`
- Verify the URL path works in your app
- Check for CORS issues in browser console

### Iframe Shows Blank Page

- App may not be started (Docker mode) – check proxy placeholder
- Your app's web server may not be running
- Check iframe sandbox attributes in browser DevTools

## Related Documentation

- [App Development Guide](../development/app-development.md) – Full app creation guide
- [App Runtime Capabilities](../development/app-runtime-capabilities.md) – Iframe integration
- [Docker Configuration](docker-config.md) – Container networking
