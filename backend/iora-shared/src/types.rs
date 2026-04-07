//! Shared types used across the IORA ecosystem.

use serde::{Deserialize, Serialize};

/// The state of a smart-home entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityState {
    pub entity_id: String,
    pub state: String,
    pub attributes: serde_json::Value,
    pub last_changed: String,
    pub last_updated: String,
}

/// A generic event broadcast within the IORA system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IoraEvent {
    pub event_type: String,
    pub source: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

/// Health status reported by any IORA program.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealth {
    pub service: String,
    pub status: HealthStatus,
    pub message: Option<String>,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}
