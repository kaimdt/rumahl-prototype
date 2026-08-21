<?php

namespace rumahl;

/**
 * rumahl Permission types
 */
enum Permission: string
{
    // Entity permissions
    case READ_ENTITIES = 'ReadEntities';
    case CONTROL_ENTITIES = 'ControlEntities';
    case CREATE_ENTITIES = 'CreateEntities';
    case DELETE_ENTITIES = 'DeleteEntities';

    // Storage permissions
    case STORAGE_READ = 'StorageRead';
    case STORAGE_WRITE = 'StorageWrite';
    case STORAGE_DELETE = 'StorageDelete';

    // Network permissions
    case NETWORK_ACCESS = 'NetworkAccess';
    case NETWORK_OUTBOUND = 'NetworkOutbound';
    case NETWORK_INBOUND = 'NetworkInbound';
    case NETWORK_SCAN = 'NetworkScan';
    case NETWORK_LOCAL_ACCESS = 'NetworkLocalAccess';

    // System permissions
    case SYSTEM_INFO = 'SystemInfo';
    case SYSTEM_CONTROL = 'SystemControl';
    case SYSTEM_RESTART = 'SystemRestart';

    // Database permissions
    case DATABASE_READ = 'DatabaseRead';
    case DATABASE_WRITE = 'DatabaseWrite';
    case DATABASE_CREATE = 'DatabaseCreate';
    case DATABASE_DELETE = 'DatabaseDelete';

    // API and Widget permissions
    case REGISTER_API = 'RegisterApi';
    case CALL_API = 'CallApi';
    case REGISTER_WIDGET = 'RegisterWidget';
    case CONTROL_WIDGET = 'ControlWidget';

    // Notification permissions
    case SEND_NOTIFICATIONS = 'SendNotifications';
    case READ_NOTIFICATIONS = 'ReadNotifications';

    // Media permissions
    case CAMERA_ACCESS = 'CameraAccess';
    case MICROPHONE_ACCESS = 'MicrophoneAccess';
    case MEDIA_ACCESS = 'MediaAccess';

    // Plugin and filesystem permissions
    case PLUGIN_MANAGER = 'PluginManager';
    case INSTALL_PLUGINS = 'InstallPlugins';
    case FILE_SYSTEM_READ = 'FileSystemRead';
    case FILE_SYSTEM_WRITE = 'FileSystemWrite';
    case FILE_SYSTEM_EXECUTE = 'FileSystemExecute';

    // Other permissions
    case LOCATION_ACCESS = 'LocationAccess';
    case AUTOMATIONS = 'Automations';
}

/**
 * Risk level for permissions
 */
enum RiskLevel: string
{
    case LOW = 'Low';
    case MEDIUM = 'Medium';
    case HIGH = 'High';
    case CRITICAL = 'Critical';
}

/**
 * Get risk level for a permission
 */
function getPermissionRiskLevel(Permission $permission): RiskLevel
{
    $lowRisk = [
        Permission::READ_ENTITIES,
        Permission::STORAGE_READ,
        Permission::DATABASE_READ,
        Permission::SYSTEM_INFO,
        Permission::READ_NOTIFICATIONS,
    ];

    $criticalRisk = [
        Permission::SYSTEM_CONTROL,
        Permission::SYSTEM_RESTART,
        Permission::PLUGIN_MANAGER,
        Permission::INSTALL_PLUGINS,
        Permission::FILE_SYSTEM_WRITE,
        Permission::FILE_SYSTEM_EXECUTE,
        Permission::NETWORK_SCAN,
        Permission::NETWORK_LOCAL_ACCESS,
    ];

    $highRisk = [
        Permission::CREATE_ENTITIES,
        Permission::DELETE_ENTITIES,
        Permission::NETWORK_ACCESS,
        Permission::NETWORK_OUTBOUND,
        Permission::REGISTER_API,
        Permission::REGISTER_WIDGET,
        Permission::CAMERA_ACCESS,
        Permission::FILE_SYSTEM_READ,
    ];

    if (in_array($permission, $lowRisk, true)) {
        return RiskLevel::LOW;
    }
    if (in_array($permission, $criticalRisk, true)) {
        return RiskLevel::CRITICAL;
    }
    if (in_array($permission, $highRisk, true)) {
        return RiskLevel::HIGH;
    }

    return RiskLevel::MEDIUM;
}

/**
 * Get description for a permission
 */
function getPermissionDescription(Permission $permission): string
{
    return match ($permission) {
        Permission::READ_ENTITIES => 'Read entity states and attributes',
        Permission::CONTROL_ENTITIES => 'Control smart home devices',
        Permission::CREATE_ENTITIES => 'Create new entities',
        Permission::DELETE_ENTITIES => 'Delete entities',
        Permission::STORAGE_READ => 'Read from storage',
        Permission::STORAGE_WRITE => 'Write to storage',
        Permission::STORAGE_DELETE => 'Delete from storage',
        Permission::NETWORK_ACCESS => 'Access external networks',
        Permission::NETWORK_OUTBOUND => 'Make outbound network requests',
        Permission::NETWORK_INBOUND => 'Accept inbound network connections',
        Permission::NETWORK_SCAN => 'Scan local network',
        Permission::NETWORK_LOCAL_ACCESS => 'Access local network devices',
        Permission::SYSTEM_INFO => 'Read system information',
        Permission::SYSTEM_CONTROL => 'Control system settings',
        Permission::SYSTEM_RESTART => 'Restart rumahl system',
        Permission::DATABASE_READ => 'Read from database',
        Permission::DATABASE_WRITE => 'Write to database',
        Permission::DATABASE_CREATE => 'Create database tables',
        Permission::DATABASE_DELETE => 'Delete from database',
        Permission::REGISTER_API => 'Register API endpoints',
        Permission::CALL_API => 'Call API endpoints',
        Permission::REGISTER_WIDGET => 'Register dashboard widgets',
        Permission::CONTROL_WIDGET => 'Control widgets',
        Permission::SEND_NOTIFICATIONS => 'Send notifications',
        Permission::READ_NOTIFICATIONS => 'Read notifications',
        Permission::CAMERA_ACCESS => 'Access camera',
        Permission::MICROPHONE_ACCESS => 'Access microphone',
        Permission::MEDIA_ACCESS => 'Access media files',
        Permission::PLUGIN_MANAGER => 'Manage plugins',
        Permission::INSTALL_PLUGINS => 'Install/uninstall plugins',
        Permission::FILE_SYSTEM_READ => 'Read files',
        Permission::FILE_SYSTEM_WRITE => 'Write files',
        Permission::FILE_SYSTEM_EXECUTE => 'Execute files',
        Permission::LOCATION_ACCESS => 'Access location data',
        Permission::AUTOMATIONS => 'Create and manage automations',
        default => 'Unknown permission',
    };
}
