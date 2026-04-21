use serde::{Deserialize, Serialize};

/// Permission types in IORA
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Permission {
    // Entity permissions
    ReadEntities,
    ControlEntities,
    CreateEntities,
    DeleteEntities,

    // Storage permissions
    StorageRead,
    StorageWrite,
    StorageDelete,

    // Network permissions
    NetworkAccess,
    NetworkOutbound,
    NetworkInbound,
    NetworkScan,
    NetworkLocalAccess,

    // System permissions
    SystemInfo,
    SystemControl,
    SystemRestart,

    // Database permissions
    DatabaseRead,
    DatabaseWrite,
    DatabaseCreate,
    DatabaseDelete,

    // API and Widget permissions
    RegisterApi,
    CallApi,
    RegisterWidget,
    ControlWidget,

    // Notification permissions
    SendNotifications,
    ReadNotifications,

    // Media permissions
    CameraAccess,
    MicrophoneAccess,
    MediaAccess,

    // Advanced permissions
    PluginManager,
    InstallPlugins,
    FileSystemRead,
    FileSystemWrite,
    FileSystemExecute,
    LocationAccess,
    Automations,

    // File sharing permissions (iora-share)
    FileShareRead,
    FileShareWrite,
    FileShareDelete,
    FileShareManage,

    // Advanced app-only permissions
    BackupAccess,
    LogAccess,
    UserManagement,
    SecuritySettings,
    NetworkMonitoring,
    ProcessControl,
}

impl Permission {
    /// Get the risk level of this permission
    pub fn risk_level(&self) -> RiskLevel {
        match self {
            Permission::ReadEntities | Permission::StorageRead | Permission::DatabaseRead
            | Permission::SystemInfo | Permission::ReadNotifications => RiskLevel::Low,

            Permission::ControlEntities | Permission::StorageWrite | Permission::DatabaseWrite
            | Permission::CallApi | Permission::SendNotifications | Permission::MediaAccess => RiskLevel::Medium,

            Permission::CreateEntities | Permission::DeleteEntities | Permission::NetworkAccess
            | Permission::NetworkOutbound | Permission::RegisterApi | Permission::RegisterWidget
            | Permission::CameraAccess | Permission::FileSystemRead | Permission::FileShareRead
            | Permission::LogAccess | Permission::BackupAccess => RiskLevel::High,

            Permission::SystemControl | Permission::SystemRestart | Permission::PluginManager
            | Permission::InstallPlugins | Permission::FileSystemWrite | Permission::FileSystemExecute
            | Permission::NetworkScan | Permission::NetworkLocalAccess | Permission::FileShareWrite
            | Permission::FileShareDelete | Permission::FileShareManage | Permission::UserManagement
            | Permission::SecuritySettings | Permission::NetworkMonitoring | Permission::ProcessControl => RiskLevel::Critical,

            _ => RiskLevel::Medium,
        }
    }

    /// Get the permission category (App-only, Plugin-allowed, requires consent)
    pub fn category(&self) -> PermissionCategory {
        match self {
            // Plugin-allowed permissions (basic functionality)
            Permission::ReadEntities | Permission::ControlEntities | Permission::StorageRead
            | Permission::StorageWrite | Permission::NetworkOutbound | Permission::SystemInfo
            | Permission::CallApi | Permission::SendNotifications | Permission::ReadNotifications
            | Permission::MediaAccess => PermissionCategory::PluginAllowed,

            // App-only permissions (advanced functionality, auto-approved)
            Permission::CreateEntities | Permission::DeleteEntities | Permission::StorageDelete
            | Permission::NetworkAccess | Permission::DatabaseRead | Permission::DatabaseWrite
            | Permission::RegisterApi | Permission::RegisterWidget | Permission::ControlWidget
            | Permission::Automations | Permission::FileShareRead => PermissionCategory::AppOnly,

            // App-only with user consent (sensitive operations)
            Permission::SystemControl | Permission::SystemRestart | Permission::PluginManager
            | Permission::InstallPlugins | Permission::FileSystemRead | Permission::FileSystemWrite
            | Permission::FileSystemExecute | Permission::NetworkScan | Permission::NetworkLocalAccess
            | Permission::CameraAccess | Permission::MicrophoneAccess | Permission::LocationAccess
            | Permission::DatabaseCreate | Permission::DatabaseDelete | Permission::FileShareWrite
            | Permission::FileShareDelete | Permission::FileShareManage | Permission::BackupAccess
            | Permission::LogAccess | Permission::UserManagement | Permission::SecuritySettings
            | Permission::NetworkMonitoring | Permission::ProcessControl | Permission::NetworkInbound => PermissionCategory::AppOnlyWithConsent,
        }
    }

    /// Check if this permission is available to plugins
    pub fn is_plugin_allowed(&self) -> bool {
        matches!(self.category(), PermissionCategory::PluginAllowed)
    }

    /// Check if this permission requires explicit user consent
    pub fn requires_user_consent(&self) -> bool {
        matches!(self.category(), PermissionCategory::AppOnlyWithConsent)
    }

    /// Get a human-readable description of this permission
    pub fn description(&self) -> &'static str {
        match self {
            Permission::ReadEntities => "Read entity states and attributes",
            Permission::ControlEntities => "Control smart home devices",
            Permission::CreateEntities => "Create new entities",
            Permission::DeleteEntities => "Delete entities",
            Permission::StorageRead => "Read from storage",
            Permission::StorageWrite => "Write to storage",
            Permission::StorageDelete => "Delete from storage",
            Permission::NetworkAccess => "Access external networks",
            Permission::NetworkOutbound => "Make outbound network requests",
            Permission::NetworkInbound => "Accept inbound network connections",
            Permission::NetworkScan => "Scan local network",
            Permission::NetworkLocalAccess => "Access local network devices",
            Permission::SystemInfo => "Read system information",
            Permission::SystemControl => "Control system settings",
            Permission::SystemRestart => "Restart IORA system",
            Permission::DatabaseRead => "Read from database",
            Permission::DatabaseWrite => "Write to database",
            Permission::DatabaseCreate => "Create database tables",
            Permission::DatabaseDelete => "Delete from database",
            Permission::RegisterApi => "Register API endpoints",
            Permission::CallApi => "Call API endpoints",
            Permission::RegisterWidget => "Register dashboard widgets",
            Permission::ControlWidget => "Control widgets",
            Permission::SendNotifications => "Send notifications",
            Permission::ReadNotifications => "Read notifications",
            Permission::CameraAccess => "Access camera",
            Permission::MicrophoneAccess => "Access microphone",
            Permission::MediaAccess => "Access media files",
            Permission::PluginManager => "Manage plugins",
            Permission::InstallPlugins => "Install/uninstall plugins",
            Permission::FileSystemRead => "Read files",
            Permission::FileSystemWrite => "Write files",
            Permission::FileSystemExecute => "Execute files",
            Permission::LocationAccess => "Access location data",
            Permission::Automations => "Create and manage automations",
            Permission::FileShareRead => "Read shared files via iora-share",
            Permission::FileShareWrite => "Upload files to iora-share",
            Permission::FileShareDelete => "Delete files from iora-share",
            Permission::FileShareManage => "Manage file sharing settings and permissions",
            Permission::BackupAccess => "Access system backups",
            Permission::LogAccess => "Access system and app logs",
            Permission::UserManagement => "Manage IORA users and accounts",
            Permission::SecuritySettings => "Modify security settings",
            Permission::NetworkMonitoring => "Monitor network traffic and connections",
            Permission::ProcessControl => "Control system processes and services",
        }
    }

    /// Get full metadata for this permission
    pub fn metadata(&self) -> PermissionMetadata {
        PermissionMetadata {
            permission: *self,
            category: self.category(),
            risk_level: self.risk_level(),
            description: self.description(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// Permission category defining access level and approval requirements
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionCategory {
    /// Available to both Apps and Plugins, auto-approved based on manifest
    PluginAllowed,
    /// Only available to Apps, auto-approved based on manifest
    AppOnly,
    /// Only available to Apps, requires explicit user consent per installation
    AppOnlyWithConsent,
}

/// Permission metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionMetadata {
    pub permission: Permission,
    pub category: PermissionCategory,
    pub risk_level: RiskLevel,
    pub description: &'static str,
}

