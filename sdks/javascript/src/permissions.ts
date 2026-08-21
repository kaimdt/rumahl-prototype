/**
 * Permission enum matching backend permissions
 */
export enum Permission {
  ReadEntities = 'ReadEntities',
  ControlEntities = 'ControlEntities',
  CreateEntities = 'CreateEntities',
  DeleteEntities = 'DeleteEntities',

  StorageRead = 'StorageRead',
  StorageWrite = 'StorageWrite',
  StorageDelete = 'StorageDelete',

  NetworkAccess = 'NetworkAccess',
  NetworkOutbound = 'NetworkOutbound',
  NetworkInbound = 'NetworkInbound',
  NetworkScan = 'NetworkScan',
  NetworkLocalAccess = 'NetworkLocalAccess',

  SystemInfo = 'SystemInfo',
  SystemControl = 'SystemControl',
  SystemRestart = 'SystemRestart',

  DatabaseRead = 'DatabaseRead',
  DatabaseWrite = 'DatabaseWrite',
  DatabaseCreate = 'DatabaseCreate',
  DatabaseDelete = 'DatabaseDelete',

  RegisterApi = 'RegisterApi',
  CallApi = 'CallApi',
  RegisterWidget = 'RegisterWidget',
  ControlWidget = 'ControlWidget',

  SendNotifications = 'SendNotifications',
  ReadNotifications = 'ReadNotifications',

  CameraAccess = 'CameraAccess',
  MicrophoneAccess = 'MicrophoneAccess',
  MediaAccess = 'MediaAccess',

  PluginManager = 'PluginManager',
  InstallPlugins = 'InstallPlugins',
  FileSystemRead = 'FileSystemRead',
  FileSystemWrite = 'FileSystemWrite',
  FileSystemExecute = 'FileSystemExecute',
  LocationAccess = 'LocationAccess',
  Automations = 'Automations',
}

/**
 * Risk levels for permissions
 */
export enum RiskLevel {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
  Critical = 'Critical',
}

/**
 * Get risk level for a permission
 */
export function getPermissionRiskLevel(permission: Permission): RiskLevel {
  const lowRisk = [
    Permission.ReadEntities,
    Permission.StorageRead,
    Permission.DatabaseRead,
    Permission.SystemInfo,
    Permission.ReadNotifications,
  ];

  const criticalRisk = [
    Permission.SystemControl,
    Permission.SystemRestart,
    Permission.PluginManager,
    Permission.InstallPlugins,
    Permission.FileSystemWrite,
    Permission.FileSystemExecute,
    Permission.NetworkScan,
    Permission.NetworkLocalAccess,
  ];

  const highRisk = [
    Permission.CreateEntities,
    Permission.DeleteEntities,
    Permission.NetworkAccess,
    Permission.NetworkOutbound,
    Permission.RegisterApi,
    Permission.RegisterWidget,
    Permission.CameraAccess,
    Permission.FileSystemRead,
  ];

  if (lowRisk.includes(permission)) return RiskLevel.Low;
  if (criticalRisk.includes(permission)) return RiskLevel.Critical;
  if (highRisk.includes(permission)) return RiskLevel.High;
  return RiskLevel.Medium;
}

/**
 * Get description for a permission
 */
export function getPermissionDescription(permission: Permission): string {
  const descriptions: Record<Permission, string> = {
    [Permission.ReadEntities]: 'Read entity states and attributes',
    [Permission.ControlEntities]: 'Control smart home devices',
    [Permission.CreateEntities]: 'Create new entities',
    [Permission.DeleteEntities]: 'Delete entities',
    [Permission.StorageRead]: 'Read from storage',
    [Permission.StorageWrite]: 'Write to storage',
    [Permission.StorageDelete]: 'Delete from storage',
    [Permission.NetworkAccess]: 'Access external networks',
    [Permission.NetworkOutbound]: 'Make outbound network requests',
    [Permission.NetworkInbound]: 'Accept inbound network connections',
    [Permission.NetworkScan]: 'Scan local network',
    [Permission.NetworkLocalAccess]: 'Access local network devices',
    [Permission.SystemInfo]: 'Read system information',
    [Permission.SystemControl]: 'Control system settings',
    [Permission.SystemRestart]: 'Restart rumahl system',
    [Permission.DatabaseRead]: 'Read from database',
    [Permission.DatabaseWrite]: 'Write to database',
    [Permission.DatabaseCreate]: 'Create database tables',
    [Permission.DatabaseDelete]: 'Delete from database',
    [Permission.RegisterApi]: 'Register API endpoints',
    [Permission.CallApi]: 'Call API endpoints',
    [Permission.RegisterWidget]: 'Register dashboard widgets',
    [Permission.ControlWidget]: 'Control widgets',
    [Permission.SendNotifications]: 'Send notifications',
    [Permission.ReadNotifications]: 'Read notifications',
    [Permission.CameraAccess]: 'Access camera',
    [Permission.MicrophoneAccess]: 'Access microphone',
    [Permission.MediaAccess]: 'Access media files',
    [Permission.PluginManager]: 'Manage plugins',
    [Permission.InstallPlugins]: 'Install/uninstall plugins',
    [Permission.FileSystemRead]: 'Read files',
    [Permission.FileSystemWrite]: 'Write files',
    [Permission.FileSystemExecute]: 'Execute files',
    [Permission.LocationAccess]: 'Access location data',
    [Permission.Automations]: 'Create and manage automations',
  };

  return descriptions[permission] || 'Unknown permission';
}
