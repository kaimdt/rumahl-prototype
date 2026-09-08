# App Store API

The App Store API manages app and plugin installation, updates, and lifecycle. It is served by `rumahl-appstore` on port 8098 and partially proxied through `rumahl-home`.

## Base URL

```
http://localhost:8098
```

## App Catalog

```http
# Browse available apps
GET /api/appstore/catalog

# Search apps
GET /api/appstore/catalog?search=weather&category=utility

# Get app details
GET /api/appstore/catalog/{app_id}
```

Catalog response:
```json
{
  "apps": [
    {
      "id": "weather-app",
      "name": "Weather App",
      "version": "1.2.0",
      "developer": "rumahl Team",
      "description": "Weather forecast display",
      "category": "Utility",
      "tags": ["weather", "forecast"],
      "installs": 1500,
      "rating": 4.5,
      "screenshots": ["screen1.png", "screen2.png"],
      "size_mb": 12.5
    }
  ],
  "total": 42
}
```

## Installed Apps

```http
# List installed apps
GET /api/appstore/installed
```

Response:
```json
{
  "apps": [
    {
      "id": "weather-app",
      "name": "Weather App",
      "version": "1.2.0",
      "status": "running",
      "installed_at": "2026-06-01T10:00:00Z",
      "has_update": false
    }
  ]
}
```

## Install App

```http
# Install from catalog
POST /api/appstore/install
Content-Type: application/json

{
  "app_id": "weather-app",
  "version": "1.2.0"
}

# Install from ZIP file
POST /api/appstore/install
Content-Type: multipart/form-data

file: <app.zip>
```

The installation is asynchronous. Monitor progress via the jobs endpoint:

```http
# List installation jobs
GET /api/appstore/jobs

# Job event stream (SSE)
GET /api/appstore/jobs/stream
```

Job status events:
```json
{
  "type": "job_update",
  "data": {
    "job_id": "uuid",
    "app_id": "weather-app",
    "status": "installing",    // downloading, extracting, building, starting, completed, failed
    "progress": 75,
    "message": "Building Docker image..."
  }
}
```

## App Lifecycle Management

```http
# Get app details
GET /api/appstore/apps/{app_id}

# Uninstall app
DELETE /api/appstore/apps/{app_id}

# Enable app
POST /api/appstore/apps/{app_id}/enable

# Disable app
POST /api/appstore/apps/{app_id}/disable
```

## App Updates

```http
# Check for updates
GET /api/appstore/apps/{app_id}/check-update

# Update to latest version
POST /api/appstore/apps/{app_id}/update

# Update to specific version
POST /api/appstore/apps/{app_id}/update
Content-Type: application/json

{
  "version": "1.3.0"
}
```

## App Permissions

```http
# View app permissions
GET /api/appstore/apps/{app_id}/permissions

# Update app permissions
PUT /api/appstore/apps/{app_id}/permissions
Content-Type: application/json

{
  "granted": ["NetworkAccess", "StorageRead"],
  "revoked": ["NetworkScan"]
}
```

## App Settings

```http
# Get app settings
GET /api/appstore/apps/{app_id}/settings

# Update app settings
PUT /api/appstore/apps/{app_id}/settings
Content-Type: application/json

{
  "api_key": "new-key-value",
  "refresh_interval": 120
}

# Reset setting to default
DELETE /api/appstore/apps/{app_id}/settings/{key}
```

## Plugin Management

```http
# Browse plugins (via catalog)
GET /api/appstore/catalog?type=plugin

# Install plugin
POST /api/appstore/install
Content-Type: application/json

{
  "plugin_id": "my-plugin",
  "version": "1.0.0"
}
```

## Store Metadata

Apps in the catalog include metadata:

```json
{
  "store_metadata": {
    "category": "Utility",
    "tags": ["weather", "forecast"],
    "screenshots": ["screen1.png"],
    "homepage": "https://example.com",
    "source_url": "https://github.com/user/app",
    "support_url": "https://example.com/support",
    "license": "MIT",
    "min_rumahl_version": "2.1.0",
    "max_rumahl_version": null
  }
}
```

## App Store Categories

| Category | Description |
|----------|-------------|
| `Utility` | System tools, monitoring, configuration |
| `Smart Home` | Home automation, device control |
| `Media` | Music, video, streaming |
| `Productivity` | Notes, calendars, task management |
| `Security` | Cameras, alarms, access control |
| `Weather` | Weather forecasts, sensors |
| `Energy` | Energy monitoring, solar, EV charging |
| `Communication` | Chat, notifications, messaging |
| `Development` | Developer tools, APIs, debugging |
