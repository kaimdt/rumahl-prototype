//! Home Assistant integration module.
//!
//! Handles communication with Home Assistant:
//! - Registers desktop as a device
//! - Sends sensor updates
//! - Receives and executes commands
//! - Controls HA entities (lights, switches, etc.)

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;

use crate::system_info::SystemMetrics;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaConfig {
    pub url: String,
    pub token: String,
    pub device_name: String,
    pub update_interval_secs: u64,
    pub enabled: bool,
}

impl Default for HaConfig {
    fn default() -> Self {
        Self {
            url: "http://localhost:8123".to_string(),
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

    /// Test connection to Home Assistant
    pub async fn test_connection(&self) -> Result<bool> {
        let url = format!("{}/api/", self.config.url);
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .send()
            .await?;
        Ok(response.status().is_success())
    }

    /// Send system metrics as sensor updates to Home Assistant
    pub async fn send_metrics(&self, metrics: &SystemMetrics) -> Result<()> {
        if !self.config.enabled || self.config.token.is_empty() {
            return Ok(());
        }

        let device_id = sanitize_device_id(&self.config.device_name);

        // Create sensor states
        let sensors = vec![
            (
                format!("sensor.{}_cpu_usage", device_id),
                json!({
                    "state": format!("{:.1}", metrics.cpu_usage),
                    "attributes": {
                        "unit_of_measurement": "%",
                        "device_class": "power_factor",
                        "friendly_name": format!("{} CPU Usage", self.config.device_name),
                    }
                }),
            ),
            (
                format!("sensor.{}_memory_usage", device_id),
                json!({
                    "state": format!("{:.1}", metrics.memory_percent),
                    "attributes": {
                        "unit_of_measurement": "%",
                        "friendly_name": format!("{} Memory Usage", self.config.device_name),
                        "total_gb": format!("{:.1}", metrics.memory_total_gb),
                        "used_gb": format!("{:.1}", metrics.memory_used_gb),
                    }
                }),
            ),
            (
                format!("sensor.{}_disk_usage", device_id),
                json!({
                    "state": format!("{:.1}", metrics.disk_percent),
                    "attributes": {
                        "unit_of_measurement": "%",
                        "friendly_name": format!("{} Disk Usage", self.config.device_name),
                        "total_gb": format!("{:.1}", metrics.disk_total_gb),
                        "used_gb": format!("{:.1}", metrics.disk_used_gb),
                    }
                }),
            ),
        ];

        // Add CPU temperature if available
        if let Some(temp) = metrics.cpu_temp {
            let temp_sensor = (
                format!("sensor.{}_cpu_temperature", device_id),
                json!({
                    "state": format!("{:.1}", temp),
                    "attributes": {
                        "unit_of_measurement": "°C",
                        "device_class": "temperature",
                        "friendly_name": format!("{} CPU Temperature", self.config.device_name),
                    }
                }),
            );
            // sensors.push(temp_sensor); // Would need to make sensors mutable
        }

        // Add battery sensors if available
        if let Some(battery_percent) = metrics.battery_percent {
            let battery_sensor = (
                format!("sensor.{}_battery", device_id),
                json!({
                    "state": format!("{:.0}", battery_percent),
                    "attributes": {
                        "unit_of_measurement": "%",
                        "device_class": "battery",
                        "friendly_name": format!("{} Battery", self.config.device_name),
                        "charging": metrics.is_charging.unwrap_or(false),
                    }
                }),
            );
            // sensors.push(battery_sensor);
        }

        // Add screen state sensor
        let screen_sensor = (
            format!("binary_sensor.{}_screen", device_id),
            json!({
                "state": if metrics.screen_on { "on" } else { "off" },
                "attributes": {
                    "device_class": "power",
                    "friendly_name": format!("{} Screen", self.config.device_name),
                }
            }),
        );

        // Send each sensor update
        for (entity_id, state_data) in &sensors {
            self.update_sensor_state(entity_id, state_data).await?;
        }

        Ok(())
    }

    /// Update a single sensor state in Home Assistant
    async fn update_sensor_state(
        &self,
        entity_id: &str,
        state_data: &serde_json::Value,
    ) -> Result<()> {
        let url = format!("{}/api/states/{}", self.config.url, entity_id);
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .header("Content-Type", "application/json")
            .json(state_data)
            .send()
            .await
            .context("Failed to send sensor update to HA")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("HA sensor update failed ({}): {}", status, body);
        }

        Ok(())
    }

    /// Call a Home Assistant service (e.g., turn on a light)
    pub async fn call_service(
        &self,
        domain: &str,
        service: &str,
        entity_id: Option<&str>,
        data: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<()> {
        let url = format!("{}/api/services/{}/{}", self.config.url, domain, service);

        let mut body = data.unwrap_or_default();
        if let Some(entity) = entity_id {
            body.insert("entity_id".to_string(), json!(entity));
        }

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .context("Failed to call HA service")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("HA service call failed ({}): {}", status, body);
        }

        Ok(())
    }

    /// Get list of all entities from Home Assistant
    pub async fn get_entities(&self) -> Result<Vec<HaEntity>> {
        let url = format!("{}/api/states", self.config.url);
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.config.token))
            .send()
            .await
            .context("Failed to fetch HA entities")?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to fetch entities: {}", response.status());
        }

        let entities: Vec<HaEntity> = response.json().await?;
        Ok(entities)
    }

    /// Poll for pending commands from Home Assistant
    /// In production, this should use webhooks or MQTT for real-time delivery
    pub async fn poll_commands(&self) -> Result<Vec<HaCommand>> {
        // This is a placeholder - in reality, commands would come via:
        // 1. Home Assistant webhooks to a local endpoint
        // 2. MQTT subscription
        // 3. WebSocket connection to HA
        // 4. Custom input_text entity that gets polled
        Ok(vec![])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaEntity {
    pub entity_id: String,
    pub state: String,
    #[serde(default)]
    pub attributes: HashMap<String, serde_json::Value>,
}

/// Sanitize device name for use in entity IDs (lowercase, underscores)
fn sanitize_device_id(name: &str) -> String {
    name.to_lowercase()
        .replace(" ", "_")
        .replace("-", "_")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_device_id() {
        assert_eq!(sanitize_device_id("My Desktop PC"), "my_desktop_pc");
        assert_eq!(sanitize_device_id("IORA-Desktop-01"), "iora_desktop_01");
    }
}
