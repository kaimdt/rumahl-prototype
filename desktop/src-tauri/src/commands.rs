//! Tauri commands exposed to the frontend.

use crate::auth::AuthUser;
use crate::config::{self, AppConfig};
use crate::lm_studio::{ChatMessage, ChatRequest, LmStudioClient, Model};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

// ─── Shared application state ────────────────────────────────────────────────

/// State shared across all Tauri commands.
pub struct AppState {
    pub config: Mutex<AppConfig>,
    /// Cached connectivity flag – updated by the background health monitor.
    pub lm_online: Arc<AtomicBool>,
    /// Currently authenticated user (None if not logged in).
    pub auth_user: Mutex<Option<AuthUser>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(config::load()),
            lm_online: Arc::new(AtomicBool::new(false)),
            auth_user: Mutex::new(None),
        }
    }
}

// ─── Response types ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ConnectionResult {
    pub connected: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ClientInfo {
    pub client_id: String,
    pub client_name: String,
    pub lm_studio_url: String,
    pub selected_model: String,
    pub online: bool,
}

// ─── Config commands ─────────────────────────────────────────────────────────

/// Load current settings.
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().await.clone())
}

/// Save settings and immediately re-check connectivity.
#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    new_config: AppConfig,
) -> Result<(), String> {
    config::save(&new_config).map_err(|e| e.to_string())?;
    // Re-test connectivity with the new URL
    let client = LmStudioClient::new(&new_config.lm_studio_url, &new_config.lm_studio_api_key);
    let online = client.ping().await;
    state.lm_online.store(online, Ordering::Relaxed);
    *state.config.lock().await = new_config;
    Ok(())
}

// ─── LM Studio commands ──────────────────────────────────────────────────────

/// Test connection to LM Studio and return status.
#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
) -> Result<ConnectionResult, String> {
    let cfg = state.config.lock().await.clone();
    let client = LmStudioClient::new(&cfg.lm_studio_url, &cfg.lm_studio_api_key);
    let online = client.ping().await;
    state.lm_online.store(online, Ordering::Relaxed);
    if online {
        Ok(ConnectionResult { connected: true, error: None })
    } else {
        Ok(ConnectionResult {
            connected: false,
            error: Some(format!("LM Studio nicht erreichbar unter {}", cfg.lm_studio_url)),
        })
    }
}

/// List models available in LM Studio.
/// Returns an empty list instead of an error when LM Studio is offline.
#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<Model>, String> {
    let cfg = state.config.lock().await.clone();
    let client = LmStudioClient::new(&cfg.lm_studio_url, &cfg.lm_studio_api_key);
    match client.list_models().await {
        Ok(models) => {
            state.lm_online.store(true, Ordering::Relaxed);
            Ok(models)
        }
        Err(e) => {
            state.lm_online.store(false, Ordering::Relaxed);
            // Return empty list with a descriptive error rather than crashing the UI
            Err(format!("LM Studio offline: {}", e))
        }
    }
}

/// Send a chat message to the currently selected model.
/// Returns an explicit offline error when LM Studio is unreachable.
#[tauri::command]
pub async fn send_chat(
    state: State<'_, AppState>,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
) -> Result<String, String> {
    let cfg = state.config.lock().await.clone();
    if cfg.selected_model.is_empty() {
        return Err("Kein Modell ausgewählt".to_string());
    }
    if !state.lm_online.load(Ordering::Relaxed) {
        return Err("LM Studio ist offline – bitte starten und erneut versuchen".to_string());
    }
    let client = LmStudioClient::new(&cfg.lm_studio_url, &cfg.lm_studio_api_key);
    let req = ChatRequest {
        model: cfg.selected_model.clone(),
        messages,
        temperature: temperature.unwrap_or(0.7),
        max_tokens,
        stream: false,
    };
    let response = client.chat(req).await.map_err(|e| {
        state.lm_online.store(false, Ordering::Relaxed);
        format!("LM Studio Fehler: {}", e)
    })?;
    Ok(response
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default())
}

/// Get current connection status (uses cached flag; no network call).
#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<ConnectionResult, String> {
    let online = state.lm_online.load(Ordering::Relaxed);
    if online {
        Ok(ConnectionResult { connected: true, error: None })
    } else {
        let url = state.config.lock().await.lm_studio_url.clone();
        Ok(ConnectionResult {
            connected: false,
            error: Some(format!("LM Studio nicht erreichbar unter {}", url)),
        })
    }
}

/// Return this client's identity information (for multi-client routing in iora-assist).
#[tauri::command]
pub async fn get_client_info(state: State<'_, AppState>) -> Result<ClientInfo, String> {
    let cfg = state.config.lock().await.clone();
    Ok(ClientInfo {
        client_id: cfg.client_id.clone(),
        client_name: cfg.client_name.clone(),
        lm_studio_url: cfg.lm_studio_url.clone(),
        selected_model: cfg.selected_model.clone(),
        online: state.lm_online.load(Ordering::Relaxed),
    })
}
