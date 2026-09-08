# rumahl Developer Mode

## Overview

Developer Mode is a special operational mode in rumahl that enables enhanced development capabilities for Apps. When enabled, Apps can access advanced system data, communicate with other Apps, and integrate deeply with IDEs for streamlined development workflows.

**⚠️ SECURITY WARNING:** Developer Mode provides extensive system access and should **ONLY** be enabled in development/testing environments. **NEVER enable Developer Mode in production systems.**

## Enabling Developer Mode

Developer Mode must be explicitly enabled in the rumahl Control Center before any Developer Mode features become available. **When you enable Developer Mode, the rumahl Developer App is automatically installed** if not already present.

```python
# Python SDK
async with rumahlClient("http://localhost:8080", api_key="your-api-key") as client:
    # Enable Developer Mode (auto-installs Developer App)
    await client.toggle_developer_mode(enabled=True)

    # Check status
    status = await client.get_developer_mode_status()
    print(f"Developer Mode: {status['developer_mode']}")
```

```bash
# REST API
curl -X POST http://localhost:8080/api/developer/toggle \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

## rumahl Developer App

The **rumahl Developer App** (`io.rumahl.developer-app`) is the official development tool that provides exclusive hot-reload capabilities and IDE integration. It is automatically installed when you first enable Developer Mode.

### Developer App Features

- **Hot Reload**: Update running apps without full container restart
- **Version History**: Track all deployments with rollback capability
- **IDE Integration**: Direct deployment from your development environment
- **Live Log Streaming**: Real-time logs from any container
- **Real-Time Metrics**: System performance monitoring

### Exclusive Permission: HotReload

The Developer App has the exclusive `HotReload` permission, which allows it to:
- Upload app packages for hot deployment
- Manage version history and rollback
- Update apps with minimal downtime
- Preserve app state across updates

**No other app can have this permission** - it is reserved for the official Developer App only.


## Developer Mode Permissions

Apps must declare Developer Mode permissions in their manifest to use these features. All Developer Mode permissions require user consent during installation and are **ONLY** active when Developer Mode is enabled:

### Available Permissions

| Permission | Description | Use Case |
|-----------|-------------|----------|
| `DeveloperAccess` | Full system data access including internals | System monitoring, debugging tools |
| `InterAppCommunication` | Call and query other apps | Integration tools, orchestration |
| `LiveMetrics` | Real-time metrics and monitoring data | Performance monitoring, dashboards |
| `DirectDeploy` | IDE integration for build/deploy | Development tools, CI/CD |
| `DebugAccess` | Access debug interfaces and breakpoints | Debuggers, profilers |
| `LiveLogs` | Stream live logs from any component | Log viewers, debugging |
| `HotReload` | **EXCLUSIVE** - Update apps without restart, version history | Developer App only |

### Manifest Declaration

```json
{
  "id": "com.example.dev-tool",
  "name": "Development Tool",
  "type": "app",
  "permissions": [
    "DeveloperAccess",
    "InterAppCommunication",
    "LiveMetrics",
    "DirectDeploy",
    "LiveLogs"
  ]
}
```

## Developer Mode Features

### 1. Detailed App Information

Access comprehensive app information including resource usage, environment variables, and runtime details:

```python
# Python SDK
apps = await client.list_apps_detailed()

for app in apps:
    print(f"App: {app['name']} ({app['id']})")
    print(f"  State: {app['state']}")
    print(f"  Version: {app['version']}")
    print(f"  Permissions: {app['permissions']}")

    if app['resource_usage']:
        usage = app['resource_usage']
        print(f"  CPU: {usage['cpu_percent']:.2f}%")
        print(f"  Memory: {usage['memory_usage'] / 1024 / 1024:.0f} MB")
```

**Response includes:**
- Container details (ID, name, state, status)
- Environment variables
- Volume mounts
- Port mappings
- Permissions
- Real-time resource usage (CPU, memory, network)
- All Docker labels

### 2. Inter-App Communication

Call APIs of other Apps directly:

```python
# Python SDK
response = await client.call_app(
    target_app_id="com.example.weather-app",
    method="GET",
    endpoint="/api/current-weather",
    body=None
)

print(f"Status: {response['status']}")
print(f"Data: {response['data']}")

# POST request example
result = await client.call_app(
    target_app_id="com.example.automation",
    method="POST",
    endpoint="/api/triggers",
    body={"event": "motion_detected", "sensor": "living_room"}
)
```

**How it works:**
1. Supervisor inspects target app's Docker container
2. Retrieves internal IP address
3. Makes HTTP request to app's API endpoint
4. Returns response with status code and data

**Supported methods:** GET, POST, PUT, DELETE

### 3. Live System Metrics

Access real-time system metrics:

```python
# Python SDK
metrics = await client.get_live_metrics()

print(f"CPU Usage: {metrics['system']['cpu_usage']:.2f}%")
print(f"Memory: {metrics['system']['memory_used'] / 1024 / 1024:.0f} MB / {metrics['system']['memory_total'] / 1024 / 1024:.0f} MB")
print(f"Containers: {metrics['containers']['running']} running / {metrics['containers']['total']} total")
```

**Available metrics:**
- CPU usage and core count
- Memory usage (total, used, available)
- System uptime
- Container counts (total, running, stopped)
- Timestamp

### 4. IDE Integration & Direct Deployment

Deploy apps directly from your IDE:

```python
# Python SDK
import base64

# Read Docker image tar
with open("my-app-image.tar", "rb") as f:
    image_data = f.read()
    image_tar_b64 = base64.b64encode(image_data).decode("utf-8")

# Deploy to rumahl
result = await client.deploy_from_ide(
    app_id="com.example.my-app",
    image_tar=image_tar_b64,
    restart=True  # Auto-restart after deployment
)

print(f"Deployed: {result['message']}")
print(f"Restarted: {result['restarted']}")
```

**Workflow:**
1. Build Docker image locally: `docker build -t my-app .`
2. Export image: `docker save my-app -o my-app-image.tar`
3. Deploy via SDK
4. Container automatically restarts with new image

### 5. Live Log Streaming

Stream live logs from any container using Server-Sent Events (SSE):

```python
# Python SDK
async for log_line in client.stream_logs("rumahl-app-my-app"):
    print(log_line)
```

**Features:**
- Real-time log streaming
- Last 50 lines initially
- Both stdout and stderr
- Auto-reconnect on connection loss

### 6. Live Metrics Streaming

Stream real-time metrics updates:

```python
# Python SDK
import json

async for metrics_json in client.stream_metrics():
    metrics = json.loads(metrics_json)
    print(f"[{metrics['timestamp']}] CPU: {metrics['cpu_usage']:.2f}%")
```

**Updates every 2 seconds with:**
- Timestamp
- CPU usage
- Memory usage (used and total)

### 7. Hot Reload (Developer App Exclusive)

The rumahl Developer App provides exclusive hot-reload capabilities for updating running apps without full container restarts:

```python
# Python SDK
import base64

# Build and encode your app package
with open("my-app-package.tar.gz", "rb") as f:
    package_data = base64.b64encode(f.read()).decode()

# Upload for hot reload
result = await client.hotreload_upload(
    app_id="com.example.my-app",
    version="1.1.0",
    package_data=package_data,
    description="Fix critical bug and add feature"
)

print(f"Hot reload status: {result['status']}")
print(f"Checksum: {result['checksum']}")
```

**Check deployment status:**
```python
status = await client.hotreload_status("com.example.my-app")
print(f"Current version: {status['version']}")
print(f"Status: {status['status']}")
```

**View deployment history:**
```python
history = await client.hotreload_history("com.example.my-app")
for entry in history:
    print(f"v{entry['version']} - {entry['timestamp']}")
    print(f"  Description: {entry['description']}")
    print(f"  Can rollback: {entry['can_rollback']}")
```

**Rollback to previous version:**
```python
result = await client.hotreload_rollback(
    app_id="com.example.my-app",
    version="1.0.0"
)
print(f"Rolled back: {result['message']}")
```

**How it works:**
1. Package your app updates (code, config, assets)
2. Encode package as base64
3. Upload via `hotreload_upload()`
4. Developer App calculates checksum and tracks version
5. App is updated with minimal downtime
6. State preserved across update
7. Can rollback if issues arise

**Benefits:**
- Faster development iteration (seconds vs minutes)
- No full container restart needed
- Preserves app state and connections
- Version history for audit trail
- Easy rollback on errors
- Ideal for development and testing

## REST API Endpoints

All endpoints require Developer Mode to be enabled. Requests return `403 Forbidden` when Developer Mode is disabled.

### Developer Mode Control

```bash
# Get Developer Mode status
GET /api/developer/status

# Enable/disable Developer Mode
POST /api/developer/toggle
{
  "enabled": true
}
```

### App Information

```bash
# List all apps with detailed info
GET /api/developer/apps
```

### Inter-App Communication

```bash
# Call another app
POST /api/developer/apps/call
{
  "target_app_id": "com.example.app",
  "method": "GET",
  "endpoint": "/api/data",
  "body": null
}
```

### Metrics

```bash
# Get current metrics
GET /api/developer/metrics

# Stream metrics (SSE)
GET /api/developer/metrics/stream
```

### Deployment

```bash
# Deploy from IDE
POST /api/developer/deploy
{
  "app_id": "com.example.app",
  "image_tar": "base64_encoded_tar...",
  "restart": true
}
```

### Logs

```bash
# Stream logs (SSE)
GET /api/developer/logs/{container_name}/stream
```

### Hot Reload (Developer App)

```bash
# Upload package for hot reload
POST /api/hotreload/upload
{
  "app_id": "com.example.app",
  "version": "1.1.0",
  "package_data": "base64_encoded_package...",
  "description": "Bug fixes and new features"
}

# Get hot reload status
GET /api/hotreload/status/{app_id}

# Rollback to previous version
POST /api/hotreload/rollback/{app_id}
{
  "version": "1.0.0"
}

# Get deployment history
GET /api/hotreload/history/{app_id}
```

## Example: Development Tool App

Complete example of a development tool that uses Developer Mode:

```python
"""
rumahl Development Tool - Monitor apps and system metrics
"""
from rumahl_sdk import rumahlClient
import asyncio
import json

async def main():
    async with rumahlClient("http://localhost:8080", api_key="dev-api-key") as client:
        # Enable Developer Mode
        await client.toggle_developer_mode(enabled=True)
        print("✓ Developer Mode enabled")

        # List all apps with details
        print("\n=== Apps ===")
        apps = await client.list_apps_detailed()
        for app in apps:
            print(f"\n{app['name']} (v{app['version']})")
            print(f"  ID: {app['id']}")
            print(f"  State: {app['state']}")

            if app['resource_usage']:
                usage = app['resource_usage']
                print(f"  CPU: {usage['cpu_percent']:.2f}%")
                print(f"  Memory: {usage['memory_usage'] / 1024 / 1024:.0f} MB")

        # Get system metrics
        print("\n=== System Metrics ===")
        metrics = await client.get_live_metrics()
        print(f"CPU: {metrics['system']['cpu_usage']:.2f}%")
        print(f"Memory: {metrics['system']['memory_used'] / 1024 / 1024:.0f} MB")
        print(f"Containers: {metrics['containers']['running']} running")

        # Inter-app communication example
        print("\n=== Calling Weather App ===")
        try:
            response = await client.call_app(
                target_app_id="com.example.weather",
                method="GET",
                endpoint="/api/current",
                body=None
            )
            print(f"Weather data: {response['data']}")
        except Exception as e:
            print(f"Weather app not available: {e}")

        # Stream logs for 10 seconds
        print("\n=== Streaming Logs ===")
        async def stream_logs_for_duration():
            try:
                async for log_line in client.stream_logs("rumahl-app-weather"):
                    print(f"[LOG] {log_line}")
            except asyncio.TimeoutError:
                pass

        await asyncio.wait_for(stream_logs_for_duration(), timeout=10.0)

if __name__ == "__main__":
    asyncio.run(main())
```

## IDE Integration Example

### VS Code Task Configuration

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Deploy to rumahl",
      "type": "shell",
      "command": "python",
      "args": ["${workspaceFolder}/scripts/deploy_to_ora.py"],
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

### Deployment Script

```python
#!/usr/bin/env python3
"""deploy_to_ora.py - Deploy app to rumahl from IDE"""
import asyncio
import subprocess
import base64
from rumahl_sdk import rumahlClient

async def deploy():
    # Build Docker image
    print("Building Docker image...")
    subprocess.run(["docker", "build", "-t", "my-app", "."], check=True)

    # Export image
    print("Exporting image...")
    subprocess.run(["docker", "save", "my-app", "-o", "my-app.tar"], check=True)

    # Read and encode
    with open("my-app.tar", "rb") as f:
        image_tar = base64.b64encode(f.read()).decode("utf-8")

    # Deploy to rumahl
    print("Deploying to rumahl...")
    async with rumahlClient("http://rumahl-dev.local:8080", api_key="dev-key") as client:
        result = await client.deploy_from_ide(
            app_id="com.example.my-app",
            image_tar=image_tar,
            restart=True
        )
        print(f"✓ {result['message']}")

if __name__ == "__main__":
    asyncio.run(deploy())
```

## Security Considerations

### Why Developer Mode is Dangerous

Developer Mode bypasses many security restrictions:

1. **Full System Access:** Apps can read all system internals
2. **Inter-App Communication:** Apps can call any other app's APIs
3. **Direct Deployment:** IDE can push arbitrary code
4. **Log Access:** Access to all system and app logs
5. **Metrics Access:** Detailed system performance data

### Best Practices

1. **NEVER enable in production**
2. **Use separate API keys** for Developer Mode
3. **Revoke Developer Mode permissions** before app distribution
4. **Monitor Developer Mode usage** via audit logs
5. **Enable only when actively developing**
6. **Use network isolation** (firewall development systems)

### Production Deployment

When deploying to production:

```json
{
  "id": "com.example.my-app",
  "name": "My App",
  "type": "app",
  "permissions": [
    "ReadEntities",
    "ControlEntities",
    "SendNotifications"
    // ❌ NO Developer Mode permissions
  ]
}
```

Remove ALL Developer Mode permissions from manifest before production release.

## Troubleshooting

### Developer Mode endpoints return 403

- Verify Developer Mode is enabled: `GET /api/developer/status`
- Check app has required permissions in manifest
- Ensure API key has necessary privileges

### Inter-app communication fails

- Verify target app is running: `GET /api/supervisor/apps`
- Check target app exposes HTTP API
- Ensure correct endpoint path
- Verify network connectivity between containers

### Log/metrics streaming disconnects

- Normal after long idle periods
- Client should reconnect automatically
- Check network stability
- Increase client timeout if needed

### Deployment fails

- Verify Docker image is valid: `docker load < my-app.tar`
- Check base64 encoding is correct
- Ensure sufficient disk space
- Check rumahl supervisor logs

## Support

For issues or questions:
- GitHub Issues: https://github.com/rumahl/home-assistant-dashb/issues
- Documentation: https://rumahl-docs.example.com/developer-mode
- Community Forum: https://forum.ora.example.com/
