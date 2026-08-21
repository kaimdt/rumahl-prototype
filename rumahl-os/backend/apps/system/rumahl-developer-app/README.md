# rumahl Developer App

Official development tool for the rumahl ecosystem providing exclusive hot-reload capabilities, IDE integration, and advanced development workflows.

## Overview

The rumahl Developer App is a special system application that enables:
- **Hot Reload**: Update running apps without full container restart
- **Version History**: Track all deployments with rollback capability
- **IDE Integration**: Direct deployment from development environment
- **Live Log Streaming**: Real-time logs from any container
- **Real-Time Metrics**: System performance monitoring

## Exclusive Permission

The Developer App has the exclusive `HotReload` permission - no other app can have this permission. This ensures only the official development tool can perform hot-reload operations.

## Local Build (No Registry)

**Important**: The Developer App is **NOT** pulled from a container registry. Instead, it is **built locally** as part of the rumahl system build process.

### Why Local Build?

1. **Security**: Full control over build parameters and dependencies
2. **Flexibility**: Can inject special build arguments during build
3. **No External Dependencies**: No reliance on external registries
4. **Bundled Updates**: Updated automatically with rumahl Core/Supervisor

### Building the Developer App

The Developer App is included in the main backend Dockerfile:

```bash
# Build from repository root
./scripts/build-developer-app.sh

# Or manually with Docker
cd backend
docker build \
  -f Dockerfile \
  -t rumahl-developer-app:local \
  --target rumahl-developer-app \
  --build-arg RUMAHL_DEVELOPER_APP_OFFICIAL=true \
  .
```

The image is tagged as `rumahl-developer-app:local` and used by the supervisor when Developer Mode is enabled.

## Integration with rumahl System

The Developer App is integrated into the main backend build:

1. **Workspace Member**: Listed in `backend/Cargo.toml` workspace
2. **Build Stage**: Source files copied and built in main Dockerfile
3. **Runtime Stage**: Dedicated `rumahl-developer-app` target in Dockerfile
4. **Auto-Installation**: Supervisor installs from local image when Developer Mode enabled

## No Separate Updates

The Developer App does **not** have its own update mechanism. Instead:

- Updated when rumahl Core or Supervisor is updated
- New version included in system update packages
- Build process rebuilds all services including Developer App
- Users receive Developer App updates automatically with system updates

This ensures version compatibility and reduces update complexity.

## Installation Source

When the Developer App is installed, it receives the special label:
```
ora.app.installation_source=developer_app
```

This label grants the exclusive `HotReload` permission and other Developer Mode capabilities.

## API Endpoints

The Developer App exposes the following APIs:

### Hot Reload
- `POST /api/hotreload/upload` - Upload app package
- `GET /api/hotreload/status/:app_id` - Get status
- `POST /api/hotreload/rollback/:app_id` - Rollback version
- `GET /api/hotreload/history/:app_id` - Get history

### IDE Integration
- `POST /api/ide/deploy` - Deploy from IDE
- `GET /api/ide/logs/:app_id/stream` - Stream logs (SSE)
- `GET /api/ide/metrics` - Get metrics

### Health
- `GET /health` - Health check
- `GET /info` - App information

## Usage

Enable Developer Mode to automatically install the Developer App:

```python
from rumahl_sdk import rumahlClient

async with rumahlClient("http://localhost:8080", api_key="key") as client:
    # This auto-installs Developer App from local image
    await client.toggle_developer_mode(enabled=True)

    # Use hot-reload features
    result = await client.hotreload_upload(
        app_id="com.example.app",
        version="1.1.0",
        package_data=base64_package,
        description="Bug fixes"
    )
```

See `sdks/python/examples/developer_app_hotreload.py` for a complete example.

## Security Considerations

- **Developer Mode Required**: All endpoints require Developer Mode to be enabled
- **Exclusive Permission**: Only app with `HotReload` permission
- **Local Build**: Built with full system control, no external registry
- **Read-Only Docker Socket**: Docker socket mounted read-only
- **Installation Source Verification**: Supervisor validates `installation_source` label

## Development

The Developer App is written in Rust using Actix-web:

- **Source**: `backend/rumahl-developer-app/src/main.rs`
- **Manifest**: `backend/rumahl-developer-app/manifest.json`
- **Dependencies**: `backend/rumahl-developer-app/Cargo.toml`

To modify the Developer App:
1. Edit source files in `backend/rumahl-developer-app/`
2. Rebuild: `./scripts/build-developer-app.sh`
3. Restart Developer Mode to use new version

## Documentation

- [Developer Mode Documentation](../../sdks/DEVELOPER_MODE.md)
- [Implementation Summary](../../DEVELOPER_APP_IMPLEMENTATION.md)
- [Python SDK Hot-Reload Example](../../sdks/python/examples/developer_app_hotreload.py)
