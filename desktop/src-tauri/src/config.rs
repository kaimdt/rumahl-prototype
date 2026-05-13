//! Persistent settings stored in the OS app-data directory.

use anyhow::Result;
use crate::network_detection::NetworkType;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

fn default_iora_home_url() -> String {
    env!("IORA_HOME_URL_DEFAULT").to_string()
}

fn default_ha_update_interval() -> u64 {
    env!("HA_UPDATE_INTERVAL_DEFAULT").parse().unwrap_or(60)
}

fn default_screen_saver_timeout() -> u64 {
    300
}

fn default_true() -> bool {
    true
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
    /// Home Assistant integration enabled (via iora-home gateway)
    #[serde(default)]
    pub ha_enabled: bool,
    /// JWT token for iora-home authentication (used for HA integration)
    #[serde(default)]
    pub ha_token: String,
    /// Update interval for sending metrics to HA (seconds)
    #[serde(default = "default_ha_update_interval")]
    pub ha_update_interval_secs: u64,
    /// Start on system boot
    #[serde(default)]
    pub autostart_enabled: bool,
    /// Start minimized to tray
    #[serde(default)]
    pub autostart_minimized: bool,
    /// Start hidden (tray only, no window)
    #[serde(default = "default_true")]
    pub autostart_hidden: bool,
    /// Notification sound enabled
    #[serde(default = "default_true")]
    pub notification_sound: bool,
    /// Desktop notifications enabled
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    /// Screen saver / dim after inactivity
    #[serde(default)]
    pub screen_saver_enabled: bool,
    /// Screen saver timeout in seconds
    #[serde(default = "default_screen_saver_timeout")]
    pub screen_saver_timeout_secs: u64,
    /// Wake-on-motion (camera/sensor based wake from screen saver)
    #[serde(default)]
    pub wake_on_motion: bool,
    /// Display brightness override (0-100, 0 = system default)
    #[serde(default)]
    pub display_brightness: u8,
    /// Always on top
    #[serde(default)]
    pub always_on_top: bool,
    /// Kiosk mode (fullscreen, no title bar)
    #[serde(default)]
    pub kiosk_mode: bool,
    /// Send crash / error reports
    #[serde(default)]
    pub send_diagnostics: bool,
    /// ORA AI Privacy Mode - if true, AI is completely disabled
    #[serde(default)]
    pub ora_privacy_mode: bool,
    /// ORA AI Autopilot - if true, AI can act autonomously without asking
    #[serde(default)]
    pub ora_autopilot: bool,
    /// ORA AI Allow Control - if true, AI is allowed to control the system
    #[serde(default)]
    pub ora_allow_control: bool,
    /// Network profiles for different connection environments
    #[serde(default)]
    pub network_profiles: Vec<NetworkProfile>,
    /// Automatically switch IORA Home URL based on current network
    #[serde(default)]
    pub network_auto_switch: bool,
    /// Last saved window X position (None = center)
    #[serde(default)]
    pub window_x: Option<f64>,
    /// Last saved window Y position (None = center)
    #[serde(default)]
    pub window_y: Option<f64>,
    /// Last saved window width (None = default 1280)
    #[serde(default)]
    pub window_width: Option<f64>,
    /// Last saved window height (None = default 800)
    #[serde(default)]
    pub window_height: Option<f64>,
}

/// A network-specific connection profile.
/// Users can define different IORA Home URLs for LAN, WiFi, Mobile, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkProfile {
    /// Human-readable name for this profile (e.g. "Home LAN", "Mobile 5G")
    pub name: String,
    /// The network type this profile is meant for
    pub network_type: NetworkType,
    /// IORA Home URL to use when connected to this network
    pub iora_home_url: String,
    /// Optional IORA Backend (iora-assist) URL for this network
    #[serde(default)]
    pub iora_backend_url: Option<String>,
    /// Priority when multiple profiles could match (lower = higher priority)
    #[serde(default)]
    pub priority: u8,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            client_id: Uuid::new_v4().to_string(),
            client_name: hostname(),
            lm_studio_url: env!("LM_STUDIO_URL_DEFAULT").to_string(),
            lm_studio_api_key: String::new(),
            selected_model: String::new(),
            iora_backend_url: env!("IORA_BACKEND_URL_DEFAULT").to_string(),
            auto_start_proxy: true,
            proxy_port: env!("PROXY_PORT_DEFAULT").parse().unwrap_or(11435),
            health_poll_interval_secs: env!("HEALTH_POLL_INTERVAL_DEFAULT").parse().unwrap_or(30),
            iora_home_url: default_iora_home_url(),
            auth_token: String::new(),
            auth_username: String::new(),
            auth_user_id: String::new(),
            ha_enabled: false,
            ha_token: String::new(),
            ha_update_interval_secs: default_ha_update_interval(),
            autostart_enabled: false,
            autostart_minimized: false,
            autostart_hidden: true,
            notification_sound: true,
            notifications_enabled: true,
            screen_saver_enabled: false,
            screen_saver_timeout_secs: default_screen_saver_timeout(),
            wake_on_motion: false,
            display_brightness: 0,
            always_on_top: false,
            kiosk_mode: false,
            send_diagnostics: false,
            ora_privacy_mode: false,
            ora_autopilot: false,
            ora_allow_control: false,
            network_profiles: Vec::new(),
            network_auto_switch: false,
            window_x: None,
            window_y: None,
            window_width: None,
            window_height: None,
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
