# Manifest Schema Reference

Complete reference for the rumahl app/plugin manifest (`manifest.json`).

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `id` | string | ✅ | Unique identifier (`[a-zA-Z0-9_-.]` only) |
| `name` | string | ✅ | Display name |
| `version` | string | ✅ | Semantic version (e.g., `"1.0.0"`) |
| `developer` | string | ✅ | Developer name or organization |
| `description` | string | ✅ | Short description (max 200 chars) |
| `type` | string | ✅ | `"app"` or `"plugin"` |
| `icon` | string | ❌ | Path to icon (256x256px PNG recommended) |
| `main` | string | ❌ | Entry point file (default: `"index.js"`) |
| `permissions` | string[] | ❌ | Required permissions |
| `plugin_type` | string | ❌ | Plugin type: `"widget"`, `"service"`, `"api"`, `"integration"`, `"theme"` |

## Docker Configuration

For `type: "app"`:

```json
{
  "docker": {
    "auto_build": true,
    "base_image": "node:18-alpine",
    "working_dir": "/app",
    "install_cmd": "npm install",
    "build_cmd": "npm run build",
    "start_cmd": "node server.js",
    "dockerfile": "./Dockerfile",
    "context": ".",
    "build_args": { "KEY": "value" },
    "internal_ports": [
      {
        "port": 3000,
        "protocol": "tcp",
        "assignment_mode": "random",
        "description": "Web server"
      }
    ],
    "environment": { "NODE_ENV": "production" },
    "health_check": {
      "endpoint": "/health",
      "interval": 30,
      "timeout": 10,
      "retries": 3,
      "start_period": 15
    },
    "volumes": [
      {
        "name": "app-data",
        "container_path": "/app/data",
        "size_mb": 100
      }
    ],
    "resources": {
      "memory_limit_mb": 256,
      "cpu_limit": 1.0
    },
    "restart_policy": "unless-stopped",
    "network_mode": "bridge"
  }
}
```

| Docker Field | Type | Default | Description |
|-------------|------|---------|-------------|
| `auto_build` | boolean | `true` | Build from source or use pre-built image |
| `image` | string | – | Pre-built image (when `auto_build: false`) |
| `base_image` | string | `"node:18-alpine"` | Base Docker image |
| `working_dir` | string | `"/app"` | Working directory in container |
| `install_cmd` | string | – | Install dependencies |
| `build_cmd` | string | – | Build/compile |
| `start_cmd` | string | (required) | Container entrypoint |
| `dockerfile` | string | – | Path to custom Dockerfile |
| `context` | string | `"."` | Docker build context |
| `build_args` | object | – | Build arguments |
| `internal_ports` | array | – | Container ports |
| `environment` | object | – | Environment variables |
| `health_check` | object | – | Health check configuration |
| `volumes` | array | – | Persistent volumes |
| `resources` | object | – | CPU/memory limits |
| `restart_policy` | string | `"unless-stopped"` | Restart behavior |
| `network_mode` | string | `"bridge"` | Network mode |
| `extra_hosts` | array | – | Extra /etc/hosts entries |

## Bundle Configuration (v2.3)

For multi-container apps:

```json
{
  "bundle": {
    "version": "1.0",
    "network": {
      "driver": "bridge",
      "subnet": "172.28.0.0/24",
      "internal": false
    },
    "auto_compose": true,
    "services": [
      {
        "name": "db",
        "image": "postgres:16-alpine",
        "build": {
          "context": "./db",
          "dockerfile": "Dockerfile"
        },
        "environment": {},
        "internal_ports": [{ "port": 5432, "protocol": "tcp" }],
        "volumes": [],
        "health_check": {},
        "resources": {},
        "depends_on": [],
        "restart_policy": "unless-stopped"
      }
    ]
  }
}
```

## Database Configuration

```json
{
  "database": {
    "backend": "sqlite",
    "sqlite": {
      "auto_provision": true,
      "init_sql": [
        "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT)"
      ],
      "wal_mode": true,
      "max_size_bytes": 104857600,
      "auto_backup": true,
      "backup_interval_minutes": 1440
    }
  }
}
```

PostgreSQL alternative:
```json
{
  "database": {
    "backend": "postgres",
    "postgres": {
      "auto_provision": true,
      "schema": "app_my_app",
      "max_connections": 5,
      "max_storage_mb": 500,
      "init_sql": ["CREATE TABLE IF NOT EXISTS ..."]
    }
  }
}
```

## Storage Configuration

```json
{
  "storage": {
    "enabled": true,
    "quota": {
      "max_file_storage_bytes": 20971520,
      "max_kv_entries": 500,
      "max_file_size_bytes": 5242880
    },
    "public_files": false,
    "allowed_mime_types": ["image/png", "application/json"]
  }
}
```

## Scheduling Configuration

```json
{
  "schedules": {
    "default_schedules": [
      {
        "name": "daily_cleanup",
        "description": "Clean up old data",
        "schedule_type": "cron",
        "cron_expression": "0 3 * * *",
        "payload": { "action": "cleanup" },
        "enabled": true
      },
      {
        "name": "refresh_data",
        "schedule_type": "interval",
        "interval_seconds": 300,
        "payload": { "action": "refresh" }
      }
    ]
  }
}
```

## Webhooks Configuration

```json
{
  "webhooks": {
    "default_webhooks": [
      {
        "name": "github_push",
        "description": "Receive GitHub push events",
        "method": "POST",
        "target_url": "http://localhost:3000/webhook/github",
        "verify_signature": true,
        "secret_header": "X-Hub-Signature-256",
        "enabled": true,
        "retry_count": 3,
        "retry_delay_seconds": 60
      }
    ]
  }
}
```

## Messaging Configuration

```json
{
  "messaging": {
    "channels": [
      {
        "name": "myapp:alerts",
        "channel_type": "public",
        "description": "Alert messages",
        "allowed_publishers": [],
        "allowed_subscribers": [],
        "retention_seconds": 3600,
        "max_message_size_bytes": 102400
      }
    ],
    "default_subscriptions": ["system:events"]
  }
}
```

## Custom Pages

```json
{
  "custom_pages": [
    {
      "id": "my-app-dashboard",
      "title": "My App",
      "icon": "broadcast",
      "url": "/",
      "show_in_nav": true,
      "order": 100,
      "display_mode": "normal",
      "requires_auth": true,
      "parent_page_id": null,
      "min_role": "user"
    }
  ]
}
```

## Settings Schema

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
        "description": "Your API key"
      },
      {
        "key": "refresh_interval",
        "label": "Refresh Interval",
        "type": "number",
        "default": 60,
        "validation": { "min": 10, "max": 3600 }
      },
      {
        "key": "theme",
        "label": "Theme",
        "type": "select",
        "default": "dark",
        "options": [
          { "value": "dark", "label": "Dark" },
          { "value": "light", "label": "Light" }
        ]
      }
    ]
  }
}
```

## Network Access

```json
{
  "network_access": {
    "allowed_domains": [
      "api.example.com",
      "*.cdn.example.com"
    ],
    "allow_user_domains": true,
    "blocked_domains": [],
    "allowed_local_ips": [
      "192.168.1.100",
      "10.0.0.0/24"
    ],
    "allow_user_local_ips": true,
    "allow_network_scan": false
  }
}
```

## Sandbox Configuration (Plugins Only)

```json
{
  "sandbox": {
    "max_execution_time_ms": 5000,
    "max_memory_mb": 128,
    "allow_network": false,
    "allow_file_system": false
  }
}
```

## Widgets (Plugins Only)

```json
{
  "widgets": [
    {
      "id": "my-widget",
      "name": "My Widget",
      "widget_type": "card",
      "component_url": "widget.js",
      "default_config": {
        "refresh_interval": 30
      },
      "min_size": { "width": 2, "height": 2 },
      "max_size": { "width": 4, "height": 4 }
    }
  ]
}
```

## Store Metadata

```json
{
  "store_metadata": {
    "category": "Utility",
    "tags": ["productivity", "automation"],
    "screenshots": ["screenshots/1.png", "screenshots/2.png"],
    "homepage": "https://example.com",
    "source_url": "https://github.com/user/my-app",
    "support_url": "https://example.com/support",
    "license": "MIT",
    "min_rumahl_version": "2.1.0",
    "max_rumahl_version": null
  }
}
```

## App Runtime Capabilities

```json
{
  "runtime": {
    "assist": {
      "enabled": true,
      "intents": [
        {
          "name": "get_weather",
          "description": "Get current weather",
          "parameters": {
            "location": { "type": "string", "required": true }
          }
        }
      ],
      "actions": [
        {
          "name": "refresh_data",
          "description": "Refresh all data sources"
        }
      ]
    },
    "github": {
      "enabled": true,
      "repo": "user/repo",
      "events": ["push", "issues"]
    }
  }
}
```

## Complete Manifest Example

See the [App & Plugin System Reference](../system/app-plugin-system.md#3-manifest-schema-vollstndig) for a complete manifest with all fields populated.

## Version History

| Version | Changes |
|---------|---------|
| v2.0 | Initial manifest schema |
| v2.1 | Added storage, database, schedules, webhooks, messaging |
| v2.2 | Added plugin sandbox, settings_schema, runtime capabilities |
| v2.3 | Added bundle (multi-container), iframe communication |

## Related Documentation

- [App Development Guide](app-development.md) – Creating apps
- [Plugin Development Guide](plugin-development.md) – Creating plugins
- [App & Plugin System](../system/app-plugin-system.md) – Complete system reference
