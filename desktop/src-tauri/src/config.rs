//! Persistent settings stored in the OS app-data directory.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

fn default_iora_home_url() -> String {
    "http://localhost:8080".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Unique identifier for this desktop client instance (used for multi-client routing)
    pub client_id: String,
    /// Human-readable name for this client (shown in iora-assist client list)
    pub client_name: String,
    /// LM Studio base URL (OpenAI-compatible endpoint)
    pub lm_studio_url: String,
    /// Optional LM Studio API key (most local instances don't require one)
    pub lm_studio_api_key: String,
    /// Currently selected model identifier
    pub selected_model: String,
    /// IORA backend URL (iora-assist listens here)
    pub iora_backend_url: String,
    /// Whether to start the proxy server when the desktop client starts
    pub auto_start_proxy: bool,
    /// Local port for the IORA→LM Studio proxy
    pub proxy_port: u16,
    /// Poll interval in seconds to check LM Studio availability
    pub health_poll_interval_secs: u64,
    /// IORA Home URL (iora-home backend)
    #[serde(default = "default_iora_home_url")]
    pub iora_home_url: String,
    /// JWT auth token (empty = not logged in)
    #[serde(default)]
    pub auth_token: String,
    /// Username for display
    #[serde(default)]
    pub auth_username: String,
    /// User ID
    #[serde(default)]
    pub auth_user_id: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            client_id: Uuid::new_v4().to_string(),
            client_name: hostname(),
            lm_studio_url: "http://localhost:1234".to_string(),
            lm_studio_api_key: String::new(),
            selected_model: String::new(),
            iora_backend_url: "http://localhost:8092".to_string(),
            auto_start_proxy: true,
            proxy_port: 11435,
            health_poll_interval_secs: 30,
            iora_home_url: default_iora_home_url(),
            auth_token: String::new(),
            auth_username: String::new(),
            auth_user_id: String::new(),
        }
    }
}

/// Returns the machine hostname as a default client name, falling back to "IORA Desktop".
fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "IORA Desktop".to_string())
}

fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("iora-desktop").join("config.json")
}

pub fn load() -> AppConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(&content) {
                // Ensure every existing config file gets a client_id if it was saved before this field existed
                if cfg.client_id.is_empty() {
                    cfg.client_id = Uuid::new_v4().to_string();
                    let _ = save(&cfg);
                }
                return cfg;
            }
        }
    }
    let cfg = AppConfig::default();
    // Persist immediately so the client_id is stable across restarts
    let _ = save(&cfg);
    cfg
}

pub fn save(cfg: &AppConfig) -> Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(cfg)?;
    std::fs::write(path, content)?;
    Ok(())
}
