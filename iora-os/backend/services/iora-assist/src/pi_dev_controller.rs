// pi.dev Controller – Orchestrates Docker sandbox, plugins, and security
// Full control layer: IORA manages pi.dev lifecycle, monitors activity, enforces policy

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Sub-modules ───────────────────────────────────────────────────────────

pub mod docker_sandbox;
pub mod plugin_manager;
pub mod security_monitor;

use docker_sandbox::{DockerSandbox, SandboxConfig, SandboxStatus};
use plugin_manager::{PluginManager, PluginInfo, PluginTool};
use security_monitor::{SecurityPolicy, SecurityEvent, SecurityMonitor, ActionVerdict};

// ─── Types ─────────────────────────────────────────────────────────────────

/// Pi.dev session configuration passed from the frontend/API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiDevSessionConfig {
    /// Workspace to mount into the container
    pub workspace_id: String,
    pub workspace_path: String,
    /// Docker image for pi.dev (default: pi-dev-agent)
    pub image: String,
    /// API key for pi.dev authentication
    pub api_key: String,
    /// Resource limits
    pub cpu_limit: Option<String>,     // e.g. "2.0"
    pub memory_limit: Option<String>,  // e.g. "4g"
    pub disk_limit: Option<String>,    // e.g. "10g"
    /// Network policy
    pub network_enabled: bool,
    pub allowed_domains: Vec<String>,
    /// Timeout for the entire session
    pub session_timeout_secs: u64,
    /// Security policy level
    pub security_level: SecurityLevel,
    /// Plugins to install
    pub plugins: Vec<PluginConfig>,
    /// Auto-approve file writes within workspace
    pub auto_approve_workspace: bool,
    /// Maximum tool calls per session
    pub max_tool_calls: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SecurityLevel {
    /// Allow all operations within workspace
    Permissive,
    /// Ask for confirmation on destructive operations
    Standard,
    /// Review every file change and command
    Strict,
    /// Read-only, no modifications allowed
    ReadOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfig {
    pub package_name: String,
    pub version: Option<String>,
    pub config: Option<HashMap<String, serde_json::Value>>,
}

/// Status of a pi.dev session
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SessionStatus {
    Creating,
    Running,
    WaitingForApproval { event: SecurityEvent },
    Paused,
    Completed,
    Failed { error: String },
    Terminated,
}

/// A running pi.dev session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiDevSession {
    pub id: String,
    pub workspace_id: String,
    pub status: SessionStatus,
    pub config: PiDevSessionConfig,
    pub sandbox: Option<SandboxStatus>,
    pub installed_plugins: Vec<PluginInfo>,
    pub security_events: Vec<SecurityEvent>,
    pub tool_calls_made: u32,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub docker_container_id: Option<String>,
}

/// Event streamed to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PiDevSessionEvent {
    StatusChanged { session_id: String, status: SessionStatus },
    SecurityAlert { session_id: String, event: SecurityEvent, requires_approval: bool },
    ToolExecuted { session_id: String, tool: String, args_summary: String, result: String },
    Output { session_id: String, line: String },
    PluginInstalled { session_id: String, plugin: PluginInfo },
    Progress { session_id: String, message: String, percent: f32 },
    /// The live bridge state for a session was updated (LocalUp-style monitoring).
    BridgeUpdated { session_id: String, state: BridgeState },
}

// ─── Bridge & Control (LocalUp-style live monitoring + remote control) ───────

/// Version of the IORA pi.dev bridge protocol. Mirrors the LocalUp bridge so
/// the same dashboard semantics apply (live session monitoring + control).
pub const BRIDGE_PROTOCOL_VERSION: &str = "1.0.0";

/// Maximum number of recent file changes retained per session bridge.
const MAX_TRACKED_CHANGES: usize = 500;

/// A single file change observed in the JSONL event stream.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BridgeFileChange {
    pub path: String,
    /// One of "created", "modified", "deleted".
    pub action: String,
    pub timestamp: i64,
}

/// Aggregated session metrics derived from the agent event stream.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BridgeMetrics {
    pub tool_calls: u32,
    pub files_modified: u32,
    pub turns: u32,
    pub messages: u32,
    pub start_time: i64,
    pub last_activity: i64,
}

/// Live, aggregated state of a pi.dev session — the IORA equivalent of the
/// LocalUp "bridge". Built incrementally from the agent's JSON-Lines event
/// stream so the dashboard can observe a running agent in real time.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BridgeState {
    pub session_id: String,
    pub working_dir: String,
    pub model: String,
    pub provider: String,
    /// "idle" | "running" | "paused" | "tool:<name>" | "completed" | "failed".
    pub status: String,
    pub agent_running: bool,
    pub last_message: String,
    pub last_changes: Vec<BridgeFileChange>,
    pub metrics: BridgeMetrics,
    pub extension_version: String,
    pub ts: i64,
}

/// Per-session control flags driven by [`PiDevController::send_control_command`].
#[derive(Debug, Clone, Default)]
struct SessionControl {
    /// When true, new tasks are refused until resumed.
    paused: bool,
    /// Provider/model overrides applied to the next task when none are given.
    provider_override: Option<String>,
    model_override: Option<String>,
    /// Thinking level applied to the next task (passed through to `pi`).
    thinking_override: Option<String>,
}

/// Result of a control command, returned to the API caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlResult {
    pub ok: bool,
    pub command: String,
    pub message: String,
    pub state: Option<BridgeState>,
}

// ─── Main Controller ────────────────────────────────────────────────────────

pub struct PiDevController {
    sessions: Arc<RwLock<HashMap<String, PiDevSession>>>,
    docker: Arc<DockerSandbox>,
    plugins: Arc<PluginManager>,
    security: Arc<SecurityMonitor>,
    event_tx: broadcast::Sender<PiDevSessionEvent>,
    /// Base directory for sandbox workspaces
    sandbox_base: String,
    /// Live per-session bridge state (LocalUp-style monitoring).
    bridges: Arc<RwLock<HashMap<String, BridgeState>>>,
    /// Per-session control flags (pause / model / thinking overrides).
    control: Arc<RwLock<HashMap<String, SessionControl>>>,
}

impl PiDevController {
    pub fn new(sandbox_base: String) -> Self {
        let (tx, _) = broadcast::channel(2048);

        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            docker: Arc::new(DockerSandbox::new()),
            plugins: Arc::new(PluginManager::new()),
            security: Arc::new(SecurityMonitor::new()),
            event_tx: tx,
            sandbox_base,
            bridges: Arc::new(RwLock::new(HashMap::new())),
            control: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PiDevSessionEvent> {
        self.event_tx.subscribe()
    }

    /// Create and start a new pi.dev session in a Docker container
    pub async fn create_session(
        self: &Arc<Self>,
        config: PiDevSessionConfig,
    ) -> Result<PiDevSession, String> {
        let session_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        // 1. Validate config
        if config.session_timeout_secs == 0 || config.session_timeout_secs > 86400 {
            return Err("Session timeout must be between 1 and 86400 seconds".into());
        }

        // 2. Create security policy
        let policy = self.security.create_policy(&config);

        // 3. Install required plugins (metadata only – actual install in container)
        let mut installed_plugins = Vec::new();
        for plugin_cfg in &config.plugins {
            match self.plugins.resolve_plugin(plugin_cfg).await {
                Ok(info) => installed_plugins.push(info),
                Err(e) => warn!("Failed to resolve plugin {}: {}", plugin_cfg.package_name, e),
            }
        }

        // 4. Configure and create Docker sandbox
        let sandbox_config = SandboxConfig {
            image: config.image.clone(),
            workspace_path: config.workspace_path.clone(),
            sandbox_base: self.sandbox_base.clone(),
            api_key: config.api_key.clone(),
            cpu_limit: config.cpu_limit.clone(),
            memory_limit: config.memory_limit.clone(),
            network_enabled: config.network_enabled,
            allowed_domains: config.allowed_domains.clone(),
            session_timeout_secs: config.session_timeout_secs,
            plugin_packages: installed_plugins.iter()
                .map(|p| p.package_name.clone())
                .collect(),
            security_policy: policy.clone(),
        };

        // 5. Build session object
        let session = PiDevSession {
            id: session_id.clone(),
            workspace_id: config.workspace_id.clone(),
            status: SessionStatus::Creating,
            config: config.clone(),
            sandbox: None,
            installed_plugins: installed_plugins.clone(),
            security_events: Vec::new(),
            tool_calls_made: 0,
            started_at: now,
            docker_container_id: None,
        };

        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session.clone());
        }

        // 6. Spawn container creation in background
        let this = self.clone();
        let sid = session_id.clone();
        tokio::spawn(async move {
            match this.docker.create_container(&sandbox_config).await {
                Ok(container_id) => {
                    info!("Pi.dev container {} created for session {}", container_id, sid);
                    this.update_session(&sid, |s| {
                        s.docker_container_id = Some(container_id.clone());
                        s.status = SessionStatus::Running;
                    }).await;

                    let _ = this.event_tx.send(PiDevSessionEvent::StatusChanged {
                        session_id: sid.clone(),
                        status: SessionStatus::Running,
                    });

                    // Monitor container health
                    this.monitor_container(&sid, &container_id).await;
                }
                Err(e) => {
                    error!("Failed to create pi.dev container: {}", e);
                    this.update_session(&sid, |s| {
                        s.status = SessionStatus::Failed { error: e.clone() };
                    }).await;

                    let _ = this.event_tx.send(PiDevSessionEvent::StatusChanged {
                        session_id: sid,
                        status: SessionStatus::Failed { error: e },
                    });
                }
            }
        });

        Ok(session)
    }

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Option<PiDevSession> {
        self.sessions.read().await.get(session_id).cloned()
    }

    /// List all active sessions
    pub async fn list_sessions(&self) -> Vec<PiDevSession> {
        self.sessions.read().await.values().cloned().collect()
    }

    /// Stop a running session (graceful shutdown)
    pub async fn stop_session(&self, session_id: &str) -> Result<(), String> {
        let container_id = {
            let sessions = self.sessions.read().await;
            sessions.get(session_id)
                .and_then(|s| s.docker_container_id.clone())
        };

        if let Some(cid) = container_id {
            self.docker.stop_container(&cid).await?;
        }

        self.update_session(session_id, |s| {
            s.status = SessionStatus::Terminated;
        }).await;

        let _ = self.event_tx.send(PiDevSessionEvent::StatusChanged {
            session_id: session_id.to_string(),
            status: SessionStatus::Terminated,
        });

        Ok(())
    }

    /// Approve a security-sensitive action
    pub async fn approve_action(
        &self,
        session_id: &str,
        event_id: &str,
    ) -> Result<(), String> {
        let session = self.get_session(session_id)
            .await
            .ok_or("Session not found")?;

        self.security.approve(session_id, event_id).await?;

        self.update_session(session_id, |s| {
            s.status = SessionStatus::Running;
        }).await;

        let _ = self.event_tx.send(PiDevSessionEvent::StatusChanged {
            session_id: session_id.to_string(),
            status: SessionStatus::Running,
        });

        Ok(())
    }

    /// Deny a security-sensitive action
    pub async fn deny_action(
        &self,
        session_id: &str,
        event_id: &str,
    ) -> Result<(), String> {
        self.security.deny(session_id, event_id).await?;

        let _ = self.event_tx.send(PiDevSessionEvent::SecurityAlert {
            session_id: session_id.to_string(),
            event: SecurityEvent {
                id: event_id.to_string(),
                event_type: "denied".to_string(),
                description: "Action denied by user".to_string(),
                severity: "info".to_string(),
                timestamp: chrono::Utc::now(),
                metadata: HashMap::new(),
            },
            requires_approval: false,
        });

        Ok(())
    }

    /// Get installed plugins for a session
    pub async fn get_session_plugins(&self, session_id: &str) -> Vec<PluginInfo> {
        self.sessions.read().await
            .get(session_id)
            .map(|s| s.installed_plugins.clone())
            .unwrap_or_default()
    }

    /// List available plugins from pi.dev registry
    pub async fn list_available_plugins(&self) -> Vec<PluginInfo> {
        self.plugins.list_default_plugins().await
    }

    /// Get security events for a session
    pub async fn get_security_events(&self, session_id: &str) -> Vec<SecurityEvent> {
        self.sessions.read().await
            .get(session_id)
            .map(|s| s.security_events.clone())
            .unwrap_or_default()
    }

    /// Run a one-shot pi.dev agent task inside the session's container using the
    /// real `pi --mode json` CLI. Each emitted JSON-Lines event is parsed and
    /// rebroadcast as a [`PiDevSessionEvent`], and every tool call is evaluated
    /// against the session's security policy. A hard denial terminates the
    /// session; an approval-required verdict raises a [`SecurityAlert`].
    ///
    /// `provider`/`model` select the model backend (e.g. `ora` for IORA Assist,
    /// or `anthropic`/`openai`/`google`). They are passed through to `pi`.
    pub async fn run_task(
        self: &Arc<Self>,
        session_id: &str,
        prompt: &str,
        provider: Option<String>,
        model: Option<String>,
    ) -> Result<Option<i64>, String> {
        let session = self.get_session(session_id).await.ok_or("Session not found")?;
        let container_id = session
            .docker_container_id
            .clone()
            .ok_or("Session container is not running yet")?;

        // Honour control flags: refuse new tasks while paused and fall back to
        // any provider/model overrides set via `send_control_command`. The
        // thinking-level override only applies to interactive sessions and is
        // surfaced through the bridge, not the headless CLI.
        let (provider, model) = {
            let control = self.control.read().await;
            let ctl = control.get(session_id).cloned().unwrap_or_default();
            if ctl.paused {
                return Err("Session is paused — resume before running a task".into());
            }
            (
                provider.or(ctl.provider_override.clone()),
                model.or(ctl.model_override.clone()),
            )
        };

        // Initialise / refresh the live bridge state for this run.
        self.init_bridge(session_id, &session, provider.as_deref(), model.as_deref())
            .await;

        // Build the enforcement policy from the session configuration.
        let policy = self.security.create_policy(&session.config);

        let (line_tx, mut line_rx) = mpsc::unbounded_channel::<String>();

        // Consume parsed JSONL lines concurrently while the agent runs.
        let consumer = {
            let this = self.clone();
            let sid = session_id.to_string();
            tokio::spawn(async move {
                while let Some(line) = line_rx.recv().await {
                    this.handle_pi_line(&sid, &policy, &line).await;
                }
            })
        };

        let result = self
            .docker
            .run_pi_task(
                &container_id,
                prompt,
                provider.as_deref(),
                model.as_deref(),
                line_tx,
            )
            .await;

        // `line_tx` is dropped when `run_pi_task` returns; the consumer then ends.
        let _ = consumer.await;

        match result {
            Ok(code) => {
                let status = if code.unwrap_or(0) == 0 {
                    SessionStatus::Completed
                } else {
                    SessionStatus::Failed {
                        error: format!("pi exited with code {:?}", code),
                    }
                };
                let status_for_event = status.clone();
                self.update_session(session_id, |s| {
                    s.status = status;
                })
                .await;
                let _ = self.event_tx.send(PiDevSessionEvent::StatusChanged {
                    session_id: session_id.to_string(),
                    status: status_for_event,
                });
                Ok(code)
            }
            Err(e) => {
                let err = e.clone();
                self.update_session(session_id, |s| {
                    s.status = SessionStatus::Failed { error: err };
                })
                .await;
                let _ = self.event_tx.send(PiDevSessionEvent::StatusChanged {
                    session_id: session_id.to_string(),
                    status: SessionStatus::Failed { error: e.clone() },
                });
                Err(e)
            }
        }
    }

    /// Parse a single line of `pi --mode json` output and broadcast the
    /// corresponding session event, enforcing the security policy on tool calls.
    async fn handle_pi_line(
        self: &Arc<Self>,
        session_id: &str,
        policy: &SecurityPolicy,
        line: &str,
    ) {
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                // Non-JSON output (e.g. plain logs) — forward verbatim.
                let _ = self.event_tx.send(PiDevSessionEvent::Output {
                    session_id: session_id.to_string(),
                    line: line.to_string(),
                });
                return;
            }
        };

        let event_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match event_type {
            "tool_execution_start" => {
                let tool = value
                    .get("tool")
                    .and_then(|t| t.as_str())
                    .or_else(|| value.get("name").and_then(|t| t.as_str()))
                    .unwrap_or("unknown");
                let args = value
                    .get("arguments")
                    .cloned()
                    .or_else(|| value.get("args").cloned())
                    .unwrap_or_else(|| serde_json::json!({}));

                self.update_session(session_id, |s| s.tool_calls_made += 1).await;

                // Update the live bridge: count the tool call, surface the
                // active tool as status, and track file mutations.
                let file_change = file_change_from_tool(tool, &args);
                self.update_bridge(session_id, |b| {
                    b.metrics.tool_calls += 1;
                    b.metrics.last_activity = now_millis();
                    b.status = format!("tool:{}", tool);
                    if let Some(fc) = &file_change {
                        b.metrics.files_modified += 1;
                        b.last_changes.push(fc.clone());
                        if b.last_changes.len() > MAX_TRACKED_CHANGES {
                            let overflow = b.last_changes.len() - MAX_TRACKED_CHANGES;
                            b.last_changes.drain(0..overflow);
                        }
                    }
                })
                .await;

                let verdict: ActionVerdict = self
                    .security
                    .evaluate_action(session_id, policy, tool, &args)
                    .await;

                if verdict.allowed {
                    let _ = self.event_tx.send(PiDevSessionEvent::ToolExecuted {
                        session_id: session_id.to_string(),
                        tool: tool.to_string(),
                        args_summary: summarize_args(&args),
                        result: "started".to_string(),
                    });
                } else {
                    let event = SecurityEvent {
                        id: verdict
                            .event_id
                            .clone()
                            .unwrap_or_else(|| Uuid::new_v4().to_string()),
                        event_type: if verdict.requires_approval {
                            "requires_approval".to_string()
                        } else {
                            "denied".to_string()
                        },
                        description: verdict
                            .reason
                            .clone()
                            .unwrap_or_else(|| format!("Tool '{}' blocked by policy", tool)),
                        severity: if verdict.requires_approval {
                            "medium".to_string()
                        } else {
                            "high".to_string()
                        },
                        timestamp: chrono::Utc::now(),
                        metadata: HashMap::new(),
                    };
                    self.update_session(session_id, |s| {
                        s.security_events.push(event.clone());
                    })
                    .await;
                    let _ = self.event_tx.send(PiDevSessionEvent::SecurityAlert {
                        session_id: session_id.to_string(),
                        event,
                        requires_approval: verdict.requires_approval,
                    });

                    // Hard denial → terminate the session for safety.
                    if !verdict.requires_approval {
                        warn!(
                            "Terminating session {} due to denied tool '{}'",
                            session_id, tool
                        );
                        let _ = self.stop_session(session_id).await;
                    }
                }
            }
            "tool_execution_end" => {
                let tool = value
                    .get("tool")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");
                let result = value
                    .get("result")
                    .and_then(|r| r.as_str())
                    .unwrap_or("completed");
                self.update_bridge(session_id, |b| {
                    b.status = "running".to_string();
                    b.metrics.last_activity = now_millis();
                })
                .await;
                let _ = self.event_tx.send(PiDevSessionEvent::ToolExecuted {
                    session_id: session_id.to_string(),
                    tool: tool.to_string(),
                    args_summary: String::new(),
                    result: truncate(result, 500),
                });
            }
            "message_end" => {
                if let Some(content) = extract_message_text(&value) {
                    self.update_bridge(session_id, |b| {
                        b.metrics.messages += 1;
                        b.metrics.turns += 1;
                        b.last_message = truncate(&content, 500);
                        b.metrics.last_activity = now_millis();
                    })
                    .await;
                    let _ = self.event_tx.send(PiDevSessionEvent::Output {
                        session_id: session_id.to_string(),
                        line: content,
                    });
                }
            }
            "agent_start" => {
                self.update_bridge(session_id, |b| {
                    b.agent_running = true;
                    b.status = "running".to_string();
                    b.metrics.last_activity = now_millis();
                })
                .await;
                let _ = self.event_tx.send(PiDevSessionEvent::Progress {
                    session_id: session_id.to_string(),
                    message: "Agent started".to_string(),
                    percent: 0.0,
                });
            }
            "agent_end" => {
                self.update_bridge(session_id, |b| {
                    b.agent_running = false;
                    b.status = "idle".to_string();
                    b.metrics.last_activity = now_millis();
                })
                .await;
                let _ = self.event_tx.send(PiDevSessionEvent::Progress {
                    session_id: session_id.to_string(),
                    message: "Agent finished".to_string(),
                    percent: 100.0,
                });
            }
            other => {
                // Forward unrecognised events verbatim for transparency.
                let _ = self.event_tx.send(PiDevSessionEvent::Output {
                    session_id: session_id.to_string(),
                    line: format!("[{}] {}", other, line),
                });
            }
        }
    }

    // ─── Bridge & Control ────────────────────────────────────────────────────

    /// Return the live bridge state for a session, if one exists.
    pub async fn bridge_state(&self, session_id: &str) -> Option<BridgeState> {
        self.bridges.read().await.get(session_id).cloned()
    }

    /// Create (or reset) the bridge state for a session at the start of a task.
    async fn init_bridge(
        &self,
        session_id: &str,
        session: &PiDevSession,
        provider: Option<&str>,
        model: Option<&str>,
    ) {
        let now = now_millis();
        let state = BridgeState {
            session_id: session_id.to_string(),
            working_dir: session.config.workspace_path.clone(),
            model: model.unwrap_or("").to_string(),
            provider: provider.unwrap_or("").to_string(),
            status: "running".to_string(),
            agent_running: true,
            last_message: String::new(),
            last_changes: Vec::new(),
            metrics: BridgeMetrics {
                tool_calls: 0,
                files_modified: 0,
                turns: 0,
                messages: 0,
                start_time: now,
                last_activity: now,
            },
            extension_version: BRIDGE_PROTOCOL_VERSION.to_string(),
            ts: now,
        };
        self.bridges
            .write()
            .await
            .insert(session_id.to_string(), state.clone());
        let _ = self.event_tx.send(PiDevSessionEvent::BridgeUpdated {
            session_id: session_id.to_string(),
            state,
        });
    }

    /// Mutate the bridge state for a session and broadcast the new snapshot.
    async fn update_bridge<F>(&self, session_id: &str, f: F)
    where
        F: FnOnce(&mut BridgeState),
    {
        let snapshot = {
            let mut bridges = self.bridges.write().await;
            let entry = bridges.entry(session_id.to_string()).or_insert_with(|| {
                let now = now_millis();
                BridgeState {
                    session_id: session_id.to_string(),
                    extension_version: BRIDGE_PROTOCOL_VERSION.to_string(),
                    metrics: BridgeMetrics {
                        start_time: now,
                        last_activity: now,
                        ..Default::default()
                    },
                    ts: now,
                    ..Default::default()
                }
            });
            f(entry);
            entry.ts = now_millis();
            entry.clone()
        };
        let _ = self.event_tx.send(PiDevSessionEvent::BridgeUpdated {
            session_id: session_id.to_string(),
            state: snapshot,
        });
    }

    /// Apply a LocalUp-style control command to a session. Supports
    /// `ping`, `pause`, `resume`, `set_model`, `set_thinking`, `get_state`,
    /// `reset`, and `cancel`.
    pub async fn send_control_command(
        self: &Arc<Self>,
        session_id: &str,
        command: &str,
        model: Option<String>,
        thinking: Option<String>,
    ) -> Result<ControlResult, String> {
        // The session must exist (the bridge may not yet — that is fine).
        if self.get_session(session_id).await.is_none() {
            return Err("Session not found".into());
        }

        let cmd = command.trim().to_lowercase();
        let mut message = String::new();

        match cmd.as_str() {
            "ping" => {
                let healthy = self.bridges.read().await.contains_key(session_id);
                message = if healthy {
                    "pong — IORA bridge active".to_string()
                } else {
                    "pong — no active task on this session".to_string()
                };
            }
            "pause" => {
                self.control
                    .write()
                    .await
                    .entry(session_id.to_string())
                    .or_default()
                    .paused = true;
                self.update_bridge(session_id, |b| b.status = "paused".to_string())
                    .await;
                message = "Session paused — new tasks will be refused until resumed".to_string();
            }
            "resume" => {
                self.control
                    .write()
                    .await
                    .entry(session_id.to_string())
                    .or_default()
                    .paused = false;
                self.update_bridge(session_id, |b| {
                    if b.status == "paused" {
                        b.status = "idle".to_string();
                    }
                })
                .await;
                message = "Session resumed".to_string();
            }
            "set_model" => {
                let m = model
                    .clone()
                    .ok_or("set_model requires a 'model' value")?;
                self.control
                    .write()
                    .await
                    .entry(session_id.to_string())
                    .or_default()
                    .model_override = Some(m.clone());
                self.update_bridge(session_id, |b| b.model = m.clone()).await;
                message = format!("Model override set to {}", m);
            }
            "set_thinking" => {
                let t = thinking
                    .clone()
                    .ok_or("set_thinking requires a 'thinking' value")?;
                self.control
                    .write()
                    .await
                    .entry(session_id.to_string())
                    .or_default()
                    .thinking_override = Some(t.clone());
                message = format!("Thinking level override set to {}", t);
            }
            "get_state" => {
                message = "Current bridge state retrieved".to_string();
            }
            "reset" => {
                self.bridges.write().await.remove(session_id);
                if let Some(ctl) = self.control.write().await.get_mut(session_id) {
                    ctl.model_override = None;
                    ctl.thinking_override = None;
                    ctl.provider_override = None;
                }
                message = "Bridge state reset".to_string();
            }
            "cancel" => {
                self.stop_session(session_id).await?;
                self.update_bridge(session_id, |b| {
                    b.agent_running = false;
                    b.status = "terminated".to_string();
                })
                .await;
                message = "Session cancelled".to_string();
            }
            other => {
                return Err(format!("Unknown control command: {}", other));
            }
        }

        Ok(ControlResult {
            ok: true,
            command: cmd,
            message,
            state: self.bridge_state(session_id).await,
        })
    }

    // ─── Internal helpers ───────────────────────────────────────────────────

    async fn update_session<F>(&self, session_id: &str, f: F)
    where F: FnOnce(&mut PiDevSession)
    {
        let mut sessions = self.sessions.write().await;
        if let Some(s) = sessions.get_mut(session_id) {
            f(s);
        }
    }

    async fn monitor_container(&self, session_id: &str, container_id: &str) {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        let timeout = {
            let sessions = self.sessions.read().await;
            sessions.get(session_id)
                .map(|s| s.config.session_timeout_secs)
                .unwrap_or(3600)
        };
        let start = Instant::now();

        loop {
            interval.tick().await;

            // Check timeout
            if start.elapsed().as_secs() > timeout {
                warn!("Session {} timed out", session_id);
                let _ = self.stop_session(session_id).await;
                break;
            }

            // Check container health
            match self.docker.container_status(container_id).await {
                Ok(SandboxStatus { running: true, .. }) => {
                    // Container is healthy — continue monitoring
                }
                Ok(SandboxStatus { running: false, error: Some(e), .. }) => {
                    error!("Container {} stopped with error: {}", container_id, e);
                    self.update_session(session_id, |s| {
                        s.status = SessionStatus::Failed { error: e };
                    }).await;
                    break;
                }
                Ok(_) => {
                    // Container stopped normally
                    self.update_session(session_id, |s| {
                        s.status = SessionStatus::Completed;
                    }).await;
                    let _ = self.event_tx.send(PiDevSessionEvent::StatusChanged {
                        session_id: session_id.to_string(),
                        status: SessionStatus::Completed,
                    });
                    break;
                }
                Err(e) => {
                    warn!("Health check failed for container {}: {}", container_id, e);
                }
            }
        }
    }
}

// ─── Helpers for pi.dev JSONL event parsing ─────────────────────────────────

/// Current UNIX time in milliseconds.
fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Detect whether a tool call mutates a file and, if so, derive a
/// [`BridgeFileChange`] describing it. Recognises the common pi.dev file tools
/// (write/edit/create/replace/patch/insert/delete) by name.
fn file_change_from_tool(tool: &str, args: &serde_json::Value) -> Option<BridgeFileChange> {
    let lower = tool.to_lowercase();
    let is_file_tool = ["write", "edit", "create", "replace", "patch", "insert", "delete"]
        .iter()
        .any(|kw| lower.contains(kw));
    if !is_file_tool {
        return None;
    }

    let path = args
        .get("path")
        .or_else(|| args.get("file_path"))
        .or_else(|| args.get("filePath"))
        .or_else(|| args.get("file"))
        .and_then(|p| p.as_str())
        .unwrap_or("")
        .to_string();

    let action = if lower.contains("delete") {
        "deleted"
    } else if lower.contains("create") {
        "created"
    } else {
        "modified"
    };

    Some(BridgeFileChange {
        path,
        action: action.to_string(),
        timestamp: now_millis(),
    })
}

/// Build a short, human-readable summary of a tool call's arguments.
fn summarize_args(args: &serde_json::Value) -> String {
    match args {
        serde_json::Value::Object(map) => {
            let parts: Vec<String> = map
                .iter()
                .take(4)
                .map(|(k, v)| {
                    let val = match v {
                        serde_json::Value::String(s) => truncate(s, 80),
                        other => truncate(&other.to_string(), 80),
                    };
                    format!("{}={}", k, val)
                })
                .collect();
            truncate(&parts.join(", "), 300)
        }
        other => truncate(&other.to_string(), 300),
    }
}

/// Truncate a string to at most `max` characters, appending an ellipsis marker.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{}…", truncated)
    }
}

/// Extract the assistant text content from a pi.dev `message_end` event.
fn extract_message_text(value: &serde_json::Value) -> Option<String> {
    // Common shapes: { message: { content: "..." } } or
    // { message: { content: [ { type: "text", text: "..." } ] } }
    let content = value
        .get("message")
        .and_then(|m| m.get("content"))
        .or_else(|| value.get("content"))?;

    match content {
        serde_json::Value::String(s) => {
            let t = s.trim();
            (!t.is_empty()).then(|| t.to_string())
        }
        serde_json::Value::Array(items) => {
            let text: String = items
                .iter()
                .filter_map(|item| {
                    item.get("text")
                        .and_then(|t| t.as_str())
                        .or_else(|| item.as_str())
                })
                .collect::<Vec<_>>()
                .join("");
            let t = text.trim();
            (!t.is_empty()).then(|| t.to_string())
        }
        _ => None,
    }
}

// ─── Default plugins ───────────────────────────────────────────────────────

impl PluginManager {
    /// Returns the default plugins that should always be available
    pub async fn list_default_plugins(&self) -> Vec<PluginInfo> {
        vec![
            PluginInfo {
                package_name: "pi-subagents".into(),
                display_name: "Subagents".into(),
                version: "latest".into(),
                description: "Delegate work to subagents with single-agent, chain, parallel, and async workflows".into(),
                tools: vec![
                    PluginTool {
                        name: "subagent".into(),
                        description: "Delegate work to builtin or custom subagents".into(),
                        parameters: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "agent": {"type": "string", "description": "Agent name"},
                                "task": {"type": "string", "description": "Task description"}
                            },
                            "required": ["agent", "task"]
                        }),
                    },
                ],
                registry_url: "https://pi.dev/packages/pi-subagents".into(),
            },
            PluginInfo {
                package_name: "pi-web-access".into(),
                display_name: "Web Access".into(),
                version: "latest".into(),
                description: "Web search and content fetching with evidence-backed answers".into(),
                tools: vec![
                    PluginTool {
                        name: "web_search".into(),
                        description: "Search the web using multiple AI providers".into(),
                        parameters: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "queries": {"type": "array", "items": {"type": "string"}}
                            },
                            "required": ["queries"]
                        }),
                    },
                    PluginTool {
                        name: "fetch_content".into(),
                        description: "Fetch URL(s) and extract readable content".into(),
                        parameters: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "url": {"type": "string"},
                                "urls": {"type": "array", "items": {"type": "string"}}
                            }
                        }),
                    },
                ],
                registry_url: "https://pi.dev/packages/pi-web-access".into(),
            },
            PluginInfo {
                package_name: "@juicesharp/rpiv-todo".into(),
                display_name: "Todo".into(),
                version: "latest".into(),
                description: "Task list for tracking multi-step progress with status management".into(),
                tools: vec![
                    PluginTool {
                        name: "todo".into(),
                        description: "Manage a task list for tracking multi-step progress".into(),
                        parameters: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "action": {"type": "string", "enum": ["create", "update", "list", "get", "delete", "clear"]},
                                "subject": {"type": "string"},
                                "status": {"type": "string", "enum": ["pending", "in_progress", "completed", "deleted"]}
                            },
                            "required": ["action"]
                        }),
                    },
                ],
                registry_url: "https://pi.dev/packages/@juicesharp/rpiv-todo".into(),
            },
            PluginInfo {
                package_name: "@juicesharp/rpiv-ask-user-question".into(),
                display_name: "Ask User Question".into(),
                version: "latest".into(),
                description: "Ask the user structured questions when requirements are ambiguous".into(),
                tools: vec![
                    PluginTool {
                        name: "ask_user_question".into(),
                        description: "Ask the user one or more structured questions during execution".into(),
                        parameters: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "questions": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "question": {"type": "string"},
                                            "header": {"type": "string", "maxLength": 12},
                                            "options": {"type": "array", "items": {"type": "object"}},
                                            "multiSelect": {"type": "boolean"}
                                        }
                                    }
                                }
                            },
                            "required": ["questions"]
                        }),
                    },
                ],
                registry_url: "https://pi.dev/packages/@juicesharp/rpiv-ask-user-question".into(),
            },
        ]
    }
}
