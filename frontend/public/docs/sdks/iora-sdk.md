# IORA SDK Documentation

## Overview

Welcome to the IORA SDK! This documentation will guide you through creating Apps and Plugins for the IORA platform. IORA provides a secure, isolated environment for extending the platform while ensuring system stability.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Apps vs Plugins](#apps-vs-plugins)
3. [Registration Process](#registration-process)
4. [API Access](#api-access)
5. [Widget Development](#widget-development)
6. [Security & Permissions](#security--permissions)
7. [Update System](#update-system)
8. [Best Practices](#best-practices)
9. [Examples](#examples)
10. [Testing](#testing)

---

## Getting Started

### Prerequisites

- **For Apps**: Docker installed and basic Docker knowledge
- **For Plugins**: Rust toolchain (rustc, cargo)
- IORA Core running (iora.local:8090) or access to IORA instance
- IORA Supervisor running (iora.local:8097) for Apps

### Quick Start

1. Choose between creating an App or Plugin
2. Follow the registration process
3. Implement required interfaces
4. Test locally
5. Submit for approval
6. Deploy

---

## Apps vs Plugins

### Apps (Docker Containers)

**Best for:**
- Long-running services
- Independent microservices
- Complex dependencies
- Need full OS environment
- Database services
- Web applications

**Characteristics:**
- Run continuously as Docker containers
- Full isolation via containerization
- Can expose ports and volumes
- Managed by `iora-supervisor` (port 8097)
- Access IORA system via API Gateway only

**Example Use Cases:**
- Weather data aggregation service
- Custom dashboard backend
- Third-party integration service
- Database for app-specific data

### Plugins (Rust Code)

**Best for:**
- On-demand execution
- Data processing tasks
- Automation scripts
- Quick integrations
- Lightweight extensions

**Characteristics:**
- Execute on-demand in sandboxed environment
- Resource limits (CPU, memory, execution time)
- Managed by `iora-core` (port 8090)
- Access IORA system via API Gateway only
- Can register custom APIs and widgets

**Example Use Cases:**
- Data transformation plugin
- Custom notification formatter
- Scheduled task executor
- Simple API endpoint

---

## Registration Process

All Apps and Plugins must register with IORA before accessing the system.

### 1. Create manifest.json

```json
{
  "id": "my-weather-app",
  "name": "Weather Service",
  "version": "1.0.0",
  "developer": "Your Name",
  "description": "Provides weather data and forecasts",
  "type": "app",
  "permissions": [
    "ReadWeatherData",
    "WriteCache",
    "NetworkAccess"
  ],
  "endpoints": [
    {
      "path": "/api/weather/current",
      "method": "GET",
      "description": "Get current weather",
      "requires_auth": true
    }
  ],
  "widgets": [
    {
      "id": "weather-widget",
      "name": "Weather Widget",
      "type": "dashboard",
      "component_url": "http://my-app:3000/widget.js"
    }
  ]
}
```

### 2. Submit Registration Request

**For Apps:**
```bash
curl -X POST http://iora-supervisor:8097/api/supervisor/apps/register \
  -H "Content-Type: application/json" \
  -d @manifest.json
```

**For Plugins:**
```bash
curl -X POST http://iora-core:8090/api/core/plugins/register \
  -H "Content-Type: application/json" \
  -d @manifest.json
```

### 3. Wait for Approval

An IORA administrator will review your registration request in the Admin Panel under "Registrierungen" tab. They can:
- Approve (grants API token)
- Reject (denied access)
- Suspend (temporary revocation)
- Revoke (permanent removal)

### 4. Receive API Token

Once approved, you'll receive an API token:

```json
{
  "status": "approved",
  "api_token": "iora_app_1234567890abcdef...",
  "approved_at": "2026-04-20T10:00:00Z"
}
```

Store this token securely - it's required for all API calls.

---

## API Access

All Apps and Plugins access IORA through the **API Gateway**. Direct access to internal services is prohibited.

### Making API Requests

Every API request must include your token:

```bash
curl -X GET http://iora-core:8090/api/gateway/system/status \
  -H "Authorization: Bearer iora_app_1234567890abcdef..."
```

### Available APIs

The API Gateway provides access to:

- **System APIs**: Read system status, metrics
- **Event APIs**: Subscribe to system events
- **State APIs**: Read/write application state
- **Custom APIs**: Registered by other apps/plugins

### Request Timeout

All API requests timeout after **30 seconds**. Ensure your logic handles this:

```rust
// Good - handles timeout
match tokio::time::timeout(
    Duration::from_secs(25),
    api_call()
).await {
    Ok(result) => result,
    Err(_) => Err(anyhow!("Operation timed out"))
}
```

### Error Handling

API Gateway returns standard HTTP status codes:

- `200 OK`: Success
- `401 Unauthorized`: Invalid/missing token
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Endpoint doesn't exist
- `503 Service Unavailable`: Provider crashed/unhealthy
- `504 Gateway Timeout`: Request exceeded 30s

---

## Widget Development

Widgets allow your App/Plugin to provide UI components in the IORA dashboard.

### Widget Types

- `dashboard`: Main dashboard widgets
- `sidebar`: Sidebar widgets
- `modal`: Modal/overlay widgets
- `notification`: Notification widgets

### Creating a Widget

#### 1. Implement Widget Component

Create a JavaScript/TypeScript component:

```typescript
// weather-widget.tsx
import { useState, useEffect } from 'react'

export function WeatherWidget({ config, apiToken }) {
  const [weather, setWeather] = useState(null)

  useEffect(() => {
    fetch('http://iora-core:8090/api/gateway/weather/current', {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    })
      .then(r => r.json())
      .then(setWeather)
  }, [])

  if (!weather) return <div>Loading...</div>

  return (
    <div className="weather-widget">
      <h3>{weather.temperature}°C</h3>
      <p>{weather.condition}</p>
    </div>
  )
}
```

#### 2. Serve Widget Component

Host your widget on a URL accessible to IORA:

```javascript
// For Apps (in your Docker container)
app.get('/widgets/weather.js', (req, res) => {
  res.sendFile('/app/dist/weather-widget.js')
})
```

#### 3. Register Widget

**Via Plugin Code:**
```rust
use iora_shared::widget_registry::{WidgetDefinition, WidgetType};

impl IPlugin for WeatherPlugin {
    async fn get_widgets(&self) -> Vec<WidgetDefinition> {
        vec![WidgetDefinition {
            id: "weather-widget".to_string(),
            provider_id: self.metadata().id.clone(),
            provider_type: ProviderType::Plugin,
            name: "Weather Widget".to_string(),
            description: "Displays current weather".to_string(),
            widget_type: WidgetType::Dashboard,
            component_url: "http://weather-plugin:3000/widget.js".to_string(),
            config_schema: None,
            default_config: None,
            permissions: vec!["ReadWeatherData".to_string()],
            registered_at: chrono::Utc::now().to_rfc3339(),
            is_available: true,
        }]
    }
}
```

**Via API (for Apps):**
```bash
curl -X POST http://iora-core:8090/api/core/widgets/register \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "widget": {
      "id": "weather-widget",
      "provider_id": "weather-app",
      "name": "Weather Widget",
      "widget_type": "dashboard",
      "component_url": "http://weather-app:3000/widget.js",
      "permissions": ["ReadWeatherData"]
    }
  }'
```

### Widget Lifecycle

1. **Registration**: Widget registered with component URL
2. **Available**: Widget marked as available, shown in dashboard
3. **Crash**: If provider crashes, widget marked unavailable
4. **Default View**: IORA shows default "unavailable" view
5. **Recovery**: When provider recovers, widget becomes available again

---

## Security & Permissions

### Permission System

Permissions are declared in your manifest and enforced by the API Gateway.

**Standard Permissions:**
- `ReadData`: Read application data
- `WriteData`: Write application data
- `ReadSystemStatus`: Read system metrics
- `ReadEvents`: Subscribe to system events
- `WriteEvents`: Publish custom events
- `NetworkAccess`: Make external network requests
- `FileSystemAccess`: Access sandboxed filesystem (plugins only)

**Custom Permissions:**
You can define custom permissions for your APIs:

```rust
ApiEndpoint {
    id: "weather-update".to_string(),
    path: "/api/weather/update".to_string(),
    method: HttpMethod::POST,
    permissions: vec!["UpdateWeatherData".to_string()],
    // ...
}
```

### Security Monitor

IORA automatically monitors your App/Plugin:

- **CPU Usage**: Alert if sustained >80%
- **Memory Usage**: Alert if >90% of limit
- **Network Traffic**: Alert on anomalous patterns
- **API Call Patterns**: Detect abuse/anomalies
- **Crash Detection**: Automatic logging and alerts

Administrators can view security events in the "Sicherheit" tab.

### Sandbox Limits (Plugins)

Plugins run in a sandbox with enforced limits:

```rust
pub struct SandboxConfig {
    pub max_execution_time_ms: u64,  // Default: 30000 (30s)
    pub max_memory_mb: u64,           // Default: 512MB
    pub allow_network: bool,           // Default: false
    pub allow_file_system: bool,       // Default: false
}
```

Configure in your plugin metadata:

```rust
PluginMetadata {
    sandbox_config: SandboxConfig {
        max_execution_time_ms: 10000,  // 10 seconds
        max_memory_mb: 256,
        allow_network: true,
        allow_file_system: false,
    },
    // ...
}
```

---

## Update System

IORA provides automated update management for your App/Plugin.

### Update Channels

Choose an update channel:

- **stable**: Production-ready releases (recommended)
- **beta**: Pre-release testing
- **alpha**: Early access, may have bugs
- **dev**: Development builds, unstable

### Implementing Updates

#### 1. Create Update Manifest

```json
{
  "provider_id": "my-weather-app",
  "version": "1.1.0",
  "channel": "stable",
  "is_critical": false,
  "release_notes": "Added UV index support and improved caching",
  "download_url": "https://releases.myapp.com/weather-1.1.0.tar.gz",
  "sha256": "abc123...",
  "released_at": "2026-04-20T12:00:00Z"
}
```

#### 2. Publish Update

```bash
curl -X POST http://iora-core:8090/api/core/updates/publish \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @update-manifest.json
```

#### 3. Users Get Notified

IORA automatically:
- Checks for updates periodically
- Notifies administrators in "Updates" tab
- Highlights critical updates
- Allows manual installation or rollback

### Critical Updates

Mark security fixes as critical:

```json
{
  "is_critical": true,
  "release_notes": "CRITICAL: Fixes authentication bypass vulnerability (CVE-2026-1234)"
}
```

Critical updates are highlighted in red in the admin UI.

### Rollback Support

IORA automatically tracks update history. Administrators can rollback to previous versions if an update causes issues.

---

## Best Practices

### 1. Handle Timeouts Gracefully

```rust
// Bad - can hang indefinitely
let response = api_client.get("/data").await?;

// Good - respects 30s timeout
let response = tokio::time::timeout(
    Duration::from_secs(25),
    api_client.get("/data")
).await??;
```

### 2. Implement Health Checks

```rust
#[async_trait]
impl IApiProvider for MyApp {
    async fn is_healthy(&self) -> bool {
        // Check database connection, external APIs, etc.
        self.db.ping().await.is_ok()
    }
}
```

### 3. Log Appropriately

```rust
// Don't log sensitive data
tracing::info!("User {} logged in", user_id); // Bad
tracing::info!("User authentication successful"); // Good

// Use appropriate log levels
tracing::debug!("Processing request");
tracing::info!("Service started");
tracing::warn!("Cache miss, fetching from API");
tracing::error!("Database connection failed: {}", error);
```

### 4. Respect Resource Limits

```rust
// Monitor your own resource usage
if memory_usage > max_memory * 0.9 {
    tracing::warn!("Memory usage high, triggering cleanup");
    self.cleanup_cache().await;
}
```

### 5. Handle Crashes Gracefully

```rust
// Catch and log panics
let result = std::panic::catch_unwind(|| {
    // Potentially panicking code
    risky_operation()
});

match result {
    Ok(value) => value,
    Err(err) => {
        tracing::error!("Operation panicked: {:?}", err);
        return Err(anyhow!("Internal error"))
    }
}
```

### 6. Version Your APIs

```rust
ApiEndpoint {
    path: "/api/v1/weather/current".to_string(),  // Good
    // path: "/api/weather/current".to_string(),  // Bad
    // ...
}
```

### 7. Document Your APIs

```rust
ApiEndpoint {
    path: "/api/v1/weather/current".to_string(),
    description: "Returns current weather conditions for the configured location. Response includes temperature (Celsius), humidity (%), wind speed (km/h), and condition description.".to_string(),
    // ...
}
```

### 8. Test Before Publishing

- Test locally with IORA dev environment
- Verify all APIs return expected data
- Test widget rendering in different themes
- Test crash recovery
- Verify permission requirements

---

## Examples

See the `examples/` directory for complete working examples:

### Example App: Weather Service

Located in `examples/weather-app/`

A complete Docker-based app that:
- Fetches weather data from external API
- Provides REST API for current weather
- Displays dashboard widget
- Implements caching
- Handles crashes gracefully

### Example Plugin: Data Transformer

Located in `examples/data-transformer-plugin/`

A Rust plugin that:
- Registers custom API endpoint
- Transforms data on-demand
- Respects sandbox limits
- Implements proper error handling

---

## Testing

### Local Development Setup

1. **Start IORA services:**
```bash
docker-compose up -d iora-core iora-supervisor
```

2. **For Apps - Build and run your container:**
```bash
docker build -t my-app .
docker run -p 3000:3000 my-app
```

3. **For Plugins - Build and test:**
```bash
cargo build --release
cargo test
```

### Testing Checklist

- [ ] App/Plugin registers successfully
- [ ] All API endpoints return expected responses
- [ ] Widgets render correctly
- [ ] Handles API Gateway timeouts
- [ ] Respects resource limits (plugins)
- [ ] Health check returns accurate status
- [ ] Crash recovery works
- [ ] Update system functions
- [ ] Permissions are enforced
- [ ] Security monitor doesn't flag anomalies

### Integration Testing

Create test cases for:

```rust
#[tokio::test]
async fn test_api_timeout() {
    // Verify your code handles 30s timeout
}

#[tokio::test]
async fn test_permission_denied() {
    // Verify graceful handling of 403 responses
}

#[tokio::test]
async fn test_provider_crash() {
    // Verify widget shows default view when crashed
}
```

---

## Support & Resources

- **Documentation**: `/docs/`
- **Examples**: `/examples/`
- **Issue Tracker**: GitHub Issues
- **Community**: IORA Discord Server
- **Security**: security@iora.dev

## License

IORA SDK is licensed under the MIT License. See LICENSE file for details.
