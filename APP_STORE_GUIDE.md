# IORA App Store - Developer Guide

Complete guide for developing, packaging, and distributing apps for the IORA platform.

## Table of Contents

1. [Overview](#overview)
2. [App vs Plugin](#app-vs-plugin)
3. [Manifest Schema](#manifest-schema)
4. [Port Assignment](#port-assignment)
5. [Custom Pages & Widgets](#custom-pages--widgets)
6. [Settings Schema](#settings-schema)
7. [Installation Process](#installation-process)
8. [Trust Levels](#trust-levels)
9. [Example Apps](#example-apps)

---

## Overview

The IORA App Store provides a unified marketplace for distributing apps and plugins. Apps run as Docker containers with dynamically assigned ports, while plugins execute in a secure sandbox.

### Key Features

- **Dynamic Port Assignment**: No hardcoded ports - IORA assigns from pool (3000-4000)
- **Trust Levels**: Apps from the store are trusted, ZIP uploads are untrusted by default
- **Auto-Build**: IORA can automatically create Docker images from your source code
- **Custom Pages**: Apps can register their own pages in the IORA navigation
- **Settings Framework**: Define settings schemas for dynamic configuration UI
- **Permission System**: Request specific permissions, admin approval required

---

## App vs Plugin

### Apps
- Run as Docker containers (continuously)
- Can be auto-built or use pre-built images
- Get dynamically assigned external ports
- Full network access (if permitted)
- Suitable for: services, APIs, background tasks

### Plugins
- Execute on-demand in a sandbox
- No persistent runtime
- Resource limits (CPU, memory, time, network)
- Suitable for: data processors, formatters, validators

---

## Manifest Schema

Every app/plugin must include a `manifest.json` in the root directory.

### Minimal Example (App)

```json
{
  "id": "my-app",
  "name": "My Application",
  "version": "1.0.0",
  "developer": "Your Name",
  "description": "Brief description",
  "type": "app",
  "permissions": ["NetworkAccess"],
  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "start_cmd": "node server.js",
    "internal_ports": [
      { "port": 3000, "protocol": "tcp" }
    ]
  }
}
```

### Full Schema

```typescript
{
  id: string                    // Unique identifier (lowercase, hyphens)
  name: string                  // Display name
  version: string               // Semantic version (1.0.0)
  developer: string             // Developer name
  description: string           // Short description
  icon?: string                 // Icon URL (optional)
  type: "app" | "plugin"        // Type

  // Optional: Plugin-specific type
  plugin_type?: "widget" | "service" | "api" | "integration" |
                "theme" | "automation" | "data_processor"

  // Required permissions
  permissions: string[]         // e.g., ["NetworkAccess", "ReadCache"]

  // API endpoints exposed
  endpoints?: [
    {
      path: string              // "/api/myapp/status"
      method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
      description: string
      requires_auth: boolean
    }
  ]

  // Dashboard widgets
  widgets?: [
    {
      id: string
      name: string
      type: string              // "dashboard"
      component_url: string     // URL to widget component
      description: string
      default_config?: object   // Default widget configuration
    }
  ]

  // Custom pages
  custom_pages?: [
    {
      id: string
      title: string
      icon: string              // Icon name
      url: string               // Page URL
      show_in_nav: boolean      // Show in navigation?
      order: number             // Display order
      parent_page_id?: string   // Parent page (for sub-pages)
    }
  ]

  // Settings schema
  settings_schema?: {
    title: string
    description: string
    fields: [
      {
        key: string             // Setting key
        label: string           // Field label
        description?: string    // Help text
        type: "text" | "number" | "boolean" | "select" |
              "textarea" | "password" | "url" | "email" | "color"
        default?: any
        required: boolean
        options?: [             // For select type
          { value: string, label: string }
        ]
        validation?: {
          min?: number
          max?: number
          min_length?: number
          max_length?: number
          pattern?: string      // Regex pattern
        }
      }
    ]
  }

  // Docker configuration (for apps)
  docker?: {
    auto_build: boolean         // Auto-generate Dockerfile?

    // For pre-built images (auto_build = false)
    image?: string              // "ghcr.io/user/app:latest"

    // For auto-build (auto_build = true)
    base_image?: string         // "node:18-alpine"
    working_dir?: string        // "/app"
    install_cmd?: string        // "npm install"
    start_cmd?: string          // "node server.js"

    // Internal ports (IORA assigns external ports)
    internal_ports: [
      {
        port: number            // Internal port (e.g., 3000)
        protocol: "tcp" | "udp"
        description?: string
      }
    ]

    environment?: {             // Environment variables
      [key: string]: string
    }

    volumes?: string[]          // Volume mounts

    health_check?: {
      endpoint: string          // Health check path
      interval: number          // Seconds between checks
      timeout: number           // Request timeout
      retries: number           // Retries before unhealthy
    }
  }

  // Sandbox configuration (for plugins)
  sandbox?: {
    max_execution_time_ms: number
    max_memory_mb: number
    allow_network: boolean
    allow_file_system: boolean
  }

  // App store metadata
  store_metadata?: {
    category: string
    tags: string[]
    screenshots: string[]
    min_iora_version?: string
    homepage?: string
    source_url?: string
    support_url?: string
    license?: string
  }
}
```

---

## Port Assignment

IORA automatically assigns external ports from the range **3000-4000**.

### How It Works

1. **Define Internal Ports**: Specify which ports your app needs internally
2. **IORA Assigns External**: IORA finds available port in the pool
3. **Automatic Mapping**: Docker maps `external:internal`

### Example

```json
"docker": {
  "internal_ports": [
    { "port": 3000, "protocol": "tcp", "description": "HTTP API" },
    { "port": 3001, "protocol": "tcp", "description": "WebSocket" }
  ]
}
```

**Result**: IORA might assign `3042:3000` and `3043:3001`

### Access Your App

- **From other containers**: `http://my-app:3000` (internal port)
- **From host/external**: `http://localhost:3042` (external port)

### Port Environment Variable

IORA injects the assigned external port as an environment variable:

```javascript
// Access assigned port in your app
const PORT = process.env.IORA_EXTERNAL_PORT || 3000
app.listen(PORT)
```

---

## Custom Pages & Widgets

Apps can create custom pages in the IORA UI.

### Custom Page Example

```json
"custom_pages": [
  {
    "id": "my-dashboard",
    "title": "My Dashboard",
    "icon": "ChartLine",
    "url": "/apps/my-app/dashboard",
    "show_in_nav": true,
    "order": 100
  }
]
```

### Widget Example

```json
"widgets": [
  {
    "id": "status-widget",
    "name": "Status Widget",
    "type": "dashboard",
    "component_url": "http://my-app:3000/widget.js",
    "description": "Shows app status",
    "default_config": {
      "refresh_interval": 30
    }
  }
]
```

---

## Settings Schema

Define a settings UI for your app.

### Example

```json
"settings_schema": {
  "title": "My App Settings",
  "description": "Configure app behavior",
  "fields": [
    {
      "key": "api_key",
      "label": "API Key",
      "type": "password",
      "required": true
    },
    {
      "key": "theme",
      "label": "Theme",
      "type": "select",
      "default": "dark",
      "options": [
        { "value": "light", "label": "Light" },
        { "value": "dark", "label": "Dark" }
      ]
    },
    {
      "key": "max_items",
      "label": "Max Items",
      "type": "number",
      "default": 100,
      "validation": { "min": 1, "max": 1000 }
    }
  ]
}
```

### Accessing Settings in Your App

Settings are available via API:

```javascript
// Fetch app settings
const response = await fetch('/api/appstore/apps/my-app/settings', {
  headers: { 'Authorization': `Bearer ${token}` }
})
const settings = await response.json()
```

---

## Installation Process

### Method 1: From App Store (Coming Soon)

1. User searches app in IORA Admin → Apps → App Store
2. Clicks "Install"
3. Reviews permissions
4. Confirms installation
5. App downloads, installs, and registers automatically

### Method 2: ZIP Upload

1. Package your app:
   ```bash
   zip -r my-app.zip . -x "*.git*" "node_modules/*"
   ```

2. Upload via IORA Admin → Apps → ZIP Upload

3. IORA:
   - Extracts ZIP
   - Validates `manifest.json`
   - Allocates ports
   - Builds Docker image (if auto_build)
   - Creates container
   - Marks as **untrusted** (admin can verify)

### Self-Registration

After installation, your app should self-register:

```javascript
// Self-registration endpoint (to be implemented)
fetch('http://iora-core:8090/api/apps/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    app_id: 'my-app',
    api_token: process.env.IORA_API_TOKEN
  })
})
```

---

## Trust Levels

### Trusted
- Apps from official app store (appstore.kaimdt.com)
- Digitally signed and verified
- Permissions auto-approved
- **Badge**: Green shield icon

### Untrusted
- ZIP uploads from unknown sources
- Permissions require admin approval
- Manual verification needed
- **Badge**: Orange warning icon

### Verified
- Untrusted apps that admin has verified
- Permissions approved
- Trusted for this IORA instance
- **Badge**: Blue checkmark icon

---

## Example Apps

### Weather Service

See `examples/weather-app/` for a complete Node.js app with:
- Auto-build Docker configuration
- Custom page registration
- Settings schema
- Health checks
- Widget integration

### Notification Formatter Plugin

See `examples/notification-plugin/` for a Rust plugin with:
- Sandbox execution
- Permission system
- API endpoint registration

---

## Best Practices

1. **Use Auto-Build**: Easier deployment, IORA handles Docker
2. **Define Health Checks**: IORA monitors your app's health
3. **Request Minimum Permissions**: Only what you need
4. **Document Settings**: Clear descriptions for each setting
5. **Version Semantically**: Follow semver (1.0.0, 1.1.0, 2.0.0)
6. **Test Locally**: Test in Docker before packaging
7. **Include Screenshots**: Help users understand your app
8. **Provide Support**: Link to docs, repo, support channels

---

## Troubleshooting

### App Won't Start

- Check logs: Admin Panel → Apps → View Logs
- Verify `start_cmd` is correct
- Ensure dependencies are installed in `install_cmd`

### Port Conflicts

- Don't hardcode external ports
- Use `internal_ports` in manifest
- IORA handles external port assignment

### Permission Denied

- Check if permissions are granted in Admin Panel
- Ensure your app_id matches manifest
- Verify API token is valid

---

## API Reference

### App Store Endpoints

```
GET  /api/appstore/search?q=weather
GET  /api/appstore/installed
POST /api/appstore/install
DELETE /api/appstore/apps/{app_id}
POST /api/appstore/permissions/grant
POST /api/appstore/settings
GET  /api/appstore/apps/{app_id}/settings
```

### App Self-Registration

```
POST /api/core/apps/register
{
  "app_id": "my-app",
  "api_token": "...",
  "endpoints": [...],
  "widgets": [...],
  "pages": [...]
}
```

---

## Support

- **Documentation**: https://iora.dev/docs
- **GitHub**: https://github.com/iora/iora
- **Discord**: https://discord.gg/iora
- **Issues**: https://github.com/iora/iora/issues
