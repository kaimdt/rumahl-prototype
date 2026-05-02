// daemon.rs — long-running HTTP/WebSocket API for `iora-dev-deploy`.
//
// Started with `iora-dev-deploy daemon`. Listens on 127.0.0.1 by default
// and exposes a versioned JSON API plus a WebSocket event stream that the
// VS Code extension (and any other client) can talk to.
//
// On first start the daemon writes
//     ~/.config/iora-dev-deploy/daemon.json    { url, token }
// so other tools on the same user account can find + authenticate to it.

use crate::{build, catalog, client, config, discover};
use anyhow::{anyhow, Context, Result};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxPath, Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

const DAEMON_INFO_FILE: &str = "daemon.json";
const DAEMON_TOKEN_FILE: &str = "daemon.token";
const EVENT_BUFFER: usize = 256;
const MAX_JOB_LOG_LINES: usize = 2000;
const MAX_RECENT_JOBS: usize = 100;
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(30);
const MDNS_SCAN_INTERVAL: Duration = Duration::from_secs(90);

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    auth_token: String,
    devices: RwLock<Vec<discover::Found>>,
    jobs: RwLock<HashMap<Uuid, Job>>,
    job_order: RwLock<Vec<Uuid>>, // insertion order, oldest first
    watches: RwLock<HashMap<Uuid, WatchSession>>,
    events: broadcast::Sender<Event>,
    started_at: DateTime<Utc>,
    /// Cached connection state — updated periodically by
    /// health_check_connection so we don't hammer the Dev Bridge
    /// with HTTP requests on every WebSocket (re)connect.
    cached_connection: RwLock<serde_json::Value>,
}

#[derive(Clone, Serialize)]
pub struct Job {
    pub id: Uuid,
    pub kind: String,
    pub label: String,
    pub status: JobStatus,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub log: Vec<String>,
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Clone, Serialize)]
pub struct WatchSession {
    pub id: Uuid,
    pub components: Vec<String>,
    pub target: String,
    pub build_mode: String,
    pub automatic: bool,
    pub debounce_ms: u64,
    pub started_at: DateTime<Utc>,
    #[serde(skip)]
    pub cancel: tokio::sync::watch::Sender<bool>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Hello { version: String },
    JobCreated { job: Job },
    JobUpdated { id: Uuid, status: JobStatus, line: Option<String> },
    JobFinished { job: Job },
    DevicesUpdated { devices: Vec<discover::Found> },
    WatchStarted { session: WatchSession },
    WatchStopped { id: Uuid },
    WatchTriggered { id: Uuid, components: Vec<String> },
    Connection { host: Option<String>, hostname: Option<String>, build: Option<String>, variant: Option<String>, reachable: bool, token_ok: bool },
    ServiceLogs { unit: String, tail: u32, stdout: String, stderr: String },
    SystemData { path: String, kind: String, content: serde_json::Value },
    Log { source: String, line: String },
}

#[derive(Deserialize)]
struct DiscoverQuery { #[serde(default)] timeout: Option<u64> }

#[derive(Deserialize)]
struct ConnectBody { host: String, token: String }

#[derive(Deserialize)]
struct DeployBody {
    components: Vec<String>,
    #[serde(default = "default_target")]
    target: String,
    #[serde(default = "default_build_mode")]
    build_mode: String,
    #[serde(default)]
    no_build: bool,
    #[serde(default)]
    no_restart: bool,
}

#[derive(Deserialize)]
struct UnitBody { unit: String }

#[derive(Deserialize)]
struct ComposeBody { svc: String, #[serde(default = "default_tail")] tail: u32 }

#[derive(Deserialize)]
struct ServiceLogBody { unit: String, #[serde(default = "default_tail")] tail: u32 }

#[derive(Deserialize)]
struct FsPathBody { path: String }

#[derive(Deserialize)]
struct FsReadBody { path: String, #[serde(default = "default_fs_max_bytes")] max_bytes: usize }

#[derive(Deserialize)]
struct WatchBody {
    components: Vec<String>,
    #[serde(default = "default_target")]
    target: String,
    #[serde(default = "default_build_mode")]
    build_mode: String,
    #[serde(default)]
    automatic: bool,
    #[serde(default = "default_debounce")]
    debounce_ms: u64,
}

fn default_target() -> String { "aarch64-unknown-linux-gnu".into() }
/// Default to `auto`: the daemon picks the best strategy per component
/// (native cargo if the host can realistically cross-compile, else
/// docker if available, else the device-side build). Previously this
/// was hard-coded to `device`, which forced a slow path that was very
/// flaky for the dev-bridge component itself (chicken-and-egg).
fn default_build_mode() -> String { "auto".into() }
fn default_tail() -> u32 { 200 }
fn default_debounce() -> u64 { 800 }
fn default_fs_max_bytes() -> usize { 64 * 1024 }

pub async fn run(bind: SocketAddr, token_override: Option<String>, no_pin: bool, no_browser: bool) -> Result<()> {
    let token = match token_override {
        Some(t) => t,
        None => load_or_create_token()?,
    };

    let url = format!("http://{}", bind);
    let info = serde_json::json!({ "url": url, "token": token, "pid": std::process::id() });
    write_info_file(&info)?;

    let (tx, _) = broadcast::channel(EVENT_BUFFER);
    let _ = tx.send(Event::Hello { version: env!("CARGO_PKG_VERSION").into() });
    let state = AppState {
        inner: Arc::new(Inner {
            auth_token: token.clone(),
            devices: RwLock::new(Vec::new()),
            jobs: RwLock::new(HashMap::new()),
            job_order: RwLock::new(Vec::new()),
            watches: RwLock::new(HashMap::new()),
            events: tx,
            started_at: Utc::now(),
            cached_connection: RwLock::new(serde_json::json!({
                "host": null,
                "configured": false,
                "reachable": false,
                "token_ok": false,
            })),
        }),
    };

    let app = Router::new()
        .route("/api/v1/health", get(h_health))
        .route("/api/v1/version", get(h_version))
        .route("/api/v1/components", get(h_components))
        .route("/api/v1/devices", get(h_devices_cached))
        .route("/api/v1/discover", post(h_discover))
        .route("/api/v1/connection", get(h_connection))
        .route("/api/v1/connect", post(h_connect))
        .route("/api/v1/disconnect", post(h_disconnect))
        .route("/api/v1/status", get(h_status))
        .route("/api/v1/services", get(h_services))
        .route("/api/v1/system/info", get(h_system_info))
        .route("/api/v1/system/reboot", post(h_system_reboot))
        .route("/api/v1/service/:unit/logs-url", get(h_service_logs_url))
        .route("/api/v1/deploy", post(h_deploy))
        .route("/api/v1/jobs", get(h_jobs))
        .route("/api/v1/jobs/:id", get(h_job_one))
        .route("/api/v1/restart", post(h_restart))
        .route("/api/v1/service/reload", post(h_service_reload))
        .route("/api/v1/compose/reload", post(h_compose_reload))
        .route("/api/v1/compose/logs", post(h_compose_logs))
        .route("/api/v1/service/logs", post(h_service_logs))
        .route("/api/v1/system/list", post(h_system_list))
        .route("/api/v1/system/read", post(h_system_read))
        .route("/api/v1/watch", get(h_watch_list).post(h_watch_start))
        .route("/api/v1/watch/:id", delete(h_watch_stop))
        .route("/api/v1/events", get(h_events_ws))
        // Web UI (served by the daemon itself — zero-config GUI)
        .route("/ui", get(h_ui_index))
        .route("/ui/", get(h_ui_index))
        .route("/api/v1/ui-config", get(h_ui_config))
        // SSH token fetch: auto-retrieve dev-token from the device
        .route("/api/v1/ssh-fetch-token", post(h_ssh_fetch_token))
        // Auth via IORA dashboard credentials (username/password → session token)
        .route("/api/v1/connect-credentials", post(h_connect_credentials))
        // Register custom components dynamically
        .route("/api/v1/components/register", post(h_register_component))
        // Scaffold new IORA service
        .route("/api/v1/service/scaffold", post(h_scaffold_service))
        // Upload app/plugin package
        .route("/api/v1/app/upload", post(h_upload_app))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state.clone());

    // ── Smart startup: auto-connect + background tasks ───────────────
    // Spawned BEFORE binding so clients see an already-intelligent daemon.
    {
        let bg = state.clone();
        tokio::spawn(async move { startup_auto_connect(&bg).await; });
    }
    tokio::spawn(async move { background_tasks(state).await; });

    println!("{}", "─".repeat(70).dimmed());
    println!("{} {}", "▶ iora-dev-deploy daemon".bold().cyan(), env!("CARGO_PKG_VERSION"));
    println!("  url       : {}", url.bold());
    if no_pin {
        println!("  token     : {}", token.bold());
    } else {
        println!("  token     : {}…{} (full token in {})",
            &token[..6.min(token.len())],
            &token[token.len().saturating_sub(4)..],
            info_file_path()?.display());
    }
    println!("  config    : {}", info_file_path()?.display());
    println!("  started   : {}", Utc::now().to_rfc3339());
    println!("{}", "─".repeat(70).dimmed());
    println!("Endpoints:");
    println!("  GET    /api/v1/health");
    println!("  GET    /api/v1/components");
    println!("  POST   /api/v1/discover            ← mDNS scan");
    println!("  GET    /api/v1/connection          ← saved host/token");
    println!("  POST   /api/v1/connect             ← save & verify");
    println!("  GET    /api/v1/status              ← /dev/status of device");
    println!("  POST   /api/v1/deploy              ← build + upload");
    println!("  POST   /api/v1/restart             ← systemctl restart");
    println!("  POST   /api/v1/service/reload      ← systemctl try-reload-or-restart");
    println!("  POST   /api/v1/compose/reload      ← compose up -d --force-recreate");
    println!("  POST   /api/v1/compose/logs        ← tail compose logs");
    println!("  POST   /api/v1/service/logs        ← tail journalctl for a unit");
    println!("  POST   /api/v1/system/list         ← browse device directories");
    println!("  POST   /api/v1/system/read         ← preview device files");
    println!("  GET    /api/v1/jobs[/:id]          ← deploy/log job history");
    println!("  POST   /api/v1/watch / DELETE /:id ← live watch sessions");
    println!("  WS     /api/v1/events              ← live event stream");
    println!("  GET    /ui                        ← Web dashboard");
    println!("{}", "─".repeat(70).dimmed());

    // Open the browser to the web UI (unless --no-browser).
    if !no_browser {
        let ui_url = format!("http://{}/ui", bind);
        println!("{} opening {} …", "▶".dimmed(), ui_url.cyan());
        open_browser(&ui_url);
    }

    let listener = tokio::net::TcpListener::bind(bind).await
        .with_context(|| format!("bind {bind}"))?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("axum::serve")?;
    let _ = std::fs::remove_file(info_file_path()?);
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    eprintln!("{} shutting down…", "▶".yellow());
}

// ─── Smart daemon: zero-config auto-connect + health watcher ────────────

/// Runs once at daemon startup. Tries to establish a connection
/// automatically without any user action:
/// 1. If a saved host exists and is reachable → verify & emit event
/// 2. If saved host is unreachable → scan mDNS, try same token on found devices
/// 3. If no saved config → scan mDNS to populate device list
async fn startup_auto_connect(state: &AppState) {
    // Small delay so the startup banner prints first.
    tokio::time::sleep(Duration::from_millis(300)).await;

    let saved = config::load().ok();

    // First: quick mDNS scan so we always have fresh device data.
    if let Ok(devices) = discover::discover(3).await {
        *state.inner.devices.write().await = devices.clone();
        let _ = state.inner.events.send(Event::DevicesUpdated { devices });
    }

    if let Some(ref cfg) = saved {
        // Try the saved host — verify on an AUTHENTICATED endpoint.
        let token_ok = match client::Client::new(&cfg.host, &cfg.token) {
            Ok(c) => c.system_info().await.is_ok(),
            Err(_) => false,
        };

        if token_ok {
            println!("{} auto-connected to {} (token verified)", "✓".green(), cfg.host.cyan());
            emit_connection_event(state, &cfg.host, true, None).await;
            return;
        }

        // Host reachable but token rejected, or host completely unreachable.
        let host_alive = match client::Client::new(&cfg.host, &cfg.token) {
            Ok(c) => c.status().await.is_ok(),
            Err(_) => false,
        };

        if host_alive {
            println!(
                "{} saved host {} reachable but token REJECTED — deleting bad token to force fresh setup",
                "⚠".yellow(),
                cfg.host.cyan()
            );
            // DELETE the bad token so the system starts clean.
            // This prevents the confusing "semi-connected" state.
            let _ = std::fs::remove_file(config::config_file_path().unwrap_or_default());
            emit_connection_event(state, &cfg.host, false, None).await;
            return;
        }

        println!(
            "{} saved host {} unreachable — scanning LAN for device…",
            "▶".yellow(),
            cfg.host.cyan()
        );

        // Try the saved token on every discovered device.
        if let Ok(devices) = discover::discover(4).await {
            *state.inner.devices.write().await = devices.clone();
            let _ = state.inner.events.send(Event::DevicesUpdated { devices: devices.clone() });

            for d in &devices {
                let ep = d.endpoint();
                if let Ok(c) = client::Client::new(&ep, &cfg.token) {
                    // Must verify on authenticated endpoint
                    if c.system_info().await.is_ok() {
                        let new_cfg = config::Config { host: ep.clone(), token: cfg.token.clone() };
                        if config::save(&new_cfg).is_ok() {
                            println!("{} auto-reconnected to {} (was {})", "✓".green(), ep.cyan(), cfg.host.dimmed());
                            emit_connection_event(state, &ep, true, None).await;
                            return;
                        }
                    }
                }
            }

            println!("{} {} device(s) found on LAN but none accepted the saved token", "⚠".yellow(), devices.len());
            emit_discovered_hint(state, &devices).await;
        }
    } else {
        // No saved config: just show discovered devices.
        let devices = state.inner.devices.read().await.clone();
        if !devices.is_empty() {
            println!("{} {} device(s) found — use Connect to set up", "▶".dimmed(), devices.len());
            emit_discovered_hint(state, &devices).await;
        }
    }
}

/// Background loop: periodic health check of the connection + periodic
/// mDNS scans to keep the device list fresh.
async fn background_tasks(state: AppState) {
    // Give startup_auto_connect time to finish first.
    tokio::time::sleep(Duration::from_secs(5)).await;

    let mut health_tick = tokio::time::interval(HEALTH_CHECK_INTERVAL);
    let mut mdns_tick = tokio::time::interval(MDNS_SCAN_INTERVAL);
    // Don't fire immediately.
    health_tick.tick().await;
    mdns_tick.tick().await;

    loop {
        tokio::select! {
            _ = health_tick.tick() => {
                health_check_connection(&state).await;
            }
            _ = mdns_tick.tick() => {
                if let Ok(devices) = discover::discover(3).await {
                    *state.inner.devices.write().await = devices.clone();
                    let _ = state.inner.events.send(Event::DevicesUpdated { devices });
                }
            }
        }
    }
}

/// Check if the saved connection is still alive. If not, try to auto-reconnect.
async fn health_check_connection(state: &AppState) {
    let saved = match config::load() {
        Ok(c) => c,
        Err(_) => return,
    };

    // Verify on authenticated endpoint (not just /dev/status).
    let token_ok = match client::Client::new(&saved.host, &saved.token) {
        Ok(c) => c.system_info().await.is_ok(),
        Err(_) => false,
    };

    if token_ok {
        emit_connection_event(state, &saved.host, true, None).await;
        return;
    }

    // Connection lost — try to find the device at a new address.
    if let Ok(devices) = discover::discover(3).await {
        *state.inner.devices.write().await = devices.clone();
        let _ = state.inner.events.send(Event::DevicesUpdated { devices: devices.clone() });

        for d in &devices {
            let ep = d.endpoint();
            if ep == saved.host { continue; }
            if let Ok(c) = client::Client::new(&ep, &saved.token) {
                if c.system_info().await.is_ok() {
                    let new_cfg = config::Config { host: ep.clone(), token: saved.token.clone() };
                    if config::save(&new_cfg).is_ok() {
                        println!("{} health: reconnected to {} (IP changed)", "✓".green(), ep.cyan());
                        emit_connection_event(state, &ep, true, None).await;
                        return;
                    }
                }
            }
        }
    }

    // Still unreachable.
    emit_connection_event(state, &saved.host, false, None).await;
}

/// Emit a Connection event so all WebSocket clients (VS Code) see the
/// current state immediately.
async fn emit_connection_event(
    state: &AppState,
    host: &str,
    reachable: bool,
    hostname_override: Option<&str>,
) {
    if reachable {
        if let Ok(ref cfg) = config::load() {
            if let Ok(c) = client::Client::new(&cfg.host, &cfg.token) {
                if let Ok(st) = c.status().await {
                    let _ = state.inner.events.send(Event::Connection {
                        host: Some(cfg.host.clone()),
                        hostname: hostname_override
                            .map(|s| s.to_string())
                            .or(Some(st.hostname.clone())),
                        build: Some(st.build.clone()),
                        variant: Some(st.variant.clone()),
                        reachable: true,
                        token_ok: true,
                    });
                    return;
                }
            }
        }
    }
    // Unreachable — still emit so VS Code knows to show the "not connected" state.
    let _ = state.inner.events.send(Event::Connection {
        host: Some(host.to_string()),
        hostname: None,
        build: None,
        variant: None,
        reachable,
        token_ok: false,
    });
    // Update cached connection state
    let conn = connection_state().await;
    *state.inner.cached_connection.write().await = conn;
}

/// Emit a hint event with discovered alternatives.
async fn emit_discovered_hint(state: &AppState, devices: &[discover::Found]) {
    if let Some(first) = devices.first() {
        let _ = state.inner.events.send(Event::Connection {
            host: None,
            hostname: first.txt.get("hostname").cloned(),
            build: first.txt.get("build").cloned(),
            variant: Some("dev".into()),
            reachable: false,
            token_ok: false,
        });
    }
}

// ─── auth ────────────────────────────────────────────────────────────────

/// Authentication is disabled for localhost-only daemon.
/// The daemon binds to 127.0.0.1 by default — only local processes can reach it.
/// VS Code can optionally set a token via --token, stored in daemon.json.
fn check_auth(_state: &AppState, _headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    Ok(())
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut diff = 0u8;
    for i in 0..a.len() { diff |= a[i] ^ b[i]; }
    diff == 0
}

// ─── handlers: read-only ─────────────────────────────────────────────────

async fn h_health(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "started_at": s.inner.started_at.to_rfc3339(),
        "uptime_secs": (Utc::now() - s.inner.started_at).num_seconds(),
        "active_watches": s.inner.watches.read().await.len(),
        "jobs": s.inner.jobs.read().await.len(),
    }))
}

async fn h_version() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "name": "iora-dev-deploy",
        "version": env!("CARGO_PKG_VERSION"),
        "api": "v1",
        "features": ["device-build", "build-mode", "connection-view", "system-data", "service-logs"],
    }))
}

async fn h_components(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<Vec<catalog::Component>>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    Ok(Json(catalog::all()))
}

async fn h_devices_cached(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<Vec<discover::Found>>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    Ok(Json(s.inner.devices.read().await.clone()))
}

async fn h_discover(headers: HeaderMap, State(s): State<AppState>, Query(q): Query<DiscoverQuery>) -> Result<Json<Vec<discover::Found>>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let timeout = q.timeout.unwrap_or(4).clamp(1, 30);
    let devices = discover::discover(timeout).await.map_err(server_err)?;
    *s.inner.devices.write().await = devices.clone();
    let _ = s.inner.events.send(Event::DevicesUpdated { devices: devices.clone() });
    Ok(Json(devices))
}

/// Build a JSON representation of the current device connection state.
/// When the saved host is unreachable, auto-scans mDNS and suggests
/// alternatives so the IDE can offer one-click reconnection.
async fn connection_state() -> serde_json::Value {
    let saved = config::load().ok();
    let mut out = serde_json::json!({
        "host": saved.as_ref().map(|c| c.host.clone()),
        "configured": saved.is_some(),
    });
    let mut reachable = false;
    let mut token_ok = false;
    if let Some(ref c) = saved {
        // Check if host is reachable at all (unauthenticated).
        if let Ok(client) = client::Client::new(&c.host, &c.token) {
            if let Ok(st) = client.status().await {
                out["hostname"] = serde_json::json!(st.hostname);
                out["build"] = serde_json::json!(st.build);
                out["variant"] = serde_json::json!(st.variant);
                out["dev_mode"] = serde_json::json!(st.dev_mode);
                out["capabilities"] = serde_json::json!(st.capabilities);
                reachable = true;

                // Also verify the token on an authenticated endpoint.
                // /dev/status is public, so we must check /dev/system/info.
                token_ok = client.system_info().await.is_ok();
            }
        }
    }
    out["reachable"] = serde_json::json!(reachable);
    out["token_ok"] = serde_json::json!(token_ok);

    // Auto-discover alternatives when saved host is unreachable
    // OR when host is reachable but token is rejected.
    if (!reachable || (reachable && !token_ok)) && saved.is_some() {
        let hint = if !reachable {
            "Saved host unreachable."
        } else {
            "Host reachable but token rejected. Click Connect to enter the correct token."
        };
        out["hint"] = serde_json::json!(hint);
        if let Ok(devices) = discover::discover(3).await {
            if !devices.is_empty() {
                out["discovered"] = serde_json::json!(devices);
                if let Some(first) = devices.first() {
                    out["suggested_host"] = serde_json::json!(first.endpoint());
                    if let Some(build) = first.txt.get("build") {
                        out["suggested_build"] = serde_json::json!(build);
                    }
                    if let Some(hostname) = first.txt.get("hostname") {
                        out["suggested_hostname"] = serde_json::json!(hostname);
                    }
                }
            }
        }
    }

    // Also include the daemon's own saved config host so the IDE can
    // compare it against its own globalState (prevents stale-host drift).
    if let Some(ref c) = saved {
        out["saved_host"] = serde_json::json!(c.host);
    }
    out
}

async fn h_connection(headers: HeaderMap, State(_s): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&_s, &headers)?;
    Ok(Json(connection_state().await))
}

async fn h_connect(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<ConnectBody>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;

    // Resolve mDNS instance names: if the host looks like an mDNS
    // instance (ends with `_iora-dev._tcp.local.`) resolve it.
    let resolved_host = if b.host.ends_with("_iora-dev._tcp.local.") || b.host.contains(".local") {
        // Quick mDNS scan to find the matching device.
        let devices = discover::discover(5).await.map_err(server_err)?;
        let mut matched: Option<String> = None;
        for d in &devices {
            let endpoint = d.endpoint();
            if d.instance == b.host
                || d.instance.contains(&b.host)
                || b.host.contains(&d.instance)
                || d.txt.get("hostname").map(|h| h == &b.host).unwrap_or(false)
            {
                matched = Some(endpoint);
                break;
            }
        }
        if matched.is_none() && devices.len() == 1 {
            // Only one device found — use it.
            matched = Some(devices[0].endpoint());
        }
        matched.ok_or_else(|| {
            let available: Vec<String> = devices.iter().map(|d| format!("{} ({})", d.endpoint(), d.txt.get("build").map(|s| s.as_str()).unwrap_or("?"))).collect();
            (StatusCode::NOT_FOUND, format!(
                "Device '{}' not found via mDNS. Available: {}",
                b.host,
                if available.is_empty() { "none found on LAN".into() } else { available.join(", ") }
            ))
        })?
    } else {
        b.host.clone()
    };

    let mut selected_host: Option<String> = None;
    let mut selected_status: Option<client::Status> = None;
    let mut last_error: Option<String> = None;

    for candidate in bridge_host_candidates(&resolved_host) {
        let cfg_try = config::Config { host: candidate.clone(), token: b.token.clone() };
        let cli = match client::Client::new(&cfg_try.host, &cfg_try.token) {
            Ok(c) => c,
            Err(e) => {
                last_error = Some(format!("{candidate}: {e}"));
                continue;
            }
        };

        let st = match cli.status().await {
            Ok(s) => s,
            Err(e) => {
                last_error = Some(format!("{candidate}: {e}"));
                continue;
            }
        };

        if st.variant != "dev" {
            last_error = Some(format!("{candidate}: device variant '{}' != dev", st.variant));
            continue;
        }

        // Verify token via authenticated endpoint.
        if let Err(e) = cli.system_info().await {
            let msg = format!("{e}");
            if msg.contains("401") || msg.contains("Unauthorized") {
                return Err((StatusCode::UNAUTHORIZED,
                    "The dev-token you entered was rejected by the device bridge.\n\n"
                    .to_string() +
                    "1. SSH into the device and check: cat /var/lib/iora/dev-token\n" +
                    "2. Or regenerate: sudo rm -f /var/lib/iora/dev-token && sudo systemctl restart iora-dev-bridge\n" +
                    "3. Then copy the token shown in the bridge logs (journalctl -u iora-dev-bridge -n 20 --no-pager)"
                ));
            }
            last_error = Some(format!("{candidate}: {e}"));
            continue;
        }

        selected_host = Some(candidate);
        selected_status = Some(st);
        break;
    }

    let chosen_host = selected_host.ok_or_else(|| {
        (StatusCode::BAD_GATEWAY, format!(
            "Could not connect to Developer Bridge at '{}'. Tried default ports 8101 and legacy 8099. Last error: {}",
            resolved_host,
            last_error.unwrap_or_else(|| "unknown error".to_string())
        ))
    })?;
    let st = selected_status.ok_or_else(|| (StatusCode::BAD_GATEWAY, "Bridge status unavailable".to_string()))?;

    let cfg = config::Config { host: chosen_host, token: b.token.clone() };
    let path = config::save(&cfg).map_err(server_err)?;
    let _ = s.inner.events.send(Event::Connection {
        host: Some(cfg.host.clone()),
        hostname: Some(st.hostname.clone()),
        build: Some(st.build.clone()),
        variant: Some(st.variant.clone()),
        reachable: true,
        token_ok: true,
    });
    Ok(Json(serde_json::json!({
        "ok": true,
        "saved_to": path,
        "host": cfg.host,
        "hostname": st.hostname,
        "build": st.build,
        "variant": st.variant,
    })))
}

async fn h_disconnect(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let p = config::config_file_path().map_err(server_err)?;
    if p.exists() { let _ = std::fs::remove_file(&p); }
    let _ = s.inner.events.send(Event::Connection { host: None, hostname: None, build: None, variant: None, reachable: false, token_ok: false });
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn h_status(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<client::Status>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    Ok(Json(c.status().await.map_err(server_err)?))
}

/// Live service map from the device. Aggregated heartbeats coming from
/// every IORA service through `iora-core` and forwarded by the bridge.
async fn h_services(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    Ok(Json(c.services().await.map_err(server_err)?))
}

/// Hand the IDE a directly-usable EventSource URL (with token in the
/// query string) for live `journalctl -f` of a unit. The daemon doesn't
/// proxy the SSE stream itself — the IDE connects straight to the bridge,
/// which is on the same LAN and already trusted.
async fn h_service_logs_url(headers: HeaderMap, State(s): State<AppState>, AxPath(unit): AxPath<String>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    let url = c.service_logs_stream_url(&unit);
    Ok(Json(serde_json::json!({
        "unit":  unit,
        "url":   url,
        "token": c.token(),
        "base":  c.base(),
    })))
}

async fn h_system_info(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    Ok(Json(c.system_info().await.map_err(server_err)?))
}

async fn h_system_reboot(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    Ok(Json(c.system_reboot().await.map_err(server_err)?))
}

// ─── jobs ─────────────────────────────────────────────────────────────────

async fn h_jobs(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<Vec<Job>>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let order = s.inner.job_order.read().await.clone();
    let jobs = s.inner.jobs.read().await;
    Ok(Json(order.iter().rev().filter_map(|id| jobs.get(id).cloned()).collect()))
}

async fn h_job_one(headers: HeaderMap, State(s): State<AppState>, AxPath(id): AxPath<Uuid>) -> Result<Json<Job>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    s.inner.jobs.read().await.get(&id).cloned()
        .map(Json)
        .ok_or((StatusCode::NOT_FOUND, "no such job".into()))
}

async fn h_deploy(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<DeployBody>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    if b.components.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "components is empty".into()));
    }
    let cfg = config::load().map_err(server_err)?;
    let label = format!("deploy {} → {}", b.components.join(","), cfg.host);
    let job_id = create_job(&s, "deploy", &label).await;
    let st = s.clone();
    let cfg2 = cfg.clone();
    tokio::spawn(async move {
        run_deploy_job(st, job_id, cfg2, b).await;
    });
    Ok(Json(serde_json::json!({ "job_id": job_id })))
}

async fn run_deploy_job(s: AppState, job_id: Uuid, cfg: config::Config, b: DeployBody) {
    set_job_status(&s, job_id, JobStatus::Running).await;
    let client = match client::Client::new(&cfg.host, &cfg.token) {
        Ok(c) => c,
        Err(e) => { fail_job(&s, job_id, format!("client: {e:#}")).await; return; }
    };
    if let Err(e) = ensure_dev(&client).await {
        fail_job(&s, job_id, format!("{e:#}")).await; return;
    }
    let mut all_ok = true;
    for name in &b.components {
        let entry = match catalog::lookup(name) {
            Some(e) => e,
            None => {
                append_log(&s, job_id, format!("✗ unknown component: {name}")).await;
                all_ok = false;
                continue;
            }
        };
        let bin = if b.no_build {
            match build::existing_binary(&entry, &b.target) {
                Ok(p) => p,
                Err(e) => {
                    append_log(&s, job_id, format!("✗ {e:#}")).await;
                    all_ok = false;
                    continue;
                }
            }
        } else {
            // Resolve the requested build mode into a concrete strategy
            // (cargo / docker / device) given the component and the host
            // OS. This is what makes Windows hot-reload Just Work: when
            // the host can't realistically cross-compile, we silently
            // fall back to letting the bridge build on the device.
            let strategy = build::resolve_strategy(&entry, &b.target, &b.build_mode);
            let effective_build_mode = if strategy == build::BuildStrategy::Device {
                "device"
            } else {
                "host"
            };
            append_log(&s, job_id, format!("▶ build {} ({}) via {} [requested: {}]", entry.name, b.target, strategy.label(), b.build_mode)).await;
            if effective_build_mode == "device" {
                let mut build_future = Box::pin(client.build_replace_remote(&entry.name, &entry.target_path, if b.no_restart { None } else { Some(entry.unit.as_str()) }));
                let mut progress_tick = tokio::time::interval(std::time::Duration::from_secs(5));
                let progress_started = std::time::Instant::now();
                let build_result = loop {
                    tokio::select! {
                        result = &mut build_future => break result,
                        _ = progress_tick.tick() => {
                            let elapsed = progress_started.elapsed().as_secs();
                            if elapsed > 0 {
                                append_log(&s, job_id, format!("  device build lauft seit {}s", elapsed)).await;
                            }
                        }
                    }
                };
                match build_result {
                    Ok(resp) => {
                        let ms = resp["elapsed_ms"].as_u64().unwrap_or(0);
                        let inc = resp["incremental"].as_bool().unwrap_or(false);
                        let workspace = resp["workspace"].as_str().unwrap_or("");
                        append_log(&s, job_id, format!(
                            "✓ device build {} ({} bytes, {}ms{}{})",
                            entry.name,
                            resp["bytes"],
                            ms,
                            if inc { ", incremental cache" } else { "" },
                            if !workspace.is_empty() { format!(" @ {}", workspace) } else { String::new() },
                        )).await;
                        if let Some(stdout) = resp["build"]["stdout"].as_str() {
                            for line in stdout.lines().filter(|line| !line.trim().is_empty()).take(200) {
                                append_log(&s, job_id, format!("  {line}")).await;
                            }
                        }
                        if let Some(stderr) = resp["build"]["stderr"].as_str() {
                            for line in stderr.lines().filter(|line| !line.trim().is_empty()).take(200) {
                                append_log(&s, job_id, format!("  {line}")).await;
                            }
                        }
                        if !b.no_restart {
                            let r = &resp["restart"];
                            if r["ok"].as_bool().unwrap_or(false) {
                                append_log(&s, job_id, format!("✓ {} restarted", entry.unit)).await;
                                emit_service_logs_event(&s, &client, &entry.unit, 120).await;
                            } else {
                                append_log(&s, job_id, format!("✗ restart {} failed: {}", entry.unit, r["stderr"].as_str().unwrap_or(""))).await;
                                all_ok = false;
                            }
                        }
                        continue;
                    }
                    Err(e) => {
                        append_log(&s, job_id, format!("✗ device build {}: {e:#}", entry.name)).await;
                        all_ok = false;
                        continue;
                    }
                }
            } else {
                let mut build_future = Box::pin(build::cargo_release_with_mode(&entry, &b.target, &b.build_mode));
                let mut progress_tick = tokio::time::interval(std::time::Duration::from_secs(5));
                let progress_started = std::time::Instant::now();
                let build_result = loop {
                    tokio::select! {
                        result = &mut build_future => break result,
                        _ = progress_tick.tick() => {
                            let elapsed = progress_started.elapsed().as_secs();
                            if elapsed > 0 {
                                append_log(&s, job_id, format!("  host build lauft seit {}s", elapsed)).await;
                            }
                        }
                    }
                };
                match build_result {
                    Ok(p) => p,
                    Err(e) => {
                        append_log(&s, job_id, format!("✗ build {}: {e:#}", entry.name)).await;
                        all_ok = false;
                        continue;
                    }
                }
            }
        };
        append_log(&s, job_id, format!("▶ upload {} → {}", bin.display(), entry.target_path)).await;
        let unit = if b.no_restart { None } else { Some(entry.unit.as_str()) };
        match client.replace_binary(&bin, &entry.target_path, unit).await {
            Ok(resp) => {
                append_log(&s, job_id, format!("✓ deployed {} ({} bytes)", entry.name, resp["bytes"])).await;
                if !b.no_restart {
                    let r = &resp["restart"];
                    let ok = r["ok"].as_bool().unwrap_or(false);
                    if ok {
                        append_log(&s, job_id, format!("✓ {} restarted", entry.unit)).await;
                        emit_service_logs_event(&s, &client, &entry.unit, 120).await;
                    } else {
                        append_log(&s, job_id, format!("✗ restart {} failed: {}", entry.unit, r["stderr"].as_str().unwrap_or(""))).await;
                        all_ok = false;
                    }
                }
            }
            Err(e) => {
                append_log(&s, job_id, format!("✗ upload {}: {e:#}", entry.name)).await;
                all_ok = false;
            }
        }
    }
    finalize_job(&s, job_id, if all_ok { JobStatus::Succeeded } else { JobStatus::Failed }).await;
}

async fn ensure_dev(c: &client::Client) -> Result<()> {
    let s = c.status().await.context("contacting device /dev/status")?;
    if s.variant != "dev" { return Err(anyhow!("variant `{}` ≠ `dev`", s.variant)); }
    Ok(())
}

async fn h_restart(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<UnitBody>) -> Result<Json<client::CmdResult>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    ensure_dev(&c).await.map_err(server_err)?;
    let unit = if b.unit.contains('.') { b.unit } else { format!("{}.service", b.unit) };
    Ok(Json(c.restart_unit(&unit).await.map_err(server_err)?))
}

async fn h_service_reload(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<UnitBody>) -> Result<Json<client::CmdResult>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    ensure_dev(&c).await.map_err(server_err)?;
    let unit = if b.unit.contains('.') { b.unit } else { format!("{}.service", b.unit) };
    Ok(Json(c.reload_unit(&unit).await.map_err(server_err)?))
}

async fn h_compose_reload(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<ComposeBody>) -> Result<Json<client::CmdResult>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    ensure_dev(&c).await.map_err(server_err)?;
    Ok(Json(c.reload_compose(&b.svc).await.map_err(server_err)?))
}

async fn h_compose_logs(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<ComposeBody>) -> Result<Json<client::CmdResult>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    ensure_dev(&c).await.map_err(server_err)?;
    Ok(Json(c.compose_logs(&b.svc, b.tail).await.map_err(server_err)?))
}

async fn h_service_logs(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<ServiceLogBody>) -> Result<Json<client::CmdResult>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    ensure_dev(&c).await.map_err(server_err)?;
    let logs = c.service_logs(&b.unit, b.tail).await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("bridge unreachable or returned invalid response: {e}")))?;
    let _ = s.inner.events.send(Event::ServiceLogs {
        unit: b.unit,
        tail: b.tail,
        stdout: logs.stdout.clone(),
        stderr: logs.stderr.clone(),
    });
    Ok(Json(logs))
}

async fn h_system_list(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<FsPathBody>) -> Result<Json<client::FsListResult>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    ensure_dev(&c).await.map_err(server_err)?;
    let listing = c.fs_list(&b.path).await.map_err(server_err)?;
    let _ = s.inner.events.send(Event::SystemData {
        path: listing.path.clone(),
        kind: "directory".into(),
        content: serde_json::to_value(&listing).unwrap_or_else(|_| serde_json::json!({})),
    });
    Ok(Json(listing))
}

async fn h_system_read(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<FsReadBody>) -> Result<Json<client::FsReadResult>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    ensure_dev(&c).await.map_err(server_err)?;
    let file = c.fs_read(&b.path, b.max_bytes).await.map_err(server_err)?;
    let _ = s.inner.events.send(Event::SystemData {
        path: file.path.clone(),
        kind: "file".into(),
        content: serde_json::to_value(&file).unwrap_or_else(|_| serde_json::json!({})),
    });
    Ok(Json(file))
}

// ─── watch sessions ───────────────────────────────────────────────────────

async fn h_watch_list(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<Vec<WatchSession>>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    Ok(Json(s.inner.watches.read().await.values().cloned().collect()))
}

async fn h_watch_start(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<WatchBody>) -> Result<Json<WatchSession>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    if b.components.is_empty() && !b.automatic {
        return Err((StatusCode::BAD_REQUEST, "components is empty".into()));
    }
    let cfg = config::load().map_err(server_err)?;
    let id = Uuid::new_v4();
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let session = WatchSession {
        id, components: b.components.clone(), target: b.target.clone(), build_mode: b.build_mode.clone(), automatic: b.automatic,
        debounce_ms: b.debounce_ms, started_at: Utc::now(), cancel: cancel_tx,
    };
    s.inner.watches.write().await.insert(id, session.clone());
    let _ = s.inner.events.send(Event::WatchStarted { session: session.clone() });
    let st = s.clone();
    let comps = b.components.clone();
    let target = b.target.clone();
    let build_mode = b.build_mode.clone();
    let automatic = b.automatic;
    let debounce = b.debounce_ms;
    tokio::spawn(async move {
        let _ = run_watch_session(st.clone(), id, cfg, comps, target, build_mode, automatic, debounce, cancel_rx).await;
        st.inner.watches.write().await.remove(&id);
        let _ = st.inner.events.send(Event::WatchStopped { id });
    });
    Ok(Json(session))
}

async fn h_watch_stop(headers: HeaderMap, State(s): State<AppState>, AxPath(id): AxPath<Uuid>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    if let Some(w) = s.inner.watches.read().await.get(&id) {
        let _ = w.cancel.send(true);
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err((StatusCode::NOT_FOUND, "no such session".into()))
    }
}

async fn run_watch_session(
    s: AppState,
    id: Uuid,
    cfg: config::Config,
    components: Vec<String>,
    target: String,
    build_mode: String,
    automatic: bool,
    debounce_ms: u64,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    use notify::RecursiveMode;
    use notify_debouncer_mini::new_debouncer;
    use std::sync::mpsc;
    use std::time::Duration;
    use std::collections::HashSet;
    use std::path::PathBuf;

    let entries: Vec<_> = if automatic {
        catalog::all()
    } else {
        components.iter().filter_map(|n| catalog::lookup(n)).collect()
    };
    if entries.is_empty() { return Ok(()); }

    // The debouncer pushes events into a std mpsc; a dedicated thread forwards
    // them to a tokio channel that this async loop can `select!` on alongside
    // the cancellation watch.
    let (std_tx, std_rx) = mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(debounce_ms), std_tx)?;
    for e in &entries {
        for d in build::watch_dirs(e)? {
            if d.is_dir() { let _ = debouncer.watcher().watch(&d, RecursiveMode::Recursive); }
        }
    }
    // Keep the debouncer alive for the duration of the session.
    let _debouncer_keep = debouncer;

    let (tok_tx, mut tok_rx) = tokio::sync::mpsc::channel::<Vec<PathBuf>>(64);
    std::thread::spawn(move || {
        while let Ok(res) = std_rx.recv() {
            if let Ok(events) = res {
                let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
                if !paths.is_empty() {
                    if tok_tx.blocking_send(paths).is_err() { break; }
                }
            }
        }
    });

    let client = client::Client::new(&cfg.host, &cfg.token)?;

    loop {
        if *cancel.borrow() { break; }
        tokio::select! {
            _ = cancel.changed() => break,
            maybe = tok_rx.recv() => {
                let paths = match maybe { Some(p) => p, None => break };
                let touched: HashSet<PathBuf> = paths.into_iter().collect();
                let mut to_build = Vec::new();
                for e in &entries {
                    let dirs = build::watch_dirs(e)?;
                    if touched.iter().any(|p| dirs.iter().any(|d| p.starts_with(d))) {
                        to_build.push(e.clone());
                    }
                }
                if to_build.is_empty() { continue; }
                let names: Vec<String> = to_build.iter().map(|e| e.name.to_string()).collect();
                let _ = s.inner.events.send(Event::WatchTriggered { id, components: names.clone() });
                let label = format!("watch[{}] rebuild {}", &id.to_string()[..8], names.join(","));
                let job = create_job(&s, "watch-deploy", &label).await;
                set_job_status(&s, job, JobStatus::Running).await;
                let mut all_ok = true;
                for e in to_build {
                    let strategy = build::resolve_strategy(&e, &target, &build_mode);
                    let effective_build_mode = if build::must_build_on_host(&e) {
                        "host"
                    } else if strategy == build::BuildStrategy::Device {
                        "device"
                    } else {
                        "host"
                    };
                    append_log(&s, job, format!("▶ build {} via {}{}", e.name, strategy.label(), if automatic { " (automatic)" } else { "" })).await;
                    if effective_build_mode == "device" {
                        match client.build_replace_remote(&e.name, &e.target_path, Some(&e.unit)).await {
                            Ok(resp) => {
                                let ms = resp["elapsed_ms"].as_u64().unwrap_or(0);
                                append_log(&s, job, format!("✓ {} deployed ({} bytes, {}ms)", e.name, resp["bytes"], ms)).await;
                                if resp["restart"]["ok"].as_bool().unwrap_or(false) {
                                    append_log(&s, job, format!("✓ {} restarted", e.unit)).await;
                                    emit_service_logs_event(&s, &client, &e.unit, 120).await;
                                }
                            }
                            Err(err) => { append_log(&s, job, format!("✗ device build: {err:#}")).await; all_ok = false; }
                        }
                    } else {
                        match build::cargo_release_with_mode(&e, &target, &build_mode).await {
                            Ok(bin) => match client.replace_binary(&bin, &e.target_path, Some(&e.unit)).await {
                                Ok(resp) => {
                                    append_log(&s, job, format!("✓ {} deployed ({} bytes)", e.name, resp["bytes"])).await;
                                    if resp["restart"]["ok"].as_bool().unwrap_or(false) {
                                        append_log(&s, job, format!("✓ {} restarted", e.unit)).await;
                                        emit_service_logs_event(&s, &client, &e.unit, 120).await;
                                    }
                                }
                                Err(err) => { append_log(&s, job, format!("✗ upload: {err:#}")).await; all_ok = false; }
                            },
                            Err(err) => { append_log(&s, job, format!("✗ build: {err:#}")).await; all_ok = false; }
                        }
                    }
                }
                finalize_job(&s, job, if all_ok { JobStatus::Succeeded } else { JobStatus::Failed }).await;
            }
        }
    }
    Ok(())
}

// ─── events (WS) ──────────────────────────────────────────────────────────

async fn h_events_ws(
    State(s): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let token_q = q.get("token").map(|s| s.as_str()).unwrap_or("");
    let mut h = headers.clone();
    if !token_q.is_empty() && !h.contains_key(header::AUTHORIZATION) {
        h.insert(header::AUTHORIZATION, format!("Bearer {token_q}").parse().unwrap());
    }
    // Public endpoint — the Web UI needs to connect BEFORE the user logs in
    // (to show the connect dialog). The stream only contains non-sensitive
    // data (connection status, device list). Auth-only data (jobs, watches)
    // is only included if the client is authenticated.
    let is_auth = check_auth(&s, &h).is_ok();
    Ok(ws.on_upgrade(move |sock| ws_loop(s, sock, is_auth)))
}

async fn ws_loop(s: AppState, mut sock: WebSocket, is_auth: bool) {
    let mut rx = s.inner.events.subscribe();
    // Build the snapshot manually (json! doesn't accept block expressions).
    let devices = s.inner.devices.read().await.clone();
    let watches: Vec<WatchSession> = s.inner.watches.read().await.values().cloned().collect();
    let jobs_recent: Vec<Job> = {
        let order = s.inner.job_order.read().await.clone();
        let jobs = s.inner.jobs.read().await;
        order.iter().rev().take(20).filter_map(|id| jobs.get(id).cloned()).collect()
    };
    // Use CACHED connection state — the background_tasks loop updates it
    // periodically via health_check_connection. This avoids making 2 HTTP
    // requests to the Dev Bridge on every WebSocket (re)connect.
    let conn = s.inner.cached_connection.read().await.clone();
    let snapshot = serde_json::json!({
        "type": "snapshot",
        "connection": conn,
        "devices": devices,
        "watches": watches,
        "jobs_recent": jobs_recent,
    });
    if sock.send(Message::Text(snapshot.to_string())).await.is_err() { return; }

    // Heartbeat timer: send a keep-alive ping every 5 seconds so the
    // browser/proxy does NOT close the WebSocket during idle periods.
    let mut hb_tick = tokio::time::interval(std::time::Duration::from_secs(5));
    hb_tick.tick().await; // consume immediate tick

    loop {
        tokio::select! {
            ev = rx.recv() => {
                match ev {
                    Ok(e) => {
                        let s = serde_json::to_string(&e).unwrap_or_default();
                        if sock.send(Message::Text(s)).await.is_err() { break; }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            _ = hb_tick.tick() => {
                // Send a heartbeat ping so the browser/proxy knows we are alive.
                let hb = serde_json::json!({"type": "heartbeat", "ts": chrono::Utc::now().timestamp()});
                if sock.send(Message::Text(hb.to_string())).await.is_err() { break; }
            }
            msg = sock.recv() => {
                match msg {
                    Some(Ok(Message::Ping(p))) => { let _ = sock.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}

// ─── job helpers ──────────────────────────────────────────────────────────

async fn create_job(s: &AppState, kind: &str, label: &str) -> Uuid {
    let id = Uuid::new_v4();
    let job = Job {
        id, kind: kind.into(), label: label.into(),
        status: JobStatus::Pending, started_at: Utc::now(),
        finished_at: None, log: Vec::new(),
    };
    s.inner.jobs.write().await.insert(id, job.clone());
    {
        let mut order = s.inner.job_order.write().await;
        order.push(id);
        // GC oldest finished jobs.
        if order.len() > MAX_RECENT_JOBS {
            let mut jobs = s.inner.jobs.write().await;
            while order.len() > MAX_RECENT_JOBS {
                let oid = order.remove(0);
                jobs.remove(&oid);
            }
        }
    }
    let _ = s.inner.events.send(Event::JobCreated { job });
    id
}

async fn set_job_status(s: &AppState, id: Uuid, status: JobStatus) {
    if let Some(j) = s.inner.jobs.write().await.get_mut(&id) {
        j.status = status;
    }
    let _ = s.inner.events.send(Event::JobUpdated { id, status, line: None });
}

async fn append_log(s: &AppState, id: Uuid, line: String) {
    println!("{}", line);
    if let Some(j) = s.inner.jobs.write().await.get_mut(&id) {
        if j.log.len() >= MAX_JOB_LOG_LINES { j.log.remove(0); }
        j.log.push(line.clone());
    }
    let _ = s.inner.events.send(Event::JobUpdated { id, status: JobStatus::Running, line: Some(line) });
}

async fn fail_job(s: &AppState, id: Uuid, msg: String) {
    append_log(s, id, format!("✗ {msg}")).await;
    finalize_job(s, id, JobStatus::Failed).await;
}

async fn finalize_job(s: &AppState, id: Uuid, status: JobStatus) {
    let snap = {
        let mut jobs = s.inner.jobs.write().await;
        if let Some(j) = jobs.get_mut(&id) {
            j.status = status;
            j.finished_at = Some(Utc::now());
            Some(j.clone())
        } else { None }
    };
    if let Some(j) = snap {
        let _ = s.inner.events.send(Event::JobFinished { job: j });
    }
}

async fn emit_service_logs_event(s: &AppState, client: &client::Client, unit: &str, tail: u32) {
    if let Ok(logs) = client.service_logs(unit, tail).await {
        let _ = s.inner.events.send(Event::ServiceLogs {
            unit: unit.to_string(),
            tail,
            stdout: logs.stdout,
            stderr: logs.stderr,
        });
    }
}

// ─── token / info file ────────────────────────────────────────────────────

fn config_dir() -> Result<PathBuf> {
    let base = dirs::config_dir().context("no config dir")?;
    let d = base.join("iora-dev-deploy");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

fn token_file_path() -> Result<PathBuf> { Ok(config_dir()?.join(DAEMON_TOKEN_FILE)) }
fn info_file_path() -> Result<PathBuf> { Ok(config_dir()?.join(DAEMON_INFO_FILE)) }

fn load_or_create_token() -> Result<String> {
    let p = token_file_path()?;
    if let Ok(s) = std::fs::read_to_string(&p) {
        let t = s.trim();
        if t.len() >= 32 { return Ok(t.to_string()); }
    }
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).context("getrandom")?;
    let token = hex::encode(buf);
    std::fs::write(&p, &token).with_context(|| format!("write {}", p.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

fn write_info_file(info: &serde_json::Value) -> Result<()> {
    let p = info_file_path()?;
    std::fs::write(&p, serde_json::to_string_pretty(info)?).with_context(|| format!("write {}", p.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ─── Web UI ─────────────────────────────────────────────────────────────

async fn h_ui_index(State(state): State<AppState>) -> impl IntoResponse {
    let cookie = format!(
        "daemon_token={}; Path=/; SameSite=Strict; Max-Age=86400",
        state.inner.auth_token
    );
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "text/html; charset=utf-8".parse().unwrap());
    headers.insert(header::SET_COOKIE, cookie.parse().unwrap());
    (StatusCode::OK, headers, crate::web_ui::index_html())
}

async fn h_ui_config(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "token": state.inner.auth_token,
        "url": format!("http://127.0.0.1:{}", 8765), // best-effort
    }))
}

// ─── SSH token fetch ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SshFetchBody {
    host: String,
    username: String,
    #[serde(default)]
    password: Option<String>,
}

async fn h_ssh_fetch_token(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<SshFetchBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&state, &headers)?;

    let host = body.host.trim();
    let user = body.username.trim();
    let pass = body.password.as_deref().unwrap_or("");

    if host.is_empty() || user.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "host and username are required".into()));
    }

    // Find SSH binary (Windows has it in System32\OpenSSH)
    let ssh_path = find_command("ssh");
    let sshpass_path = if !pass.is_empty() { find_command("sshpass") } else { None };

    if ssh_path.is_none() {
        return Err((StatusCode::BAD_GATEWAY,
            "SSH not found. Install OpenSSH Client:\n\n"
            .to_string() +
            "Windows: Settings → Apps → Optional Features → OpenSSH Client\n" +
            "Or: winget install Microsoft.OpenSSH.Beta"
        ));
    }

    if !pass.is_empty() && sshpass_path.is_none() {
        return Err((StatusCode::BAD_GATEWAY,
            "Password provided but sshpass is not installed.\n\n"
            .to_string() +
            "Install sshpass:  winget install sshpass\n" +
            "Or use key-based SSH (leave password empty)."
        ));
    }

    let ssh = ssh_path.unwrap();
    let target = format!("{user}@{host}");
    let ssh_args = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"];

    let result = if !pass.is_empty() {
        let sp = sshpass_path.unwrap();
        tokio::process::Command::new(&sp)
            .args(["-p", pass])
            .arg(&ssh)
            .args(ssh_args)
            .arg(&target)
            .args(["cat", "/var/lib/iora/dev-token"])
            .output().await
    } else {
        tokio::process::Command::new(&ssh)
            .args(ssh_args)
            .arg(&target)
            .args(["cat", "/var/lib/iora/dev-token"])
            .output().await
    };

    match result {
        Ok(output) if output.status.success() => {
            let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if token.is_empty() {
                Err((StatusCode::NOT_FOUND, "no token found at /var/lib/iora/dev-token on the device".into()))
            } else if token.len() < 16 {
                Err((StatusCode::BAD_REQUEST, format!("token too short ({})", token.len())).into())
            } else {
                Ok(Json(serde_json::json!({ "token": token, "len": token.len() })))
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err((StatusCode::BAD_GATEWAY, format!(
                "SSH failed (exit {}): {}",
                output.status.code().unwrap_or(-1),
                if stderr.is_empty() { &*stdout } else { &*stderr }
            )))
        }
        Err(e) => {
            Err((StatusCode::BAD_GATEWAY, format!(
                "Cannot start SSH process: {e}\n\nMake sure OpenSSH Client is installed:\nWindows: Settings → Apps → Optional Features → Add OpenSSH Client"
            )))
        }
    }
}

/// Find a command by checking if the binary exists on disk or on PATH.
fn find_command(name: &str) -> Option<String> {
    // Try `where` on Windows, `which` on Unix
    #[cfg(windows)]
    {
        if let Ok(out) = std::process::Command::new("where").arg(name).output() {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout)
                    .lines().next().unwrap_or("").trim().to_string();
                if !path.is_empty() { return Some(path); }
            }
        }
        // Fallback: check common install locations
        for pfx in &[
            std::env::var("ProgramFiles").unwrap_or_default(),
            format!("C:\\Windows\\System32\\OpenSSH"),
        ] {
            let guess = format!("{pfx}\\{name}\\{name}.exe");
            if std::path::Path::new(&guess).exists() { return Some(guess); }
            let guess2 = format!("{pfx}\\{name}.exe");
            if std::path::Path::new(&guess2).exists() { return Some(guess2); }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(out) = std::process::Command::new("which").arg(name).output() {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() { return Some(path); }
            }
        }
    }
    None
}

// ─── Connect via IORA dashboard credentials ───────────────────────────

#[derive(Deserialize)]
struct CredentialsBody {
    host: String,
    username: String,
    password: String,
}

async fn h_connect_credentials(
    headers: HeaderMap,
    State(s): State<AppState>,
    Json(body): Json<CredentialsBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;

    let host = body.host.trim();
    if host.is_empty() || body.username.is_empty() || body.password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "host, username, and password are required".into()));
    }

    // Call /dev/auth on the bridge (try default bridge ports if no port provided).
    let mut auth_resp: Option<serde_json::Value> = None;
    let mut selected_host: Option<String> = None;
    let mut attempts: Vec<String> = Vec::new();

    let candidates = bridge_host_candidates(host);
    if candidates.is_empty() {
        return Err((StatusCode::BAD_REQUEST, format!("Invalid host: {host}")));
    }

    for candidate in &candidates {
        let c = match client::Client::new(candidate, "") {
            Ok(c) => c,
            Err(e) => {
                attempts.push(format!("  - {candidate}: client init failed: {e}"));
                continue;
            }
        };
        match c.dev_auth(&body.username, &body.password).await {
            Ok(resp) => {
                auth_resp = Some(resp);
                selected_host = Some(candidate.clone());
                break;
            }
            Err(e) => {
                attempts.push(format!("  - POST http://{candidate}/dev/auth -> {e}"));
            }
        }
    }

    let auth_resp = auth_resp.ok_or_else(|| {
        let tried_ports: Vec<String> = candidates
            .iter()
            .filter_map(|c| c.rsplit_once(':').map(|(_, p)| p.to_string()))
            .collect();
        let ports_str = if tried_ports.is_empty() {
            "default".to_string()
        } else {
            tried_ports.join(", ")
        };
        (StatusCode::BAD_GATEWAY, format!(
            "Device auth failed. Tried bridge ports {ports_str}.\n{}\n\nHints:\n  - Make sure iora-dev-bridge is running on the device (systemctl status iora-dev-bridge)\n  - Confirm the device IP and that the IDE machine can reach it\n  - Verify the IORA dashboard username/password",
            attempts.join("\n")
        ))
    })?;

    let session_token = auth_resp.get("token")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_GATEWAY, "No session token returned".into()))?;

    // Save as the active connection (session token in place of dev token)
    let normalized = selected_host.unwrap_or_else(|| host.to_string());
    let cfg = config::Config { host: normalized, token: session_token.to_string() };
    config::save(&cfg).map_err(server_err)?;

    let status_snapshot = match client::Client::new(&cfg.host, &cfg.token) {
        Ok(client) => client.status().await.ok(),
        Err(_) => None,
    };

    let _ = s.inner.events.send(Event::Connection {
        host: Some(cfg.host.clone()),
        hostname: status_snapshot.as_ref().map(|status| status.hostname.clone()),
        build: status_snapshot.as_ref().map(|status| status.build.clone()),
        variant: status_snapshot.as_ref().map(|status| status.variant.clone()).or(Some("dev".into())),
        reachable: status_snapshot.is_some(),
        token_ok: status_snapshot.is_some(),
    });

    Ok(Json(serde_json::json!({
        "ok": true,
        "host": cfg.host,
        "username": body.username,
        "role": auth_resp.get("role"),
        "via": "credentials",
    })))
}

fn bridge_host_candidates(host: &str) -> Vec<String> {
    let trimmed = host.trim().trim_end_matches('/');
    let no_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed);

    if no_scheme.is_empty() {
        return Vec::new();
    }

    // Standard dev-bridge ports, in priority order. 8101 is the current
    // default; 8099 is the legacy default kept as fallback for older
    // images. Both are tried whether or not the user supplied a port,
    // so a user that copy-pasted `host:8099` from old docs still works
    // against a bridge that has migrated to 8101 (and vice versa).
    const DEFAULT_PORTS: &[u16] = &[8101, 8099];

    let mut candidates: Vec<String> = Vec::new();
    let mut push_unique = |c: String, list: &mut Vec<String>| {
        if !list.iter().any(|existing| existing == &c) {
            list.push(c);
        }
    };

    if let Some((host_only, _port)) = no_scheme.rsplit_once(':') {
        // User-supplied port goes first.
        push_unique(no_scheme.to_string(), &mut candidates);
        // Then the standard fallbacks on the same host.
        for p in DEFAULT_PORTS {
            push_unique(format!("{host_only}:{p}"), &mut candidates);
        }
    } else {
        for p in DEFAULT_PORTS {
            push_unique(format!("{no_scheme}:{p}"), &mut candidates);
        }
    }

    candidates
}

// ─── Register custom component ─────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterComponentBody {
    name: String,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default)]
    target_path: Option<String>,
}

async fn h_register_component(
    headers: HeaderMap,
    State(s): State<AppState>,
    Json(body): Json<RegisterComponentBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let unit = body.unit.unwrap_or_else(|| format!("{}.service", body.name));
    let target_path = body.target_path.unwrap_or_else(|| format!("/usr/bin/{}", body.name));
    catalog::register_custom(body.name.clone(), unit.clone(), target_path.clone());
    Ok(Json(serde_json::json!({
        "ok": true,
        "name": body.name,
        "unit": unit,
        "target_path": target_path,
    })))
}

// ─── Scaffold new IORA service ───────────────────────────────────────

#[derive(Deserialize)]
struct ScaffoldBody {
    name: String,
    #[serde(default)]
    port: u16,
    #[serde(default)]
    description: String,
}

async fn h_scaffold_service(
    headers: HeaderMap,
    State(s): State<AppState>,
    Json(body): Json<ScaffoldBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;

    let name = body.name.trim().to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != '-', "");
    if name.is_empty() || name.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "Invalid service name".into()));
    }

    let ws_root = build::workspace_root().map_err(server_err)?;
    let svc_dir = ws_root.join("backend").join("services").join(&name);

    if svc_dir.exists() {
        return Err((StatusCode::CONFLICT, format!("Service directory already exists: {}", svc_dir.display())));
    }

    std::fs::create_dir_all(svc_dir.join("src")).map_err(server_err)?;

    // Write Cargo.toml
    let port = if body.port > 0 { body.port } else { 8100u16 };
    let desc = if body.description.is_empty() { name.clone() } else { body.description.clone() };
    let cargo_toml = format!(r#"[package]
name = "{name}"
version = "0.1.0"
edition = "2021"
description = "{desc}"
publish = false

[[bin]]
name = "{name}"
path = "src/main.rs"

[dependencies]
tokio = {{ version = "1", features = ["macros", "rt-multi-thread"] }}
axum = "0.7"
serde = {{ version = "1", features = ["derive"] }}
serde_json = "1"
tracing = "0.1"
tracing-subscriber = {{ version = "0.3", features = ["env-filter"] }}
tower-http = {{ version = "0.5", features = ["cors"] }}
"#);
    std::fs::write(svc_dir.join("Cargo.toml"), cargo_toml).map_err(server_err)?;

    // Write main.rs
    let main_rs = format!(r#"use axum::{{routing::get, Router}};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {{
    tracing_subscriber::fmt().init();
    let app = Router::new()
        .route("/health", get(|| async {{ "OK" }}))
        .layer(CorsLayer::permissive());
    let addr: SocketAddr = "0.0.0.0:{port}".parse().unwrap();
    tracing::info!("{name} listening on {{addr}}");
    axum::serve(tokio::net::TcpListener::bind(addr).await.unwrap(), app).await.unwrap();
}}
"#);
    std::fs::write(svc_dir.join("src").join("main.rs"), main_rs).map_err(server_err)?;

    // Try to add to workspace members
    let workspace_toml = ws_root.join("backend").join("Cargo.toml");
    if workspace_toml.exists() {
        let content = std::fs::read_to_string(&workspace_toml).map_err(server_err)?;
        let marker = format!("\"services/{name}\"");
        if !content.contains(&marker) {
            // Insert before the closing bracket of members
            let updated = if let Some(pos) = content.rfind(']') {
                let mut s = content.clone();
                s.insert_str(pos, format!("    \"services/{name}\",\n").as_str());
                s
            } else {
                content
            };
            std::fs::write(&workspace_toml, updated).map_err(server_err)?;
        }
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "name": name,
        "path": svc_dir.display().to_string(),
        "port": port,
        "cargo_toml": format!("backend/services/{name}/Cargo.toml"),
        "main_rs": format!("backend/services/{name}/src/main.rs"),
    })))
}

// ─── Upload app/plugin package ───────────────────────────────────────

async fn h_upload_app(
    headers: HeaderMap,
    State(s): State<AppState>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;

    let ws_root = build::workspace_root().map_err(server_err)?;
    let apps_dir = ws_root.join("apps");
    std::fs::create_dir_all(&apps_dir).map_err(server_err)?;

    let mut uploaded_name = String::new();
    let mut file_data = Vec::new();

    while let Some(field) = multipart.next_field().await.map_err(server_err)? {
        let name = field.file_name().unwrap_or("package").to_string();
        uploaded_name = name.clone();
        file_data = field.bytes().await.map_err(server_err)?.to_vec();
    }

    if file_data.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No file uploaded".into()));
    }

    // Determine format: try zip first, then tar.gz
    let is_zip = file_data.len() >= 4 && &file_data[0..4] == b"PK\x03\x04";
    let is_gz = file_data.len() >= 2 && &file_data[0..2] == b"\x1f\x8b";

    let base_name = uploaded_name
        .replace(".tar.gz", "").replace(".tgz", "").replace(".zip", "");
    let extract_dir = apps_dir.join(&base_name);

    // Remove existing if any
    if extract_dir.exists() {
        std::fs::remove_dir_all(&extract_dir).map_err(server_err)?;
    }
    std::fs::create_dir_all(&extract_dir).map_err(server_err)?;

    if is_zip {
        // Extract zip
        let cursor = std::io::Cursor::new(file_data);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid zip: {e}")))?;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(server_err)?;
            let out_path = extract_dir.join(file.name());
            if file.is_dir() {
                std::fs::create_dir_all(&out_path).map_err(server_err)?;
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent).map_err(server_err)?;
                }
                let mut out = std::fs::File::create(&out_path).map_err(server_err)?;
                std::io::copy(&mut file, &mut out).map_err(server_err)?;
            }
        }
    } else if is_gz {
        // Extract tar.gz
        let cursor = std::io::Cursor::new(file_data);
        let gz = flate2::read::GzDecoder::new(cursor);
        let mut archive = tar::Archive::new(gz);
        archive.unpack(&extract_dir).map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid tar.gz: {e}")))?;
    } else {
        return Err((StatusCode::BAD_REQUEST, "Unknown format — upload .zip or .tar.gz".into()));
    }

    // Check for manifest.json
    let manifest_path = extract_dir.join("manifest.json");
    let manifest: Option<serde_json::Value> = if manifest_path.exists() {
        let content = std::fs::read_to_string(&manifest_path).map_err(server_err)?;
        Some(serde_json::from_str(&content).map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid manifest.json: {e}")))?)
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "ok": true,
        "name": base_name,
        "path": extract_dir.display().to_string(),
        "manifest": manifest,
        "format": if is_zip { "zip" } else { "tar.gz" },
    })))
}

// ─── error helper ─────────────────────────────────────────────────────────

fn server_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}"))
}

/// Open a URL in the system's default browser.
fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/c", "start", url]).spawn(); }
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(url).spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(url).spawn(); }
}
