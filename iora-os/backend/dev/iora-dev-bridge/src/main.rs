// iora-dev-bridge — IORA OS Dev hot-reload bridge. ROOT ONLY. NO SECURITY.
//
// ⚠️  THIS BINARY MUST RUN AS ROOT ON DEV IMAGES ONLY.
// ⚠️  It can replace any binary, restart any service, access any file.
// ⚠️  By design: dev mode has zero security restrictions.
//
// This binary ONLY ships on images built with `IORA_OS_DEV=1`.
// On production builds: /usr/bin/iora-dev-bridge does NOT exist,
// the systemd unit is NOT installed, /etc/iora/os-dev-mode is ABSENT.
//
// Auth: IORA dashboard credentials (username/password → validated
// against iora-home /api/auth/login, admin role required). Falls back
// to static token file at /var/lib/iora/dev-token for legacy compat.
//
// Endpoints:
//   POST /dev/auth         — Login with {username,password}, get session token
//   GET  /dev/status        — Build info + capabilities (public)
//   GET  /dev/health        — Liveness probe (public)
//   POST /dev/service/{n}/restart  — systemctl restart (auth)
//   POST /dev/service/{n}/reload   — systemctl try-reload-or-restart (auth)
//   POST /dev/service/{n}/logs     — journalctl tail (auth)
//   GET  /dev/service/{n}/logs/stream — journalctl -f SSE (auth)
//   POST /dev/compose/{s}/reload   — docker compose up -d (auth)
//   POST /dev/compose/{s}/logs     — compose logs tail (auth)
//   POST /dev/fs/list       — Browse filesystem (auth)
//   POST /dev/fs/read       — Read file contents (auth)
//   POST /dev/replace-binary — Upload + replace binary + restart (auth)
//   POST /dev/build-replace  — Upload workspace + build + replace (auth)
//   GET  /dev/system/info   — System info (auth)
//   POST /dev/system/reboot — Reboot device (auth)
//   GET  /dev/system/journal — Journal tail (auth)

use anyhow::{Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::net::SocketAddr;
use std::path::{Path as FsPath, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::broadcast;
use uuid::Uuid;

mod config;
mod db;

const DEV_MODE_FILE: &str = "/etc/iora/os-dev-mode";
/// Persistent build workspace. We keep one directory per component so
/// cargo's `target/` cache survives across uploads — a `iora-watchdog`
/// rebuild after a one-line change drops from ~3 min (cold) to ~5 s
/// (incremental). Lives on the data partition so it survives RAUC slot
/// switches.
const PERSISTENT_BUILD_ROOT: &str = "/var/lib/iora-dev/builds";
/// Older releases used `/tmp/iora-dev-build-*` per request; clean those
/// up on startup so we don't fill /tmp on long-running dev images.
const LEGACY_BUILD_PREFIX: &str = "iora-dev-build-";
/// URL of the local iora-core (used by /dev/services to surface live
/// heartbeats from every IORA service in one place). Override via
/// `$IORA_CORE_URL`.
const DEFAULT_CORE_URL: &str = "http://127.0.0.1:8090";
const DEV_TOKEN_FILE: &str = "/etc/iora/dev-token";
/// Writable fallback (always on the persistent overlay, even on a
/// read-only RAUC slot). Preferred when present and readable; the
/// systemd unit pre-populates it via /usr/lib/iora/iora-dev-bridge-prepare.sh.
const DEV_TOKEN_FILE_WRITABLE: &str = "/var/lib/iora/dev-token";
const VERSION_FILE: &str = "/etc/iora-version";
const COMPOSE_DIR: &str = "/mnt/data/iora";
const REMOTE_BUILD_IMAGE: &str = "rust:1.90";

/// Resolve the path of the dev-token file, honoring `$IORA_DEV_TOKEN_FILE`
/// when set. Without override, prefers the writable copy under /var/lib.
fn resolve_dev_token_path() -> String {
    if let Ok(p) = std::env::var("IORA_DEV_TOKEN_FILE") {
        if !p.trim().is_empty() {
            return p;
        }
    }
    if std::path::Path::new(DEV_TOKEN_FILE_WRITABLE).exists() {
        return DEV_TOKEN_FILE_WRITABLE.to_string();
    }
    DEV_TOKEN_FILE.to_string()
}

#[derive(Parser, Debug)]
#[command(name = "iora-dev-bridge")]
struct Cli {
    /// Address to bind (default 0.0.0.0:8101 or $IORA_DEV_BIND).
    /// Note: 8099 is reserved for iora-api; the dev bridge uses 8101.
    #[arg(long, env = "IORA_DEV_BIND")]
    listen: Option<String>,
}

#[derive(Clone)]
pub(crate) struct AppState {
    token: Arc<String>,
    build_id: Arc<String>,
    core_url: Arc<String>,
    http: reqwest::Client,
    started_at: Arc<std::time::Instant>,
    sessions: Arc<RwLock<HashMap<String, DevSession>>>,
    event_tx: broadcast::Sender<DevBridgeEvent>,
}

#[derive(Clone, Serialize)]
struct DevSession {
    username: String,
    role: String,
    created: u64,
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
async fn try_regenerate_token(token_path: &str) -> Option<String> {
    use std::io::{Read as _, Write as _};
    // 32 random bytes from /dev/urandom — same source as post-build.sh.
    let mut buf = [0u8; 32];
    {
        let mut f = std::fs::File::open("/dev/urandom").ok()?;
        f.read_exact(&mut buf).ok()?;
    }
    let new_token: String = buf.iter().map(|b| format!("{b:02x}")).collect();

    // Try writing to the requested path first; on a read-only filesystem
    // (e.g. /etc on a RAUC slot) silently fall back to the writable path.
    let candidates: Vec<&str> = if token_path == DEV_TOKEN_FILE_WRITABLE {
        vec![DEV_TOKEN_FILE_WRITABLE]
    } else {
        vec![token_path, DEV_TOKEN_FILE_WRITABLE]
    };

    for cand in candidates {
        let path = std::path::Path::new(cand);
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
                tracing::warn!("could not regenerate dev token at {cand}: {e}");
                continue;
            }
        };
        if f.write_all(new_token.as_bytes()).is_err() {
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // 0644 on dev images: anyone on the device can already reach the
            // bridge through the loopback anyway, and 0600 caused EACCES
            // breakage when the unit ran as a non-root user.
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644));
        }
        tracing::info!("regenerated {cand} (mode 0644)");
        return Some(new_token);
    }
    None
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // ═══════════════════════════════════════════════════════════
    // ROOT CHECK: The bridge needs root for binary replacement,
    // systemd unit restarts, and docker access.
    // ═══════════════════════════════════════════════════════════
    #[cfg(unix)]
    {
        let uid = std::process::Command::new("id")
            .arg("-u")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(9999);
        if uid != 0 {
            tracing::error!(
                "iora-dev-bridge MUST run as root (current uid={uid}). \
                 Set User=root in the systemd unit."
            );
            anyhow::bail!("iora-dev-bridge requires root (uid=0), got uid={uid}");
        }
        tracing::info!("Running as root — full dev mode capabilities enabled.");
    }

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
    let token_path = resolve_dev_token_path();
    let token = match tokio::fs::read_to_string(&token_path).await {
        Ok(t) => t.trim().to_string(),
        Err(e) => {
            let path = std::path::Path::new(&token_path);
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
            // EACCES *or* ENOENT: regenerate so a broken-permissions or
            // missing-token image self-heals on next restart instead of
            // looping forever.
            if matches!(
                e.kind(),
                std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::NotFound
            ) {
                tracing::warn!(
                    "{token_path} unreadable ({:?}, mode={mode}, euid={euid}); regenerating.",
                    e.kind()
                );
                if let Some(t) = try_regenerate_token(&token_path).await {
                    t
                } else {
                    return Err(anyhow::anyhow!(
                        "reading dev token at {token_path}: {e} (exists={exists}, mode={mode}, euid={euid}). \
                         Fix with: chmod 0644 {token_path}"
                    ));
                }
            } else {
                return Err(anyhow::anyhow!(
                    "reading dev token at {token_path}: {e} (exists={exists}, mode={mode}, euid={euid})"
                ));
            }
        }
    };
    if token.is_empty() {
        anyhow::bail!("dev token at {token_path} is empty");
    }

    let build_id = tokio::fs::read_to_string(VERSION_FILE)
        .await
        .unwrap_or_else(|_| "unknown".into())
        .trim()
        .to_string();

    let core_url = std::env::var("IORA_CORE_URL").unwrap_or_else(|_| DEFAULT_CORE_URL.to_string());
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("iora-dev-bridge")
        .build()
        .context("building HTTP client")?;

    let (event_tx, _) = broadcast::channel::<DevBridgeEvent>(256);

    let state = AppState {
        token: Arc::new(token),
        build_id: Arc::new(build_id),
        core_url: Arc::new(core_url),
        http,
        started_at: Arc::new(std::time::Instant::now()),
        sessions: Arc::new(RwLock::new(HashMap::new())),
        event_tx: event_tx.clone(),
    };

    let cli = Cli::parse();
    let addr: SocketAddr = cli
        .listen
        .as_deref()
        .unwrap_or("0.0.0.0:8101")
        .parse()
        .context("invalid --listen address")?;

    let app = Router::new()
        // Unauthenticated liveness probe
        .route("/dev/health", get(dev_health))
        .route("/dev/status", get(status))
        // Auth via IORA dashboard credentials (username/password)
        .route("/dev/auth", post(dev_auth))
        // All other endpoints require auth (static token OR session Bearer)
        .route("/dev/services", get(dev_services))
        .route("/dev/service/:name/restart", post(service_restart))
        .route("/dev/service/:name/reload", post(service_reload))
        .route(
            "/dev/service/:name/logs",
            get(service_logs_get).post(service_logs),
        )
        .route("/dev/service/:name/logs/stream", get(service_logs_stream))
        .route("/dev/compose/:svc/reload", post(compose_reload))
        .route("/dev/compose/:svc/logs", post(compose_logs))
        .route("/dev/fs/list", post(fs_list))
        .route("/dev/fs/read", post(fs_read))
        .route("/dev/replace-binary", post(replace_binary))
        .route("/dev/build-replace", post(build_replace))
        .route("/dev/self-update", post(self_update))
        .route("/dev/events", get(events_sse))
        .route("/dev/system/info", get(system_info))
        .route("/dev/system/reboot", post(system_reboot))
        .route("/dev/system/journal", get(journal_recent))
        // Global Config (system_preferences in iora_home)
        .route("/dev/config", get(config::config_list))
        .route(
            "/dev/config/:key",
            get(config::config_get)
                .put(config::config_put)
                .delete(config::config_delete),
        )
        // Full PostgreSQL access (all IORA databases)
        .route("/dev/db/databases", get(db::list_databases))
        .route("/dev/db/:database/tables", get(db::list_tables))
        .route("/dev/db/:database/tables/:table", get(db::describe_table))
        .route("/dev/db/:database/query", post(db::run_query))
        .route("/dev/db/:database/exec", post(db::run_exec))
        .route("/dev/db/:database/explain", post(db::run_explain))
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

    // ── Heartbeat-Task: alle 5s ein Herzschlag-Event ───────
    let hb_tx = event_tx.clone();
    let hb_build = state.build_id.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            let uptime = std::time::Instant::now().elapsed().as_secs();
            let _ = hb_tx.send(DevBridgeEvent::Heartbeat {
                uptime_seconds: uptime,
                build: (*hb_build).clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                mem_available_bytes: read_mem_available(),
                loadavg: read_loadavg(),
            });
        }
    });

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
    let host = if host.is_empty() {
        "iora-dev".to_string()
    } else {
        host
    };
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
        "", // empty addresses → auto-detect via interfaces
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

pub(crate) fn check_auth(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
    // 1. Static dev token (legacy, still works)
    if let Some(tok) = headers
        .get("x-iora-dev-token")
        .and_then(|v| v.to_str().ok())
    {
        if ct_eq(tok.as_bytes(), state.token.as_bytes()) {
            return Ok(());
        }
    }

    // 2. Bearer token (session from POST /dev/auth via iora-home login)
    if let Some(auth) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        let sessions = state.sessions.read().unwrap();
        if sessions.contains_key(auth) {
            return Ok(());
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        "missing or invalid auth. Use POST /dev/auth with iora username/password".into(),
    ))
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
            "service.logs",
            "service.logs.stream",
            "services.list",
            "compose.reload",
            "compose.logs",
            "fs.list",
            "fs.read",
            "tooling.auto_provision",
            "binary.replace",
            "binary.build_replace",
            "binary.build_replace.incremental",
            "self.update",
            "self.update.ssh",
            "self.update.ftp",
            "self.update.http",
            "system.info",
            "system.reboot",
            "system.journal",
            "health.public",
            "config.global",
            "db.full",
        ],
    })
}

// ─── /dev/auth — IORA dashboard credentials → dev session token ──────

#[derive(Deserialize)]
struct AuthRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct AuthResponse {
    token: String,
    username: String,
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    auth_method: Option<String>,
    expires_in_secs: u64,
}

/// Try to reach iora-home on standard ports (3001 dev, 8126 production).
/// Returns the first successful response or the last error.
async fn try_iora_home_login(
    http: &reqwest::Client,
    username: &str,
    password: &str,
) -> Result<(String, serde_json::Value), String> {
    // Standard ports: 3001 (dev), 8126 (production IORA OS)
    const IORA_HOME_PORTS: &[u16] = &[3001, 8126];
    let mut last_err = String::new();

    for port in IORA_HOME_PORTS {
        let login_url = format!("http://127.0.0.1:{port}/api/auth/login");
        match http
            .post(&login_url)
            .json(&serde_json::json!({"username": username, "password": password}))
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<serde_json::Value>().await {
                    Ok(json) => {
                        if let Some(token) = json.get("token").and_then(|v| v.as_str()) {
                            return Ok((token.to_string(), json));
                        }
                        last_err = format!("port {port}: no token in response");
                    }
                    Err(e) => last_err = format!("port {port}: invalid JSON: {e}"),
                }
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                if status == 502 || status.as_u16() >= 500 {
                    // Server error on this port — likely wrong service, try next
                    last_err = format!("port {port}: HTTP {status} {body}");
                    continue;
                }
                // 4xx on this port means we found the right service but
                // credentials are wrong — no point trying other ports.
                return Err(format!("HTTP {status} from port {port}: {body}"));
            }
            Err(e) => {
                last_err = format!("port {port}: {e}");
                // Connection refused — try next port
                continue;
            }
        }
    }

    Err(format!(
        "Cannot reach iora-home on any port. Tried ports: {:?}. Last error: {}",
        IORA_HOME_PORTS, last_err
    ))
}

async fn try_iora_home_verify(
    http: &reqwest::Client,
    jwt: &str,
) -> Result<serde_json::Value, String> {
    const IORA_HOME_PORTS: &[u16] = &[3001, 8126];
    let mut last_err = String::new();

    for port in IORA_HOME_PORTS {
        let verify_url = format!("http://127.0.0.1:{port}/api/auth/verify");
        match http
            .get(&verify_url)
            .header("Authorization", format!("Bearer {jwt}"))
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<serde_json::Value>().await {
                    Ok(json) => return Ok(json),
                    Err(e) => last_err = format!("port {port}: invalid JSON: {e}"),
                }
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                if status == 502 || status.as_u16() >= 500 {
                    last_err = format!("port {port}: HTTP {status}");
                    continue;
                }
                return Err(format!("verify HTTP {status} from port {port}: {body}"));
            }
            Err(e) => {
                last_err = format!("port {port}: {e}");
                continue;
            }
        }
    }

    Err(format!(
        "Cannot verify token on any iora-home port. Tried: {:?}. Last error: {}",
        IORA_HOME_PORTS, last_err
    ))
}

/// Verify a password against the system's OS-level user accounts.
/// Uses `su` with a test command to validate credentials.
/// Only works when running as root (the Dev Bridge always runs as root).
/// This is a reliable fallback when iora-home is down.
async fn verify_os_password(username: &str, password: &str) -> bool {
    // Use `su` to test the password. `su` reads the password from stdin
    // and runs a simple test command. If the password is correct, the
    // command succeeds. If not, it fails.
    //
    // We use `su -c "echo ok" <user>` with password piped to stdin.
    // `-c` runs a command as the target user.
    //
    // Security: the password is sent via stdin pipe, never appears in
    // ps output or logs.

    let test_cmd = "echo authenticated".to_string();

    let result = tokio::process::Command::new("su")
        .args(["-c", &test_cmd, username])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    match result {
        Ok(mut child) => {
            // Write password to su's stdin
            if let Some(mut stdin) = child.stdin.take() {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(format!("{}\n", password).as_bytes()).await;
                let _ = stdin.flush().await;
                // Drop stdin so su can proceed
                drop(stdin);
            }

            // Wait for completion
            match child.wait().await {
                Ok(status) => status.success(),
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

async fn dev_auth(
    State(state): State<AppState>,
    Json(body): Json<AuthRequest>,
) -> impl IntoResponse {
    let mut username = body.username.clone();
    let mut role = "user".to_string();
    let mut auth_method = "none";

    // ── Method 1: Try iora-home auth (dashboard credentials) ─────────
    let iora_auth_ok = match try_iora_home_login(&state.http, &body.username, &body.password).await
    {
        Ok((jwt, _login_json)) => match try_iora_home_verify(&state.http, &jwt).await {
            Ok(user_info) => {
                let is_admin = user_info
                    .get("is_admin")
                    .and_then(|v| v.as_bool())
                    .unwrap_or_else(|| {
                        user_info.get("role").and_then(|v| v.as_str()) == Some("admin")
                    });
                role = if is_admin { "admin" } else { "user" }.to_string();
                is_admin
            }
            Err(_) => false,
        },
        Err(_) => false,
    };

    if iora_auth_ok {
        auth_method = "iora-home";
        tracing::info!(
            "dev-auth: user '{}' authenticated via iora-home (admin)",
            username
        );
    }

    // ── Method 2: Fall back to OS-level auth (emergency access) ──────
    // This works even when iora-home is down. OS root/admin users can
    // always access the Dev Bridge for emergency debugging.
    if !iora_auth_ok {
        // Check against /etc/shadow — OS root and sudo users
        if verify_os_password(&body.username, &body.password).await {
            username = body.username.clone();
            role = "admin".to_string();
            auth_method = "os-shadow";
            tracing::info!(
                "dev-auth: user '{}' authenticated via OS (/etc/shadow)",
                username
            );
        }
    }

    if auth_method == "none" {
        return (StatusCode::UNAUTHORIZED,
            "Authentication failed. Try your IORA dashboard credentials or your OS (root) password."
        ).into_response();
    }

    // Create session
    let session_token = Uuid::new_v4().to_string();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    state.sessions.write().unwrap().insert(
        session_token.clone(),
        DevSession {
            username: username.clone(),
            role: role.clone(),
            created: now,
        },
    );

    // GC old sessions
    state
        .sessions
        .write()
        .unwrap()
        .retain(|_, s| now - s.created < 86400);

    tracing::info!(
        "dev-auth: session created for '{}' (method: {}, role: {})",
        username,
        auth_method,
        role
    );

    (
        StatusCode::OK,
        Json(AuthResponse {
            token: session_token,
            username,
            role,
            auth_method: Some(auth_method.to_string()),
            expires_in_secs: 86400,
        }),
    )
        .into_response()
}

/// Public liveness endpoint. Returns immediately and never blocks.
async fn dev_health(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "service":  "iora-dev-bridge",
        "build":    *s.build_id,
        "uptime_seconds": s.started_at.elapsed().as_secs(),
        "core_url": *s.core_url,
        "timestamp": chrono_now(),
    }))
}

/// Events for the /dev/events SSE stream.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub(crate) enum DevBridgeEvent {
    Heartbeat {
        uptime_seconds: u64,
        build: String,
        timestamp: u64,
        mem_available_bytes: u64,
        loadavg: String,
    },
    #[allow(dead_code)]
    ServiceStatus {
        name: String,
        status: String,
        timestamp: u64,
    },
    LogMessage {
        service: String,
        message: String,
        timestamp: u64,
    },
}

/// SSE endpoint that streams DevBridgeEvent objects as JSON.
/// Clients can connect via EventSource and receive periodic heartbeats
/// every 5s, plus service status and other events as they happen.
/// Accepts `?token=` for auth (same as log streams) so browsers work.
/// Uses ReceiverStream (same pattern as log_stream_for_unit) to avoid
/// pulling in the async-stream dependency.
async fn events_sse(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LogStreamQuery>,
) -> impl IntoResponse {
    // Public endpoint — no auth required. This SSE stream provides
    // heartbeats and service status for the dashboard connection monitor.
    // It only broadcasts events that are already publicly visible
    // (heartbeat liveness + service status). No sensitive data.
    //
    // If a valid token is provided, the stream also includes auth-only
    // events (log streams, build progress).
    let is_authenticated = check_auth(&s, &headers).is_ok()
        || q.token
            .as_deref()
            .map(|t| {
                if ct_eq(t.as_bytes(), s.token.as_bytes()) {
                    return true;
                }
                s.sessions.read().unwrap().contains_key(t)
            })
            .unwrap_or(false);

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, std::convert::Infallible>>(64);
    let mut event_rx = s.event_tx.subscribe();

    tokio::spawn(async move {
        // Send initial connection event
        let _ = tx
            .send(Ok(Event::default()
                .event("connected")
                .data(r#"{"status":"ok"}"#)))
            .await;

        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    if matches!(event, DevBridgeEvent::LogMessage { .. }) && !is_authenticated {
                        continue;
                    }
                    let json = serde_json::to_string(&event).unwrap_or_default();
                    let event_name = match &event {
                        DevBridgeEvent::Heartbeat { .. } => "heartbeat",
                        DevBridgeEvent::ServiceStatus { .. } => "service_status",
                        DevBridgeEvent::LogMessage { .. } => "log_message",
                    };
                    if tx
                        .send(Ok(Event::default().event(event_name).data(json)))
                        .await
                        .is_err()
                    {
                        // Client disconnected
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("lagged")
                            .data(format!(r#"{{"dropped":{n}}}"#))))
                        .await;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    Sse::new(tokio_stream::wrappers::ReceiverStream::new(rx))
        .keep_alive(KeepAlive::default())
        .into_response()
}

fn read_mem_available() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("MemAvailable:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|x| x.parse::<u64>().ok())
                .map(|kb| kb * 1024)
        })
        .unwrap_or(0)
}

fn read_loadavg() -> String {
    std::fs::read_to_string("/proc/loadavg")
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Avoid pulling chrono into the bridge for one timestamp; this is
    // good enough for liveness logs and the VS Code UI.
    format!("@{}", secs)
}

/// Aggregated, live service map. Talks to the local iora-core's
/// `/api/core/services/status` endpoint (which is fed by every service
/// via the heartbeat protocol). Returns a normalized list the VS Code
/// extension can render directly.
async fn dev_services(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    let url = format!(
        "{}/api/core/services/status",
        s.core_url.trim_end_matches('/')
    );
    match s.http.get(&url).send().await {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(j) => Json(j).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": format!("core returned non-JSON: {e}") })),
            )
                .into_response(),
        },
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": format!("core http {code}"),
                    "body":  body.chars().take(500).collect::<String>(),
                })),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": format!("cannot reach iora-core at {}: {e}", *s.core_url),
            })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct LogStreamQuery {
    /// Bridge auth token can also be passed as `?token=` so a browser
    /// EventSource (which can't set custom headers) works out of the box.
    #[serde(default)]
    token: Option<String>,
    /// Optional initial backlog (lines from the journal before live tail).
    #[serde(default)]
    tail: Option<u32>,
}

/// Server-Sent Events stream of journalctl output for a unit. Replaces
/// the polling fallback the VS Code extension previously used; the IDE
/// just attaches an EventSource and keeps the connection open.
///
/// Auth: accepts (1) `x-iora-dev-token` header with static dev token,
/// (2) `authorization: Bearer` with session token from POST /dev/auth,
/// or (3) `?token=` query param matching **either** the static dev token
///   OR a valid session token (so browsers using EventSource work with
///   Bearer session tokens too).
async fn service_logs_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(q): Query<LogStreamQuery>,
) -> impl IntoResponse {
    // Accept either header-based or query-string auth (browsers can't
    // set custom headers on EventSource).
    let header_ok = check_auth(&s, &headers).is_ok();
    let query_ok = q
        .token
        .as_deref()
        .map(|t| {
            // Check static dev token first
            if ct_eq(t.as_bytes(), s.token.as_bytes()) {
                return true;
            }
            // Also check session tokens (Bearer tokens from POST /dev/auth)
            let sessions = s.sessions.read().unwrap();
            sessions.contains_key(t)
        })
        .unwrap_or(false);
    if !header_ok && !query_ok {
        return (
            StatusCode::UNAUTHORIZED,
            "missing or invalid token".to_string(),
        )
            .into_response();
    }
    if !is_allowed_unit(&name) {
        return (StatusCode::FORBIDDEN, "unit not allowlisted".to_string()).into_response();
    }

    let tail = q.tail.unwrap_or(50).min(2000).to_string();
    let stream = log_stream_for_unit(name, tail);
    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

fn log_stream_for_unit(
    name: String,
    tail: String,
) -> impl Stream<Item = Result<Event, std::convert::Infallible>> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;
    use tokio_stream::wrappers::ReceiverStream;

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, std::convert::Infallible>>(64);
    tokio::spawn(async move {
        let _ = tx
            .send(Ok(Event::default()
                .event("hello")
                .data(format!("streaming {name}"))))
            .await;
        let mut child = match Command::new("journalctl")
            .args([
                "-u",
                &name,
                "-n",
                &tail,
                "-f",
                "--no-pager",
                "-o",
                "short-iso",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = tx
                    .send(Ok(Event::default()
                        .event("error")
                        .data(format!("spawn journalctl: {e}"))))
                    .await;
                return;
            }
        };
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                let _ = tx
                    .send(Ok(Event::default().event("error").data("no stdout")))
                    .await;
                return;
            }
        };
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if tx.send(Ok(Event::default().data(line))).await.is_err() {
                        // Client disconnected — kill the journalctl follower.
                        let _ = child.kill().await;
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("error")
                            .data(format!("read: {e}"))))
                        .await;
                    break;
                }
            }
        }
        let _ = child.wait().await;
    });
    ReceiverStream::new(rx)
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
    run_cmd("systemctl", &["restart", &name])
        .await
        .into_response()
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
        return (
            StatusCode::FORBIDDEN,
            "service name not allowed".to_string(),
        )
            .into_response();
    }
    let args = ["compose", "up", "-d", "--force-recreate", "--no-deps", &svc];
    run_cmd_in("docker", &args, COMPOSE_DIR)
        .await
        .into_response()
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
        return (
            StatusCode::FORBIDDEN,
            "service name not allowed".to_string(),
        )
            .into_response();
    }
    let tail = body
        .and_then(|b| b.tail)
        .unwrap_or(200)
        .min(5000)
        .to_string();
    let args = ["compose", "logs", "--no-color", "--tail", &tail, &svc];
    run_cmd_in("docker", &args, COMPOSE_DIR)
        .await
        .into_response()
}

async fn service_logs(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    body: Option<Json<LogReq>>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    if !is_allowed_unit(&name) {
        return (StatusCode::FORBIDDEN, "unit not allowlisted".to_string()).into_response();
    }
    let tail = body
        .and_then(|b| b.tail)
        .unwrap_or(200)
        .min(5000)
        .to_string();
    let args = ["-u", &name, "-n", &tail, "--no-pager", "-o", "short-iso"];
    run_cmd("journalctl", &args).await.into_response()
}

#[derive(Deserialize)]
struct FsPathReq {
    path: String,
}

#[derive(Deserialize)]
struct FsReadReq {
    path: String,
    #[serde(default)]
    max_bytes: Option<usize>,
}

#[derive(Serialize)]
struct FsEntry {
    name: String,
    path: String,
    kind: &'static str,
    size: u64,
}

#[derive(Serialize)]
struct FsListResponse {
    path: String,
    entries: Vec<FsEntry>,
}

#[derive(Serialize)]
struct FsReadResponse {
    path: String,
    content: String,
    bytes: usize,
    total_bytes: usize,
    truncated: bool,
    binary_hint: bool,
}

async fn fs_list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<FsPathReq>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    if !is_allowed_system_path(&body.path) {
        return (StatusCode::FORBIDDEN, "path is not allowed".to_string()).into_response();
    }
    let dir_path = PathBuf::from(&body.path);
    let mut dir = match tokio::fs::read_dir(&dir_path).await {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("read_dir {}: {e}", dir_path.display()),
            )
                .into_response()
        }
    };
    let mut entries = Vec::new();
    loop {
        match dir.next_entry().await {
            Ok(Some(entry)) => {
                let path = entry.path();
                let meta = match entry.metadata().await {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let kind = if meta.is_dir() {
                    "dir"
                } else if meta.is_file() {
                    "file"
                } else if meta.file_type().is_symlink() {
                    "symlink"
                } else {
                    "other"
                };
                entries.push(FsEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: path.display().to_string(),
                    kind,
                    size: meta.len(),
                });
            }
            Ok(None) => break,
            Err(e) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    format!("iterating {}: {e}", dir_path.display()),
                )
                    .into_response()
            }
        }
    }
    entries.sort_by(|a, b| a.kind.cmp(b.kind).then_with(|| a.name.cmp(&b.name)));
    Json(FsListResponse {
        path: body.path,
        entries,
    })
    .into_response()
}

async fn fs_read(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<FsReadReq>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    if !is_allowed_system_path(&body.path) {
        return (StatusCode::FORBIDDEN, "path is not allowed".to_string()).into_response();
    }
    let max_bytes = body.max_bytes.unwrap_or(64 * 1024).clamp(1024, 512 * 1024);
    let path = PathBuf::from(&body.path);
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("read {}: {e}", path.display()),
            )
                .into_response()
        }
    };
    let total_bytes = bytes.len();
    let preview = &bytes[..bytes.len().min(max_bytes)];
    let binary_hint = preview.contains(&0);
    Json(FsReadResponse {
        path: body.path,
        content: String::from_utf8_lossy(preview).into_owned(),
        bytes: preview.len(),
        total_bytes,
        truncated: total_bytes > preview.len(),
        binary_hint,
    })
    .into_response()
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
            "unit" => unit = field.text().await.ok(),
            "sha256" => expected_sha = field.text().await.ok(),
            "file" => payload = field.bytes().await.map(|b| b.to_vec()).unwrap_or_default(),
            _ => {}
        }
    }

    let target = match target {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "missing `target`".to_string()).into_response(),
    };
    if !is_allowed_binary_target(&target) {
        return (
            StatusCode::FORBIDDEN,
            "target path not allowlisted".to_string(),
        )
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

    let restart_result = match install_binary_and_restart(&target, &payload, unit.as_deref()).await
    {
        Ok(r) => r,
        Err(resp) => return resp,
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

async fn build_replace(
    State(s): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }

    let mut target: Option<String> = None;
    let mut unit: Option<String> = None;
    let mut component: Option<String> = None;
    let mut bundle: Vec<u8> = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "target" => target = field.text().await.ok(),
            "unit" => unit = field.text().await.ok(),
            "component" => component = field.text().await.ok(),
            "bundle" => bundle = field.bytes().await.map(|b| b.to_vec()).unwrap_or_default(),
            _ => {}
        }
    }

    let target = match target {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "missing `target`".to_string()).into_response(),
    };
    let component = match component {
        Some(c) => c,
        None => {
            return (StatusCode::BAD_REQUEST, "missing `component`".to_string()).into_response()
        }
    };
    if !is_allowed_binary_target(&target) {
        return (
            StatusCode::FORBIDDEN,
            "target path not allowlisted".to_string(),
        )
            .into_response();
    }
    if !is_allowed_component_name(&component) {
        return (
            StatusCode::FORBIDDEN,
            "component name not allowlisted".to_string(),
        )
            .into_response();
    }
    if bundle.is_empty() {
        return (StatusCode::BAD_REQUEST, "empty bundle".to_string()).into_response();
    }
    let log_service = component.clone();
    emit_bridge_log(
        &s.event_tx,
        &log_service,
        format!("bundle received: {} bytes", bundle.len()),
    );

    // Persistent per-component workspace. The first upload extracts the
    // full bundle; subsequent uploads overwrite source files in place,
    // letting cargo do an incremental rebuild. Order of magnitude faster
    // for hot-reload (5–10 s vs 2–3 min on a Pi).
    let work_root = std::path::PathBuf::from(PERSISTENT_BUILD_ROOT).join(&component);
    let bundle_path = work_root.join("backend.tar.gz");
    let backend_root = work_root.join("backend");
    let started = std::time::Instant::now();

    if let Err(e) = tokio::fs::create_dir_all(&work_root).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("mkdir work root {}: {e}", work_root.display()),
        )
            .into_response();
    }
    cleanup_legacy_build_dirs().await;

    if let Err(e) = tokio::fs::write(&bundle_path, &bundle).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("write bundle: {e}"),
        )
            .into_response();
    }

    emit_bridge_log(
        &s.event_tx,
        &log_service,
        format!("extracting backend bundle into {}", work_root.display()),
    );
    let extract = extract_backend_bundle(bundle_path.clone(), work_root.clone()).await;
    if !extract.ok {
        emit_bridge_log(
            &s.event_tx,
            &log_service,
            format!("extract failed: {}", extract.stderr.trim()),
        );
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": "extract failed", "extract": extract })),
        )
            .into_response();
    }
    emit_bridge_log(&s.event_tx, &log_service, extract.stdout.trim().to_string());

    emit_bridge_log(
        &s.event_tx,
        &log_service,
        "checking build tooling".to_string(),
    );
    let bootstrap = ensure_build_tooling(&s.event_tx, &log_service).await;
    if !bootstrap.ok {
        emit_bridge_log(
            &s.event_tx,
            &log_service,
            format!("tooling bootstrap failed: {}", bootstrap.stderr.trim()),
        );
        return (
            StatusCode::BAD_GATEWAY,
            Json(
                serde_json::json!({ "error": "tooling bootstrap failed", "bootstrap": bootstrap }),
            ),
        )
            .into_response();
    }

    let cargo_target_cache = work_root.join("cargo-target");
    let cargo_home_cache = work_root.join("cargo-home");
    let _ = tokio::fs::create_dir_all(&cargo_target_cache).await;
    let _ = tokio::fs::create_dir_all(&cargo_home_cache).await;

    // Native IORA OS dev images build on-device. Docker is intentionally not
    // used unless explicitly enabled via IORA_DEV_ALLOW_DOCKER_BUILD=1.
    // CARGO_TARGET_DIR + CARGO_HOME live inside `work_root` so the cache
    // survives but never leaks across components.
    let build = if command_exists("cargo") {
        emit_bridge_log(
            &s.event_tx,
            &log_service,
            format!("running cargo build --release -p {component}"),
        );
        run_cmd_with_env_and_logs(
            "cargo",
            vec![
                "build".into(),
                "--release".into(),
                "-p".into(),
                component.clone(),
            ],
            Some(&backend_root),
            &[
                ("CARGO_TARGET_DIR", cargo_target_cache.display().to_string()),
                ("CARGO_HOME", cargo_home_cache.display().to_string()),
                ("CARGO_INCREMENTAL", "1".to_string()),
                ("CC", "cc".to_string()),
                ("CXX", "c++".to_string()),
                (
                    "PKG_CONFIG_PATH",
                    "/usr/lib/pkgconfig:/usr/share/pkgconfig:/usr/local/lib/pkgconfig".to_string(),
                ),
            ],
            &s.event_tx,
            &log_service,
        )
        .await
    } else if allow_docker_build_fallback() && command_exists("docker") {
        emit_bridge_log(
            &s.event_tx,
            &log_service,
            format!("running docker build container for {component}"),
        );
        run_cmd_owned_with_logs(
            "docker",
            vec![
                "run".into(),
                "--rm".into(),
                "-v".into(),
                format!("{}:/app/backend", backend_root.display()),
                "-v".into(),
                format!("{}:/app/cargo-target", cargo_target_cache.display()),
                "-v".into(),
                format!("{}:/usr/local/cargo",  cargo_home_cache.display()),
                "-e".into(), "CARGO_TARGET_DIR=/app/cargo-target".into(),
                "-e".into(), "CARGO_INCREMENTAL=1".into(),
                "-w".into(),
                "/app/backend".into(),
                REMOTE_BUILD_IMAGE.into(),
                "sh".into(),
                "-lc".into(),
                format!(
                    "apt-get update >/dev/null 2>&1 && apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev libpq-dev perl cmake git curl ca-certificates >/dev/null 2>&1 && cargo build --release -p {}",
                    component
                ),
            ],
            None,
            &s.event_tx,
            &log_service,
        ).await
    } else {
        emit_bridge_log(
            &s.event_tx,
            &log_service,
            "native cargo is not available on this IORA OS Dev image".to_string(),
        );
        CmdResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            stderr: "native cargo/rustc missing on device; rebuild the IORA OS Dev image with IORA_OS_DEV=1 so BR2_PACKAGE_IORA_DEV_TOOLCHAIN is included".into(),
        }
    };

    let elapsed_ms = started.elapsed().as_millis() as u64;

    if !build.ok {
        emit_bridge_log(
            &s.event_tx,
            &log_service,
            format!("build failed with exit code {}", build.code),
        );
        // Keep the workspace around on failure so the next attempt
        // benefits from the partial cache and so the developer can
        // ssh in and inspect what went wrong.
        return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({
            "error": "build failed",
            "build": build,
            "workspace": work_root.display().to_string(),
            "elapsed_ms": elapsed_ms,
            "hint": "the persistent workspace at the path above can be inspected on the device; subsequent uploads will incrementally rebuild from it",
        }))).into_response();
    }

    let built_path = cargo_target_cache.join("release").join(&component);
    let payload = match tokio::fs::read(&built_path).await {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("read built binary {}: {e}", built_path.display()),
            )
                .into_response();
        }
    };
    let got_sha = hex::encode(Sha256::digest(&payload));
    let restart_result = match install_binary_and_restart(&target, &payload, unit.as_deref()).await
    {
        Ok(r) => r,
        Err(resp) => {
            return resp;
        }
    };
    emit_bridge_log(
        &s.event_tx,
        &log_service,
        format!("installed {} bytes to {}", payload.len(), target),
    );
    // Drop only the bundle, keep target/ for the next incremental build.
    let _ = tokio::fs::remove_file(&bundle_path).await;

    Json(serde_json::json!({
        "component": component,
        "target": target,
        "sha256": got_sha,
        "bytes": payload.len(),
        "workspace":  work_root.display().to_string(),
        "elapsed_ms": elapsed_ms,
        "incremental": true,
        "build": {
            "ok": build.ok,
            "code": build.code,
            "stdout": build.stdout,
            "stderr": build.stderr,
        },
        "restart": {
            "ok": restart_result.ok,
            "code": restart_result.code,
            "stdout": restart_result.stdout,
            "stderr": restart_result.stderr,
        }
    }))
    .into_response()
}

async fn cleanup_legacy_build_dirs() {
    // Best-effort sweep of the old per-request /tmp dirs from previous
    // bridge versions. Bounded to avoid blocking the request thread on
    // a huge /tmp.
    let mut dir = match tokio::fs::read_dir(std::env::temp_dir()).await {
        Ok(d) => d,
        Err(_) => return,
    };
    let mut removed = 0u32;
    while removed < 20 {
        let entry = match dir.next_entry().await {
            Ok(Some(e)) => e,
            _ => break,
        };
        let name = entry.file_name();
        let s = name.to_string_lossy();
        if s.starts_with(LEGACY_BUILD_PREFIX) {
            let _ = tokio::fs::remove_dir_all(entry.path()).await;
            removed = removed.saturating_add(1);
        }
    }
}

// ─── System info / reboot ──────────────────────────────────────────────────
//
// All three handlers are dev-image only — the bridge binary itself is
// only present on os-dev images, so this is not an additional attack
// surface on production. The IDE uses these to render a system pane
// (cpu/mem/disk) and to offer a one-click reboot when a kernel module
// or boot-time service was just hot-swapped.

async fn system_info(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    let cpu_count = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .map(|s| s.lines().filter(|l| l.starts_with("processor")).count())
        .unwrap_or(0);
    let loadavg = std::fs::read_to_string("/proc/loadavg").unwrap_or_default();
    let uptime = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    let uptime_secs = uptime
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0) as u64;

    // Memory from /proc/meminfo (kB).
    let mut mem_total_kb = 0u64;
    let mut mem_avail_kb = 0u64;
    if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
        for line in meminfo.lines() {
            if let Some(rest) = line.strip_prefix("MemTotal:") {
                mem_total_kb = rest
                    .split_whitespace()
                    .next()
                    .and_then(|x| x.parse().ok())
                    .unwrap_or(0);
            } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
                mem_avail_kb = rest
                    .split_whitespace()
                    .next()
                    .and_then(|x| x.parse().ok())
                    .unwrap_or(0);
            }
        }
    }

    // Disk usage of /. statvfs would be cleaner but pulling another dep
    // for this one number isn't worth it; `df -P /` is on every image.
    let df = run_cmd("df", &["-P", "-B1", "/"]).await;
    let (disk_total, disk_used, disk_free) = parse_df(&df.stdout);

    Json(serde_json::json!({
        "hostname": gethostname::gethostname().to_string_lossy(),
        "build":    *s.build_id,
        "uptime_seconds": uptime_secs,
        "loadavg":  loadavg.trim(),
        "cpu_count": cpu_count,
        "mem_total_bytes": mem_total_kb * 1024,
        "mem_available_bytes": mem_avail_kb * 1024,
        "disk_total_bytes": disk_total,
        "disk_used_bytes":  disk_used,
        "disk_free_bytes":  disk_free,
    }))
    .into_response()
}

fn parse_df(stdout: &str) -> (u64, u64, u64) {
    // df -P -B1 emits a header followed by exactly one data row for `/`.
    for line in stdout.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() >= 4 {
            let total = cols[1].parse::<u64>().unwrap_or(0);
            let used = cols[2].parse::<u64>().unwrap_or(0);
            let free = cols[3].parse::<u64>().unwrap_or(0);
            return (total, used, free);
        }
    }
    (0, 0, 0)
}

async fn system_reboot(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    // Schedule the reboot on a fresh task so we can respond first; the
    // 1s delay gives the response a chance to flush over the LAN.
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let _ = Command::new("systemctl").arg("reboot").status().await;
    });
    Json(serde_json::json!({ "ok": true, "scheduled_in_secs": 1 })).into_response()
}

#[derive(Deserialize, Default)]
struct JournalQuery {
    #[serde(default)]
    tail: Option<u32>,
    #[serde(default)]
    priority: Option<String>,
}

async fn journal_recent(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<JournalQuery>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }
    let tail = q.tail.unwrap_or(500).min(5000).to_string();
    let prio = q.priority.as_deref().unwrap_or("warning");
    if !prio.chars().all(|c| c.is_ascii_alphanumeric()) {
        return (StatusCode::BAD_REQUEST, "invalid priority").into_response();
    }
    let r = run_cmd(
        "journalctl",
        &["-n", &tail, "-p", prio, "--no-pager", "-o", "short-iso"],
    )
    .await;
    r.into_response()
}

/// GET handler for service logs — query-based alternative to POST.
/// Accepts `?tail=N` to specify number of lines and `?token=` for auth.
#[derive(Deserialize)]
struct LogsGetQuery {
    #[serde(default)]
    tail: Option<u32>,
    #[serde(default)]
    token: Option<String>,
}

async fn service_logs_get(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(q): Query<LogsGetQuery>,
) -> impl IntoResponse {
    let header_ok = check_auth(&s, &headers).is_ok();
    let query_ok = q
        .token
        .as_deref()
        .map(|t| {
            if ct_eq(t.as_bytes(), s.token.as_bytes()) {
                return true;
            }
            let sessions = s.sessions.read().unwrap();
            sessions.contains_key(t)
        })
        .unwrap_or(false);
    if !header_ok && !query_ok {
        return (
            StatusCode::UNAUTHORIZED,
            "missing or invalid token".to_string(),
        )
            .into_response();
    }
    if !is_allowed_unit(&name) {
        return (StatusCode::FORBIDDEN, "unit not allowlisted".to_string()).into_response();
    }
    let tail = q.tail.unwrap_or(200).min(5000).to_string();
    let args = ["-u", &name, "-n", &tail, "--no-pager", "-o", "short-iso"];
    run_cmd("journalctl", &args).await.into_response()
}

// ─── Allowlists ─────────────────────────────────────────────────────────────
//
// We only act on units / paths that belong to IORA so the dev bridge can't
// be turned into a general-purpose remote root shell.

fn is_allowed_unit(name: &str) -> bool {
    // Dev images: any well-formed systemd unit is fair game (the bridge
    // runs as root and is only present on os-dev images by design).
    let n = name.trim();
    if n.is_empty() || n.len() > 256 {
        return false;
    }
    // Block obvious shell-injection / path traversal characters; legit
    // unit names never contain these.
    !n.contains([
        '/', '\\', '\0', ';', '|', '&', ' ', '\n', '\r', '\t', '`', '$',
    ])
}

fn is_allowed_compose_svc(svc: &str) -> bool {
    !svc.is_empty()
        && !svc.contains(['/', '\\', '\0', ';', '|', '&', ' ', '\n', '.'])
        && svc.len() < 64
}

fn is_allowed_component_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains([
            '/', '\\', '\0', ';', '|', '&', ' ', '\n', '\r', '\t', '`', '$',
        ])
        && name.len() < 128
}

fn is_allowed_system_path(path: &str) -> bool {
    path.starts_with('/') && !path.contains('\0') && !path.contains("..")
}

fn is_allowed_binary_target(path: &str) -> bool {
    // Dev images grant the bridge full root access on purpose: the IDE on
    // the developer workstation must be able to swap *any* file (kernel
    // modules, /etc configs, app payloads, container volumes, …). The
    // only restriction is no path traversal and no relative paths so a
    // crafted multipart can't be ambiguous.
    if path.contains("..") || !path.starts_with('/') {
        return false;
    }
    // Refuse to write into kernel/proc/sys pseudo-filesystems — the swap
    // semantics (write to .new + rename) don't apply there and would
    // either silently fail or panic the kernel.
    const FORBIDDEN: &[&str] = &["/proc/", "/sys/", "/dev/"];
    if FORBIDDEN
        .iter()
        .any(|p| path.starts_with(p) || path == p.trim_end_matches('/'))
    {
        return false;
    }
    true
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

async fn run_cmd_owned(bin: &str, args: Vec<String>, cwd: Option<&std::path::Path>) -> CmdResult {
    let mut c = Command::new(bin);
    c.args(&args);
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

async fn run_cmd_with_env_and_logs(
    bin: &str,
    args: Vec<String>,
    cwd: Option<&std::path::Path>,
    envs: &[(&str, String)],
    event_tx: &broadcast::Sender<DevBridgeEvent>,
    service: &str,
) -> CmdResult {
    run_cmd_streaming(bin, args, cwd, envs, event_tx, service).await
}

async fn run_cmd_owned_with_logs(
    bin: &str,
    args: Vec<String>,
    cwd: Option<&std::path::Path>,
    event_tx: &broadcast::Sender<DevBridgeEvent>,
    service: &str,
) -> CmdResult {
    run_cmd_streaming(bin, args, cwd, &[], event_tx, service).await
}

async fn run_cmd_streaming(
    bin: &str,
    args: Vec<String>,
    cwd: Option<&std::path::Path>,
    envs: &[(&str, String)],
    event_tx: &broadcast::Sender<DevBridgeEvent>,
    service: &str,
) -> CmdResult {
    let mut c = Command::new(bin);
    c.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    for (key, value) in envs {
        c.env(key, value);
    }

    let mut child = match c.spawn() {
        Ok(child) => child,
        Err(e) => {
            let msg = format!("spawn failed: {e}");
            emit_bridge_log(event_tx, service, msg.clone());
            return CmdResult {
                ok: false,
                code: -1,
                stdout: String::new(),
                stderr: msg,
            };
        }
    };

    let stdout_task = child
        .stdout
        .take()
        .map(|stdout| spawn_output_reader(stdout, event_tx.clone(), service.to_string()));
    let stderr_task = child
        .stderr
        .take()
        .map(|stderr| spawn_output_reader(stderr, event_tx.clone(), service.to_string()));

    let status = match child.wait().await {
        Ok(status) => status,
        Err(e) => {
            let msg = format!("wait failed: {e}");
            emit_bridge_log(event_tx, service, msg.clone());
            return CmdResult {
                ok: false,
                code: -1,
                stdout: String::new(),
                stderr: msg,
            };
        }
    };

    let stdout = match stdout_task {
        Some(task) => task.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr_task {
        Some(task) => task.await.unwrap_or_default(),
        None => String::new(),
    };

    CmdResult {
        ok: status.success(),
        code: status.code().unwrap_or(-1),
        stdout,
        stderr,
    }
}

fn spawn_output_reader<R>(
    stream: R,
    event_tx: broadcast::Sender<DevBridgeEvent>,
    service: String,
) -> tokio::task::JoinHandle<String>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(stream).lines();
        let mut output = String::new();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    output.push_str(&line);
                    output.push('\n');
                    if !line.trim().is_empty() {
                        emit_bridge_log(&event_tx, &service, line);
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let msg = format!("read process output failed: {e}");
                    output.push_str(&msg);
                    output.push('\n');
                    emit_bridge_log(&event_tx, &service, msg);
                    break;
                }
            }
        }
        output
    })
}

fn emit_bridge_log(event_tx: &broadcast::Sender<DevBridgeEvent>, service: &str, message: String) {
    if message.trim().is_empty() {
        return;
    }
    let _ = event_tx.send(DevBridgeEvent::LogMessage {
        service: service.to_string(),
        message,
        timestamp: unix_timestamp(),
    });
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

async fn extract_backend_bundle(bundle_path: PathBuf, work_root: PathBuf) -> CmdResult {
    match tokio::task::spawn_blocking(move || extract_backend_bundle_sync(&bundle_path, &work_root))
        .await
    {
        Ok(Ok(format)) => CmdResult {
            ok: true,
            code: 0,
            stdout: format!("extracted {format} bundle"),
            stderr: String::new(),
        },
        Ok(Err(e)) => CmdResult {
            ok: false,
            code: 1,
            stdout: String::new(),
            stderr: e,
        },
        Err(e) => CmdResult {
            ok: false,
            code: 1,
            stdout: String::new(),
            stderr: format!("extract task failed: {e}"),
        },
    }
}

fn extract_backend_bundle_sync(
    bundle_path: &FsPath,
    work_root: &FsPath,
) -> std::result::Result<&'static str, String> {
    use iora_shared_upload::{extract_tar_gz_into, TarExtractLimits};

    let mut file = std::fs::File::open(bundle_path)
        .map_err(|e| format!("open bundle {}: {e}", bundle_path.display()))?;
    let mut magic = [0u8; 2];
    let read = file
        .read(&mut magic)
        .map_err(|e| format!("read bundle header {}: {e}", bundle_path.display()))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("rewind bundle {}: {e}", bundle_path.display()))?;

    // Generous but bounded limits for dev build bundles: 8 GiB total,
    // 2 GiB per entry, 500k entries.
    let limits = TarExtractLimits {
        max_total_uncompressed: 8 * 1024 * 1024 * 1024,
        max_per_file: 2 * 1024 * 1024 * 1024,
        max_entries: 500_000,
        max_path_components: 96,
        allow_symlinks: false,
    };

    if read == 2 && magic == [0x1f, 0x8b] {
        extract_tar_gz_into(work_root, file, &limits)
            .map_err(|e| format!("unpack gzip tar into {}: {e}", work_root.display()))?;
        Ok("tar.gz")
    } else {
        // Plain (uncompressed) tar: wrap in a zero-overhead gzip-less path by
        // funnelling through a `tar::Archive` with the same per-entry guards.
        // We reuse the gzip helper by skipping the decoder via an in-memory
        // detection: bundles produced by the dev bridge are always gzip in
        // practice, so for the plain branch we keep a thin local impl that
        // still applies the path-traversal guard.
        let mut archive = tar::Archive::new(file);
        archive.set_overwrite(true);
        archive.set_preserve_permissions(false);
        archive.set_unpack_xattrs(false);
        std::fs::create_dir_all(work_root)
            .map_err(|e| format!("create work_root {}: {e}", work_root.display()))?;
        let canonical_root = std::fs::canonicalize(work_root)
            .map_err(|e| format!("canonicalize {}: {e}", work_root.display()))?;
        for entry_res in archive
            .entries()
            .map_err(|e| format!("read tar entries: {e}"))?
        {
            let mut entry = entry_res.map_err(|e| format!("tar entry: {e}"))?;
            let kind = entry.header().entry_type();
            if kind.is_symlink() || kind.is_hard_link() {
                return Err("tar entry contains symlink/hardlink (not allowed)".to_string());
            }
            let raw = entry
                .path()
                .map_err(|e| format!("tar path: {e}"))?
                .into_owned();
            let raw_str = raw.to_string_lossy().to_string();
            // Reuse the same path sanitiser by delegating through the helper.
            // We do a minimal check inline: reject .. / absolute / colon.
            if raw.is_absolute()
                || raw_str.contains("..")
                || raw_str.contains(':')
                || raw_str.contains('\0')
            {
                return Err(format!("unsafe tar path: {raw_str}"));
            }
            let out_path = work_root.join(&raw);
            if !out_path.starts_with(work_root) {
                return Err(format!("tar path escapes target: {raw_str}"));
            }
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            entry
                .unpack(&out_path)
                .map_err(|e| format!("unpack tar entry {raw_str}: {e}"))?;
            if let Ok(real) = std::fs::canonicalize(&out_path) {
                if !real.starts_with(&canonical_root) {
                    let _ = std::fs::remove_file(&out_path);
                    return Err(format!("tar entry resolved outside target: {raw_str}"));
                }
            }
        }
        Ok("tar")
    }
}

async fn run_shell_with_logs(
    script: String,
    event_tx: &broadcast::Sender<DevBridgeEvent>,
    service: &str,
) -> CmdResult {
    run_cmd_owned_with_logs("sh", vec!["-lc".into(), script], None, event_tx, service).await
}

async fn ensure_build_tooling(
    event_tx: &broadcast::Sender<DevBridgeEvent>,
    service: &str,
) -> CmdResult {
    let local = ensure_tooling_locally(event_tx, service).await;
    if local.ok {
        return local;
    }
    if allow_docker_build_fallback() && command_exists("docker") {
        emit_bridge_log(
            event_tx,
            service,
            format!(
                "native build tooling incomplete: {}; docker fallback explicitly enabled",
                local.stderr.trim()
            ),
        );
        return ensure_tooling_with_docker(event_tx, service).await;
    }
    emit_bridge_log(
        event_tx,
        service,
        format!("native build tooling incomplete: {}", local.stderr.trim()),
    );
    local
}

async fn ensure_tooling_with_docker(
    event_tx: &broadcast::Sender<DevBridgeEvent>,
    service: &str,
) -> CmdResult {
    let images = [REMOTE_BUILD_IMAGE];
    let mut stdout = String::new();
    for image in images {
        let inspect = run_cmd_owned(
            "docker",
            vec!["image".into(), "inspect".into(), image.into()],
            None,
        )
        .await;
        if inspect.ok {
            stdout.push_str(&format!("tool image ready: {image}\n"));
            continue;
        }
        emit_bridge_log(event_tx, service, format!("pulling build image {image}"));
        let mut pull = run_cmd_owned_with_logs(
            "docker",
            vec!["pull".into(), image.into()],
            None,
            event_tx,
            service,
        )
        .await;
        if !pull.ok && format!("{}{}", pull.stdout, pull.stderr).contains("no space left on device")
        {
            emit_bridge_log(
                event_tx,
                service,
                "docker ran out of space; pruning unused docker data and retrying pull".to_string(),
            );
            let _ = run_cmd_owned_with_logs(
                "docker",
                vec!["system".into(), "prune".into(), "-af".into()],
                None,
                event_tx,
                service,
            )
            .await;
            pull = run_cmd_owned_with_logs(
                "docker",
                vec!["pull".into(), image.into()],
                None,
                event_tx,
                service,
            )
            .await;
        }
        if !pull.ok {
            return CmdResult {
                ok: false,
                code: pull.code,
                stdout: format!("{stdout}{}", pull.stdout),
                stderr: format!("failed to prepare {image}\n{}", pull.stderr),
            };
        }
        stdout.push_str(&format!("tool image pulled: {image}\n"));
    }
    CmdResult {
        ok: true,
        code: 0,
        stdout,
        stderr: String::new(),
    }
}

async fn ensure_tooling_locally(
    event_tx: &broadcast::Sender<DevBridgeEvent>,
    service: &str,
) -> CmdResult {
    let mut missing_packages: Vec<&str> = Vec::new();
    if !command_exists("cc") && !command_exists("gcc") && !command_exists("clang") {
        missing_packages.push("build-essential");
    }
    if !command_exists("pkg-config") && !command_exists("pkgconf") {
        missing_packages.push("pkg-config");
    }
    if !command_exists("git") {
        missing_packages.push("git");
    }
    if !command_exists("curl") {
        missing_packages.push("curl");
    }
    if !command_exists("cargo") || !command_exists("rustc") {
        missing_packages.push("cargo");
        missing_packages.push("rustc");
    }

    if missing_packages.is_empty() {
        return CmdResult {
            ok: true,
            code: 0,
            stdout: "local build tooling already installed\n".into(),
            stderr: String::new(),
        };
    }
    if !command_exists("apt-get") {
        return CmdResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            stderr: format!(
                "apt-get is missing; cannot auto-install required tooling on Buildroot IORA OS. Missing: {}. Rebuild the Dev image with IORA_OS_DEV=1 / BR2_PACKAGE_IORA_DEV_TOOLCHAIN=y",
                missing_packages.join(", ")
            ),
        };
    }

    let install_script = format!(
        "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y --no-install-recommends {}",
        missing_packages.join(" ")
    );
    emit_bridge_log(
        event_tx,
        service,
        format!(
            "installing local build packages: {}",
            missing_packages.join(", ")
        ),
    );
    run_shell_with_logs(install_script, event_tx, service).await
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

fn command_exists(bin: &str) -> bool {
    std::process::Command::new(bin)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn allow_docker_build_fallback() -> bool {
    std::env::var("IORA_DEV_ALLOW_DOCKER_BUILD").ok().as_deref() == Some("1")
}

/// ─── Self-Update ─────────────────────────────────────────────────────────
//
// POST /dev/self-update – Ersetzt das iora-dev-bridge Binary und startet
// den Dienst neu. Unterstützt folgende Quellen:
//   - HTTP/HTTPS-URL  ({"source": "http", "url": "https://..."})
//   - SCP/SSH-Pull    ({"source": "ssh", "host": "...", "path": "...",
//                      "user": "root", "key_path": "/root/.ssh/...",
//                      "port": 22})
//   - FTP             ({"source": "ftp", "url": "ftp://...",
//                      "user": "...", "password": "..."})

#[derive(Deserialize)]
struct SelfUpdateRequest {
    source: String, // "http" | "ssh" | "ftp"
    /// URL for http/ftp sources
    #[serde(default)]
    url: Option<String>,
    /// SSH host (for ssh source)
    #[serde(default)]
    host: Option<String>,
    /// Remote path (for ssh source)
    #[serde(default)]
    path: Option<String>,
    /// SSH user (default: root)
    #[serde(default = "default_ssh_user")]
    user: String,
    /// SSH port (default: 22)
    #[serde(default = "default_ssh_port")]
    port: u16,
    /// Path to SSH private key (default: /root/.ssh/id_rsa)
    #[serde(default = "default_ssh_key")]
    key_path: String,
    /// Password for FTP
    #[serde(default)]
    password: Option<String>,
    /// SHA-256 hash to verify the downloaded binary (optional)
    #[serde(default)]
    expected_sha: Option<String>,
    /// Skip TLS verification for https
    #[serde(default)]
    insecure: bool,
}

fn default_ssh_user() -> String {
    "root".to_string()
}
fn default_ssh_port() -> u16 {
    22
}
fn default_ssh_key() -> String {
    "/root/.ssh/id_rsa".to_string()
}

async fn self_update(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SelfUpdateRequest>,
) -> impl IntoResponse {
    if let Err(e) = check_auth(&s, &headers) {
        return e.into_response();
    }

    let self_path = "/usr/bin/iora-dev-bridge";
    let self_unit = "iora-dev-bridge.service";
    let tmp = "/tmp/iora-dev-bridge-update";
    let started = std::time::Instant::now();

    // ── Step 1: Download the binary ────────────────────────────
    let download = match body.source.as_str() {
        "http" | "https" => self_update_http(&body, tmp).await,
        "ssh" | "scp" => self_update_ssh(&body, tmp).await,
        "ftp" => self_update_ftp(&body, tmp).await,
        other => CmdResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            stderr: format!(
                "unsupported source '{}' — use 'http', 'ssh', or 'ftp'",
                other
            ),
        },
    };

    if !download.ok {
        let _ = tokio::fs::remove_file(tmp).await;
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": "download failed",
                "source": body.source,
                "download": download,
                "elapsed_ms": started.elapsed().as_millis(),
            })),
        )
            .into_response();
    }

    // ── Step 2: Verify SHA if provided ─────────────────────────
    if let Some(ref expected) = body.expected_sha {
        let payload = match tokio::fs::read(tmp).await {
            Ok(p) => p,
            Err(e) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    format!("reading downloaded binary: {e}"),
                )
                    .into_response();
            }
        };
        let got_sha = hex::encode(Sha256::digest(&payload));
        if !ct_eq(got_sha.as_bytes(), expected.trim().as_bytes()) {
            let _ = tokio::fs::remove_file(tmp).await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "SHA-256 mismatch",
                    "expected": expected,
                    "got": got_sha,
                })),
            )
                .into_response();
        }
    }

    // ── Step 3: Replace binary ─────────────────────────────────
    let payload = match tokio::fs::read(tmp).await {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("reading downloaded binary: {e}"),
            )
                .into_response();
        }
    };
    let _ = tokio::fs::remove_file(tmp).await;
    let got_sha = hex::encode(Sha256::digest(&payload));

    let restart_result =
        match install_binary_and_restart(self_path, &payload, Some(self_unit)).await {
            Ok(r) => r,
            Err(resp) => return resp,
        };

    let elapsed_ms = started.elapsed().as_millis() as u64;

    tracing::info!(
        "self-update: replaced {} with new binary (sha256={}) and restarted {}",
        self_path,
        got_sha,
        self_unit
    );

    Json(serde_json::json!({
        "ok": true,
        "source": body.source,
        "target": self_path,
        "sha256": got_sha,
        "elapsed_ms": elapsed_ms,
        "restart": {
            "ok": restart_result.ok,
            "code": restart_result.code,
            "stdout": restart_result.stdout,
            "stderr": restart_result.stderr,
        },
        "note": "The dev bridge will restart — this connection will drop. Reconnect after a few seconds.",
    })).into_response()
}

async fn self_update_http(body: &SelfUpdateRequest, output: &str) -> CmdResult {
    let url = match &body.url {
        Some(u) => u,
        None => {
            return CmdResult {
                ok: false,
                code: -1,
                stdout: String::new(),
                stderr: "missing 'url' field for http source".into(),
            }
        }
    };

    if command_exists("curl") {
        let mut args = vec!["-sSL".into(), "-o".into(), output.to_string(), url.clone()];
        if body.insecure {
            args.insert(0, "-k".into());
        }
        run_cmd_owned("curl", args, None).await
    } else if command_exists("wget") {
        let mut args = vec!["-O".into(), output.to_string(), url.clone()];
        if body.insecure {
            args.push("--no-check-certificate".into());
        }
        run_cmd_owned("wget", args, None).await
    } else {
        CmdResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            stderr: "neither curl nor wget available on device".into(),
        }
    }
}

async fn self_update_ftp(body: &SelfUpdateRequest, output: &str) -> CmdResult {
    let url = match &body.url {
        Some(u) => u,
        None => {
            return CmdResult {
                ok: false,
                code: -1,
                stdout: String::new(),
                stderr: "missing 'url' field for ftp source".into(),
            }
        }
    };

    // curl supports ftp:// and ftps:// URLs natively
    if command_exists("curl") {
        let mut args = vec!["-sS".into(), "-o".into(), output.to_string(), url.clone()];
        if body.user != "root" && body.password.is_some() {
            args.push("-u".into());
            args.push(format!(
                "{}:{}",
                body.user,
                body.password.as_deref().unwrap_or("")
            ));
        }
        run_cmd_owned("curl", args, None).await
    } else if command_exists("wget") {
        let mut args = vec!["-O".into(), output.to_string(), url.clone()];
        if body.user != "root" {
            args.push("--ftp-user".into());
            args.push(body.user.clone());
            if let Some(ref pw) = body.password {
                args.push("--ftp-password".into());
                args.push(pw.clone());
            }
        }
        run_cmd_owned("wget", args, None).await
    } else {
        CmdResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            stderr: "neither curl nor wget available for ftp download".into(),
        }
    }
}

async fn self_update_ssh(body: &SelfUpdateRequest, output: &str) -> CmdResult {
    let host = match &body.host {
        Some(h) => h,
        None => {
            return CmdResult {
                ok: false,
                code: -1,
                stdout: String::new(),
                stderr: "missing 'host' field for ssh source".into(),
            }
        }
    };
    let remote_path = match &body.path {
        Some(p) => p,
        None => "/usr/bin/iora-dev-bridge",
    };
    let port = body.port;

    // Try scp first, then rsync over ssh as fallback
    if command_exists("scp") {
        let identity = if body.key_path != "/root/.ssh/id_rsa"
            && std::path::Path::new(&body.key_path).exists()
        {
            vec!["-i".into(), body.key_path.clone()]
        } else {
            vec![]
        };

        let mut args = identity;
        if port != 22 {
            args.push("-P".into());
            args.push(port.to_string());
        }
        args.push("-o".into());
        args.push("StrictHostKeyChecking=no".into());
        args.push("-o".into());
        args.push("UserKnownHostsFile=/dev/null".into());
        args.push(format!("{}@{}:{}", body.user, host, remote_path));
        args.push(output.to_string());

        run_cmd_owned("scp", args, None).await
    } else if command_exists("rsync") && command_exists("ssh") {
        let mut args = vec![
            "-avz".into(),
            "-e".into(),
            format!(
                "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p {}",
                port
            ),
            format!("{}@{}:{}", body.user, host, remote_path),
            output.to_string(),
        ];
        if body.key_path != "/root/.ssh/id_rsa" && std::path::Path::new(&body.key_path).exists() {
            args.insert(2, format!("-i {}", body.key_path));
        }
        run_cmd_owned("rsync", args, None).await
    } else {
        CmdResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            stderr: "neither scp nor rsync available for ssh download".into(),
        }
    }
}

async fn install_binary_and_restart(
    target: &str,
    payload: &[u8],
    unit: Option<&str>,
) -> Result<CmdResult, axum::response::Response> {
    let tmp = PathBuf::from(format!("{target}.new"));
    if let Some(parent) = tmp.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("mkdir: {e}")).into_response());
        }
    }
    match tokio::fs::File::create(&tmp).await {
        Ok(mut f) => {
            if let Err(e) = f.write_all(payload).await {
                return Err(
                    (StatusCode::INTERNAL_SERVER_ERROR, format!("write: {e}")).into_response()
                );
            }
            if let Err(e) = f.sync_all().await {
                return Err(
                    (StatusCode::INTERNAL_SERVER_ERROR, format!("fsync: {e}")).into_response()
                );
            }
        }
        Err(e) => {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("open: {e}")).into_response());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    }
    if let Err(e) = tokio::fs::rename(&tmp, target).await {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("rename: {e}")).into_response());
    }
    let restart_result = if let Some(u) = unit {
        if is_allowed_unit(u) {
            if u == "iora-dev-bridge.service" {
                let unit_name = u.to_string();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(750)).await;
                    let _ = run_cmd("systemctl", &["restart", &unit_name]).await;
                });
                CmdResult {
                    ok: true,
                    code: 0,
                    stdout: "iora-dev-bridge restart scheduled after response".into(),
                    stderr: String::new(),
                }
            } else {
                run_cmd("systemctl", &["restart", u]).await
            }
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
    Ok(restart_result)
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
