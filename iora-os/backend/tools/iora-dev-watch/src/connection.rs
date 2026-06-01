//! Persistent bridge connection for iora-dev-watch.
//!
//! Replaces ad-hoc SSH polling with a dual-channel approach:
//!   1. HTTP to `iora-dev-bridge` (port 8101) for status, health, SSE events
//!   2. SSH only for heavy operations (build, deploy, rsync)
//!
//! The SSE stream from `/dev/events` provides a heartbeat every 5 seconds,
//! giving us a real-time connection monitor without SSH overhead.
//!
//! On disconnect, the connection manager retries with exponential backoff
//! (1s → 2s → 4s → ... → 60s max), then stays at 60s intervals forever.
//! This ensures the watcher always reconnects, even after long VM downtime.
#![allow(dead_code)]

use anyhow::{Context, Result};
use reqwest::Client as HttpClient;
use serde::Deserialize;
use std::time::Duration;
use tokio::sync::mpsc;

// ═══════════════════════════════════════════════════════════════════════════
// Bridge API types
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct BridgeStatus {
    pub dev_mode: bool,
    pub variant: String,
    pub build: String,
    pub hostname: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum BridgeEvent {
    #[allow(dead_code)]
    Heartbeat {
        uptime_seconds: u64,
        #[allow(dead_code)]
        build: String,
        #[allow(dead_code)]
        timestamp: u64,
        mem_available_bytes: u64,
        loadavg: String,
    },
    #[allow(dead_code)]
    ServiceStatus {
        name: String,
        status: String,
        #[allow(dead_code)]
        timestamp: u64,
    },
    #[allow(dead_code)]
    LogMessage {
        service: String,
        message: String,
        timestamp: u64,
    },
    #[serde(other)]
    Unknown,
}

// ═══════════════════════════════════════════════════════════════════════════
// Connection manager
// ═══════════════════════════════════════════════════════════════════════════

/// Events emitted by the bridge connection manager.
#[derive(Debug, Clone)]
pub enum ConnEvent {
    /// Bridge is reachable and responding. Carries status info.
    Online {
        build: String,
        hostname: String,
    },
    /// Bridge connection was lost.
    Offline,
    /// Persistent SSH master session is established.
    SshOnline,
    /// Persistent SSH master session was lost (auto-reconnecting).
    SshOffline,
    /// Heartbeat received (every ~5s). Proves the connection is alive.
    Heartbeat {
        uptime_seconds: u64,
        mem_available_bytes: u64,
        loadavg: String,
    },
    /// Bridge event stream had an error (recovered or recovering).
    Error(String),
}

/// Persistent bridge connection manager.
///
/// Spawns a background task that:
/// 1. Connects to the SSE event stream at `/dev/events`
/// 2. Parses heartbeat and status events
/// 3. On disconnect, retries with exponential backoff
/// 4. Emits `ConnEvent`s to the provided channel
pub struct BridgeConnection {
    /// Signal to stop the background task.
    cancel: tokio::sync::watch::Sender<bool>,
}

impl BridgeConnection {
    /// Start a persistent bridge connection.
    ///
    /// `host` is the VM host (e.g. "127.0.0.1").
    /// `port` is the bridge port (default 8101).
    /// `tx` is the channel to emit events to.
    pub fn start(
        host: String,
        port: u16,
        tx: mpsc::UnboundedSender<ConnEvent>,
    ) -> Self {
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

        tokio::spawn(async move {
            connection_loop(host, port, tx, cancel_rx).await;
        });

        Self { cancel: cancel_tx }
    }

    /// Stop the connection (drops the background task on next iteration).
    #[allow(dead_code)]
    pub fn stop(&self) {
        let _ = self.cancel.send(true);
    }
}

impl Drop for BridgeConnection {
    fn drop(&mut self) {
        let _ = self.cancel.send(true);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Single health check (fast, used as initial probe)
// ═══════════════════════════════════════════════════════════════════════════

/// Perform a one-shot health check against the bridge.
/// Returns Ok(()) if the bridge responds within the timeout.
pub async fn health_check(host: &str, port: u16) -> Result<()> {
    let url = format!("http://{host}:{port}/dev/health");
    let client = HttpClient::builder()
        .timeout(Duration::from_secs(3))
        .build()?;
    let resp = client.get(&url).send().await.context("health check request")?;
    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("health check returned {}", resp.status());
    }
}

/// Fetch full bridge status.
pub async fn bridge_status(host: &str, port: u16) -> Result<BridgeStatus> {
    let url = format!("http://{host}:{port}/dev/status");
    let client = HttpClient::builder()
        .timeout(Duration::from_secs(5))
        .build()?;
    let resp = client.get(&url).send().await.context("status request")?;
    if !resp.status().is_success() {
        anyhow::bail!("status returned {}", resp.status());
    }
    Ok(resp.json().await.context("parsing status")?)
}

// ═══════════════════════════════════════════════════════════════════════════
// SSE connection loop with exponential backoff
// ═══════════════════════════════════════════════════════════════════════════

async fn connection_loop(
    host: String,
    port: u16,
    tx: mpsc::UnboundedSender<ConnEvent>,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    // Start with a fast health check to confirm the bridge is alive.
    let url = format!("http://{host}:{port}/dev/events");

    // Backoff state
    let mut backoff_secs: u64 = 1;
    const MAX_BACKOFF: u64 = 60;

    loop {
        // Check if we should stop
        if cancel.borrow().clone() || cancel.has_changed().unwrap_or(false) {
            if *cancel.borrow() {
                return;
            }
        }

        // Attempt to connect to the SSE stream
        match connect_sse_stream(&url).await {
            Ok(mut stream_events) => {
                // Connected! Reset backoff, emit online event, stream events.
                backoff_secs = 1;

                // Fetch status for the Online event
                let online_info = bridge_status(&host, port).await;
                match online_info {
                    Ok(st) => {
                        let _ = tx.send(ConnEvent::Online {
                            build: st.build,
                            hostname: st.hostname,
                        });
                    }
                    Err(_) => {
                        // Still emit online — the SSE connected, so bridge is alive.
                        let _ = tx.send(ConnEvent::Online {
                            build: "unknown".into(),
                            hostname: "unknown".into(),
                        });
                    }
                }

                // Read SSE events until disconnect
                loop {
                    tokio::select! {
                        _ = cancel.changed() => {
                            if *cancel.borrow() {
                                let _ = tx.send(ConnEvent::Offline);
                                return;
                            }
                        }
                        event = stream_events.recv() => {
                            match event {
                                Some(BridgeEvent::Heartbeat { uptime_seconds, mem_available_bytes, loadavg, .. }) => {
                                    let _ = tx.send(ConnEvent::Heartbeat {
                                        uptime_seconds,
                                        mem_available_bytes,
                                        loadavg,
                                    });
                                }
                                Some(BridgeEvent::ServiceStatus { name, status, .. }) => {
                                    // Forward service status for the status view
                                    let _ = tx.send(ConnEvent::Error(
                                        format!("service {name} is {status}")
                                    ));
                                }
                                Some(_) => {
                                    // Ignore unknown/log events for now
                                }
                                None => {
                                    // Channel closed — SSE stream disconnected
                                    break;
                                }
                            }
                        }
                    }
                }

                // Stream disconnected — emit offline
                let _ = tx.send(ConnEvent::Offline);
            }
            Err(e) => {
                // Connection failed — emit error, wait, retry
                let _ = tx.send(ConnEvent::Error(format!(
                    "Bridge connection failed (retry in {backoff_secs}s): {e}"
                )));
                let _ = tx.send(ConnEvent::Offline);
            }
        }

        // Wait with backoff before retrying
        let wait = Duration::from_secs(backoff_secs);
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    return;
                }
            }
            _ = tokio::time::sleep(wait) => {}
        }

        // Increase backoff (capped)
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF);
    }
}

/// Connect to the bridge SSE stream and return a receiver for parsed events.
///
/// Uses a long-lived connection — the bridge sends heartbeats every 5 seconds.
/// Parses SSE text/event-stream lines into structured BridgeEvent values.
async fn connect_sse_stream(
    url: &str,
) -> Result<tokio::sync::mpsc::Receiver<BridgeEvent>> {
    use tokio_stream::StreamExt;

    let client = HttpClient::builder()
        // Short timeout for the initial connect; body reads are unbounded.
        .timeout(Duration::from_secs(10))
        .build()?;

    let resp = client
        .get(url)
        .send()
        .await
        .context("SSE connect")?;

    if !resp.status().is_success() {
        anyhow::bail!("SSE stream returned {}", resp.status());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<BridgeEvent>(64);

    tokio::spawn(async move {
        // bytes_stream gives us chunks; we accumulate into a line buffer.
        let mut byte_stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut current_data = String::new();

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = match chunk_result {
                Ok(b) => b,
                Err(_) => break,
            };

            buf.extend_from_slice(&chunk);

            // Process complete lines from the buffer
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line_bytes = &buf[..pos];
                let line = String::from_utf8_lossy(line_bytes)
                    .trim_end_matches('\r')
                    .to_string();
                buf.drain(..=pos);

                if line.is_empty() {
                    // Empty line = end of SSE event
                    if !current_data.is_empty() {
                        if let Ok(event) = serde_json::from_str::<BridgeEvent>(&current_data) {
                            if tx.send(event).await.is_err() {
                                return; // receiver dropped
                            }
                        }
                        current_data.clear();
                    }
                } else if let Some(data) = line.strip_prefix("data:") {
                    let trimmed = data.trim();
                    if !current_data.is_empty() {
                        current_data.push('\n');
                    }
                    current_data.push_str(trimmed);
                }
                // Ignore other SSE fields (event:, id:, retry:, :)
            }
        }

        // Flush any remaining partial data
        if !current_data.is_empty() {
            if let Ok(event) = serde_json::from_str::<BridgeEvent>(&current_data) {
                let _ = tx.send(event).await;
            }
        }
    });

    Ok(rx)
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistent SSH master session
// ═══════════════════════════════════════════════════════════════════════════

/// A persistent SSH master connection.
///
/// Opens `ssh -M -N` to keep a dedicated, long-lived SSH tunnel to the VM.
/// While this session is alive:
///   - The watcher has a second, independent health indicator (on top of the bridge)
///   - All other SSH commands (build, deploy, rsync) multiplex over this
///     master connection, eliminating the ~100-200ms handshake per command
///
/// On disconnect, retries with exponential backoff (same pattern as the bridge).
pub struct SshSession {
    cancel: tokio::sync::watch::Sender<bool>,
}

impl SshSession {
    /// Start a persistent SSH master session.
    ///
    /// `host` — VM host (e.g. "127.0.0.1")
    /// `port` — SSH port (default 2222)
    /// `ssh_key` — path to the private key
    /// `tx` — channel to emit SshOnline/SshOffline events
    pub fn start(
        host: String,
        port: u16,
        ssh_key: std::path::PathBuf,
        tx: mpsc::UnboundedSender<ConnEvent>,
    ) -> Self {
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

        tokio::spawn(async move {
            ssh_master_loop(host, port, ssh_key, tx, cancel_rx).await;
        });

        Self { cancel: cancel_tx }
    }

    #[allow(dead_code)]
    pub fn stop(&self) {
        let _ = self.cancel.send(true);
    }
}

impl Drop for SshSession {
    fn drop(&mut self) {
        let _ = self.cancel.send(true);
    }
}

/// Build SSH arguments for the master connection.
fn ssh_master_args(host: &str, port: u16, ssh_key: &std::path::Path) -> Vec<String> {
    let mut args = vec![
        "-M".into(),          // master mode
        "-N".into(),          // no remote command
        "-o".into(), "StrictHostKeyChecking=no".into(),
        "-o".into(), "UserKnownHostsFile=/dev/null".into(),
        "-o".into(), "IdentitiesOnly=yes".into(),
        "-o".into(), "BatchMode=yes".into(),
        "-o".into(), "ConnectTimeout=10".into(),
        "-o".into(), "ServerAliveInterval=30".into(),
        "-o".into(), "ServerAliveCountMax=10".into(),
        "-o".into(), "TCPKeepAlive=yes".into(),
        "-o".into(), "AddressFamily=inet".into(),
        // Keep master alive even after all client sessions close.
        "-o".into(), "ControlPersist=yes".into(),
        "-o".into(), "LogLevel=ERROR".into(),
    ];

    // ControlPath for multiplexing (Unix only; Windows uses named pipes implicitly).
    #[cfg(unix)]
    {
        let ctl = ssh_control_path();
        args.push("-o".into());
        args.push(format!("ControlPath={ctl}"));
    }

    args.push("-i".into());
    args.push(ssh_key.to_string_lossy().to_string());
    args.push("-p".into());
    args.push(port.to_string());
    args.push(format!("root@{host}"));

    args
}

/// Compute the ControlPath for Unix SSH multiplexing.
/// Mirrors the logic in main.rs `ctl_path()`.
#[cfg(unix)]
fn ssh_control_path() -> String {
    let dir = std::path::PathBuf::from("/tmp/iora-ssh");
    let _ = std::fs::create_dir_all(&dir);
    format!("{}/cm-%C", dir.display())
}

/// Main loop: keep the SSH master alive, reconnect on failure.
async fn ssh_master_loop(
    host: String,
    port: u16,
    ssh_key: std::path::PathBuf,
    tx: mpsc::UnboundedSender<ConnEvent>,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    let mut backoff_secs: u64 = 1;
    const MAX_BACKOFF: u64 = 60;

    // Clean up any stale ControlPath socket before first connect.
    #[cfg(unix)]
    {
        let ctl = ssh_control_path();
        let expanded = expand_ssh_ctl(&host, port, &ctl);
        for p in &expanded {
            let _ = std::fs::remove_file(p);
        }
    }

    loop {
        if *cancel.borrow() {
            return;
        }

        let args = ssh_master_args(&host, port, &ssh_key);

        let mut command = tokio::process::Command::new("ssh");
        command
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        match command.spawn()
        {
            Ok(mut child) => {
                // SSH master is running! Reset backoff, emit online.
                backoff_secs = 1;
                let _ = tx.send(ConnEvent::SshOnline);

                // Wait for the master process to exit.
                let status = tokio::select! {
                    _ = cancel.changed() => {
                        // User requested shutdown — kill master and exit.
                        if *cancel.borrow() {
                            let _ = child.kill().await;
                            return;
                        }
                        continue;
                    }
                    s = child.wait() => s,
                };

                // Master exited.
                let _ = tx.send(ConnEvent::SshOffline);
                let code = status
                    .as_ref()
                    .map(|s| s.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into()))
                    .unwrap_or_else(|e| e.to_string());
                let _ = tx.send(ConnEvent::Error(format!(
                    "SSH master exited (code: {code}), reconnecting in {backoff_secs}s..."
                )));
            }
            Err(e) => {
                let _ = tx.send(ConnEvent::SshOffline);
                let _ = tx.send(ConnEvent::Error(format!(
                    "SSH master failed to start (retry in {backoff_secs}s): {e}"
                )));
            }
        }

        // Wait with backoff before retrying.
        let wait = std::time::Duration::from_secs(backoff_secs);
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    return;
                }
            }
            _ = tokio::time::sleep(wait) => {}
        }

        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF);
    }
}

/// Expand `%C` in the ControlPath to match actual files.
/// SSH uses `%C` as a hash of %l%h%p%r. We just list all cm-* files
/// in /tmp/iora-ssh (our namespace) and clean them all.
#[cfg(unix)]
fn expand_ssh_ctl(_host: &str, _port: u16, template: &str) -> Vec<String> {
    if !template.contains("%C") {
        return vec![template.to_string()];
    }
    let dir = std::path::PathBuf::from("/tmp/iora-ssh");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("cm-"))
            .map(|e| e.path().to_string_lossy().into_owned())
            .collect()
    } else {
        vec![]
    }
}
