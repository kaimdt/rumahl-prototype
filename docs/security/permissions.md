# Permission System

rumahl uses a granular permission system that controls what apps, plugins, and API keys can access. Every permission must be explicitly declared in the app/plugin manifest and approved by the user during installation.

## Permission Model

### Declaration

Permissions are declared in `manifest.json`:

```json
{
  "id": "my-app",
  "permissions": [
    "AppStorageRead",
    "AppStorageWrite",
    "NetworkAccess"
  ]
}
```

### Approval

When installing an app, users see each requested permission with:
- **Name** – Human-readable name
- **Description** – What this permission allows
- **Risk Level** – Low, Medium, High, Critical
- **Recommendation** – Whether the permission is typical for this app type

### Enforcement

Permissions are enforced at multiple levels:
1. **Manifest validation** – Permissions not in manifest are rejected
2. **API middleware** – Every API call checks the caller's permissions
3. **Network layer** – Domain/IP access controlled per app
4. **Sandbox** – Plugin execution restricted by permissions

## Permission Reference

### App Storage Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `AppStorageRead` | Low | Read files and KV entries from app storage |
| `AppStorageWrite` | Low | Upload files and write KV entries |
| `AppStorageDelete` | Medium | Delete files and KV entries |
| `AppStorageManage` | Medium | Manage storage quotas and public file settings |

### Database Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `AppDatabaseSqlite` | Medium | Provision and use per-app SQLite database |
| `AppDatabaseManage` | Medium | Manage database settings and backups |

### Scheduling Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `AppScheduleCreate` | Low | Create scheduled tasks |
| `AppScheduleRead` | Low | Read scheduled tasks |
| `AppScheduleUpdate` | Low | Update scheduled tasks |
| `AppScheduleDelete` | Medium | Delete scheduled tasks |

### Messaging Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `MessagingPublish` | Low | Publish messages to channels |
| `MessagingSubscribe` | Low | Subscribe to channels |
| `MessagingWildcard` | High | Subscribe to ANY channel (use with caution!) |
| `MessagingDirect` | Low | Send direct messages to other apps |

### Webhook Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `WebhookCreate` | Medium | Create webhook endpoints |
| `WebhookRead` | Low | Read webhook configuration |
| `WebhookUpdate` | Medium | Update webhook configuration |
| `WebhookDelete` | Medium | Delete webhooks |
| `WebhookManage` | High | Full webhook management (signing keys) |

### Network Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `NetworkAccess` | Medium | Access external networks (internet) |
| `NetworkScan` | High | Scan local network for devices |
| `NetworkLocalAccess` | Medium | Access local network IPs |

### Home Assistant Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `ReadEntities` | Medium | Read Home Assistant entity states |
| `ControlEntities` | High | Control Home Assistant entities (turn on/off, adjust) |

### System Permissions

| Permission | Risk | Description |
|-----------|------|-------------|
| `SendNotifications` | Low | Send notifications to users |
| `SystemInfo` | Low | Read system information (CPU, RAM) |
| `PluginManager` | Critical | Install, remove, and manage plugins |

## Plugin Permissions

Plugins have a subset of available permissions:

| Permission | Plugin | Notes |
|-----------|:------:|-------|
| `ReadEntities` | ✅ | Read-only entity access |
| `ControlEntities` | ❌ | Not available for plugins |
| `SendNotifications` | ✅ | Send user notifications |
| `MessagingPublish` | ✅ | Publish to messaging channels |
| `MessagingSubscribe` | ✅ | Subscribe to channels |
| `MessagingDirect` | ✅ | Direct messages |
| `NetworkAccess` | ❌ | Not available by default |
| `Storage` | ❌ | Not available |

## Risk Levels

| Level | Icon | Description | Examples |
|-------|------|-------------|----------|
| **Low** | 🟢 | Read-only access, no data modification | `AppStorageRead`, `MessagingSubscribe` |
| **Medium** | 🟡 | Data modification, limited scope | `AppStorageWrite`, `NetworkAccess` |
| **High** | 🟠 | Broad access, device control | `ControlEntities`, `NetworkScan` |
| **Critical** | 🔴 | System-level access, can affect other apps | `PluginManager` |

## Best Practices for App Developers

1. **Request minimal permissions** – Only declare what your app truly needs
2. **Explain why** – Use the manifest description to justify each permission
3. **Handle permission denial** – Your app should work with reduced functionality if permissions are rejected
4. **Never request `PluginManager`** – This is reserved for system apps
5. **Use `MessagingWildcard` sparingly** – Prefer specific channel subscriptions

## Permission Changes

When an app update requests new permissions, users must re-approve them. Existing approved permissions persist across updates.

## Revoking Permissions

Users can revoke individual permissions at any time:
1. Control Center → Apps → Select App → Permissions
2. Toggle permissions on/off
3. App receives a configuration change event

## SDK Permission Checks

The JavaScript SDK provides permission checking:

```javascript
const client = new rumahlClient('http://localhost:8126', 'api-key');

// Check if a specific permission is granted
const canWrite = await client.permissions.check('AppStorageWrite');
if (canWrite) {
  await client.appStorage.setKv('key', { value: 42 });
}
```
