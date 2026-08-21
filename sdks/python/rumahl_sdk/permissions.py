"""
Permission types and utilities
"""

from enum import Enum
from typing import Dict
from dataclasses import dataclass


class Permission(str, Enum):
    """rumahl permission types"""

    # Entity permissions
    READ_ENTITIES = "ReadEntities"
    CONTROL_ENTITIES = "ControlEntities"
    CREATE_ENTITIES = "CreateEntities"
    DELETE_ENTITIES = "DeleteEntities"

    # Storage permissions
    STORAGE_READ = "StorageRead"
    STORAGE_WRITE = "StorageWrite"
    STORAGE_DELETE = "StorageDelete"

    # Network permissions
    NETWORK_ACCESS = "NetworkAccess"
    NETWORK_OUTBOUND = "NetworkOutbound"
    NETWORK_INBOUND = "NetworkInbound"
    NETWORK_SCAN = "NetworkScan"
    NETWORK_LOCAL_ACCESS = "NetworkLocalAccess"

    # System permissions
    SYSTEM_INFO = "SystemInfo"
    SYSTEM_CONTROL = "SystemControl"
    SYSTEM_RESTART = "SystemRestart"

    # Database permissions
    DATABASE_READ = "DatabaseRead"
    DATABASE_WRITE = "DatabaseWrite"
    DATABASE_CREATE = "DatabaseCreate"
    DATABASE_DELETE = "DatabaseDelete"

    # API and Widget permissions
    REGISTER_API = "RegisterApi"
    CALL_API = "CallApi"
    REGISTER_WIDGET = "RegisterWidget"
    CONTROL_WIDGET = "ControlWidget"

    # Notification permissions
    SEND_NOTIFICATIONS = "SendNotifications"
    READ_NOTIFICATIONS = "ReadNotifications"

    # Media permissions
    CAMERA_ACCESS = "CameraAccess"
    MICROPHONE_ACCESS = "MicrophoneAccess"
    MEDIA_ACCESS = "MediaAccess"

    # Plugin and filesystem permissions
    PLUGIN_MANAGER = "PluginManager"
    INSTALL_PLUGINS = "InstallPlugins"
    FILE_SYSTEM_READ = "FileSystemRead"
    FILE_SYSTEM_WRITE = "FileSystemWrite"
    FILE_SYSTEM_EXECUTE = "FileSystemExecute"

    # Other permissions
    LOCATION_ACCESS = "LocationAccess"
    AUTOMATIONS = "Automations"

    # File sharing permissions (rumahl-share)
    FILE_SHARE_READ = "FileShareRead"
    FILE_SHARE_WRITE = "FileShareWrite"
    FILE_SHARE_DELETE = "FileShareDelete"
    FILE_SHARE_MANAGE = "FileShareManage"

    # Advanced app-only permissions
    BACKUP_ACCESS = "BackupAccess"
    LOG_ACCESS = "LogAccess"
    USER_MANAGEMENT = "UserManagement"
    SECURITY_SETTINGS = "SecuritySettings"
    NETWORK_MONITORING = "NetworkMonitoring"
    PROCESS_CONTROL = "ProcessControl"


class RiskLevel(str, Enum):
    """Risk level for permissions"""

    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"


class PermissionCategory(str, Enum):
    """Permission category defining access level and approval requirements"""

    # Available to both Apps and Plugins, auto-approved based on manifest
    PLUGIN_ALLOWED = "PluginAllowed"
    # Only available to Apps, auto-approved based on manifest
    APP_ONLY = "AppOnly"
    # Only available to Apps, requires explicit user consent per installation
    APP_ONLY_WITH_CONSENT = "AppOnlyWithConsent"


@dataclass
class PermissionMetadata:
    """Metadata for a permission"""

    permission: Permission
    category: PermissionCategory
    risk_level: RiskLevel
    description: str



_PERMISSION_RISK_LEVELS: Dict[Permission, RiskLevel] = {
    # Low risk
    Permission.READ_ENTITIES: RiskLevel.LOW,
    Permission.STORAGE_READ: RiskLevel.LOW,
    Permission.DATABASE_READ: RiskLevel.LOW,
    Permission.SYSTEM_INFO: RiskLevel.LOW,
    Permission.READ_NOTIFICATIONS: RiskLevel.LOW,
    # Medium risk
    Permission.CONTROL_ENTITIES: RiskLevel.MEDIUM,
    Permission.STORAGE_WRITE: RiskLevel.MEDIUM,
    Permission.DATABASE_WRITE: RiskLevel.MEDIUM,
    Permission.CALL_API: RiskLevel.MEDIUM,
    Permission.SEND_NOTIFICATIONS: RiskLevel.MEDIUM,
    Permission.MEDIA_ACCESS: RiskLevel.MEDIUM,
    # High risk
    Permission.CREATE_ENTITIES: RiskLevel.HIGH,
    Permission.DELETE_ENTITIES: RiskLevel.HIGH,
    Permission.NETWORK_ACCESS: RiskLevel.HIGH,
    Permission.NETWORK_OUTBOUND: RiskLevel.HIGH,
    Permission.REGISTER_API: RiskLevel.HIGH,
    Permission.REGISTER_WIDGET: RiskLevel.HIGH,
    Permission.CAMERA_ACCESS: RiskLevel.HIGH,
    Permission.FILE_SYSTEM_READ: RiskLevel.HIGH,
    Permission.FILE_SHARE_READ: RiskLevel.HIGH,
    Permission.LOG_ACCESS: RiskLevel.HIGH,
    Permission.BACKUP_ACCESS: RiskLevel.HIGH,
    # Critical risk
    Permission.SYSTEM_CONTROL: RiskLevel.CRITICAL,
    Permission.SYSTEM_RESTART: RiskLevel.CRITICAL,
    Permission.PLUGIN_MANAGER: RiskLevel.CRITICAL,
    Permission.INSTALL_PLUGINS: RiskLevel.CRITICAL,
    Permission.FILE_SYSTEM_WRITE: RiskLevel.CRITICAL,
    Permission.FILE_SYSTEM_EXECUTE: RiskLevel.CRITICAL,
    Permission.NETWORK_SCAN: RiskLevel.CRITICAL,
    Permission.NETWORK_LOCAL_ACCESS: RiskLevel.CRITICAL,
    Permission.FILE_SHARE_WRITE: RiskLevel.CRITICAL,
    Permission.FILE_SHARE_DELETE: RiskLevel.CRITICAL,
    Permission.FILE_SHARE_MANAGE: RiskLevel.CRITICAL,
    Permission.USER_MANAGEMENT: RiskLevel.CRITICAL,
    Permission.SECURITY_SETTINGS: RiskLevel.CRITICAL,
    Permission.NETWORK_MONITORING: RiskLevel.CRITICAL,
    Permission.PROCESS_CONTROL: RiskLevel.CRITICAL,
}

_PERMISSION_CATEGORIES: Dict[Permission, PermissionCategory] = {
    # Plugin-allowed permissions (basic functionality)
    Permission.READ_ENTITIES: PermissionCategory.PLUGIN_ALLOWED,
    Permission.CONTROL_ENTITIES: PermissionCategory.PLUGIN_ALLOWED,
    Permission.STORAGE_READ: PermissionCategory.PLUGIN_ALLOWED,
    Permission.STORAGE_WRITE: PermissionCategory.PLUGIN_ALLOWED,
    Permission.NETWORK_OUTBOUND: PermissionCategory.PLUGIN_ALLOWED,
    Permission.SYSTEM_INFO: PermissionCategory.PLUGIN_ALLOWED,
    Permission.CALL_API: PermissionCategory.PLUGIN_ALLOWED,
    Permission.SEND_NOTIFICATIONS: PermissionCategory.PLUGIN_ALLOWED,
    Permission.READ_NOTIFICATIONS: PermissionCategory.PLUGIN_ALLOWED,
    Permission.MEDIA_ACCESS: PermissionCategory.PLUGIN_ALLOWED,
    # App-only permissions (advanced functionality, auto-approved)
    Permission.CREATE_ENTITIES: PermissionCategory.APP_ONLY,
    Permission.DELETE_ENTITIES: PermissionCategory.APP_ONLY,
    Permission.STORAGE_DELETE: PermissionCategory.APP_ONLY,
    Permission.NETWORK_ACCESS: PermissionCategory.APP_ONLY,
    Permission.DATABASE_READ: PermissionCategory.APP_ONLY,
    Permission.DATABASE_WRITE: PermissionCategory.APP_ONLY,
    Permission.REGISTER_API: PermissionCategory.APP_ONLY,
    Permission.REGISTER_WIDGET: PermissionCategory.APP_ONLY,
    Permission.CONTROL_WIDGET: PermissionCategory.APP_ONLY,
    Permission.AUTOMATIONS: PermissionCategory.APP_ONLY,
    Permission.FILE_SHARE_READ: PermissionCategory.APP_ONLY,
    # App-only with user consent (sensitive operations)
    Permission.SYSTEM_CONTROL: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.SYSTEM_RESTART: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.PLUGIN_MANAGER: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.INSTALL_PLUGINS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.FILE_SYSTEM_READ: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.FILE_SYSTEM_WRITE: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.FILE_SYSTEM_EXECUTE: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.NETWORK_SCAN: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.NETWORK_LOCAL_ACCESS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.NETWORK_INBOUND: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.CAMERA_ACCESS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.MICROPHONE_ACCESS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.LOCATION_ACCESS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.DATABASE_CREATE: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.DATABASE_DELETE: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.FILE_SHARE_WRITE: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.FILE_SHARE_DELETE: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.FILE_SHARE_MANAGE: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.BACKUP_ACCESS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.LOG_ACCESS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.USER_MANAGEMENT: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.SECURITY_SETTINGS: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.NETWORK_MONITORING: PermissionCategory.APP_ONLY_WITH_CONSENT,
    Permission.PROCESS_CONTROL: PermissionCategory.APP_ONLY_WITH_CONSENT,
}

_PERMISSION_DESCRIPTIONS: Dict[Permission, str] = {
    Permission.READ_ENTITIES: "Read entity states and attributes",
    Permission.CONTROL_ENTITIES: "Control smart home devices",
    Permission.CREATE_ENTITIES: "Create new entities",
    Permission.DELETE_ENTITIES: "Delete entities",
    Permission.STORAGE_READ: "Read from storage",
    Permission.STORAGE_WRITE: "Write to storage",
    Permission.STORAGE_DELETE: "Delete from storage",
    Permission.NETWORK_ACCESS: "Access external networks",
    Permission.NETWORK_OUTBOUND: "Make outbound network requests",
    Permission.NETWORK_INBOUND: "Accept inbound network connections",
    Permission.NETWORK_SCAN: "Scan local network",
    Permission.NETWORK_LOCAL_ACCESS: "Access local network devices",
    Permission.SYSTEM_INFO: "Read system information",
    Permission.SYSTEM_CONTROL: "Control system settings",
    Permission.SYSTEM_RESTART: "Restart rumahl system",
    Permission.DATABASE_READ: "Read from database",
    Permission.DATABASE_WRITE: "Write to database",
    Permission.DATABASE_CREATE: "Create database tables",
    Permission.DATABASE_DELETE: "Delete from database",
    Permission.REGISTER_API: "Register API endpoints",
    Permission.CALL_API: "Call API endpoints",
    Permission.REGISTER_WIDGET: "Register dashboard widgets",
    Permission.CONTROL_WIDGET: "Control widgets",
    Permission.SEND_NOTIFICATIONS: "Send notifications",
    Permission.READ_NOTIFICATIONS: "Read notifications",
    Permission.CAMERA_ACCESS: "Access camera",
    Permission.MICROPHONE_ACCESS: "Access microphone",
    Permission.MEDIA_ACCESS: "Access media files",
    Permission.PLUGIN_MANAGER: "Manage plugins",
    Permission.INSTALL_PLUGINS: "Install/uninstall plugins",
    Permission.FILE_SYSTEM_READ: "Read files",
    Permission.FILE_SYSTEM_WRITE: "Write files",
    Permission.FILE_SYSTEM_EXECUTE: "Execute files",
    Permission.LOCATION_ACCESS: "Access location data",
    Permission.AUTOMATIONS: "Create and manage automations",
    Permission.FILE_SHARE_READ: "Read shared files via rumahl-share",
    Permission.FILE_SHARE_WRITE: "Upload files to rumahl-share",
    Permission.FILE_SHARE_DELETE: "Delete files from rumahl-share",
    Permission.FILE_SHARE_MANAGE: "Manage file sharing settings and permissions",
    Permission.BACKUP_ACCESS: "Access system backups",
    Permission.LOG_ACCESS: "Access system and app logs",
    Permission.USER_MANAGEMENT: "Manage rumahl users and accounts",
    Permission.SECURITY_SETTINGS: "Modify security settings",
    Permission.NETWORK_MONITORING: "Monitor network traffic and connections",
    Permission.PROCESS_CONTROL: "Control system processes and services",
}


def get_permission_risk_level(permission: Permission) -> RiskLevel:
    """Get the risk level for a permission"""
    return _PERMISSION_RISK_LEVELS.get(permission, RiskLevel.MEDIUM)


def get_permission_category(permission: Permission) -> PermissionCategory:
    """Get the category for a permission"""
    return _PERMISSION_CATEGORIES.get(permission, PermissionCategory.APP_ONLY)


def get_permission_description(permission: Permission) -> str:
    """Get the description for a permission"""
    return _PERMISSION_DESCRIPTIONS.get(permission, "Unknown permission")


def is_plugin_allowed(permission: Permission) -> bool:
    """Check if a permission is available to plugins"""
    return get_permission_category(permission) == PermissionCategory.PLUGIN_ALLOWED


def requires_user_consent(permission: Permission) -> bool:
    """Check if a permission requires explicit user consent"""
    return get_permission_category(permission) == PermissionCategory.APP_ONLY_WITH_CONSENT


def get_permission_metadata(permission: Permission) -> PermissionMetadata:
    """Get full metadata for a permission"""
    return PermissionMetadata(
        permission=permission,
        category=get_permission_category(permission),
        risk_level=get_permission_risk_level(permission),
        description=get_permission_description(permission),
    )

