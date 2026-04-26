//! Update System for Apps and Plugins
//!
//! Allows developers to publish updates and users to update installed Apps/Plugins.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub update_url: String,
    pub changelog: String,
    pub release_date: String,
    pub is_critical: bool,
    pub min_system_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateHistory {
    pub provider_id: String,
    pub from_version: String,
    pub to_version: String,
    pub updated_at: String,
    pub success: bool,
    pub error: Option<String>,
    pub can_rollback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateChannel {
    pub name: String,
    pub description: String,
    pub stability: UpdateStability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStability {
    Stable,
    Beta,
    Alpha,
    Development,
}

/// Update System manages version updates for Apps and Plugins
#[derive(Default)]
pub struct UpdateSystem {
    update_infos: RwLock<HashMap<String, UpdateInfo>>,
    update_history: RwLock<HashMap<String, Vec<UpdateHistory>>>,
    update_channels: RwLock<HashMap<String, UpdateChannel>>,
}

impl UpdateSystem {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check for updates for a specific provider
    pub async fn check_updates(&self, provider_id: &str, _current_version: &str) -> Option<UpdateInfo> {
        self.update_infos.read().await.get(provider_id).cloned()
    }

    /// Register update information
    pub async fn register_update(&self, provider_id: String, update_info: UpdateInfo) -> anyhow::Result<()> {
        let mut infos = self.update_infos.write().await;
        infos.insert(provider_id, update_info);
        Ok(())
    }

    /// Install an update
    pub async fn install_update(
        &self,
        provider_id: &str,
        from_version: &str,
        to_version: &str,
    ) -> anyhow::Result<()> {
        // Record update attempt
        let history_entry = UpdateHistory {
            provider_id: provider_id.to_string(),
            from_version: from_version.to_string(),
            to_version: to_version.to_string(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            success: true,  // Will be updated based on actual result
            error: None,
            can_rollback: true,
        };

        let mut history = self.update_history.write().await;
        history
            .entry(provider_id.to_string())
            .or_insert_with(Vec::new)
            .push(history_entry);

        Ok(())
    }

    /// Rollback to previous version
    pub async fn rollback(&self, provider_id: &str) -> anyhow::Result<String> {
        let history = self.update_history.read().await;
        let provider_history = history.get(provider_id)
            .ok_or_else(|| anyhow::anyhow!("No update history for provider '{}'", provider_id))?;

        let last_update = provider_history.last()
            .ok_or_else(|| anyhow::anyhow!("No updates to rollback"))?;

        if !last_update.can_rollback {
            anyhow::bail!("Cannot rollback this update");
        }

        Ok(last_update.from_version.clone())
    }

    /// Get update history for a provider
    pub async fn get_history(&self, provider_id: &str) -> Vec<UpdateHistory> {
        self.update_history
            .read()
            .await
            .get(provider_id)
            .cloned()
            .unwrap_or_default()
    }

    /// List all available updates
    pub async fn list_available_updates(&self) -> Vec<(String, UpdateInfo)> {
        self.update_infos
            .read()
            .await
            .iter()
            .filter(|(_, info)| info.update_available)
            .map(|(id, info)| (id.clone(), info.clone()))
            .collect()
    }

    /// Set update channel for a provider
    pub async fn set_channel(&self, provider_id: String, channel: UpdateChannel) -> anyhow::Result<()> {
        let mut channels = self.update_channels.write().await;
        channels.insert(provider_id, channel);
        Ok(())
    }

    /// Get update channel for a provider
    pub async fn get_channel(&self, provider_id: &str) -> Option<UpdateChannel> {
        self.update_channels.read().await.get(provider_id).cloned()
    }
}
