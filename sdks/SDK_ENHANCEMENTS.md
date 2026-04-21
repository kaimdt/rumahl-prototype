# IORA SDK Enhancements

## Overview

The IORA SDK has been significantly enhanced to provide Apps and Plugins with comprehensive access to the IORA ecosystem while maintaining strict security controls. This document describes the new features, permission system, and API expansions.

## Key Changes

### 1. App vs Plugin Permission Model

IORA now distinguishes between **Apps** and **Plugins** with different permission levels:

#### Apps (Full Functionality)
- Run in Docker containers with full isolation
- No limits on functionality and integration
- Access to all IORA services and APIs
- Can request sensitive permissions that require user consent

#### Plugins (Limited Functionality)
- Run in sandboxed environment for quick, on-demand tasks
- Limited to basic IORA operations
- Cannot access sensitive system operations
- Automatically approved permissions from manifest (no user consent required)

### 2. Three-Tier Permission System

Permissions are now categorized into three distinct tiers:

#### Tier 1: Plugin-Allowed (Automatic Approval)
Permissions available to both Apps and Plugins. Auto-approved based on manifest declaration.

**Examples:**
- `ReadEntities` - Read smart home device states
- `ControlEntities` - Control devices (turn on/off, adjust)
- `StorageRead/Write` - Read/write to app storage
- `NetworkOutbound` - Make HTTP requests to external APIs
- `SendNotifications` - Send notifications to users
- `CallApi` - Call registered IORA APIs

**Use Cases:** Basic smart home control, data visualization, simple integrations

#### Tier 2: App-Only (Automatic Approval)
Permissions only available to Apps. Auto-approved based on manifest declaration.

**Examples:**
- `CreateEntities` / `DeleteEntities` - Manage entity lifecycle
- `DatabaseRead/Write` - Access IORA database
- `RegisterApi` / `RegisterWidget` - Register custom APIs/widgets
- `Automations` - Create and manage automations
- `FileShareRead` - Read files from iora-share

**Use Cases:** Complex integrations, dashboard widgets, automation builders

#### Tier 3: App-Only with User Consent (Explicit Approval Required)
Permissions only available to Apps that require explicit user approval per installation.

**Examples:**
- `FileShareWrite/Delete/Manage` - Modify files in iora-share
- `FileSystemRead/Write/Execute` - Access host filesystem
- `SystemControl` / `SystemRestart` - Modify system settings
- `CameraAccess` / `MicrophoneAccess` - Access hardware
- `UserManagement` - Manage IORA users
- `SecuritySettings` - Modify security configuration
- `ProcessControl` - Control system processes
- `NetworkScan` / `NetworkInbound` - Advanced networking
- `LogAccess` / `BackupAccess` - Access system data

**Use Cases:** System administration, security tools, advanced integrations, file management

### 3. New APIs Added

#### iora-share / Files API

Complete file sharing integration with security controls:

```rust
// Rust example
let client = IoraClient::new("http://localhost:8080")
    .with_api_key("your-api-key");

// List files
let files = client.files().list(Some("/documents")).await?;

// Upload file
let upload = FileUpload {
    name: "config.json".to_string(),
    path: "/app-data".to_string(),
    content: file_bytes,
    mime_type: Some("application/json".to_string()),
};
let metadata = client.files().upload(upload).await?;

// Download file
let content = client.files().download(&file_id).await?;

// Share with permissions
let permissions = FilePermissions {
    read: true,
    write: false,
    delete: false,
    share: false,
};
client.files().share(&file_id, vec!["app-id".to_string()], permissions).await?;
```

```python
# Python example
async with IoraClient("http://localhost:8080", api_key="your-api-key") as client:
    # List files
    files = await client.list_files(path="/documents")

    # Upload file
    upload = FileUpload(
        name="config.json",
        path="/app-data",
        content=file_bytes,
        mime_type="application/json"
    )
    metadata = await client.upload_file(upload)

    # Download file
    content = await client.download_file(file_id)

    # Share with permissions
    permissions = FilePermissions(read=True, write=False, delete=False, share=False)
    await client.share_file(file_id, ["app-id"], permissions)
```

**Required Permissions:**
- `FileShareRead` - Read/download files
- `FileShareWrite` - Upload files (requires user consent)
- `FileShareDelete` - Delete files (requires user consent)
- `FileShareManage` - Share files and manage permissions (requires user consent)

#### Automations API

Full automation management (App-only):

```rust
// Rust example
let automation = Automation {
    id: "auto_123".to_string(),
    name: "Evening lights".to_string(),
    description: Some("Turn on lights at sunset".to_string()),
    enabled: true,
    trigger: AutomationTrigger::Time { at: "sunset".to_string() },
    conditions: vec![],
    actions: vec![
        AutomationAction::Service {
            domain: "light".to_string(),
            service: "turn_on".to_string(),
            entity_id: "light.living_room".to_string(),
            data: serde_json::json!({ "brightness": 200 }),
        }
    ],
};

let created = client.automations().create(automation).await?;
```

```python
# Python example
automation = Automation(
    id="auto_123",
    name="Evening lights",
    description="Turn on lights at sunset",
    enabled=True,
    trigger=AutomationTriggerTime(at="sunset"),
    conditions=[],
    actions=[
        AutomationActionService(
            domain="light",
            service="turn_on",
            entity_id="light.living_room",
            data={"brightness": 200}
        )
    ]
)

created = await client.create_automation(automation)
```

**Required Permission:** `Automations` (App-only, auto-approved)

#### Advanced System Access

New permissions for system administration apps:

- `BackupAccess` - Read system backups
- `LogAccess` - Read system and app logs
- `UserManagement` - Manage users and accounts
- `SecuritySettings` - Configure security policies
- `NetworkMonitoring` - Monitor network traffic
- `ProcessControl` - Manage system processes

All require user consent per installation.

## Permission Checking

SDKs provide helper functions to check permissions:

```rust
// Rust
use iora_sdk::permissions::Permission;

let perm = Permission::FileShareWrite;
let risk_level = perm.risk_level(); // RiskLevel::Critical
let category = perm.category(); // PermissionCategory::AppOnlyWithConsent
let requires_consent = perm.requires_user_consent(); // true
let plugin_ok = perm.is_plugin_allowed(); // false
```

```python
# Python
from iora_sdk.permissions import (
    Permission,
    get_permission_metadata,
    requires_user_consent,
    is_plugin_allowed
)

perm = Permission.FILE_SHARE_WRITE
metadata = get_permission_metadata(perm)
print(f"Risk: {metadata.risk_level}")  # RiskLevel.CRITICAL
print(f"Category: {metadata.category}")  # PermissionCategory.APP_ONLY_WITH_CONSENT
print(f"Needs consent: {requires_user_consent(perm)}")  # True
print(f"Plugin allowed: {is_plugin_allowed(perm)}")  # False
```

## Manifest Declaration

Apps and Plugins must declare all required permissions in their manifest:

```json
{
  "id": "com.example.file-manager",
  "name": "File Manager",
  "type": "app",
  "permissions": [
    "ReadEntities",
    "SendNotifications",
    "FileShareRead",
    "FileShareWrite",
    "FileShareDelete",
    "FileShareManage"
  ]
}
```

**Important:**
- IORA will prompt users for consent before installing apps that require Tier 3 permissions
- Plugins requesting App-only permissions will be rejected at install time
- Permissions cannot be requested at runtime - all must be declared upfront

## Security Model

### Permission Enforcement

1. **Install Time:**
   - IORA validates manifest permissions
   - Rejects plugins requesting app-only permissions
   - Prompts user for consent on Tier 3 permissions

2. **Runtime:**
   - All API calls check permission tokens
   - Tokens are short-lived and automatically renewed
   - Unauthorized calls return 403 Forbidden

3. **Auditing:**
   - All permission grants logged
   - API calls with sensitive permissions logged
   - Users can review and revoke permissions

### Best Practices

1. **Principle of Least Privilege:**
   - Request only permissions actually needed
   - Use Plugin-allowed permissions when possible
   - Avoid Tier 3 permissions unless essential

2. **Clear Justification:**
   - Explain permission usage in manifest description
   - Provide user-facing documentation
   - Handle permission denials gracefully

3. **Secure File Handling:**
   - Validate all file inputs
   - Sanitize filenames and paths
   - Use appropriate MIME types
   - Limit file sizes

4. **API Rate Limiting:**
   - Implement exponential backoff
   - Cache responses when appropriate
   - Batch operations when possible

## Migration Guide

### Existing Apps

1. **Update Dependencies:**
   ```toml
   # Rust Cargo.toml
   [dependencies]
   iora-sdk = "0.2.0"  # Updated version
   ```

   ```
   # Python requirements.txt
   iora-sdk>=0.2.0
   ```

2. **Review Permissions:**
   - Check if current permissions are still sufficient
   - Add new permissions if using new APIs
   - Update manifest.json

3. **Update Code:**
   - Replace deprecated API calls
   - Use new Files/Automations APIs if needed
   - Test with new permission model

### Existing Plugins

1. **Check Compatibility:**
   - Verify all requested permissions are Plugin-allowed
   - Remove or request upgrade to App if using App-only permissions

2. **Test Thoroughly:**
   - Plugins have stricter sandbox now
   - Verify all functionality works
   - Handle permission errors gracefully

## SDK Language Support

The enhanced permission system and new APIs are available in:

- ✅ **Rust SDK** - Full support (v0.2.0+)
- ✅ **Python SDK** - Full support (v0.2.0+)
- 🔄 **TypeScript SDK** - In progress
- 🔄 **Go SDK** - In progress
- ⏱️ **PHP SDK** - Planned
- ⏱️ **C++ SDK** - Planned

## Examples

Complete example applications demonstrating new features:

1. **File Manager App** (`examples/file_manager/`)
   - Browse iora-share files
   - Upload/download files
   - Share files with other apps
   - Demonstrates Tier 3 permissions

2. **Automation Builder App** (`examples/automation_builder/`)
   - Create/edit automations
   - Visual automation editor
   - Test and debug automations
   - Demonstrates Automations API

3. **Weather Plugin** (`examples/weather_plugin/`)
   - Fetch weather data
   - Display on dashboard
   - Send weather alerts
   - Demonstrates Plugin-allowed permissions

4. **System Monitor App** (`examples/system_monitor/`)
   - View system logs
   - Monitor resources
   - Access backup status
   - Demonstrates advanced system permissions

## API Reference

Full API documentation available at:
- Rust: `cargo doc --open`
- Python: https://iora-sdk-python.readthedocs.io/
- TypeScript: https://iora-sdk-ts.readthedocs.io/
- Go: https://pkg.go.dev/github.com/iora/iora-sdk-go

## Support

For questions or issues:
- GitHub Issues: https://github.com/kaimdt/home-assistant-dashb/issues
- Documentation: https://iora-docs.example.com/sdk
- Community Forum: https://forum.iora.example.com/

## Changelog

### v0.2.0 (2024-01-XX)

**New Features:**
- Three-tier permission system (Plugin-allowed, App-only, App-only with consent)
- Files API for iora-share integration
- Automations API for automation management
- 12 new permissions for advanced system access
- Permission metadata and helper functions

**Breaking Changes:**
- Permission model changed - apps must update manifests
- Some permissions now require user consent
- Plugins cannot request app-only permissions

**Security:**
- Enhanced permission enforcement
- Audit logging for sensitive operations
- Short-lived permission tokens with auto-renewal

**Documentation:**
- Complete API reference
- Security best practices guide
- Migration guide for existing apps/plugins
- Example applications
