# rumahl App & Plugin Isolation System

## Overview

rumahl implements a comprehensive isolation system that ensures Apps and Plugins can extend the platform without compromising system stability. If any App or Plugin crashes, its functionality becomes unavailable, but the core rumahl system and other Apps/Plugins continue operating normally.

## Architecture

### Apps vs Plugins

- **Apps**: Docker containers that run independently
  - Managed by `rumahl-supervisor` (port 8097)
  - Full isolation via containerization
  - Can run continuously as services
  - Access rumahl system via API Gateway only

- **Plugins**: Code extensions that run on-demand
  - Managed by `rumahl-core` (port 8090)
  - Execute in sandboxed environment with resource limits
  - Called when needed by the system
  - Access rumahl system via API Gateway only

### Key Principle: Controlled Access

**Apps and Plugins CANNOT access native rumahl services directly.** They must use the API Gateway which provides:
- Permission-based access control
- Request timeouts (30 seconds)
- Crash isolation
- Health monitoring

## API Gateway

### Purpose

The API Gateway acts as a controlled interface between Apps/Plugins and the rumahl system. It ensures that:
1. Providers cannot access internal rumahl services directly
2. Crashed providers don't block the system
3. API requests timeout after 30 seconds
4. Permissions are enforced

### Registering APIs

Apps and Plugins can register custom API endpoints:

**For Plugins (Rust):**
```rust
use rumahl_shared::api_gateway::{ApiEndpoint, ProviderType, HttpMethod};

impl IPlugin for MyPlugin {
    async fn get_api_endpoints(&self) -> Vec<ApiEndpoint> {
        vec![
            ApiEndpoint {
                id: "my-plugin-api-1".to_string(),
                provider_id: self.metadata().id.clone(),
                provider_type: ProviderType::Plugin,
                path: "/api/my-plugin/data".to_string(),
                method: HttpMethod::GET,
                description: "Get data from my plugin".to_string(),
                requires_auth: true,
                permissions: vec!["ReadData".to_string()],
                registered_at: chrono::Utc::now().to_rfc3339(),
                is_healthy: true,
            }
        ]
    }
}
```

**For Apps (via REST API):**
```bash
POST http://rumahl-core:8090/api/core/api-endpoints/register
{
  "endpoint": {
    "id": "my-app-api-1",
    "provider_id": "my-app",
    "provider_type": "app",
    "path": "/api/my-app/process",
    "method": "POST",
    "description": "Process data via my app",
    "requires_auth": true,
    "permissions": ["ProcessData"],
    "is_healthy": true
  }
}
```

### Crash Isolation

When an App or Plugin crashes:
1. The API Gateway marks all its endpoints as unhealthy
2. Requests to those endpoints return "unavailable" error
3. Other Apps, Plugins, and the core system continue working
4. When the provider recovers, endpoints can be marked healthy again

## Widget Registry

### Purpose

The Widget Registry allows Apps and Plugins to provide custom UI widgets for the rumahl dashboard. Widgets are isolated:
- Crashed providers = unavailable widgets
- Widgets are loaded dynamically via component URLs
- System continues working even if widgets fail

### Registering Widgets

**For Plugins (Rust):**
```rust
use rumahl_shared::widget_registry::{WidgetDefinition, ProviderType, WidgetType};

impl IPlugin for MyPlugin {
    async fn get_widgets(&self) -> Vec<WidgetDefinition> {
        vec![
            WidgetDefinition {
                id: "my-plugin-widget-1".to_string(),
                provider_id: self.metadata().id.clone(),
                provider_type: ProviderType::Plugin,
                name: "Data Visualizer".to_string(),
                description: "Visualizes sensor data".to_string(),
                widget_type: WidgetType::Visualization,
                component_url: "/plugins/my-plugin/widget.js".to_string(),
                config_schema: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "refresh_interval": {"type": "number"}
                    }
                })),
                default_config: Some(serde_json::json!({"refresh_interval": 5000})),
                permissions: vec!["ReadEntities".to_string()],
                registered_at: chrono::Utc::now().to_rfc3339(),
                is_available: true,
            }
        ]
    }
}
```

**For Apps (via REST API):**
```bash
POST http://rumahl-core:8090/api/core/widgets/register
{
  "widget": {
    "id": "my-app-widget-1",
    "provider_id": "my-app",
    "provider_type": "app",
    "name": "Custom Control",
    "description": "Control panel for my app",
    "widget_type": "control",
    "component_url": "http://my-app:8080/widget.js",
    "permissions": ["ControlEntities"],
    "is_available": true
  }
}
```

### Widget Types

- **Display**: Visual widgets showing information
- **Control**: Interactive widgets for controlling entities
- **Visualization**: Charts, graphs, data visualizations
- **Info**: Status and information widgets
- **Custom**: Custom widget types

### Crash Isolation

When an App or Plugin crashes:
1. The Widget Registry marks all its widgets as unavailable
2. Dashboard shows "widget unavailable" placeholder
3. Other widgets continue working normally
4. When provider recovers, widgets become available again

## API Endpoints

### API Gateway Endpoints (rumahl-core:8090)

```
GET  /api/core/api-endpoints                    - List all registered API endpoints
GET  /api/core/api-endpoints/provider/:id       - List endpoints by provider
```

### Widget Registry Endpoints (rumahl-core:8090)

```
GET  /api/core/widgets                          - List all widgets
GET  /api/core/widgets/available                - List only available widgets
GET  /api/core/widgets/:id                      - Get specific widget
GET  /api/core/widgets/provider/:id             - List widgets by provider
```

## Plugin SDK

### IPlugin Trait Extensions

```rust
#[async_trait]
pub trait IPlugin: Send + Sync {
    // ... existing methods ...

    /// Get API endpoints this plugin wants to register
    async fn get_api_endpoints(&self) -> Vec<ApiEndpoint> {
        Vec::new()
    }

    /// Get widgets this plugin wants to register
    async fn get_widgets(&self) -> Vec<WidgetDefinition> {
        Vec::new()
    }
}
```

### Sandbox Configuration

Plugins run in a sandboxed environment with resource limits:

```rust
pub struct SandboxConfig {
    pub max_execution_time_ms: u64,   // Default: 5000ms
    pub max_memory_mb: u64,            // Default: 128MB
    pub allow_network: bool,           // Default: false
    pub allow_file_system: bool,       // Default: false
}
```

## Best Practices

### For App/Plugin Developers

1. **Register APIs during initialization** - Call registration endpoints when your App/Plugin starts
2. **Unregister on shutdown** - Clean up your APIs and widgets before stopping
3. **Handle errors gracefully** - Use try/catch to prevent crashes
4. **Implement health checks** - Report your health status regularly
5. **Respect resource limits** - Stay within sandbox constraints for plugins
6. **Use permissions wisely** - Only request permissions you actually need

### For rumahl System

1. **Monitor provider health** - Regularly check if Apps/Plugins are responsive
2. **Auto-cleanup** - Remove APIs/widgets from crashed providers
3. **Timeout protection** - All external calls have 30-second timeout
4. **Log failures** - Record when providers crash for debugging
5. **Graceful degradation** - System works even when providers are unavailable

## Security

### Permission System

APIs and widgets can declare required permissions:
- `ReadEntities` - Read entity states
- `ControlEntities` - Control entities (lights, switches, etc.)
- `Storage` - Access persistent storage
- `Network` - Make external network requests
- `Notifications` - Send notifications
- `SystemInfo` - Read system information
- `PluginManager` - Manage other plugins
- `FileSystem` - Access file system
- `DatabaseRead` - Read from database
- `DatabaseWrite` - Write to database

### Isolation Guarantees

1. **Process Isolation (Apps)**: Each App runs in its own Docker container
2. **Resource Isolation (Plugins)**: Sandboxed execution with CPU/memory limits
3. **API Isolation**: All system access goes through controlled gateway
4. **Crash Isolation**: Provider crashes don't affect other providers or system
5. **Timeout Protection**: No request can block the system indefinitely

## Example: Complete Plugin with API and Widget

```rust
use rumahl_shared::{
    plugin::*,
    api_gateway::*,
    widget_registry::*,
};

pub struct WeatherPlugin {
    metadata: PluginMetadata,
}

#[async_trait]
impl IPlugin for WeatherPlugin {
    fn metadata(&self) -> &PluginMetadata {
        &self.metadata
    }

    async fn get_api_endpoints(&self) -> Vec<ApiEndpoint> {
        vec![
            ApiEndpoint {
                id: "weather-current".to_string(),
                provider_id: "weather-plugin".to_string(),
                provider_type: ProviderType::Plugin,
                path: "/api/weather/current".to_string(),
                method: HttpMethod::GET,
                description: "Get current weather".to_string(),
                requires_auth: true,
                permissions: vec!["ReadEntities".to_string()],
                registered_at: chrono::Utc::now().to_rfc3339(),
                is_healthy: true,
            }
        ]
    }

    async fn get_widgets(&self) -> Vec<WidgetDefinition> {
        vec![
            WidgetDefinition {
                id: "weather-display".to_string(),
                provider_id: "weather-plugin".to_string(),
                provider_type: ProviderType::Plugin,
                name: "Weather Display".to_string(),
                description: "Shows current weather conditions".to_string(),
                widget_type: WidgetType::Display,
                component_url: "/plugins/weather/widget.js".to_string(),
                config_schema: None,
                default_config: None,
                permissions: vec!["ReadEntities".to_string()],
                registered_at: chrono::Utc::now().to_rfc3339(),
                is_available: true,
            }
        ]
    }

    async fn run_sandboxed(&self, input: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        // Plugin logic here
        Ok(serde_json::json!({"temperature": 22.5, "conditions": "sunny"}))
    }
}
```

## Troubleshooting

### Widget Not Appearing

1. Check if widget is registered: `GET /api/core/widgets`
2. Check if widget is available: `GET /api/core/widgets/available`
3. Check provider health
4. Check browser console for loading errors

### API Endpoint Not Working

1. Check if endpoint is registered: `GET /api/core/api-endpoints`
2. Check if endpoint is healthy
3. Check provider logs for errors
4. Verify permissions are correct

### Provider Marked Unhealthy

1. Check provider logs for crashes
2. Verify provider is responding to requests
3. Check if requests are timing out (>30s)
4. Restart provider to recover
