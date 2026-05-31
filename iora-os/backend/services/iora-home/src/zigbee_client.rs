use tokio::sync::RwLock;
use tracing::info;

/// Zigbee protocol client.
/// Works via two modes:
/// 1. Zigbee2MQTT (subscribes to zigbee2mqtt/# topics via MQTT client)
/// 2. ZHA (via HA entity cache, filtering for ZHA entities)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum ZigbeeMode {
    Zigbee2Mqtt,
    Zha,
    Auto,
}

impl Default for ZigbeeMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZigbeeConfig {
    pub mode: ZigbeeMode,
    pub zigbee2mqtt_topic: String,
    pub enabled: bool,
}

impl Default for ZigbeeConfig {
    fn default() -> Self {
        Self {
            mode: ZigbeeMode::Auto,
            zigbee2mqtt_topic: "zigbee2mqtt".to_string(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ZigbeeDevice {
    pub ieee_address: String,
    pub friendly_name: String,
    pub device_type: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub power_source: Option<String>,
    pub lqi: Option<u32>,
    pub battery: Option<f32>,
    pub reachable: bool,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ZigbeeNetwork {
    pub coordinator: Option<String>,
    pub channel: Option<u32>,
    pub pan_id: Option<String>,
    pub permit_join: bool,
    pub device_count: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ZigbeeStatus {
    pub enabled: bool,
    pub mode: ZigbeeMode,
    pub detected_mode: Option<ZigbeeMode>,
    pub config: ZigbeeConfig,
    pub device_count: usize,
    pub devices: Vec<ZigbeeDevice>,
    pub network: ZigbeeNetwork,
}

pub struct ZigbeeClient {
    config: RwLock<ZigbeeConfig>,
    devices: RwLock<Vec<ZigbeeDevice>>,
    network: RwLock<ZigbeeNetwork>,
    detected_mode: RwLock<Option<ZigbeeMode>>,
}

impl ZigbeeClient {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(ZigbeeConfig::default()),
            devices: RwLock::new(Vec::new()),
            network: RwLock::new(ZigbeeNetwork {
                coordinator: None,
                channel: None,
                pan_id: None,
                permit_join: false,
                device_count: 0,
            }),
            detected_mode: RwLock::new(None),
        }
    }

    pub async fn update_config(&self, config: ZigbeeConfig) {
        info!(
            "Zigbee: Config updated (mode={:?}, enabled={})",
            config.mode, config.enabled
        );
        *self.config.write().await = config;
    }

    pub async fn get_config(&self) -> ZigbeeConfig {
        self.config.read().await.clone()
    }

    /// Refresh device list from HA entity cache and detect which Zigbee integration is active
    pub async fn refresh_from_entities(
        &self,
        entities: &[crate::EntityState],
        ha_integrations: &[String],
    ) {
        // Detect mode
        let has_z2m = ha_integrations
            .iter()
            .any(|i| i == "mqtt" || i == "zigbee2mqtt");
        let has_zha = ha_integrations.iter().any(|i| i == "zha");

        let detected = if has_z2m && !has_zha {
            Some(ZigbeeMode::Zigbee2Mqtt)
        } else if has_zha && !has_z2m {
            Some(ZigbeeMode::Zha)
        } else if has_z2m && has_zha {
            Some(ZigbeeMode::Auto)
        } else {
            None
        };
        *self.detected_mode.write().await = detected;

        // Find Zigbee entities
        let zigbee_entities: Vec<&crate::EntityState> = entities.iter()
            .filter(|e| {
                // ZHA entities
                e.attributes.get("integration").and_then(|v| v.as_str()) == Some("zha") ||
                e.attributes.get("source").and_then(|v| v.as_str()).map(|s| s.contains("zha")).unwrap_or(false) ||
                // Zigbee2MQTT entities (tagged via MQTT)
                e.attributes.get("source").and_then(|v| v.as_str()).map(|s| s.contains("zigbee2mqtt")).unwrap_or(false) ||
                e.entity_id.contains("zigbee")
            })
            .collect();

        let mut devices = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for entity in &zigbee_entities {
            let device_id = entity
                .attributes
                .get("device_id")
                .or_else(|| entity.attributes.get("ieee"))
                .and_then(|v| v.as_str())
                .unwrap_or(&entity.entity_id)
                .to_string();

            if seen.insert(device_id.clone()) {
                let name = entity
                    .attributes
                    .get("friendly_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&entity.entity_id)
                    .to_string();

                devices.push(ZigbeeDevice {
                    ieee_address: device_id,
                    friendly_name: name,
                    device_type: entity
                        .entity_id
                        .split('.')
                        .next()
                        .unwrap_or("unknown")
                        .to_string(),
                    manufacturer: entity
                        .attributes
                        .get("manufacturer")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    model: entity
                        .attributes
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    power_source: entity
                        .attributes
                        .get("power_source")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    lqi: entity
                        .attributes
                        .get("lqi")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                    battery: entity
                        .attributes
                        .get("battery")
                        .and_then(|v| v.as_f64())
                        .map(|v| v as f32),
                    reachable: entity.state != "unavailable",
                    last_seen: Some(entity.last_updated.clone()),
                });
            }
        }

        let device_count = devices.len();
        *self.devices.write().await = devices;

        let mut net = self.network.write().await;
        net.device_count = device_count;
    }

    /// Refresh from Zigbee2MQTT bridge state (via MQTT messages)
    pub async fn refresh_from_z2m_data(
        &self,
        bridge_info: Option<&str>,
        devices_json: Option<&str>,
    ) {
        if let Some(info) = bridge_info {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(info) {
                let mut net = self.network.write().await;
                net.coordinator = parsed
                    .get("coordinator")
                    .and_then(|c| c.get("type"))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                if let Some(config) = parsed.get("config").and_then(|c| c.get("advanced")) {
                    net.channel = config
                        .get("channel")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32);
                    net.pan_id = config
                        .get("pan_id")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
                net.permit_join = parsed
                    .get("permit_join")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
            }
        }

        if let Some(devs) = devices_json {
            if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(devs) {
                let mut devices = Vec::new();
                for d in &parsed {
                    if d.get("type").and_then(|v| v.as_str()) == Some("Coordinator") {
                        continue;
                    }
                    devices.push(ZigbeeDevice {
                        ieee_address: d
                            .get("ieee_address")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        friendly_name: d
                            .get("friendly_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown")
                            .to_string(),
                        device_type: d
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string(),
                        manufacturer: d
                            .get("manufacturer")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        model: d.get("model_id").and_then(|v| v.as_str()).map(String::from),
                        power_source: d
                            .get("power_source")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        lqi: d.get("lqi").and_then(|v| v.as_u64()).map(|v| v as u32),
                        battery: None,
                        reachable: d.get("supported").and_then(|v| v.as_bool()).unwrap_or(true),
                        last_seen: d
                            .get("last_seen")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    });
                }
                let count = devices.len();
                *self.devices.write().await = devices;
                self.network.write().await.device_count = count;
            }
        }
    }

    pub async fn status(&self) -> ZigbeeStatus {
        let config = self.config.read().await.clone();
        let devices = self.devices.read().await.clone();
        let network = self.network.read().await.clone();
        let detected_mode = self.detected_mode.read().await.clone();

        ZigbeeStatus {
            enabled: config.enabled,
            mode: config.mode.clone(),
            detected_mode,
            config,
            device_count: devices.len(),
            devices,
            network,
        }
    }
}
