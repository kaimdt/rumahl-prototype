use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

/// Z-Wave protocol client.
/// Works via Home Assistant's Z-Wave JS integration and can be extended
/// with direct Z-Wave JS WebSocket connection in the future.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZwaveConfig {
    pub enabled: bool,
    /// Z-Wave JS WebSocket URL (for future direct integration)
    pub zwave_js_url: Option<String>,
}

impl Default for ZwaveConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            zwave_js_url: None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ZwaveNode {
    pub node_id: u32,
    pub name: String,
    pub device_type: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub is_secure: bool,
    pub is_routing: bool,
    pub is_beaming: bool,
    pub status: String,
    pub reachable: bool,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ZwaveNetwork {
    pub home_id: Option<String>,
    pub controller: Option<String>,
    pub sdk_version: Option<String>,
    pub node_count: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ZwaveStatus {
    pub enabled: bool,
    pub config: ZwaveConfig,
    pub node_count: usize,
    pub nodes: Vec<ZwaveNode>,
    pub network: ZwaveNetwork,
    pub ha_zwave_entities: usize,
}

pub struct ZwaveClient {
    config: RwLock<ZwaveConfig>,
    nodes: RwLock<Vec<ZwaveNode>>,
    network: RwLock<ZwaveNetwork>,
}

impl ZwaveClient {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(ZwaveConfig::default()),
            nodes: RwLock::new(Vec::new()),
            network: RwLock::new(ZwaveNetwork {
                home_id: None,
                controller: None,
                sdk_version: None,
                node_count: 0,
            }),
        }
    }

    pub async fn update_config(&self, config: ZwaveConfig) {
        info!("Z-Wave: Config updated (enabled={})", config.enabled);
        *self.config.write().await = config;
    }

    pub async fn get_config(&self) -> ZwaveConfig {
        self.config.read().await.clone()
    }

    /// Refresh node list from HA entity cache
    pub async fn refresh_from_entities(&self, entities: &[crate::EntityState]) {
        let zwave_entities: Vec<&crate::EntityState> = entities.iter()
            .filter(|e| {
                e.attributes.get("integration").and_then(|v| v.as_str()) == Some("zwave_js") ||
                e.attributes.get("source").and_then(|v| v.as_str()).map(|s| s.contains("zwave")).unwrap_or(false) ||
                e.entity_id.contains("zwave")
            })
            .collect();

        let mut nodes = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for entity in &zwave_entities {
            let node_name = entity.attributes.get("friendly_name")
                .and_then(|v| v.as_str())
                .unwrap_or(&entity.entity_id)
                .to_string();

            let node_id_attr = entity.attributes.get("node_id")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;

            let device_id = entity.attributes.get("device_id")
                .and_then(|v| v.as_str())
                .unwrap_or(&entity.entity_id)
                .to_string();

            if seen.insert(device_id.clone()) {
                nodes.push(ZwaveNode {
                    node_id: node_id_attr,
                    name: node_name,
                    device_type: entity.entity_id.split('.').next().unwrap_or("unknown").to_string(),
                    manufacturer: entity.attributes.get("manufacturer").and_then(|v| v.as_str()).map(String::from),
                    product: entity.attributes.get("model").and_then(|v| v.as_str()).map(String::from),
                    is_secure: entity.attributes.get("is_secure").and_then(|v| v.as_bool()).unwrap_or(false),
                    is_routing: entity.attributes.get("is_routing").and_then(|v| v.as_bool()).unwrap_or(false),
                    is_beaming: entity.attributes.get("is_beaming").and_then(|v| v.as_bool()).unwrap_or(false),
                    status: entity.state.clone(),
                    reachable: entity.state != "unavailable" && entity.state != "dead",
                    last_seen: Some(entity.last_updated.clone()),
                });
            }
        }

        let count = nodes.len();
        *self.nodes.write().await = nodes;
        self.network.write().await.node_count = count;
    }

    pub async fn status(&self, ha_entity_count: usize) -> ZwaveStatus {
        let config = self.config.read().await.clone();
        let nodes = self.nodes.read().await.clone();
        let network = self.network.read().await.clone();

        ZwaveStatus {
            enabled: config.enabled,
            config,
            node_count: nodes.len(),
            nodes,
            network,
            ha_zwave_entities: ha_entity_count,
        }
    }
}
