//! Persistent settings stored in the OS app-data directory.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
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
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            lm_studio_url: "http://localhost:1234".to_string(),
            lm_studio_api_key: String::new(),
            selected_model: String::new(),
            iora_backend_url: "http://localhost:8092".to_string(),
            auto_start_proxy: true,
            proxy_port: 11435,
        }
    }
}

fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("iora-desktop").join("config.json")
}

pub fn load() -> AppConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str(&content) {
                return cfg;
            }
        }
    }
    AppConfig::default()
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
