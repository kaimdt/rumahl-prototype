//! Guided Home Assistant discovery and onboarding for ORA Home.

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashSet, time::Duration};

use crate::{db::models::SaveSystemPreferenceRequest, AppState};

type ApiError = (StatusCode, String);

#[derive(Debug, Deserialize)]
pub struct DiscoverRequest {
    #[serde(default)]
    pub suggested_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DiscoveredHomeAssistant {
    pub url: String,
    pub reachable: bool,
    pub latency_ms: u64,
    pub requires_token: bool,
}

#[derive(Debug, Deserialize)]
pub struct OnboardRequest {
    pub url: String,
    pub token: String,
}

fn normalize_url(raw: &str) -> Result<String, ApiError> {
    let with_scheme = if raw.contains("://") { raw.trim().to_string() } else { format!("http://{}", raw.trim()) };
    let parsed = reqwest::Url::parse(&with_scheme).map_err(|_| (StatusCode::BAD_REQUEST, "Invalid Home Assistant URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err((StatusCode::BAD_REQUEST, "Home Assistant URL must use HTTP or HTTPS".into()));
    }
    Ok(with_scheme.trim_end_matches('/').to_string())
}

async fn probe(state: &AppState, url: String) -> DiscoveredHomeAssistant {
    let started = std::time::Instant::now();
    let response = state.http_client.get(format!("{url}/api/")).timeout(Duration::from_secs(2)).send().await;
    let (reachable, requires_token) = match response {
        Ok(response) => (response.status().is_success() || response.status() == reqwest::StatusCode::UNAUTHORIZED, response.status() == reqwest::StatusCode::UNAUTHORIZED),
        Err(_) => (false, false),
    };
    DiscoveredHomeAssistant { url, reachable, latency_ms: started.elapsed().as_millis() as u64, requires_token }
}

pub async fn discover(State(state): State<AppState>, Json(request): Json<DiscoverRequest>) -> Json<Vec<DiscoveredHomeAssistant>> {
    let current = crate::load_ha_runtime_config(&state.config_repo).await;
    let candidates = [
        request.suggested_url.as_deref(),
        (!current.url.is_empty()).then_some(current.url.as_str()),
        Some("http://homeassistant.local:8123"),
        Some("http://home-assistant.local:8123"),
        Some("http://127.0.0.1:8123"),
    ];
    let mut unique = HashSet::new();
    let urls: Vec<String> = candidates.into_iter().flatten().filter_map(|url| normalize_url(url).ok()).filter(|url| unique.insert(url.clone())).collect();
    let results = futures_util::future::join_all(urls.into_iter().map(|url| probe(&state, url))).await;
    Json(results)
}

pub async fn onboard(State(state): State<AppState>, Json(request): Json<OnboardRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let url = normalize_url(&request.url)?;
    let token = request.token.trim();
    if token.is_empty() { return Err((StatusCode::BAD_REQUEST, "Home Assistant access token is required".into())); }

    let started = std::time::Instant::now();
    let response = state.http_client.get(format!("{url}/api/config"))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .timeout(Duration::from_secs(8)).send().await
        .map_err(|error| (StatusCode::BAD_GATEWAY, format!("Could not connect to Home Assistant: {error}")))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err((StatusCode::UNAUTHORIZED, "Home Assistant rejected the access token".into()));
    }
    if !response.status().is_success() {
        return Err((StatusCode::BAD_GATEWAY, format!("Home Assistant returned HTTP {}", response.status())));
    }
    let config: serde_json::Value = response.json().await.map_err(|error| (StatusCode::BAD_GATEWAY, format!("Invalid Home Assistant response: {error}")))?;

    for (key, value) in [("ha.url", json!(url)), ("ha.token", json!(token))] {
        state.config_repo.save_system_preference(SaveSystemPreferenceRequest { preference_key: key.into(), preference_value: value.clone() }).await
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("Could not save Home Assistant configuration: {error}")))?;
        iora_shared_config::system_config::update_cached_setting(key.into(), value.to_string());
    }
    state.ha_client.update_credentials(&url, token).await;
    state.ha_connection.update_url(&url).await;
    state.ha_connection.reset_for_reconnect();

    Ok(Json(json!({
        "ok": true,
        "url": url,
        "latency_ms": started.elapsed().as_millis() as u64,
        "version": config.get("version"),
        "location_name": config.get("location_name"),
        "components": config.get("components").and_then(|value| value.as_array()).map_or(0, Vec::len),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_host_and_removes_trailing_slash() {
        assert_eq!(normalize_url("homeassistant.local:8123/").unwrap(), "http://homeassistant.local:8123");
    }

    #[test]
    fn rejects_non_http_urls() {
        assert_eq!(normalize_url("ftp://homeassistant.local").unwrap_err().0, StatusCode::BAD_REQUEST);
    }
}
