//! Authentication commands for the rumahl Home backend.

use crate::commands::AppState;
use crate::config;
use serde::{Deserialize, Serialize};
use tauri::State;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub role: String,
    pub is_admin: bool,
}

#[derive(Deserialize)]
struct LoginResponse {
    token: String,
    user: LoginUser,
}

#[derive(Deserialize)]
struct LoginUser {
    id: String,
    username: String,
    display_name: Option<String>,
    role: String,
    is_admin: bool,
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Log in with username/password; stores the JWT token persistently.
#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<AuthUser, String> {
    let rumahl_home_url = state.config.lock().await.rumahl_home_url.clone();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/auth/login", rumahl_home_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "username": username,
            "password": password,
        }))
        .send()
        .await
        .map_err(|e| format!("Verbindungsfehler: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Login fehlgeschlagen ({}): {}", status, text));
    }

    let login_resp: LoginResponse = resp
        .json()
        .await
        .map_err(|e| format!("Ungültige Antwort: {}", e))?;

    let user = AuthUser {
        id: login_resp.user.id.clone(),
        username: login_resp.user.username.clone(),
        display_name: login_resp.user.display_name.clone(),
        role: login_resp.user.role.clone(),
        is_admin: login_resp.user.is_admin,
    };

    // Persist token and user info to config
    {
        let mut cfg = state.config.lock().await;
        cfg.auth_token = login_resp.token;
        cfg.auth_username = user.username.clone();
        cfg.auth_user_id = user.id.clone();
        config::save(&cfg).map_err(|e| e.to_string())?;
    }

    // Cache user in memory
    *state.auth_user.lock().await = Some(user.clone());

    Ok(user)
}

/// Log out and clear stored credentials.
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut cfg = state.config.lock().await;
        cfg.auth_token = String::new();
        cfg.auth_username = String::new();
        cfg.auth_user_id = String::new();
        config::save(&cfg).map_err(|e| e.to_string())?;
    }
    *state.auth_user.lock().await = None;
    Ok(())
}

/// Return the current user from memory; if not set, reconstruct from persisted config fields.
/// Returns `None` if no token is stored.
#[tauri::command]
pub async fn get_current_user(state: State<'_, AppState>) -> Result<Option<AuthUser>, String> {
    // Check in-memory cache first
    if let Some(user) = state.auth_user.lock().await.clone() {
        return Ok(Some(user));
    }

    // Reconstruct from persisted config if a token exists.
    // role and is_admin default to "user"/false because the full user object
    // is only available after a live login response. These fields are informational
    // in the UI and a fresh login will restore the correct values.
    let cfg = state.config.lock().await.clone();
    if !cfg.auth_token.is_empty() {
        let user = AuthUser {
            id: cfg.auth_user_id.clone(),
            username: cfg.auth_username.clone(),
            display_name: None,
            role: "user".to_string(),
            is_admin: false,
        };
        *state.auth_user.lock().await = Some(user.clone());
        return Ok(Some(user));
    }

    Ok(None)
}
