//! Media Hub (Package 6) — Jellyfin/Plex detection + continue-watching.
//!
//! Probes local media servers (Jellyfin on 8096, Plex on 32400, or
//! user-configured URLs), surfaces their identity, and — when a Jellyfin
//! API key + user id are configured — returns the user's resume/continue
//! items for the Home dashboard widget.
//!
//! API:
//!   GET /api/media/hub              → server detection + identity
//!   GET /api/media/continue-watching → Jellyfin resume items
//!   GET /api/media/config           → saved config (secrets redacted)
//!   PUT /api/media/config           → save Jellyfin/Plex connection config

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::debug;

use crate::{AppState, ErrorResponse};

const CONFIG_KEY: &str = "media.servers";

/// Connection config persisted in system_preferences (secrets kept server-side).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MediaServerConfig {
    #[serde(default)]
    pub jellyfin_url: String,
    #[serde(default)]
    pub jellyfin_api_key: String,
    #[serde(default)]
    pub jellyfin_user_id: String,
    #[serde(default)]
    pub plex_url: String,
    #[serde(default)]
    pub plex_token: String,
}

async fn load_config(state: &AppState) -> MediaServerConfig {
    match state.config_repo.get_system_preference(CONFIG_KEY).await {
        Ok(Some(pref)) => serde_json::from_str(&pref.preference_value).unwrap_or_default(),
        _ => MediaServerConfig::default(),
    }
}

/// Probe a URL quickly; returns (reachable, optional server name).
async fn probe_server(url: &str) -> (bool, Option<String>) {
    if url.trim().is_empty() {
        return (false, None);
    }
    let client = reqwest::Client::new();
    match client
        .get(url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            let name = response.json::<Value>().await.ok().and_then(|v| {
                v.get("ServerName")
                    .or_else(|| v.get("MachineIdentifier"))
                    .or_else(|| v.get("FriendlyName"))
                    .and_then(|n| n.as_str())
                    .map(|n| n.to_string())
            });
            (true, name)
        }
        Ok(_) => (false, None),
        Err(_) => (false, None),
    }
}

/// GET /api/media/hub — detection of local media servers.
pub async fn media_hub(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let config = load_config(&state).await;

    let jellyfin_default = "http://127.0.0.1:8096/System/Info/Public".to_string();
    let plex_default = "http://127.0.0.1:32400/identity".to_string();

    let jellyfin_url = if config.jellyfin_url.trim().is_empty() {
        jellyfin_default
    } else {
        format!(
            "{}/System/Info/Public",
            config.jellyfin_url.trim_end_matches('/')
        )
    };
    let plex_url = if config.plex_url.trim().is_empty() {
        plex_default
    } else {
        format!("{}/identity", config.plex_url.trim_end_matches('/'))
    };

    let (jellyfin_reachable, jellyfin_name) = probe_server(&jellyfin_url).await;
    let (plex_reachable, plex_name) = probe_server(&plex_url).await;

    Ok(Json(json!({
        "jellyfin": {
            "reachable": jellyfin_reachable,
            "name": jellyfin_name,
            "url": config.jellyfin_url.trim(),
            "configured": !config.jellyfin_api_key.trim().is_empty()
                && !config.jellyfin_user_id.trim().is_empty(),
        },
        "plex": {
            "reachable": plex_reachable,
            "name": plex_name,
            "url": config.plex_url.trim(),
            "configured": !config.plex_token.trim().is_empty(),
        },
    })))
}

/// GET /api/media/continue-watching — Jellyfin resume items.
pub async fn continue_watching(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = load_config(&state).await;
    if config.jellyfin_api_key.trim().is_empty() || config.jellyfin_user_id.trim().is_empty() {
        return Ok(Json(json!({ "configured": false, "items": [] })));
    }

    let base = config.jellyfin_url.trim_end_matches('/');
    let url = format!(
        "{base}/Users/{}/Items/Resume?Limit=8&Fields=SeriesName,SeasonNumber,EpisodeNumber,PrimaryImageAspectRatio",
        config.jellyfin_user_id.trim()
    );

    let client = reqwest::Client::new();
    let response = match client
        .get(&url)
        .header("X-Emby-Token", config.jellyfin_api_key.trim())
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            debug!("jellyfin continue-watching probe failed: {e}");
            return Ok(Json(
                json!({ "configured": true, "items": [], "error": e.to_string() }),
            ));
        }
    };
    if !response.status().is_success() {
        return Ok(Json(json!({
            "configured": true,
            "items": [],
            "error": format!("HTTP {}", response.status())
        })));
    }

    let data: Value = response.json().await.unwrap_or_else(|_| json!({}));
    let items: Vec<Value> = data
        .get("Items")
        .and_then(|items| items.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            let empty = json!({});
            let user_data = item.get("UserData").unwrap_or(&empty);
            let progress = user_data
                .get("PlayedPercentage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let id = item
                .get("Id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            json!({
                "id": id,
                "title": item.get("Name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                "series": item.get("SeriesName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                "season": item.get("SeasonNumber").and_then(|v| v.as_i64()).unwrap_or(0),
                "episode": item.get("EpisodeNumber").and_then(|v| v.as_i64()).unwrap_or(0),
                "progress_percent": (progress as f64).round(),
                "image_url": if id.is_empty() { None } else {
                    Some(format!("{base}/Items/{id}/Images/Primary?maxWidth=320&tag=0"))
                },
            })
        })
        .collect();

    Ok(Json(json!({ "configured": true, "items": items })))
}

/// GET /api/media/config — saved config with secrets redacted.
pub async fn get_media_config(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let config = load_config(&state).await;
    Ok(Json(json!({
        "jellyfin_url": config.jellyfin_url,
        "jellyfin_api_key": if config.jellyfin_api_key.is_empty() { "" } else { "••••••••" },
        "jellyfin_user_id": config.jellyfin_user_id,
        "plex_url": config.plex_url,
        "plex_token": if config.plex_token.is_empty() { "" } else { "••••••••" },
    })))
}

/// PUT /api/media/config — save the media server connection config.
pub async fn save_media_config(
    State(state): State<AppState>,
    Json(body): Json<MediaServerConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    // Keep existing secrets when the client sends the redacted placeholder.
    let mut config = load_config(&state).await;
    if body.jellyfin_api_key != "••••••••" {
        config.jellyfin_api_key = body.jellyfin_api_key.trim().to_string();
    }
    if body.plex_token != "••••••••" {
        config.plex_token = body.plex_token.trim().to_string();
    }
    config.jellyfin_url = body.jellyfin_url.trim().to_string();
    config.jellyfin_user_id = body.jellyfin_user_id.trim().to_string();
    config.plex_url = body.plex_url.trim().to_string();

    let value = serde_json::to_value(&config)
        .map_err(|e| ErrorResponse::internal(format!("failed to serialize media config: {e}")))?;
    state
        .config_repo
        .save_system_preference(db_save_request(CONFIG_KEY.to_string(), value))
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to save media config: {e}")))?;

    Ok(Json(json!({ "saved": true })))
}

fn db_save_request(key: String, value: Value) -> crate::db::models::SaveSystemPreferenceRequest {
    crate::db::models::SaveSystemPreferenceRequest {
        preference_key: key,
        preference_value: value,
    }
}
