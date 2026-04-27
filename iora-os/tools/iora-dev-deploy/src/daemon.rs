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
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

const DAEMON_INFO_FILE: &str = "daemon.json";
const DAEMON_TOKEN_FILE: &str = "daemon.token";
const EVENT_BUFFER: usize = 256;
const MAX_JOB_LOG_LINES: usize = 2000;
const MAX_RECENT_JOBS: usize = 100;

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
    Connection { host: Option<String>, hostname: Option<String>, build: Option<String>, variant: Option<String> },
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
fn default_build_mode() -> String { "device".into() }
fn default_tail() -> u32 { 200 }
fn default_debounce() -> u64 { 800 }
fn default_fs_max_bytes() -> usize { 64 * 1024 }

pub async fn run(bind: SocketAddr, token_override: Option<String>, no_pin: bool) -> Result<()> {
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
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state);

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
    println!("{}", "─".repeat(70).dimmed());

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

// ─── auth ────────────────────────────────────────────────────────────────

fn check_auth(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let want = state.inner.auth_token.as_bytes();
    let got = headers.get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.as_bytes())
        .or_else(|| headers.get("X-IORA-Daemon-Token").and_then(|v| v.to_str().ok()).map(|s| s.as_bytes()));
    match got {
        Some(g) if ct_eq(g, want) => Ok(()),
        _ => Err((StatusCode::UNAUTHORIZED, "missing or invalid daemon token".into())),
    }
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

async fn h_connection(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let saved = config::load().ok();
    let mut out = serde_json::json!({
        "host": saved.as_ref().map(|c| c.host.clone()),
        "configured": saved.is_some(),
    });
    if let Some(c) = saved {
        if let Ok(client) = client::Client::new(&c.host, &c.token) {
            if let Ok(st) = client.status().await {
                out["hostname"] = serde_json::json!(st.hostname);
                out["build"] = serde_json::json!(st.build);
                out["variant"] = serde_json::json!(st.variant);
                out["dev_mode"] = serde_json::json!(st.dev_mode);
                out["capabilities"] = serde_json::json!(st.capabilities);
                out["reachable"] = serde_json::json!(true);
            } else {
                out["reachable"] = serde_json::json!(false);
            }
        }
    }
    Ok(Json(out))
}

async fn h_connect(headers: HeaderMap, State(s): State<AppState>, Json(b): Json<ConnectBody>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::Config { host: b.host.clone(), token: b.token.clone() };
    let client = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    let st = client.status().await.map_err(server_err)?;
    if st.variant != "dev" {
        return Err((StatusCode::CONFLICT, format!("device variant `{}` ≠ `dev` — refusing", st.variant)));
    }
    let path = config::save(&cfg).map_err(server_err)?;
    let _ = s.inner.events.send(Event::Connection {
        host: Some(cfg.host.clone()),
        hostname: Some(st.hostname.clone()),
        build: Some(st.build.clone()),
        variant: Some(st.variant.clone()),
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
    let _ = s.inner.events.send(Event::Connection { host: None, hostname: None, build: None, variant: None });
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn h_status(headers: HeaderMap, State(s): State<AppState>) -> Result<Json<client::Status>, (StatusCode, String)> {
    check_auth(&s, &headers)?;
    let cfg = config::load().map_err(server_err)?;
    let c = client::Client::new(&cfg.host, &cfg.token).map_err(server_err)?;
    Ok(Json(c.status().await.map_err(server_err)?))
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
            let effective_build_mode = if b.build_mode == "device" && build::must_build_on_host(&entry) {
                append_log(&s, job_id, format!("▶ {} uses dedicated host bridge update path", entry.name)).await;
                "host"
            } else {
                b.build_mode.as_str()
            };
            append_log(&s, job_id, format!("▶ build {} ({}) via {}", entry.name, b.target, effective_build_mode)).await;
            if effective_build_mode == "device" {
                match client.build_replace_remote(&entry.name, &entry.target_path, if b.no_restart { None } else { Some(entry.unit.as_str()) }).await {
                    Ok(resp) => {
                        append_log(&s, job_id, format!("✓ device build {} ({} bytes)", entry.name, resp["bytes"])).await;
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
                match build::cargo_release(&entry, &b.target).await {
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
    let logs = c.service_logs(&b.unit, b.tail).await.map_err(server_err)?;
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
                    let effective_build_mode = if build_mode == "device" && build::must_build_on_host(&e) {
                        append_log(&s, job, format!("▶ {} uses host bridge update path", e.name)).await;
                        "host"
                    } else {
                        build_mode.as_str()
                    };
                    append_log(&s, job, format!("▶ build {} via {}{}", e.name, effective_build_mode, if automatic { " (automatic)" } else { "" })).await;
                    if effective_build_mode == "device" {
                        match client.build_replace_remote(&e.name, &e.target_path, Some(&e.unit)).await {
                            Ok(resp) => {
                                append_log(&s, job, format!("✓ {} deployed ({} bytes)", e.name, resp["bytes"])).await;
                                if resp["restart"]["ok"].as_bool().unwrap_or(false) {
                                    append_log(&s, job, format!("✓ {} restarted", e.unit)).await;
                                    emit_service_logs_event(&s, &client, &e.unit, 120).await;
                                }
                            }
                            Err(err) => { append_log(&s, job, format!("✗ device build: {err:#}")).await; all_ok = false; }
                        }
                    } else {
                        match build::cargo_release(&e, &target).await {
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
    check_auth(&s, &h)?;
    Ok(ws.on_upgrade(move |sock| ws_loop(s, sock)))
}

async fn ws_loop(s: AppState, mut sock: WebSocket) {
    let mut rx = s.inner.events.subscribe();
    // Build the snapshot manually (json! doesn't accept block expressions).
    let devices = s.inner.devices.read().await.clone();
    let watches: Vec<WatchSession> = s.inner.watches.read().await.values().cloned().collect();
    let jobs_recent: Vec<Job> = {
        let order = s.inner.job_order.read().await.clone();
        let jobs = s.inner.jobs.read().await;
        order.iter().rev().take(20).filter_map(|id| jobs.get(id).cloned()).collect()
    };
    let snapshot = serde_json::json!({
        "type": "snapshot",
        "devices": devices,
        "watches": watches,
        "jobs_recent": jobs_recent,
    });
    if sock.send(Message::Text(snapshot.to_string())).await.is_err() { return; }
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

// ─── error helper ─────────────────────────────────────────────────────────

fn server_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}"))
}
