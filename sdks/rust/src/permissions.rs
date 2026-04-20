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
            | Permission::CameraAccess | Permission::FileSystemRead => RiskLevel::High,

            Permission::SystemControl | Permission::SystemRestart | Permission::PluginManager
            | Permission::InstallPlugins | Permission::FileSystemWrite | Permission::FileSystemExecute
            | Permission::NetworkScan | Permission::NetworkLocalAccess => RiskLevel::Critical,

            _ => RiskLevel::Medium,
        }
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
