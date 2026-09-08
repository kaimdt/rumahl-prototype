use tokio::sync::RwLock;
use tracing::info;

/// HomeKit bridge client.
/// Works via Home Assistant's HomeKit integration, tracking which
/// entities are exposed to Apple Home and their bridging status.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HomekitConfig {
    pub enabled: bool,
    pub bridge_name: String,
    pub port: u16,
}

impl Default for HomekitConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bridge_name: "rumahl Dashboard Bridge".to_string(),
            port: 21063,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HomekitAccessory {
    pub entity_id: String,
    pub name: String,
    pub accessory_type: String,
    pub state: String,
    pub reachable: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HomekitStatus {
    pub enabled: bool,
    pub config: HomekitConfig,
    pub bridge_available: bool,
    pub accessory_count: usize,
    pub accessories: Vec<HomekitAccessory>,
    pub ha_homekit_entities: usize,
}

pub struct HomekitClient {
    config: RwLock<HomekitConfig>,
    accessories: RwLock<Vec<HomekitAccessory>>,
    bridge_available: RwLock<bool>,
}

impl HomekitClient {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(HomekitConfig::default()),
            accessories: RwLock::new(Vec::new()),
            bridge_available: RwLock::new(false),
        }
    }

    pub async fn update_config(&self, config: HomekitConfig) {
        info!(
            "HomeKit: Config updated (enabled={}, bridge={})",
            config.enabled, config.bridge_name
        );
        *self.config.write().await = config;
    }

    pub async fn get_config(&self) -> HomekitConfig {
        self.config.read().await.clone()
    }

    /// Refresh accessory list from HA entity cache
    pub async fn refresh_from_entities(
        &self,
        entities: &[crate::EntityState],
        ha_has_homekit: bool,
    ) {
        *self.bridge_available.write().await = ha_has_homekit;

        let hk_entities: Vec<&crate::EntityState> = entities.iter()
            .filter(|e| {
                e.attributes.get("integration").and_then(|v| v.as_str()) == Some("homekit") ||
                e.attributes.get("source").and_then(|v| v.as_str()).map(|s| s.contains("homekit")).unwrap_or(false) ||
                // HomeKit bridge entities are tagged in attributes
                e.attributes.get("homekit_type").is_some()
            })
            .collect();

        let mut accessories = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for entity in &hk_entities {
            if seen.insert(entity.entity_id.clone()) {
                let name = entity
                    .attributes
                    .get("friendly_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&entity.entity_id)
                    .to_string();

                let accessory_type = entity
                    .attributes
                    .get("homekit_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or(entity.entity_id.split('.').next().unwrap_or("unknown"))
                    .to_string();

                accessories.push(HomekitAccessory {
                    entity_id: entity.entity_id.clone(),
                    name,
                    accessory_type,
                    state: entity.state.clone(),
                    reachable: entity.state != "unavailable",
                });
            }
        }

        *self.accessories.write().await = accessories;
    }

    pub async fn status(&self, ha_entity_count: usize) -> HomekitStatus {
        let config = self.config.read().await.clone();
        let accessories = self.accessories.read().await.clone();
        let bridge_available = *self.bridge_available.read().await;

        HomekitStatus {
            enabled: config.enabled,
            config,
            bridge_available,
            accessory_count: accessories.len(),
            accessories,
            ha_homekit_entities: ha_entity_count,
        }
    }
}
