//! Enhanced Permission System for Apps and Plugins
//!
//! Granular permission control with request/grant workflow.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
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

    // API permissions
    RegisterApi,
    CallApi,

    // Widget permissions
    RegisterWidget,
    ControlWidget,

    // Notification permissions
    SendNotifications,
    ReadNotifications,

    // File system permissions
    FileSystemRead,
    FileSystemWrite,
    FileSystemExecute,

    // Plugin management
    PluginManager,
    InstallPlugins,
    UninstallPlugins,

    // User management (DANGEROUS - Apps only, requires consent)
    ReadUserData,
    WriteUserData,
    CreateUser,
    ModifyUser,
    DeleteUser,

    // Camera/Media
    CameraAccess,
    MicrophoneAccess,
    MediaAccess,

    // Location
    LocationAccess,
    LocationPrecise,

    // Automation
    CreateAutomations,
    RunAutomations,

    // File sharing (iora-share)
    FileShareRead,
    FileShareWrite,
    FileShareDelete,
    FileShareManage,

    // Developer Mode permissions (ONLY available when Developer Mode enabled)
    DeveloperAccess,
    InterAppCommunication,
    LiveMetrics,
    DirectDeploy,
    DebugAccess,
    LiveLogs,

    // EXCLUSIVE Developer App permission
    HotReload,

    // --- New in v2.1: Extended App Capabilities ---

    // App Storage permissions
    AppStorageRead,
    AppStorageWrite,
    AppStorageDelete,
    AppStorageManage,

    // App Database permissions
    AppDatabaseSqlite,
    AppDatabaseManage,

    // App Scheduling permissions
    AppScheduleCreate,
    AppScheduleRead,
    AppScheduleUpdate,
    AppScheduleDelete,

    // App Messaging permissions
    MessagingPublish,
    MessagingSubscribe,
    MessagingWildcard,
    MessagingDirect,

    // App Webhook permissions
    WebhookCreate,
    WebhookRead,
    WebhookUpdate,
    WebhookDelete,
    WebhookManage,

    // Generic app runtime permissions
    AppActionExecute,
    AppQueueManage,
    ExternalHttpRequest,
    AppRuntimeAuditRead,
    AppSecretsRead,
    AppSecretsWrite,
    AppSecretsManage,

    // Theme permissions
    /// Install custom themes from app/plugin manifests
    ThemeInstall,
    /// Manage installed themes (enable/disable/uninstall)
    ThemeManage,
    /// Select and apply themes per user
    ThemeSelect,

    // Assist integration permissions
    AssistContextRead,
    AssistEventsSubscribe,
    AssistChat,
    AssistTaskCreate,
    AssistTaskManage,
    AssistToolExecute,

    // GitHub integration permissions via IORA Assist
    GitHubRead,
    GitHubWrite,
    GitHubPullRequestRead,
    GitHubPullRequestComment,
    GitHubWorkflowTrigger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub id: String,
    pub provider_id: String,
    pub provider_type: ProviderType,
    pub permissions: Vec<Permission>,
    pub reason: String,
    pub requested_at: String,
    pub status: PermissionRequestStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionRequestStatus {
    Pending,
    Approved,
    Denied,
    PartiallyApproved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    App,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionGrant {
    pub provider_id: String,
    pub permission: Permission,
    pub granted_at: String,
    pub granted_by: String,
    pub expires_at: Option<String>,
    pub is_active: bool,
}

/// Permission System manages permission requests and grants
#[derive(Default)]
pub struct PermissionSystem {
    grants: RwLock<HashMap<String, Vec<PermissionGrant>>>,
    requests: RwLock<HashMap<String, PermissionRequest>>,
}

impl PermissionSystem {
    pub fn new() -> Self {
        Self::default()
    }

    /// Request permissions
    pub async fn request_permissions(
        &self,
        provider_id: String,
        provider_type: ProviderType,
        permissions: Vec<Permission>,
        reason: String,
    ) -> anyhow::Result<String> {
        let request_id = format!("perm_req_{}", uuid::Uuid::new_v4());

        let request = PermissionRequest {
            id: request_id.clone(),
            provider_id,
            provider_type,
            permissions,
            reason,
            requested_at: chrono::Utc::now().to_rfc3339(),
            status: PermissionRequestStatus::Pending,
        };

        let mut requests = self.requests.write().await;
        requests.insert(request_id.clone(), request);

        Ok(request_id)
    }

    /// Approve permission request
    pub async fn approve_request(
        &self,
        request_id: &str,
        granted_by: String,
        approved_permissions: Vec<Permission>,
    ) -> anyhow::Result<()> {
        let mut requests = self.requests.write().await;
        let request = requests
            .get_mut(request_id)
            .ok_or_else(|| anyhow::anyhow!("Permission request '{}' not found", request_id))?;

        let all_approved = approved_permissions.len() == request.permissions.len();
        request.status = if all_approved {
            PermissionRequestStatus::Approved
        } else {
            PermissionRequestStatus::PartiallyApproved
        };

        let provider_id = request.provider_id.clone();
        drop(requests);

        let mut grants = self.grants.write().await;
        let provider_grants = grants.entry(provider_id.clone()).or_insert_with(Vec::new);

        for permission in approved_permissions {
            let grant = PermissionGrant {
                provider_id: provider_id.clone(),
                permission,
                granted_at: chrono::Utc::now().to_rfc3339(),
                granted_by: granted_by.clone(),
                expires_at: None,
                is_active: true,
            };
            provider_grants.push(grant);
        }

        Ok(())
    }

    /// Deny permission request
    pub async fn deny_request(&self, request_id: &str) -> anyhow::Result<()> {
        let mut requests = self.requests.write().await;
        let request = requests
            .get_mut(request_id)
            .ok_or_else(|| anyhow::anyhow!("Permission request '{}' not found", request_id))?;

        request.status = PermissionRequestStatus::Denied;
        Ok(())
    }

    /// Check if provider has permission
    pub async fn has_permission(&self, provider_id: &str, permission: &Permission) -> bool {
        let grants = self.grants.read().await;
        if let Some(provider_grants) = grants.get(provider_id) {
            provider_grants
                .iter()
                .any(|g| &g.permission == permission && g.is_active && g.expires_at.is_none())
        } else {
            false
        }
    }

    /// Check multiple permissions at once
    pub async fn has_all_permissions(&self, provider_id: &str, permissions: &[Permission]) -> bool {
        for permission in permissions {
            if !self.has_permission(provider_id, permission).await {
                return false;
            }
        }
        true
    }

    /// Get all permissions for a provider
    pub async fn get_permissions(&self, provider_id: &str) -> Vec<Permission> {
        let grants = self.grants.read().await;
        grants
            .get(provider_id)
            .map(|grants| {
                grants
                    .iter()
                    .filter(|g| g.is_active)
                    .map(|g| g.permission.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Revoke a specific permission
    pub async fn revoke_permission(
        &self,
        provider_id: &str,
        permission: &Permission,
    ) -> anyhow::Result<()> {
        let mut grants = self.grants.write().await;
        if let Some(provider_grants) = grants.get_mut(provider_id) {
            for grant in provider_grants.iter_mut() {
                if &grant.permission == permission {
                    grant.is_active = false;
                }
            }
            Ok(())
        } else {
            anyhow::bail!("No permissions found for provider '{}'", provider_id)
        }
    }

    /// Revoke all permissions for a provider
    pub async fn revoke_all_permissions(&self, provider_id: &str) -> anyhow::Result<()> {
        let mut grants = self.grants.write().await;
        if let Some(provider_grants) = grants.get_mut(provider_id) {
            for grant in provider_grants.iter_mut() {
                grant.is_active = false;
            }
            Ok(())
        } else {
            anyhow::bail!("No permissions found for provider '{}'", provider_id)
        }
    }

    /// List all pending permission requests
    pub async fn list_pending_requests(&self) -> Vec<PermissionRequest> {
        self.requests
            .read()
            .await
            .values()
            .filter(|r| r.status == PermissionRequestStatus::Pending)
            .cloned()
            .collect()
    }

    /// Get permission request by ID
    pub async fn get_request(&self, request_id: &str) -> Option<PermissionRequest> {
        self.requests.read().await.get(request_id).cloned()
    }

    /// Get all grants for a provider
    pub async fn get_grants(&self, provider_id: &str) -> Vec<PermissionGrant> {
        self.grants
            .read()
            .await
            .get(provider_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl Permission {
    /// Get human-readable description of permission
    pub fn description(&self) -> &'static str {
        match self {
            Permission::ReadEntities => "Lesen von Entitäten (Geräte, Sensoren, etc.)",
            Permission::ControlEntities => "Steuern von Entitäten",
            Permission::CreateEntities => "Erstellen neuer Entitäten",
            Permission::DeleteEntities => "Löschen von Entitäten",
            Permission::StorageRead => "Lesen von gespeicherten Daten",
            Permission::StorageWrite => "Schreiben von Daten in den Speicher",
            Permission::StorageDelete => "Löschen gespeicherter Daten",
            Permission::NetworkAccess => "Zugriff auf das Netzwerk",
            Permission::NetworkOutbound => "Ausgehende Netzwerkverbindungen",
            Permission::NetworkInbound => "Eingehende Netzwerkverbindungen",
            Permission::NetworkScan => "Scannen des lokalen Netzwerks",
            Permission::NetworkLocalAccess => "Zugriff auf lokale Netzwerk-IPs",
            Permission::SystemInfo => "Lesen von Systeminformationen",
            Permission::SystemControl => "Steuerung des Systems",
            Permission::SystemRestart => "Neustart des Systems",
            Permission::DatabaseRead => "Lesen aus der Datenbank",
            Permission::DatabaseWrite => "Schreiben in die Datenbank",
            Permission::DatabaseCreate => "Erstellen von Datenbanktabellen",
            Permission::DatabaseDelete => "Löschen von Datenbanktabellen",
            Permission::RegisterApi => "Registrierung von API-Endpunkten",
            Permission::CallApi => "Aufrufen von API-Endpunkten",
            Permission::RegisterWidget => "Registrierung von Widgets",
            Permission::ControlWidget => "Steuerung von Widgets",
            Permission::SendNotifications => "Senden von Benachrichtigungen",
            Permission::ReadNotifications => "Lesen von Benachrichtigungen",
            Permission::FileSystemRead => "Lesen von Dateien",
            Permission::FileSystemWrite => "Schreiben von Dateien",
            Permission::FileSystemExecute => "Ausführen von Dateien",
            Permission::PluginManager => "Verwaltung von Plugins",
            Permission::InstallPlugins => "Installieren von Plugins",
            Permission::UninstallPlugins => "Deinstallieren von Plugins",
            Permission::ReadUserData => "Lesen von Benutzerdaten",
            Permission::WriteUserData => "Schreiben von Benutzerdaten",
            Permission::CreateUser => "Erstellen neuer Benutzer (NICHT Admins!) - GEFÄHRLICH",
            Permission::ModifyUser => "Bearbeiten von Benutzern (NICHT Rollen!) - GEFÄHRLICH",
            Permission::DeleteUser => "Löschen von Benutzern (NICHT Admins!) - GEFÄHRLICH",
            Permission::CameraAccess => "Zugriff auf Kameras",
            Permission::MicrophoneAccess => "Zugriff auf Mikrofone",
            Permission::MediaAccess => "Zugriff auf Medien",
            Permission::LocationAccess => "Zugriff auf Standortdaten",
            Permission::LocationPrecise => "Zugriff auf präzise Standortdaten",
            Permission::CreateAutomations => "Erstellen von Automatisierungen",
            Permission::RunAutomations => "Ausführen von Automatisierungen",
            Permission::FileShareRead => "Lesen von geteilten Dateien (iora-share)",
            Permission::FileShareWrite => "Hochladen von Dateien (iora-share)",
            Permission::FileShareDelete => "Löschen von Dateien (iora-share)",
            Permission::FileShareManage => "Verwaltung von Dateifreigaben und Berechtigungen",
            Permission::DeveloperAccess => "DEVELOPER MODE: Vollzugriff auf System-Interna",
            Permission::InterAppCommunication => "DEVELOPER MODE: Kommunikation mit anderen Apps",
            Permission::LiveMetrics => "DEVELOPER MODE: Echtzeit-Metriken und Monitoring",
            Permission::DirectDeploy => "DEVELOPER MODE: IDE-Integration für Build/Deploy",
            Permission::DebugAccess => "DEVELOPER MODE: Zugriff auf Debug-Interfaces",
            Permission::LiveLogs => "DEVELOPER MODE: Live-Streaming aller Logs",
            Permission::HotReload => "EXKLUSIV: Hot-Reload und Live-App-Upload (nur Developer App)",
            // New v2.1
            Permission::AppStorageRead => "Lesen des app-eigenen Datei-/KV-Speichers",
            Permission::AppStorageWrite => "Schreiben in den app-eigenen Speicher",
            Permission::AppStorageDelete => "Löschen aus dem app-eigenen Speicher",
            Permission::AppStorageManage => {
                "Verwaltung von Speicherkontingenten und -Einstellungen"
            }
            Permission::AppDatabaseSqlite => "Bereitstellung einer app-eigenen SQLite-Datenbank",
            Permission::AppDatabaseManage => "Verwaltung von Datenbankeinstellungen und Backups",
            Permission::AppScheduleCreate => "Erstellen geplanter Aufgaben / Cron-Jobs",
            Permission::AppScheduleRead => "Lesen geplanter Aufgaben",
            Permission::AppScheduleUpdate => "Aktualisieren geplanter Aufgaben",
            Permission::AppScheduleDelete => "Löschen geplanter Aufgaben",
            Permission::MessagingPublish => "Veröffentlichen von Nachrichten in Kanälen",
            Permission::MessagingSubscribe => "Abonnieren von Nachrichtenkanälen",
            Permission::MessagingWildcard => "Abonnieren JEDES Kanals (gefährlich!)",
            Permission::MessagingDirect => "Direktnachrichten an andere Apps senden",
            Permission::WebhookCreate => "Erstellen von Webhook-Endpunkten",
            Permission::WebhookRead => "Lesen von Webhook-Konfigurationen",
            Permission::WebhookUpdate => "Aktualisieren von Webhook-Endpunkten",
            Permission::WebhookDelete => "Löschen von Webhook-Endpunkten",
            Permission::WebhookManage => "Verwaltung aller Webhooks (Admin)",
            Permission::AppActionExecute => "App-Aktionen im Auftrag eines Benutzers ausführen",
            Permission::AppQueueManage => "App-Laufzeitjobs und Warteschlangen verwalten",
            Permission::ExternalHttpRequest => "Externe HTTP- und API-Anfragen ausführen",
            Permission::AppRuntimeAuditRead => "App-Laufzeit-Audit lesen",
            Permission::AppSecretsRead => "App-eigene Secrets lesen und verwenden",
            Permission::AppSecretsWrite => "App-eigene Secrets speichern und aktualisieren",
            Permission::AppSecretsManage => "App-eigene Secrets verwalten und löschen",
            Permission::ThemeInstall => "Installieren von Themes aus App-/Plugin-Manifesten",
            Permission::ThemeManage => {
                "Verwalten installierter Themes (aktivieren/deaktivieren/deinstallieren)"
            }
            Permission::ThemeSelect => "Auswählen und Anwenden von Themes pro Benutzer",
            Permission::AssistContextRead => "IORA Assist Kontext lesen",
            Permission::AssistEventsSubscribe => "IORA Assist Ereignisse abonnieren",
            Permission::AssistChat => "Nachrichten an IORA Assist senden",
            Permission::AssistTaskCreate => "IORA Assist Agent-Aufgaben erstellen",
            Permission::AssistTaskManage => "IORA Assist Agent-Aufgaben verwalten",
            Permission::AssistToolExecute => "IORA Assist Tools ausführen",
            Permission::GitHubRead => "GitHub-Daten über IORA Assist lesen",
            Permission::GitHubWrite => "GitHub-Daten über IORA Assist schreiben",
            Permission::GitHubPullRequestRead => "GitHub Pull Requests über IORA Assist lesen",
            Permission::GitHubPullRequestComment => "GitHub Pull Requests kommentieren",
            Permission::GitHubWorkflowTrigger => "GitHub Workflows starten",
        }
    }

    /// Get risk level of permission
    pub fn risk_level(&self) -> RiskLevel {
        match self {
            Permission::ReadEntities
            | Permission::StorageRead
            | Permission::SystemInfo
            | Permission::DatabaseRead
            | Permission::ReadNotifications
            | Permission::FileSystemRead
            | Permission::ReadUserData
            | Permission::MediaAccess
            | Permission::FileShareRead
            | Permission::AppStorageRead
            | Permission::AppScheduleRead
            | Permission::WebhookRead
            | Permission::AppRuntimeAuditRead
            | Permission::AppSecretsRead
            | Permission::AssistContextRead
            | Permission::AssistEventsSubscribe
            | Permission::GitHubRead
            | Permission::GitHubPullRequestRead => RiskLevel::Low,

            Permission::ControlEntities
            | Permission::StorageWrite
            | Permission::NetworkAccess
            | Permission::DatabaseWrite
            | Permission::RegisterApi
            | Permission::CallApi
            | Permission::RegisterWidget
            | Permission::ControlWidget
            | Permission::SendNotifications
            | Permission::FileSystemWrite
            | Permission::WriteUserData
            | Permission::LocationAccess
            | Permission::CreateAutomations
            | Permission::RunAutomations
            | Permission::AppStorageWrite
            | Permission::AppScheduleCreate
            | Permission::AppScheduleUpdate
            | Permission::MessagingPublish
            | Permission::MessagingSubscribe
            | Permission::MessagingDirect
            | Permission::WebhookCreate
            | Permission::WebhookUpdate
            | Permission::AppActionExecute
            | Permission::AppSecretsWrite
            | Permission::AssistChat
            | Permission::AssistTaskCreate
            | Permission::AssistToolExecute => RiskLevel::Medium,
            Permission::ThemeSelect => RiskLevel::Low,
            Permission::ThemeInstall => RiskLevel::Medium,

            Permission::CreateEntities
            | Permission::DeleteEntities
            | Permission::StorageDelete
            | Permission::NetworkOutbound
            | Permission::NetworkInbound
            | Permission::NetworkLocalAccess
            | Permission::DatabaseCreate
            | Permission::DatabaseDelete
            | Permission::FileSystemExecute
            | Permission::InstallPlugins
            | Permission::UninstallPlugins
            | Permission::CameraAccess
            | Permission::MicrophoneAccess
            | Permission::LocationPrecise
            | Permission::NetworkScan
            | Permission::FileShareWrite
            | Permission::FileShareDelete
            | Permission::AppStorageDelete
            | Permission::AppScheduleDelete
            | Permission::WebhookDelete
            | Permission::AppDatabaseSqlite
            | Permission::MessagingWildcard
            | Permission::ExternalHttpRequest
            | Permission::GitHubPullRequestComment
            | Permission::GitHubWorkflowTrigger => RiskLevel::High,

            Permission::SystemControl
            | Permission::SystemRestart
            | Permission::PluginManager
            | Permission::CreateUser
            | Permission::ModifyUser
            | Permission::DeleteUser
            | Permission::FileShareManage
            | Permission::DeveloperAccess
            | Permission::InterAppCommunication
            | Permission::LiveMetrics
            | Permission::DirectDeploy
            | Permission::DebugAccess
            | Permission::LiveLogs
            | Permission::HotReload
            | Permission::AppStorageManage
            | Permission::AppDatabaseManage
            | Permission::WebhookManage
            | Permission::AppQueueManage
            | Permission::AppSecretsManage
            | Permission::ThemeManage
            | Permission::AssistTaskManage
            | Permission::GitHubWrite => RiskLevel::Critical,
        }
    }

    /// Check if permission is allowed for plugins (false = app-only)
    pub fn is_plugin_allowed(&self) -> bool {
        matches!(
            self,
            Permission::ReadEntities |
            Permission::ControlEntities |
            Permission::StorageRead |
            Permission::StorageWrite |
            Permission::NetworkOutbound |
            Permission::SystemInfo |
            Permission::CallApi |
            Permission::SendNotifications |
            Permission::ReadNotifications |
            Permission::MediaAccess |
            // New v2.1
            Permission::AppStorageRead |
            Permission::AppStorageWrite |
            Permission::AppScheduleCreate |
            Permission::AppScheduleRead |
            Permission::MessagingPublish |
            Permission::MessagingSubscribe |
            Permission::WebhookCreate |
            Permission::WebhookRead |
            Permission::AppActionExecute |
            Permission::AppRuntimeAuditRead |
            Permission::ExternalHttpRequest |
            Permission::AppSecretsRead |
            Permission::AppSecretsWrite |
            Permission::AssistContextRead |
            Permission::AssistEventsSubscribe |
            Permission::AssistChat |
            Permission::AssistTaskCreate |
            Permission::AssistToolExecute |
            Permission::GitHubRead |
            Permission::GitHubPullRequestRead
        ) || matches!(self, Permission::ThemeInstall | Permission::ThemeSelect)
    }

    /// Check if permission requires explicit user consent
    pub fn requires_user_consent(&self) -> bool {
        matches!(
            self,
            Permission::SystemControl |
            Permission::SystemRestart |
            Permission::PluginManager |
            Permission::CreateUser |
            Permission::ModifyUser |
            Permission::DeleteUser |
            Permission::FileSystemWrite |
            Permission::FileSystemExecute |
            Permission::FileShareWrite |
            Permission::FileShareDelete |
            Permission::FileShareManage |
            Permission::CameraAccess |
            Permission::MicrophoneAccess |
            Permission::LocationPrecise |
            Permission::NetworkScan |
            Permission::NetworkInbound |
            Permission::DeveloperAccess |
            Permission::InterAppCommunication |
            Permission::LiveMetrics |
            Permission::DirectDeploy |
            Permission::DebugAccess |
            Permission::LiveLogs |
            // New v2.1
            Permission::AppStorageManage |
            Permission::AppDatabaseManage |
            Permission::MessagingWildcard |
            Permission::WebhookManage |
            Permission::AppQueueManage |
            Permission::ExternalHttpRequest |
            Permission::AppSecretsManage |
            Permission::ThemeManage |
            Permission::AssistChat |
            Permission::AssistTaskCreate |
            Permission::AssistTaskManage |
            Permission::AssistToolExecute |
            Permission::GitHubWrite |
            Permission::GitHubPullRequestComment |
            Permission::GitHubWorkflowTrigger
        )
    }

    /// Check if permission requires Developer Mode to be enabled
    pub fn requires_developer_mode(&self) -> bool {
        matches!(
            self,
            Permission::DeveloperAccess
                | Permission::InterAppCommunication
                | Permission::LiveMetrics
                | Permission::DirectDeploy
                | Permission::DebugAccess
                | Permission::LiveLogs
                | Permission::HotReload
        )
    }

    /// Check if permission is EXCLUSIVE to Developer App (cannot be granted to any other app)
    pub fn is_developer_app_exclusive(&self) -> bool {
        matches!(self, Permission::HotReload)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}
