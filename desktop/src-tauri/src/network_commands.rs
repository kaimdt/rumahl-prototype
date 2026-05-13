//! Tauri commands for network detection and profile management.
//!
//! Exposes the network_detection module to the frontend so the user
//! can see their current network status and manage connection profiles.

use crate::config::{self, AppConfig, NetworkProfile};
use crate::network_detection::{self, NetworkInfo, NetworkType};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::AppState;

// ─── Response types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct NetworkStatus {
    /// The currently active network interface info
    pub active: NetworkInfo,
    /// All detected interfaces
    pub interfaces: Vec<NetworkInfo>,
    /// Currently matched network profile (if any)
    pub matched_profile: Option<NetworkProfile>,
    /// Current IORA Home URL being used
    pub current_home_url: String,
    /// Network fingerprint for identification
    pub fingerprint: Option<String>,
}

// ─── Tauri commands ──────────────────────────────────────────────────────

/// Get full network status: active interface, all interfaces,
/// matched profile, and current URLs.
#[tauri::command]
pub async fn get_network_status(state: State<'_, AppState>) -> Result<NetworkStatus, String> {
    let active = network_detection::detect_active_network();
    let interfaces = network_detection::list_network_interfaces();
    let fingerprint = network_detection::network_fingerprint();

    let cfg = state.config.lock().await.clone();

    // Find matching profile for current network type
    let matched_profile = find_matching_profile(&cfg, &active);

    Ok(NetworkStatus {
        active,
        interfaces,
        matched_profile,
        current_home_url: cfg.iora_home_url.clone(),
        fingerprint,
    })
}

/// Detect the current network and return which profile would match.
#[tauri::command]
pub async fn detect_current_network() -> Result<NetworkInfo, String> {
    Ok(network_detection::detect_active_network())
}

/// List all detected network interfaces.
#[tauri::command]
pub async fn list_network_interfaces_cmd() -> Result<Vec<NetworkInfo>, String> {
    Ok(network_detection::list_network_interfaces())
}

/// Get all configured network profiles.
#[tauri::command]
pub async fn get_network_profiles(state: State<'_, AppState>) -> Result<Vec<NetworkProfile>, String> {
    let cfg = state.config.lock().await.clone();
    Ok(cfg.network_profiles.clone())
}

/// Save the full list of network profiles.
#[tauri::command]
pub async fn save_network_profiles(
    state: State<'_, AppState>,
    profiles: Vec<NetworkProfile>,
) -> Result<(), String> {
    let mut cfg = state.config.lock().await.clone();
    cfg.network_profiles = profiles;
    config::save(&cfg).map_err(|e| e.to_string())?;
    *state.config.lock().await = cfg;
    Ok(())
}

/// Enable or disable automatic network profile switching.
#[tauri::command]
pub async fn set_network_auto_switch(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    let mut cfg = state.config.lock().await.clone();
    cfg.network_auto_switch = enabled;
    config::save(&cfg).map_err(|e| e.to_string())?;
    *state.config.lock().await = cfg;
    Ok(())
}

/// Manually switch to a specific network profile.
#[tauri::command]
pub async fn switch_to_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_index: usize,
) -> Result<(), String> {
    let cfg = state.config.lock().await.clone();
    if let Some(profile) = cfg.network_profiles.get(profile_index) {
        let mut cfg = state.config.lock().await.clone();
        cfg.iora_home_url = profile.iora_home_url.clone();
        if let Some(ref url) = profile.iora_backend_url {
            cfg.iora_backend_url = url.clone();
        }
        config::save(&cfg).map_err(|e| e.to_string())?;
        *state.config.lock().await = cfg;

        // Emit event so the frontend reconnects
        let _ = app.emit("network-profile-changed", profile.clone());

        tracing::info!(
            "Manually switched to profile '{}' ({}), home_url={}",
            profile.name,
            profile.network_type.as_str(),
            profile.iora_home_url
        );
    }
    Ok(())
}

// ─── Profile matching ───────────────────────────────────────────────────

fn find_matching_profile(cfg: &AppConfig, active: &NetworkInfo) -> Option<NetworkProfile> {
    if cfg.network_profiles.is_empty() {
        return None;
    }

    // First: try exact match by network type
    let exact_match = cfg.network_profiles.iter().find(|p| {
        p.network_type == active.network_type
    });

    if exact_match.is_some() {
        return exact_match.cloned();
    }

    // Second: if we're on WiFi, try Ethernet profiles as fallback
    // (some laptops use Ethernet via dock but classify as unknown)
    if active.network_type == NetworkType::WiFi || active.network_type == NetworkType::Unknown {
        return cfg.network_profiles.first().cloned();
    }

    None
}

// ─── Background network monitor (called from main.rs setup) ─────────────

/// Start a background task that periodically checks for network changes
/// and auto-switches the IORA Home URL to the matching profile.
pub fn start_network_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial delay to let the app settle
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        let mut last_fingerprint: Option<String> = None;

        loop {
            let (auto_switch_enabled, profiles) = {
                let state = app.state::<AppState>();
                let cfg = state.config.lock().await.clone();
                (cfg.network_auto_switch, cfg.network_profiles.clone())
            };

            if auto_switch_enabled && !profiles.is_empty() {
                let current = network_detection::detect_active_network();
                let fingerprint = network_detection::network_fingerprint();

                // Only act if the network actually changed
                if fingerprint != last_fingerprint {
                    last_fingerprint = fingerprint;

                    if let Some(profile) = find_matching_profile_for_info(&profiles, &current) {
                        let mut cfg = app.state::<AppState>().config.lock().await.clone();
                        let url_changed = cfg.iora_home_url != profile.iora_home_url;

                        if url_changed {
                            cfg.iora_home_url = profile.iora_home_url.clone();
                            if let Some(ref url) = profile.iora_backend_url {
                                cfg.iora_backend_url = url.clone();
                            }
                            let _ = config::save(&cfg);
                            *app.state::<AppState>().config.lock().await = cfg;

                            let _ = app.emit("network-profile-changed", profile.clone());

                            tracing::info!(
                                "Auto-switched to profile '{}' ({} -> {}), home_url={}",
                                profile.name,
                                current.network_type.as_str(),
                                current.interface_name,
                                profile.iora_home_url
                            );
                        }
                    }
                }
            }

            // Poll every 10 seconds for network changes
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }
    });
}

fn find_matching_profile_for_info(
    profiles: &[NetworkProfile],
    active: &NetworkInfo,
) -> Option<NetworkProfile> {
    if profiles.is_empty() {
        return None;
    }

    // Exact match by network type
    if let Some(p) = profiles.iter().find(|p| p.network_type == active.network_type) {
        return Some(p.clone());
    }

    // Fallback: first available profile
    profiles.first().cloned()
}
