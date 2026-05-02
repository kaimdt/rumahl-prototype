//! App Manifest Schema - defines the structure for IORA apps
//!
//! This module contains the complete manifest schema for apps and plugins,
//! supporting app store integration, dynamic port assignment, settings pages,
//! and custom page creation.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{app_storage::StorageConfig, app_database::AppDatabaseConfig, app_scheduler::ScheduleConfig, app_messaging::MessagingConfig, app_webhooks::WebhookConfig};

/// Complete app/plugin manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifest {
    /// Unique identifier for the app
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// Semantic version (e.g., "1.0.0")
    pub version: String,

    /// App developer/author
    pub developer: String,

    /// Short description
    pub description: String,

    /// Optional icon URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// App type: "app" or "plugin"
    #[serde(rename = "type")]
    pub app_type: AppType,

    /// Plugin-specific type (only for plugins)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_type: Option<PluginType>,

    /// Required permissions
    #[serde(default)]
    pub permissions: Vec<String>,

    /// API endpoints exposed by the app
    #[serde(default)]
    pub endpoints: Vec<AppEndpoint>,

    /// Dashboard widgets provided
    #[serde(default)]
    pub widgets: Vec<AppWidget>,

    /// Custom pages the app wants to create
    #[serde(default)]
    pub custom_pages: Vec<CustomPage>,

    /// Settings schema for the app
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_schema: Option<SettingsSchema>,

    /// Docker configuration (for single-container apps)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docker: Option<DockerConfig>,

    /// Multi-container app bundle (Docker Compose-style).
    /// When set, the app is treated as a "Bundle" with multiple services,
    /// internal networking, and dependency ordering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle: Option<AppBundle>,

    /// Sandbox configuration (for plugins)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxConfig>,

    /// App store metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_metadata: Option<StoreMetadata>,

    /// Network access configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_access: Option<NetworkAccessConfig>,

    /// Developer Mode configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer_mode: Option<DeveloperModeConfig>,

    /// Installation source (set by system during installation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation_source: Option<InstallationSource>,

    /// --- New in v2.1: Extended capabilities ---

    /// Database configuration (PostgreSQL or per-app SQLite)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<AppDatabaseConfig>,

    /// File and key-value storage configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<StorageConfig>,

    /// Scheduled / cron task configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedules: Option<ScheduleConfig>,

    /// Webhook configuration for external integrations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhooks: Option<WebhookConfig>,

    /// Inter-app messaging (pub/sub) configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messaging: Option<MessagingConfig>,

    /// --- New in v2.2: Theme definition ---
    ///
    /// If the app/plugin provides a custom theme, define it here.
    /// The theme will be available for users to select in the Settings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<crate::theme::ThemeDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AppType {
    App,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginType {
    Widget,
    Service,
    Api,
    Integration,
    Theme,
    Automation,
    DataProcessor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEndpoint {
    pub path: String,
    pub method: HttpMethod,
    pub description: String,
    pub requires_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Delete,
    Patch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppWidget {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub widget_type: String,
    /// URL to the widget component (will be proxied through IORA)
    pub component_url: String,
    pub description: String,
    /// Default configuration for the widget
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPage {
    /// Unique page ID
    pub id: String,

    /// Page title
    pub title: String,

    /// Icon name
    pub icon: String,

    /// URL to the page content (will be iframe'd or proxied)
    pub url: String,

    /// Show in main navigation?
    #[serde(default = "default_true")]
    pub show_in_nav: bool,

    /// Display order
    #[serde(default)]
    pub order: i32,

    /// Parent page ID for sub-pages
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_page_id: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsSchema {
    /// Settings title
    pub title: String,

    /// Settings description
    pub description: String,

    /// Settings fields
    pub fields: Vec<SettingsField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsField {
    /// Field key
    pub key: String,

    /// Field label
    pub label: String,

    /// Field description/help text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Field type
    #[serde(rename = "type")]
    pub field_type: SettingsFieldType,

    /// Default value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,

    /// Is this field required?
    #[serde(default)]
    pub required: bool,

    /// Options for select/radio fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<SettingsFieldOption>>,

    /// Validation rules
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<FieldValidation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingsFieldType {
    Text,
    Number,
    Boolean,
    Select,
    Textarea,
    Password,
    Url,
    Email,
    Color,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsFieldOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldValidation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_length: Option<usize>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerConfig {
    /// Use auto-build (IORA generates Dockerfile) or pre-built image
    #[serde(default)]
    pub auto_build: bool,

    /// Pre-built Docker image (used when auto_build = false)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,

    /// Base image for auto-build
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_image: Option<String>,

    /// Working directory in container
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,

    /// Install command for auto-build
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_cmd: Option<String>,

    /// Start command
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_cmd: Option<String>,

    /// Internal ports the app wants to expose (system will assign external ports)
    #[serde(default)]
    pub internal_ports: Vec<InternalPort>,

    /// Environment variables
    #[serde(default)]
    pub environment: HashMap<String, String>,

    /// Volume mounts
    #[serde(default)]
    pub volumes: Vec<String>,

    /// Health check configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_check: Option<HealthCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalPort {
    /// Internal port number
    pub port: u16,

    /// Protocol (tcp/udp)
    #[serde(default = "default_tcp")]
    pub protocol: String,

    /// Port assignment mode: "random" (default) or "fixed"
    #[serde(default = "default_port_mode")]
    pub assignment_mode: String,

    /// Description of what this port is for
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

fn default_tcp() -> String {
    "tcp".to_string()
}

fn default_port_mode() -> String {
    "random".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    /// Health check endpoint path
    pub endpoint: String,

    /// Interval in seconds
    #[serde(default = "default_health_interval")]
    pub interval: u64,

    /// Timeout in seconds
    #[serde(default = "default_health_timeout")]
    pub timeout: u64,

    /// Number of retries before marking unhealthy
    #[serde(default = "default_health_retries")]
    pub retries: u32,
}

fn default_health_interval() -> u64 {
    30
}

fn default_health_timeout() -> u64 {
    10
}

fn default_health_retries() -> u32 {
    3
}

/// ─── v2.3: Multi-Container App Bundle ────────────────────────────

/// A multi-container app bundle (Docker Compose-like).
/// When an app defines `bundle` in its manifest, IORA manages
/// all services as a coordinated group with internal networking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppBundle {
    /// Version of the bundle format (for future compatibility)
    #[serde(default = "default_bundle_version")]
    pub version: String,

    /// Display name for the bundle in the UI
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,

    /// Individual service definitions
    pub services: Vec<BundleService>,

    /// Network configuration for the bundle
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<BundleNetwork>,

    /// Volumes shared across services in the bundle
    #[serde(default)]
    pub volumes: Vec<BundleVolume>,

    /// Whether to auto-generate a docker-compose.yml from this definition
    #[serde(default = "default_true")]
    pub auto_compose: bool,

    /// Minimum IORA version required for this bundle format
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_iora_version: Option<String>,
}

fn default_bundle_version() -> String {
    "1.0".to_string()
}

/// A single service within an app bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleService {
    /// Unique service name within the bundle
    pub name: String,

    /// Docker image (pre-built). Mutually exclusive with `build`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,

    /// Build configuration (image built from source). Mutually exclusive with `image`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build: Option<BundleBuildConfig>,

    /// Working directory inside the container
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,

    /// Command to start the service
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,

    /// Entry point override
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrypoint: Option<Vec<String>>,

    /// Internal ports this service exposes
    #[serde(default)]
    pub internal_ports: Vec<InternalPort>,

    /// Environment variables
    #[serde(default)]
    pub environment: HashMap<String, String>,

    /// Volume mounts (path or named volume)
    #[serde(default)]
    pub volumes: Vec<String>,

    /// Services this service depends on (startup ordering)
    #[serde(default)]
    pub depends_on: Vec<String>,

    /// Health check for this service
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_check: Option<HealthCheck>,

    /// Restart policy (no, always, on-failure, unless-stopped)
    #[serde(default = "default_restart_policy")]
    pub restart: String,

    /// Resource limits
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<BundleResources>,

    /// Labels for this service
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

fn default_restart_policy() -> String {
    "unless-stopped".to_string()
}

/// Build configuration for a service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleBuildConfig {
    /// Build context path (relative to the app's extracted directory)
    pub context: String,

    /// Dockerfile name (default: "Dockerfile")
    #[serde(default = "default_dockerfile")]
    pub dockerfile: String,

    /// Build arguments
    #[serde(default)]
    pub args: HashMap<String, String>,
}

fn default_dockerfile() -> String {
    "Dockerfile".to_string()
}

/// Resource limits for a service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleResources {
    /// CPU limit (e.g. "0.5" for half a core)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<String>,

    /// Memory limit (e.g. "256M")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,

    /// Memory reservation (soft limit)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_reservation: Option<String>,
}

/// Network configuration for a bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleNetwork {
    /// Network driver (default: "bridge")
    #[serde(default = "default_network_driver")]
    pub driver: String,

    /// Whether the network is internal-only (no external access)
    #[serde(default)]
    pub internal: bool,

    /// Subnet for the internal network
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subnet: Option<String>,

    /// Custom network name (auto-generated if not set)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Enable IPv6
    #[serde(default)]
    pub enable_ipv6: bool,
}

fn default_network_driver() -> String {
    "bridge".to_string()
}

/// Named volume in a bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleVolume {
    /// Volume name (auto-prefixed with app ID)
    pub name: String,

    /// Driver (default: "local")
    #[serde(default = "default_volume_driver")]
    pub driver: String,

    /// Driver options
    #[serde(default)]
    pub driver_opts: HashMap<String, String>,
}

fn default_volume_driver() -> String {
    "local".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// Maximum execution time in milliseconds
    pub max_execution_time_ms: u64,

    /// Maximum memory in MB
    pub max_memory_mb: u64,

    /// Allow network access?
    pub allow_network: bool,

    /// Allow file system access?
    pub allow_file_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreMetadata {
    /// Category in the app store
    pub category: String,

    /// Tags for search
    #[serde(default)]
    pub tags: Vec<String>,

    /// Screenshot URLs
    #[serde(default)]
    pub screenshots: Vec<String>,

    /// Minimum IORA version required
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_iora_version: Option<String>,

    /// Homepage URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,

    /// Source code URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,

    /// Support URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub support_url: Option<String>,

    /// License
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}

/// Network access configuration for apps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkAccessConfig {
    /// Domains that the app is allowed to access
    /// If empty and NetworkAccess permission is granted, all domains are allowed
    #[serde(default)]
    pub allowed_domains: Vec<String>,

    /// Whether user can add additional domains in app settings
    /// Requires app developer to enable this feature
    #[serde(default)]
    pub allow_user_domains: bool,

    /// Whether the app can scan the local network
    /// Requires NetworkScan permission
    #[serde(default)]
    pub allow_network_scan: bool,

    /// Whether the app can access local network IPs
    /// If specific IPs are listed, only those are allowed
    /// If empty and NetworkLocalAccess permission is granted, all local IPs are allowed
    #[serde(default)]
    pub allowed_local_ips: Vec<String>,

    /// Whether user can add additional local IPs in app settings
    #[serde(default)]
    pub allow_user_local_ips: bool,
}

/// Trust level for apps
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TrustLevel {
    /// From official app store
    Trusted,

    /// User uploaded (ZIP)
    Untrusted,

    /// Verified by admin
    Verified,
}

/// Installation source - determines Developer Mode access eligibility
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InstallationSource {
    /// From IORA App Store - CANNOT use Developer Mode
    AppStore,

    /// Manually uploaded (ZIP, direct install) - CAN use Developer Mode
    ManualUpload,

    /// Special IORA Developer App - exclusive hot-reload access
    DeveloperApp,
}

/// Developer Mode configuration in manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeveloperModeConfig {
    /// Allow this app to use Developer Mode features
    /// Only effective if installation_source = ManualUpload or DeveloperApp
    #[serde(default)]
    pub allowed: bool,

    /// Override production environment restriction
    /// If true, allows Developer Mode even when ENV=production
    /// Requires user consent during installation
    #[serde(default)]
    pub allow_in_production: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_deserialization() {
        let json = r#"{
            "id": "test-app",
            "name": "Test App",
            "version": "1.0.0",
            "developer": "IORA Team",
            "description": "Test application",
            "type": "app",
            "permissions": ["NetworkAccess"],
            "docker": {
                "auto_build": true,
                "base_image": "node:18-alpine",
                "start_cmd": "node server.js",
                "internal_ports": [
                    {"port": 3000, "protocol": "tcp"}
                ]
            }
        }"#;

        let manifest: AppManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "test-app");
        assert_eq!(manifest.app_type, AppType::App);
        assert!(manifest.docker.is_some());
    }
}
