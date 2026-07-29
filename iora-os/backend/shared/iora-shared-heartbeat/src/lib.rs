//! Heartbeat / self-registration client used by every IORA service.
//!
//! Goal: make the IORA service mesh dynamic and self-healing. Every
//! service binary embeds a small background task that:
//!
//!   1. Registers itself with `iora-core` on startup (idempotent — the
//!      core upserts on every heartbeat).
//!   2. POSTs a status snapshot (`ServiceHeartbeat`) to
//!      `iora-core` every `IORA_HEARTBEAT_INTERVAL_SECS` seconds (default
//!      5s). The snapshot includes liveness state, uptime, build info,
//!      a free-form message and arbitrary numeric metrics.
//!   3. Survives core outages with bounded exponential backoff so it
//!      never floods the network and never crashes the host service.
//!
//! The receiver side lives in `iora-core` (`/api/core/services/heartbeat`).
//! Combined with the existing reverse-poll in core, this gives bi-directional
//! liveness: services that can reach core but whose `/health` endpoint is
//! firewalled still get observed, and services in a private network segment
//! that core cannot poll still self-announce.
//!
//! Typical wiring inside a service `main()`:
//!
//! ```no_run
//! use iora_shared_heartbeat::{HeartbeatClient, HeartbeatConfig};
//!
//! # async fn run() {
//! let _hb = HeartbeatClient::spawn(HeartbeatConfig {
//!     service_name: "iora-watchdog".into(),
//!     service_url:  "http://127.0.0.1:8094".into(),
//!     description:  "System & service watchdog".into(),
//!     ..HeartbeatConfig::default()
//! });
//! # }
//! ```
//!
//! The returned [`HeartbeatHandle`] can be used to push a custom status,
//! attach metrics, or stop the loop on shutdown.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use iora_shared_types::HealthStatus;

/// JSON envelope every service POSTs to
/// `POST {core_url}/api/core/services/heartbeat`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHeartbeat {
    pub name: String,
    pub url: String,
    pub description: String,
    pub version: String,
    pub status: HealthStatus,
    pub message: Option<String>,
    pub uptime_seconds: u64,
    pub pid: u32,
    pub host: String,
    /// Free-form numeric metrics (cpu, mem_mb, queue_len, …). Cheap to
    /// transport, easy to render in the UI, no schema lock-in.
    pub metrics: HashMap<String, f64>,
    pub timestamp: String,
}

/// Configuration for [`HeartbeatClient::spawn`].
#[derive(Debug, Clone)]
pub struct HeartbeatConfig {
    /// Logical service name (must be unique across the mesh).
    pub service_name: String,
    /// URL the service listens on, used by core for reverse health polls.
    pub service_url: String,
    /// Human-readable description (shown in the dashboard).
    pub description: String,
    /// Version string. Defaults to `CARGO_PKG_VERSION` when empty.
    pub version: String,
    /// Core base URL. Honors `$IORA_CORE_URL`, default `http://127.0.0.1:8090`.
    pub core_url: String,
    /// Heartbeat interval. Honors `$IORA_HEARTBEAT_INTERVAL_SECS`,
    /// default 5s. Clamped to [1s, 60s].
    pub interval: Duration,
    /// HTTP timeout per request. Default 3s.
    pub http_timeout: Duration,
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        let interval_secs: u64 = std::env::var("IORA_HEARTBEAT_INTERVAL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5)
            .clamp(1, 60);
        Self {
            service_name: String::new(),
            service_url: String::new(),
            description: String::new(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            core_url: std::env::var("IORA_CORE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8090".to_string()),
            interval: Duration::from_secs(interval_secs),
            http_timeout: Duration::from_secs(3),
        }
    }
}

/// Mutable shared state every heartbeat tick reads from.
#[derive(Debug, Default)]
struct HeartbeatState {
    status: HealthStatus,
    message: Option<String>,
    metrics: HashMap<String, f64>,
    stopped: bool,
}

/// Handle returned by [`HeartbeatClient::spawn`]. Lets the host service
/// adjust the reported status at runtime (e.g. flip to `Degraded` while
/// a critical dependency is reconnecting) and gracefully stop the loop.
#[derive(Clone)]
pub struct HeartbeatHandle {
    state: Arc<RwLock<HeartbeatState>>,
}

impl HeartbeatHandle {
    pub async fn set_status(&self, status: HealthStatus, message: Option<String>) {
        let mut s = self.state.write().await;
        s.status = status;
        s.message = message;
    }

    pub async fn set_metric(&self, key: impl Into<String>, value: f64) {
        let mut s = self.state.write().await;
        s.metrics.insert(key.into(), value);
    }

    pub async fn set_metrics(&self, metrics: HashMap<String, f64>) {
        let mut s = self.state.write().await;
        s.metrics = metrics;
    }

    pub async fn stop(&self) {
        let mut s = self.state.write().await;
        s.stopped = true;
    }
}

/// One-liner helper: spawn a heartbeat with sensible defaults derived
/// from the service name and bound port. The service URL is assumed to
/// be `http://127.0.0.1:{port}` because in IORA OS all services run on
/// the same host as core; override via [`HeartbeatClient::spawn`] if
/// you need something different.
pub fn spawn_default(
    service_name: impl Into<String>,
    port: u16,
    description: impl Into<String>,
) -> HeartbeatHandle {
    HeartbeatClient::spawn(HeartbeatConfig {
        service_name: service_name.into(),
        service_url: format!("http://127.0.0.1:{port}"),
        description: description.into(),
        ..HeartbeatConfig::default()
    })
}

/// Heartbeat client. The actual loop runs in a detached tokio task so
/// services don't have to manage another future.
pub struct HeartbeatClient;

impl HeartbeatClient {
    /// Spawn the background heartbeat task and return a handle.
    pub fn spawn(mut cfg: HeartbeatConfig) -> HeartbeatHandle {
        if cfg.service_name.trim().is_empty() {
            // Fail loud in dev, silent in prod: a nameless heartbeat is
            // useless on the receiver. We log and refuse to spawn.
            tracing::error!("heartbeat: refusing to spawn with empty service_name");
            return HeartbeatHandle {
                state: Arc::new(RwLock::new(HeartbeatState::default())),
            };
        }
        if cfg.version.trim().is_empty() {
            cfg.version = env!("CARGO_PKG_VERSION").to_string();
        }

        let state = Arc::new(RwLock::new(HeartbeatState::default()));
        let handle = HeartbeatHandle {
            state: state.clone(),
        };

        tokio::spawn(run_loop(cfg, state));
        handle
    }
}

async fn run_loop(cfg: HeartbeatConfig, state: Arc<RwLock<HeartbeatState>>) {
    let started = Instant::now();
    let pid = std::process::id();
    let host = hostname().unwrap_or_else(|| "unknown".to_string());

    let client = match reqwest::Client::builder()
        .timeout(cfg.http_timeout)
        .user_agent(format!("iora-heartbeat/{}", cfg.version))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(
                "heartbeat({}): cannot build HTTP client: {e}",
                cfg.service_name
            );
            return;
        }
    };

    let endpoint = format!(
        "{}/api/core/services/heartbeat",
        cfg.core_url.trim_end_matches('/'),
    );

    // Exponential backoff on consecutive failures, capped at 60s. We
    // never crash, never spin: a service should keep working even if
    // core is offline for hours during an upgrade.
    let mut backoff = cfg.interval;
    let max_backoff = Duration::from_secs(60);
    let mut consecutive_failures: u32 = 0;

    tracing::info!(
        "heartbeat({}): every {:?} → {}",
        cfg.service_name,
        cfg.interval,
        endpoint,
    );

    loop {
        // Snapshot mutable state under a short read lock.
        let (status, message, metrics, stopped) = {
            let s = state.read().await;
            (
                s.status.clone(),
                s.message.clone(),
                s.metrics.clone(),
                s.stopped,
            )
        };
        if stopped {
            tracing::info!("heartbeat({}): stopped", cfg.service_name);
            return;
        }

        let beat = ServiceHeartbeat {
            name: cfg.service_name.clone(),
            url: cfg.service_url.clone(),
            description: cfg.description.clone(),
            version: cfg.version.clone(),
            status,
            message,
            uptime_seconds: started.elapsed().as_secs(),
            pid,
            host: host.clone(),
            metrics,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };

        match client.post(&endpoint).json(&beat).send().await {
            Ok(resp) if resp.status().is_success() => {
                if consecutive_failures > 0 {
                    tracing::info!(
                        "heartbeat({}): recovered after {} failed attempts",
                        cfg.service_name,
                        consecutive_failures,
                    );
                }
                consecutive_failures = 0;
                backoff = cfg.interval;
            }
            Ok(resp) => {
                consecutive_failures = consecutive_failures.saturating_add(1);
                let s = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    "heartbeat({}): core responded {s}: {}",
                    cfg.service_name,
                    body.chars().take(200).collect::<String>(),
                );
                backoff = (backoff * 2).min(max_backoff);
            }
            Err(e) => {
                consecutive_failures = consecutive_failures.saturating_add(1);
                // Only log every few failures so we don't spam the journal
                // when core is briefly down.
                if consecutive_failures == 1 || consecutive_failures.is_power_of_two() {
                    tracing::warn!(
                        "heartbeat({}): cannot reach core ({e}); will retry",
                        cfg.service_name,
                    );
                }
                backoff = (backoff * 2).min(max_backoff);
            }
        }

        tokio::time::sleep(backoff).await;
    }
}

fn hostname() -> Option<String> {
    // Prefer `$HOSTNAME` (cheap), fall back to /proc/sys/kernel/hostname
    // on Linux. We deliberately don't pull `gethostname` as a dep here;
    // every service binary already links libc so this is enough.
    if let Ok(h) = std::env::var("HOSTNAME") {
        if !h.trim().is_empty() {
            return Some(h);
        }
    }
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
