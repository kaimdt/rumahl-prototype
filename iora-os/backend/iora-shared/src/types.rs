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

// ── iora-files types ────────────────────────────────────────────────

/// Metadata for a shared file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub owner: String,
    pub is_folder: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// A public share link for a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareLink {
    pub id: String,
    pub file_id: String,
    pub token: String,
    pub expires_at: Option<String>,
    pub password_protected: bool,
    pub max_downloads: Option<i64>,
    pub download_count: i64,
}

// ── iora-connector types ────────────────────────────────────────────

/// VPN tunnel state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelInfo {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub public_key: String,
    pub status: TunnelStatus,
    pub last_handshake: Option<String>,
    pub transfer_rx: i64,
    pub transfer_tx: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    Active,
    Disconnected,
    Error,
}

/// A service exposed publicly through the connector.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExposedService {
    pub id: String,
    pub tunnel_id: String,
    pub name: String,
    pub public_domain: String,
    pub local_target: String,
    pub enabled: bool,
    pub require_auth: bool,
}

// ── iora-api types ──────────────────────────────────────────────────

/// REST v2 paginated response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

/// Batch operation request for REST v2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchRequest {
    pub operations: Vec<BatchOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchOperation {
    pub method: String,
    pub path: String,
    pub body: Option<serde_json::Value>,
}
