use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

/// Configuration for Matter protocol bridge
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MatterConfig {
    pub enabled: bool,
    pub commission_port: u16,
    pub discriminator: u16,
    pub passcode: u32,
}

impl Default for MatterConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            commission_port: 5540,
            discriminator: 3840,
            passcode: 20202021,
        }
    }
}

/// A Matter device discovered or commissioned
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MatterDevice {
    pub node_id: String,
    pub name: String,
    pub device_type: String,
    pub vendor: Option<String>,
    pub model: Option<String>,
    pub endpoint_count: u32,
    pub reachable: bool,
    pub last_seen: Option<String>,
}

/// Status of the Matter protocol bridge
#[derive(Debug, Clone, serde::Serialize)]
pub struct MatterStatus {
    pub enabled: bool,
    pub config: MatterConfig,
    pub device_count: usize,
    pub devices: Vec<MatterDevice>,
    pub ha_matter_entities: usize,
    pub fabrics: Vec<MatterFabric>,
}

/// A Matter fabric (network)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MatterFabric {
    pub fabric_id: String,
    pub label: String,
    pub vendor_id: u16,
    pub node_count: usize,
}

/// Matter client / bridge manager
/// Currently works via Home Assistant's Matter integration and can be
/// extended with direct Matter SDK integration in the future.
pub struct MatterClient {
    config: RwLock<MatterConfig>,
    devices: RwLock<Vec<MatterDevice>>,
    fabrics: RwLock<Vec<MatterFabric>>,
}

impl MatterClient {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(MatterConfig::default()),
            devices: RwLock::new(Vec::new()),
            fabrics: RwLock::new(Vec::new()),
        }
    }

    /// Initialize with saved config
    pub async fn init(&self, config: MatterConfig) {
        *self.config.write().await = config;
        info!(
            "Matter: Initialized (enabled={})",
            self.config.read().await.enabled
        );
    }

    /// Update configuration
    pub async fn update_config(&self, config: MatterConfig) {
        info!("Matter: Config updated (enabled={})", config.enabled);
        *self.config.write().await = config;
    }

    /// Refresh device list from Home Assistant entity cache
    pub async fn refresh_from_entities(self: &Arc<Self>, entities: &[crate::EntityState]) {
        let matter_entities: Vec<&crate::EntityState> = entities
            .iter()
            .filter(|e| {
                e.entity_id.contains("matter")
                    || e.attributes.get("integration").and_then(|v| v.as_str()) == Some("matter")
                    || e.attributes
                        .get("source")
                        .and_then(|v| v.as_str())
                        .map(|s| s.contains("matter"))
                        .unwrap_or(false)
            })
            .collect();

        let mut devices = Vec::new();
        let mut seen_devices = std::collections::HashSet::new();

        for entity in &matter_entities {
            // Try to extract device info from attributes
            let device_name = entity
                .attributes
                .get("friendly_name")
                .and_then(|v| v.as_str())
                .unwrap_or(&entity.entity_id)
                .to_string();

            let device_id = entity
                .attributes
                .get("device_id")
                .and_then(|v| v.as_str())
                .unwrap_or(&entity.entity_id)
                .to_string();

            if seen_devices.insert(device_id.clone()) {
                let device_type = entity
                    .entity_id
                    .split('.')
                    .next()
                    .unwrap_or("unknown")
                    .to_string();
                devices.push(MatterDevice {
                    node_id: device_id,
                    name: device_name,
                    device_type,
                    vendor: entity
                        .attributes
                        .get("manufacturer")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    model: entity
                        .attributes
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    endpoint_count: 1,
                    reachable: entity.state != "unavailable",
                    last_seen: Some(entity.last_updated.clone()),
                });
            }
        }

        *self.devices.write().await = devices;
    }

    /// Get current status
    pub async fn status(&self, ha_matter_entity_count: usize) -> MatterStatus {
        let config = self.config.read().await.clone();
        let devices = self.devices.read().await.clone();
        let fabrics = self.fabrics.read().await.clone();

        MatterStatus {
            enabled: config.enabled,
            config,
            device_count: devices.len(),
            devices,
            ha_matter_entities: ha_matter_entity_count,
            fabrics,
        }
    }

    /// Get config
    pub async fn get_config(&self) -> MatterConfig {
        self.config.read().await.clone()
    }
}
