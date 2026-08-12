// New modules for enhanced robustness
mod auth;
mod cache;
mod error;
mod nas_inventory;
mod storage_inventory;
mod storage_jobs;
mod ws;

use std::{
    io::Write,
    process::{Command, Stdio},
    sync::Arc,
    time::Instant,
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use sysinfo::{Disks, Networks, ProcessRefreshKind, RefreshKind, System};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{info, warn};

use crate::{auth::AuthState, cache::Cache, ws::WsState};

/// Returns the iora-core base URL.
/// Honors `$IORA_CORE_URL` env var; falls back to system_config.
fn iora_core_url() -> String {
    std::env::var("IORA_CORE_URL")
        .unwrap_or_else(|_| iora_shared_config::system_config::service_url("iora-core", 8090))
}

/// Returns the iora-home base URL.
/// Honors `$IORA_HOME_URL` env var; falls back to system_config.
fn iora_home_url() -> String {
    std::env::var("IORA_HOME_URL")
        .unwrap_or_else(|_| iora_shared_config::system_config::service_url("iora-home", 8126))
}

#[derive(Clone)]
struct AppState {
    http: reqwest::Client,
    config: Arc<RwLock<serde_json::Value>>,
    started_at: Arc<Instant>,
    cache: Cache,
    ws_state: Arc<WsState>,
    auth_state: Arc<AuthState>,
}

impl AppState {
    fn new() -> Self {
        // Use the shared IORA JWT secret (same source as iora-home) so tokens
        // issued by iora-home's /api/auth/login are accepted here. The generic
        // `JWT_SECRET` env var with a hardcoded fallback never matched the
        // dashboard's secret, which made every proxied request 401.
    
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap(),
            config: Arc::new(RwLock::new(serde_json::json!({
                "theme": "dark",
                "language": "en",
                "notifications_enabled": true,
                "log_level": "info",
            }))),
            started_at: Arc::new(Instant::now()),
            cache: Cache::new(),
            ws_state: Arc::new(WsState::new()),
            auth_state: Arc::new(AuthState::new()),
        }
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "iora-control",
        "status": "healthy",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn dashboard_overview(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services = async {
        state
            .http
            .get(format!("{}/api/core/services", iora_core_url()))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()
    }
    .await
    .unwrap_or_else(|| serde_json::json!({ "services": [], "total": 0 }));

    let plugins = async {
        state
            .http
            .get(format!("{}/api/core/plugins", iora_core_url()))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()
    }
    .await
    .unwrap_or_else(|| serde_json::json!({ "plugins": [], "total": 0 }));

    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "services": services,
        "plugins": plugins,
        "control_uptime_seconds": state.started_at.elapsed().as_secs(),
    }))
}

async fn system_stats() -> Json<serde_json::Value> {
    let mut sys = System::new_all();
    sys.refresh_all();

    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "cpu_count": sys.cpus().len(),
        "cpu_usage_percent": if sys.cpus().is_empty() {
            0.0_f32
        } else {
            sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32
        },
        "memory_total_bytes": sys.total_memory(),
        "memory_used_bytes": sys.used_memory(),
        "memory_available_bytes": sys.available_memory(),
        "swap_total_bytes": sys.total_swap(),
        "swap_used_bytes": sys.used_swap(),
        "uptime_seconds": System::uptime(),
        "os_name": System::name().unwrap_or_default(),
        "os_version": System::os_version().unwrap_or_default(),
        "kernel_version": System::kernel_version().unwrap_or_default(),
        "hostname": System::host_name().unwrap_or_default(),
    }))
}

async fn list_services(State(state): State<AppState>) -> impl IntoResponse {
    match state
        .http
        .get(format!("{}/api/core/services", iora_core_url()))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(body) => Json(body).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn aggregate_logs() -> Json<serde_json::Value> {
    // Aggregate logs from each known service via its standard `/logs` endpoint.
    // If a remote LOG_AGGREGATOR_URL is configured, also forward the merged
    // payload there so external aggregators can ingest it.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok();

    let services: Vec<(&str, String)> = vec![
        ("iora-home", iora_home_url()),
        ("iora-core", iora_core_url()),
        ("iora-control", "http://localhost:8123".to_string()),
        (
            "iora-assist",
            std::env::var("IORA_ASSIST_URL")
                .unwrap_or_else(|_| "http://localhost:8129".to_string()),
        ),
        ("iora-supervisor", "http://localhost:8097".to_string()),
        ("iora-watchdog", "http://localhost:8095".to_string()),
    ];

    let mut entries: Vec<serde_json::Value> = Vec::new();
    if let Some(client) = client.as_ref() {
        for (name, base) in &services {
            // Try `/logs?lines=200` then `/api/<name>/logs?lines=200` as fallbacks.
            let candidates = [
                format!("{}/logs?lines=200", base.trim_end_matches('/')),
                format!(
                    "{}/api/{}/logs?lines=200",
                    base.trim_end_matches('/'),
                    name.trim_start_matches("iora-")
                ),
            ];
            let mut got = false;
            for url in &candidates {
                match client.get(url).send().await {
                    Ok(r) if r.status().is_success() => {
                        let body: serde_json::Value =
                            r.json().await.unwrap_or(serde_json::Value::Null);
                        entries.push(serde_json::json!({
                            "service": name,
                            "source": url,
                            "logs": body,
                        }));
                        got = true;
                        break;
                    }
                    _ => continue,
                }
            }
            if !got {
                entries.push(serde_json::json!({
                    "service": name,
                    "error": "service unreachable or no /logs endpoint",
                }));
            }
        }
    }

    let aggregated = serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "entries": entries,
    });

    // Optional forward to external aggregator (Loki, Elasticsearch, etc.).
    if let (Some(client), Ok(forward_url)) = (client.as_ref(), std::env::var("LOG_AGGREGATOR_URL"))
    {
        let _ = client.post(&forward_url).json(&aggregated).send().await;
    }

    Json(aggregated)
}

async fn list_plugins(State(state): State<AppState>) -> impl IntoResponse {
    match state
        .http
        .get(format!("{}/api/core/plugins", iora_core_url()))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(body) => Json(body).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn install_plugin(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    match state
        .http
        .post(format!("{}/api/core/plugins", iora_core_url()))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.json::<serde_json::Value>().await {
                Ok(b) => (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                    Json(b),
                )
                    .into_response(),
                Err(e) => (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": e.to_string() })),
                )
                    .into_response(),
            }
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn remove_plugin(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match state
        .http
        .delete(format!("{}/api/core/plugins/{}", iora_core_url(), id))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.json::<serde_json::Value>().await {
                Ok(b) => (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                    Json(b),
                )
                    .into_response(),
                Err(e) => (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": e.to_string() })),
                )
                    .into_response(),
            }
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn list_users(State(state): State<AppState>) -> impl IntoResponse {
    match state
        .http
        .get(format!("{}/api/users", iora_home_url()))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(body) => Json(body).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-home unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn get_config(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config.read().await.clone();
    Json(cfg)
}

async fn update_config(
    State(state): State<AppState>,
    Json(updates): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let mut cfg = state.config.write().await;
    if let (Some(obj), Some(upd)) = (cfg.as_object_mut(), updates.as_object()) {
        for (k, v) in upd {
            obj.insert(k.clone(), v.clone());
        }
    }
    Json(cfg.clone())
}

// ─── SSH Management ──────────────────────────────────────────────────────────

#[derive(serde::Deserialize, serde::Serialize)]
#[allow(dead_code)]
struct SSHStatus {
    enabled: bool,
    running: bool,
    port: u16,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct SSHUser {
    username: String,
    uid: u32,
    home: String,
    shell: String,
    has_ssh_key: bool,
}

#[derive(serde::Deserialize)]
struct EnableSSHRequest {
    enabled: bool,
}

#[derive(serde::Deserialize)]
struct CreateUserRequest {
    username: String,
    password: Option<String>,
    ssh_public_key: Option<String>,
}

/// Get SSH service status
async fn get_ssh_status() -> Json<serde_json::Value> {
    // Check if SSH service is enabled and running
    let enabled = Command::new("systemctl")
        .args(["is-enabled", "ssh"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let running = Command::new("systemctl")
        .args(["is-active", "ssh"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    // Default SSH port is 22
    let port = 22;

    Json(serde_json::json!({
        "enabled": enabled,
        "running": running,
        "port": port,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Enable or disable SSH service
async fn set_ssh_enabled(Json(req): Json<EnableSSHRequest>) -> impl IntoResponse {
    let action = if req.enabled { "enable" } else { "disable" };

    // Enable/disable SSH service
    let enable_result = Command::new("systemctl").args([action, "ssh"]).output();

    match enable_result {
        Ok(output) if output.status.success() => {
            // Start/stop the service
            let start_action = if req.enabled { "start" } else { "stop" };
            let start_result = Command::new("systemctl")
                .args([start_action, "ssh"])
                .output();

            match start_result {
                Ok(start_output) if start_output.status.success() => {
                    (
                        StatusCode::OK,
                        Json(serde_json::json!({
                            "success": true,
                            "enabled": req.enabled,
                            "message": format!("SSH service {} successfully", if req.enabled { "enabled" } else { "disabled" }),
                        })),
                    )
                        .into_response()
                }
                Ok(start_output) => {
                    let stderr = String::from_utf8_lossy(&start_output.stderr);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({
                            "success": false,
                            "error": format!("Failed to {} SSH service: {}", start_action, stderr),
                        })),
                    )
                        .into_response()
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to execute systemctl: {}", e),
                    })),
                )
                    .into_response(),
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to {} SSH service: {}", action, stderr),
                })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to execute systemctl: {}", e),
            })),
        )
            .into_response(),
    }
}

/// List SSH users (users with /home directories and valid shells)
async fn list_ssh_users() -> Json<serde_json::Value> {
    // Read /etc/passwd to get user list
    let passwd_content = match std::fs::read_to_string("/etc/passwd") {
        Ok(content) => content,
        Err(_) => {
            return Json(serde_json::json!({
                "users": [],
                "error": "Failed to read /etc/passwd",
            }));
        }
    };

    let mut users = Vec::new();

    for line in passwd_content.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 7 {
            let username = parts[0];
            let uid: u32 = parts[2].parse().unwrap_or(0);
            let home = parts[5];
            let shell = parts[6];

            // Only include real users (UID >= 1000, has valid shell, has /home dir)
            if (1000..65000).contains(&uid)
                && home.starts_with("/home")
                && !shell.contains("nologin")
                && !shell.contains("false")
            {
                // Check if user has SSH key
                let ssh_key_path = format!("{}/.ssh/authorized_keys", home);
                let has_ssh_key = std::path::Path::new(&ssh_key_path).exists();

                users.push(SSHUser {
                    username: username.to_string(),
                    uid,
                    home: home.to_string(),
                    shell: shell.to_string(),
                    has_ssh_key,
                });
            }
        }
    }

    Json(serde_json::json!({
        "users": users,
        "total": users.len(),
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Create a new SSH user
async fn create_ssh_user(Json(req): Json<CreateUserRequest>) -> impl IntoResponse {
    // Validate username
    if !req
        .username
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid username. Only alphanumeric characters, hyphens, and underscores are allowed.",
            })),
        )
            .into_response();
    }

    // Create user with useradd
    let mut cmd = Command::new("useradd");
    cmd.args([
        "-m", // Create home directory
        "-s",
        "/bin/bash", // Set shell to bash
        &req.username,
    ]);

    let result = cmd.output();

    match result {
        Ok(output) if output.status.success() => {
            // Set password if provided
            if let Some(password) = req.password {
                let passwd_result = Command::new("chpasswd")
                    .stdin(Stdio::piped())
                    .spawn()
                    .and_then(|mut child| {
                        if let Some(stdin) = child.stdin.as_mut() {
                            stdin.write_all(format!("{}:{}", req.username, password).as_bytes())?;
                        }
                        child.wait()
                    });

                if let Err(e) = passwd_result {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({
                            "success": false,
                            "error": format!("User created but failed to set password: {}", e),
                        })),
                    )
                        .into_response();
                }
            }

            // Add SSH key if provided
            if let Some(ssh_key) = req.ssh_public_key {
                let home_dir = format!("/home/{}", req.username);
                let ssh_dir = format!("{}/.ssh", home_dir);
                let authorized_keys = format!("{}/authorized_keys", ssh_dir);

                // Create .ssh directory
                let _ = std::fs::create_dir_all(&ssh_dir);

                // Write authorized_keys file
                if let Err(e) = std::fs::write(&authorized_keys, format!("{}\n", ssh_key)) {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({
                            "success": false,
                            "error": format!("User created but failed to add SSH key: {}", e),
                        })),
                    )
                        .into_response();
                }

                // Set permissions
                let _ = Command::new("chown")
                    .args([
                        "-R",
                        &format!("{}:{}", req.username, req.username),
                        &ssh_dir,
                    ])
                    .output();

                let _ = Command::new("chmod").args(["700", &ssh_dir]).output();

                let _ = Command::new("chmod")
                    .args(["600", &authorized_keys])
                    .output();
            }

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "success": true,
                    "message": format!("User '{}' created successfully", req.username),
                    "username": req.username,
                })),
            )
                .into_response()
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to create user: {}", stderr),
                })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to execute useradd: {}", e),
            })),
        )
            .into_response(),
    }
}

/// Delete an SSH user
async fn delete_ssh_user(Path(username): Path<String>) -> impl IntoResponse {
    // Validate username
    if !username
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid username",
            })),
        )
            .into_response();
    }

    // Delete user with userdel
    let result = Command::new("userdel")
        .args(["-r", &username]) // -r removes home directory
        .output();

    match result {
        Ok(output) if output.status.success() => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "message": format!("User '{}' deleted successfully", username),
            })),
        )
            .into_response(),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to delete user: {}", stderr),
                })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to execute userdel: {}", e),
            })),
        )
            .into_response(),
    }
}

// ─── OS-level management ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct HostnameRequest {
    hostname: String,
}

#[derive(Debug, Deserialize)]
struct PowerRequest {
    #[serde(default)]
    delay_seconds: Option<u32>,
    #[serde(default)]
    reason: Option<String>,
}

async fn list_disks() -> Json<serde_json::Value> {
    let disks = Disks::new_with_refreshed_list();
    let entries: Vec<serde_json::Value> = disks
        .iter()
        .map(|d| {
            let total = d.total_space();
            let available = d.available_space();
            let used = total.saturating_sub(available);
            let usage_percent = if total > 0 {
                (used as f64 / total as f64) * 100.0
            } else {
                0.0
            };
            serde_json::json!({
                "name": d.name().to_string_lossy(),
                "mount_point": d.mount_point().to_string_lossy(),
                "file_system": d.file_system().to_string_lossy(),
                "total_bytes": total,
                "available_bytes": available,
                "used_bytes": used,
                "usage_percent": usage_percent,
                "is_removable": d.is_removable(),
            })
        })
        .collect();

    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "disks": entries,
    }))
}

async fn list_network_interfaces() -> Json<serde_json::Value> {
    // Try iora-netctl first (available on IORA OS hosts).
    let netctl_output = tokio::process::Command::new("/usr/bin/iora-netctl")
        .args(["status"])
        .output()
        .await;

    if let Ok(out) = netctl_output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                // Include sysinfo stats alongside netctl data
                let networks = Networks::new_with_refreshed_list();
                let sysinfo_ifaces: Vec<serde_json::Value> = networks
                    .iter()
                    .map(|(name, data)| {
                        serde_json::json!({
                            "name": name,
                            "mac_address": data.mac_address().to_string(),
                            "received_bytes": data.total_received(),
                            "transmitted_bytes": data.total_transmitted(),
                        })
                    })
                    .collect();
                return Json(serde_json::json!({"netctl": json, "sysinfo": sysinfo_ifaces}));
            }
        }
    }

    // Fallback: use sysinfo only (non-IORA-OS or iora-netctl not installed).
    let networks = Networks::new_with_refreshed_list();
    let interfaces: Vec<serde_json::Value> = networks
        .iter()
        .map(|(name, data)| {
            serde_json::json!({
                "name": name,
                "mac_address": data.mac_address().to_string(),
                "received_bytes": data.total_received(),
                "transmitted_bytes": data.total_transmitted(),
                "received_packets": data.packets_received(),
                "transmitted_packets": data.packets_transmitted(),
                "errors_received": data.errors_on_received(),
                "errors_transmitted": data.errors_on_transmitted(),
            })
        })
        .collect();

    // Best-effort: read interface IPs via `ip -j addr` if available
    let mut ip_map = serde_json::Map::new();
    if let Ok(output) = Command::new("ip").args(["-j", "addr"]).output() {
        if output.status.success() {
            if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                if let Some(arr) = parsed.as_array() {
                    for entry in arr {
                        if let (Some(name), Some(addrs)) = (
                            entry.get("ifname").and_then(|v| v.as_str()),
                            entry.get("addr_info").and_then(|v| v.as_array()),
                        ) {
                            let ips: Vec<serde_json::Value> = addrs
                                .iter()
                                .filter_map(|a| {
                                    let local = a.get("local")?.as_str()?;
                                    let family =
                                        a.get("family").and_then(|v| v.as_str()).unwrap_or("");
                                    let prefix =
                                        a.get("prefixlen").and_then(|v| v.as_u64()).unwrap_or(0);
                                    Some(serde_json::json!({
                                        "address": local,
                                        "family": family,
                                        "prefix": prefix,
                                    }))
                                })
                                .collect();
                            ip_map.insert(name.to_string(), serde_json::Value::Array(ips));
                        }
                    }
                }
            }
        }
    }

    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "interfaces": interfaces,
        "ip_addresses": ip_map,
    }))
}

async fn list_top_processes() -> Json<serde_json::Value> {
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    sys.refresh_processes();

    let mut procs: Vec<_> = sys
        .processes()
        .iter()
        .map(|(pid, p)| {
            (
                pid.as_u32(),
                p.name().to_string(),
                p.cpu_usage(),
                p.memory(),
                p.virtual_memory(),
                p.run_time(),
            )
        })
        .collect();
    procs.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    procs.truncate(50);

    let entries: Vec<serde_json::Value> = procs
        .into_iter()
        .map(|(pid, name, cpu, mem, vmem, run)| {
            serde_json::json!({
                "pid": pid,
                "name": name,
                "cpu_percent": cpu,
                "memory_bytes": mem,
                "virtual_memory_bytes": vmem,
                "run_time_seconds": run,
            })
        })
        .collect();

    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "processes": entries,
    }))
}

async fn get_hostname() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "hostname": System::host_name().unwrap_or_default(),
    }))
}

async fn set_hostname(Json(req): Json<HostnameRequest>) -> impl IntoResponse {
    let new_name = req.hostname.trim();
    if new_name.is_empty()
        || new_name.len() > 64
        || !new_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid hostname",
            })),
        )
            .into_response();
    }

    // Try hostnamectl first (systemd), fall back to `hostname` command
    let result = Command::new("hostnamectl")
        .args(["set-hostname", new_name])
        .output();

    let success = match result {
        Ok(out) if out.status.success() => true,
        _ => Command::new("hostname")
            .arg(new_name)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false),
    };

    if !success {
        warn!("Failed to set hostname to {}", new_name);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": "Failed to apply hostname (requires root or IORA OS)",
            })),
        )
            .into_response();
    }

    // Persist to /etc/hostname (best effort)
    if let Ok(mut f) = std::fs::File::create("/etc/hostname") {
        let _ = f.write_all(format!("{}\n", new_name).as_bytes());
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "hostname": new_name,
        })),
    )
        .into_response()
}

fn schedule_power_command(action: &str, delay_seconds: u32) -> bool {
    // shutdown -r +<min>  or  shutdown -h +<min>
    let mins = std::cmp::max(1, delay_seconds.div_ceil(60));
    let flag = match action {
        "reboot" => "-r",
        _ => "-h",
    };
    let arg = format!("+{}", mins);
    Command::new("shutdown")
        .args([flag, &arg])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| true)
        .unwrap_or(false)
}

async fn os_reboot(Json(req): Json<PowerRequest>) -> impl IntoResponse {
    let delay = req.delay_seconds.unwrap_or(5);
    info!(
        "Reboot requested (delay={}s, reason={:?})",
        delay, req.reason
    );
    let scheduled = if delay == 0 {
        Command::new("systemctl")
            .arg("reboot")
            .spawn()
            .map(|_| true)
            .unwrap_or_else(|_| schedule_power_command("reboot", 5))
    } else {
        schedule_power_command("reboot", delay)
    };

    if scheduled {
        (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({
                "success": true,
                "action": "reboot",
                "delay_seconds": delay,
            })),
        )
            .into_response()
    } else {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": "Failed to schedule reboot (requires root or IORA OS)",
            })),
        )
            .into_response()
    }
}

async fn os_shutdown(Json(req): Json<PowerRequest>) -> impl IntoResponse {
    let delay = req.delay_seconds.unwrap_or(5);
    info!(
        "Shutdown requested (delay={}s, reason={:?})",
        delay, req.reason
    );
    let scheduled = if delay == 0 {
        Command::new("systemctl")
            .arg("poweroff")
            .spawn()
            .map(|_| true)
            .unwrap_or_else(|_| schedule_power_command("shutdown", 5))
    } else {
        schedule_power_command("shutdown", delay)
    };

    if scheduled {
        (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({
                "success": true,
                "action": "shutdown",
                "delay_seconds": delay,
            })),
        )
            .into_response()
    } else {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": "Failed to schedule shutdown (requires root or IORA OS)",
            })),
        )
            .into_response()
    }
}

/// POST /api/control/os/network/set — Apply network configuration via iora-netctl.
/// Only works on IORA OS hosts where /usr/bin/iora-netctl is installed.
pub async fn set_network_config(Json(config): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let normalized_config = normalize_network_config(config);
    let config_json = serde_json::to_string(&normalized_config).unwrap_or_default();

    let mut child = match tokio::process::Command::new("/usr/bin/iora-netctl")
        .args(["set", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return Json(serde_json::json!({
                "ok": false,
                "error": format!("Cannot run iora-netctl: {}", e),
                "note": "This API requires IORA OS with iora-netctl installed"
            }));
        }
    };

    // Write JSON config to stdin
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(config_json.as_bytes()).await.ok();
        stdin.flush().await.ok();
    }

    match child.wait_with_output().await {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            match serde_json::from_str::<serde_json::Value>(&stdout) {
                Ok(json) => Json(json),
                Err(_) => Json(serde_json::json!({"ok": true, "raw": stdout})),
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Json(serde_json::json!({
                "ok": false,
                "error": format!("iora-netctl failed: {}", stderr)
            }))
        }
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": format!("iora-netctl error: {}", e)
        })),
    }
}

fn normalize_network_config(mut config: serde_json::Value) -> serde_json::Value {
    let Some(obj) = config.as_object_mut() else {
        return config;
    };

    let ipv4_config = obj.get("ipv4_config").cloned();
    if let Some(ipv4) = ipv4_config.and_then(|value| value.as_object().cloned()) {
        copy_string_field(&mut *obj, &ipv4, "address", "ipv4");
        copy_string_field(&mut *obj, &ipv4, "gateway", "gateway4");
        merge_dns_field(&mut *obj, ipv4.get("dns"));
    }

    let ipv6_config = obj.get("ipv6_config").cloned();
    if let Some(ipv6) = ipv6_config.and_then(|value| value.as_object().cloned()) {
        copy_string_field(&mut *obj, &ipv6, "address", "ipv6");
        copy_string_field(&mut *obj, &ipv6, "gateway", "gateway6");
        merge_dns_field(&mut *obj, ipv6.get("dns"));
    }

    config
}

fn copy_string_field(
    target: &mut serde_json::Map<String, serde_json::Value>,
    source: &serde_json::Map<String, serde_json::Value>,
    source_key: &str,
    target_key: &str,
) {
    if target.contains_key(target_key) {
        return;
    }
    let Some(value) = source.get(source_key).and_then(|value| value.as_str()) else {
        return;
    };
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        target.insert(target_key.to_string(), serde_json::json!(trimmed));
    }
}

fn merge_dns_field(
    target: &mut serde_json::Map<String, serde_json::Value>,
    dns_value: Option<&serde_json::Value>,
) {
    let Some(items) = dns_value.and_then(|value| value.as_array()) else {
        return;
    };

    let mut merged: Vec<String> = target
        .get("dns")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::trim))
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();

    for item in items {
        let Some(value) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if !merged.iter().any(|existing| existing == value) {
            merged.push(value.to_string());
        }
    }

    if !merged.is_empty() {
        target.insert("dns".to_string(), serde_json::json!(merged));
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_control=debug,info".parse().unwrap()),
        )
        .init();

    storage_jobs::initialize().await;
    let state = AppState::new();

    // Protected API routes (require authentication)
    let protected_routes = Router::new()
        .route("/api/control/dashboard", get(dashboard_overview))
        .route("/api/control/system", get(system_stats))
        .route("/api/control/services", get(list_services))
        .route("/api/control/logs", get(aggregate_logs))
        .route(
            "/api/control/plugins",
            get(list_plugins).post(install_plugin),
        )
        .route("/api/control/plugins/:id", delete(remove_plugin))
        .route("/api/control/users", get(list_users))
        .route("/api/control/config", get(get_config).put(update_config))
        // SSH Management
        .route("/api/control/ssh/status", get(get_ssh_status))
        .route(
            "/api/control/ssh/enable",
            axum::routing::post(set_ssh_enabled),
        )
        .route(
            "/api/control/ssh/users",
            get(list_ssh_users).post(create_ssh_user),
        )
        .route("/api/control/ssh/users/:username", delete(delete_ssh_user))
        // OS-level management (only useful when running on IORA OS)
        .route("/api/control/os/disks", get(list_disks))
        .route("/api/control/os/storage/inventory", get(storage_inventory::inventory))
        .route("/api/control/os/storage/nas", get(nas_inventory::inventory))
        .route("/api/control/os/storage/nas/plan", post(nas_inventory::plan))
        .route("/api/control/os/storage/nas/execute", post(nas_inventory::execute))
        .route("/api/control/os/storage/raid/plan", post(storage_inventory::plan))
        .route("/api/control/os/storage/raid/execute", post(storage_jobs::execute))
        .route("/api/control/os/storage/jobs", get(storage_jobs::list))
        .route("/api/control/os/storage/jobs/:id", get(storage_jobs::get))
        .route("/api/control/os/network", get(list_network_interfaces))
        .route("/api/control/os/network/set", post(set_network_config))
        .route("/api/control/os/processes", get(list_top_processes))
        .route(
            "/api/control/os/hostname",
            get(get_hostname).put(set_hostname),
        )
        .route("/api/control/os/reboot", post(os_reboot))
        .route("/api/control/os/shutdown", post(os_shutdown))
        .layer(middleware::from_fn_with_state(
            state.auth_state.clone(),
            auth::auth_middleware,
        ));

    // WebSocket route (separate state)
    let ws_router = Router::new()
        .route("/ws", get(ws::ws_handler))
        .with_state(state.ws_state.clone());

    // Public routes
    let app = Router::new()
        .route("/health", get(health))
        .merge(ws_router)
        .merge(protected_routes)
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    // Spawn background tasks
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            state.cache.cleanup_expired();
        }
    });

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8091));
    info!("iora-control listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let _hb = iora_shared_heartbeat::spawn_default(
        "iora-control",
        addr.port(),
        "Administrative control panel",
    );
    axum::serve(listener, app).await?;

    Ok(())
}
