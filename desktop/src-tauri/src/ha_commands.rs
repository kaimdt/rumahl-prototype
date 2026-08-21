//! Tauri commands for Home Assistant integration (via rumahl-home gateway) and system control.

use crate::commands::AppState;
use crate::ha_integration::{HaClient, HaConfig, HaEntity};
use crate::system_commands::{execute_system_command, SystemCommand};
use crate::system_info::{collect_metrics, SystemMetrics};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize)]
pub struct HaTestResult {
    pub connected: bool,
    pub error: Option<String>,
}

/// Test connection to rumahl-home gateway (which provides HA integration)
#[tauri::command]
pub async fn test_ha_connection(state: State<'_, AppState>) -> Result<HaTestResult, String> {
    let cfg = state.config.lock().await.clone();
    let ha_config = HaConfig {
        url: cfg.rumahl_home_url.clone(), // Connect to rumahl-home, not HA directly
        token: cfg.ha_token.clone(),    // JWT token from rumahl-home
        device_name: cfg.client_name.clone(),
        update_interval_secs: cfg.ha_update_interval_secs,
        enabled: cfg.ha_enabled,
    };

    if ha_config.token.is_empty() {
        return Ok(HaTestResult {
            connected: false,
            error: Some("Kein rumahl-home JWT Token konfiguriert".to_string()),
        });
    }

    let client = HaClient::new(ha_config);
    match client.test_connection().await {
        Ok(true) => Ok(HaTestResult {
            connected: true,
            error: None,
        }),
        Ok(false) => Ok(HaTestResult {
            connected: false,
            error: Some("Verbindung zu rumahl-home fehlgeschlagen".to_string()),
        }),
        Err(e) => Ok(HaTestResult {
            connected: false,
            error: Some(format!("Fehler: {}", e)),
        }),
    }
}

/// Get current system metrics
#[tauri::command]
pub async fn get_system_metrics() -> Result<SystemMetrics, String> {
    collect_metrics().map_err(|e| e.to_string())
}

/// Send current metrics to rumahl-home (which forwards to HA)
#[tauri::command]
pub async fn send_metrics_to_ha(state: State<'_, AppState>) -> Result<(), String> {
    let cfg = state.config.lock().await.clone();
    let ha_config = HaConfig {
        url: cfg.rumahl_home_url.clone(), // rumahl-home URL
        token: cfg.ha_token.clone(),
        device_name: cfg.client_name.clone(),
        update_interval_secs: cfg.ha_update_interval_secs,
        enabled: cfg.ha_enabled,
    };

    if !ha_config.enabled {
        return Err("Home Assistant Integration ist deaktiviert".to_string());
    }

    let metrics = collect_metrics().map_err(|e| e.to_string())?;
    let client = HaClient::new(ha_config);
    client
        .send_metrics(&metrics)
        .await
        .map_err(|e| e.to_string())
}

/// Get list of Home Assistant entities (via rumahl-home gateway)
#[tauri::command]
pub async fn get_ha_entities(state: State<'_, AppState>) -> Result<Vec<HaEntity>, String> {
    let cfg = state.config.lock().await.clone();
    let ha_config = HaConfig {
        url: cfg.rumahl_home_url.clone(), // rumahl-home URL
        token: cfg.ha_token.clone(),
        device_name: cfg.client_name.clone(),
        update_interval_secs: cfg.ha_update_interval_secs,
        enabled: cfg.ha_enabled,
    };

    let client = HaClient::new(ha_config);
    client.get_entities().await.map_err(|e| e.to_string())
}

/// Call a Home Assistant service via rumahl-home gateway (validated & secure)
#[tauri::command]
pub async fn call_ha_service(
    state: State<'_, AppState>,
    domain: String,
    service: String,
    entity_id: Option<String>,
    data: Option<HashMap<String, serde_json::Value>>,
) -> Result<(), String> {
    let cfg = state.config.lock().await.clone();
    let ha_config = HaConfig {
        url: cfg.rumahl_home_url.clone(), // rumahl-home URL
        token: cfg.ha_token.clone(),
        device_name: cfg.client_name.clone(),
        update_interval_secs: cfg.ha_update_interval_secs,
        enabled: cfg.ha_enabled,
    };

    let client = HaClient::new(ha_config);
    client
        .call_service(&domain, &service, entity_id, data)
        .await
        .map_err(|e| e.to_string())
}

/// Execute a system command (shutdown, reboot, etc.)
#[tauri::command]
pub async fn execute_command(command: String) -> Result<(), String> {
    if let Some(cmd) = SystemCommand::from_string(&command) {
        tracing::warn!("Executing system command: {:?}", cmd);
        execute_system_command(cmd).map_err(|e| e.to_string())
    } else {
        Err(format!("Unbekannter Befehl: {}", command))
    }
}
