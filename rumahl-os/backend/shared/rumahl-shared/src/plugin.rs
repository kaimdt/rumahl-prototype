//! rumahl Plugin System – traits and registry for extending rumahl with plugins.
//!
//! Plugins are small code extensions that run on-demand in a sandboxed environment.
//! They do not run independently but are called when needed by the system.
//! Plugins can register APIs and widgets which are isolated from the core system.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Instant};
use tokio::sync::RwLock;

use crate::api_gateway::ApiEndpoint;
use crate::widget_registry::WidgetDefinition;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub plugin_type: PluginType,
    pub permissions: Vec<PluginPermission>,
    pub sandbox_config: SandboxConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub max_execution_time_ms: u64,
    pub max_memory_mb: u64,
    pub allow_network: bool,
    pub allow_file_system: bool,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            max_execution_time_ms: 5000, // 5 seconds
            max_memory_mb: 128,          // 128 MB
            allow_network: false,
            allow_file_system: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PluginPermission {
    ReadEntities,
    ControlEntities,
    Storage,
    Network,
    Notifications,
    SystemInfo,
    PluginManager,
    FileSystem,
    DatabaseRead,
    DatabaseWrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginExecutionResult {
    pub success: bool,
    pub duration_ms: u64,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[async_trait]
pub trait IPlugin: Send + Sync {
    fn metadata(&self) -> &PluginMetadata;

    async fn on_load(&self) -> anyhow::Result<()> {
        Ok(())
    }

    async fn on_unload(&self) -> anyhow::Result<()> {
        Ok(())
    }

    async fn on_config_changed(&self, _config: &serde_json::Value) -> anyhow::Result<()> {
        Ok(())
    }

    /// Execute plugin in sandboxed environment
    async fn execute(&self, input: serde_json::Value) -> anyhow::Result<PluginExecutionResult> {
        let start = Instant::now();

        // Default implementation - override in specific plugins
        let result = self.run_sandboxed(input).await;

        let duration = start.elapsed().as_millis() as u64;

        match result {
            Ok(output) => Ok(PluginExecutionResult {
                success: true,
                duration_ms: duration,
                output: Some(output),
                error: None,
            }),
            Err(e) => Ok(PluginExecutionResult {
                success: false,
                duration_ms: duration,
                output: None,
                error: Some(e.to_string()),
            }),
        }
    }

    /// Override this method to implement plugin logic
    async fn run_sandboxed(&self, _input: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        Ok(serde_json::json!({"status": "not_implemented"}))
    }

    /// Get API endpoints this plugin wants to register
    async fn get_api_endpoints(&self) -> Vec<ApiEndpoint> {
        Vec::new()
    }

    /// Get widgets this plugin wants to register
    async fn get_widgets(&self) -> Vec<WidgetDefinition> {
        Vec::new()
    }
}

#[async_trait]
pub trait IApiPlugin: IPlugin {
    fn route_prefix(&self) -> &str;
}

#[async_trait]
pub trait IServicePlugin: IPlugin {
    async fn run(&self) -> anyhow::Result<()>;
}

#[async_trait]
pub trait IIntegrationPlugin: IPlugin {
    async fn is_connected(&self) -> bool;
    async fn connect(&self) -> anyhow::Result<()>;
    async fn disconnect(&self) -> anyhow::Result<()>;
}

#[derive(Default)]
pub struct PluginRegistry {
    plugins: RwLock<HashMap<String, Arc<dyn IPlugin>>>,
    execution_stats: RwLock<HashMap<String, PluginStats>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginStats {
    pub total_executions: u64,
    pub successful_executions: u64,
    pub failed_executions: u64,
    pub total_duration_ms: u64,
    pub last_execution: Option<String>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register(&self, plugin: Arc<dyn IPlugin>) -> anyhow::Result<()> {
        let id = plugin.metadata().id.clone();
        let mut map = self.plugins.write().await;
        if map.contains_key(&id) {
            anyhow::bail!("Plugin '{}' is already registered", id);
        }
        plugin.on_load().await?;
        map.insert(id.clone(), plugin);

        // Initialize stats
        let mut stats = self.execution_stats.write().await;
        stats.insert(
            id,
            PluginStats {
                total_executions: 0,
                successful_executions: 0,
                failed_executions: 0,
                total_duration_ms: 0,
                last_execution: None,
            },
        );

        Ok(())
    }

    pub async fn unregister(&self, plugin_id: &str) -> anyhow::Result<()> {
        let mut map = self.plugins.write().await;
        if let Some(plugin) = map.remove(plugin_id) {
            plugin.on_unload().await?;
        }

        // Remove stats
        let mut stats = self.execution_stats.write().await;
        stats.remove(plugin_id);

        Ok(())
    }

    pub async fn get(&self, plugin_id: &str) -> Option<Arc<dyn IPlugin>> {
        self.plugins.read().await.get(plugin_id).cloned()
    }

    pub async fn list(&self) -> Vec<PluginMetadata> {
        self.plugins
            .read()
            .await
            .values()
            .map(|p| p.metadata().clone())
            .collect()
    }

    pub async fn execute(
        &self,
        plugin_id: &str,
        input: serde_json::Value,
    ) -> anyhow::Result<PluginExecutionResult> {
        let plugin = self
            .get(plugin_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", plugin_id))?;

        let result = plugin.execute(input).await?;

        // Update stats
        let mut stats = self.execution_stats.write().await;
        if let Some(plugin_stats) = stats.get_mut(plugin_id) {
            plugin_stats.total_executions += 1;
            if result.success {
                plugin_stats.successful_executions += 1;
            } else {
                plugin_stats.failed_executions += 1;
            }
            plugin_stats.total_duration_ms += result.duration_ms;
            plugin_stats.last_execution = Some(chrono::Utc::now().to_rfc3339());
        }

        Ok(result)
    }

    pub async fn get_stats(&self, plugin_id: &str) -> Option<PluginStats> {
        self.execution_stats.read().await.get(plugin_id).cloned()
    }

    pub async fn list_with_stats(&self) -> Vec<(PluginMetadata, Option<PluginStats>)> {
        let plugins = self.plugins.read().await;
        let stats = self.execution_stats.read().await;

        plugins
            .values()
            .map(|p| {
                let metadata = p.metadata().clone();
                let plugin_stats = stats.get(&metadata.id).cloned();
                (metadata, plugin_stats)
            })
            .collect()
    }
}
