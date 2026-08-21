# App Store and Developer Mode Restrictions

## Overview

rumahl implements strict access control for Developer Mode features based on installation source. This ensures that App Store apps cannot access dangerous development features while allowing manually uploaded apps and the special Developer App to utilize these capabilities.

## Installation Sources

rumahl tracks three types of app installation sources:

### 1. App Store (`app_store`)

- **Description**: Apps distributed through the official rumahl App Store
- **Developer Mode Access**: **FORBIDDEN** - Never allowed, regardless of manifest configuration or global Developer Mode setting
- **Restrictions**:
  - Cannot access ANY Developer Mode APIs
  - Cannot use Developer Mode permissions
  - Attempting to access Developer Mode endpoints returns `403 Forbidden`
- **Purpose**: Ensures App Store apps meet security standards and cannot abuse system access

### 2. Manual Upload (`manual_upload`)

- **Description**: Apps uploaded directly by users (ZIP files, direct installations)
- **Developer Mode Access**: **ALLOWED** - Can use Developer Mode features when enabled
- **Requirements**:
  - Developer Mode must be globally enabled in rumahl Control Center
  - App manifest must set `developer_mode.allowed = true`
  - In production environments, requires `developer_mode.allow_in_production = true`
- **Use Cases**: Personal development, testing, custom integrations

### 3. Developer App (`developer_app`)

- **Description**: Special rumahl system app for development tools
- **Developer Mode Access**: **FULL ACCESS** - Complete access including exclusive features
- **Special Privileges**:
  - Can use all Developer Mode permissions
  - Has exclusive access to `HotReload` permission
  - Auto-installs when Developer Mode is first enabled
  - Reinstalls if deleted when Developer Mode is re-enabled
- **Purpose**: Provides IDE integration, hot reload, and development workflow tools

## Environment-Based Restrictions

### Production Environment (`ENV=production`)

When running in production:

- Developer Mode is **automatically restricted** for most apps
- Apps from App Store: Always blocked (as usual)
- Manual upload apps: Blocked UNLESS `developer_mode.allow_in_production = true`
- Developer App: Allowed (but should be disabled in true production)

### Development Environment (`ENV=development`)

Default mode. Developer Mode restrictions are based solely on installation source:

- App Store apps: Still blocked
- Manual upload apps: Allowed when Developer Mode enabled
- Developer App: Allowed

## Manifest Configuration

### App Store Apps

**MUST NOT** include Developer Mode configuration:

```json
{
  "id": "com.store.myapp",
  "name": "My App",
  "type": "app",
  "permissions": [
    "ReadEntities",
    "ControlEntities"
  ]
  // NO developer_mode configuration
  // NO Developer Mode permissions
}
```

**Validation**: App Store submissions are rejected if they include:
- Developer Mode permissions (`DeveloperAccess`, `InterAppCommunication`, etc.)
- `developer_mode` configuration section
- `installation_source` set to anything other than `app_store`

### Manual Upload Apps

**CAN** include Developer Mode configuration:

```json
{
  "id": "com.custom.devtool",
  "name": "My Dev Tool",
  "type": "app",
  "permissions": [
    "ReadEntities",
    "DeveloperAccess",
    "LiveMetrics",
    "LiveLogs"
  ],
  "developer_mode": {
    "allowed": true,
    "allow_in_production": false
  }
}
```

### Developer App

Has exclusive permissions:

```json
{
  "id": "io.rumahl.developer-app",
  "name": "rumahl Developer",
  "type": "app",
  "permissions": [
    "DeveloperAccess",
    "InterAppCommunication",
    "LiveMetrics",
    "DirectDeploy",
    "DebugAccess",
    "LiveLogs",
    "HotReload"  // EXCLUSIVE - only Developer App can have this
  ],
  "installation_source": "developer_app"
}
```

## Access Control Flow

### API Request Validation

When an app attempts to access a Developer Mode endpoint:

1. **Global Check**: Is Developer Mode enabled in rumahl Control Center?
   - If NO → `403 Forbidden: Developer Mode is not enabled`

2. **Installation Source Check**: What is the app's installation source?
   - If `app_store` → `403 Forbidden: App Store apps cannot access Developer Mode features`
   - If unknown/invalid → `403 Forbidden: Invalid installation source`

3. **Environment Check**: Is this a production environment?
   - If YES and app is manual_upload → Check `allow_in_production` flag
   - If flag is false → `403 Forbidden: Developer Mode disabled in production`

4. **Permission Check**: Does the app have the required Developer Mode permission?
   - If NO → `403 Forbidden: Missing required permission`

5. **Exclusive Permission Check** (for HotReload only):
   - If app is not Developer App → `403 Forbidden: This API is exclusive to the Developer App`

6. **Access Granted** → Proceed with request

## Developer Mode Permissions

### Standard Developer Mode Permissions

Available to manual_upload and developer_app when Developer Mode is enabled:

| Permission | Description | Risk |
|------------|-------------|------|
| `DeveloperAccess` | Full system data access including internals | Critical |
| `InterAppCommunication` | Call and query other apps | Critical |
| `LiveMetrics` | Real-time metrics and monitoring data | Critical |
| `DirectDeploy` | IDE integration for build/deploy | Critical |
| `DebugAccess` | Access debug interfaces and breakpoints | Critical |
| `LiveLogs` | Stream live logs from any component | Critical |

### Exclusive Permission

Only available to `developer_app`:

| Permission | Description | Exclusivity |
|------------|-------------|-------------|
| `HotReload` | Hot reload and live app upload APIs | Developer App ONLY |

## Developer App System

### Auto-Installation

The Developer App automatically installs when:

1. Developer Mode is enabled for the first time
2. Developer App was deleted and Developer Mode is re-enabled

**Installation Process**:
```bash
# When Developer Mode toggle is set to true:
1. Check if Developer App exists
2. If not found:
   a. Pull rumahl-developer-app image
   b. Create container with installation_source=developer_app
   c. Set all required permissions
   d. Start container
   e. Register in rumahl system
```

### Exclusive Hot Reload APIs

The Developer App has access to special endpoints not visible to other apps:

```
POST /api/developer/hotreload/upload
  - Upload app package for live deployment
  - Extracts and updates running container
  - Preserves state across reloads

GET /api/developer/hotreload/status/{app_id}
  - Check hot reload status
  - Returns: pending, in_progress, completed, failed

POST /api/developer/hotreload/rollback/{app_id}
  - Rollback to previous version
  - Reverts to last stable state

GET /api/developer/hotreload/history/{app_id}
  - Get hot reload history
  - Returns: timestamps, versions, success/failure
```

**Endpoint Protection**:
- These endpoints are NOT listed in API documentation
- Return `404 Not Found` for non-Developer App requests
- Require `HotReload` permission (which only Developer App can have)

## Implementation Examples

### Checking Installation Source (Rust)

```rust
// In supervisor endpoint handlers
async fn developer_mode_endpoint(
    data: web::Data<AppState>,
    app_id: web::Path<String>,
) -> impl Responder {
    // Use the new access control function
    if let Err(response) = check_developer_mode_access(&data, &app_id).await {
        return response;
    }

    // Proceed with Developer Mode operation
    // ...
}
```

### Setting Installation Source During Install

```rust
// In app installation code
let mut labels = HashMap::new();
labels.insert("ora.managed".to_string(), "true".to_string());
labels.insert("ora.type".to_string(), "app".to_string());
labels.insert("ora.app.id".to_string(), app.id.clone());

// Set installation source based on origin
let installation_source = match install_origin {
    InstallOrigin::AppStore => "app_store",
    InstallOrigin::Manual => "manual_upload",
    InstallOrigin::DeveloperApp => "developer_app",
};
labels.insert("ora.app.installation_source".to_string(), installation_source.to_string());

// Store developer mode config if present
if let Some(dev_config) = &app.manifest.developer_mode {
    labels.insert(
        "ora.app.developer_mode.allowed".to_string(),
        dev_config.allowed.to_string()
    );
    labels.insert(
        "ora.app.developer_mode.allow_in_production".to_string(),
        dev_config.allow_in_production.to_string()
    );
}
```

## Security Implications

### Why App Store Apps Are Restricted

1. **Trust Model**: App Store apps are distributed to many users
2. **Audit Requirements**: Developer Mode features bypass security audits
3. **Privilege Escalation**: Developer Mode provides system-level access
4. **Production Safety**: Apps in production should not have dev features
5. **User Protection**: Prevents malicious apps from abusing dev APIs

### Why Manual Upload Is Allowed

1. **User Control**: User explicitly uploaded the app
2. **Development Workflow**: Enables app development and testing
3. **Custom Integration**: Allows power users to create custom solutions
4. **Trust Assumption**: User trusts apps they manually upload

### Why Developer App Is Special

1. **System Component**: Part of rumahl's development infrastructure
2. **Signed by rumahl**: Cryptographically signed by rumahl team
3. **Audited Code**: Open source and audited by community
4. **Exclusive Features**: Needs capabilities no other app should have
5. **Hidden APIs**: Some endpoints are intentionally undiscoverable

## Migration Guide

### For App Developers

If you have an existing app in development:

**Before (old system)**:
```json
{
  "permissions": ["DeveloperAccess"]
}
```

**After (new system)**:
```json
{
  "permissions": ["DeveloperAccess"],
  "developer_mode": {
    "allowed": true,
    "allow_in_production": false
  }
}
```

**IMPORTANT**: If submitting to App Store, REMOVE all Developer Mode configuration:
```json
{
  "permissions": ["ReadEntities", "ControlEntities"]
  // NO developer_mode
  // NO Developer Mode permissions
}
```

### For App Store Submissions

Checklist before submitting to App Store:

- [ ] Removed all Developer Mode permissions from manifest
- [ ] Removed `developer_mode` configuration section
- [ ] NOT using `installation_source` field (set by system)
- [ ] Tested app works without Developer Mode
- [ ] No dependencies on Developer Mode features
- [ ] Documentation doesn't mention Developer Mode features

## Troubleshooting

### Error: "App Store apps cannot access Developer Mode features"

**Cause**: Your app's installation source is set to `app_store`

**Solutions**:
1. If developing: Reinstall app as manual upload (ZIP)
2. If using App Store version: Cannot use Developer Mode (by design)
3. Create a separate development version with manual upload

### Error: "Developer Mode disabled in production"

**Cause**: Running in production environment without explicit override

**Solutions**:
1. Set `developer_mode.allow_in_production: true` in manifest (NOT recommended)
2. Change ENV to "development" (recommended for dev systems)
3. Disable Developer Mode features in production build

### Error: "This API is exclusive to the Developer App"

**Cause**: Attempting to access HotReload APIs from non-Developer App

**Solution**: These APIs are intentionally restricted. Use standard DirectDeploy instead, or contribute to the open-source Developer App project.

## Best Practices

### For App Developers

1. **Separate Builds**: Create different builds for development and App Store
2. **Feature Flags**: Use feature flags to disable dev features in production
3. **Documentation**: Clearly document which features require Developer Mode
4. **Testing**: Test your app with Developer Mode both ON and OFF
5. **Store Submission**: Use CI/CD to ensure dev features are stripped before submission

### For rumahl Administrators

1. **Production Safety**: Never enable Developer Mode in production rumahl instances
2. **Audit Manual Uploads**: Review manually uploaded apps before enabling Developer Mode
3. **Monitor Access**: Log all Developer Mode API access for security audits
4. **Update Developer App**: Keep the rumahl Developer App updated
5. **Restrict Access**: Only give Developer Mode toggle access to trusted administrators

### For Power Users

1. **Trust But Verify**: Only enable Developer Mode for apps you trust
2. **Isolation**: Use a separate rumahl instance for development
3. **Regular Audits**: Review which apps have Developer Mode permissions
4. **Environment Variables**: Use ENV=production for your main instance
5. **Backups**: Always backup before enabling Developer Mode on important apps

## See Also

- [DEVELOPER_MODE.md](./DEVELOPER_MODE.md) - Developer Mode features and APIs
- [SDK_SECURITY_MODEL.md](./SDK_SECURITY_MODEL.md) - Overall security architecture
- [permissions.rs](../backend/rumahl-shared/src/permissions.rs) - Permission definitions
- [app_manifest.rs](../backend/rumahl-shared/src/app_manifest.rs) - Manifest schema
