//! Tauri commands exposed to the frontend.

use crate::config::{self, AppConfig};
use crate::lm_studio::{ChatMessage, ChatRequest, LmStudioClient, Model};
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

// Shared state across commands
pub struct AppState {
    pub config: Mutex<AppConfig>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(config::load()),
        }
    }
}

#[derive(Serialize)]
pub struct ConnectionResult {
    pub connected: bool,
    pub error: Option<String>,
}

// ─── Config commands ─────────────────────────────────────────────────────────

/// Load current settings.
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().await.clone())
}

/// Save settings.
#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    new_config: AppConfig,
) -> Result<(), String> {
    config::save(&new_config).map_err(|e| e.to_string())?;
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
    if client.ping().await {
        Ok(ConnectionResult { connected: true, error: None })
    } else {
        Ok(ConnectionResult {
            connected: false,
            error: Some(format!("Cannot reach LM Studio at {}", cfg.lm_studio_url)),
        })
    }
}

/// List models available in LM Studio.
#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<Model>, String> {
    let cfg = state.config.lock().await.clone();
    let client = LmStudioClient::new(&cfg.lm_studio_url, &cfg.lm_studio_api_key);
    client.list_models().await.map_err(|e| e.to_string())
}

/// Send a chat message to the currently selected model.
#[tauri::command]
pub async fn send_chat(
    state: State<'_, AppState>,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
) -> Result<String, String> {
    let cfg = state.config.lock().await.clone();
    if cfg.selected_model.is_empty() {
        return Err("No model selected".to_string());
    }
    let client = LmStudioClient::new(&cfg.lm_studio_url, &cfg.lm_studio_api_key);
    let req = ChatRequest {
        model: cfg.selected_model.clone(),
        messages,
        temperature: temperature.unwrap_or(0.7),
        max_tokens,
        stream: false,
    };
    let response = client.chat(req).await.map_err(|e| e.to_string())?;
    Ok(response
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default())
}

/// Get current connection status without side effects.
#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<ConnectionResult, String> {
    test_connection(state).await
}
