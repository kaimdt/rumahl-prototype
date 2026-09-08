//! Central log aggregator for the Admin Control Center.
//!
//! Exposes one source-discovery endpoint plus a per-source tail endpoint so the
//! frontend can render logs for any rumahl service, installed app, plugin, or
//! Docker container in a single Logs view.
//!
//! Source IDs use a `<transport>:<unit>` scheme:
//!   - `systemd:<unit>`   — a systemd unit (e.g. `rumahl-home.service`)
//!   - `docker:<name>`    — a docker container by name
//!   - `app:<app_id>`     — an installed rumahl app (resolved to a docker container)
//!   - `plugin:sandbox`   — the shared plugin sandbox container
//!   - `self:rumahl-home`   — the in-process tracing buffer of this service

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::process::Command;
use tracing::warn;

use crate::AppState;

#[derive(Debug, Serialize)]
pub struct LogSource {
    pub id: String,
    pub kind: &'static str, // "service" | "app" | "plugin" | "docker" | "self"
    pub transport: &'static str, // "systemd" | "docker" | "buffer"
    pub name: String,
    pub running: bool,
    /// Short description shown in the UI sidebar.
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LogQuery {
    /// Number of lines to return (default 200, max 5000).
    #[serde(default)]
    pub lines: Option<usize>,
}

fn clamp_lines(n: Option<usize>) -> usize {
    n.unwrap_or(200).clamp(1, 5000)
}

/// GET /api/admin/logs/sources — enumerate every log source the Control
/// Center can stream. Failures from individual probes (e.g. docker not
/// installed) are absorbed: the source list always reflects what is
/// *currently* discoverable on this host.
pub async fn list_log_sources(State(state): State<AppState>) -> Json<Value> {
    let mut sources: Vec<LogSource> = Vec::new();

    // 1) In-process buffer (always available)
    sources.push(LogSource {
        id: "self:rumahl-home".into(),
        kind: "self",
        transport: "buffer",
        name: "rumahl-home (this process)".into(),
        running: true,
        description: Some("Live tracing buffer of the running rumahl-home backend.".into()),
    });

    // 2) systemd rumahl-* services
    if let Ok(units) = list_systemd_rumahl_units().await {
        for (unit, running) in units {
            // strip `.service` suffix for display
            let display = unit.trim_end_matches(".service").to_string();
            sources.push(LogSource {
                id: format!("systemd:{}", unit),
                kind: "service",
                transport: "systemd",
                name: display,
                running,
                description: Some("systemd-managed rumahl service.".into()),
            });
        }
    }

    // 3) Docker containers (named `rumahl-*` only — avoids leaking unrelated hosts)
    if let Ok(containers) = list_rumahl_docker_containers().await {
        for (name, running) in containers {
            // Skip the plugin sandbox here — it gets its own entry below.
            if name == "rumahl-plugin-sandbox" {
                continue;
            }
            // Skip names that already match an installed app — those are
            // surfaced under the "app" kind so users see them grouped.
            sources.push(LogSource {
                id: format!("docker:{}", name),
                kind: "docker",
                transport: "docker",
                name: name.clone(),
                running,
                description: Some("Docker container managed on this host.".into()),
            });
        }
    }

    // 4) Installed apps — resolved to their managed container name
    let apps = state.local_appstore.list().await;
    for app in apps {
        let container = format!("rumahl-app-{}", app.id);
        let running = is_docker_container_running(&container)
            .await
            .unwrap_or(false);
        sources.push(LogSource {
            id: format!("app:{}", app.id),
            kind: "app",
            transport: "docker",
            name: app.name.clone(),
            running,
            description: Some(format!("Installed app, container '{}'.", container)),
        });
    }

    // 5) Plugin sandbox (single shared container hosts every plugin)
    let sandbox_running = is_docker_container_running("rumahl-plugin-sandbox")
        .await
        .unwrap_or(false);
    let plugins = state.plugin_sandbox.list().await;
    sources.push(LogSource {
        id: "plugin:sandbox".into(),
        kind: "plugin",
        transport: "docker",
        name: "Plugin sandbox".into(),
        running: sandbox_running,
        description: Some(format!(
            "Shared plugin runtime ({} plugin(s) loaded).",
            plugins.len()
        )),
    });

    Json(json!({
        "sources": sources,
        "total": sources.len(),
    }))
}

/// GET /api/admin/logs/source/{source_id}?lines=N — fetch the last N lines of
/// a specific log source.
pub async fn get_source_logs(
    State(state): State<AppState>,
    Path(source_id): Path<String>,
    Query(q): Query<LogQuery>,
) -> impl IntoResponse {
    let lines = clamp_lines(q.lines);

    let (transport, unit) = match source_id.split_once(':') {
        Some(t) => t,
        None => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"error": "invalid source id; expected '<transport>:<unit>'"})),
            )
                .into_response();
        }
    };

    match transport {
        "self" => self_buffer_logs(lines).into_response(),
        "systemd" => match read_systemd_logs(unit, lines).await {
            Ok(out) => Json(json!({
                "source_id": source_id,
                "transport": "systemd",
                "lines": out,
            }))
            .into_response(),
            Err(e) => log_error_response(&source_id, "systemd", &e),
        },
        "docker" => match read_docker_logs(unit, lines).await {
            Ok(out) => Json(json!({
                "source_id": source_id,
                "transport": "docker",
                "lines": out,
            }))
            .into_response(),
            Err(e) => log_error_response(&source_id, "docker", &e),
        },
        "app" => {
            // Apps live in `rumahl-app-<id>` containers.
            let container = format!("rumahl-app-{}", unit);
            match read_docker_logs(&container, lines).await {
                Ok(out) => Json(json!({
                    "source_id": source_id,
                    "transport": "docker",
                    "container": container,
                    "lines": out,
                }))
                .into_response(),
                Err(e) => log_error_response(&source_id, "docker", &e),
            }
        }
        "plugin" => {
            // Single shared sandbox container.
            let container = "rumahl-plugin-sandbox";
            match read_docker_logs(container, lines).await {
                Ok(out) => Json(json!({
                    "source_id": source_id,
                    "transport": "docker",
                    "container": container,
                    "lines": out,
                }))
                .into_response(),
                Err(e) => log_error_response(&source_id, "docker", &e),
            }
        }
        other => {
            warn!("unknown log transport requested: {}", other);
            let _ = &state; // suppress unused warning when no branch uses state
            (
                axum::http::StatusCode::NOT_FOUND,
                Json(json!({"error": format!("unknown transport '{}'", other)})),
            )
                .into_response()
        }
    }
}

fn log_error_response(source: &str, transport: &str, err: &str) -> axum::response::Response {
    (
        axum::http::StatusCode::BAD_GATEWAY,
        Json(json!({
            "source_id": source,
            "transport": transport,
            "error": err,
            "lines": [],
        })),
    )
        .into_response()
}

/// Render the in-process LOG_BUFFER as a list of plain text lines so the
/// frontend can render every source uniformly.
fn self_buffer_logs(lines: usize) -> Json<Value> {
    use std::sync::atomic::Ordering;
    let entries = if let Ok(buf) = crate::LOG_BUFFER.read() {
        buf.iter()
            .rev()
            .take(lines)
            .map(|e| {
                format!(
                    "{} {:<5} {} {}",
                    e.timestamp,
                    e.level.to_uppercase(),
                    e.target,
                    e.message,
                )
            })
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
    } else {
        vec![]
    };
    let total = crate::LOG_BUFFER.read().map(|b| b.len()).unwrap_or(0);
    let latest = crate::LOG_ID_COUNTER
        .load(Ordering::Relaxed)
        .saturating_sub(1);
    Json(json!({
        "source_id": "self:rumahl-home",
        "transport": "buffer",
        "lines": entries,
        "buffer_total": total,
        "latest_id": latest,
    }))
}

// ─── Discovery helpers ──────────────────────────────────────────────

async fn list_systemd_rumahl_units() -> Result<Vec<(String, bool)>, String> {
    // `systemctl list-units --type=service --all --no-legend --plain --no-pager`
    // returns lines of the form: `<unit>  <load>  <active>  <sub>  <desc...>`.
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new("systemctl")
            .args([
                "list-units",
                "--type=service",
                "--all",
                "--no-legend",
                "--plain",
                "--no-pager",
            ])
            .output(),
    )
    .await
    .map_err(|_| "systemctl timed out".to_string())?
    .map_err(|e| format!("systemctl failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "systemctl exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let mut units = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split_whitespace();
        let unit = match parts.next() {
            Some(u) => u,
            None => continue,
        };
        if !unit.starts_with("rumahl-") || !unit.ends_with(".service") {
            continue;
        }
        // Fields: load, active, sub
        let _load = parts.next();
        let active = parts.next().unwrap_or("");
        let running = active == "active";
        units.push((unit.to_string(), running));
    }
    Ok(units)
}

async fn list_rumahl_docker_containers() -> Result<Vec<(String, bool)>, String> {
    // Try the local docker CLI first (works on the dev host where the user is
    // in the `docker` group). On rumahl OS the docker socket is root-only and
    // this will fail with EACCES — in that case fall back to the
    // rumahl-supervisor HTTP API (which runs as root and is the sole gateway
    // to dockerd).
    let cli_result = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new("docker")
            .args(["ps", "-a", "--format", "{{.Names}}\t{{.State}}"])
            .output(),
    )
    .await;

    if let Ok(Ok(output)) = cli_result {
        if output.status.success() {
            let mut containers = Vec::new();
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let mut it = line.splitn(2, '\t');
                let name = match it.next() {
                    Some(n) if !n.is_empty() => n.to_string(),
                    _ => continue,
                };
                if !name.starts_with("rumahl-") {
                    continue;
                }
                let state = it.next().unwrap_or("").trim().to_ascii_lowercase();
                let running = state == "running";
                containers.push((name, running));
            }
            return Ok(containers);
        }
    }

    // Fallback: ask rumahl-supervisor over HTTP.
    list_containers_via_supervisor().await
}

async fn is_docker_container_running(name: &str) -> Result<bool, String> {
    let cli = tokio::time::timeout(
        Duration::from_secs(2),
        Command::new("docker")
            .args(["inspect", "--format", "{{.State.Running}}", name])
            .output(),
    )
    .await;
    if let Ok(Ok(output)) = cli {
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim() == "true");
        }
    }
    // Fallback via supervisor list.
    let containers = list_containers_via_supervisor().await.unwrap_or_default();
    Ok(containers
        .into_iter()
        .find(|(n, _)| n == name)
        .map(|(_, r)| r)
        .unwrap_or(false))
}

/// Resolve the rumahl-supervisor base URL. Defaults to the well-known port 8097
/// on localhost. Override with `RUMAHL_SUPERVISOR_URL`.
fn supervisor_base() -> String {
    std::env::var("RUMAHL_SUPERVISOR_URL").unwrap_or_else(|_| "http://127.0.0.1:8097".to_string())
}

/// Call `GET /api/supervisor/containers` and return `(name, running)` pairs
/// for `rumahl-*` containers.
async fn list_containers_via_supervisor() -> Result<Vec<(String, bool)>, String> {
    #[derive(Deserialize)]
    struct C {
        name: String,
        state: String,
    }
    let url = format!("{}/api/supervisor/containers", supervisor_base());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("supervisor unreachable: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("supervisor returned HTTP {}", resp.status()));
    }
    let list: Vec<C> = resp
        .json()
        .await
        .map_err(|e| format!("supervisor decode: {e}"))?;
    Ok(list
        .into_iter()
        .filter(|c| c.name.starts_with("rumahl-"))
        .map(|c| {
            let running = c.state.eq_ignore_ascii_case("running");
            (c.name, running)
        })
        .collect())
}

/// Call `GET /api/supervisor/containers/{name}/logs` and return the lines.
/// The supervisor caps the tail at 100, which we cannot override here — but
/// the local CLI path (when available) honours the requested line count.
async fn read_docker_logs_via_supervisor(container: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct R {
        #[serde(default)]
        logs: String,
    }
    let url = format!(
        "{}/api/supervisor/containers/{}/logs",
        supervisor_base(),
        container
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("supervisor unreachable: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("supervisor returned HTTP {}", resp.status()));
    }
    let body: R = resp
        .json()
        .await
        .map_err(|e| format!("supervisor decode: {e}"))?;
    Ok(body.logs.lines().map(|s| s.to_string()).collect())
}

// ─── Log readers ────────────────────────────────────────────────────

async fn read_systemd_logs(unit: &str, lines: usize) -> Result<Vec<String>, String> {
    // Reject obviously bogus unit names (no shell metacharacters allowed).
    if !is_safe_token(unit) {
        return Err(format!("invalid unit name '{}'", unit));
    }
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new("journalctl")
            .args([
                "-u",
                unit,
                "-n",
                &lines.to_string(),
                "--no-pager",
                "-o",
                "short-iso",
            ])
            .output(),
    )
    .await
    .map_err(|_| "journalctl timed out".to_string())?
    .map_err(|e| format!("journalctl spawn failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "journalctl exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect())
}

async fn read_docker_logs(container: &str, lines: usize) -> Result<Vec<String>, String> {
    if !is_safe_token(container) {
        return Err(format!("invalid container name '{}'", container));
    }
    // Prefer the local CLI (honours --tail). Fall back to the supervisor HTTP
    // API on rumahl OS where the docker socket is root-only.
    let cli = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new("docker")
            .args([
                "logs",
                "--tail",
                &lines.to_string(),
                "--timestamps",
                container,
            ])
            .output(),
    )
    .await;

    if let Ok(Ok(output)) = cli {
        if output.status.success() || !output.stdout.is_empty() {
            let mut out = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.is_empty() {
                out.push('\n');
                out.push_str(&stderr);
            }
            return Ok(out.lines().map(|s| s.to_string()).collect());
        }
    }

    // Fallback: ask rumahl-supervisor (returns up to 100 lines).
    read_docker_logs_via_supervisor(container).await
}

/// Only allow alphanumerics, `-`, `_`, `.`, `@`, `:` — sufficient for unit and
/// container names and rejects shell metacharacters.
fn is_safe_token(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | ':'))
}
