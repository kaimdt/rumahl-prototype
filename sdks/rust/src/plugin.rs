use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::error::Result;

/// Plugin context provided to plugin methods
#[derive(Debug, Clone)]
pub struct PluginContext {
    pub plugin_id: String,
    pub config: serde_json::Value,
    pub api_base_url: String,
}

/// Plugin execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginResult {
    pub success: bool,
    pub data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Plugin trait that all rumahl plugins must implement
#[async_trait]
pub trait Plugin: Send + Sync {
    /// Get plugin metadata
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn version(&self) -> &str;

    /// Called when the plugin is loaded
    async fn on_load(&mut self, ctx: &PluginContext) -> Result<()> {
        Ok(())
    }

    /// Called when the plugin is unloaded
    async fn on_unload(&mut self) -> Result<()> {
        Ok(())
    }

    /// Called when plugin configuration changes
    async fn on_config_changed(&mut self, config: serde_json::Value) -> Result<()> {
        Ok(())
    }

    /// Execute plugin logic
    async fn execute(&self, input: serde_json::Value) -> Result<PluginResult>;

    /// Get API endpoints provided by this plugin
    async fn get_api_endpoints(&self) -> Vec<ApiEndpoint> {
        Vec::new()
    }

    /// Get widgets provided by this plugin
    async fn get_widgets(&self) -> Vec<WidgetDefinition> {
        Vec::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiEndpoint {
    pub path: String,
    pub method: String,
    pub description: String,
    pub handler: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetDefinition {
    pub id: String,
    pub name: String,
    pub component_url: String,
    pub description: String,
}

/// Helper macro to create a plugin result
#[macro_export]
macro_rules! plugin_result {
    (success: $data:expr) => {
        $crate::plugin::PluginResult {
            success: true,
            data: serde_json::json!($data),
            error: None,
        }
    };
    (error: $err:expr) => {
        $crate::plugin::PluginResult {
            success: false,
            data: serde_json::json!(null),
            error: Some($err.to_string()),
        }
    };
}
