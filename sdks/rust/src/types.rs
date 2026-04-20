use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub entity_id: String,
    pub state: String,
    pub attributes: HashMap<String, serde_json::Value>,
    pub last_changed: Option<String>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceCall {
    pub domain: String,
    pub service: String,
    pub entity_id: String,
    pub service_data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub app_id: String,
    pub settings: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPayload {
    pub title: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub healthy: bool,
    pub message: Option<String>,
    pub details: Option<HashMap<String, serde_json::Value>>,
}
