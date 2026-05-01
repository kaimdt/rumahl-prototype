use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}};

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use iora_shared::system_config;
use sysinfo::System;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt as _;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};

// ─── Recovery configuration ──────────────────────────────────────────────────

/// How many consecutive failed health checks before the watchdog tries to
/// recover the service automatically.  Override with
/// `IORA_RECOVERY_THRESHOLD`.
const DEFAULT_RECOVERY_THRESHOLD: u32 = 3;

/// Minimum seconds between two recovery attempts for the same service.
/// Prevents flapping.  Override with `IORA_RECOVERY_COOLDOWN_SECS`.
const DEFAULT_RECOVERY_COOLDOWN_SECS: u64 = 120;

/// Recovery backend used to restart failing services.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveryMode {
    /// Call `systemctl restart <name>` (default on bare-metal / Debian installs).
    Systemd,
    /// Call the Docker daemon via `docker restart iora-<name>` (for iora-os).
    Docker,
    /// Do nothing, only record and broadcast events.
    Disabled,
}

/// Number of consecutive failed restart attempts before the watchdog
/// switches from "plain restart" to "gather-logs + heuristic self-fix".
const SELF_FIX_AFTER_FAILED_RESTARTS: u32 = 2;

/// Number of consecutive failed recovery cycles (restart + self-fix) before
/// the watchdog gives up and posts a system notification with the captured
/// log to iora-home.
const NOTIFY_AFTER_FAILED_RECOVERIES: u32 = 3;

/// How many lines of log tail to gather and forward to iora-home when a
/// service can't be recovered automatically.
const LOG_TAIL_LINES: usize = 200;

impl RecoveryMode {
    fn from_env() -> Self {
        match std::env::var("IORA_RECOVERY_MODE").as_deref() {
            Ok("docker") => RecoveryMode::Docker,
            Ok("disabled") | Ok("off") | Ok("none") => RecoveryMode::Disabled,
            _ => RecoveryMode::Systemd,
        }
    }
}

// ─── State ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    services: Arc<RwLock<HashMap<String, ServiceStatus>>>,
    events_tx: broadcast::Sender<WatchdogEvent>,
    started_at: Arc<Instant>,
    core_is_down: Arc<RwLock<bool>>,
    system: Arc<RwLock<System>>,
    recovery_mode: RecoveryMode,
    recovery_threshold: u32,
    recovery_cooldown: Duration,
    /// Last recovery attempt per service (wall-clock monotonic instant).
    last_recovery: Arc<RwLock<HashMap<String, Instant>>>,
    recovery_history: Arc<RwLock<Vec<RecoveryRecord>>>,
    /// Consecutive failed recovery cycles per service. Resets on success.
    /// Drives the escalation ladder: restart → self-fix → notify.
    failed_recoveries: Arc<RwLock<HashMap<String, u32>>>,
    /// Services for which a system notification has already been raised
    /// (suppresses duplicates until the next successful health check).
    notified: Arc<RwLock<HashMap<String, Instant>>>,
    /// `iora-home` base URL for posting system notifications, e.g.
    /// `http://127.0.0.1:8126`. Read from `IORA_HOME_URL`.
    iora_home_url: Option<String>,
    /// Shared secret matched against `IORA_INTERNAL_TOKEN` on iora-home.
    internal_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct RecoveryRecord {
    service: String,
    action: String,
    success: bool,
    detail: String,
    timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceStatus {
    name: String,
    url: String,
    status: String,  // healthy, degraded, unhealthy, unreachable
    response_time_ms: Option<u64>,
    last_check: String,
    last_success: Option<String>,
    consecutive_failures: u32,
    uptime_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WatchdogEvent {
    event_type: String,
    service_name: Option<String>,
    severity: String,  // info, warning, critical
    message: String,
    timestamp: String,
}

#[derive(Debug, Deserialize)]
struct RegisterServiceRequest {
    name: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct HeartbeatRequest {
    service_name: String,
    status: Option<String>,
}

#[derive(Debug, Serialize)]
struct SystemMetrics {
    cpu_usage_percent: f32,
    memory_used_mb: u64,
    memory_total_mb: u64,
    memory_percent: f32,
    timestamp: String,
}

// ─── Health Checking ─────────────────────────────────────────────────────────

async fn check_service_health(url: &str) -> (String, Option<u64>) {
    let start = Instant::now();
    let health_url = format!("{}/health", url.trim_end_matches('/'));

    match tokio::time::timeout(
        Duration::from_secs(5),
        reqwest::get(&health_url)
    ).await {
        Ok(Ok(response)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            if response.status().is_success() {
                ("healthy".to_string(), Some(elapsed))
            } else {
                ("unhealthy".to_string(), Some(elapsed))
            }
        }
        Ok(Err(_)) => ("unreachable".to_string(), None),
        Err(_) => ("unreachable".to_string(), None),
    }
}

async fn health_check_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(10));

    loop {
        interval.tick().await;

        let services = state.services.read().await.clone();

        for (name, mut service) in services {
            let (new_status, response_time) = check_service_health(&service.url).await;

            let now = Utc::now().to_rfc3339();
            let was_healthy = service.status == "healthy";
            let is_healthy = new_status == "healthy";

            service.status = new_status.clone();
            service.response_time_ms = response_time;
            service.last_check = now.clone();

            if is_healthy {
                service.last_success = Some(now.clone());
                if service.consecutive_failures > 0 {
                    // Service recovered
                    warn!("Service {} recovered", name);
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "service_recovered".to_string(),
                        service_name: Some(name.clone()),
                        severity: "info".to_string(),
                        message: format!("Service {} is now healthy", name),
                        timestamp: now.clone(),
                    });
                }
                service.consecutive_failures = 0;
                // Clear escalation state so future failures restart the
                // ladder from "plain restart" again.
                state.failed_recoveries.write().await.remove(&name);
                state.notified.write().await.remove(&name);
            } else {
                service.consecutive_failures += 1;

                if was_healthy && !is_healthy {
                    // Service just went down
                    error!("Service {} is now {}", name, new_status);
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "service_down".to_string(),
                        service_name: Some(name.clone()),
                        severity: "critical".to_string(),
                        message: format!("Service {} is {}", name, new_status),
                        timestamp: now.clone(),
                    });
                }

                // ── Auto-recovery ────────────────────────────────────────
                if service.consecutive_failures >= state.recovery_threshold
                    && state.recovery_mode != RecoveryMode::Disabled
                {
                    let should_attempt = {
                        let map = state.last_recovery.read().await;
                        match map.get(&name) {
                            Some(ts) => ts.elapsed() >= state.recovery_cooldown,
                            None => true,
                        }
                    };
                    if should_attempt {
                        state.last_recovery.write().await.insert(name.clone(), Instant::now());
                        attempt_recovery(&state, &name).await;
                    }
                }
            }

            // Check for iora-core specifically
            if name == "iora-core" {
                let mut core_down = state.core_is_down.write().await;
                let was_core_down = *core_down;
                *core_down = !is_healthy;

                if !was_core_down && *core_down {
                    error!("CRITICAL: iora-core is down! Watchdog taking over event bus");
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "core_down".to_string(),
                        service_name: Some("iora-core".to_string()),
                        severity: "critical".to_string(),
                        message: "Core orchestrator is down - watchdog is now handling events".to_string(),
                        timestamp: now.clone(),
                    });
                } else if was_core_down && !*core_down {
                    info!("iora-core recovered - returning event bus control");
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "core_recovered".to_string(),
                        service_name: Some("iora-core".to_string()),
                        severity: "info".to_string(),
                        message: "Core orchestrator has recovered".to_string(),
                        timestamp: now,
                    });
                }
            }

            state.services.write().await.insert(name, service);
        }
    }
}

async fn system_metrics_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));

    loop {
        interval.tick().await;

        let mut sys = state.system.write().await;
        sys.refresh_cpu();
        sys.refresh_memory();
    }
}

/// Try to recover an unhealthy service using the configured backend.
/// Runs the restart command in a blocking task so we never stall the async
/// health-check loop.
///
/// Escalation ladder driven by `state.failed_recoveries[name]`:
///
/// 1. **Restart** (`systemctl` / `docker restart`).
/// 2. After `SELF_FIX_AFTER_FAILED_RESTARTS` consecutive failed restarts:
///    gather the service log, run heuristic fixes (kill port squatter, etc.)
///    and try the restart one more time.
/// 3. After `NOTIFY_AFTER_FAILED_RECOVERIES` consecutive failed recoveries:
///    POST a system notification (with the captured log tail) to `iora-home`
///    and stop further restart attempts until the next successful health
///    check. Subsequent failures of the same service are coalesced into the
///    existing un-resolved notification instead of spamming duplicates.
async fn attempt_recovery(state: &AppState, service_name: &str) {
    let mode = state.recovery_mode;
    let svc = service_name.to_string();

    // If we've already raised a system notification for this service and
    // haven't seen a recovery yet, back off — restart-loops won't fix it
    // and we don't want to flood the cluster.
    if state.notified.read().await.contains_key(&svc) {
        warn!("Skipping auto-recovery for {} (already escalated to system notification)", svc);
        return;
    }

    warn!("Attempting auto-recovery for {} (mode={:?})", svc, mode);

    let _ = state.events_tx.send(WatchdogEvent {
        event_type: "recovery_started".to_string(),
        service_name: Some(svc.clone()),
        severity: "warning".to_string(),
        message: format!("Auto-recovery starting for {svc}"),
        timestamp: Utc::now().to_rfc3339(),
    });

    let svc_spawn = svc.clone();
    let result = tokio::task::spawn_blocking(move || run_recovery_command(mode, &svc_spawn))
        .await
        .unwrap_or_else(|e| Err(format!("join error: {e}")));

    let now = Utc::now().to_rfc3339();
    match result {
        Ok(detail) => {
            info!("Recovery succeeded for {}: {}", svc, detail);
            state.failed_recoveries.write().await.remove(&svc);
            let _ = state.events_tx.send(WatchdogEvent {
                event_type: "recovery_succeeded".to_string(),
                service_name: Some(svc.clone()),
                severity: "info".to_string(),
                message: format!("Recovery ok: {detail}"),
                timestamp: now.clone(),
            });
            push_recovery_record(state, svc, "restart", true, detail, now).await;
        }
        Err(detail) => {
            error!("Recovery failed for {}: {}", svc, detail);
            let attempts = {
                let mut map = state.failed_recoveries.write().await;
                let n = map.entry(svc.clone()).or_insert(0);
                *n += 1;
                *n
            };
            let _ = state.events_tx.send(WatchdogEvent {
                event_type: "recovery_failed".to_string(),
                service_name: Some(svc.clone()),
                severity: "critical".to_string(),
                message: format!("Recovery failed (attempt {attempts}): {detail}"),
                timestamp: now.clone(),
            });
            push_recovery_record(state, svc.clone(), "restart", false, detail.clone(), now.clone()).await;

            // Escalate: gather logs + try heuristic self-fix.
            if attempts == SELF_FIX_AFTER_FAILED_RESTARTS {
                attempt_self_fix(state, &svc).await;
            }

            // Escalate further: post a system notification on iora-home and
            // mark the service as "notified" so we stop restart-storming it.
            if attempts >= NOTIFY_AFTER_FAILED_RECOVERIES {
                let logs = gather_service_logs(state.recovery_mode, &svc).await;
                escalate_to_system_notification(state, &svc, &detail, &logs).await;
                state.notified.write().await.insert(svc.clone(), Instant::now());
            }
        }
    }
}

/// Try to mechanically fix common failure modes detected in the service log.
/// Best-effort and side-effect-free unless a known signature matches —
/// any fix that succeeds is followed by another `run_recovery_command`.
async fn attempt_self_fix(state: &AppState, service: &str) {
    let mode = state.recovery_mode;
    let logs = gather_service_logs(mode, service).await;
    let lower = logs.to_ascii_lowercase();

    let mut applied: Vec<String> = Vec::new();

    // ── Heuristic 1: port already bound by a stale process ─────────────
    // Patterns: "address already in use", "EADDRINUSE", "bind: address in use"
    if lower.contains("address already in use")
        || lower.contains("eaddrinuse")
        || lower.contains("bind: address in use")
    {
        if let Some(port) = extract_port_from_log(&logs)
            .or_else(|| guess_default_port(service))
        {
            if free_tcp_port(port).await {
                applied.push(format!("freed TCP port {port}"));
            }
        }
    }

    // ── Heuristic 2: stale Docker container in "Created"/"Exited" state ─
    if mode == RecoveryMode::Docker
        && (lower.contains("container is not running")
            || lower.contains("no such container"))
    {
        let container = format!("iora-{service}");
        if run_blocking_cmd("docker", &["rm", "-f", &container]).await.is_ok() {
            applied.push(format!("removed stale container {container}"));
        }
    }

    // ── Heuristic 3: PostgreSQL dependency unreachable ──────────────────
    if (lower.contains("could not connect to server")
        || lower.contains("connection refused"))
        && (lower.contains("postgres") || lower.contains("5432"))
    {
        let pg_restart = match mode {
            RecoveryMode::Systemd => run_blocking_cmd("systemctl", &["restart", "postgresql"]).await,
            RecoveryMode::Docker => run_blocking_cmd("docker", &["restart", "iora-postgres"]).await,
            RecoveryMode::Disabled => Err("disabled".to_string()),
        };
        if pg_restart.is_ok() {
            applied.push("restarted postgres dependency".to_string());
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    }

    let now = Utc::now().to_rfc3339();
    if applied.is_empty() {
        warn!("self-fix for {}: no known signatures matched", service);
        let _ = state.events_tx.send(WatchdogEvent {
            event_type: "self_fix_skipped".to_string(),
            service_name: Some(service.to_string()),
            severity: "warning".to_string(),
            message: format!("Self-fix found no matching signature for {service}"),
            timestamp: now,
        });
        return;
    }

    let summary = applied.join("; ");
    info!("self-fix for {} applied: {}", service, summary);
    let _ = state.events_tx.send(WatchdogEvent {
        event_type: "self_fix_applied".to_string(),
        service_name: Some(service.to_string()),
        severity: "warning".to_string(),
        message: format!("Self-fix applied for {service}: {summary}"),
        timestamp: now.clone(),
    });
    push_recovery_record(state, service.to_string(), "self_fix", true, summary, now).await;

    // After a fix, retry the plain restart once.
    let svc = service.to_string();
    let result = tokio::task::spawn_blocking(move || run_recovery_command(mode, &svc))
        .await
        .unwrap_or_else(|e| Err(format!("join error: {e}")));
    let now = Utc::now().to_rfc3339();
    match result {
        Ok(detail) => {
            info!("post-self-fix restart succeeded for {}: {}", service, detail);
            push_recovery_record(state, service.to_string(), "post_self_fix_restart", true, detail, now).await;
        }
        Err(detail) => {
            warn!("post-self-fix restart still failing for {}: {}", service, detail);
            push_recovery_record(state, service.to_string(), "post_self_fix_restart", false, detail, now).await;
        }
    }
}

/// Capture the last `LOG_TAIL_LINES` of a service's log for diagnostics.
/// Returns "(no log captured)" on any failure — never panics.
async fn gather_service_logs(mode: RecoveryMode, service: &str) -> String {
    let svc = service.to_string();
    let result: Result<String, String> = tokio::task::spawn_blocking(move || {
        use std::process::Command;
        let lines = LOG_TAIL_LINES.to_string();
        match mode {
            RecoveryMode::Systemd => {
                let out = Command::new("journalctl")
                    .args(["-u", &svc, "-n", &lines, "--no-pager", "--output=short-iso"])
                    .output()
                    .map_err(|e| format!("journalctl spawn failed: {e}"))?;
                Ok(format!(
                    "{}{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                ))
            }
            RecoveryMode::Docker => {
                let candidates = [format!("iora-{svc}"), svc.clone()];
                for container in &candidates {
                    let out = Command::new("docker")
                        .args(["logs", "--tail", &lines, container])
                        .output();
                    if let Ok(out) = out {
                        if out.status.success() {
                            return Ok(format!(
                                "{}{}",
                                String::from_utf8_lossy(&out.stdout),
                                String::from_utf8_lossy(&out.stderr)
                            ));
                        }
                    }
                }
                Err("docker logs failed for all candidates".to_string())
            }
            RecoveryMode::Disabled => Err("recovery disabled".to_string()),
        }
    })
    .await
    .unwrap_or_else(|e| Err(format!("join error: {e}")));

    match result {
        Ok(s) if !s.trim().is_empty() => {
            // Cap to ~32 KiB so we don't push huge payloads through the API.
            if s.len() > 32_000 {
                let cut = s.len() - 32_000;
                format!("(truncated {cut} bytes)\n{}", &s[cut..])
            } else {
                s
            }
        }
        _ => "(no log captured)".to_string(),
    }
}

/// Extract a TCP port number from a "address already in use" log line.
/// Looks for `:PORT` patterns following common bind error phrasings.
fn extract_port_from_log(log: &str) -> Option<u16> {
    for line in log.lines() {
        let l = line.to_ascii_lowercase();
        if !(l.contains("address already in use")
            || l.contains("eaddrinuse")
            || l.contains("bind"))
        {
            continue;
        }
        // Scan for ":NNNN" tokens.
        for (i, ch) in line.char_indices() {
            if ch == ':' {
                let rest = &line[i + 1..];
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if digits.len() >= 2 && digits.len() <= 5 {
                    if let Ok(p) = digits.parse::<u16>() {
                        if p > 0 {
                            return Some(p);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Hard-coded fallback ports when the log doesn't reveal the bound port.
fn guess_default_port(service: &str) -> Option<u16> {
    match service {
        "iora-home" => Some(8126),
        "iora-core" => Some(8090),
        "iora-assist" => Some(8092),
        "iora-secrets" => Some(8093),
        "iora-watchdog" => Some(8094),
        "iora-security" => Some(8095),
        "iora-gateway" => Some(8096),
        "iora-supervisor" => Some(8097),
        "iora-appstore" => Some(8098),
        "iora-files" => Some(8100),
        "iora-connector" => Some(8102),
        "iora-network-monitor" => Some(8103),
        "iora-domain-validator" => Some(8104),
        "iora-resource-manager" => Some(8105),
        _ => None,
    }
}

/// Best-effort: kill whatever process is currently listening on `port`.
/// Tries `fuser` first, falls back to `lsof`. Linux-only — on other
/// platforms this is a no-op that returns false.
async fn free_tcp_port(port: u16) -> bool {
    let port_str = port.to_string();
    if run_blocking_cmd("fuser", &["-k", &format!("{port}/tcp")]).await.is_ok() {
        tokio::time::sleep(Duration::from_millis(500)).await;
        return true;
    }
    // Fallback: lsof + kill
    if let Ok(out) = run_blocking_cmd_output("lsof", &["-tiTCP:".to_string() + &port_str + ",STATE:LISTEN"]).await {
        let pids: Vec<String> = out
            .lines()
            .filter_map(|l| l.trim().parse::<u32>().ok())
            .map(|p| p.to_string())
            .collect();
        if !pids.is_empty() {
            for pid in &pids {
                let _ = run_blocking_cmd("kill", &["-9", pid]).await;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            return true;
        }
    }
    false
}

async fn run_blocking_cmd(bin: &str, args: &[&str]) -> Result<(), String> {
    let bin = bin.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    tokio::task::spawn_blocking(move || {
        use std::process::Command;
        let out = Command::new(&bin)
            .args(&args)
            .output()
            .map_err(|e| format!("{bin} spawn failed: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "{bin} exit {}: {}",
                out.status,
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
    })
    .await
    .unwrap_or_else(|e| Err(format!("join error: {e}")))
}

async fn run_blocking_cmd_output(bin: &str, args: &[String]) -> Result<String, String> {
    let bin = bin.to_string();
    let args = args.to_vec();
    tokio::task::spawn_blocking(move || {
        use std::process::Command;
        let out = Command::new(&bin)
            .args(&args)
            .output()
            .map_err(|e| format!("{bin} spawn failed: {e}"))?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    })
    .await
    .unwrap_or_else(|e| Err(format!("join error: {e}")))
}

/// POST an `admin_system_notifications` row to iora-home so the user sees a
/// persistent system message (NOT a transient toast) in the admin panel.
async fn escalate_to_system_notification(
    state: &AppState,
    service: &str,
    last_error: &str,
    logs: &str,
) {
    let (Some(base), Some(token)) = (state.iora_home_url.as_ref(), state.internal_token.as_ref()) else {
        warn!(
            "Cannot escalate {} to system notification: IORA_HOME_URL or IORA_INTERNAL_TOKEN unset",
            service
        );
        return;
    };

    let url = format!("{}/api/internal/system-notifications", base.trim_end_matches('/'));
    let body = serde_json::json!({
        "category": "watchdog",
        "severity": "critical",
        "title": format!("Service '{service}' kann nicht automatisch wiederhergestellt werden"),
        "message": format!(
            "Auto-Recovery (Restart + Heuristik-Fix) für '{service}' ist {NOTIFY_AFTER_FAILED_RECOVERIES}× fehlgeschlagen. Manuelle Untersuchung erforderlich."
        ),
        "source": "iora-watchdog",
        "coalesce": true,
        "details": {
            "service": service,
            "recovery_mode": format!("{:?}", state.recovery_mode).to_lowercase(),
            "last_error": last_error,
            "log_tail": logs,
            "log_lines_captured": logs.lines().count(),
        },
    });

    let res = reqwest::Client::new()
        .post(&url)
        .header("X-Iora-Internal-Token", token.as_str())
        .json(&body)
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            info!("escalated {} to iora-home system notification", service);
            let _ = state.events_tx.send(WatchdogEvent {
                event_type: "recovery_escalated".to_string(),
                service_name: Some(service.to_string()),
                severity: "critical".to_string(),
                message: format!("Posted system notification to iora-home for {service}"),
                timestamp: Utc::now().to_rfc3339(),
            });
        }
        Ok(r) => warn!(
            "escalation POST for {} returned status {}",
            service,
            r.status()
        ),
        Err(e) => warn!("escalation POST for {} failed: {}", service, e),
    }
}

fn run_recovery_command(mode: RecoveryMode, service: &str) -> Result<String, String> {
    use std::process::Command;
    match mode {
        RecoveryMode::Disabled => Err("recovery disabled".to_string()),
        RecoveryMode::Systemd => {
            let out = Command::new("systemctl")
                .args(["restart", service])
                .output()
                .map_err(|e| format!("systemctl spawn failed: {e}"))?;
            if out.status.success() {
                Ok(format!("systemctl restart {service}"))
            } else {
                Err(format!(
                    "systemctl exit {}: {}",
                    out.status,
                    String::from_utf8_lossy(&out.stderr).trim()
                ))
            }
        }
        RecoveryMode::Docker => {
            // Container naming convention used by iora-supervisor / iora-os.
            let candidates = [format!("iora-{service}"), service.to_string()];
            let mut last_err = String::new();
            for container in &candidates {
                let out = Command::new("docker")
                    .args(["restart", container])
                    .output()
                    .map_err(|e| format!("docker spawn failed: {e}"))?;
                if out.status.success() {
                    return Ok(format!("docker restart {container}"));
                }
                last_err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            }
            Err(format!("docker restart failed: {last_err}"))
        }
    }
}

async fn push_recovery_record(
    state: &AppState,
    service: String,
    action: &str,
    success: bool,
    detail: String,
    ts: String,
) {
    let mut history = state.recovery_history.write().await;
    history.push(RecoveryRecord {
        service,
        action: action.to_string(),
        success,
        detail,
        timestamp: ts,
    });
    // Cap history to 500 entries so memory is bounded.
    let excess = history.len().saturating_sub(500);
    if excess > 0 {
        history.drain(0..excess);
    }
}

async fn get_recovery_history(State(state): State<AppState>) -> Json<serde_json::Value> {
    let history = state.recovery_history.read().await;
    Json(serde_json::json!({
        "mode": format!("{:?}", state.recovery_mode).to_lowercase(),
        "threshold": state.recovery_threshold,
        "cooldown_secs": state.recovery_cooldown.as_secs(),
        "total": history.len(),
        "entries": &*history,
    }))
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services = state.services.read().await;
    let healthy_count = services.values().filter(|s| s.status == "healthy").count();
    let total_count = services.len();

    Json(serde_json::json!({
        "service": "iora-watchdog",
        "status": "healthy",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
        "monitored_services": total_count,
        "healthy_services": healthy_count,
        "core_is_down": *state.core_is_down.read().await,
    }))
}

async fn health_text(State(state): State<AppState>) -> impl IntoResponse {
    let services = state.services.read().await;
    let healthy_count = services.values().filter(|s| s.status == "healthy").count();
    let total_count = services.len();
    let core_is_down = *state.core_is_down.read().await;
    let status_text = if healthy_count == total_count && !core_is_down {
        "healthy"
    } else if healthy_count > 0 {
        "degraded"
    } else {
        "unhealthy"
    };

    let body = format!(
        "service: iora-watchdog\nstatus: {}\nuptime_seconds: {}\nmonitored_services: {}\nhealthy_services: {}\ncore_is_down: {}\ntimestamp: {}\n",
        status_text,
        state.started_at.elapsed().as_secs(),
        total_count,
        healthy_count,
        core_is_down,
        Utc::now().to_rfc3339(),
    );

    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        body,
    )
}

async fn get_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services: Vec<ServiceStatus> = state.services.read().await.values().cloned().collect();

    Json(serde_json::json!({
        "services": services,
        "total": services.len(),
        "core_is_down": *state.core_is_down.read().await,
    }))
}

async fn list_services(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services: Vec<ServiceStatus> = state.services.read().await.values().cloned().collect();

    Json(serde_json::json!({
        "services": services,
        "total": services.len(),
    }))
}

async fn register_service(
    State(state): State<AppState>,
    Json(req): Json<RegisterServiceRequest>,
) -> impl IntoResponse {
    let service_status = ServiceStatus {
        name: req.name.clone(),
        url: req.url.clone(),
        status: "unknown".to_string(),
        response_time_ms: None,
        last_check: Utc::now().to_rfc3339(),
        last_success: None,
        consecutive_failures: 0,
        uptime_percent: 100.0,
    };

    state.services.write().await.insert(req.name.clone(), service_status);

    info!("Registered service: {} at {}", req.name, req.url);

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "message": "Service registered with watchdog",
            "name": req.name,
        })),
    )
}

async fn receive_heartbeat(
    State(state): State<AppState>,
    Json(req): Json<HeartbeatRequest>,
) -> impl IntoResponse {
    let mut services = state.services.write().await;

    if let Some(service) = services.get_mut(&req.service_name) {
        service.last_check = Utc::now().to_rfc3339();
        if let Some(status) = req.status {
            service.status = status;
        }
        if service.status == "healthy" {
            service.last_success = Some(Utc::now().to_rfc3339());
            service.consecutive_failures = 0;
        }

        Json(serde_json::json!({
            "message": "Heartbeat received",
            "service": req.service_name,
        }))
    } else {
        Json(serde_json::json!({
            "error": "Service not registered",
            "service": req.service_name,
        }))
    }
}

async fn get_metrics(State(state): State<AppState>) -> Json<SystemMetrics> {
    let sys = state.system.read().await;

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let memory_used = sys.used_memory() / 1024 / 1024;  // Convert to MB
    let memory_total = sys.total_memory() / 1024 / 1024;
    let memory_percent = if memory_total > 0 {
        (memory_used as f32 / memory_total as f32) * 100.0
    } else {
        0.0
    };

    Json(SystemMetrics {
        cpu_usage_percent: cpu_usage,
        memory_used_mb: memory_used,
        memory_total_mb: memory_total,
        memory_percent,
        timestamp: Utc::now().to_rfc3339(),
    })
}

async fn events_stream(
    State(state): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.events_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| match result {
        Ok(event) => {
            let json = serde_json::to_string(&event).ok()?;
            Some(Ok(Event::default().data(json)))
        }
        Err(_) => None,
    });

    Sse::new(stream)
}

async fn broadcast_event(
    State(state): State<AppState>,
    Json(event): Json<WatchdogEvent>,
) -> impl IntoResponse {
    let _ = state.events_tx.send(event);

    Json(serde_json::json!({
        "message": "Event broadcasted"
    }))
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    let (events_tx, _) = broadcast::channel(1000);

    let recovery_threshold = system_config::recovery_threshold();
    let recovery_cooldown = Duration::from_secs(
        system_config::recovery_cooldown_secs(),
    );
    let recovery_mode = RecoveryMode::from_env();
    info!(
        "Auto-recovery: mode={:?} threshold={} cooldown={}s",
        recovery_mode,
        recovery_threshold,
        recovery_cooldown.as_secs()
    );

    let state = AppState {
        services: Arc::new(RwLock::new(HashMap::new())),
        events_tx,
        started_at: Arc::new(Instant::now()),
        core_is_down: Arc::new(RwLock::new(false)),
        system: Arc::new(RwLock::new(System::new())),
        recovery_mode,
        recovery_threshold,
        recovery_cooldown,
        last_recovery: Arc::new(RwLock::new(HashMap::new())),
        recovery_history: Arc::new(RwLock::new(Vec::new())),
        failed_recoveries: Arc::new(RwLock::new(HashMap::new())),
        notified: Arc::new(RwLock::new(HashMap::new())),
        iora_home_url: std::env::var("IORA_HOME_URL")
            .ok()
            .filter(|v| !v.is_empty()),
        internal_token: std::env::var("IORA_INTERNAL_TOKEN")
            .ok()
            .filter(|v| !v.is_empty()),
    };

    // Start background health checking
    tokio::spawn(health_check_loop(state.clone()));
    tokio::spawn(system_metrics_loop(state.clone()));

    let app = Router::new()
        .route("/health", get(health))
        .route("/health/text", get(health_text))
        .route("/api/watchdog/health", get(health))
        .route("/api/watchdog/health/text", get(health_text))
        .route("/api/watchdog/status", get(get_status))
        .route("/api/watchdog/services", get(list_services).post(register_service))
        .route("/api/watchdog/heartbeat", post(receive_heartbeat))
        .route("/api/watchdog/metrics", get(get_metrics))
        .route("/api/watchdog/events", get(events_stream).post(broadcast_event))
        .route("/api/watchdog/recovery", get(get_recovery_history))
        .layer(CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let port = system_config::service_port("iora-watchdog", 8094).to_string();
    let addr = format!("0.0.0.0:{}", port);

    info!("👁️  iora-watchdog starting on {}", addr);
    info!("Monitoring services every 10 seconds");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-watchdog",
        port.parse::<u16>().unwrap_or(8094),
        "System & service watchdog",
    );
    axum::serve(listener, app).await?;

    Ok(())
}
