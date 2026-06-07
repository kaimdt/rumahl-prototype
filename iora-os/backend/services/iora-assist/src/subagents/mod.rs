// Subagents – Hierarchical Agent Delegation for ORA AI / IORA Assist
//
// Enables spawning specialized subagents that:
// - Run in isolated sandboxes with specific capabilities
// - Accept delegated tasks from the parent agent
// - Report progress and results back via ACP
// - Can spawn their own subagents (recursive delegation)
//
// Architecture:
//   Primary Agent (IORAAssist)
//   ├── Subagent: Code Reviewer (LSP diagnostics, code analysis)
//   ├── Subagent: Web Researcher (search, scrape, summarize)
//   ├── Subagent: Task Executor (sandbox code execution)
//   └── Subagent: Planner (task decomposition, planning)

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
use uuid::Uuid;

use crate::acp::{self, AcpRouter, AgentCapability, AgentId, AgentInfo, AgentStatus};
use crate::providers::{
    create_provider, provider_type_from_str, AIProvider, ChatMessage, ProviderConfig, ProviderType,
};

// ─── Subagent Types ────────────────────────────────────────────────────────

/// Predefined subagent specializations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SubagentType {
    /// Reviews code using LSP diagnostics
    CodeReviewer,
    /// Searches the web and scrapes pages
    WebResearcher,
    /// Executes code changes in a sandbox
    TaskExecutor,
    /// Decomposes complex tasks into subtasks
    Planner,
    /// Summarizes and analyzes text
    Summarizer,
    /// Generates code based on specifications
    CodeGenerator,
    /// Debugs issues using diagnostics and traces
    Debugger,
    /// Translates natural language
    Translator,
    /// Custom subagent with user-defined capabilities
    Custom(String),
}

impl SubagentType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::CodeReviewer => "code-reviewer",
            Self::WebResearcher => "web-researcher",
            Self::TaskExecutor => "task-executor",
            Self::Planner => "planner",
            Self::Summarizer => "summarizer",
            Self::CodeGenerator => "code-generator",
            Self::Debugger => "debugger",
            Self::Translator => "translator",
            Self::Custom(s) => s,
        }
    }

    pub fn default_capabilities(&self) -> Vec<AgentCapability> {
        match self {
            Self::CodeReviewer => vec![
                AgentCapability {
                    name: "code.review".into(),
                    description: "Review code for bugs, style issues, and improvements".into(),
                    version: "1.0".into(),
                    input_schema: Some(
                        serde_json::json!({"type": "object", "properties": {"code": {"type": "string"}, "language": {"type": "string"}}}),
                    ),
                    output_schema: None,
                    estimated_cost: Some(0.001),
                    avg_latency_secs: Some(5.0),
                    tags: vec!["code".into(), "review".into(), "quality".into()],
                },
                AgentCapability {
                    name: "diagnostics.analyze".into(),
                    description: "Analyze LSP diagnostics for a codebase".into(),
                    version: "1.0".into(),
                    input_schema: None,
                    output_schema: None,
                    estimated_cost: Some(0.002),
                    avg_latency_secs: Some(10.0),
                    tags: vec!["diagnostics".into(), "lsp".into()],
                },
            ],
            Self::WebResearcher => vec![
                AgentCapability {
                    name: "web.search".into(),
                    description: "Search the internet for information".into(),
                    version: "1.0".into(),
                    input_schema: Some(
                        serde_json::json!({"type": "object", "properties": {"query": {"type": "string"}}}),
                    ),
                    output_schema: None,
                    estimated_cost: Some(0.001),
                    avg_latency_secs: Some(3.0),
                    tags: vec!["web".into(), "search".into()],
                },
                AgentCapability {
                    name: "web.scrape".into(),
                    description: "Scrape and extract content from web pages".into(),
                    version: "1.0".into(),
                    input_schema: Some(
                        serde_json::json!({"type": "object", "properties": {"url": {"type": "string"}}}),
                    ),
                    output_schema: None,
                    estimated_cost: Some(0.002),
                    avg_latency_secs: Some(5.0),
                    tags: vec!["web".into(), "scrape".into()],
                },
            ],
            Self::TaskExecutor => vec![AgentCapability {
                name: "code.modify".into(),
                description: "Modify code files in a sandbox workspace".into(),
                version: "1.0".into(),
                input_schema: None,
                output_schema: None,
                estimated_cost: Some(0.005),
                avg_latency_secs: Some(15.0),
                tags: vec!["code".into(), "modify".into(), "execute".into()],
            }],
            Self::Planner => vec![AgentCapability {
                name: "task.decompose".into(),
                description: "Decompose a complex task into subtasks".into(),
                version: "1.0".into(),
                input_schema: Some(
                    serde_json::json!({"type": "object", "properties": {"task": {"type": "string"}}}),
                ),
                output_schema: None,
                estimated_cost: Some(0.003),
                avg_latency_secs: Some(8.0),
                tags: vec!["planning".into(), "decomposition".into()],
            }],
            Self::Summarizer => vec![AgentCapability {
                name: "text.summarize".into(),
                description: "Summarize long texts concisely".into(),
                version: "1.0".into(),
                input_schema: Some(
                    serde_json::json!({"type": "object", "properties": {"text": {"type": "string"}}}),
                ),
                output_schema: None,
                estimated_cost: Some(0.001),
                avg_latency_secs: Some(3.0),
                tags: vec!["text".into(), "summarize".into()],
            }],
            Self::CodeGenerator => vec![AgentCapability {
                name: "code.generate".into(),
                description: "Generate code from specifications".into(),
                version: "1.0".into(),
                input_schema: Some(
                    serde_json::json!({"type": "object", "properties": {"spec": {"type": "string"}, "language": {"type": "string"}}}),
                ),
                output_schema: None,
                estimated_cost: Some(0.005),
                avg_latency_secs: Some(10.0),
                tags: vec!["code".into(), "generate".into()],
            }],
            Self::Debugger => vec![AgentCapability {
                name: "code.debug".into(),
                description: "Debug code using error logs and diagnostics".into(),
                version: "1.0".into(),
                input_schema: Some(
                    serde_json::json!({"type": "object", "properties": {"error": {"type": "string"}, "code": {"type": "string"}}}),
                ),
                output_schema: None,
                estimated_cost: Some(0.004),
                avg_latency_secs: Some(12.0),
                tags: vec!["debug".into(), "diagnostics".into()],
            }],
            Self::Translator => vec![AgentCapability {
                name: "text.translate".into(),
                description: "Translate text between languages".into(),
                version: "1.0".into(),
                input_schema: Some(
                    serde_json::json!({"type": "object", "properties": {"text": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}}}),
                ),
                output_schema: None,
                estimated_cost: Some(0.0005),
                avg_latency_secs: Some(2.0),
                tags: vec!["translate".into(), "language".into()],
            }],
            Self::Custom(_) => Vec::new(),
        }
    }

    pub fn system_prompt(&self) -> &str {
        match self {
            Self::CodeReviewer => "You are a Code Reviewer subagent. Analyze code for bugs, style issues, performance problems, and security vulnerabilities. Reference specific line numbers when possible. Be constructive and concise.",
            Self::WebResearcher => "You are a Web Researcher subagent. Search the web for accurate, up-to-date information. Cite sources when possible. Be thorough but concise.",
            Self::TaskExecutor => "You are a Task Executor subagent. Execute code changes in the provided workspace. Follow instructions precisely. Report what you changed and why.",
            Self::Planner => "You are a Planner subagent. Decompose complex tasks into clear, actionable subtasks. Consider dependencies, priorities, and estimated effort. Output structured task lists.",
            Self::Summarizer => "You are a Summarizer subagent. Condense information to its essential points. Be accurate, clear, and extremely concise. Preserve key facts and decisions.",
            Self::CodeGenerator => "You are a Code Generator subagent. Write clean, well-documented, idiomatic code based on specifications. Include error handling, tests, and comments where appropriate.",
            Self::Debugger => "You are a Debugger subagent. Diagnose issues using error messages, logs, and code analysis. Explain the root cause and suggest concrete fixes.",
            Self::Translator => "You are a Translator subagent. Translate text accurately while preserving meaning, tone, and context. Output only the translation, no explanations.",
            Self::Custom(_) => "You are a specialized subagent. Perform your designated task accurately and concisely.",
        }
    }
}

// ─── Subagent Instance ─────────────────────────────────────────────────────

/// Configuration for spawning a subagent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentConfig {
    /// Subagent type
    pub agent_type: SubagentType,
    /// Custom name (auto-generated if None)
    pub name: Option<String>,
    /// Provider to use for this subagent
    pub provider: String,
    /// Model to use
    pub model: String,
    /// API key override
    pub api_key: Option<String>,
    /// Base URL override
    pub base_url: Option<String>,
    /// Temperature (0.0-1.0)
    pub temperature: Option<f32>,
    /// Max tokens for responses
    pub max_tokens: Option<u32>,
    /// Custom system prompt addition
    pub custom_prompt: Option<String>,
    /// Auto-destroy after task completion
    pub auto_destroy: bool,
    /// Maximum concurrent tasks
    pub max_concurrent_tasks: Option<u32>,
    /// Timeout per task (seconds)
    pub task_timeout_secs: Option<u64>,
}

impl Default for SubagentConfig {
    fn default() -> Self {
        Self {
            agent_type: SubagentType::Custom("generic".into()),
            name: None,
            provider: "openai".into(),
            model: "gpt-4o-mini".into(),
            api_key: None,
            base_url: None,
            temperature: Some(0.3),
            max_tokens: Some(4096),
            custom_prompt: None,
            auto_destroy: true,
            max_concurrent_tasks: Some(3),
            task_timeout_secs: Some(120),
        }
    }
}

impl SubagentConfig {
    pub fn for_type(agent_type: SubagentType) -> Self {
        Self {
            agent_type,
            ..Default::default()
        }
    }
}

/// Runtime state of a subagent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentState {
    pub id: AgentId,
    pub name: String,
    pub agent_type: String,
    pub status: AgentStatus,
    pub spawned_at: DateTime<Utc>,
    pub task_count: u64,
    pub completed_tasks: u64,
    pub failed_tasks: u64,
    pub total_tokens_used: u64,
    pub total_cost_usd: f64,
    pub provider: String,
    pub model: String,
}

/// A running subagent instance
pub struct Subagent {
    pub info: AgentInfo,
    pub config: SubagentConfig,
    /// Provider for this subagent
    pub provider: Box<dyn AIProvider>,
    /// ACP router for communication
    pub router: AcpRouter,
    /// Channel for receiving tasks
    task_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<SubagentTask>>>,
    /// Task sender (clone for the pool)
    task_tx: mpsc::Sender<SubagentTask>,
    /// State tracking
    state: Arc<RwLock<SubagentState>>,
    /// Event broadcast
    event_tx: broadcast::Sender<SubagentEvent>,
}

#[derive(Debug)]
pub struct SubagentTask {
    pub id: String,
    pub description: String,
    pub task_data: serde_json::Value,
    pub required_capability: String,
    pub priority: u8,
    pub deadline: Option<DateTime<Utc>>,
    /// Channel to send result back
    pub result_tx: tokio::sync::oneshot::Sender<SubagentResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentResult {
    pub success: bool,
    pub output: String,
    pub data: Option<serde_json::Value>,
    pub tokens_used: u64,
    pub cost_usd: f64,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SubagentEvent {
    Spawned {
        agent: AgentInfo,
    },
    TaskStarted {
        agent_id: String,
        task_id: String,
    },
    TaskProgress {
        agent_id: String,
        task_id: String,
        progress: f32,
        message: String,
    },
    TaskCompleted {
        agent_id: String,
        result: SubagentResult,
    },
    TaskFailed {
        agent_id: String,
        task_id: String,
        error: String,
    },
    Terminated {
        agent_id: String,
    },
    Heartbeat {
        agent_id: String,
        state: SubagentState,
    },
}

impl Subagent {
    pub fn new(config: SubagentConfig, provider: Box<dyn AIProvider>) -> Self {
        let (task_tx, task_rx) = mpsc::channel(64);
        let (event_tx, _) = broadcast::channel(128);

        let agent_type_str = config.agent_type.as_str().to_string();
        let name = config.name.clone().unwrap_or_else(|| {
            format!(
                "{}-{}",
                agent_type_str.clone(),
                &Uuid::new_v4().to_string()[..8]
            )
        });

        let capabilities = config.agent_type.default_capabilities();
        let _provider_enum =
            provider_type_from_str(&config.provider).unwrap_or(ProviderType::OpenAI);

        let agent_info = AgentInfo {
            id: Uuid::new_v4().to_string(),
            name,
            description: format!("{} subagent", agent_type_str.clone()),
            version: acp::ACP_VERSION.to_string(),
            agent_type: "subagent".to_string(),
            capabilities,
            endpoint: "inproc".to_string(),
            status: AgentStatus::Idle,
            joined_at: Utc::now(),
            last_heartbeat: Utc::now(),
            parent_id: None,
            metadata: {
                let mut m = HashMap::new();
                m.insert("provider".into(), config.provider.clone());
                m.insert("model".into(), config.model.clone());
                m.insert("subagent_type".into(), agent_type_str.clone());
                m
            },
        };

        let router = AcpRouter::new(&agent_info.name, &agent_info.description, "subagent");

        let state = Arc::new(RwLock::new(SubagentState {
            id: agent_info.id.clone(),
            name: agent_info.name.clone(),
            agent_type: agent_type_str,
            status: AgentStatus::Idle,
            spawned_at: Utc::now(),
            task_count: 0,
            completed_tasks: 0,
            failed_tasks: 0,
            total_tokens_used: 0,
            total_cost_usd: 0.0,
            provider: config.provider.clone(),
            model: config.model.clone(),
        }));

        Self {
            info: agent_info,
            config,
            provider,
            router,
            task_rx: Arc::new(tokio::sync::Mutex::new(task_rx)),
            task_tx,
            state,
            event_tx,
        }
    }

    /// Get the subagent ID
    pub fn id(&self) -> &str {
        &self.info.id
    }

    /// Subscribe to events
    pub fn subscribe(&self) -> broadcast::Receiver<SubagentEvent> {
        self.event_tx.subscribe()
    }

    /// Get task sender (for the pool to delegate tasks)
    pub fn task_sender(&self) -> mpsc::Sender<SubagentTask> {
        self.task_tx.clone()
    }

    /// Get current state
    pub async fn get_state(&self) -> SubagentState {
        self.state.read().await.clone()
    }

    /// Start the subagent's main event loop
    pub async fn run(self: Arc<Subagent>) {
        let _ = self.event_tx.send(SubagentEvent::Spawned {
            agent: self.info.clone(),
        });

        // Start heartbeat
        let state_clone = self.state.clone();
        let event_tx = self.event_tx.clone();
        let agent_id = self.info.id.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                let state = state_clone.read().await.clone();
                if matches!(state.status, AgentStatus::Offline) {
                    break;
                }
                let _ = event_tx.send(SubagentEvent::Heartbeat {
                    agent_id: agent_id.clone(),
                    state,
                });
            }
        });

        // Main task processing loop
        loop {
            let task = {
                let mut rx = self.task_rx.lock().await;
                rx.recv().await
            };
            let task = match task {
                Some(t) => t,
                None => break, // Channel closed
            };
            // Update state
            {
                let mut state = self.state.write().await;
                state.status = AgentStatus::Busy;
                state.task_count += 1;
            }

            let task_id = task.id.clone();
            let _ = self.event_tx.send(SubagentEvent::TaskStarted {
                agent_id: self.info.id.clone(),
                task_id: task_id.clone(),
            });

            // Execute the task
            let start = std::time::Instant::now();
            let result = self.execute_task(&task).await;
            let _duration = start.elapsed().as_secs_f64();

            // Update state
            {
                let mut state = self.state.write().await;
                if result.success {
                    state.completed_tasks += 1;
                    state.status = AgentStatus::Idle;
                } else {
                    state.failed_tasks += 1;
                    state.status = AgentStatus::Error(result.output.clone());
                }
                state.total_tokens_used += result.tokens_used;
                state.total_cost_usd += result.cost_usd;
            }

            // Send result
            let _ = task.result_tx.send(result.clone());

            let event = if result.success {
                SubagentEvent::TaskCompleted {
                    agent_id: self.info.id.clone(),
                    result: result.clone(),
                }
            } else {
                SubagentEvent::TaskFailed {
                    agent_id: self.info.id.clone(),
                    task_id: task_id.clone(),
                    error: result.output.clone(),
                }
            };
            let _ = self.event_tx.send(event);

            // Auto-destroy if configured
            if self.config.auto_destroy {
                self.terminate().await;
                break;
            }
        }
    }

    /// Execute a delegated task
    async fn execute_task(&self, task: &SubagentTask) -> SubagentResult {
        let system_prompt = self.build_system_prompt();

        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt,
            },
            ChatMessage {
                role: "user".to_string(),
                content: format!(
                    "## Task\n{}\n\n## Context/Data\n{}\n\n## Instructions\nComplete the task as specified. Be thorough but concise.",
                    task.description,
                    serde_json::to_string_pretty(&task.task_data).unwrap_or_default(),
                ),
            },
        ];

        let start = std::time::Instant::now();

        match self.provider.chat(messages, None).await {
            Ok(response) => {
                let tokens = response.tokens_used.unwrap_or(0) as u64;
                SubagentResult {
                    success: true,
                    output: response.message,
                    data: None,
                    tokens_used: tokens,
                    cost_usd: self.estimate_cost(tokens),
                    duration_secs: start.elapsed().as_secs_f64(),
                }
            }
            Err(e) => SubagentResult {
                success: false,
                output: e.to_string(),
                data: None,
                tokens_used: 0,
                cost_usd: 0.0,
                duration_secs: start.elapsed().as_secs_f64(),
            },
        }
    }

    /// Build system prompt for this subagent
    fn build_system_prompt(&self) -> String {
        let mut prompt = self.config.agent_type.system_prompt().to_string();

        // Add mode-specific instructions
        prompt.push_str("\n\n### Mode\n");
        prompt.push_str(&format!(
            "Provider: {}, Model: {}\n",
            self.config.provider, self.config.model
        ));
        prompt.push_str(&format!(
            "Temperature: {:.1}\n",
            self.config.temperature.unwrap_or(0.3)
        ));

        if let Some(ref custom) = self.config.custom_prompt {
            prompt.push_str("\n### Custom Instructions\n");
            prompt.push_str(custom);
        }

        prompt.push_str("\n\n### Output Format\nProvide your response as plain text. Use code blocks for code. Be concise.");
        prompt
    }

    /// Estimate cost for tokens
    fn estimate_cost(&self, tokens: u64) -> f64 {
        let pricing_per_1k = match self.config.provider.as_str() {
            "openai" => 0.003,
            "anthropic" => 0.005,
            "deepseek" => 0.0002,
            _ => 0.001,
        };
        (tokens as f64 / 1000.0) * pricing_per_1k
    }

    /// Terminate the subagent
    pub async fn terminate(&self) {
        let mut state = self.state.write().await;
        state.status = AgentStatus::Offline;
        let _ = self.event_tx.send(SubagentEvent::Terminated {
            agent_id: self.info.id.clone(),
        });
    }
}

// ─── Subagent Pool ─────────────────────────────────────────────────────────

/// Manages a pool of subagents, handling delegation and lifecycle
pub struct SubagentPool {
    /// Active subagents (id -> agent)
    agents: Arc<RwLock<HashMap<AgentId, Arc<Subagent>>>>,
    /// Task queue for spawning on-demand subagents
    pending_tasks: Arc<RwLock<Vec<SubagentTask>>>,
    /// Event broadcast
    event_tx: broadcast::Sender<SubagentEvent>,
    /// Default provider config
    default_provider: String,
    default_model: String,
}

impl SubagentPool {
    pub fn new(default_provider: &str, default_model: &str) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
            pending_tasks: Arc::new(RwLock::new(Vec::new())),
            event_tx,
            default_provider: default_provider.to_string(),
            default_model: default_model.to_string(),
        }
    }

    /// Subscribe to all subagent events
    pub fn subscribe(&self) -> broadcast::Receiver<SubagentEvent> {
        self.event_tx.subscribe()
    }

    /// Spawn a new subagent
    pub async fn spawn(&self, mut config: SubagentConfig) -> Result<SubagentState, String> {
        if config.provider.is_empty() {
            config.provider = self.default_provider.clone();
        }
        if config.model.is_empty() {
            config.model = self.default_model.clone();
        }

        let provider_enum = provider_type_from_str(&config.provider)
            .ok_or_else(|| format!("Unknown provider: {}", config.provider))?;

        let provider_config = ProviderConfig {
            api_key: config.api_key.clone(),
            base_url: config.base_url.clone(),
            model: Some(config.model.clone()),
            api_version: None,
        };

        let provider = create_provider(provider_enum, provider_config);

        if !provider.is_available().await {
            return Err(format!(
                "Provider '{}' is not available for subagent",
                config.provider
            ));
        }

        let subagent = Arc::new(Subagent::new(config, provider));
        let state = subagent.get_state().await;
        let agent_id = state.id.clone();

        // Subscribe to subagent events and forward to pool
        let mut sub_rx = subagent.subscribe();
        let pool_tx = self.event_tx.clone();
        tokio::spawn(async move {
            while let Ok(event) = sub_rx.recv().await {
                let _ = pool_tx.send(event);
            }
        });

        // Start the subagent's event loop
        let subagent_clone = subagent.clone();
        tokio::spawn(async move {
            subagent_clone.run().await;
        });

        self.agents.write().await.insert(agent_id, subagent);

        Ok(state)
    }

    /// Delegate a task to an available subagent or spawn one
    pub async fn delegate(
        &self,
        description: &str,
        task_data: serde_json::Value,
        required_capability: &str,
        priority: u8,
        timeout_secs: Option<u64>,
    ) -> Result<SubagentResult, String> {
        // Find an idle agent with the required capability
        let agents = self.agents.read().await;
        let capable_agent = agents.values().find(|a| {
            a.info
                .capabilities
                .iter()
                .any(|c| c.name == required_capability)
        });

        let task_id = Uuid::new_v4().to_string();
        let (result_tx, result_rx) = tokio::sync::oneshot::channel();

        let task = SubagentTask {
            id: task_id.clone(),
            description: description.to_string(),
            task_data,
            required_capability: required_capability.to_string(),
            priority,
            deadline: timeout_secs.map(|s| Utc::now() + chrono::Duration::seconds(s as i64)),
            result_tx,
        };

        if let Some(agent) = capable_agent {
            // Delegate to existing agent
            let sender = agent.task_sender();
            match tokio::time::timeout(
                std::time::Duration::from_secs(timeout_secs.unwrap_or(300)),
                sender.send(task),
            )
            .await
            {
                Ok(Ok(())) => {
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(timeout_secs.unwrap_or(300)),
                        result_rx,
                    )
                    .await
                    {
                        Ok(Ok(result)) => Ok(result),
                        Ok(Err(_)) => Err("Subagent dropped before responding".into()),
                        Err(_) => Err("Task timed out".into()),
                    }
                }
                Ok(Err(e)) => Err(format!("Failed to send task: {}", e)),
                Err(_) => Err("Timeout sending task to subagent".into()),
            }
        } else {
            // No capable agent – spawn one on-demand
            // Determine subagent type from capability
            let agent_type = match required_capability {
                "code.review" | "diagnostics.analyze" => SubagentType::CodeReviewer,
                "web.search" | "web.scrape" => SubagentType::WebResearcher,
                "code.modify" | "code.execute" => SubagentType::TaskExecutor,
                "task.decompose" => SubagentType::Planner,
                "text.summarize" => SubagentType::Summarizer,
                "code.generate" => SubagentType::CodeGenerator,
                "code.debug" => SubagentType::Debugger,
                "text.translate" => SubagentType::Translator,
                _ => SubagentType::Custom(required_capability.to_string()),
            };

            let config = SubagentConfig {
                agent_type,
                auto_destroy: true,
                task_timeout_secs: timeout_secs,
                ..SubagentConfig::default()
            };

            let state = self.spawn(config).await?;
            let agents = self.agents.read().await;
            if let Some(agent) = agents.get(&state.id) {
                let sender = agent.task_sender();
                sender
                    .send(task)
                    .await
                    .map_err(|e| format!("Send error: {}", e))?;

                match tokio::time::timeout(
                    std::time::Duration::from_secs(timeout_secs.unwrap_or(300)),
                    result_rx,
                )
                .await
                {
                    Ok(Ok(result)) => Ok(result),
                    Ok(Err(_)) => Err("Subagent dropped before responding".into()),
                    Err(_) => Err("Task timed out".into()),
                }
            } else {
                Err("Subagent disappeared after spawn".into())
            }
        }
    }

    /// Delegate a task and let the pool route it to the best agent
    pub async fn delegate_auto(
        &self,
        description: &str,
        task_data: serde_json::Value,
    ) -> Result<SubagentResult, String> {
        // Analyze the task to determine required capability
        let cap = Self::infer_capability(description, &task_data);
        self.delegate(description, task_data, &cap, 5, Some(120))
            .await
    }

    /// Infer which capability is needed from the task description
    fn infer_capability(description: &str, _task_data: &serde_json::Value) -> String {
        Self::infer_capability_static(description, _task_data)
    }

    /// Static version for external use (e.g., API handlers)
    pub fn infer_capability_static(description: &str, _task_data: &serde_json::Value) -> String {
        let desc_lower = description.to_lowercase();

        if desc_lower.contains("review")
            || desc_lower.contains("audit")
            || desc_lower.contains("lint")
            || desc_lower.contains("diagnostic")
            || desc_lower.contains("check code")
        {
            "code.review".into()
        } else if desc_lower.contains("search")
            || desc_lower.contains("find information")
            || desc_lower.contains("research")
            || desc_lower.contains("look up")
        {
            "web.search".into()
        } else if desc_lower.contains("modify")
            || desc_lower.contains("change")
            || desc_lower.contains("implement")
            || desc_lower.contains("write code")
            || desc_lower.contains("refactor")
        {
            "code.modify".into()
        } else if desc_lower.contains("plan")
            || desc_lower.contains("decompose")
            || desc_lower.contains("break down")
            || desc_lower.contains("steps")
        {
            "task.decompose".into()
        } else if desc_lower.contains("summarize")
            || desc_lower.contains("summary")
            || desc_lower.contains("condense")
            || desc_lower.contains("tldr")
        {
            "text.summarize".into()
        } else if desc_lower.contains("generate")
            || desc_lower.contains("create")
            || desc_lower.contains("build")
            || desc_lower.contains("scaffold")
        {
            "code.generate".into()
        } else if desc_lower.contains("debug")
            || desc_lower.contains("fix")
            || desc_lower.contains("error")
            || desc_lower.contains("bug")
        {
            "code.debug".into()
        } else if desc_lower.contains("translate") {
            "text.translate".into()
        } else {
            "generic".into()
        }
    }

    /// Get all agents and their states
    pub async fn list_agents(&self) -> Vec<SubagentState> {
        let agents = self.agents.read().await;
        let mut states = Vec::new();
        for agent in agents.values() {
            states.push(agent.get_state().await);
        }
        states
    }

    /// Get agent count by type
    pub async fn agent_counts(&self) -> HashMap<String, usize> {
        let agents = self.agents.read().await;
        let mut counts = HashMap::new();
        for agent in agents.values() {
            *counts
                .entry(agent.config.agent_type.as_str().to_string())
                .or_default() += 1;
        }
        counts
    }

    /// Terminate a specific subagent
    pub async fn terminate(&self, agent_id: &str) -> Result<(), String> {
        let agents = self.agents.read().await;
        if let Some(agent) = agents.get(agent_id) {
            agent.terminate().await;
            drop(agents);
            self.agents.write().await.remove(agent_id);
            Ok(())
        } else {
            Err(format!("Subagent not found: {}", agent_id))
        }
    }

    /// Terminate all subagents
    pub async fn terminate_all(&self) {
        let agents = self.agents.read().await;
        for agent in agents.values() {
            agent.terminate().await;
        }
        drop(agents);
        self.agents.write().await.clear();
    }

    /// Get pool statistics
    pub async fn stats_async(&self) -> SubagentPoolStats {
        let agents = self.agents.read().await;
        let mut total_tasks = 0u64;
        let mut total_completed = 0u64;
        let mut total_failed = 0u64;
        let mut total_tokens = 0u64;
        let mut total_cost = 0.0;

        let mut by_type: HashMap<String, usize> = HashMap::new();

        for agent in agents.values() {
            let state = agent.get_state().await;
            *by_type
                .entry(agent.config.agent_type.as_str().to_string())
                .or_default() += 1;
            total_tasks += state.task_count;
            total_completed += state.completed_tasks;
            total_failed += state.failed_tasks;
            total_tokens += state.total_tokens_used;
            total_cost += state.total_cost_usd;
        }

        SubagentPoolStats {
            active_agents: agents.len(),
            total_tasks,
            completed_tasks: total_completed,
            failed_tasks: total_failed,
            total_tokens_used: total_tokens,
            total_cost_usd: total_cost,
            by_type,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentPoolStats {
    pub active_agents: usize,
    pub total_tasks: u64,
    pub completed_tasks: u64,
    pub failed_tasks: u64,
    pub total_tokens_used: u64,
    pub total_cost_usd: f64,
    pub by_type: HashMap<String, usize>,
}
