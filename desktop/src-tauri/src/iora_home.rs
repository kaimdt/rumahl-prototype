//! Commands for querying the IORA Home backend status.

use crate::commands::AppState;
use serde::Serialize;
use tauri::State;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct IoraHomeStatus {
    pub online: bool,
    pub ha_connected: bool,
    pub entity_count: i64,
    pub person_count: i64,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct EntityCounts {
    pub total: i64,
    pub lights: i64,
    pub switches: i64,
    pub sensors: i64,
    pub persons: i64,
    pub other: i64,
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Quick reachability check: returns true if the IORA Home backend responds with 2xx.
#[tauri::command]
pub async fn ping_iora_home(state: State<'_, AppState>) -> Result<bool, String> {
    let (iora_home_url, auth_token) = {
        let cfg = state.config.lock().await;
        (cfg.iora_home_url.clone(), cfg.auth_token.clone())
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/system/stats", iora_home_url.trim_end_matches('/'));
    let mut req = client.get(&url);
    if !auth_token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", auth_token));
    }

    match req.send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Fetch HA connection info and entity counts from IORA Home.
#[tauri::command]
pub async fn get_iora_home_status(state: State<'_, AppState>) -> Result<IoraHomeStatus, String> {
    let (iora_home_url, auth_token) = {
        let cfg = state.config.lock().await;
        (cfg.iora_home_url.clone(), cfg.auth_token.clone())
    };

    let base_url = iora_home_url.trim_end_matches('/');

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let auth_header = if !auth_token.is_empty() {
        Some(format!("Bearer {}", auth_token))
    } else {
        None
    };

    // GET /api/system/ha-info
    let ha_url = format!("{}/api/system/ha-info", base_url);
    let mut ha_req = client.get(&ha_url);
    if let Some(auth) = &auth_header {
        ha_req = ha_req.header("Authorization", auth.clone());
    }
    let (online, ha_connected) = match ha_req.send().await {
        Ok(resp) if resp.status().is_success() => {
            let json: serde_json::Value = resp.json().await.unwrap_or_else(|e| {
                tracing::warn!("Failed to parse ha-info response: {}", e);
                serde_json::Value::default()
            });
            let connected = json
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            (true, connected)
        }
        _ => (false, false),
    };

    // GET /api/entities/count
    let counts_url = format!("{}/api/entities/count", base_url);
    let mut counts_req = client.get(&counts_url);
    if let Some(auth) = &auth_header {
        counts_req = counts_req.header("Authorization", auth.clone());
    }
    let (entity_count, person_count) = match counts_req.send().await {
        Ok(resp) if resp.status().is_success() => {
            let json: serde_json::Value = resp.json().await.unwrap_or_else(|e| {
                tracing::warn!("Failed to parse entities/count response: {}", e);
                serde_json::Value::default()
            });
            let total = json.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
            let persons = json.get("persons").and_then(|v| v.as_i64()).unwrap_or(0);
            (total, persons)
        }
        _ => (0, 0),
    };

    Ok(IoraHomeStatus {
        online,
        ha_connected,
        entity_count,
        person_count,
        url: iora_home_url,
    })
}
