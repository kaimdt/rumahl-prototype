//! Session restore types.
//!
//! Persists open OS windows (page, layout, geometry, z-order, minimized)
//! per user so the desktop comes back after login / page reload. The
//! frontend PUTs the complete window set (debounced) and GETs it back on
//! boot; localStorage is the offline fallback.

use serde::{Deserialize, Serialize};

/// A single persisted window. `layout` mirrors the frontend
/// `OsWindowLayout` string (`window`, `maximized`, `left`, `right`, `top`,
/// `bottom`, quarter snap variants, `split-left`, `split-right`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionWindow {
    pub page_id: String,
    #[serde(default = "default_layout")]
    pub layout: String,
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    #[serde(default = "default_width")]
    pub width: i32,
    #[serde(default = "default_height")]
    pub height: i32,
    #[serde(default)]
    pub z: i32,
    #[serde(default)]
    pub minimized: bool,
}

fn default_layout() -> String {
    "window".to_string()
}

fn default_width() -> i32 {
    880
}

fn default_height() -> i32 {
    640
}

/// Request body for replacing the user's persisted window set.
#[derive(Debug, Clone, Deserialize)]
pub struct SaveSessionWindowsRequest {
    #[serde(default)]
    pub windows: Vec<SessionWindow>,
}
