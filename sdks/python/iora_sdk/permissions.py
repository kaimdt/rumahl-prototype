"""
Permission types and utilities
"""

from enum import Enum
from typing import Dict


class Permission(str, Enum):
    """IORA permission types"""

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


class RiskLevel(str, Enum):
    """Risk level for permissions"""

    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"


_PERMISSION_RISK_LEVELS: Dict[Permission, RiskLevel] = {
    # Low risk
    Permission.READ_ENTITIES: RiskLevel.LOW,
    Permission.STORAGE_READ: RiskLevel.LOW,
    Permission.DATABASE_READ: RiskLevel.LOW,
    Permission.SYSTEM_INFO: RiskLevel.LOW,
    Permission.READ_NOTIFICATIONS: RiskLevel.LOW,
    # Critical risk
    Permission.SYSTEM_CONTROL: RiskLevel.CRITICAL,
    Permission.SYSTEM_RESTART: RiskLevel.CRITICAL,
    Permission.PLUGIN_MANAGER: RiskLevel.CRITICAL,
    Permission.INSTALL_PLUGINS: RiskLevel.CRITICAL,
    Permission.FILE_SYSTEM_WRITE: RiskLevel.CRITICAL,
    Permission.FILE_SYSTEM_EXECUTE: RiskLevel.CRITICAL,
    Permission.NETWORK_SCAN: RiskLevel.CRITICAL,
    Permission.NETWORK_LOCAL_ACCESS: RiskLevel.CRITICAL,
    # High risk
    Permission.CREATE_ENTITIES: RiskLevel.HIGH,
    Permission.DELETE_ENTITIES: RiskLevel.HIGH,
    Permission.NETWORK_ACCESS: RiskLevel.HIGH,
    Permission.NETWORK_OUTBOUND: RiskLevel.HIGH,
    Permission.REGISTER_API: RiskLevel.HIGH,
    Permission.REGISTER_WIDGET: RiskLevel.HIGH,
    Permission.CAMERA_ACCESS: RiskLevel.HIGH,
    Permission.FILE_SYSTEM_READ: RiskLevel.HIGH,
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
    Permission.SYSTEM_RESTART: "Restart IORA system",
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
}


def get_permission_risk_level(permission: Permission) -> RiskLevel:
    """Get the risk level for a permission"""
    return _PERMISSION_RISK_LEVELS.get(permission, RiskLevel.MEDIUM)


def get_permission_description(permission: Permission) -> str:
    """Get the description for a permission"""
    return _PERMISSION_DESCRIPTIONS.get(permission, "Unknown permission")
