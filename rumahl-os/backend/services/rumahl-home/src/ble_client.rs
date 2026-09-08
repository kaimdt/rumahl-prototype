use tokio::sync::RwLock;
use tracing::info;

/// Bluetooth / BLE protocol client.
/// Works via Home Assistant's Bluetooth integration, detecting
/// BLE-based entities and tracking proximity/signal data.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BleConfig {
    pub enabled: bool,
}

impl Default for BleConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BleDevice {
    pub address: String,
    pub name: String,
    pub device_type: String,
    pub rssi: Option<i32>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub battery: Option<f32>,
    pub reachable: bool,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BleAdapter {
    pub name: String,
    pub address: String,
    pub powered: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BleStatus {
    pub enabled: bool,
    pub config: BleConfig,
    pub device_count: usize,
    pub devices: Vec<BleDevice>,
    pub adapters: Vec<BleAdapter>,
    pub ha_ble_entities: usize,
}

pub struct BleClient {
    config: RwLock<BleConfig>,
    devices: RwLock<Vec<BleDevice>>,
    adapters: RwLock<Vec<BleAdapter>>,
}

impl BleClient {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(BleConfig::default()),
            devices: RwLock::new(Vec::new()),
            adapters: RwLock::new(Vec::new()),
        }
    }

    pub async fn update_config(&self, config: BleConfig) {
        info!("BLE: Config updated (enabled={})", config.enabled);
        *self.config.write().await = config;
    }

    pub async fn get_config(&self) -> BleConfig {
        self.config.read().await.clone()
    }

    /// Refresh device list from HA entity cache
    pub async fn refresh_from_entities(&self, entities: &[crate::EntityState]) {
        let ble_entities: Vec<&crate::EntityState> = entities
            .iter()
            .filter(|e| {
                e.attributes
                    .get("integration")
                    .and_then(|v| v.as_str())
                    .map(|s| {
                        s == "bluetooth"
                            || s == "ble_monitor"
                            || s == "xiaomi_ble"
                            || s == "switchbot"
                            || s == "govee_ble"
                            || s == "ibeacon"
                    })
                    .unwrap_or(false)
                    || e.attributes
                        .get("source")
                        .and_then(|v| v.as_str())
                        .map(|s| s.contains("bluetooth") || s.contains("ble"))
                        .unwrap_or(false)
                    || e.entity_id.contains("ble_")
                    || e.entity_id.contains("bluetooth")
            })
            .collect();

        let mut devices = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for entity in &ble_entities {
            let device_id = entity
                .attributes
                .get("device_id")
                .or_else(|| entity.attributes.get("mac"))
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

                devices.push(BleDevice {
                    address: device_id,
                    name,
                    device_type: entity
                        .entity_id
                        .split('.')
                        .next()
                        .unwrap_or("unknown")
                        .to_string(),
                    rssi: entity
                        .attributes
                        .get("rssi")
                        .and_then(|v| v.as_i64())
                        .map(|v| v as i32),
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

        *self.devices.write().await = devices;
    }

    pub async fn status(&self, ha_ble_entity_count: usize) -> BleStatus {
        let config = self.config.read().await.clone();
        let devices = self.devices.read().await.clone();
        let adapters = self.adapters.read().await.clone();

        BleStatus {
            enabled: config.enabled,
            config,
            device_count: devices.len(),
            devices,
            adapters,
            ha_ble_entities: ha_ble_entity_count,
        }
    }
}
