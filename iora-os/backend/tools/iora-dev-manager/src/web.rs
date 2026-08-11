use crate::{daemon::Daemon, state::NetworkMode};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures::stream::{self, Stream, StreamExt};
use futures::SinkExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{convert::Infallible, path::PathBuf, process::Stdio, sync::Arc};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::mpsc,
};

pub fn router(daemon: Arc<Daemon>) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/api/status", get(status))
        .route("/api/start", post(start))
        .route("/api/stop", post(stop))
        .route("/api/kill", post(kill))
        .route("/api/reinstall", post(reinstall))
        .route("/api/pause", post(pause))
        .route("/api/resume", post(resume))
        .route("/api/reset", post(reset))
        .route("/api/snapshot", post(snapshot))
        .route("/api/services", get(services))
        .route("/api/service/action", post(service_action))
        .route("/api/service/logs", get(service_logs))
        .route("/api/stats", get(stats))
        .route("/api/mappings", get(mappings_get).post(mappings_add).delete(mappings_remove))
        .route("/api/vms", get(vms))
        .route("/api/vms/attach", post(vms_attach))
        .route("/api/vms/stop", post(vms_stop))
        .route("/api/network/reset", post(network_reset))
        .route("/api/guest", post(guest))
        .route("/api/ssh", post(ssh_open))
        .route("/api/logs", get(logs))
        .route("/api/logs/stream", get(log_stream))
        .route("/ws/ssh", get(ws_ssh))
        .fallback(novnc_fallback)
        .with_state(daemon)
}

async fn index() -> Html<&'static str> {
    Html(include_str!("../dashboard.html"))
}

async fn status(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    Json(daemon.status_json().await)
}

#[derive(Deserialize)]
struct StartBody {
    mode: Option<String>,
}

async fn start(State(daemon): State<Arc<Daemon>>, Json(body): Json<StartBody>) -> Json<Value> {
    let mode = match body.mode.as_deref() {
        Some("bridge") => NetworkMode::Bridge,
        _ => NetworkMode::Slirp,
    };
    match daemon.start(mode).await {
        Ok(()) => Json(json!({"ok": true, "message": "VM start requested"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

#[derive(Deserialize)]
struct StopBody {
    hard: Option<bool>,
}

async fn stop(State(daemon): State<Arc<Daemon>>, Json(body): Json<StopBody>) -> Json<Value> {
    match daemon.stop(body.hard.unwrap_or(false)).await {
        Ok(()) => Json(json!({"ok": true, "message": "Stop requested"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn kill(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.stop(true).await {
        Ok(()) => Json(json!({"ok": true, "message": "VM process terminated"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

#[derive(Deserialize)]
struct VmPidBody {
    pid: u32,
}

/// List all running QEMU processes; IORA Dev VMs can be attached or
/// stopped from the dashboard even when they were started by dev-local.
async fn vms(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let result = daemon.qemu_vms().await;
    // Never block the request on the slow process scan: kick a background
    // refresh when the cache is empty; the periodic task keeps it warm.
    if result["vms"].as_array().map(|a| a.is_empty()).unwrap_or(true) {
        let refresh = daemon.clone();
        tokio::spawn(async move { refresh.refresh_vms_cache().await });
    }
    Json(result)
}

async fn vms_attach(State(daemon): State<Arc<Daemon>>, Json(body): Json<VmPidBody>) -> Json<Value> {
    match daemon.adopt_foreign(body.pid).await {
        Ok(()) => Json(json!({"ok": true, "message": format!("Attached to QEMU PID {}", body.pid)})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

/// Slirp NIC reset: rebuilds the QEMU user-net backend without restarting
/// the VM - fixes stuck sessions / broken hostfwd rules.
async fn network_reset(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.reset_network().await {
        Ok(message) => Json(json!({"ok": true, "message": message})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn vms_stop(State(daemon): State<Arc<Daemon>>, Json(body): Json<VmPidBody>) -> Json<Value> {
    match daemon.stop_foreign(body.pid).await {
        Ok(message) => Json(json!({"ok": true, "message": message})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn reinstall(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.reinstall().await {
        Ok(()) => Json(json!({"ok": true, "message": "VM reinstall requested"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn pause(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.qmp("stop", "VM paused").await {
        Ok(()) => Json(json!({"ok": true, "message": "VM paused"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn resume(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.qmp("cont", "VM resumed").await {
        Ok(()) => Json(json!({"ok": true, "message": "VM resumed"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn reset(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.qmp("system_reset", "VM reset requested").await {
        Ok(()) => Json(json!({"ok": true, "message": "VM reset requested"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn snapshot(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.snapshot().await {
        Ok(()) => Json(json!({"ok": true, "message": "Golden Snapshot created"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn services(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    match daemon.services().await {
        Ok(services) => Json(json!({"ok": true, "services": services})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

#[derive(Deserialize)]
struct ServiceActionBody {
    unit: String,
    action: String,
}

async fn service_action(
    State(daemon): State<Arc<Daemon>>,
    Json(body): Json<ServiceActionBody>,
) -> Json<Value> {
    match daemon.service_action(body.unit, body.action).await {
        Ok(output) => Json(json!({"ok": true, "output": output})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

#[derive(Deserialize)]
struct ServiceLogsQuery {
    unit: String,
    tail: Option<usize>,
}

async fn service_logs(
    State(daemon): State<Arc<Daemon>>,
    Query(query): Query<ServiceLogsQuery>,
) -> Json<Value> {
    match daemon.service_logs(query.unit, query.tail.unwrap_or(100)).await {
        Ok(output) => Json(json!({"ok": true, "output": output})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn stats(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    Json(daemon.stats().await)
}

async fn mappings_get(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    Json(daemon.mappings_status().await)
}

#[derive(Deserialize)]
struct MappingBody {
    host: u16,
    guest: u16,
    label: Option<String>,
}

async fn mappings_add(
    State(daemon): State<Arc<Daemon>>,
    Json(body): Json<MappingBody>,
) -> Json<Value> {
    match daemon.add_mapping(body.host, body.guest, body.label).await {
        Ok(()) => Json(json!({"ok": true, "message": "Mapping added"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

#[derive(Deserialize)]
struct MappingRemoveQuery {
    host: u16,
}

async fn mappings_remove(
    State(daemon): State<Arc<Daemon>>,
    Query(query): Query<MappingRemoveQuery>,
) -> Json<Value> {
    match daemon.remove_mapping(query.host).await {
        Ok(()) => Json(json!({"ok": true, "message": "Mapping removed"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn ssh_open(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let manager = daemon.manager.lock().await;
    match manager.open_ssh() {
        Ok(()) => Json(json!({"ok": true, "message": "SSH session closed"})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

/// Serve the bundled noVNC viewer (core/, vendor/ and vnc-viewer.html)
/// from the tool directory so the console works without a CDN.
async fn novnc_fallback(uri: axum::http::Uri) -> Response {
    let Some(relative) = uri.path().strip_prefix("/novnc/") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("novnc");
    let candidate = base.join(relative);
    if !candidate.starts_with(&base) || !candidate.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let bytes = match std::fs::read(&candidate) {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let content_type = match candidate
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "json" => "application/json",
        _ => "application/octet-stream",
    };
    ([(header::CONTENT_TYPE, content_type)], bytes).into_response()
}

async fn ws_ssh(State(daemon): State<Arc<Daemon>>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ssh_terminal(socket, daemon))
}

/// Bidirectional terminal: browser WebSocket <-> ssh process.
async fn ssh_terminal(mut socket: WebSocket, daemon: Arc<Daemon>) {
    let (host, port, key, root) = {
        let manager = daemon.manager.lock().await;
        let (host, port, _) = manager.state.connection();
        (
            host.to_string(),
            port,
            manager.root.join(".cache/iora-dev-key"),
            manager.root.clone(),
        )
    };
    let _ = root;
    let mut command = Command::new("ssh");
    command
        .args([
            "-tt",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "BatchMode=yes",
            "-p",
            &port.to_string(),
        ])
        .arg(format!("root@{host}"));
    #[cfg(windows)]
    command.args(["-o", "UserKnownHostsFile=NUL"]);
    #[cfg(not(windows))]
    command.args(["-o", "UserKnownHostsFile=/dev/null"]);
    if key.exists() {
        command.arg("-i").arg(&key);
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = socket
                .send(Message::Text(format!("SSH client unavailable: {error}")))
                .await;
            let _ = socket.close().await;
            return;
        }
    };
    let mut stdin = child.stdin.take().expect("ssh stdin piped");
    let stdout = child.stdout.take().expect("ssh stdout piped");
    let stderr = child.stderr.take().expect("ssh stderr piped");
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<Vec<u8>>(64);
    tokio::spawn(pipe_read(stdout, out_tx.clone()));
    tokio::spawn(pipe_read(stderr, out_tx));
    let out_task = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if ws_tx.send(Message::Binary(bytes.into())).await.is_err() {
                return;
            }
        }
        let _ = ws_tx.send(Message::Close(None)).await;
    });
    while let Some(message) = ws_rx.next().await {
        match message {
            Ok(Message::Binary(bytes)) => {
                let _ = stdin.write_all(&bytes).await;
                let _ = stdin.flush().await;
            }
            Ok(Message::Text(text)) => {
                let _ = stdin.write_all(text.as_bytes()).await;
                let _ = stdin.flush().await;
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }
    let _ = child.kill().await;
    let _ = out_task.await;
}

async fn pipe_read<R>(mut reader: R, tx: mpsc::Sender<Vec<u8>>)
where
    R: AsyncRead + Unpin,
{
    let mut buffer = [0u8; 4096];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if tx.send(buffer[..n].to_vec()).await.is_err() {
                    break;
                }
            }
        }
    }
}

#[derive(Deserialize)]
struct GuestBody {
    command: String,
}

async fn guest(State(daemon): State<Arc<Daemon>>, Json(body): Json<GuestBody>) -> Json<Value> {
    match daemon.guest(body.command).await {
        Ok(output) => Json(json!({"ok": true, "output": output})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

#[derive(Deserialize)]
struct LogsQuery {
    tail: Option<usize>,
}

async fn logs(State(daemon): State<Arc<Daemon>>, Query(query): Query<LogsQuery>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "lines": daemon.logs_snapshot(query.tail.unwrap_or(200)),
    }))
}

fn sanitize_sse_data(data: impl AsRef<str>) -> String {
    data.as_ref().replace(['\r', '\n'], " ")
}

async fn log_stream(
    State(daemon): State<Arc<Daemon>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Backlog first, then live events from the broadcast channel.
    let backlog = daemon.logs_snapshot(500);
    let initial = stream::iter(backlog.into_iter().map(|line| {
        Ok::<Event, Infallible>(Event::default().event("log").data(sanitize_sse_data(line)))
    }));
    let receiver = daemon.events.subscribe();
    let live = stream::unfold(receiver, |mut receiver| async move {
        match receiver.recv().await {
            Ok(event) => {
                // Sanitize defensively: SSE payloads must not contain newlines.
                let data = sanitize_sse_data(event.message);
                Some((
                    Ok::<Event, Infallible>(Event::default().event(&event.kind).data(data)),
                    receiver,
                ))
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => Some((
                Ok::<Event, Infallible>(
                    Event::default()
                        .event("error")
                        .data("log stream lagged; some lines were dropped"),
                ),
                receiver,
            )),
            Err(tokio::sync::broadcast::error::RecvError::Closed) => None,
        }
    });
    Sse::new(initial.chain(live)).keep_alive(KeepAlive::default())
}
