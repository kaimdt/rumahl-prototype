//! Home Assistant integration module (via iora-home gateway).
//!
//! Handles communication with Home Assistant through the secure iora-home gateway:
//! - Registers desktop as a device
//! - Sends sensor updates (routed through gateway)
//! - Receives and executes commands
//! - Controls HA entities (lights, switches, etc.) via validated proxy

use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;

use crate::system_info::SystemMetrics;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaConfig {
    pub url: String,   // iora-home URL (not Home Assistant!)
    pub token: String, // JWT token from iora-home
    pub device_name: String,
    pub update_interval_secs: u64,
    pub enabled: bool,
}

impl Default for HaConfig {
    fn default() -> Self {
        Self {
            url: "http://localhost:3001".to_string(), // iora-home backend
            token: String::new(),
            device_name: "IORA Desktop".to_string(),
            update_interval_secs: 60,
            enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaCommand {
    pub command: String,
    pub parameters: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HaEntity {
    pub entity_id: String,
    pub state: String,
    pub attributes: serde_json::Value,
    pub last_changed: String,
    pub last_updated: String,
}

pub struct HaClient {
    client: Client,
    config: HaConfig,
}

impl HaClient {
    pub fn new(config: HaConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    /// Test connection to iora-home gateway
    pub async fn test_connection(&self) -> Result<bool> {
        let url = format!("{}/health", self.config.url);
        let response = self.client.get(&url).send().await?;
        Ok(response.status().is_success())
    }

    /// Send system metrics to iora-home gateway (which forwards to HA)
    pub async fn send_metrics(&self, metrics: &SystemMetrics) -> Result<()> {
        if !self.config.enabled || self.config.token.is_empty() {
            return Ok(());
        }

        let url = format!("{}/api/desktop/metrics", self.config.url);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .json(metrics)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("Failed to send metrics: {} - {}", status, error_text);
        }

        Ok(())
    }

    /// Get all Home Assistant entities (via gateway)
    pub async fn get_entities(&self) -> Result<Vec<HaEntity>> {
        let url = format!("{}/api/desktop/entities", self.config.url);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("Failed to get entities: {} - {}", status, error_text);
        }

        let entities: Vec<HaEntity> = response.json().await?;
        Ok(entities)
    }

    /// Call a Home Assistant service (via validated gateway)
    pub async fn call_service(
        &self,
        domain: &str,
        service: &str,
        entity_id: Option<String>,
        data: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<()> {
        let url = format!("{}/api/desktop/service/call", self.config.url);

        let request_body = json!({
            "domain": domain,
            "service": service,
            "entity_id": entity_id,
            "data": data,
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .json(&request_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to call service {}.{}: {} - {}",
                domain,
                service,
                status,
                error_text
            );
        }

        Ok(())
    }

    /// Convenience: Turn on a light
    pub async fn turn_on_light(&self, entity_id: &str) -> Result<()> {
        self.call_service("light", "turn_on", Some(entity_id.to_string()), None)
            .await
    }

    /// Convenience: Turn off a light
    pub async fn turn_off_light(&self, entity_id: &str) -> Result<()> {
        self.call_service("light", "turn_off", Some(entity_id.to_string()), None)
            .await
    }

    /// Convenience: Turn on a switch
    pub async fn turn_on_switch(&self, entity_id: &str) -> Result<()> {
        self.call_service("switch", "turn_on", Some(entity_id.to_string()), None)
            .await
    }

    /// Convenience: Turn off a switch
    pub async fn turn_off_switch(&self, entity_id: &str) -> Result<()> {
        self.call_service("switch", "turn_off", Some(entity_id.to_string()), None)
            .await
    }
}
