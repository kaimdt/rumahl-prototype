// Agent Client Protocol (ACP) – Standardized Agent-to-Agent Communication
//
// Implements a JSON-RPC 2.0 based protocol for:
// - Capability advertisement and discovery
// - Task delegation between agents
// - Streaming message exchange
// - Agent lifecycle management (spawn, monitor, terminate)
//
// ACP is designed to work with both internal subagents and external agent systems.

use std::collections::HashMap;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use uuid::Uuid;

// ─── ACP Core Types ────────────────────────────────────────────────────────

/// Unique agent identifier
pub type AgentId = String;

/// ACP Protocol Version
pub const ACP_VERSION: &str = "1.0.0";

/// Agent capability – what an agent can do
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapability {
    pub name: String,
    pub description: String,
    pub version: String,
    /// Input schema (JSON Schema)
    pub input_schema: Option<serde_json::Value>,
    /// Output schema (JSON Schema)
    pub output_schema: Option<serde_json::Value>,
    /// Estimated cost per invocation (USD)
    pub estimated_cost: Option<f64>,
    /// Average latency in seconds
    pub avg_latency_secs: Option<f64>,
    /// Tags for discovery
    pub tags: Vec<String>,
}

/// Agent registration/membership in the ACP network
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: AgentId,
    pub name: String,
    pub description: String,
    pub version: String,
    /// Agent type: "primary" | "subagent" | "tool" | "external"
    pub agent_type: String,
    /// Capabilities this agent provides
    pub capabilities: Vec<AgentCapability>,
    /// ACP endpoint (URL or channel)
    pub endpoint: String,
    /// Current status
    pub status: AgentStatus,
    /// When the agent joined
    pub joined_at: DateTime<Utc>,
    /// Last heartbeat
    pub last_heartbeat: DateTime<Utc>,
    /// Parent agent ID (for subagents)
    pub parent_id: Option<AgentId>,
    /// Metadata
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Online,
    Busy,
    Idle,
    Offline,
    Error(String),
}

impl AgentStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Online => "online",
            Self::Busy => "busy",
            Self::Idle => "idle",
            Self::Offline => "offline",
            Self::Error(_) => "error",
        }
    }
}

// ─── ACP Messages ──────────────────────────────────────────────────────────

/// ACP Message envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpMessage {
    /// Protocol version
    pub version: String,
    /// Message ID (for request/response correlation)
    pub id: String,
    /// Message type
    pub message_type: AcpMessageType,
    /// Sender agent ID
    pub sender: AgentId,
    /// Target agent ID (None = broadcast)
    pub target: Option<AgentId>,
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    /// Payload
    pub payload: AcpPayload,
    /// Correlation ID (for chained messages)
    pub correlation_id: Option<String>,
    /// TTL in seconds
    pub ttl_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AcpMessageType {
    /// Request-response
    Request,
    Response,
    /// One-way notification
    Notification,
    /// Streaming message (partial result)
    StreamChunk,
    /// Heartbeat
    Heartbeat,
    /// Error response
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method")]
pub enum AcpPayload {
    // ─── Discovery ─────────────────────────────────────────────────
    /// Announce agent capabilities
    #[serde(rename = "acp.announce")]
    Announce {
        agent: AgentInfo,
    },
    /// Discover agents matching criteria
    #[serde(rename = "acp.discover")]
    Discover {
        query: Option<String>,
        capability: Option<String>,
        agent_type: Option<String>,
    },
    /// Discovery result
    #[serde(rename = "acp.discover.result")]
    DiscoverResult {
        agents: Vec<AgentInfo>,
    },

    // ─── Task Delegation ──────────────────────────────────────────
    /// Delegate a task to another agent
    #[serde(rename = "acp.task.delegate")]
    TaskDelegate {
        /// Human-readable description
        description: String,
        /// Structured task specification
        task: serde_json::Value,
        /// Priority 0-10
        priority: u8,
        /// Deadline (ISO 8601)
        deadline: Option<String>,
        /// Required capabilities
        required_capabilities: Vec<String>,
        /// Context/memory to pass along
        context: Option<serde_json::Value>,
    },
    /// Task acceptance
    #[serde(rename = "acp.task.accepted")]
    TaskAccepted {
        task_id: String,
        estimated_completion: Option<String>,
    },
    /// Task rejection
    #[serde(rename = "acp.task.rejected")]
    TaskRejected {
        task_id: String,
        reason: String,
    },
    /// Task progress update
    #[serde(rename = "acp.task.progress")]
    TaskProgress {
        task_id: String,
        progress: f32, // 0.0-1.0
        status: String,
        message: Option<String>,
    },
    /// Task completion
    #[serde(rename = "acp.task.completed")]
    TaskCompleted {
        task_id: String,
        result: serde_json::Value,
        tokens_used: Option<u64>,
        duration_secs: f64,
    },
    /// Task failure
    #[serde(rename = "acp.task.failed")]
    TaskFailed {
        task_id: String,
        error: String,
        error_type: String,
    },

    // ─── Messaging ─────────────────────────────────────────────────
    /// Send a message to another agent
    #[serde(rename = "acp.message")]
    Message {
        content: String,
        role: String, // "user" | "assistant" | "system"
        metadata: Option<HashMap<String, String>>,
    },

    // ─── Lifecycle ─────────────────────────────────────────────────
    /// Spawn a subagent
    #[serde(rename = "acp.agent.spawn")]
    SpawnAgent {
        name: String,
        description: String,
        agent_type: String,
        capabilities: Vec<AgentCapability>,
        config: Option<serde_json::Value>,
    },
    #[serde(rename = "acp.agent.spawned")]
    AgentSpawned {
        agent: AgentInfo,
    },
    /// Terminate an agent
    #[serde(rename = "acp.agent.terminate")]
    TerminateAgent {
        agent_id: AgentId,
        reason: Option<String>,
    },
    #[serde(rename = "acp.agent.terminated")]
    AgentTerminated {
        agent_id: AgentId,
    },

    // ─── Heartbeat ─────────────────────────────────────────────────
    #[serde(rename = "acp.heartbeat")]
    HeartbeatPulse {
        status: AgentStatus,
        current_task_count: u32,
    },

    // ─── Generic ──────────────────────────────────────────────────
    #[serde(rename = "acp.error")]
    Error {
        code: i32,
        message: String,
        data: Option<serde_json::Value>,
    },
}

// ─── ACP Transport ─────────────────────────────────────────────────────────

/// Transport trait for sending/receiving ACP messages
#[async_trait::async_trait]
pub trait AcpTransport: Send + Sync {
    /// Send a message to a target
    async fn send(&self, message: AcpMessage) -> Result<(), String>;

    /// Receive messages (returns a stream receiver)
    async fn receive(&self) -> Result<mpsc::Receiver<AcpMessage>, String>;

    /// Check if transport is connected
    async fn is_connected(&self) -> bool;
}

/// In-process transport (for same-process subagents)
pub struct InProcessTransport {
    tx: mpsc::Sender<AcpMessage>,
    rx: Arc<RwLock<Option<mpsc::Receiver<AcpMessage>>>>,
}

impl InProcessTransport {
    pub fn new(buffer: usize) -> Self {
        let (tx, rx) = mpsc::channel(buffer);
        Self { tx, rx: Arc::new(RwLock::new(Some(rx))) }
    }

    pub fn sender(&self) -> mpsc::Sender<AcpMessage> {
        self.tx.clone()
    }
}

#[async_trait::async_trait]
impl AcpTransport for InProcessTransport {
    async fn send(&self, message: AcpMessage) -> Result<(), String> {
        self.tx.send(message).await.map_err(|e| format!("Send error: {}", e))
    }

    async fn receive(&self) -> Result<mpsc::Receiver<AcpMessage>, String> {
        self.rx.write().await
            .take()
            .ok_or_else(|| "Receiver already taken".to_string())
    }

    async fn is_connected(&self) -> bool {
        !self.tx.is_closed()
    }
}

// ─── ACP Router ────────────────────────────────────────────────────────────

/// Central ACP router that manages agent registry and message routing
pub struct AcpRouter {
    /// My agent info
    pub self_info: AgentInfo,
    /// Known agents (id -> info)
    agents: Arc<RwLock<HashMap<AgentId, AgentInfo>>>,
    /// Active transports (agent_id -> transport)
    transports: Arc<RwLock<HashMap<AgentId, Box<dyn AcpTransport>>>>,
    /// Pending request-response correlations
    pending_requests: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<AcpMessage>>>>,
    /// Event broadcast for external listeners
    event_tx: broadcast::Sender<AcpMessage>,
    /// Message sequence counter
    seq_counter: Arc<RwLock<u64>>,
}

impl AcpRouter {
    pub fn new(name: &str, description: &str, agent_type: &str) -> Self {
        let (event_tx, _) = broadcast::channel(256);

        let self_info = AgentInfo {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            description: description.to_string(),
            version: ACP_VERSION.to_string(),
            agent_type: agent_type.to_string(),
            capabilities: Vec::new(),
            endpoint: "inproc".to_string(),
            status: AgentStatus::Online,
            joined_at: Utc::now(),
            last_heartbeat: Utc::now(),
            parent_id: None,
            metadata: HashMap::new(),
        };

        Self {
            self_info,
            agents: Arc::new(RwLock::new(HashMap::new())),
            transports: Arc::new(RwLock::new(HashMap::new())),
            pending_requests: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            seq_counter: Arc::new(RwLock::new(0)),
        }
    }

    /// Register capabilities
    pub async fn register_capabilities(&mut self, capabilities: Vec<AgentCapability>) {
        self.self_info.capabilities = capabilities;
    }

    /// Subscribe to all ACP events
    pub fn subscribe(&self) -> broadcast::Receiver<AcpMessage> {
        self.event_tx.subscribe()
    }

    /// Get my agent ID
    pub fn self_id(&self) -> AgentId {
        self.self_info.id.clone()
    }

    /// Register an agent (discovery)
    pub async fn register_agent(&self, agent: AgentInfo, transport: Option<Box<dyn AcpTransport>>) {
        let agent_id = agent.id.clone();

        if let Some(transport) = transport {
            self.transports.write().await.insert(agent_id.clone(), transport);
            // Note: Message receiving for this transport would be setup by the agent owner.
            // In-process transports communicate via channels managed externally.
        }

        // Announce to all listeners
        let announce_msg = AcpMessage {
            version: ACP_VERSION.to_string(),
            id: self.next_id().await,
            message_type: AcpMessageType::Notification,
            sender: self.self_id(),
            target: None,
            timestamp: Utc::now(),
            payload: AcpPayload::Announce { agent: agent.clone() },
            correlation_id: None,
            ttl_secs: Some(30),
        };
        let _ = self.event_tx.send(announce_msg);

        self.agents.write().await.insert(agent_id, agent);
    }

    /// Unregister an agent
    pub async fn unregister_agent(&self, agent_id: &str) {
        self.agents.write().await.remove(agent_id);
        self.transports.write().await.remove(agent_id);

        let msg = AcpMessage {
            version: ACP_VERSION.to_string(),
            id: self.next_id().await,
            message_type: AcpMessageType::Notification,
            sender: self.self_id(),
            target: None,
            timestamp: Utc::now(),
            payload: AcpPayload::AgentTerminated { agent_id: agent_id.to_string() },
            correlation_id: None,
            ttl_secs: None,
        };
        let _ = self.event_tx.send(msg);
    }

    /// Discover agents
    pub async fn discover(
        &self,
        query: Option<&str>,
        capability: Option<&str>,
        agent_type: Option<&str>,
    ) -> Vec<AgentInfo> {
        let agents = self.agents.read().await;
        agents
            .values()
            .filter(|a| {
                let q_match = query.map_or(true, |q| {
                    a.name.to_lowercase().contains(&q.to_lowercase())
                        || a.description.to_lowercase().contains(&q.to_lowercase())
                });
                let c_match = capability.map_or(true, |c| {
                    a.capabilities.iter().any(|cap| cap.name == c)
                });
                let t_match = agent_type.map_or(true, |t| a.agent_type == t);
                q_match && c_match && t_match
            })
            .cloned()
            .collect()
    }

    /// Delegate a task to any capable agent
    pub async fn delegate_task(
        &self,
        description: &str,
        task: serde_json::Value,
        required_capabilities: Vec<String>,
        priority: u8,
        timeout_secs: Option<u64>,
    ) -> Result<AcpMessage, String> {
        // Find capable agents
        let agents = self.agents.read().await;
        let capable: Vec<_> = agents
            .values()
            .filter(|a| {
                required_capabilities.iter().all(|rc| {
                    a.capabilities.iter().any(|c| c.name == *rc)
                })
            })
            .collect();

        if capable.is_empty() {
            return Err(format!(
                "No agent with required capabilities: {:?}",
                required_capabilities
            ));
        }

        // Pick the best agent (first capable for now, could use scoring)
        let target = capable[0];
        let task_id = Uuid::new_v4().to_string();
        let msg_id = self.next_id().await;

        let msg = AcpMessage {
            version: ACP_VERSION.to_string(),
            id: msg_id.clone(),
            message_type: AcpMessageType::Request,
            sender: self.self_id(),
            target: Some(target.id.clone()),
            timestamp: Utc::now(),
            payload: AcpPayload::TaskDelegate {
                description: description.to_string(),
                task,
                priority,
                deadline: timeout_secs.map(|secs| {
                    (Utc::now() + chrono::Duration::seconds(secs as i64)).to_rfc3339()
                }),
                required_capabilities,
                context: None,
            },
            correlation_id: Some(task_id),
            ttl_secs: timeout_secs,
        };

        // Send via transport
        let transports = self.transports.read().await;
        if let Some(transport) = transports.get(&target.id) {
            transport.send(msg.clone()).await?;
        }

        // Also broadcast for monitoring
        let _ = self.event_tx.send(msg.clone());

        Ok(msg)
    }

    /// Send a message to a specific agent
    pub async fn send_message(
        &self,
        target_id: &str,
        content: &str,
        role: &str,
    ) -> Result<AcpMessage, String> {
        let msg = AcpMessage {
            version: ACP_VERSION.to_string(),
            id: self.next_id().await,
            message_type: AcpMessageType::Notification,
            sender: self.self_id(),
            target: Some(target_id.to_string()),
            timestamp: Utc::now(),
            payload: AcpPayload::Message {
                content: content.to_string(),
                role: role.to_string(),
                metadata: None,
            },
            correlation_id: None,
            ttl_secs: Some(60),
        };

        let _ = self.event_tx.send(msg.clone());
        Ok(msg)
    }

    /// Broadcast a message to all agents
    pub async fn broadcast(&self, content: &str, role: &str) -> Result<(), String> {
        let msg = AcpMessage {
            version: ACP_VERSION.to_string(),
            id: self.next_id().await,
            message_type: AcpMessageType::Notification,
            sender: self.self_id(),
            target: None,
            timestamp: Utc::now(),
            payload: AcpPayload::Message {
                content: content.to_string(),
                role: role.to_string(),
                metadata: None,
            },
            correlation_id: None,
            ttl_secs: Some(30),
        };
        let _ = self.event_tx.send(msg);
        Ok(())
    }

    /// Send heartbeat
    pub async fn heartbeat(&self) {
        let msg = AcpMessage {
            version: ACP_VERSION.to_string(),
            id: self.next_id().await,
            message_type: AcpMessageType::Heartbeat,
            sender: self.self_id(),
            target: None,
            timestamp: Utc::now(),
            payload: AcpPayload::HeartbeatPulse {
                status: AgentStatus::Online,
                current_task_count: 0,
            },
            correlation_id: None,
            ttl_secs: Some(10),
        };
        let _ = self.event_tx.send(msg);
    }

    /// Get agent count
    pub async fn agent_count(&self) -> usize {
        self.agents.read().await.len()
    }

    /// List all registered agents
    pub async fn list_agents(&self) -> Vec<AgentInfo> {
        self.agents.read().await.values().cloned().collect()
    }

    /// Get agent by ID
    pub async fn get_agent(&self, agent_id: &str) -> Option<AgentInfo> {
        self.agents.read().await.get(agent_id).cloned()
    }

    // ─── Internal ──────────────────────────────────────────────────────

    async fn next_id(&self) -> String {
        let mut counter = self.seq_counter.write().await;
        *counter += 1;
        format!("msg_{}", counter)
    }
}

// ─── ACP Client Builder ────────────────────────────────────────────────────

/// Builder for creating ACP-capable agent instances
pub struct AcpClientBuilder {
    name: String,
    description: String,
    agent_type: String,
    capabilities: Vec<AgentCapability>,
    parent_id: Option<String>,
    metadata: HashMap<String, String>,
}

impl AcpClientBuilder {
    pub fn new(name: &str, agent_type: &str) -> Self {
        Self {
            name: name.to_string(),
            description: String::new(),
            agent_type: agent_type.to_string(),
            capabilities: Vec::new(),
            parent_id: None,
            metadata: HashMap::new(),
        }
    }

    pub fn description(mut self, description: &str) -> Self {
        self.description = description.to_string();
        self
    }

    pub fn parent(mut self, parent_id: &str) -> Self {
        self.parent_id = Some(parent_id.to_string());
        self
    }

    pub fn capability(mut self, cap: AgentCapability) -> Self {
        self.capabilities.push(cap);
        self
    }

    pub fn metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }

    pub fn build(self) -> (AcpRouter, AgentInfo) {
        let agent_info = AgentInfo {
            id: Uuid::new_v4().to_string(),
            name: self.name,
            description: self.description,
            version: ACP_VERSION.to_string(),
            agent_type: self.agent_type,
            capabilities: self.capabilities,
            endpoint: "inproc".to_string(),
            status: AgentStatus::Online,
            joined_at: Utc::now(),
            last_heartbeat: Utc::now(),
            parent_id: self.parent_id,
            metadata: self.metadata,
        };

        let mut router = AcpRouter::new(&agent_info.name, &agent_info.description, &agent_info.agent_type);
        // Override self_info
        router.self_info = agent_info.clone();

        (router, agent_info)
    }
}

// ─── Serialization Helpers ─────────────────────────────────────────────────

impl AcpMessage {
    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|e| format!("Serialization error: {}", e))
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| format!("Deserialization error: {}", e))
    }
}
