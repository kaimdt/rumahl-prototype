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
        .route(
            "/api/mappings",
            get(mappings_get).post(mappings_add).delete(mappings_remove),
        )
        .route("/api/vms", get(vms))
        .route("/api/vms/attach", post(vms_attach))
        .route("/api/vms/stop", post(vms_stop))
        .route("/api/network/reset", post(network_reset))
        .route("/api/monitoring", get(monitoring))
        .route("/api/maintenance/config-sync", post(config_sync))
        .route(
            "/api/maintenance/docker-compose",
            post(install_docker_compose),
        )
        .route("/api/maintenance/force-sync", post(force_sync))
        .route("/api/maintenance/force-sync/status", get(force_sync_status))
        .route(
            "/api/maintenance/force-sync/cancel",
            post(force_sync_cancel),
        )
        .route("/api/guest", post(guest))
        .route("/api/ssh", post(ssh_open))
        .route("/api/logs", get(logs))
        .route("/api/logs/stream", get(log_stream))
        .route("/ws/ssh", get(ws_ssh))
        // Disk management: inspect the VM disk and expand it (live via QMP
        // when the VM runs, qemu-img when stopped, guest grow via QGA).
        .route("/api/disk", get(disk_info))
        .route("/api/disk/resize", post(disk_resize))
        // Persistent Dev Manager settings (dev-manager.json).
        .route("/api/settings", get(settings_get).post(settings_set))
        // SFTP key download (private key of the guest SSH channel).
        .route("/api/sftp/key", get(sftp_key))
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

/// List all running QEMU processes; rumahl Dev VMs can be attached or
/// stopped from the dashboard even when they were started by dev-local.
async fn vms(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let result = daemon.qemu_vms().await;
    // Never block the request on the slow process scan: kick a background
    // refresh when the cache is empty; the periodic task keeps it warm.
    if result["vms"]
        .as_array()
        .map(|a| a.is_empty())
        .unwrap_or(true)
    {
        let refresh = daemon.clone();
        tokio::spawn(async move { refresh.refresh_vms_cache().await });
    }
    Json(result)
}

async fn vms_attach(State(daemon): State<Arc<Daemon>>, Json(body): Json<VmPidBody>) -> Json<Value> {
    match daemon.adopt_foreign(body.pid).await {
        Ok(()) => {
            Json(json!({"ok": true, "message": format!("Attached to QEMU PID {}", body.pid)}))
        }
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
    match daemon
        .service_logs(query.unit, query.tail.unwrap_or(100))
        .await
    {
        Ok(output) => Json(json!({"ok": true, "output": output})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

async fn stats(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    Json(daemon.stats().await)
}

/// Guest-side invariants that commonly break local development while the VM
/// itself still appears healthy. Kept in the Dev Manager control plane so
/// recovery remains available when the rumahl web application is unavailable.
async fn monitoring(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let command = r#"
set +e
check() { if sh -c "$2" >/dev/null 2>&1; then printf 'ok|%s|%s\n' "$1" "$3"; else printf 'error|%s|%s\n' "$1" "$4"; fi; }
check jwt_file 'test -s /etc/ora/jwt-secret' '/etc/ora/jwt-secret is present' '/etc/ora/jwt-secret is missing or empty'
check jwt_size 'test "$(wc -c </etc/ora/jwt-secret 2>/dev/null)" -ge 32' 'JWT secret length is valid' 'JWT secret is shorter than 32 bytes'
check jwt_env 'test "$(sed -n "s/^RUMAHL_JWT_SECRET=//p" /etc/ora/service.env 2>/dev/null | tail -1 | wc -c)" -ge 33' 'Service environment contains a valid JWT secret' 'Service environment JWT secret is missing or too short'
check jwt_match 'test "$(cat /etc/ora/jwt-secret 2>/dev/null)" = "$(sed -n "s/^RUMAHL_JWT_SECRET=//p" /etc/ora/service.env 2>/dev/null | tail -1)"' 'JWT file and service environment match' 'JWT file and service environment differ'
check files 'systemctl is-active --quiet rumahl-files' 'rumahl-files is active' 'rumahl-files is not active'
check home 'systemctl is-active --quiet rumahl-home' 'rumahl-home is active' 'rumahl-home is not active'
check supervisor 'systemctl is-active --quiet rumahl-supervisor' 'rumahl-supervisor is active' 'rumahl-supervisor is not active'
check docker 'docker info >/dev/null 2>&1' 'Docker daemon is reachable' 'Docker daemon is unavailable'
check compose '(docker compose version || docker-compose version) >/dev/null 2>&1' 'Docker Compose is available' 'Neither Compose v2 nor docker-compose is available'
check files_health 'curl -fsS http://127.0.0.1:8100/health >/dev/null' 'Files health endpoint responds' 'Files health endpoint is unavailable'
df -P /var/lib/ora 2>/dev/null | awk 'NR==2 {print "info|disk|" $5 " used on " $6}'
systemctl --failed --no-legend 2>/dev/null | awk '{print "error|failed_unit|" $1 " is failed"}'
"#;
    match daemon.guest(command.to_string()).await {
        Ok(output) => {
            let checks = output
                .lines()
                .filter_map(|line| {
                    let mut fields = line.splitn(3, '|');
                    Some(json!({
                        "status": fields.next()?,
                        "id": fields.next()?,
                        "message": fields.next()?,
                    }))
                })
                .collect::<Vec<_>>();
            Json(json!({"ok": true, "checks": checks}))
        }
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

/// Re-run the canonical guest config synchronizer and restart only the
/// services that consume the shared JWT/Files configuration.
async fn config_sync(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let command = r#"
set -eu
SOURCE=/home/ora/ora/rumahl-os/rumahl-config-sync.sh
SCRIPT=/usr/lib/ora/rumahl-config-sync
if [ -r "$SOURCE" ]; then install -m 0755 "$SOURCE" "$SCRIPT"; fi
test -r "$SCRIPT"
bash "$SCRIPT"
test -s /etc/ora/jwt-secret
test "$(wc -c </etc/ora/jwt-secret)" -ge 32
systemctl daemon-reload
systemctl restart rumahl-home
systemctl restart rumahl-files
systemctl restart rumahl-supervisor
printf 'Config synchronized; JWT file verified; services restarted.'
"#;
    match daemon.guest(command.to_string()).await {
        Ok(output) => Json(json!({"ok": true, "output": output})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

/// Install the Compose implementation supported by the guest's configured
/// APT repositories. This is intentionally an explicit recovery action rather
/// than an automatic background mutation of a running development VM.
async fn install_docker_compose(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let command = r#"
set -eu
if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
    printf 'Docker Compose is already available.'
    exit 0
fi
command -v apt-get >/dev/null 2>&1 || { printf 'Automatic Compose recovery requires an APT-based guest.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
    sleep 3
done
apt-get update -qq
if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    apt-get install -y -qq --no-install-recommends docker-compose-plugin
elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    apt-get install -y -qq --no-install-recommends docker-compose-v2
else
    apt-get install -y -qq --no-install-recommends docker-compose
fi
docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1
systemctl restart rumahl-supervisor
printf 'Docker Compose installed and rumahl-supervisor restarted.'
"#;
    match daemon.guest(command.to_string()).await {
        Ok(output) => Json(json!({"ok": true, "output": output})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
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

/// Current VM disk information (virtual + on-disk size).
async fn disk_info(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let manager = daemon.manager.lock().await;
    let info = manager.disk_info().await;
    let config = manager.config.clone();
    Json(json!({"ok": true, "disk": info, "defaultDiskGb": config.default_disk_gb}))
}

/// Force Sync & Rebuild: push every source file into the guest and rebuild
/// the affected rumahl services. Runs detached - the response returns right
/// away, progress appears in the live log stream and under
/// /api/maintenance/force-sync/status. A second invocation while one is
/// already running is rejected (parallel guest builds would block each
/// other on the cargo lock).
async fn force_sync(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    if daemon.force_sync_status()["running"] == serde_json::Value::Bool(true) {
        return Json(json!({
            "ok": false,
            "message": "Force Sync & Rebuild läuft bereits — Fortschritt siehe unten im Monitoring-Bereich. Warte auf den Abschluss, bevor du erneut klickst.",
        }));
    }
    let worker = daemon.clone();
    tokio::spawn(async move {
        match worker.force_sync_and_rebuild().await {
            Ok(summary) => worker.emit("status", format!("✓ {summary}")),
            Err(error) => worker.emit("error", format!("Force sync failed: {error:#}")),
        }
    });
    Json(json!({
        "ok": true,
        "message": "Force Sync & Rebuild gestartet — Fortschritt im Monitoring-Bereich und im Log.",
    }))
}

/// Live progress of the running Force Sync & Rebuild.
async fn force_sync_status(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    Json(json!({"ok": true, "status": daemon.force_sync_status()}))
}

/// Cancel the running Force Sync & Rebuild (stops the guest build, aborts
/// the worker at the next check point).
async fn force_sync_cancel(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    if daemon.cancel_force_sync() {
        Json(json!({
            "ok": true,
            "message": "Abbruch angefordert — der Force Sync wird an der nächsten Stelle beendet.",
        }))
    } else {
        Json(json!({
            "ok": false,
            "message": "Kein aktiver Force Sync zum Abbrechen.",
        }))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskResizeBody {
    size_gb: u64,
}

/// Expand the VM disk (live QMP block_resize when running, qemu-img when
/// stopped) and grow the guest root filesystem via QGA.
async fn disk_resize(
    State(daemon): State<Arc<Daemon>>,
    Json(body): Json<DiskResizeBody>,
) -> Json<Value> {
    if body.size_gb == 0 || body.size_gb > 4096 {
        return Json(json!({
            "ok": false,
            "message": "size_gb must be between 1 and 4096"
        }));
    }
    let manager = daemon.manager.lock().await;
    match manager.resize_disk(body.size_gb).await {
        Ok(message) => Json(json!({"ok": true, "message": message})),
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsBody {
    default_disk_gb: Option<u64>,
    default_ram_gb: Option<u64>,
    default_cpus: Option<u32>,
    autostart: Option<bool>,
    sftp_user: Option<String>,
    extra_ports: Option<String>,
}

/// Read the persistent Dev Manager settings (dev-manager.json).
async fn settings_get(State(daemon): State<Arc<Daemon>>) -> Json<Value> {
    let manager = daemon.manager.lock().await;
    let config = manager.config.clone();
    let disk = manager.disk_info().await;
    Json(json!({
        "ok": true,
        "config": config,
        "disk": disk,
        "state": { "running": manager.state.process_alive() },
    }))
}

/// Update the persistent Dev Manager settings. Values apply to NEW VM disk
/// creations (dev-local bootstrap) and to the next VM start (RAM/CPUs).
async fn settings_set(
    State(daemon): State<Arc<Daemon>>,
    Json(body): Json<SettingsBody>,
) -> Json<Value> {
    let mut manager = daemon.manager.lock().await;
    let mut config = manager.config.clone();
    if let Some(value) = body.default_disk_gb {
        if !(4..=4096).contains(&value) {
            return Json(json!({"ok": false, "message": "defaultDiskGb must be 4..4096"}));
        }
        config.default_disk_gb = value;
    }
    if let Some(value) = body.default_ram_gb {
        if !(4..=64).contains(&value) {
            return Json(json!({"ok": false, "message": "defaultRamGb must be 4..64"}));
        }
        config.default_ram_gb = value;
    }
    if let Some(value) = body.default_cpus {
        if !(1..=64).contains(&value) {
            return Json(json!({"ok": false, "message": "defaultCpus must be 1..64"}));
        }
        config.default_cpus = value;
    }
    if let Some(value) = body.autostart {
        config.autostart = value;
    }
    if let Some(value) = body.sftp_user {
        let value = value.trim().to_string();
        if value.is_empty() {
            return Json(json!({"ok": false, "message": "sftpUser must not be empty"}));
        }
        config.sftp_user = value;
    }
    if let Some(value) = body.extra_ports {
        config.extra_ports = value
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .collect::<Vec<_>>()
            .join(",");
    }
    match config.save(&manager.root) {
        Ok(()) => {
            // Persist the in-memory copy so /api/settings (and the next
            // VM start / disk creation) sees the new values immediately -
            // without this the dashboard would keep showing the old ones.
            manager.config = config.clone();
            Json(json!({
                "ok": true,
                "message": "Settings saved to dev-manager.json (apply to the next VM start / new disk creation).",
                "config": config,
            }))
        }
        Err(error) => Json(json!({"ok": false, "message": format!("{error:#}")})),
    }
}

/// Download the guest SSH private key for SFTP clients (WinSCP/FileZilla/
/// scp). Loopback dev tool - the key is generated by dev-local.ps1.
async fn sftp_key(State(daemon): State<Arc<Daemon>>) -> Response {
    let manager = daemon.manager.lock().await;
    let key_path = manager.root.join(".cache/rumahl-dev-key");
    let bytes = match std::fs::read(&key_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return StatusCode::NOT_FOUND.into_response();
        }
    };
    let attachment = format!(
        "attachment; filename={}",
        key_path.file_name().unwrap_or_default().to_string_lossy()
    );
    (
        [
            (header::CONTENT_TYPE, "application/x-pem-file".to_string()),
            (header::CONTENT_DISPOSITION, attachment),
        ],
        bytes,
    )
        .into_response()
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
            manager.root.join(".cache/rumahl-dev-key"),
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
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
            if ws_tx.send(Message::Binary(bytes)).await.is_err() {
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
