// pi.dev Controller – Orchestrates Docker sandbox, plugins, and security
// Full control layer: IORA manages pi.dev lifecycle, monitors activity, enforces policy

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};
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
