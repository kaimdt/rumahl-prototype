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

use crate::middleware::AuthIdentity;
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
                "provider": "jellyfin",
                // Proxied image — the media token stays server-side.
                "image_url": if id.is_empty() { None } else {
                    Some(format!("/api/media/image/{id}"))
                },
            })
        })
        .collect();

    let mut result = json!({ "configured": true, "items": items });

    // Plex on-deck (continue watching) when a token is configured.
    if !config.plex_token.trim().is_empty() {
        let plex_base = config.plex_url.trim_end_matches('/');
        if !plex_base.is_empty() {
            let on_deck_url = format!(
                "{plex_base}/library/onDeck?X-Plex-Token={}&limit=8",
                config.plex_token.trim()
            );
            if let Ok(deck_response) = client
                .get(&on_deck_url)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
            {
                if deck_response.status().is_success() {
                    let deck: Value = deck_response.json().await.unwrap_or_else(|_| json!({}));
                    let plex_items: Vec<Value> = deck
                        .pointer("/MediaContainer/Metadata")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|item| {
                            let offset = item.get("viewOffset").and_then(|v| v.as_i64()).unwrap_or(0);
                            let duration = item.get("duration").and_then(|v| v.as_i64()).unwrap_or(1).max(1);
                            let progress = ((offset as f64 / duration as f64) * 100.0).clamp(0.0, 100.0);
                            json!({
                                "id": item.get("ratingKey").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                "title": item.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                "series": item.get("grandparentTitle").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                "season": item.get("parentIndex").and_then(|v| v.as_i64()).unwrap_or(0),
                                "episode": item.get("index").and_then(|v| v.as_i64()).unwrap_or(0),
                                "progress_percent": (progress as f64).round(),
                                "provider": "plex",
                            })
                        })
                        .collect();
                    // Jellyfin items have provider "jellyfin"; merge both.
                    if let Some(existing) = result.get_mut("items").and_then(|v| v.as_array_mut()) {
                        existing.extend(plex_items);
                    }
                    result["plex_configured"] = json!(true);
                }
            }
        }
    }

    Ok(Json(result))
}

/// GET /api/media/image/:item_id — proxy a Jellyfin primary image so the
/// media token never reaches the browser. Requires the caller to have
/// os.system.read (the same gate as continue-watching).
pub async fn media_image(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<AuthIdentity>,
    axum::extract::Path(item_id): axum::extract::Path<String>,
) -> axum::response::Response {
    use axum::http::{header, StatusCode};
    use axum::response::IntoResponse;

    let allowed = crate::user_has_os_permission(&state, identity.user_id(), "os.system.read")
        .await
        .unwrap_or(false);
    if !allowed {
        return StatusCode::FORBIDDEN.into_response();
    }
    let config = load_config(&state).await;
    let base = config.jellyfin_url.trim_end_matches('/');
    if base.is_empty() || config.jellyfin_api_key.trim().is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let url = format!("{base}/Items/{item_id}/Images/Primary?maxWidth=480");
    let client = reqwest::Client::new();
    match client
        .get(&url)
        .header("X-Emby-Token", config.jellyfin_api_key.trim())
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            let bytes = match response.bytes().await {
                Ok(bytes) => bytes,
                Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
            };
            let content_type = "image/jpeg";
            ([(header::CONTENT_TYPE, content_type)], bytes.to_vec()).into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
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
