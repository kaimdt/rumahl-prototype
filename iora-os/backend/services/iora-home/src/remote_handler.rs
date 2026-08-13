//! Remote Access status (Package 7) — Tailscale / WireGuard detection.
//!
//! Surfaces whether remote-access tunnels are installed and running so the
//! shell can show a Remote Access section (and later build "external link"
//! flows on top of the detected tailnet IP).
//!
//! API:
//!   GET /api/remote/status   (requires os.network.read)

use axum::{extract::State, Json};
use serde_json::{json, Value};
use tracing::debug;

use crate::middleware::AuthIdentity;
use crate::{AppState, ErrorResponse};

/// Check whether a command exists on PATH.
fn command_exists(binary: &str) -> bool {
    std::process::Command::new("sh")
        .args(["-c", &format!("command -v {binary}")])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Tailscale status via `tailscale status --json` (best-effort).
fn tailscale_status() -> Value {
    if !command_exists("tailscale") {
        return json!({ "installed": false });
    }
    let output = match std::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output()
    {
        Ok(out) if out.status.success() => out,
        Ok(_) => return json!({ "installed": true, "running": false }),
        Err(e) => {
            debug!("tailscale status failed: {e}");
            return json!({ "installed": true, "running": false });
        }
    };
    let data: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| json!({}));
    let empty = json!({});
    let self_info = data.get("Self").unwrap_or(&empty);
    let online = self_info
        .get("Online")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let hostname = self_info
        .get("DNSName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_end_matches('.')
        .to_string();
    let ip = self_info
        .get("TailscaleIPs")
        .and_then(|v| v.as_array())
        .and_then(|ips| ips.first())
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    json!({
        "installed": true,
        "running": true,
        "online": online,
        "hostname": hostname,
        "ip": ip,
    })
}

/// WireGuard detection: any interface configs under /etc/wireguard.
fn wireguard_status() -> Value {
    let configs: Vec<String> = match std::fs::read_dir("/etc/wireguard") {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|e| e == "conf")
                    .unwrap_or(false)
            })
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    json!({
        "installed": !configs.is_empty(),
        "interfaces": configs,
    })
}

/// GET /api/remote/status
pub async fn remote_status(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    if !crate::user_has_os_permission(&state, identity.user_id(), "os.network.read").await? {
        return Err(ErrorResponse::forbidden(
            "OS permission 'os.network.read' is required",
        ));
    }

    Ok(Json(json!({
        "tailscale": tailscale_status(),
        "wireguard": wireguard_status(),
    })))
}

const EXTERNAL_URL_KEY: &str = "remote.external_url";

/// GET /api/remote/config — the configured external base URL (e.g.
/// https://ora.meinedomain.de) used for external share links.
pub async fn get_remote_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let external_url = match state
        .config_repo
        .get_system_preference(EXTERNAL_URL_KEY)
        .await
    {
        Ok(Some(pref)) => serde_json::from_str::<Value>(&pref.preference_value)
            .and_then(|v| {
                Ok(v.get("url")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string())
            })
            .unwrap_or_default(),
        _ => String::new(),
    };
    Ok(Json(json!({ "external_url": external_url })))
}

/// PUT /api/remote/config — save the external base URL.
pub async fn save_remote_config(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let url = body
        .get("external_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    // Accept http(s) URLs only, no path.
    if !url.is_empty() {
        let parsed = reqwest::Url::parse(&url)
            .map_err(|e| ErrorResponse::bad_request(format!("invalid external URL: {e}")))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(ErrorResponse::bad_request("external URL must be http(s)"));
        }
    }
    let value = json!({ "url": url });
    state
        .config_repo
        .save_system_preference(crate::db::models::SaveSystemPreferenceRequest {
            preference_key: EXTERNAL_URL_KEY.to_string(),
            preference_value: value,
        })
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to save remote config: {e}")))?;
    Ok(Json(json!({ "saved": true, "external_url": url })))
}

/// Resolve the preferred external base URL for share links:
/// configured external URL > tailnet IP > None (caller falls back to local).
pub async fn resolve_external_base(state: &AppState) -> Option<String> {
    // 1. Configured external URL
    if let Ok(Some(pref)) = state
        .config_repo
        .get_system_preference(EXTERNAL_URL_KEY)
        .await
    {
        if let Ok(value) = serde_json::from_str::<Value>(&pref.preference_value) {
            if let Some(url) = value
                .get("url")
                .and_then(|u| u.as_str())
                .filter(|u| !u.is_empty())
            {
                return Some(url.to_string());
            }
        }
    }
    // 2. Tailscale IP (only when online)
    let ts = tailscale_status();
    if ts.get("online").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let Some(ip) = ts
            .get("ip")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
        {
            return Some(format!("http://{ip}"));
        }
    }
    None
}
