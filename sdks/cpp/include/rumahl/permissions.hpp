#pragma once

#include <string>

namespace ora {

/**
 * rumahl Permission types
 */
enum class Permission {
    // Entity permissions
    READ_ENTITIES,
    CONTROL_ENTITIES,
    CREATE_ENTITIES,
    DELETE_ENTITIES,

    // Storage permissions
    STORAGE_READ,
    STORAGE_WRITE,
    STORAGE_DELETE,

    // Network permissions
    NETWORK_ACCESS,
    NETWORK_OUTBOUND,
    NETWORK_INBOUND,
    NETWORK_SCAN,
    NETWORK_LOCAL_ACCESS,

    // System permissions
    SYSTEM_INFO,
    SYSTEM_CONTROL,
    SYSTEM_RESTART,

    // Database permissions
    DATABASE_READ,
    DATABASE_WRITE,
    DATABASE_CREATE,
    DATABASE_DELETE,

    // API and Widget permissions
    REGISTER_API,
    CALL_API,
    REGISTER_WIDGET,
    CONTROL_WIDGET,

    // Notification permissions
    SEND_NOTIFICATIONS,
    READ_NOTIFICATIONS,

    // Media permissions
    CAMERA_ACCESS,
    MICROPHONE_ACCESS,
    MEDIA_ACCESS,

    // Plugin and filesystem permissions
    PLUGIN_MANAGER,
    INSTALL_PLUGINS,
    FILE_SYSTEM_READ,
    FILE_SYSTEM_WRITE,
    FILE_SYSTEM_EXECUTE,

    // Other permissions
    LOCATION_ACCESS,
    AUTOMATIONS
};

/**
 * Risk level for permissions
 */
enum class RiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
};

/**
 * Convert permission to string
 */
std::string permission_to_string(Permission permission);

/**
 * Get risk level for a permission
 */
RiskLevel get_permission_risk_level(Permission permission);

/**
 * Get description for a permission
 */
std::string get_permission_description(Permission permission);

} // namespace ora
