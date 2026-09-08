# App Development Guide

This guide will help you create apps for the rumahl platform.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [App Structure](#app-structure)
- [Creating Your First App](#creating-your-first-app)
- [Manifest Configuration](#manifest-configuration)
- [Docker Configuration](#docker-configuration)
- [Permissions](#permissions)
- [Network Access](#network-access)
- [Custom Pages](#custom-pages)
- [Settings Schema](#settings-schema)
- [Testing](#testing)
- [Publishing](#publishing)

## Overview

rumahl apps are containerized applications that run in Docker containers. They can:

- Expose web UIs accessible through rumahl's interface
- Provide REST APIs
- Create custom pages in the rumahl dashboard
- Access rumahl services through the API Gateway
- Store and retrieve data
- Control smart home devices (with permission)

## Prerequisites

- Basic knowledge of web development
- Familiarity with Docker
- Understanding of REST APIs
- rumahl development environment set up

## App Structure

A typical rumahl app has the following structure:

```
my-app/
├── manifest.json          # App configuration
├── icon.png              # App icon (256x256px recommended)
├── src/                  # Source code
│   ├── index.js         # Main entry point
│   ├── server.js        # Web server
│   └── routes/          # API routes
├── public/              # Static files
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── package.json         # Dependencies (for Node.js apps)
└── README.md           # Documentation
```

## Creating Your First App

### Step 1: Create the Manifest

Create a `manifest.json` file:

```json
{
  "id": "my-first-app",
  "name": "My First App",
  "version": "1.0.0",
  "developer": "Your Name",
  "description": "A simple rumahl app",
  "type": "app",
  "icon": "icon.png",
  "permissions": [
    "NetworkAccess"
  ],
  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "working_dir": "/app",
    "install_cmd": "npm install",
    "start_cmd": "node src/server.js",
    "internal_ports": [
      {
        "port": 3000,
        "protocol": "tcp",
        "assignment_mode": "random",
        "description": "Web server"
      }
    ],
    "environment": {
      "NODE_ENV": "production"
    }
  },
  "custom_pages": [
    {
      "id": "my-app-home",
      "title": "My App",
      "icon": "home",
      "url": "/",
      "show_in_nav": true,
      "order": 100
    }
  ]
}
```

### Step 2: Create the Application Code

Create `src/server.js`:

```javascript
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// API endpoint
app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello from My First App!',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Step 3: Create the Frontend

Create `public/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>My First App</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <h1>My First rumahl App</h1>
        <button onclick="fetchMessage()">Get Message</button>
        <div id="message"></div>
    </div>

    <script>
        async function fetchMessage() {
            const response = await fetch('/api/hello');
            const data = await response.json();
            document.getElementById('message').textContent = data.message;
        }
    </script>
</body>
</html>
```

### Step 4: Package Your App

Create a ZIP file containing all app files:

```bash
zip -r my-first-app.zip manifest.json icon.png src/ public/ package.json
```

### Step 5: Install in rumahl

1. Open rumahl Control Center
2. Navigate to App Store
3. Click "Install Custom App"
4. Upload `my-first-app.zip`
5. Review and accept permissions
6. Wait for installation to complete

## Manifest Configuration

### Required Fields

- `id` - Unique identifier (lowercase, hyphens allowed)
- `name` - Display name
- `version` - Semantic version (e.g., "1.0.0")
- `developer` - Your name or organization
- `description` - Short description
- `type` - Must be "app"

### Optional Fields

- `icon` - Path to icon file (relative to ZIP root)
- `permissions` - Array of required permissions
- `docker` - Docker configuration
- `custom_pages` - Custom pages in rumahl UI
- `settings_schema` - Settings configuration
- `endpoints` - API endpoints documentation
- `network_access` - Network access configuration
- `store_metadata` - App store metadata

## Docker Configuration

### Auto-Build vs Pre-Built Image

**Auto-Build** (recommended for development):
```json
{
  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "working_dir": "/app",
    "install_cmd": "npm install",
    "start_cmd": "node server.js"
  }
}
```

**Pre-Built Image**:
```json
{
  "docker": {
    "auto_build": false,
    "image": "myregistry/my-app:1.0.0"
  }
}
```

### Port Configuration

```json
{
  "internal_ports": [
    {
      "port": 3000,
      "protocol": "tcp",
      "assignment_mode": "random",  // or "fixed"
      "description": "Web server"
    },
    {
      "port": 8080,
      "protocol": "tcp",
      "assignment_mode": "fixed",
      "description": "API server (stable port)"
    }
  ]
}
```

**Port Assignment Modes:**
- `random` (default) - New port on each restart (more secure)
- `fixed` - Same port across restarts (for external integrations)

### Environment Variables

```json
{
  "environment": {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info",
    "API_KEY": "${USER_API_KEY}"  // User-configurable
  }
}
```

## Permissions

Apps must declare required permissions in the manifest:

```json
{
  "permissions": [
    "NetworkAccess",
    "StorageRead",
    "StorageWrite",
    "ReadEntities",
    "ControlEntities"
  ]
}
```

### Common Permissions

- `NetworkAccess` - Access external networks
- `NetworkScan` - Scan local network
- `NetworkLocalAccess` - Access local network IPs
- `StorageRead` / `StorageWrite` - Data storage
- `ReadEntities` / `ControlEntities` - Smart home devices
- `DatabaseRead` / `DatabaseWrite` - Database access

See [Permissions Reference](permissions.md) for complete list.

## Network Access

Control which domains and IPs your app can access:

```json
{
  "network_access": {
    "allowed_domains": [
      "api.example.com",
      "*.cdn.example.com"
    ],
    "allow_user_domains": true,
    "allow_network_scan": false,
    "allowed_local_ips": [
      "192.168.1.100",
      "10.0.0.0/24"
    ],
    "allow_user_local_ips": true
  }
}
```

**Options:**
- `allowed_domains` - Domains app can access
- `allow_user_domains` - Let users add domains in settings
- `allow_network_scan` - Enable network scanning
- `allowed_local_ips` - Local IPs/subnets app can access
- `allow_user_local_ips` - Let users add IPs in settings

## Custom Pages

Add pages to the rumahl navigation:

```json
{
  "custom_pages": [
    {
      "id": "dashboard",
      "title": "Dashboard",
      "icon": "dashboard",
      "url": "/",
      "show_in_nav": true,
      "order": 10
    },
    {
      "id": "settings",
      "title": "Settings",
      "icon": "settings",
      "url": "/settings",
      "show_in_nav": true,
      "order": 20,
      "parent_page_id": "dashboard"
    }
  ]
}
```

## Settings Schema

Define user-configurable settings:

```json
{
  "settings_schema": {
    "title": "App Settings",
    "description": "Configure your app",
    "fields": [
      {
        "key": "api_key",
        "label": "API Key",
        "type": "password",
        "required": true,
        "description": "Your API key for external service"
      },
      {
        "key": "refresh_interval",
        "label": "Refresh Interval (seconds)",
        "type": "number",
        "default": 60,
        "validation": {
          "min": 10,
          "max": 3600
        }
      },
      {
        "key": "enable_notifications",
        "label": "Enable Notifications",
        "type": "boolean",
        "default": true
      }
    ]
  }
}
```

**Field Types:**
- `text`, `textarea`, `password`
- `number`, `boolean`
- `select`, `url`, `email`, `color`

## Testing

### Local Testing

1. Test your app locally before packaging:
```bash
docker build -t my-app:test .
docker run -p 3000:3000 my-app:test
```

2. Verify endpoints:
```bash
curl http://rumahl.local:3000/health
curl http://rumahl.local:3000/api/hello
```

### Testing in rumahl

1. Install app in rumahl
2. Check logs in Control Center
3. Test all functionality
4. Verify permissions work correctly
5. Test settings changes

## Publishing

### App Store Submission

1. Ensure manifest is complete
2. Add screenshots to `store_metadata`
3. Write comprehensive README
4. Test thoroughly
5. Submit to rumahl App Store

### Metadata for Store

```json
{
  "store_metadata": {
    "category": "Utility",
    "tags": ["productivity", "automation"],
    "screenshots": [
      "screenshots/1.png",
      "screenshots/2.png"
    ],
    "homepage": "https://example.com",
    "source_url": "https://github.com/user/my-app",
    "support_url": "https://example.com/support",
    "license": "MIT"
  }
}
```

## Best Practices

1. **Security**
   - Request only necessary permissions
   - Validate all user input
   - Use HTTPS for external APIs
   - Don't hardcode secrets

2. **Performance**
   - Use lightweight base images
   - Implement health checks
   - Cache appropriately
   - Minimize resource usage

3. **User Experience**
   - Provide clear error messages
   - Include loading states
   - Make settings discoverable
   - Document all features

4. **Compatibility**
   - Test on different rumahl versions
   - Handle API changes gracefully
   - Provide migration paths for updates

## Examples

See the [examples](examples/) directory for complete app examples:

- [Hello World App](examples/hello-world/) - Minimal app
- [Weather App](examples/weather/) - External API integration
- [Device Monitor](examples/device-monitor/) - Entity control
- [Network Scanner](examples/network-scanner/) - Network access

## Troubleshooting

### App Won't Start

- Check Docker logs in Control Center
- Verify `start_cmd` is correct
- Ensure all dependencies are installed
- Check port configuration

### Permission Denied

- Review requested permissions
- Check permission approval status
- Verify API calls use correct auth

### Network Issues

- Check `network_access` configuration
- Verify domains are in allowed list
- Test external connectivity

## Extended Capabilities (v2.1)

rumahl v2.1 introduces powerful new features for apps:

### App Storage
Store and retrieve files and key-value data scoped to your app:

```json
{
  "storage": {
    "enabled": true,
    "quota": {
      "max_file_storage_bytes": 20971520,
      "max_kv_entries": 500,
      "max_file_size_bytes": 5242880
    }
  }
}
```

See the [App Storage Guide](app-storage.md) for details.

### SQLite Database
Provision your own SQLite database instead of using shared PostgreSQL:

```json
{
  "database": {
    "backend": "sqlite",
    "sqlite": {
      "init_sql": ["CREATE TABLE IF NOT EXISTS data (id INTEGER PRIMARY KEY, value TEXT)"],
      "wal_mode": true,
      "max_size_bytes": 104857600
    }
  }
}
```

See the [App Database Guide](app-database.md) for details.

### Scheduled Tasks
Register cron or interval-based scheduled tasks:

```json
{
  "schedules": {
    "default_schedules": [
      {
        "name": "Hourly Sync",
        "schedule_type": "cron",
        "cron_expression": "0 * * * *",
        "payload": {"action": "sync"}
      }
    ]
  }
}
```

See the [Scheduled Tasks Guide](app-scheduling.md) for details.

### Webhooks
Create webhook endpoints for external services:

```json
{
  "webhooks": {
    "default_webhooks": [
      {
        "name": "GitHub Push",
        "method": "POST",
        "target_url": "http://rumahl.local:3000/api/hook",
        "verify_signature": true
      }
    ]
  }
}
```

See the [Webhooks Guide](app-webhooks.md) for details.

### Inter-App Messaging
Communicate with other apps via pub/sub channels:

```json
{
  "messaging": {
    "channels": [
      {
        "name": "myapp:alerts",
        "channel_type": "public",
        "description": "Alert messages"
      }
    ]
  }
}
```

See the [Inter-App Messaging Guide](app-messaging.md) for details.

## Next Steps

- [Plugin Development](plugin-development.md)
- [Permissions Reference](permissions.md)
- [API Documentation](../api/README.md)
- [Manifest Schema](manifest-schema.md)
- [App Storage Guide](app-storage.md)
- [App Database Guide](app-database.md)
- [Scheduled Tasks Guide](app-scheduling.md)
- [Webhooks Guide](app-webhooks.md)
- [Inter-App Messaging Guide](app-messaging.md)

## Support

- [GitHub Issues](https://github.com/rumahl/home-assistant-dashb/issues)
- [Community Forum](https://github.com/rumahl/home-assistant-dashb/discussions)
- [Security Reports](../security/README.md#reporting-security-issues)
