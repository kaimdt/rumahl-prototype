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

/// File metadata from iora-share
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub mime_type: String,
    pub created_at: String,
    pub modified_at: String,
    pub owner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_with: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<FilePermissions>,
}

/// File permissions for sharing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePermissions {
    pub read: bool,
    pub write: bool,
    pub delete: bool,
    pub share: bool,
}

/// File upload request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileUpload {
    pub name: String,
    pub path: String,
    pub content: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Automation definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub trigger: AutomationTrigger,
    pub conditions: Vec<AutomationCondition>,
    pub actions: Vec<AutomationAction>,
}

/// Automation trigger types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AutomationTrigger {
    #[serde(rename = "state")]
    State { entity_id: String, from: Option<String>, to: Option<String> },
    #[serde(rename = "time")]
    Time { at: String },
    #[serde(rename = "event")]
    Event { event_type: String },
    #[serde(rename = "webhook")]
    Webhook { webhook_id: String },
}

/// Automation condition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AutomationCondition {
    #[serde(rename = "state")]
    State { entity_id: String, state: String },
    #[serde(rename = "numeric_state")]
    NumericState { entity_id: String, above: Option<f64>, below: Option<f64> },
    #[serde(rename = "time")]
    Time { after: Option<String>, before: Option<String> },
}

/// Automation action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AutomationAction {
    #[serde(rename = "service")]
    Service { domain: String, service: String, entity_id: String, data: serde_json::Value },
    #[serde(rename = "notification")]
    Notification { title: String, message: String },
    #[serde(rename = "delay")]
    Delay { seconds: u64 },
}

