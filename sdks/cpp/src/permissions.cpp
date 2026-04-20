#include "iora/permissions.hpp"
#include <unordered_map>

namespace iora {

std::string permission_to_string(Permission permission) {
    static const std::unordered_map<Permission, std::string> permission_strings = {
        {Permission::READ_ENTITIES, "ReadEntities"},
        {Permission::CONTROL_ENTITIES, "ControlEntities"},
        {Permission::CREATE_ENTITIES, "CreateEntities"},
        {Permission::DELETE_ENTITIES, "DeleteEntities"},
        {Permission::STORAGE_READ, "StorageRead"},
        {Permission::STORAGE_WRITE, "StorageWrite"},
        {Permission::STORAGE_DELETE, "StorageDelete"},
        {Permission::NETWORK_ACCESS, "NetworkAccess"},
        {Permission::NETWORK_OUTBOUND, "NetworkOutbound"},
        {Permission::NETWORK_INBOUND, "NetworkInbound"},
        {Permission::NETWORK_SCAN, "NetworkScan"},
        {Permission::NETWORK_LOCAL_ACCESS, "NetworkLocalAccess"},
        {Permission::SYSTEM_INFO, "SystemInfo"},
        {Permission::SYSTEM_CONTROL, "SystemControl"},
        {Permission::SYSTEM_RESTART, "SystemRestart"},
        {Permission::DATABASE_READ, "DatabaseRead"},
        {Permission::DATABASE_WRITE, "DatabaseWrite"},
        {Permission::DATABASE_CREATE, "DatabaseCreate"},
        {Permission::DATABASE_DELETE, "DatabaseDelete"},
        {Permission::REGISTER_API, "RegisterApi"},
        {Permission::CALL_API, "CallApi"},
        {Permission::REGISTER_WIDGET, "RegisterWidget"},
        {Permission::CONTROL_WIDGET, "ControlWidget"},
        {Permission::SEND_NOTIFICATIONS, "SendNotifications"},
        {Permission::READ_NOTIFICATIONS, "ReadNotifications"},
        {Permission::CAMERA_ACCESS, "CameraAccess"},
        {Permission::MICROPHONE_ACCESS, "MicrophoneAccess"},
        {Permission::MEDIA_ACCESS, "MediaAccess"},
        {Permission::PLUGIN_MANAGER, "PluginManager"},
        {Permission::INSTALL_PLUGINS, "InstallPlugins"},
        {Permission::FILE_SYSTEM_READ, "FileSystemRead"},
        {Permission::FILE_SYSTEM_WRITE, "FileSystemWrite"},
        {Permission::FILE_SYSTEM_EXECUTE, "FileSystemExecute"},
        {Permission::LOCATION_ACCESS, "LocationAccess"},
        {Permission::AUTOMATIONS, "Automations"}
    };

    auto it = permission_strings.find(permission);
    if (it != permission_strings.end()) {
        return it->second;
    }
    return "Unknown";
}

RiskLevel get_permission_risk_level(Permission permission) {
    switch (permission) {
        // Low risk
        case Permission::READ_ENTITIES:
        case Permission::STORAGE_READ:
        case Permission::DATABASE_READ:
        case Permission::SYSTEM_INFO:
        case Permission::READ_NOTIFICATIONS:
            return RiskLevel::LOW;

        // Critical risk
        case Permission::SYSTEM_CONTROL:
        case Permission::SYSTEM_RESTART:
        case Permission::PLUGIN_MANAGER:
        case Permission::INSTALL_PLUGINS:
        case Permission::FILE_SYSTEM_WRITE:
        case Permission::FILE_SYSTEM_EXECUTE:
        case Permission::NETWORK_SCAN:
        case Permission::NETWORK_LOCAL_ACCESS:
            return RiskLevel::CRITICAL;

        // High risk
        case Permission::CREATE_ENTITIES:
        case Permission::DELETE_ENTITIES:
        case Permission::NETWORK_ACCESS:
        case Permission::NETWORK_OUTBOUND:
        case Permission::REGISTER_API:
        case Permission::REGISTER_WIDGET:
        case Permission::CAMERA_ACCESS:
        case Permission::FILE_SYSTEM_READ:
            return RiskLevel::HIGH;

        // Medium risk (default)
        default:
            return RiskLevel::MEDIUM;
    }
}

std::string get_permission_description(Permission permission) {
    static const std::unordered_map<Permission, std::string> descriptions = {
        {Permission::READ_ENTITIES, "Read entity states and attributes"},
        {Permission::CONTROL_ENTITIES, "Control smart home devices"},
        {Permission::CREATE_ENTITIES, "Create new entities"},
        {Permission::DELETE_ENTITIES, "Delete entities"},
        {Permission::STORAGE_READ, "Read from storage"},
        {Permission::STORAGE_WRITE, "Write to storage"},
        {Permission::STORAGE_DELETE, "Delete from storage"},
        {Permission::NETWORK_ACCESS, "Access external networks"},
        {Permission::NETWORK_OUTBOUND, "Make outbound network requests"},
        {Permission::NETWORK_INBOUND, "Accept inbound network connections"},
        {Permission::NETWORK_SCAN, "Scan local network"},
        {Permission::NETWORK_LOCAL_ACCESS, "Access local network devices"},
        {Permission::SYSTEM_INFO, "Read system information"},
        {Permission::SYSTEM_CONTROL, "Control system settings"},
        {Permission::SYSTEM_RESTART, "Restart IORA system"},
        {Permission::DATABASE_READ, "Read from database"},
        {Permission::DATABASE_WRITE, "Write to database"},
        {Permission::DATABASE_CREATE, "Create database tables"},
        {Permission::DATABASE_DELETE, "Delete from database"},
        {Permission::REGISTER_API, "Register API endpoints"},
        {Permission::CALL_API, "Call API endpoints"},
        {Permission::REGISTER_WIDGET, "Register dashboard widgets"},
        {Permission::CONTROL_WIDGET, "Control widgets"},
        {Permission::SEND_NOTIFICATIONS, "Send notifications"},
        {Permission::READ_NOTIFICATIONS, "Read notifications"},
        {Permission::CAMERA_ACCESS, "Access camera"},
        {Permission::MICROPHONE_ACCESS, "Access microphone"},
        {Permission::MEDIA_ACCESS, "Access media files"},
        {Permission::PLUGIN_MANAGER, "Manage plugins"},
        {Permission::INSTALL_PLUGINS, "Install/uninstall plugins"},
        {Permission::FILE_SYSTEM_READ, "Read files"},
        {Permission::FILE_SYSTEM_WRITE, "Write files"},
        {Permission::FILE_SYSTEM_EXECUTE, "Execute files"},
        {Permission::LOCATION_ACCESS, "Access location data"},
        {Permission::AUTOMATIONS, "Create and manage automations"}
    };

    auto it = descriptions.find(permission);
    if (it != descriptions.end()) {
        return it->second;
    }
    return "Unknown permission";
}

} // namespace iora
