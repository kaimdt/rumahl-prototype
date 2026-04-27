// Smart Home Context Injection Module
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const IORA_HOME_URL: &str = "http://localhost:8080";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartHomeContext {
    pub entities: Vec<EntityState>,
    pub rooms: Vec<String>,
    pub active_scenes: Vec<String>,
    pub user_preferences: HashMap<String, String>,
    pub recent_activity: Vec<ActivityEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityState {
    pub entity_id: String,
    pub state: String,
    pub attributes: serde_json::Value,
    pub last_changed: String,
    pub friendly_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub entity_id: String,
    pub event_type: String,
    pub timestamp: String,
}

pub struct ContextBuilder {
    client: reqwest::Client,
}

impl ContextBuilder {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap(),
        }
    }

    /// Fetch current smart home context from iora-home
    pub async fn fetch_context(&self) -> Result<SmartHomeContext, Box<dyn std::error::Error + Send + Sync>> {
        // Fetch entity states
        let entities = self.fetch_entities().await?;

        // Extract rooms from entities
        let rooms = self.extract_rooms(&entities);

        // Get active scenes (placeholder - would need actual implementation)
        let active_scenes = Vec::new();

        // User preferences (placeholder)
        let user_preferences = HashMap::new();

        // Recent activity (placeholder)
        let recent_activity = Vec::new();

        Ok(SmartHomeContext {
            entities,
            rooms,
            active_scenes,
            user_preferences,
            recent_activity,
        })
    }

    /// Fetch all entities from iora-home
    async fn fetch_entities(&self) -> Result<Vec<EntityState>, Box<dyn std::error::Error + Send + Sync>> {
        let response = self.client
            .get(format!("{}/api/states", IORA_HOME_URL))
            .send()
            .await?;

        if !response.status().is_success() {
            return Ok(Vec::new());
        }

        let states: Vec<serde_json::Value> = response.json().await?;

        let entities = states
            .into_iter()
            .filter_map(|state| {
                Some(EntityState {
                    entity_id: state["entity_id"].as_str()?.to_string(),
                    state: state["state"].as_str().unwrap_or("unknown").to_string(),
                    attributes: state["attributes"].clone(),
                    last_changed: state["last_changed"].as_str().unwrap_or("").to_string(),
                    friendly_name: state["attributes"]["friendly_name"]
                        .as_str()
                        .map(|s| s.to_string()),
                })
            })
            .collect();

        Ok(entities)
    }

    /// Extract unique rooms from entity attributes
    fn extract_rooms(&self, entities: &[EntityState]) -> Vec<String> {
        let mut rooms = entities
            .iter()
            .filter_map(|e| {
                e.attributes["area_id"]
                    .as_str()
                    .or_else(|| e.attributes["room"].as_str())
            })
            .map(|s| s.to_string())
            .collect::<Vec<_>>();

        rooms.sort();
        rooms.dedup();
        rooms
    }

    /// Build context-aware system prompt
    pub fn build_system_prompt(&self, context: &SmartHomeContext, base_prompt: Option<&str>) -> String {
        let base = base_prompt.unwrap_or(
            "You are IORA Assist, an AI assistant integrated into the IORA smart home system."
        );

        let mut prompt = format!("{}\n\nCurrent Smart Home Status:\n", base);

        // Add room information
        if !context.rooms.is_empty() {
            prompt.push_str(&format!("Rooms: {}\n", context.rooms.join(", ")));
        }

        // Add key entity states
        let lights: Vec<_> = context.entities
            .iter()
            .filter(|e| e.entity_id.starts_with("light."))
            .collect();

        if !lights.is_empty() {
            let on_count = lights.iter().filter(|l| l.state == "on").count();
            prompt.push_str(&format!("Lights: {} total, {} on\n", lights.len(), on_count));
        }

        let climate: Vec<_> = context.entities
            .iter()
            .filter(|e| e.entity_id.starts_with("climate."))
            .collect();

        if !climate.is_empty() {
            prompt.push_str(&format!("Climate devices: {}\n", climate.len()));
        }

        prompt.push_str("\nYou can reference these devices when answering questions or providing suggestions.");

        prompt
    }

    /// Discover available entities by category
    pub fn discover_entities(&self, context: &SmartHomeContext) -> HashMap<String, Vec<EntityState>> {
        let mut categorized = HashMap::new();

        for entity in &context.entities {
            let category = if entity.entity_id.starts_with("light.") {
                "lights"
            } else if entity.entity_id.starts_with("switch.") {
                "switches"
            } else if entity.entity_id.starts_with("climate.") {
                "climate"
            } else if entity.entity_id.starts_with("sensor.") {
                "sensors"
            } else if entity.entity_id.starts_with("binary_sensor.") {
                "binary_sensors"
            } else if entity.entity_id.starts_with("cover.") {
                "covers"
            } else if entity.entity_id.starts_with("fan.") {
                "fans"
            } else if entity.entity_id.starts_with("media_player.") {
                "media_players"
            } else if entity.entity_id.starts_with("automation.") {
                "automations"
            } else {
                "other"
            };

            categorized
                .entry(category.to_string())
                .or_insert_with(Vec::new)
                .push(entity.clone());
        }

        categorized
    }

    /// Generate automation suggestions based on entity states
    pub async fn suggest_automations(&self, context: &SmartHomeContext) -> Vec<AutomationSuggestion> {
        let mut suggestions = Vec::new();

        // Suggest motion-based lighting
        let motion_sensors: Vec<_> = context.entities
            .iter()
            .filter(|e| e.entity_id.contains("motion"))
            .collect();

        let lights_in_rooms: Vec<_> = context.entities
            .iter()
            .filter(|e| e.entity_id.starts_with("light."))
            .collect();

        if !motion_sensors.is_empty() && !lights_in_rooms.is_empty() {
            suggestions.push(AutomationSuggestion {
                title: "Motion-Activated Lighting".to_string(),
                description: "Turn on lights when motion is detected and turn them off after no motion for 5 minutes.".to_string(),
                confidence: 0.8,
                entities_involved: motion_sensors.iter().take(2).map(|e| e.entity_id.clone()).collect(),
                automation_type: "motion_lighting".to_string(),
            });
        }

        // Suggest climate automation based on time
        let climate_devices: Vec<_> = context.entities
            .iter()
            .filter(|e| e.entity_id.starts_with("climate."))
            .collect();

        if !climate_devices.is_empty() {
            suggestions.push(AutomationSuggestion {
                title: "Temperature Scheduling".to_string(),
                description: "Automatically adjust temperature based on time of day (cooler at night, warmer in morning).".to_string(),
                confidence: 0.7,
                entities_involved: climate_devices.iter().take(2).map(|e| e.entity_id.clone()).collect(),
                automation_type: "climate_schedule".to_string(),
            });
        }

        // Suggest away mode automation
        let door_sensors: Vec<_> = context.entities
            .iter()
            .filter(|e| e.entity_id.contains("door") && e.entity_id.contains("sensor"))
            .collect();

        if !door_sensors.is_empty() && !lights_in_rooms.is_empty() {
            suggestions.push(AutomationSuggestion {
                title: "Away Mode".to_string(),
                description: "When all doors are locked, turn off all lights and set climate to eco mode.".to_string(),
                confidence: 0.75,
                entities_involved: vec![],
                automation_type: "away_mode".to_string(),
            });
        }

        suggestions
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationSuggestion {
    pub title: String,
    pub description: String,
    pub confidence: f32,
    pub entities_involved: Vec<String>,
    pub automation_type: String,
}

impl Default for ContextBuilder {
    fn default() -> Self {
        Self::new()
    }
}
