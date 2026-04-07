//! IORA Plugin System – traits and registry for extending IORA with plugins.

use std::{collections::HashMap, sync::Arc};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub plugin_type: PluginType,
    pub permissions: Vec<PluginPermission>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PluginType {
    Widget,
    Service,
    Api,
    Integration,
    Theme,
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
        map.insert(id, plugin);
        Ok(())
    }

    pub async fn unregister(&self, plugin_id: &str) -> anyhow::Result<()> {
        let mut map = self.plugins.write().await;
        if let Some(plugin) = map.remove(plugin_id) {
            plugin.on_unload().await?;
        }
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
}
