use serde::{Deserialize, Serialize};
use crate::permissions::Permission;
use std::collections::HashMap;

/// App manifest builder
pub struct ManifestBuilder {
    manifest: AppManifest,
}

impl ManifestBuilder {
    /// Create a new manifest builder
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            manifest: AppManifest {
                id: id.into(),
                name: name.into(),
                version: "1.0.0".to_string(),
                developer: String::new(),
                description: String::new(),
                app_type: AppType::App,
                plugin_type: None,
                permissions: Vec::new(),
                icon: None,
                docker: None,
                sandbox: None,
                endpoints: Vec::new(),
                widgets: Vec::new(),
                custom_pages: Vec::new(),
                settings_schema: None,
                network_access: None,
                store_metadata: None,
            },
        }
    }

    /// Set the version
    pub fn version(mut self, version: impl Into<String>) -> Self {
        self.manifest.version = version.into();
        self
    }

    /// Set the developer
    pub fn developer(mut self, developer: impl Into<String>) -> Self {
        self.manifest.developer = developer.into();
        self
    }

    /// Set the description
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.manifest.description = description.into();
        self
    }

    /// Set as a plugin
    pub fn plugin(mut self, plugin_type: PluginType) -> Self {
        self.manifest.app_type = AppType::Plugin;
        self.manifest.plugin_type = Some(plugin_type);
        self
    }

    /// Add a permission
    pub fn permission(mut self, permission: Permission) -> Self {
        self.manifest.permissions.push(permission);
        self
    }

    /// Add multiple permissions
    pub fn permissions(mut self, permissions: Vec<Permission>) -> Self {
        self.manifest.permissions.extend(permissions);
        self
    }

    /// Set Docker configuration
    pub fn docker(mut self, docker: DockerConfig) -> Self {
        self.manifest.docker = Some(docker);
        self
    }

    /// Add a custom page
    pub fn custom_page(mut self, page: CustomPage) -> Self {
        self.manifest.custom_pages.push(page);
        self
    }

    /// Set network access configuration
    pub fn network_access(mut self, config: NetworkAccessConfig) -> Self {
        self.manifest.network_access = Some(config);
        self
    }

    /// Build the manifest
    pub fn build(self) -> AppManifest {
        self.manifest
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub developer: String,
    pub description: String,
    #[serde(rename = "type")]
    pub app_type: AppType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_type: Option<PluginType>,
    pub permissions: Vec<Permission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docker: Option<DockerConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxConfig>,
    #[serde(default)]
    pub endpoints: Vec<ApiEndpoint>,
    #[serde(default)]
    pub widgets: Vec<WidgetDefinition>,
    #[serde(default)]
    pub custom_pages: Vec<CustomPage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_schema: Option<SettingsSchema>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_access: Option<NetworkAccessConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_metadata: Option<StoreMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppType {
    App,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
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
pub struct DockerConfig {
    pub auto_build: bool,
    pub base_image: String,
    pub working_dir: String,
    pub install_cmd: String,
    pub start_cmd: String,
    pub internal_ports: Vec<PortConfig>,
    #[serde(default)]
    pub environment: HashMap<String, String>,
    #[serde(default)]
    pub volumes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_check: Option<HealthCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortConfig {
    pub port: u16,
    pub protocol: String,
    pub assignment_mode: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    pub endpoint: String,
    pub interval: u32,
    pub timeout: u32,
    pub retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub max_execution_time_ms: u64,
    pub max_memory_mb: u64,
    pub allow_network: bool,
    pub allow_file_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiEndpoint {
    pub path: String,
    pub method: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetDefinition {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub widget_type: String,
    pub component_url: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPage {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub url: String,
    #[serde(default = "default_true")]
    pub show_in_nav: bool,
    #[serde(default)]
    pub order: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_page_id: Option<String>,
    #[serde(default)]
    pub iframe: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iframe_config: Option<IframeConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IframeConfig {
    pub sandbox: Vec<String>,
    pub allow: Vec<String>,
    pub security_token: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsSchema {
    pub title: String,
    pub description: String,
    pub fields: Vec<SettingsField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsField {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkAccessConfig {
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub allow_user_domains: bool,
    #[serde(default)]
    pub allowed_local_ips: Vec<String>,
    #[serde(default)]
    pub allow_user_local_ips: bool,
    #[serde(default)]
    pub allow_network_scan: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreMetadata {
    pub category: String,
    pub tags: Vec<String>,
    pub screenshots: Vec<String>,
    pub homepage: Option<String>,
}

fn default_true() -> bool {
    true
}
