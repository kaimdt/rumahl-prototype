use std::{io::Write, process::{Command, Stdio}, sync::Arc, time::Instant};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get},
    Json, Router,
};
use chrono::Utc;
use sysinfo::System;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::info;

const IORA_CORE_URL: &str = "http://localhost:8090";
const IORA_HOME_URL: &str = "http://localhost:8080";

#[derive(Clone)]
struct AppState {
    http: reqwest::Client,
    config: Arc<RwLock<serde_json::Value>>,
    started_at: Arc<Instant>,
}

impl AppState {
    fn new() -> Self {
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
            .get(format!("{}/api/core/services", IORA_CORE_URL))
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
            .get(format!("{}/api/core/plugins", IORA_CORE_URL))
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
        .get(format!("{}/api/core/services", IORA_CORE_URL))
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
    // Placeholder – in production this would collect logs from all services
    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "message": "Log aggregation not yet implemented. Configure a log forwarder to aggregate logs from all IORA services.",
        "services": ["iora-home", "iora-core", "iora-control", "iora-assist"],
        "hint": "Set LOG_AGGREGATOR_URL in your environment to enable log forwarding.",
    }))
}

async fn list_plugins(State(state): State<AppState>) -> impl IntoResponse {
    match state
        .http
        .get(format!("{}/api/core/plugins", IORA_CORE_URL))
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
        .post(format!("{}/api/core/plugins", IORA_CORE_URL))
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

async fn remove_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state
        .http
        .delete(format!("{}/api/core/plugins/{}", IORA_CORE_URL, id))
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
        .get(format!("{}/api/users", IORA_HOME_URL))
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
        .args(&["is-enabled", "ssh"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let running = Command::new("systemctl")
        .args(&["is-active", "ssh"])
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
    let enable_result = Command::new("systemctl")
        .args(&[action, "ssh"])
        .output();

    match enable_result {
        Ok(output) if output.status.success() => {
            // Start/stop the service
            let start_action = if req.enabled { "start" } else { "stop" };
            let start_result = Command::new("systemctl")
                .args(&[start_action, "ssh"])
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
            if uid >= 1000
                && uid < 65000
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
    if !req.username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
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
    cmd.args(&[
        "-m",  // Create home directory
        "-s", "/bin/bash",  // Set shell to bash
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
                    .args(&["-R", &format!("{}:{}", req.username, req.username), &ssh_dir])
                    .output();

                let _ = Command::new("chmod")
                    .args(&["700", &ssh_dir])
                    .output();

                let _ = Command::new("chmod")
                    .args(&["600", &authorized_keys])
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
    if !username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
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
        .args(&["-r", &username])  // -r removes home directory
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

    let state = AppState::new();

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/control/dashboard", get(dashboard_overview))
        .route("/api/control/system", get(system_stats))
        .route("/api/control/services", get(list_services))
        .route("/api/control/logs", get(aggregate_logs))
        .route("/api/control/plugins", get(list_plugins).post(install_plugin))
        .route("/api/control/plugins/:id", delete(remove_plugin))
        .route("/api/control/users", get(list_users))
        .route("/api/control/config", get(get_config).put(update_config))
        // SSH Management
        .route("/api/control/ssh/status", get(get_ssh_status))
        .route("/api/control/ssh/enable", axum::routing::post(set_ssh_enabled))
        .route("/api/control/ssh/users", get(list_ssh_users).post(create_ssh_user))
        .route("/api/control/ssh/users/:username", delete(delete_ssh_user))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8091));
    info!("iora-control listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
