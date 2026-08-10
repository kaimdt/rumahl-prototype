//! iora-browserd — ORA Browser service.
//!
//! The ORA Browser is NOT an iframe: a real headless Chromium runs on ORA
//! and its rendered surface (CDP `Page.startScreencast` JPEG frames) is
//! streamed to the ORA Browser app over WebSocket. Input flows back through
//! CDP `Input.*` commands. Websites therefore never see an embedding —
//! X-Frame-Options / CSP frame-ancestors are irrelevant.
//!
//! The service is GLOBAL: any ORA app can open a remote browsing surface
//! against the same API (create tabs, feed input, receive frames). The ORA
//! Browser store app is just one consumer.
//!
//! Security: both the HTTP API and the Chromium CDP endpoint bind to
//! 127.0.0.1 only. Apps reach the service through the iora-home app
//! gateway; the CDP port is never exposed.
//!
//! API (all on 127.0.0.1:8102):
//!   GET  /                     → browser UI (static)
//!   GET  /api/tabs             → tab list
//!   POST /api/tabs {"url"}     → open new tab
//!   POST /api/tabs/:id/activate
//!   POST /api/tabs/:id/close
//!   POST /api/tabs/:id/navigate {"url"}
//!   POST /api/tabs/:id/back | forward | reload
//!   GET  /ws                   → frame stream + input channel

mod cdp;
mod webrtc;

use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

const SERVICE_PORT: u16 = 8102;
const CDP_PORT: u16 = 9222;
const CHROMIUM_BIN: &str = "chromium";
const PROFILE_DIR: &str = "/var/lib/ora/browser/profiles/default";

// ─── State ────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Tab {
    id: String,
    url: Arc<RwLock<String>>,
    title: Arc<RwLock<String>>,
    can_go_back: Arc<RwLock<bool>>,
    can_go_forward: Arc<RwLock<bool>>,
    cdp: Arc<cdp::CdpTab>,
}

#[derive(Clone)]
struct AppState {
    tabs: Arc<Mutex<HashMap<String, Tab>>>,
    active: Arc<RwLock<Option<String>>>,
    frames: broadcast::Sender<String>,
    webrtc_session: Arc<Mutex<Option<webrtc::WebRtcSession>>>,
    webrtc_candidate_host: Option<String>,
}

// ─── Chromium launch ──────────────────────────────────────────────────────

/// Spawn headless Chromium with a loopback-only CDP endpoint.
async fn spawn_chromium() -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let cdp_ready = || async {
        client
            .get(format!("http://127.0.0.1:{CDP_PORT}/json/version"))
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .is_ok()
    };
    // A previous instance of OUR profile may still be alive (service
    // restarts do not kill the browser) — reuse it.
    if cdp_ready().await {
        return Ok(());
    }

    let profile = PathBuf::from(PROFILE_DIR);
    tokio::fs::create_dir_all(&profile).await?;

    // Clear stale browser processes of our profile (e.g. after a crash).
    let _ = tokio::process::Command::new("pkill")
        .args(["-f", "--", "--user-data-dir=/var/lib/ora/browser/profiles"])
        .status()
        .await;

    let mut cmd = tokio::process::Command::new(CHROMIUM_BIN);
    // systemd services have no HOME set; Chromium needs one for its config.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/iora".to_string());
    cmd.env("HOME", &home);
    cmd.args([
        "--headless=new",
        "--no-sandbox", // ORA runs as root
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=TranslateUI",
        "--mute-audio",
        &format!("--remote-debugging-port={CDP_PORT}"),
        "--remote-debugging-address=127.0.0.1",
        &format!("--user-data-dir={PROFILE_DIR}"),
        "--window-size=1280,800",
        "about:blank",
    ]);
    // Keep the browser process alive for the lifetime of this service —
    // killing it on drop would terminate Chromium right after spawning.
    cmd.kill_on_drop(false);
    let _child = cmd.spawn()?;

    // Wait for the CDP endpoint to answer.
    for _ in 0..60 {
        if cdp_ready().await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    anyhow::bail!("Chromium CDP endpoint did not come up on port {CDP_PORT}")
}

/// Create a new page target via the CDP HTTP endpoint.
async fn cdp_new_target(url: &str) -> anyhow::Result<(String, String)> {
    let client = reqwest::Client::new();
    let target_url = format!("http://127.0.0.1:{CDP_PORT}/json/new?{url}");
    let resp = client
        .put(&target_url)
        .timeout(Duration::from_secs(10))
        .send()
        .await?;
    let value: Value = resp.json().await?;
    let id = value["id"].as_str().unwrap_or("").to_string();
    let ws = value["webSocketDebuggerUrl"].as_str().unwrap_or("").to_string();
    if id.is_empty() || ws.is_empty() {
        anyhow::bail!("CDP /json/new returned no target: {value}")
    }
    Ok((id, ws))
}

async fn cdp_close_target(id: &str) {
    let client = reqwest::Client::new();
    let _ = client
        .post(format!("http://127.0.0.1:{CDP_PORT}/json/close/{id}"))
        .timeout(Duration::from_secs(5))
        .send()
        .await;
}

// ─── Tab lifecycle ────────────────────────────────────────────────────────

async fn open_tab(state: &AppState, url: &str) -> anyhow::Result<Tab> {
    let (id, ws_url) = cdp_new_target(&url).await?;
    let (events_tx, mut events_rx) = mpsc::channel::<cdp::TabEvent>(64);
    let cdp_tab = cdp::CdpTab::connect(&ws_url, events_tx).await?;

    let tab = Tab {
        id: id.clone(),
        url: Arc::new(RwLock::new(url.to_string())),
        title: Arc::new(RwLock::new(String::new())),
        can_go_back: Arc::new(RwLock::new(false)),
        can_go_forward: Arc::new(RwLock::new(false)),
        cdp: Arc::new(cdp_tab),
    };
    state.tabs.lock().await.insert(id.clone(), tab.clone());

    // Event pump: forward frames of the ACTIVE tab to the UI broadcast,
    // update navigation state for every tab.
    let pump_state = state.clone();
    let pump_tab = tab.clone();
    tokio::spawn(async move {
        while let Some(event) = events_rx.recv().await {
            match event {
                cdp::TabEvent::Frame { data, w, h } => {
                    if pump_state.active.read().await.as_deref() == Some(pump_tab.id.as_str()) {
                        let msg = json!({
                            "type": "frame",
                            "tab": pump_tab.id,
                            "data": data,
                            "w": w,
                            "h": h,
                        });
                        let _ = pump_state.frames.send(msg.to_string());
                        // Feed the WebRTC render session as well (VP8).
                        if let Some(session) = pump_state.webrtc_session.lock().await.as_ref() {
                            if let Ok(jpeg) = base64::Engine::decode(
                                &base64::engine::general_purpose::STANDARD,
                                &data,
                            ) {
                                session.push_frame(&jpeg);
                            }
                        }
                    }
                }
                cdp::TabEvent::Nav {
                    url,
                    title,
                    can_go_back,
                    can_go_forward,
                } => {
                    *pump_tab.url.write().await = url.clone();
                    *pump_tab.title.write().await = title.clone();
                    *pump_tab.can_go_back.write().await = can_go_back;
                    *pump_tab.can_go_forward.write().await = can_go_forward;
                    broadcast_nav(&pump_state, &pump_tab).await;
                }
                cdp::TabEvent::Closed => {
                    // Tab died (crash / close) — clean up if still present.
                    let mut tabs = pump_state.tabs.lock().await;
                    tabs.remove(&pump_tab.id);
                    drop(tabs);
                    if pump_state.active.read().await.as_deref() == Some(pump_tab.id.as_str()) {
                        *pump_state.active.write().await = None;
                    }
                    broadcast_tabs(&pump_state).await;
                }
            }
        }
    });

    // First tab becomes active automatically.
    if state.active.read().await.is_none() {
        *state.active.write().await = Some(id.clone());
    }
    broadcast_tabs(state).await;
    Ok(tab)
}

async fn broadcast_nav(state: &AppState, tab: &Tab) {
    let msg = json!({
        "type": "nav",
        "tab": tab.id,
        "url": *tab.url.read().await,
        "title": *tab.title.read().await,
        "canGoBack": *tab.can_go_back.read().await,
        "canGoForward": *tab.can_go_forward.read().await,
    });
    let _ = state.frames.send(msg.to_string());
}

async fn broadcast_tabs(state: &AppState) {
    let tabs = state.tabs.lock().await;
    let list: Vec<Value> = tabs
        .values()
        .map(|t| {
            json!({
                "id": t.id,
                "url": *t.url.try_read().map(|g| g.clone()).unwrap_or_default(),
                "title": *t.title.try_read().map(|g| g.clone()).unwrap_or_default(),
            })
        })
        .collect();
    let active = state.active.read().await.clone();
    let _ = state.frames.send(
        json!({"type": "tabs", "tabs": list, "active": active}).to_string(),
    );
}

// ─── HTTP API ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct UrlBody {
    url: String,
}

#[derive(Serialize)]
struct TabInfo {
    id: String,
    url: String,
    title: String,
    active: bool,
}

async fn list_tabs(State(state): State<AppState>) -> Json<Vec<TabInfo>> {
    let tabs = state.tabs.lock().await;
    let active = state.active.read().await.clone();
    let list = tabs
        .values()
        .map(|t| TabInfo {
            id: t.id.clone(),
            url: t.url.try_read().map(|g| g.clone()).unwrap_or_default(),
            title: t.title.try_read().map(|g| g.clone()).unwrap_or_default(),
            active: active.as_deref() == Some(t.id.as_str()),
        })
        .collect();
    Json(list)
}

async fn create_tab(State(state): State<AppState>, Json(body): Json<UrlBody>) -> impl IntoResponse {
    match open_tab(&state, &body.url).await {
        Ok(tab) => Json(json!({"id": tab.id, "ok": true})).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn activate_tab(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !state.tabs.lock().await.contains_key(&id) {
        return (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"error": "unknown tab"})),
        )
            .into_response();
    }
    *state.active.write().await = Some(id);
    broadcast_tabs(&state).await;
    Json(json!({"ok": true})).into_response()
}

async fn close_tab(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let removed = state.tabs.lock().await.remove(&id);
    match removed {
        Some(tab) => {
            cdp_close_target(&tab.id).await;
            if state.active.read().await.as_deref() == Some(tab.id.as_str()) {
                *state.active.write().await = None;
                // Activate the last remaining tab so the surface stays live.
                let first = state
                    .tabs
                    .lock()
                    .await
                    .keys()
                    .next()
                    .cloned();
                if let Some(next) = first {
                    *state.active.write().await = Some(next);
                }
            }
            broadcast_tabs(&state).await;
            Json(json!({"ok": true})).into_response()
        }
        None => (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"error": "unknown tab"})),
        )
            .into_response(),
    }
}

/// Stop hook used by the local app lifecycle (`stop_endpoint` in the app
/// manifest): close every tab so the browser surface is paused while the
/// global Chromium engine keeps running for other apps.
async fn shutdown(State(state): State<AppState>) -> impl IntoResponse {
    let ids: Vec<String> = state.tabs.lock().await.keys().cloned().collect();
    for id in &ids {
        if let Some(tab) = state.tabs.lock().await.remove(id) {
            cdp_close_target(&tab.id).await;
        }
    }
    *state.active.write().await = None;
    broadcast_tabs(&state).await;
    Json(json!({ "ok": true, "closed": ids.len() })).into_response()
}

async fn tab_navigate(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UrlBody>,
) -> impl IntoResponse {
    let Some(tab) = state.tabs.lock().await.get(&id).cloned() else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"error": "unknown tab"})),
        )
            .into_response();
    };
    if tab.cdp.navigate(&body.url).await.is_ok() {
        *tab.url.write().await = body.url;
    }
    Json(json!({"ok": true})).into_response()
}

async fn tab_action(
    State(state): State<AppState>,
    Path((id, action)): Path<(String, String)>,
) -> impl IntoResponse {
    let Some(tab) = state.tabs.lock().await.get(&id).cloned() else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"error": "unknown tab"})),
        )
            .into_response();
    };
    let result = match action.as_str() {
        "back" => tab.cdp.back().await,
        "forward" => tab.cdp.forward().await,
        "reload" => tab.cdp.reload().await,
        other => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("unknown action {other}")})),
            )
                .into_response();
        }
    };
    if result.is_err() {
        return (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "cdp command failed"})),
        )
            .into_response();
    }
    Json(json!({"ok": true})).into_response()
}

// ─── WebSocket: frame stream + input ──────────────────────────────────────

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    #[serde(rename = "input")]
    Input {
        kind: String,
        #[serde(default)]
        event: String,
        #[serde(default)]
        x: f64,
        #[serde(default)]
        y: f64,
        #[serde(default)]
        delta_x: f64,
        #[serde(default)]
        delta_y: f64,
        #[serde(default)]
        key: String,
        #[serde(default)]
        code: String,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        button: String,
    },
    #[serde(rename = "navigate")]
    Navigate { url: String },
    #[serde(rename = "back")]
    Back,
    #[serde(rename = "forward")]
    Forward,
    #[serde(rename = "reload")]
    Reload,
    #[serde(rename = "tab-new")]
    TabNew { url: String },
    #[serde(rename = "tab-activate")]
    TabActivate { id: String },
    #[serde(rename = "tab-close")]
    TabClose { id: String },
    #[serde(rename = "webrtc-offer")]
    WebRtcOffer { sdp: String },
    #[serde(rename = "ice")]
    Ice { candidate: String },
}

async fn ws_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_loop(socket, state))
}

async fn ws_loop(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut frame_rx = state.frames.subscribe();
    let (session_evt_tx, mut session_evt_rx) = tokio::sync::mpsc::channel::<webrtc::SessionEvent>(32);

    // Push the current tab list + navigation state immediately.
    broadcast_tabs(&state).await;
    if let Some(active_id) = state.active.read().await.clone() {
        if let Some(tab) = state.tabs.lock().await.get(&active_id).cloned() {
            broadcast_nav(&state, &tab).await;
        }
    }

    let mut ping = tokio::time::interval(Duration::from_secs(20));
    loop {
        tokio::select! {
            frame = frame_rx.recv() => {
                let Ok(text) = frame else { break };
                if sender.send(WsMessage::Text(text.into())).await.is_err() {
                    break;
                }
            }
            _ = ping.tick() => {
                if sender.send(WsMessage::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else { break };
                let text = match message {
                    WsMessage::Text(t) => t,
                    WsMessage::Binary(b) => String::from_utf8_lossy(&b).to_string(),
                    _ => continue,
                };
                let Ok(msg) = serde_json::from_str::<ClientMsg>(&text) else { continue };
                let active = state.active.read().await.clone();
                let tab = match &active {
                    Some(id) => state.tabs.lock().await.get(id).cloned(),
                    None => None,
                };
                match msg {
                    ClientMsg::WebRtcOffer { sdp } => {
                        // Replace any previous session.
                        *state.webrtc_session.lock().await = None;
                        let (std_tx, std_rx) = std::sync::mpsc::channel::<webrtc::SessionEvent>();
                        let tokio_tx = session_evt_tx.clone();
                        std::thread::spawn(move || {
                            while let Ok(event) = std_rx.recv() {
                                if tokio_tx.blocking_send(event).is_err() {
                                    break;
                                }
                            }
                        });
                        match webrtc::WebRtcSession::start(
                            &sdp,
                            std_tx,
                            state.webrtc_candidate_host.clone(),
                        ) {
                            Ok(session) => {
                                *state.webrtc_session.lock().await = Some(session);
                            }
                            Err(e) => {
                                let _ = sender.send(WsMessage::Text(
                                    json!({"type": "webrtc-error", "message": e}).to_string().into(),
                                )).await;
                            }
                        }
                    }
                    ClientMsg::Ice { candidate } => {
                        if let Some(session) = state.webrtc_session.lock().await.as_ref() {
                            session.remote_ice(&candidate);
                        }
                    }
                    ClientMsg::Navigate { url } => {
                        if let Some(t) = &tab { let _ = t.cdp.navigate(&url).await; }
                    }
                    ClientMsg::Back => { if let Some(t) = &tab { let _ = t.cdp.back().await; } }
                    ClientMsg::Forward => { if let Some(t) = &tab { let _ = t.cdp.forward().await; } }
                    ClientMsg::Reload => { if let Some(t) = &tab { let _ = t.cdp.reload().await; } }
                    ClientMsg::TabNew { url } => { let _ = open_tab(&state, &url).await; }
                    ClientMsg::TabActivate { id } => {
                        *state.active.write().await = Some(id);
                        broadcast_tabs(&state).await;
                    }
                    ClientMsg::TabClose { id } => {
                        if let Some(t) = state.tabs.lock().await.remove(&id) {
                            cdp_close_target(&t.id).await;
                            if *state.active.read().await == Some(id) {
                                *state.active.write().await = None;
                            }
                            broadcast_tabs(&state).await;
                        }
                    }
                    ClientMsg::Input { kind, event, x, y, delta_x, delta_y, key, code, text, button } => {
                        if let Some(t) = &tab {
                            match kind.as_str() {
                                "mouse" => {
                                    let event = match event.as_str() {
                                        "down" => "mousePressed",
                                        "up" => "mouseReleased",
                                        _ => "mouseMoved",
                                    };
                                    let button = if button.is_empty() { "left" } else { &button };
                                    let _ = t.cdp.mouse(event, x, y, button).await;
                                }
                                "wheel" => { let _ = t.cdp.wheel(delta_x, delta_y).await; }
                                "key" => {
                                    let down = event.as_str() != "up";
                                    let _ = t.cdp.key(down, &key, &code, text.as_deref()).await;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            evt = session_evt_rx.recv() => {
                let Some(event) = evt else { continue };
                let msg = match event {
                    webrtc::SessionEvent::Answer { sdp } => {
                        json!({"type": "webrtc-answer", "sdp": sdp})
                    }
                    webrtc::SessionEvent::Ice { candidate } => {
                        json!({"type": "ice", "candidate": candidate})
                    }
                    webrtc::SessionEvent::Error(message) => {
                        json!({"type": "webrtc-error", "message": message})
                    }
                };
                if sender.send(WsMessage::Text(msg.to_string().into())).await.is_err() {
                    break;
                }
            }
        }
    }
}

// ─── Static UI ────────────────────────────────────────────────────────────

const INDEX_HTML: &str = include_str!("../static/index.html");

async fn index() -> impl axum::response::IntoResponse {
    // Never cache the UI — the app-runner iframe must always pick up the
    // current version (stale cached copies showed the pre-proxy WS URL).
    (
        [("cache-control", "no-store")],
        Html(INDEX_HTML),
    )
}

// ─── Main ─────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    spawn_chromium().await?;
    tracing::info!("Chromium ready (CDP on 127.0.0.1:{CDP_PORT})");

    let state = AppState {
        tabs: Arc::new(Mutex::new(HashMap::new())),
        active: Arc::new(RwLock::new(None)),
        frames: broadcast::channel(64).0,
        webrtc_session: Arc::new(Mutex::new(None)),
        webrtc_candidate_host: std::env::var("IORA_WEBRTC_CANDIDATE_HOST")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };

    // Restore a fresh start tab.
    let initial = open_tab(&state, "about:blank").await;
    if let Err(e) = initial {
        tracing::warn!("initial tab failed: {e}");
    }

    let app = Router::new()
        .route("/", get(index))
        .route("/api/tabs", get(list_tabs).post(create_tab))
        .route("/api/tabs/:id/activate", post(activate_tab))
        .route("/api/tabs/:id/close", post(close_tab))
        .route("/api/tabs/:id/navigate", post(tab_navigate))
        .route("/api/tabs/:id/:action", post(tab_action))
        .route("/api/shutdown", post(shutdown))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], SERVICE_PORT));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("iora-browserd listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
