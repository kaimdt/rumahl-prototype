# Permissions Reference

A concise reference of all available permissions for apps and plugins in rumahl.

> For a comprehensive guide including risk levels, approval flow, and security model, see [Security: Permission System](../security/permissions.md).

## Permission Types

### Storage Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `AppStorageRead` | ✅ | ❌ | Read files and KV entries from app storage |
| `AppStorageWrite` | ✅ | ❌ | Upload files and write KV entries |
| `AppStorageDelete` | ✅ | ❌ | Delete files and KV entries |
| `AppStorageManage` | ✅ | ❌ | Manage storage quotas and settings |

### Database Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `AppDatabaseSqlite` | ✅ | ❌ | Provision and use per-app SQLite database |
| `AppDatabaseManage` | ✅ | ❌ | Manage database settings and backups |

### Scheduling Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `AppScheduleCreate` | ✅ | ❌ | Create scheduled tasks (cron/intervals) |
| `AppScheduleRead` | ✅ | ❌ | List and view scheduled tasks |
| `AppScheduleUpdate` | ✅ | ❌ | Modify scheduled tasks |
| `AppScheduleDelete` | ✅ | ❌ | Delete scheduled tasks |

### Messaging Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `MessagingPublish` | ✅ | ✅ | Publish messages to channels |
| `MessagingSubscribe` | ✅ | ✅ | Subscribe to specific channels |
| `MessagingWildcard` | ✅ | ❌ | Subscribe to ANY channel (high risk) |
| `MessagingDirect` | ✅ | ✅ | Send direct messages to other apps |

### Webhook Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `WebhookCreate` | ✅ | ❌ | Create webhook endpoints |
| `WebhookRead` | ✅ | ❌ | View webhook configurations |
| `WebhookUpdate` | ✅ | ❌ | Modify webhook configurations |
| `WebhookDelete` | ✅ | ❌ | Delete webhooks |
| `WebhookManage` | ✅ | ❌ | Full webhook management (signing keys) |

### Network Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `NetworkAccess` | ✅ | ❌ | Access external networks (internet) |
| `NetworkScan` | ✅ | ❌ | Scan local network for devices |
| `NetworkLocalAccess` | ✅ | ❌ | Access local network IP addresses |

### Entity Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `ReadEntities` | ✅ | ✅ | Read Home Assistant entity states |
| `ControlEntities` | ✅ | ❌ | Control Home Assistant entities |

### Notification Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `SendNotifications` | ✅ | ✅ | Send notifications to rumahl users |

### System Permissions

| Permission | App | Plugin | Description |
|-----------|:---:|:------:|-------------|
| `SystemInfo` | ✅ | ❌ | Read system information (CPU, RAM, disk) |
| `PluginManager` | ✅ | ❌ | Install/remove/manage plugins (critical) |

## Usage

### Declaring in Manifest

```json
{
  "permissions": [
    "AppStorageRead",
    "AppStorageWrite",
    "NetworkAccess",
    "ReadEntities"
  ]
}
```

### Checking at Runtime

```javascript
// SDK permission check
const canControl = await client.permissions.check('ControlEntities');
if (!canControl) {
  console.warn('Entity control not available - permission denied');
  return;
}
```

### Plugin Permission Restrictions

Plugins have a limited permission set:
- ✅ `ReadEntities` (read-only)
- ✅ `SendNotifications`
- ✅ `MessagingPublish` / `MessagingSubscribe` / `MessagingDirect`
- ❌ All other permissions

### Risk Levels

| Level | Permissions |
|-------|-------------|
| **Low** | `ReadEntities`, `AppStorageRead`, `MessagingSubscribe`, `AppScheduleRead`, `WebhookRead`, `SystemInfo` |
| **Medium** | `AppStorageWrite`, `AppDatabaseSqlite`, `NetworkAccess`, `NetworkLocalAccess`, `AppScheduleCreate`, `MessagingPublish` |
| **High** | `ControlEntities`, `NetworkScan`, `AppStorageDelete`, `AppDatabaseManage`, `WebhookManage`, `MessagingWildcard` |
| **Critical** | `PluginManager` |

## Best Practices

1. **Request only what you need** – Each permission should have a clear purpose
2. **Handle denial gracefully** – Your app should work with reduced permissions
3. **Explain permissions** – Use the manifest description to justify requests
4. **Never request `PluginManager`** – Reserved for system apps

## Related Documentation

- [Security: Permission System](../security/permissions.md) – Full security model
- [App Development Guide](app-development.md) – Manifest configuration
- [Plugin Development Guide](plugin-development.md) – Plugin restrictions
- [Security Best Practices](../security/best-practices.md)
