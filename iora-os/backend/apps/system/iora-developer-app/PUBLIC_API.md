# IORA Developer App - Public API Documentation

This document describes the public APIs provided by the IORA Developer App that can be accessed by other apps when Developer Mode is enabled.

## Overview

The Developer App exposes several **public endpoints** that allow other IORA apps to access development features when running in Developer Mode. These endpoints do not require the exclusive Developer App token and can be called using a standard API key.

## Authentication

Public endpoints can be accessed in two ways:

1. **API Key** (recommended for other apps):
   ```
   X-API-Key: your-api-key-here
   ```

2. **No Authentication** (for status endpoint only):
   Some endpoints like `/api/public/developer-status` are completely public and require no authentication.

## Public Endpoints

### 1. Get Developer Mode Status

**Endpoint**: `GET /api/public/developer-status`

**Description**: Check if Developer Mode is currently enabled.

**Authentication**: None required (completely public)

**Response**:
```json
{
  "developer_mode_enabled": true,
  "timestamp": "2026-04-21T12:00:00Z",
  "service": "iora-developer-app"
}
```

**Example**:
```python
from iora_sdk import IoraClient

async with IoraClient("http://localhost:8080") as client:
    status = await client.get("/apps/io.iora.developer-app/api/public/developer-status")
    if status["developer_mode_enabled"]:
        print("Developer Mode is active")
```

### 2. Get App Deployment Information

**Endpoint**: `GET /api/public/deployment-info/:app_id`

**Description**: Get deployment information for a specific app, including version, deployment time, and status.

**Authentication**: API Key required

**Developer Mode**: Required

**Parameters**:
- `app_id` (path): The ID of the app to query (e.g., "com.example.my-app")

**Response**:
```json
{
  "app_id": "com.example.my-app",
  "version": "1.2.0",
  "deployed_at": "2026-04-21T10:30:00Z",
  "status": "running",
  "hot_reload_count": 5,
  "last_reload": "2026-04-21T11:45:00Z"
}
```

**Example**:
```python
async with IoraClient("http://localhost:8080", api_key="your-key") as client:
    info = await client.get(
        "/apps/io.iora.developer-app/api/public/deployment-info/com.example.my-app"
    )
    print(f"App version: {info['version']}")
    print(f"Status: {info['status']}")
```

### 3. Get App Metrics

**Endpoint**: `GET /api/public/app-metrics/:app_id`

**Description**: Get runtime metrics for a specific app, including memory usage, CPU, and request statistics.

**Authentication**: API Key required

**Developer Mode**: Required

**Parameters**:
- `app_id` (path): The ID of the app to query

**Response**:
```json
{
  "app_id": "com.example.my-app",
  "timestamp": "2026-04-21T12:00:00Z",
  "metrics": {
    "memory_mb": 128.5,
    "cpu_percent": 5.2,
    "requests_total": 1543,
    "requests_per_second": 12.3,
    "errors_total": 3,
    "uptime_seconds": 86400
  }
}
```

**Example**:
```python
async with IoraClient("http://localhost:8080", api_key="your-key") as client:
    metrics = await client.get(
        "/apps/io.iora.developer-app/api/public/app-metrics/com.example.my-app"
    )
    print(f"Memory: {metrics['metrics']['memory_mb']} MB")
    print(f"CPU: {metrics['metrics']['cpu_percent']}%")
```

## Use Cases

### Self-Monitoring Apps

Apps can monitor their own deployment status and metrics:

```python
async def check_my_status():
    async with IoraClient(IORA_URL, api_key=API_KEY) as client:
        # Check if Developer Mode is active
        dev_status = await client.get(
            "/apps/io.iora.developer-app/api/public/developer-status"
        )

        if not dev_status["developer_mode_enabled"]:
            return

        # Get my deployment info
        my_info = await client.get(
            f"/apps/io.iora.developer-app/api/public/deployment-info/{MY_APP_ID}"
        )

        # Get my metrics
        my_metrics = await client.get(
            f"/apps/io.iora.developer-app/api/public/app-metrics/{MY_APP_ID}"
        )

        # Display in UI or log
        print(f"Running version {my_info['version']}")
        print(f"Memory usage: {my_metrics['metrics']['memory_mb']} MB")
```

### Development Dashboards

Create a dashboard app that monitors all running apps:

```python
async def create_dev_dashboard():
    async with IoraClient(IORA_URL, api_key=API_KEY) as client:
        # Get list of all apps
        apps = await client.list_apps()

        dashboard_data = []
        for app in apps:
            # Get deployment info for each app
            info = await client.get(
                f"/apps/io.iora.developer-app/api/public/deployment-info/{app['id']}"
            )

            # Get metrics for each app
            metrics = await client.get(
                f"/apps/io.iora.developer-app/api/public/app-metrics/{app['id']}"
            )

            dashboard_data.append({
                "app": app,
                "info": info,
                "metrics": metrics
            })

        return dashboard_data
```

### IDE Integration

IDEs can query app status before and after deployment:

```python
async def ide_deployment_workflow():
    async with IoraClient(IORA_URL, api_key=API_KEY) as client:
        # Check Developer Mode is enabled
        status = await client.get(
            "/apps/io.iora.developer-app/api/public/developer-status"
        )
        if not status["developer_mode_enabled"]:
            raise Exception("Enable Developer Mode first")

        # Get current version
        before = await client.get(
            f"/apps/io.iora.developer-app/api/public/deployment-info/{APP_ID}"
        )
        print(f"Current version: {before['version']}")

        # Deploy new version
        await client.hotreload_upload(...)

        # Verify new version
        await asyncio.sleep(2)
        after = await client.get(
            f"/apps/io.iora.developer-app/api/public/deployment-info/{APP_ID}"
        )
        print(f"New version: {after['version']}")
```

## Security Considerations

1. **Developer Mode Gating**: Most public endpoints require Developer Mode to be enabled
2. **API Key Required**: Deployment info and metrics require a valid API key
3. **No Exclusive Features**: Public endpoints cannot perform hot-reload or other exclusive operations
4. **Read-Only**: All public endpoints are read-only and cannot modify app state

## Dynamic API Documentation

All public endpoints are documented in the dynamic Swagger UI available at:

```
http://localhost:8080/apps/io.iora.developer-app/swagger-ui/
```

The Swagger UI automatically reflects:
- All active endpoints
- Request/response schemas
- Authentication requirements
- Example requests

## Error Responses

All endpoints return standard error responses:

**Developer Mode Disabled**:
```json
{
  "error": "Developer Mode is not enabled",
  "message": "Enable Developer Mode in IORA Control Center to access this endpoint"
}
```

**Authentication Required**:
```json
{
  "error": "Authentication required",
  "message": "Provide valid Developer App token or API key"
}
```

**App Not Found**:
```json
{
  "error": "App not found",
  "app_id": "com.example.missing-app"
}
```

## See Also

- [Developer Mode Documentation](../../sdks/DEVELOPER_MODE.md)
- [Hot-Reload Example](../../sdks/python/examples/developer_app_hotreload.py)
- [Developer App README](./README.md)
