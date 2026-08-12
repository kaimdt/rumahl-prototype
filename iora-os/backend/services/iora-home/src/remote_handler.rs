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
