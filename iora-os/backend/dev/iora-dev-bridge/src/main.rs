// iora-dev-bridge — local hot-reload endpoint.
//
// This binary is ONLY shipped on images built with `IORA_OS_DEV=1`
// (i.e. `iora-os/build.sh --dev`).  On a production image the file at
// `/usr/bin/iora-dev-bridge` does not exist, the systemd unit is not
// installed, and `/etc/iora/dev-mode` is absent — so the Developer App
// cannot obtain any elevated hot-reload capability at runtime.
//
// The bridge binds by default to 127.0.0.1:8099.  With `--listen 0.0.0.0`
// (or env `IORA_DEV_BIND`) you can expose it on the LAN during remote
// development.  It requires a token from `/etc/iora/dev-token` that is
// generated freshly for each image build.
//
// Endpoints (all JSON):
//   GET  /dev/status                 → build/version + capabilities
//   POST /dev/service/{name}/restart → systemctl restart
//   POST /dev/service/{name}/reload  → systemctl try-reload-or-restart
//   POST /dev/compose/{svc}/reload   → docker compose up -d --force-recreate
//   POST /dev/compose/{svc}/logs     → tail compose logs
//   POST /dev/replace-binary         → multipart upload, atomic swap + restart
//
// None of these work on a production image because the binary isn't there.

use anyhow::{Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const DEV_MODE_FILE: &str = "/etc/iora/os-dev-mode";
const DEV_TOKEN_FILE: &str = "/etc/iora/dev-token";
const VERSION_FILE:  &str = "/etc/iora-version";
const COMPOSE_DIR:   &str = "/mnt/data/iora";

#[derive(Parser, Debug)]
#[command(name = "iora-dev-bridge")]
struct Cli {
    /// Address to bind (default 127.0.0.1:8099 or $IORA_DEV_BIND).
    #[arg(long, env = "IORA_DEV_BIND")]
    listen: Option<String>,
}

#[derive(Clone)]
struct AppState {
    token: Arc<String>,
    build_id: Arc<String>,
}

#[cfg(unix)]
fn nix_like_euid() -> String {
    // Avoid pulling nix as a dep — read /proc/self/status which always
    // exists on Linux dev images and gives us the real EUID.
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("Uid:"))
                .map(|l| l.trim_start_matches("Uid:").trim().to_string())
        })
        .unwrap_or_else(|| "<unknown>".into())
}

/// Best-effort: when the existing token file is unreadable (EACCES) we
/// regenerate it. Only safe when we run as root, which the systemd unit
/// guarantees on dev images.
async fn try_regenerate_token() -> Option<String> {
    use std::io::{Read as _, Write as _};
    // 32 random bytes from /dev/urandom — same source as post-build.sh.
    let mut buf = [0u8; 32];
    {
        let mut f = std::fs::File::open("/dev/urandom").ok()?;
        f.read_exact(&mut buf).ok()?;
    }
    let new_token: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    let path = std::path::Path::new(DEV_TOKEN_FILE);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut f = match std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
    {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!("could not regenerate dev token at {DEV_TOKEN_FILE}: {e}");
            return None;
        }
    };
    if f.write_all(new_token.as_bytes()).is_err() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    tracing::info!("regenerated {DEV_TOKEN_FILE} (mode 0600)");
    Some(new_token)
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Refuse to start on anything that isn't a dev image.  This is a
    // defence-in-depth check; the real guarantee is that the binary only
    // exists on dev images in the first place.
    if !std::path::Path::new(DEV_MODE_FILE).exists() {
        anyhow::bail!(
            "{DEV_MODE_FILE} not found — iora-dev-bridge refuses to run on a non-OS-dev image"
        );
    }
    // Read the per-image dev token. Surface a useful diagnostic (path,
    // existence, mode) into the journal so operators don't get a bare
    // "Permission denied (os error 13)" — historically this has cost us
    // hours when the token file vanished after a rauc upgrade or got the
    // wrong owner.
    let token = match tokio::fs::read_to_string(DEV_TOKEN_FILE).await {
        Ok(t) => t.trim().to_string(),
        Err(e) => {
            let path = std::path::Path::new(DEV_TOKEN_FILE);
            let exists = path.exists();
            let mode = std::fs::metadata(path)
                .ok()
                .map(|m| {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        format!("0o{:o}", m.permissions().mode() & 0o7777)
                    }
                    #[cfg(not(unix))]
                    {
                        let _ = m;
                        "n/a".to_string()
                    }
                })
                .unwrap_or_else(|| "<no metadata>".to_string());
            let euid = {
                #[cfg(unix)]
                {
                    nix_like_euid()
                }
                #[cfg(not(unix))]
                {
                    "n/a".to_string()
                }
            };
            // EACCES: regenerate the token in-place so a broken-permissions
            // image self-heals on next restart instead of looping forever.
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                tracing::warn!(
                    "{DEV_TOKEN_FILE} unreadable (mode={mode}, euid={euid}); regenerating."
                );
                if let Some(t) = try_regenerate_token().await {
                    t
                } else {
                    return Err(anyhow::anyhow!(
                        "reading dev token at {DEV_TOKEN_FILE}: {e} (exists={exists}, mode={mode}, euid={euid}). \
                         Fix with: chmod 0600 {DEV_TOKEN_FILE} && chown root:root {DEV_TOKEN_FILE}"
                    ));
                }
            } else {
                return Err(anyhow::anyhow!(
                    "reading dev token at {DEV_TOKEN_FILE}: {e} (exists={exists}, mode={mode}, euid={euid})"
                ));
            }
        }
    };
    if token.is_empty() {
        anyhow::bail!("dev token at {DEV_TOKEN_FILE} is empty");
    }

    let build_id = tokio::fs::read_to_string(VERSION_FILE)
        .await
        .unwrap_or_else(|_| "unknown".into())
        .trim()
        .to_string();

    let state = AppState {
        token: Arc::new(token),
        build_id: Arc::new(build_id),
    };

    let cli = Cli::parse();
    let addr: SocketAddr = cli
        .listen
        .as_deref()
        .unwrap_or("127.0.0.1:8099")
        .parse()
        .context("invalid --listen address")?;

    let app = Router::new()
        .route("/dev/status", get(status))
        .route("/dev/service/:name/restart", post(service_restart))
        .route("/dev/service/:name/reload", post(service_reload))
        .route("/dev/compose/:svc/reload", post(compose_reload))
        .route("/dev/compose/:svc/logs", post(compose_logs))
        .route("/dev/replace-binary", post(replace_binary))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state.clone());

    tracing::info!("iora-dev-bridge listening on http://{addr}");

    // mDNS advertisement so the local `iora-dev-deploy` CLI can find this
    // device on the LAN.  We register the service `_iora-dev._tcp.local.`
    // with TXT records identifying the variant, build, hostname and port.
    // The advertiser is only ever started here — `iora-dev-bridge` itself
    // refuses to run on non-dev images, so no production OS will ever
    // appear in mDNS as a dev target.
    let _mdns = match start_mdns_advertiser(addr.port(), &state.build_id) {
        Ok(d) => Some(d),
        Err(e) => {
            tracing::warn!("mDNS advertiser disabled: {e:#}");
            None
        }
    };

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

fn start_mdns_advertiser(port: u16, build_id: &str) -> Result<mdns_sd::ServiceDaemon> {
    use mdns_sd::{ServiceDaemon, ServiceInfo};

    let daemon = ServiceDaemon::new().context("starting mdns daemon")?;
    let host = gethostname::gethostname()
        .to_string_lossy()
        .into_owned()
        .replace('.', "-");
    let host = if host.is_empty() { "iora-dev".to_string() } else { host };
    let instance = format!("iora-dev-{host}");
    let host_local = format!("{host}.local.");

    let mut props = std::collections::HashMap::new();
    props.insert("variant".to_string(), "dev".to_string());
    props.insert("build".to_string(), build_id.to_string());
    props.insert("hostname".to_string(), host.clone());
    props.insert("api".to_string(), "/dev".to_string());

    let info = ServiceInfo::new(
        "_iora-dev._tcp.local.",
        &instance,
        &host_local,
        "",            // empty addresses → auto-detect via interfaces
        port,
        Some(props),
    )
    .context("building mdns ServiceInfo")?
    .enable_addr_auto();

    daemon.register(info).context("registering mdns service")?;
    tracing::info!("mDNS: registered _iora-dev._tcp as {instance} on port {port}");
    Ok(daemon)
}

// ─── Auth ───────────────────────────────────────────────────────────────────

fn check_auth(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let got = headers
        .get("x-iora-dev-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if got.is_empty() || !ct_eq(got.as_bytes(), state.token.as_bytes()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            "missing or invalid X-IORA-Dev-Token".into(),
        ));
    }
    Ok(())
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut d = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        d |= x ^ y;
    }
    d == 0
}

// ─── Handlers ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct StatusResponse {
    dev_mode: bool,
    variant: &'static str,
    build: String,
    hostname: String,
    capabilities: Vec<&'static str>,
}

async fn status(State(s): State<AppState>) -> impl IntoResponse {
    Json(StatusResponse {
        dev_mode: true,
        variant: "dev",
        build: (*s.build_id).clone(),
        hostname: gethostname::gethostname().to_string_lossy().into_owned(),
        capabilities: vec![
            "service.restart",
            "service.reload",
            "compose.reload",
            "compose.logs",
            "binary.replace",
        ],
    })
}

async fn service_restart(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    if !is_allowed_unit(&name) {
        return (StatusCode::FORBIDDEN, "unit not allowlisted".to_string()).into_response();
    }
    run_cmd("systemctl", &["restart", &name]).await.into_response()
}

async fn service_reload(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    if !is_allowed_unit(&name) {
        return (StatusCode::FORBIDDEN, "unit not allowlisted".to_string()).into_response();
    }
    run_cmd("systemctl", &["try-reload-or-restart", &name])
        .await
        .into_response()
}

async fn compose_reload(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(svc): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    if !is_allowed_compose_svc(&svc) {
        return (StatusCode::FORBIDDEN, "service name not allowed".to_string())
            .into_response();
    }
    let args = [
        "compose",
        "up",
        "-d",
        "--force-recreate",
        "--no-deps",
        &svc,
    ];
    run_cmd_in("docker", &args, COMPOSE_DIR).await.into_response()
}

#[derive(Deserialize, Default)]
struct LogReq {
    #[serde(default)]
    tail: Option<u32>,
}

async fn compose_logs(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(svc): Path<String>,
    body: Option<Json<LogReq>>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    if !is_allowed_compose_svc(&svc) {
        return (StatusCode::FORBIDDEN, "service name not allowed".to_string())
            .into_response();
    }
    let tail = body
        .and_then(|b| b.tail)
        .unwrap_or(200)
        .min(5000)
        .to_string();
    let args = ["compose", "logs", "--no-color", "--tail", &tail, &svc];
    run_cmd_in("docker", &args, COMPOSE_DIR).await.into_response()
}

async fn replace_binary(
    State(s): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }

    let mut target: Option<String> = None;
    let mut unit: Option<String> = None;
    let mut expected_sha: Option<String> = None;
    let mut payload: Vec<u8> = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "target" => target = field.text().await.ok(),
            "unit"   => unit   = field.text().await.ok(),
            "sha256" => expected_sha = field.text().await.ok(),
            "file"   => payload = field.bytes().await.map(|b| b.to_vec()).unwrap_or_default(),
            _ => {}
        }
    }

    let target = match target {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "missing `target`".to_string()).into_response(),
    };
    if !is_allowed_binary_target(&target) {
        return (StatusCode::FORBIDDEN, "target path not allowlisted".to_string())
            .into_response();
    }
    if payload.is_empty() {
        return (StatusCode::BAD_REQUEST, "empty upload".to_string()).into_response();
    }

    let got_sha = hex::encode(Sha256::digest(&payload));
    if let Some(exp) = &expected_sha {
        if !ct_eq(got_sha.as_bytes(), exp.trim().as_bytes()) {
            return (
                StatusCode::BAD_REQUEST,
                format!("sha256 mismatch (got {got_sha})"),
            )
                .into_response();
        }
    }

    // Atomic swap: write <target>.new, fsync, rename, restart unit.
    let tmp = PathBuf::from(format!("{target}.new"));
    if let Some(parent) = tmp.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("mkdir: {e}"),
            )
                .into_response();
        }
    }
    match tokio::fs::File::create(&tmp).await {
        Ok(mut f) => {
            if let Err(e) = f.write_all(&payload).await {
                return (StatusCode::INTERNAL_SERVER_ERROR, format!("write: {e}"))
                    .into_response();
            }
            if let Err(e) = f.sync_all().await {
                return (StatusCode::INTERNAL_SERVER_ERROR, format!("fsync: {e}"))
                    .into_response();
            }
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("open: {e}"))
                .into_response();
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    }
    if let Err(e) = tokio::fs::rename(&tmp, &target).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("rename: {e}"),
        )
            .into_response();
    }

    let restart_result = if let Some(u) = unit {
        if is_allowed_unit(&u) {
            run_cmd("systemctl", &["restart", &u]).await
        } else {
            CmdResult {
                ok: false,
                code: -1,
                stdout: String::new(),
                stderr: "unit not allowlisted".into(),
            }
        }
    } else {
        CmdResult {
            ok: true,
            code: 0,
            stdout: "no unit restart requested".into(),
            stderr: String::new(),
        }
    };

    Json(serde_json::json!({
        "target": target,
        "sha256": got_sha,
        "bytes":  payload.len(),
        "restart": {
            "ok":     restart_result.ok,
            "code":   restart_result.code,
            "stdout": restart_result.stdout,
            "stderr": restart_result.stderr,
        }
    }))
    .into_response()
}

// ─── Allowlists ─────────────────────────────────────────────────────────────
//
// We only act on units / paths that belong to IORA so the dev bridge can't
// be turned into a general-purpose remote root shell.

fn is_allowed_unit(name: &str) -> bool {
    let n = name.trim();
    if n.contains(['/', '\\', '\0', ';', '|', '&', ' ', '\n']) {
        return false;
    }
    n == "iora-stack.service"
        || n == "docker.service"
        || n == "iora-dev-bridge.service"
        || n.starts_with("iora-")
}

fn is_allowed_compose_svc(svc: &str) -> bool {
    !svc.is_empty()
        && !svc.contains(['/', '\\', '\0', ';', '|', '&', ' ', '\n', '.'])
        && svc.len() < 64
}

fn is_allowed_binary_target(path: &str) -> bool {
    // Only binaries under /usr/bin or files under /mnt/data/iora/** may be
    // replaced via this endpoint.  Block path traversal.
    if path.contains("..") || !path.starts_with('/') {
        return false;
    }
    const PREFIXES: &[&str] = &[
        "/usr/bin/iora-",
        "/usr/local/bin/iora-",
        "/opt/iora/",
        "/mnt/data/iora/",
    ];
    PREFIXES.iter().any(|p| path.starts_with(p))
}

// ─── Command helpers ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct CmdResult {
    ok: bool,
    code: i32,
    stdout: String,
    stderr: String,
}

async fn run_cmd(bin: &str, args: &[&str]) -> CmdResult {
    run_cmd_inner(bin, args, None).await
}

async fn run_cmd_in(bin: &str, args: &[&str], cwd: &str) -> CmdResult {
    run_cmd_inner(bin, args, Some(cwd)).await
}

async fn run_cmd_inner(bin: &str, args: &[&str], cwd: Option<&str>) -> CmdResult {
    let mut c = Command::new(bin);
    c.args(args);
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    match c.output().await {
        Ok(o) => CmdResult {
            ok: o.status.success(),
            code: o.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        },
        Err(e) => CmdResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            stderr: format!("spawn failed: {e}"),
        },
    }
}

impl IntoResponse for CmdResult {
    fn into_response(self) -> axum::response::Response {
        let code = if self.ok {
            StatusCode::OK
        } else {
            StatusCode::BAD_GATEWAY
        };
        (code, Json(self)).into_response()
    }
}
