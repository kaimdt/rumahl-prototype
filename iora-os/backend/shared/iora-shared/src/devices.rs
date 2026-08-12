//! Device registry types (Package 3 — Devices as first-class citizens).
//!
//! The registry stores manually curated devices (gaming PC, NAS, TV,
//! printer, ...) with a MAC address for Wake-on-LAN. Auto-discovered
//! network devices live in iora-network-monitor; the registry adds the
//! human layer on top.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A curated device in the registry.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceRegistryEntry {
    pub id: String,
    pub name: String,
    /// `computer` | `nas` | `tv` | `printer` | `phone` | `tablet` | `other`.
    pub device_type: String,
    /// MAC address used for Wake-on-LAN (e.g. `AA:BB:CC:DD:EE:FF`).
    pub mac_address: Option<String>,
    pub ip_address: Option<String>,
    /// Whether the Wake button is offered for this device.
    pub wake_enabled: bool,
    pub notes: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

/// Request body for creating a registry device.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateDeviceRequest {
    pub name: String,
    #[serde(default = "default_device_type")]
    pub device_type: String,
    #[serde(default)]
    pub mac_address: Option<String>,
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default = "default_true")]
    pub wake_enabled: bool,
    #[serde(default)]
    pub notes: String,
}

/// Request body for updating a registry device (all fields optional).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateDeviceRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub device_type: Option<String>,
    #[serde(default)]
    pub mac_address: Option<String>,
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default)]
    pub wake_enabled: Option<bool>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn default_device_type() -> String {
    "computer".to_string()
}

fn default_true() -> bool {
    true
}

/// Supported device types for validation.
pub const DEVICE_TYPES: [&str; 7] = [
    "computer", "nas", "tv", "printer", "phone", "tablet", "other",
];
