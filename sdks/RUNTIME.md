# IORA SDK Runtime Architecture

## Overview

The IORA SDK includes an enhanced runtime architecture that provides full monitoring, security, and control capabilities for all apps and plugins. This document describes the runtime features and how to use them.

## Key Features

### 1. Automatic Heartbeat System
- Apps automatically report their status to IORA every few seconds (configurable, default 5s)
- IORA monitors heartbeats and terminates unresponsive apps
- Heartbeat includes current app status

### 2. Status Reporting
Apps can be in one of the following states:

- **INITIALIZING** - App is starting up
- **IDLE** - App is running but not doing anything
- **ACTIVE** - App is actively processing
- **BACKGROUND_TASK** - App is running background operations
- **PROCESSING** - App is processing a specific task
- **BUSY** - App cannot accept new tasks
- **ERROR** - App encountered an error
- **SHUTTING_DOWN** - App is terminating

### 3. Centralized Logging
- All logs are sent to IORA automatically
- Log levels: DEBUG, INFO, WARNING, ERROR, CRITICAL
- Structured logging with context
- Automatic error capture and reporting

### 4. Dynamic Permission System
- Apps request permissions at runtime (not at initialization)
- IORA issues temporary permission tokens with expiration
- SDK automatically renews tokens before expiration
- Permission requests include context (what operation needs it)

### 5. No Hardcoded Credentials
- SDK discovers IORA connection via environment variables set by IORA
- Apps receive temporary credentials from IORA at startup
- Apps cannot start without IORA runtime
- Environment variables:
  - `IORA_APP_ID` - App identifier
  - `IORA_ENDPOINT` - IORA communication endpoint
  - `IORA_HEARTBEAT_INTERVAL` - Heartbeat interval in seconds

### 6. Bidirectional Communication
- SDK exposes endpoints for IORA to query:
  - Current status
  - Active tasks
  - Resource usage
  - Custom query handlers
- Apps can register custom query handlers for IORA commands

## Usage Examples

### Rust

```rust
use iora_sdk::prelude::*;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize runtime from environment (set by IORA)
    let runtime = RuntimeManager::from_env().await?;

    // Start runtime (heartbeat, message processing, etc.)
    runtime.start().await?;

    // Log app started
    runtime.log(
        LogLevel::Info,
        "App started",
        Some(json!({"version": "1.0.0"}))
    ).await?;

    // Update status
    runtime.set_status(
        AppStatus::Processing,
        Some("Fetching data".to_string())
    ).await?;

    // Request permission
    let token = runtime.request_permission(
        Permission::NetworkOutbound,
        "Fetch weather data",
        300 // 5 minutes
    ).await?;

    // Use the permission token for network requests
    // ...

    // Update status back to idle
    runtime.set_status(AppStatus::Idle, None).await?;

    Ok(())
}
```

### Python

```python
import asyncio
from iora_sdk import RuntimeManager, AppStatus, LogLevel, Permission

async def main():
    # Initialize runtime from environment (set by IORA)
    runtime = RuntimeManager.from_env()

    # Start runtime (heartbeat, message processing, etc.)
    await runtime.start()

    # Log app started
    await runtime.log(
        LogLevel.INFO,
        "App started",
        {"version": "1.0.0"}
    )

    # Update status
    await runtime.set_status(
        AppStatus.PROCESSING,
        "Fetching data"
    )

    # Request permission
    token = await runtime.request_permission(
        Permission.NETWORK_OUTBOUND,
        "Fetch weather data",
        300  # 5 minutes
    )

    # Use the permission token for network requests
    # ...

    # Update status back to idle
    await runtime.set_status(AppStatus.IDLE)

if __name__ == "__main__":
    asyncio.run(main())
```

### JavaScript/TypeScript

```typescript
import { RuntimeManager, AppStatus, LogLevel, Permission } from '@iora/sdk';

async function main() {
  // Initialize runtime from environment (set by IORA)
  const runtime = await RuntimeManager.fromEnv();

  // Start runtime (heartbeat, message processing, etc.)
  await runtime.start();

  // Log app started
  await runtime.log(
    LogLevel.INFO,
    'App started',
    { version: '1.0.0' }
  );

  // Update status
  await runtime.setStatus(
    AppStatus.PROCESSING,
    'Fetching data'
  );

  // Request permission
  const token = await runtime.requestPermission(
    Permission.NETWORK_OUTBOUND,
    'Fetch weather data',
    300  // 5 minutes
  );

  // Use the permission token for network requests
  // ...

  // Update status back to idle
  await runtime.setStatus(AppStatus.IDLE);
}

main();
```

## Custom Query Handlers

Apps can register custom query handlers that IORA can call:

### Rust

```rust
runtime.register_query_handler("get_stats", |params| {
    Ok(json!({
        "requests": 1234,
        "errors": 5,
        "uptime": 3600
    }))
}).await;
```

### Python

```python
def get_stats_handler(params):
    return {
        "requests": 1234,
        "errors": 5,
        "uptime": 3600
    }

runtime.register_query_handler("get_stats", get_stats_handler)
```

## Permission Token Management

The SDK automatically manages permission tokens:

1. **Request**: App requests permission with context
2. **Grant**: IORA issues temporary token with expiration
3. **Use**: App uses token for authorized operations
4. **Renewal**: SDK automatically renews before expiration
5. **Revocation**: IORA can revoke tokens at any time

## Security Model

### App Isolation
- Apps run in separate containers/processes
- No direct inter-app communication
- All communication via IORA

### Credential Management
- Credentials injected at runtime via environment
- Never stored in app code
- Automatic rotation

### SDK Verification
- SDK includes cryptographic signature (future)
- IORA validates SDK version
- Prevents modified SDKs

### Audit Trail
- All app actions logged
- Permission usage tracked
- Network activity recorded

## Message Protocol

Apps and IORA communicate using JSON messages:

### Heartbeat
```json
{
  "type": "heartbeat",
  "app_id": "weather-app",
  "status": "ACTIVE",
  "timestamp": 1234567890
}
```

### Status Update
```json
{
  "type": "status_update",
  "app_id": "weather-app",
  "old_status": "IDLE",
  "new_status": "PROCESSING",
  "details": "Fetching weather data",
  "timestamp": 1234567890
}
```

### Log Entry
```json
{
  "type": "log",
  "app_id": "weather-app",
  "level": "INFO",
  "message": "Weather data updated",
  "context": {"temperature": 25},
  "timestamp": 1234567890
}
```

### Permission Request
```json
{
  "type": "permission_request",
  "app_id": "weather-app",
  "permission": "NetworkOutbound",
  "context": "Fetch weather data",
  "duration": 300
}
```

### Permission Grant
```json
{
  "type": "permission_grant",
  "token": "eyJhbG...",
  "expires_at": 1234567890,
  "permission": "NetworkOutbound"
}
```

### Query from IORA
```json
{
  "type": "query",
  "query_id": "abc123",
  "command": "get_status",
  "params": {}
}
```

### Response to IORA
```json
{
  "type": "response",
  "query_id": "abc123",
  "data": {
    "status": "ACTIVE",
    "uptime": 3600
  }
}
```

## Migration from Old SDK

### Before (Old SDK)
```rust
let client = IoraClient::new("http://localhost:8080")
    .with_api_key("your-api-key");
```

### After (New SDK)
```rust
// No URL or API key needed - IORA provides via environment
let runtime = RuntimeManager::from_env().await?;
runtime.start().await?;

// Client is now part of runtime if needed
let client = runtime.client();
```

## Best Practices

1. **Always use RuntimeManager** for new apps
2. **Update status** when app state changes
3. **Log important events** to IORA
4. **Request permissions** with clear context
5. **Register query handlers** for custom commands
6. **Handle errors gracefully** and report to IORA
7. **Never hardcode credentials** - always use environment

## Troubleshooting

### App won't start
- Check that IORA_APP_ID is set
- Check that IORA_ENDPOINT is set
- Verify IORA runtime is running

### Heartbeat failing
- Check network connectivity to IORA_ENDPOINT
- Verify heartbeat interval is reasonable (5-10s)
- Check for errors in logs

### Permission denied
- Verify permission is declared in manifest
- Check permission context is clear
- Ensure token hasn't expired

## Future Enhancements

- WebSocket communication for real-time bidirectional messaging
- Network traffic monitoring and proxying
- Resource usage tracking (CPU, memory, network)
- Automatic crash recovery
- Hot reload support
- Distributed tracing integration
