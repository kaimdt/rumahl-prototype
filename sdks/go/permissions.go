// Package iora provides permission types and utilities
package iora

// Permission represents an IORA permission
type Permission string

// All IORA permissions
const (
	// Entity permissions
	PermissionReadEntities    Permission = "ReadEntities"
	PermissionControlEntities Permission = "ControlEntities"
	PermissionCreateEntities  Permission = "CreateEntities"
	PermissionDeleteEntities  Permission = "DeleteEntities"

	// Storage permissions
	PermissionStorageRead   Permission = "StorageRead"
	PermissionStorageWrite  Permission = "StorageWrite"
	PermissionStorageDelete Permission = "StorageDelete"

	// Network permissions
	PermissionNetworkAccess      Permission = "NetworkAccess"
	PermissionNetworkOutbound    Permission = "NetworkOutbound"
	PermissionNetworkInbound     Permission = "NetworkInbound"
	PermissionNetworkScan        Permission = "NetworkScan"
	PermissionNetworkLocalAccess Permission = "NetworkLocalAccess"

	// System permissions
	PermissionSystemInfo    Permission = "SystemInfo"
	PermissionSystemControl Permission = "SystemControl"
	PermissionSystemRestart Permission = "SystemRestart"

	// Database permissions
	PermissionDatabaseRead   Permission = "DatabaseRead"
	PermissionDatabaseWrite  Permission = "DatabaseWrite"
	PermissionDatabaseCreate Permission = "DatabaseCreate"
	PermissionDatabaseDelete Permission = "DatabaseDelete"

	// API and Widget permissions
	PermissionRegisterAPI    Permission = "RegisterApi"
	PermissionCallAPI        Permission = "CallApi"
	PermissionRegisterWidget Permission = "RegisterWidget"
	PermissionControlWidget  Permission = "ControlWidget"

	// Notification permissions
	PermissionSendNotifications Permission = "SendNotifications"
	PermissionReadNotifications Permission = "ReadNotifications"

	// Media permissions
	PermissionCameraAccess     Permission = "CameraAccess"
	PermissionMicrophoneAccess Permission = "MicrophoneAccess"
	PermissionMediaAccess      Permission = "MediaAccess"

	// Plugin and filesystem permissions
	PermissionPluginManager     Permission = "PluginManager"
	PermissionInstallPlugins    Permission = "InstallPlugins"
	PermissionFileSystemRead    Permission = "FileSystemRead"
	PermissionFileSystemWrite   Permission = "FileSystemWrite"
	PermissionFileSystemExecute Permission = "FileSystemExecute"

	// Other permissions
	PermissionLocationAccess Permission = "LocationAccess"
	PermissionAutomations    Permission = "Automations"

	// File sharing permissions (iora-share)
	PermissionFileShareRead   Permission = "FileShareRead"
	PermissionFileShareWrite  Permission = "FileShareWrite"
	PermissionFileShareDelete Permission = "FileShareDelete"
	PermissionFileShareManage Permission = "FileShareManage"

	// Advanced app-only permissions
	PermissionBackupAccess       Permission = "BackupAccess"
	PermissionLogAccess          Permission = "LogAccess"
	PermissionUserManagement     Permission = "UserManagement"
	PermissionSecuritySettings   Permission = "SecuritySettings"
	PermissionNetworkMonitoring  Permission = "NetworkMonitoring"
	PermissionProcessControl     Permission = "ProcessControl"
)

// RiskLevel represents the risk level of a permission
type RiskLevel string

const (
	RiskLevelLow      RiskLevel = "Low"
	RiskLevelMedium   RiskLevel = "Medium"
	RiskLevelHigh     RiskLevel = "High"
	RiskLevelCritical RiskLevel = "Critical"
)

// PermissionCategory defines access level and approval requirements
type PermissionCategory string

const (
	// PluginAllowed - Available to both Apps and Plugins, auto-approved based on manifest
	PermissionCategoryPluginAllowed PermissionCategory = "PluginAllowed"
	// AppOnly - Only available to Apps, auto-approved based on manifest
	PermissionCategoryAppOnly PermissionCategory = "AppOnly"
	// AppOnlyWithConsent - Only available to Apps, requires explicit user consent per installation
	PermissionCategoryAppOnlyWithConsent PermissionCategory = "AppOnlyWithConsent"
)

// PermissionMetadata contains metadata for a permission
type PermissionMetadata struct {
	Permission  Permission
	Category    PermissionCategory
	RiskLevel   RiskLevel
	Description string
}

// GetPermissionRiskLevel returns the risk level for a permission
func GetPermissionRiskLevel(permission Permission) RiskLevel {
	switch permission {
	// Low risk
	case PermissionReadEntities, PermissionStorageRead, PermissionDatabaseRead,
		PermissionSystemInfo, PermissionReadNotifications:
		return RiskLevelLow

	// Critical risk
	case PermissionSystemControl, PermissionSystemRestart, PermissionPluginManager,
		PermissionInstallPlugins, PermissionFileSystemWrite, PermissionFileSystemExecute,
		PermissionNetworkScan, PermissionNetworkLocalAccess:
		return RiskLevelCritical

	// High risk
	case PermissionCreateEntities, PermissionDeleteEntities, PermissionNetworkAccess,
		PermissionNetworkOutbound, PermissionRegisterAPI, PermissionRegisterWidget,
		PermissionCameraAccess, PermissionFileSystemRead:
		return RiskLevelHigh

	// Medium risk (default)
	default:
		return RiskLevelMedium
	}
}

// GetPermissionDescription returns a description for a permission
func GetPermissionDescription(permission Permission) string {
	descriptions := map[Permission]string{
		PermissionReadEntities:       "Read entity states and attributes",
		PermissionControlEntities:    "Control smart home devices",
		PermissionCreateEntities:     "Create new entities",
		PermissionDeleteEntities:     "Delete entities",
		PermissionStorageRead:        "Read from storage",
		PermissionStorageWrite:       "Write to storage",
		PermissionStorageDelete:      "Delete from storage",
		PermissionNetworkAccess:      "Access external networks",
		PermissionNetworkOutbound:    "Make outbound network requests",
		PermissionNetworkInbound:     "Accept inbound network connections",
		PermissionNetworkScan:        "Scan local network",
		PermissionNetworkLocalAccess: "Access local network devices",
		PermissionSystemInfo:         "Read system information",
		PermissionSystemControl:      "Control system settings",
		PermissionSystemRestart:      "Restart IORA system",
		PermissionDatabaseRead:       "Read from database",
		PermissionDatabaseWrite:      "Write to database",
		PermissionDatabaseCreate:     "Create database tables",
		PermissionDatabaseDelete:     "Delete from database",
		PermissionRegisterAPI:        "Register API endpoints",
		PermissionCallAPI:            "Call API endpoints",
		PermissionRegisterWidget:     "Register dashboard widgets",
		PermissionControlWidget:      "Control widgets",
		PermissionSendNotifications:  "Send notifications",
		PermissionReadNotifications:  "Read notifications",
		PermissionCameraAccess:       "Access camera",
		PermissionMicrophoneAccess:   "Access microphone",
		PermissionMediaAccess:        "Access media files",
		PermissionPluginManager:      "Manage plugins",
		PermissionInstallPlugins:     "Install/uninstall plugins",
		PermissionFileSystemRead:     "Read files",
		PermissionFileSystemWrite:    "Write files",
		PermissionFileSystemExecute:  "Execute files",
		PermissionLocationAccess:     "Access location data",
		PermissionAutomations:        "Create and manage automations",
	}

	if desc, ok := descriptions[permission]; ok {
		return desc
	}
	return "Unknown permission"
}
