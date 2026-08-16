//! Shared contracts for the ORA visual automation engine.
//!
//! An automation is stored as an ordered flow: one or more triggers start the
//! flow, every condition must pass, and actions run in order. The JSON shape is
//! intentionally extensible so device, job, file, schedule and app adapters can
//! add payload fields without changing the transport contract.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AutomationNodeKind {
    Trigger,
    Condition,
    Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationNode {
    pub id: String,
    pub kind: AutomationNodeKind,
    /// Adapter identifier such as `manual`, `schedule`, `device_state`,
    /// `home_assistant_service`, `notification`, `job`, or `script`.
    pub adapter: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub position: AutomationNodePosition,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AutomationNodePosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationEdge {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationFlow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub nodes: Vec<AutomationNode>,
    #[serde(default)]
    pub edges: Vec<AutomationEdge>,
    #[serde(default = "default_cooldown_seconds")]
    pub cooldown_seconds: i64,
    pub last_triggered_at: Option<DateTime<Utc>>,
    pub trigger_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveAutomationFlowRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub nodes: Vec<AutomationNode>,
    #[serde(default)]
    pub edges: Vec<AutomationEdge>,
    #[serde(default = "default_cooldown_seconds")]
    pub cooldown_seconds: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunAutomationRequest {
    #[serde(default)]
    pub trigger_data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationExecution {
    pub id: i64,
    pub rule_id: String,
    pub triggered_by: String,
    pub trigger_data: Value,
    pub success: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub executed_at: DateTime<Utc>,
}

pub fn default_enabled() -> bool {
    true
}
pub fn default_cooldown_seconds() -> i64 {
    0
}
