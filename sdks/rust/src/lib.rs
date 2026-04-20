//! # IORA SDK for Rust
//!
//! Official Rust SDK for developing IORA apps and plugins.
//!
//! ## Features
//!
//! - Type-safe API client for IORA services
//! - Plugin trait implementations
//! - App manifest builder
//! - Permission management helpers
//! - Widget development tools
//! - Network access helpers
//!
//! ## Example
//!
//! ```rust
//! use iora_sdk::{IoraClient, Permission};
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     let client = IoraClient::new("http://localhost:8080")
//!         .with_api_key("your-api-key");
//!
//!     // Get all entities
//!     let entities = client.entities().list().await?;
//!
//!     // Control a light
//!     client.entities()
//!         .call_service("light", "turn_on", "light.living_room", serde_json::json!({
//!             "brightness": 255
//!         }))
//!         .await?;
//!
//!     Ok(())
//! }
//! ```

pub mod client;
pub mod manifest;
pub mod permissions;
pub mod plugin;
pub mod widget;
pub mod error;
pub mod types;

pub use client::IoraClient;
pub use manifest::{ManifestBuilder, AppManifest, PluginType};
pub use permissions::Permission;
pub use plugin::{Plugin, PluginContext, PluginResult};
pub use widget::{Widget, WidgetConfig};
pub use error::{IoraError, Result};
pub use types::*;

/// SDK version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Prelude module for common imports
pub mod prelude {
    pub use crate::client::IoraClient;
    pub use crate::manifest::{ManifestBuilder, AppManifest};
    pub use crate::permissions::Permission;
    pub use crate::plugin::{Plugin, PluginContext, PluginResult};
    pub use crate::widget::{Widget, WidgetConfig};
    pub use crate::error::{IoraError, Result};
    pub use async_trait::async_trait;
    pub use serde::{Deserialize, Serialize};
    pub use serde_json::{json, Value};
}
