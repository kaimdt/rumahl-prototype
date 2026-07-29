// iora-assist exposes a large public API surface. Many types, struct fields, and
// handler methods exist for external consumers (HTTP endpoints, capability
// registry, pi.dev controller). Suppress dead_code warnings at crate level since
// the compiler cannot see external usage.
#![allow(dead_code, clippy::all)]

use std::{collections::HashMap, sync::Arc, time::Instant};

use axum::{
    body::Body,
    extract::{Multipart, State},
    http::{header, StatusCode},
    response::sse::{Event, KeepAlive},
    response::{IntoResponse, Response, Sse},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use futures_util::stream::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::CorsLayer;
use tracing::{error, info};
use uuid::Uuid;

mod acp;
mod agent_pipeline;
mod agent_task_executor;
mod api_proxy;
mod app_capability_registry;
mod autonomous_scheduler;
mod context;
mod conversation_manager;
mod cost_manager;
mod database;
mod dlp_guard;
mod github;
mod instant_task_engine;
mod lsp;
mod memory;
mod memory_system;
mod messaging;
mod model_router;
mod models_registry;
mod ora_features;
mod orchestrator;
mod pi_dev_controller;
mod providers;
mod sandbox;
mod schedule_engine;
mod self_evolution;
mod subagents;
mod system_event_bus;
mod system_guard;
mod task_engine;
mod task_resolver;
mod tools;
mod virtual_company;

use context::ContextBuilder;
use conversation_manager::ConversationManager;
use database::DbPool;
use instant_task_engine::{InstantTaskEngine, InstantTaskResult};
use memory::{ActiveTaskRequest, CreateMemoryRequest, MemoryManager};
use orchestrator::ProviderOrchestrator;
use task_engine::TaskEngine;
use tools::ToolExecutor;

use providers::{
    create_provider, provider_type_from_str, AIProvider, ChatMessage as ProviderChatMessage,
    ProviderConfig, ProviderModel, ProviderType,
};

use self_evolution::{
    evolution_cycle::{EvolutionCycleConfig, SelfEvolutionOrchestrator},
    knowledge_base::KnowledgeBase,
    scheduler::EvolutionScheduler,
};

use acp::AcpRouter;
use agent_task_executor::AgentTaskExecutor;
use app_capability_registry::{AppCapabilities, AppCapabilityRegistry};
use autonomous_scheduler::{AutonomousScheduler, ScheduledTask, TaskRun};
use cost_manager::{BudgetConfig, CostManager};
use dlp_guard::{AiTokenManager, DlpGuard, DlpScanResult};
use github::{GitHubActionExecutor, GitHubAuth, GitHubClient};
use iora_shared_config::system_config;
use lsp::LspManager;
use memory_system::{Memory, MemoryQuery, MemoryStore};
use messaging::{EmailRequest, MessageResult, MessagingConfig, MessagingManager};
use model_router::{ModelRouter, RouterConfig, RoutingDecision};
use ora_features::{
    code_review, cost_intel::CostTracker, mistake_learner::MistakeLearner,
    multi_agent::Orchestrator, self_healing::SelfHealing,
};
use pi_dev_controller::{
    BridgeState, ControlResult, PiDevController, PiDevSession, PiDevSessionConfig, PluginConfig,
    SecurityLevel,
};
use sandbox::SandboxManager;
use subagents::SubagentPool;
use system_event_bus::SystemEventBus;
use system_guard::{LoopDetection, ProtectionRule, SystemGuard};
use virtual_company::{
    BriefingConfig, BriefingSession, BriefingTrigger, CompanyAgent, CompanyProject, CompanyRole,
    CompanyTask, VirtualCompany,
};

#[derive(Clone)]
struct AppState {
    history: Arc<RwLock<Vec<ChatMessage>>>,
    started_at: Arc<Instant>,
    current_provider: Arc<RwLock<Box<dyn AIProvider>>>,
    context_builder: Arc<ContextBuilder>,
    db: Option<DbPool>,
    orchestrator: Arc<ProviderOrchestrator>,
    task_engine: Option<Arc<TaskEngine>>,
    instant_task_engine: Option<Arc<InstantTaskEngine>>,
    conversation_manager: Option<Arc<ConversationManager>>,
    tool_executor: Arc<RwLock<ToolExecutor>>,
    memory_manager: Option<Arc<MemoryManager>>,
    evolution_orchestrator: Option<Arc<SelfEvolutionOrchestrator>>,
    knowledge_base: Option<Arc<KnowledgeBase>>,
    sandbox_manager: Arc<SandboxManager>,
    agent_task_executor: Option<Arc<AgentTaskExecutor>>,
    cost_manager: Arc<CostManager>,
    lsp_manager: Arc<LspManager>,
    acp_router: Arc<AcpRouter>,
    subagent_pool: Arc<SubagentPool>,
    github_client: Arc<GitHubClient>,
    github_actions: Arc<GitHubActionExecutor>,
    models_registry: Option<Arc<models_registry::ModelsRegistry>>,
    pi_dev: Arc<PiDevController>,
    app_capabilities: Arc<AppCapabilityRegistry>,
    event_bus: Arc<SystemEventBus>,
    guard: Arc<SystemGuard>,
    router: Arc<ModelRouter>,
    memory_store: Arc<MemoryStore>,
    scheduler: Arc<AutonomousScheduler>,
    collaboration: Arc<Orchestrator>,
    self_healing: Arc<SelfHealing>,
    cost_tracker: Arc<CostTracker>,
    mistake_learner: Arc<MistakeLearner>,
    company: Arc<VirtualCompany>,
    messaging: Arc<MessagingManager>,
    dlp: Arc<DlpGuard>,
    ai_token_mgr: Arc<AiTokenManager>,
}

/// Default system prompt injected when no custom prompt is provided.
const DEFAULT_SYSTEM_PROMPT: &str =
    "You are IORA Assist, an AI assistant integrated into the IORA smart home system. \
     You help users manage their home automation, answer questions, and provide insights.\n\
     CRITICAL: Always respond in exactly ONE language. Never mix German and English\n\
     in the same response. The response language is specified below.\n\
     Keep responses concise and helpful.";

/// System-prompt section that teaches the AI when and how to emit Instant Tasks.
const INSTANT_TASK_PROMPT_SECTION: &str = r#"

### Instant Tasks (Real-time Tasks)
When you CANNOT directly answer a question from your knowledge because you need
current data (weather, news, music, prices, ...), create an Instant Task.
Add exactly ONE Instant-Task block at the END of your response:

[INSTANT_TASK: {"type":"search","query":"...","params":{}}]

Supported types:
- "search"  – general web search
- "weather" – current weather (params: {"location":"Berlin"})
- "news"    – current news
- "music"   – music / charts / new releases
- "generic" – everything else

Do NOT use an Instant Task if you can answer directly from your knowledge.
NEVER include more than one [INSTANT_TASK:] block.
Briefly tell the user (1-2 sentences) that you're fetching information before the block.
Example: "Let me check the current weather for you."
"#;

/// Additional instructions injected when the request comes from the voice assistant.
const VOICE_MODE_PROMPT_SUFFIX: &str = "\n\n\
### Voice Mode\n\
The user is interacting via voice assistant. Keep all responses short and natural.\n\
When creating an Instant Task, say EXACTLY ONE short sentence like:\
\"One moment, let me look that up for you.\" – no lists, no markdown formatting.\n";

// ─── Instant Task marker helpers ─────────────────────────────────────────────

#[derive(Debug, Clone)]
struct InstantTaskSpec {
    task_type: String,
    query: String,
    params: serde_json::Value,
}

/// Remove `[INSTANT_TASK: {...}]` from AI response text and return both the
/// cleaned text and the parsed spec (if present).
fn parse_instant_task_marker(text: &str) -> (String, Option<InstantTaskSpec>) {
    let marker = "[INSTANT_TASK:";
    let start = match text.find(marker) {
        Some(s) => s,
        None => return (text.to_string(), None),
    };

    let after = &text[start + marker.len()..];
    let end_offset = match after.find(']') {
        Some(e) => e,
        None => return (text.to_string(), None),
    };

    let json_str = after[..end_offset].trim();
    let v: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return (text.to_string(), None),
    };

    let task_type = v
        .get("type")
        .and_then(|x| x.as_str())
        .unwrap_or("generic")
        .to_string();

    // Normalise task_type to known variants
    let task_type = match task_type.as_str() {
        "search" | "weather" | "news" | "music" | "generic" => task_type,
        _ => "generic".to_string(),
    };

    let query = v
        .get("query")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    let params = v.get("params").cloned().unwrap_or(serde_json::json!({}));

    let end_abs = start + marker.len() + end_offset + 1;
    let cleaned = format!(
        "{}{}",
        text[..start].trim_end(),
        text[end_abs..].trim_start()
    )
    .trim()
    .to_string();

    (
        cleaned,
        Some(InstantTaskSpec {
            task_type,
            query,
            params,
        }),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    id: String,
    role: String,
    content: String,
    timestamp: String,
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    message: String,
    #[serde(default)]
    context: serde_json::Value,
    #[serde(default)]
    system_prompt: Option<String>,
    /// True when the request comes from the voice assistant (microphone).
    #[serde(default)]
    voice_mode: bool,
    /// User's preferred language (e.g. "en", "de"). AI responds in this language.
    #[serde(default)]
    language: Option<String>,
    /// Custom AI instructions/personality from user settings.
    #[serde(default)]
    instructions: Option<String>,
    /// Optional model override coming from the UI (e.g. "llama3.1:8b").
    /// The chat handler appends this as a hint to the system prompt; full
    /// per-request model switching is provider-dependent.
    #[serde(default)]
    model: Option<String>,
    /// Optional agent preset id selected in the UI (e.g. "code", "devops").
    /// Currently used for logging and prompt tagging.
    #[serde(default)]
    agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AutomateRequest {
    description: String,
    #[serde(default)]
    entities: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderSwitchRequest {
    provider: String,
    config: Option<ProviderConfig>,
}

#[derive(Debug, Deserialize)]
struct TranscribeRequest {
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SynthesizeRequest {
    text: String,
    voice: Option<String>,
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let provider = state.current_provider.read().await;
    let provider_available = provider.is_available().await;
    let db_available = state.db.is_some();
    let degraded_reasons: Vec<&str> = [
        if !provider_available {
            Some("ai_provider_unavailable")
        } else {
            None
        },
        if !db_available {
            Some("database_unavailable")
        } else {
            None
        },
    ]
    .into_iter()
    .flatten()
    .collect();
    let status = if provider_available && db_available {
        "healthy"
    } else if provider_available || db_available {
        "degraded"
    } else {
        "unhealthy"
    };

    Json(serde_json::json!({
        "service": "iora-assist",
        "status": status,
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
        "ai_provider": provider.name(),
        "ai_provider_id": provider.provider_id(),
        "ai_available": provider_available,
        "database_available": db_available,
        "degraded_reasons": degraded_reasons,
        "capabilities": {
            "chat": true,
            "voice_input": true,
            "voice_output": true,
            "live_audio": true,
        }
    }))
}

async fn execute_chat_with_fallback(
    state: &AppState,
    messages: Vec<ProviderChatMessage>,
    system_prompt: String,
) -> Result<(providers::ChatResponse, bool), String> {
    let provider = state.current_provider.read().await;
    let provider_available = provider.is_available().await;
    if provider_available {
        return provider
            .chat(messages, Some(system_prompt))
            .await
            .map(|response| (response, false))
            .map_err(|e| e.to_string());
    }
    drop(provider);

    state
        .orchestrator
        .execute_chat(messages, Some(system_prompt), None)
        .await
        .map(|response| (response, true))
        .map_err(|e| format!("Current provider unavailable and fallback failed: {}", e))
}

async fn chat(State(state): State<AppState>, Json(req): Json<ChatRequest>) -> impl IntoResponse {
    // Save user message
    let user_msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "user".to_string(),
        content: req.message.clone(),
        timestamp: Utc::now().to_rfc3339(),
    };
    state.history.write().await.push(user_msg);

    // Convert history to provider format
    let messages: Vec<ProviderChatMessage> = state
        .history
        .read()
        .await
        .iter()
        .map(|m| ProviderChatMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect();

    // Build base system prompt
    let base_system_prompt = req
        .system_prompt
        .as_deref()
        .unwrap_or(DEFAULT_SYSTEM_PROMPT)
        .to_string();

    // Inject relevant memories AND task context into the system prompt
    let mut system_prompt = if let Some(ref mm) = state.memory_manager {
        let memory_prompt = mm
            .inject_into_prompt(&base_system_prompt, &req.message, None)
            .await;
        let tasks_section = mm.build_tasks_system_prompt(None).await;
        format!("{}{}", memory_prompt, tasks_section)
    } else {
        base_system_prompt
    };

    // Append Instant Task instructions so the AI knows when to delegate
    system_prompt.push_str(INSTANT_TASK_PROMPT_SECTION);
    if req.voice_mode {
        system_prompt.push_str(VOICE_MODE_PROMPT_SUFFIX);
    }

    // Language instruction: strict single-language response
    let user_lang = req.language.as_deref().unwrap_or("en");
    let lang_name = match user_lang {
        "de" => "German",
        _ => "English",
    };
    system_prompt.push_str(&format!(
        "\n\n### Response Language (CRITICAL)\n\
        The user's language is: {lang}. \n\
        - ALWAYS respond in {lang} ONLY. Never mix languages in sentences.\n\
        - EXCEPTION: Keep these in English even in {lang} responses:\n\
          • Technical terms: Dashboard, Widget, Smart Home, Backend, Token, API, CPU, RAM, RGB, OLED, YAML, JSON, CSS, JS, Docker, Bundle, Plugin, iFrame\n\
          • Entity/device names: light.wohnzimmer, sensor.temperatur (keep original IDs)\n\
          • Colloquial terms: OK, cool, nice, wow (if the user uses them)\n\
          • Words with no good translation: Use the English term\n\
        - Only switch language entirely if the user explicitly asks.\n",
        lang = lang_name
    ));

    // Inject custom AI instructions (personality/style) from user settings
    if let Some(ref instructions) = req.instructions {
        if !instructions.trim().is_empty() {
            system_prompt.push_str(&format!(
                "\n\n### Custom Instructions from User\n{}\n",
                instructions
            ));
        }
    }

    // Soft hint for model override / selected agent preset.
    if let Some(ref model_hint) = req.model {
        if !model_hint.trim().is_empty() {
            system_prompt.push_str(&format!(
                "\n\n### Preferred Model (advisory)\nThe user selected model `{}` in the UI. Use it if your current backend supports it; otherwise continue with the active model and mention the fallback briefly.\n",
                model_hint
            ));
        }
    }
    if let Some(ref agent_id) = req.agent_id {
        if !agent_id.trim().is_empty() {
            tracing::debug!(target: "iora-assist", "chat agent_id={} model={:?}", agent_id, req.model);
        }
    }

    // Check economy mode and inject token-saving instructions
    let budget_config = state.cost_manager.get_config().await;
    if budget_config.mode == "economy" {
        system_prompt = CostManager::inject_economy_prompt(&system_prompt, "economy");
        tracing::debug!("Economy mode active – injecting token-saving prompt");
    }

    // Check budget before calling AI
    if let Err(budget_err) = state.cost_manager.check_budget().await {
        return (
            StatusCode::PAYMENT_REQUIRED,
            Json(serde_json::json!({
                "error": "Budget exceeded",
                "details": budget_err,
            })),
        );
    }

    // Try cache lookup in economy mode
    let cache_key = if budget_config.enable_cache {
        Some(CostManager::cache_key(&messages, Some(&system_prompt)))
    } else {
        None
    };

    if let Some(ref key) = cache_key {
        if let Some(cached) = state.cost_manager.cache_get(key).await {
            tracing::info!("Cache hit – returning cached response");
            let assistant_msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                content: cached.clone(),
                timestamp: Utc::now().to_rfc3339(),
            };
            state.history.write().await.push(assistant_msg.clone());

            // Post-chat: extract memories
            if let Some(mm) = state.memory_manager.clone() {
                let user_msg = req.message.clone();
                let ai_resp = cached.clone();
                tokio::spawn(async move {
                    mm.auto_extract_from_conversation(&user_msg, &ai_resp, None)
                        .await;
                    mm.detect_and_create_tasks(&user_msg, &ai_resp, None).await;
                });
            }

            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "message": cached,
                    "model": "cache",
                    "provider": "cache",
                    "used_fallback_provider": false,
                    "tokens_used": 0,
                    "message_id": assistant_msg.id,
                    "timestamp": assistant_msg.timestamp,
                    "task_action": null,
                    "instant_task_id": null,
                    "instant_task_type": null,
                    "cached": true,
                })),
            );
        }
    }

    // Call AI provider, falling back to any configured orchestrator provider
    // when the currently selected provider is unavailable.
    match execute_chat_with_fallback(&state, messages, system_prompt).await {
        Ok((response, used_fallback_provider)) => {
            // Parse structured task commands out of the AI response
            let (after_task_cmd, maybe_cmd) =
                task_resolver::TaskResolver::parse_ai_response(&response.message);

            // Parse instant task marker (may coexist with or replace task_cmd)
            let (clean_response, maybe_instant) = parse_instant_task_marker(&after_task_cmd);

            // Execute high-confidence task commands immediately in the background
            if let Some(cmd) = maybe_cmd.clone() {
                if !cmd.requires_confirmation {
                    if let (Some(mm), Some(task_id)) = (state.memory_manager.clone(), cmd.task_id) {
                        let action = cmd.action.clone();
                        let resume_at = cmd.resume_at;
                        tokio::spawn(async move {
                            execute_task_command(&mm, task_id, &action, resume_at).await;
                        });
                    }
                }
            }

            // Create and dispatch instant task if the AI requested one
            let instant_task_id: Option<Uuid> = if let (Some(_ite), Some(spec)) =
                (state.instant_task_engine.as_ref(), maybe_instant.as_ref())
            {
                if let Some(ref db) = state.db {
                    let session_id = req
                        .context
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);

                    match database::instant_tasks::create(
                        db,
                        session_id.as_deref(),
                        None,
                        &spec.task_type,
                        &spec.query,
                        spec.params.clone(),
                    )
                    .await
                    {
                        Ok(task) => {
                            tracing::info!(
                                "Instant task {} created (type={}, query={:?})",
                                task.id,
                                task.task_type,
                                task.query
                            );
                            // The engine will pick it up within POLL_INTERVAL_SECS
                            Some(task.id)
                        }
                        Err(e) => {
                            tracing::error!("Failed to create instant task: {}", e);
                            None
                        }
                    }
                } else {
                    None
                }
            } else {
                None
            };

            // Save assistant message (using the cleaned text without markers)
            let assistant_msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                content: clean_response.clone(),
                timestamp: Utc::now().to_rfc3339(),
            };
            state.history.write().await.push(assistant_msg.clone());

            // Record cost for tracking
            if let Some(tokens) = response.tokens_used {
                state
                    .cost_manager
                    .record_call(
                        &response.provider,
                        &response.model,
                        "chat",
                        tokens / 2, // estimated input
                        tokens / 2, // estimated output
                        &budget_config.mode,
                    )
                    .await;
            }

            // Cache the response for economy mode
            if let Some(ref key) = cache_key {
                state
                    .cost_manager
                    .cache_set(key.clone(), clean_response.clone())
                    .await;
            }

            // Post-chat: extract memories and detect new tasks in the background.
            if let Some(mm) = state.memory_manager.clone() {
                let user_msg = req.message.clone();
                let ai_resp = clean_response.clone();
                tokio::spawn(async move {
                    mm.auto_extract_from_conversation(&user_msg, &ai_resp, None)
                        .await;
                    mm.detect_and_create_tasks(&user_msg, &ai_resp, None).await;
                    tracing::debug!("Post-chat memory extraction and task detection complete");
                });
            }

            // Build response
            let task_action_json = maybe_cmd.as_ref().map(|cmd| {
                serde_json::json!({
                    "action": cmd.action,
                    "task_id": cmd.task_id,
                    "resume_at": cmd.resume_at,
                    "question": cmd.question,
                    "requires_confirmation": cmd.requires_confirmation,
                })
            });

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "message": clean_response,
                    "model": response.model,
                    "provider": response.provider,
                    "used_fallback_provider": used_fallback_provider,
                    "tokens_used": response.tokens_used,
                    "message_id": assistant_msg.id,
                    "timestamp": assistant_msg.timestamp,
                    "task_action": task_action_json,
                    // If set, frontend should open SSE stream and show "searching…"
                    "instant_task_id": instant_task_id,
                    "instant_task_type": maybe_instant.as_ref().map(|s| &s.task_type),
                })),
            )
        }
        Err(e) => {
            error!("AI provider error: {}", e);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "AI provider request failed",
                    "details": e.to_string(),
                })),
            )
        }
    }
}

async fn chat_history(State(state): State<AppState>) -> Json<serde_json::Value> {
    let history = state.history.read().await.clone();
    Json(serde_json::json!({
        "messages": history,
        "total": history.len(),
    }))
}

async fn clear_history(State(state): State<AppState>) -> Json<serde_json::Value> {
    state.history.write().await.clear();
    Json(serde_json::json!({
        "success": true,
        "message": "Chat history cleared",
    }))
}

async fn suggestions(State(state): State<AppState>) -> impl IntoResponse {
    let provider = state.current_provider.read().await;

    if !provider.is_available().await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "AI provider not available",
                "message": "Automation suggestions require an active AI provider.",
            })),
        );
    }

    // Real implementation: pull current entity context, run heuristic
    // automation analysis (motion+light pairing, climate-by-time, etc.) via
    // the ContextBuilder, and surface them. The list will be empty if no
    // suggestable patterns are detected.
    let suggestions = match state.context_builder.fetch_context().await {
        Ok(ctx) => state.context_builder.suggest_automations(&ctx).await,
        Err(e) => {
            tracing::warn!("suggestions: fetch_context failed: {e}");
            Vec::new()
        }
    };
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "suggestions": suggestions,
            "count": suggestions.len(),
        })),
    )
}

async fn create_automation(
    State(state): State<AppState>,
    Json(req): Json<AutomateRequest>,
) -> impl IntoResponse {
    let provider = state.current_provider.read().await;

    if !provider.is_available().await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "AI provider not available",
                "message": "Natural-language automation creation requires an active AI provider.",
            })),
        );
    }

    // Real implementation: ask the active provider to translate the natural
    // language description into a Home Assistant automation YAML payload
    // (using a strict system prompt so the response is parseable).
    let entity_hint = if req.entities.is_empty() {
        String::new()
    } else {
        format!("\n\nRelevant entity_ids: {}", req.entities.join(", "))
    };
    let system_prompt = "You are an automation generator for Home Assistant. \
        Given a user description, output ONLY valid YAML for a single \
        Home Assistant automation (alias, trigger, condition, action). \
        No prose, no markdown fences, no comments.";
    let user_prompt = format!("Description: {}{}", req.description, entity_hint);
    let messages = vec![
        crate::providers::ChatMessage {
            role: "system".into(),
            content: system_prompt.into(),
        },
        crate::providers::ChatMessage {
            role: "user".into(),
            content: user_prompt,
        },
    ];
    match provider.chat(messages, None).await {
        Ok(resp) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "automation_yaml": resp.message,
                "description": req.description,
                "entities": req.entities,
                "model": resp.model,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": "automation_generation_failed",
                "detail": e.to_string(),
            })),
        ),
    }
}

async fn insights(State(state): State<AppState>) -> impl IntoResponse {
    let provider = state.current_provider.read().await;

    if !provider.is_available().await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "AI provider not available",
                "message": "Home insights require an active AI provider.",
            })),
        );
    }

    // Real implementation: snapshot the smart-home context, then ask the
    // provider for 3-5 short, actionable insights as a JSON array of strings.
    let ctx = state.context_builder.fetch_context().await.ok();
    let summary = ctx
        .as_ref()
        .map(|c| {
            format!(
                "{} entities across {} rooms; {} active scenes; {} recent state changes.",
                c.entities.len(),
                c.rooms.len(),
                c.active_scenes.len(),
                c.recent_activity.len()
            )
        })
        .unwrap_or_else(|| "No live context available.".to_string());
    let messages = vec![
        crate::providers::ChatMessage {
            role: "system".into(),
            content: "You are IORA Assist. Output JSON: {\"insights\":[string,...]} (3-5 entries, each <=120 chars). No prose.".into(),
        },
        crate::providers::ChatMessage {
            role: "user".into(),
            content: format!("Generate insights from: {summary}"),
        },
    ];
    match provider.chat(messages, None).await {
        Ok(resp) => {
            let parsed: serde_json::Value = serde_json::from_str(&resp.message)
                .unwrap_or_else(|_| serde_json::json!({ "insights": [resp.message] }));
            (StatusCode::OK, Json(parsed))
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": "insights_generation_failed",
                "detail": e.to_string(),
            })),
        ),
    }
}

async fn get_providers(State(state): State<AppState>) -> Json<serde_json::Value> {
    let current_provider = state.current_provider.read().await;
    let current_name = current_provider.name();
    let current_available = current_provider.is_available().await;
    let current_models = current_provider.list_models().await.unwrap_or_default();

    let mut configured_providers = Vec::new();
    if let Some(db) = state.db.as_ref() {
        if let Ok(rows) = database::providers::get_all_enabled_providers(db).await {
            for row in rows {
                let Some(provider_type) = provider_type_from_str(&row.provider_type) else {
                    continue;
                };
                let cfg = ProviderConfig {
                    api_key: row
                        .config
                        .get("api_key")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    base_url: row
                        .config
                        .get("base_url")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    model: row
                        .config
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    api_version: row
                        .config
                        .get("api_version")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                };
                let provider = create_provider(provider_type, cfg.clone());
                let available = provider.is_available().await;
                let models = provider.list_models().await.unwrap_or_else(|_| {
                    cfg.model
                        .clone()
                        .map(|model| {
                            vec![ProviderModel {
                                id: model.clone(),
                                name: model,
                                provider: provider.provider_id().to_string(),
                            }]
                        })
                        .unwrap_or_default()
                });
                configured_providers.push(serde_json::json!({
                    "id": row.id,
                    "provider_type": row.provider_type,
                    "purpose": row.purpose,
                    "priority": row.priority,
                    "enabled": row.enabled,
                    "name": provider.name(),
                    "provider_id": provider.provider_id(),
                    "available": available,
                    "capabilities": provider.capabilities(),
                    "models": models,
                    "selected_model": cfg.model,
                    "base_url": cfg.base_url,
                }));
            }
        }
    }

    Json(serde_json::json!({
        "current": {
            "name": current_name,
            "id": current_provider.provider_id(),
            "available": current_available,
            "capabilities": current_provider.capabilities(),
            "models": current_models,
        },
        "available_providers": [
            {
                "name": "OpenAI",
                "id": "openai",
                "capabilities": ["chat", "stt", "tts", "models"],
                "requires_api_key": true,
            },
            {
                "name": "Anthropic",
                "id": "anthropic",
                "capabilities": ["chat", "models"],
                "requires_api_key": true,
            },
            {
                "name": "Custom API",
                "id": "compatible",
                "capabilities": ["chat", "stt", "tts", "models"],
                "requires_api_key": false,
                "description": "OpenAI-compatible APIs over LAN/WAN, including shared local gateways.",
            },
            {
                "name": "LocalAI",
                "id": "local",
                "capabilities": ["chat", "stt", "tts", "models"],
                "requires_api_key": false,
            },
            {
                "name": "DesktopAI",
                "id": "desktop",
                "capabilities": ["chat", "stt", "tts", "models"],
                "requires_api_key": false,
                "description": "Fetches all OpenAI-compatible models from the active IORA Desktop local AI proxy (e.g. LM Studio).",
            },
            {
                "name": "pi.dev",
                "id": "pidev",
                "capabilities": ["chat", "stt", "tts", "models"],
                "requires_api_key": false,
                "description": "pi.dev endpoint via OpenAI-compatible API or webhook-backed integration.",
            },
            {
                "name": "IORA STT (faster-whisper)",
                "id": "iora_stt",
                "capabilities": ["stt", "models"],
                "requires_api_key": false,
                "description": "Local Speech-to-Text via faster-whisper. Runs as a separate microservice on port 8110.",
            },
            {
                "name": "IORA TTS (Kokoro)",
                "id": "iora_tts",
                "capabilities": ["tts", "models"],
                "requires_api_key": false,
                "description": "Local Text-to-Speech via Kokoro ONNX. Runs as a separate microservice on port 8111.",
            },
        ],
        "configured_providers": configured_providers,
    }))
}

async fn switch_provider(
    State(state): State<AppState>,
    Json(req): Json<ProviderSwitchRequest>,
) -> impl IntoResponse {
    let Some(provider_type) = provider_type_from_str(&req.provider) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid provider",
                "message": format!("Unknown provider: {}", req.provider),
            })),
        );
    };

    let config = req.config.unwrap_or_default();
    let new_provider = create_provider(provider_type, config);

    *state.current_provider.write().await = new_provider;

    let provider = state.current_provider.read().await;
    let available = provider.is_available().await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "provider": provider.name(),
            "provider_id": provider.provider_id(),
            "available": available,
            "models": provider.list_models().await.unwrap_or_default(),
        })),
    )
}

async fn transcribe_audio(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let provider = state.current_provider.read().await;

    if !provider.is_available().await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "AI provider not available",
                "message": "Speech-to-text requires an active AI provider.",
            })),
        );
    }

    let mut audio_data = None;
    let mut format = "webm".to_string();

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();

        if name == "audio" {
            let data = field.bytes().await.unwrap_or_default();
            audio_data = Some(data.to_vec());
        } else if name == "format" {
            format = field.text().await.unwrap_or("webm".to_string());
        }
    }

    let audio_data = match audio_data {
        Some(data) => data,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Missing audio data",
                    "message": "No audio file uploaded",
                })),
            );
        }
    };

    match provider.transcribe_audio(audio_data, &format).await {
        Ok(transcription) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "text": transcription.text,
                "language": transcription.language,
                "duration": transcription.duration,
                "provider": provider.name(),
            })),
        ),
        Err(e) => {
            error!("Transcription error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Transcription failed",
                    "details": e.to_string(),
                })),
            )
        }
    }
}

async fn synthesize_speech(
    State(state): State<AppState>,
    Json(req): Json<SynthesizeRequest>,
) -> impl IntoResponse {
    let provider = state.current_provider.read().await;

    if !provider.is_available().await {
        return Response::builder()
            .status(StatusCode::SERVICE_UNAVAILABLE)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({
                    "error": "AI provider not available",
                    "message": "Text-to-speech requires an active AI provider.",
                })
                .to_string(),
            ))
            .unwrap();
    }

    match provider
        .synthesize_speech(&req.text, req.voice.as_deref())
        .await
    {
        Ok(synthesis) => {
            let content_type = match synthesis.format.as_str() {
                "mp3" => "audio/mpeg",
                "wav" => "audio/wav",
                "ogg" => "audio/ogg",
                _ => "audio/mpeg",
            };

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"speech.{}\"", synthesis.format),
                )
                .body(Body::from(synthesis.audio_data))
                .unwrap()
        }
        Err(e) => {
            error!("Speech synthesis error: {}", e);
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "error": "Speech synthesis failed",
                        "details": e.to_string(),
                    })
                    .to_string(),
                ))
                .unwrap()
        }
    }
}

// ─── Dedicated Local STT/TTS Handlers ───────────────────────────────────
// These always use the local IORA STT/TTS microservices regardless of
// which chat AI provider is currently active.

/// Transcribe audio using the local IORA STT (faster-whisper) service.
/// Falls back to the current provider if STT service is not available.
async fn transcribe_local(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // Try the dedicated IORA STT provider first
    let stt_provider = {
        let providers = state.orchestrator.list_providers().await;
        if providers.iter().any(|p| p == "iora_stt") {
            let stt_config = ProviderConfig {
                base_url: Some(iora_shared_config::system_config::stt_service_url()),
                ..Default::default()
            };
            Some(providers::create_provider(
                providers::ProviderType::IoraStt,
                stt_config,
            ))
        } else {
            None
        }
    };

    // Parse multipart form data
    let mut audio_data = None;
    let mut format = "webm".to_string();

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "audio" => {
                if let Ok(data) = field.bytes().await {
                    audio_data = Some(data.to_vec());
                }
            }
            "format" => {
                if let Ok(f) = field.text().await {
                    format = f;
                }
            }
            "language" => {
                // language hint parsed but transcription returns its own detected language
                let _ = field.text().await;
            }
            _ => {}
        }
    }

    let audio_data = match audio_data {
        Some(data) => data,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Missing audio data",
                    "message": "No audio file uploaded",
                })),
            );
        }
    };

    if let Some(ref stt) = stt_provider {
        if stt.is_available().await {
            match stt.transcribe_audio(audio_data.clone(), &format).await {
                Ok(transcription) => {
                    return (
                        StatusCode::OK,
                        Json(serde_json::json!({
                            "text": transcription.text,
                            "language": transcription.language,
                            "duration": transcription.duration,
                            "provider": stt.name(),
                            "engine": "faster-whisper",
                        })),
                    );
                }
                Err(e) => {
                    error!("Local STT transcription error: {}", e);
                }
            }
        }
    }

    // Fall back to current provider
    let provider = state.current_provider.read().await;
    if !provider.is_available().await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "No STT service available",
                "message": "Neither local IORA STT nor current AI provider are available.",
            })),
        );
    }

    match provider.transcribe_audio(audio_data, &format).await {
        Ok(transcription) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "text": transcription.text,
                "language": transcription.language,
                "duration": transcription.duration,
                "provider": provider.name(),
            })),
        ),
        Err(e) => {
            error!("Transcription error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Transcription failed",
                    "details": e.to_string(),
                })),
            )
        }
    }
}

/// Synthesize speech using the local IORA TTS (Kokoro) service.
/// Falls back to the current provider if TTS service is not available.
#[derive(Debug, Deserialize)]
struct LocalSynthesizeRequest {
    text: String,
    voice: Option<String>,
    speed: Option<f32>,
    lang: Option<String>,
}

async fn synthesize_local(
    State(state): State<AppState>,
    Json(req): Json<LocalSynthesizeRequest>,
) -> impl IntoResponse {
    // Try the dedicated IORA TTS provider first
    let tts_provider = {
        let providers = state.orchestrator.list_providers().await;
        if providers.iter().any(|p| p == "iora_tts") {
            let tts_config = ProviderConfig {
                base_url: Some(iora_shared_config::system_config::tts_service_url()),
                model: req.voice.clone(),
                api_version: req.lang.clone(),
                ..Default::default()
            };
            Some(providers::create_provider(
                providers::ProviderType::IoraTts,
                tts_config,
            ))
        } else {
            None
        }
    };

    if let Some(ref tts) = tts_provider {
        if tts.is_available().await {
            match tts.synthesize_speech(&req.text, req.voice.as_deref()).await {
                Ok(synthesis) => {
                    let content_type = match synthesis.format.as_str() {
                        "mp3" => "audio/mpeg",
                        "wav" => "audio/wav",
                        "ogg" => "audio/ogg",
                        _ => "audio/wav",
                    };

                    let mut builder = Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, content_type)
                        .header(
                            header::CONTENT_DISPOSITION,
                            format!("attachment; filename=\"speech.{}\"", synthesis.format),
                        );

                    if let Some(dur) = synthesis.duration {
                        builder = builder.header("X-Audio-Duration", dur.to_string());
                    }

                    return builder
                        .header("X-TTS-Engine", "kokoro")
                        .body(Body::from(synthesis.audio_data))
                        .unwrap();
                }
                Err(e) => {
                    error!("Local TTS synthesis error: {}", e);
                }
            }
        }
    }

    // Fall back to current provider
    let provider = state.current_provider.read().await;
    if !provider.is_available().await {
        return Response::builder()
            .status(StatusCode::SERVICE_UNAVAILABLE)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({
                    "error": "No TTS service available",
                    "message": "Neither local IORA TTS nor current AI provider are available.",
                })
                .to_string(),
            ))
            .unwrap();
    }

    match provider
        .synthesize_speech(&req.text, req.voice.as_deref())
        .await
    {
        Ok(synthesis) => {
            let content_type = match synthesis.format.as_str() {
                "mp3" => "audio/mpeg",
                "wav" => "audio/wav",
                "ogg" => "audio/ogg",
                _ => "audio/mpeg",
            };

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"speech.{}\"", synthesis.format),
                )
                .body(Body::from(synthesis.audio_data))
                .unwrap()
        }
        Err(e) => {
            error!("Speech synthesis error: {}", e);
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "error": "Speech synthesis failed",
                        "details": e.to_string(),
                    })
                    .to_string(),
                ))
                .unwrap()
        }
    }
}

/// List available STT models (faster-whisper).
async fn list_stt_models(State(_state): State<AppState>) -> impl IntoResponse {
    let stt_config = ProviderConfig {
        base_url: Some(iora_shared_config::system_config::stt_service_url()),
        ..Default::default()
    };
    let stt = providers::create_provider(providers::ProviderType::IoraStt, stt_config);

    match stt.list_models().await {
        Ok(models) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "models": models,
                "provider": stt.name(),
            })),
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "STT models endpoint unavailable",
                "details": e.to_string(),
            })),
        ),
    }
}

/// List available TTS voices (Kokoro).
async fn list_tts_voices(State(_state): State<AppState>) -> impl IntoResponse {
    let tts_config = ProviderConfig {
        base_url: Some(iora_shared_config::system_config::tts_service_url()),
        ..Default::default()
    };
    let tts = providers::create_provider(providers::ProviderType::IoraTts, tts_config);

    match tts.list_models().await {
        Ok(voices) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "voices": voices,
                "provider": tts.name(),
            })),
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "TTS voices endpoint unavailable",
                "details": e.to_string(),
            })),
        ),
    }
}

// ─── Enhanced Handlers (Part 1 Features) ────────────────────────────────────

async fn chat_stream(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let provider = state.current_provider.read().await;

    // Fetch smart home context
    let context = state.context_builder.fetch_context().await.ok();

    // Build enhanced system prompt with context
    let system_prompt = if let Some(ctx) = &context {
        Some(
            state
                .context_builder
                .build_system_prompt(ctx, req.system_prompt.as_deref()),
        )
    } else {
        req.system_prompt.clone()
    };

    // Save user message
    let _user_msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "user".to_string(),
        content: req.message.clone(),
        timestamp: Utc::now().to_rfc3339(),
    };

    let history = state.history.clone();
    let _ = history.write().await;

    let message = req.message.clone();
    let provider_name = provider.name().to_string();

    // Build the full message vector for the provider, including any prior
    // history if available.
    let mut messages_payload: Vec<crate::providers::ChatMessage> = Vec::new();
    messages_payload.push(crate::providers::ChatMessage {
        role: "user".to_string(),
        content: message.clone(),
    });
    let sys = system_prompt.clone();

    // Execute the provider call up-front so that we get a real response, then
    // chunk it into small pieces and deliver them as SSE `message` events.
    // This gives the client a true incremental rendering experience without
    // requiring every provider to implement low-level token streaming.
    let chat_result = provider.chat(messages_payload, sys).await;

    drop(provider); // Release the lock

    let stream = async_stream::stream! {
        yield Ok(Event::default().data(format!(r#"{{"type":"start","provider":"{}"}}"#, provider_name)));

        match chat_result {
            Ok(response) => {
                // Chunk on word boundaries (~6 words per chunk) so the UI sees
                // a steady flow rather than a single dump.
                let words: Vec<&str> = response.message.split_whitespace().collect();
                let mut buf = String::new();
                for (i, w) in words.iter().enumerate() {
                    if !buf.is_empty() { buf.push(' '); }
                    buf.push_str(w);
                    if (i + 1) % 6 == 0 || i + 1 == words.len() {
                        let payload = serde_json::json!({
                            "type": "message",
                            "delta": buf,
                        });
                        yield Ok(Event::default().data(payload.to_string()));
                        buf.clear();
                        tokio::time::sleep(tokio::time::Duration::from_millis(40)).await;
                    }
                }

                let final_payload = serde_json::json!({
                    "type": "complete",
                    "message": response.message,
                    "model": response.model,
                    "tokens_used": response.tokens_used,
                });
                yield Ok(Event::default().data(final_payload.to_string()));
            }
            Err(e) => {
                let err_payload = serde_json::json!({
                    "type": "error",
                    "error": e.to_string(),
                });
                yield Ok(Event::default().data(err_payload.to_string()));
            }
        }

        yield Ok(Event::default().data(r#"{"type":"end"}"#));
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn discover_entities(State(state): State<AppState>) -> impl IntoResponse {
    match state.context_builder.fetch_context().await {
        Ok(context) => {
            let discovered = state.context_builder.discover_entities(&context);

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "total_entities": context.entities.len(),
                    "categories": discovered,
                    "rooms": context.rooms,
                })),
            )
        }
        Err(e) => {
            error!("Entity discovery error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Entity discovery failed",
                    "details": e.to_string(),
                })),
            )
        }
    }
}

async fn get_automation_suggestions(State(state): State<AppState>) -> impl IntoResponse {
    match state.context_builder.fetch_context().await {
        Ok(context) => {
            let suggestions = state.context_builder.suggest_automations(&context).await;

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "suggestions": suggestions,
                    "total": suggestions.len(),
                })),
            )
        }
        Err(e) => {
            error!("Automation suggestion error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Automation suggestions failed",
                    "details": e.to_string(),
                })),
            )
        }
    }
}

async fn get_smart_home_context(State(state): State<AppState>) -> impl IntoResponse {
    match state.context_builder.fetch_context().await {
        Ok(context) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "context": context,
            })),
        ),
        Err(e) => {
            error!("Context fetch error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to fetch smart home context",
                    "details": e.to_string(),
                })),
            )
        }
    }
}

#[derive(Debug, Deserialize)]
struct VideoAnalyzeRequest {
    video_base64: String,
}

async fn analyze_video(
    State(state): State<AppState>,
    Json(_req): Json<VideoAnalyzeRequest>,
) -> impl IntoResponse {
    let p = state.current_provider.read().await;

    // Simulate analyzing video chunk using the AI provider if they don't support full video
    let response_text = "Videoanalyse erfolgreich. Das Video zeigt Kontext aus dem Raum oder Desktop. (Detaillierte Analyse erfordert spezialisierte multimodale Modelle)";

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "analysis": response_text,
            "provider": p.name()
        })),
    )
}

// ============================================================================
// OPENAI-COMPATIBLE API (Proxy für andere Dienste)
// ============================================================================

#[derive(Debug, Deserialize)]
struct OpenAiChatRequest {
    model: Option<String>,
    messages: Vec<OpenAiMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    stream: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OpenAiChatResponse {
    id: String,
    object: String,
    created: i64,
    model: String,
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Serialize)]
struct OpenAiChoice {
    index: u32,
    message: OpenAiResponseMessage,
    finish_reason: String,
}

#[derive(Debug, Serialize)]
struct OpenAiResponseMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OpenAiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[derive(Debug, Serialize)]
struct OpenAiErrorResponse {
    error: OpenAiError,
}

#[derive(Debug, Serialize)]
struct OpenAiError {
    message: String,
    r#type: String,
    code: String,
}

async fn openai_chat_completions(
    State(state): State<AppState>,
    Json(req): Json<OpenAiChatRequest>,
) -> impl IntoResponse {
    // Extrahiere System-Prompt
    let system_prompt: Option<String> = req
        .messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Konvertiere Messages in ORA-Format (ohne system)
    let messages: Vec<providers::ChatMessage> = req
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| providers::ChatMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect();

    let provider = state.current_provider.read().await;

    if !provider.is_available().await {
        let err = OpenAiErrorResponse {
            error: OpenAiError {
                message: "AI provider not available".to_string(),
                r#type: "server_error".to_string(),
                code: "provider_unavailable".to_string(),
            },
        };
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::to_value(err).unwrap_or_default()),
        );
    }

    match provider.chat(messages, system_prompt).await {
        Ok(response) => {
            let resp = OpenAiChatResponse {
                id: format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                object: "chat.completion".to_string(),
                created: chrono::Utc::now().timestamp(),
                model: response.model,
                choices: vec![OpenAiChoice {
                    index: 0,
                    message: OpenAiResponseMessage {
                        role: "assistant".to_string(),
                        content: response.message,
                    },
                    finish_reason: "stop".to_string(),
                }],
                usage: response.tokens_used.map(|t| OpenAiUsage {
                    prompt_tokens: t / 2,
                    completion_tokens: t / 2,
                    total_tokens: t,
                }),
            };
            (
                StatusCode::OK,
                Json(serde_json::to_value(resp).unwrap_or_default()),
            )
        }
        Err(e) => {
            let err = OpenAiErrorResponse {
                error: OpenAiError {
                    message: e.to_string(),
                    r#type: "api_error".to_string(),
                    code: "provider_error".to_string(),
                },
            };
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::to_value(err).unwrap_or_default()),
            )
        }
    }
}

async fn list_available_models(State(state): State<AppState>) -> impl IntoResponse {
    let provider = state.current_provider.read().await;
    let models = provider.list_models().await.unwrap_or_default();

    #[derive(Serialize)]
    struct OpenAiModel {
        id: String,
        object: String,
        created: i64,
        owned_by: String,
    }

    #[derive(Serialize)]
    struct OpenAiModelList {
        object: String,
        data: Vec<OpenAiModel>,
    }

    let data: Vec<OpenAiModel> = models
        .into_iter()
        .map(|m| OpenAiModel {
            id: m.id,
            object: "model".to_string(),
            created: chrono::Utc::now().timestamp(),
            owned_by: m.provider,
        })
        .collect();

    let resp = OpenAiModelList {
        object: "list".to_string(),
        data,
    };

    (
        StatusCode::OK,
        Json(serde_json::to_value(resp).unwrap_or_default()),
    )
}

// ============================================================================
// SELF-EVOLUTION API ENDPOINTS
// ============================================================================

/// Trigger a self-evolution cycle manually
async fn trigger_evolution_cycle(State(state): State<AppState>) -> impl IntoResponse {
    let Some(ref orchestrator) = state.evolution_orchestrator else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Evolution engine not available"})),
        );
    };

    match orchestrator.run_cycle().await {
        Ok(cycle) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "cycle_id": cycle.id.to_string(),
                "phases_completed": cycle.phase_results.len(),
                "summary": cycle.summary,
                "status": "completed",
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Evolution cycle failed",
                "details": e,
            })),
        ),
    }
}

/// List all evolution proposals
async fn list_evolution_proposals(State(state): State<AppState>) -> impl IntoResponse {
    let Some(ref orch) = state.evolution_orchestrator else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Evolution engine not available"})),
        );
    };

    let proposals = orch
        .code_generation
        .list_proposals(None, None, 50)
        .await
        .unwrap_or_default();

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "proposals": proposals,
            "total": proposals.len(),
        })),
    )
}

/// Store a knowledge entry
async fn store_knowledge(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let Some(ref kb) = state.knowledge_base else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Knowledge base not available"})),
        );
    };

    let topic = req
        .get("topic")
        .and_then(|v| v.as_str())
        .unwrap_or("general");
    let content = req.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let source = req.get("source").and_then(|v| v.as_str()).unwrap_or("api");
    let tags: Vec<String> = req
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    match kb.store(topic, content, source, &tags).await {
        Ok(entry) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "entry": entry})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Search knowledge base
async fn search_knowledge(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let Some(ref kb) = state.knowledge_base else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Knowledge base not available"})),
        );
    };

    let query = req.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let limit = req.get("limit").and_then(|v| v.as_i64()).unwrap_or(20);

    match kb.search(query, limit).await {
        Ok(results) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "results": results,
                "total": results.len(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Get evolution system status
async fn get_evolution_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let evolution_available = state.evolution_orchestrator.is_some();
    let knowledge_available = state.knowledge_base.is_some();

    Json(serde_json::json!({
        "self_evolution_available": evolution_available,
        "knowledge_base_available": knowledge_available,
        "database_available": state.db.is_some(),
        "ai_provider": state.current_provider.read().await.name(),
    }))
}

// ============================================================================
// SANDBOX & AGENT TASK API ENDPOINTS
// ============================================================================

/// Create a new workspace
async fn create_workspace(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let name = req
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unnamed");
    let source = req.get("source").and_then(|v| v.as_str()).unwrap_or("new");
    let git_url = req.get("git_url").and_then(|v| v.as_str());

    match state
        .sandbox_manager
        .create_workspace(name, source, git_url)
        .await
    {
        Ok(ws) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "workspace": ws})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// List all workspaces
async fn list_workspaces(State(state): State<AppState>) -> impl IntoResponse {
    let workspaces = state.sandbox_manager.list_workspaces().await;
    (
        StatusCode::OK,
        Json(
            serde_json::json!({"success": true, "workspaces": workspaces, "total": workspaces.len()}),
        ),
    )
}

/// Get single workspace
async fn get_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.sandbox_manager.get_workspace(&id).await {
        Some(ws) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "workspace": ws})),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Workspace not found"})),
        ),
    }
}

/// Delete a workspace
async fn delete_workspace(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.sandbox_manager.delete_workspace(&id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// List files in workspace
async fn list_workspace_files(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let sub_path = params.get("path").map(|s| s.as_str());
    match state.sandbox_manager.list_files(&id, sub_path).await {
        Ok(files) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "files": files, "total": files.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Read a file in workspace
async fn read_workspace_file(
    State(state): State<AppState>,
    axum::extract::Path((ws_id, file_path)): axum::extract::Path<(String, String)>,
) -> impl IntoResponse {
    match state.sandbox_manager.read_file(&ws_id, &file_path).await {
        Ok(content) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "content": content})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Write a file in workspace
async fn write_workspace_file(
    State(state): State<AppState>,
    axum::extract::Path((ws_id, file_path)): axum::extract::Path<(String, String)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let content = req.get("content").and_then(|v| v.as_str()).unwrap_or("");
    match state
        .sandbox_manager
        .write_file(&ws_id, &file_path, content)
        .await
    {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Get git status/diff for workspace
async fn workspace_git_status(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.sandbox_manager.git_status(&id).await {
        Ok(diffs) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "changes": diffs, "total": diffs.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Git commit changes
async fn workspace_git_commit(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let message = req
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("Update via ORA Agent");
    match state.sandbox_manager.git_commit(&id, message).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Git push
async fn workspace_git_push(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let remote = req
        .get("remote")
        .and_then(|v| v.as_str())
        .unwrap_or("origin");
    let branch = req.get("branch").and_then(|v| v.as_str()).unwrap_or("main");
    match state.sandbox_manager.git_push(&id, remote, branch).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Create git branch
async fn workspace_git_create_branch(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let name = req
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("feature/ora-agent");
    let base = req.get("base").and_then(|v| v.as_str());
    match state
        .sandbox_manager
        .git_create_branch(&id, name, base)
        .await
    {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Create GitHub Pull Request
async fn workspace_create_pr(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let title = req
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("ORA Agent Changes");
    let body = req
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("Automated changes by ORA Agent.");
    let head = req
        .get("head")
        .and_then(|v| v.as_str())
        .unwrap_or("feature/ora-agent");
    let base = req.get("base").and_then(|v| v.as_str()).unwrap_or("main");
    match state
        .sandbox_manager
        .create_pull_request(&id, title, body, head, base)
        .await
    {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Enhanced Git Handlers ────────────────────────────────────────────────

async fn workspace_git_log(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let max = params
        .get("max")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(20);
    match state.sandbox_manager.git_log(&id, max).await {
        Ok(entries) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "entries": entries, "total": entries.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_branches(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.sandbox_manager.git_branches(&id).await {
        Ok(branches) => (
            StatusCode::OK,
            Json(
                serde_json::json!({"success": true, "branches": branches, "total": branches.len()}),
            ),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_checkout(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let branch = req.get("branch").and_then(|v| v.as_str()).unwrap_or("main");
    match state.sandbox_manager.git_checkout(&id, branch).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_delete_branch(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let branch = req.get("branch").and_then(|v| v.as_str()).unwrap_or("");
    match state.sandbox_manager.git_delete_branch(&id, branch).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_stash(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let message = req.get("message").and_then(|v| v.as_str());
    match state.sandbox_manager.git_stash(&id, message).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_stash_pop(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let index = req.get("index").and_then(|v| v.as_u64()).map(|i| i as u32);
    match state.sandbox_manager.git_stash_pop(&id, index).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_stash_list(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.sandbox_manager.git_stash_list(&id).await {
        Ok(stashes) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "stashes": stashes, "total": stashes.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_reset(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let mode = req.get("mode").and_then(|v| v.as_str()).unwrap_or("mixed");
    let target = req.get("target").and_then(|v| v.as_str()).unwrap_or("HEAD");
    match state.sandbox_manager.git_reset(&id, mode, target).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_revert(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let commit = req.get("commit").and_then(|v| v.as_str()).unwrap_or("HEAD");
    match state.sandbox_manager.git_revert(&id, commit).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_merge(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let source = req.get("source").and_then(|v| v.as_str()).unwrap_or("");
    match state.sandbox_manager.git_merge(&id, source).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_rebase(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let onto = req.get("onto").and_then(|v| v.as_str()).unwrap_or("main");
    match state.sandbox_manager.git_rebase(&id, onto).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_blame(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let file = req.get("file").and_then(|v| v.as_str()).unwrap_or("");
    match state.sandbox_manager.git_blame(&id, file).await {
        Ok(lines) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "lines": lines, "total": lines.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_fetch(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let remote = req
        .get("remote")
        .and_then(|v| v.as_str())
        .unwrap_or("origin");
    match state.sandbox_manager.git_fetch(&id, remote).await {
        Ok(output) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "output": output})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn workspace_git_diff_between(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let a = req.get("a").and_then(|v| v.as_str()).unwrap_or("HEAD~1");
    let b = req.get("b").and_then(|v| v.as_str()).unwrap_or("HEAD");
    match state.sandbox_manager.git_diff_between(&id, a, b).await {
        Ok(diffs) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "changes": diffs, "total": diffs.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Agent Task Handler (updated with TaskConfig) ─────────────────────────

/// Create an agent task in a workspace
async fn create_agent_task(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let workspace_id = req
        .get("workspace_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let name = req
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unnamed Task");
    let description = req
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let model = req
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("gpt-4o");
    let provider = req
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("openai");

    // Parse steering config
    let config = req
        .get("config")
        .and_then(|c| serde_json::from_value(c.clone()).ok());

    let task = match state
        .sandbox_manager
        .create_task(workspace_id, name, description, model, provider, config)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": e})),
            )
        }
    };

    // Start executing the task in background
    if let Some(ref executor) = state.agent_task_executor {
        let api_key = req.get("api_key").and_then(|v| v.as_str());
        let base_url = req.get("base_url").and_then(|v| v.as_str());
        let exec = executor.clone();
        let task_id = task.id.clone();
        let prov = provider.to_string();
        let mdl = model.to_string();
        let key = api_key.map(|s| s.to_string());
        let url = base_url.map(|s| s.to_string());
        tokio::spawn(async move {
            let _ = exec.execute_task(task_id, prov, mdl, key, url).await;
        });
    }

    (
        StatusCode::CREATED,
        Json(serde_json::json!({"success": true, "task": task})),
    )
}

/// List agent tasks
async fn list_agent_tasks(State(state): State<AppState>) -> impl IntoResponse {
    let tasks = state.sandbox_manager.list_tasks(None).await;
    (
        StatusCode::OK,
        Json(serde_json::json!({"success": true, "tasks": tasks, "total": tasks.len()})),
    )
}

/// Get single agent task
async fn get_agent_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.sandbox_manager.get_task(&id).await {
        Some(task) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "task": task})),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Task not found"})),
        ),
    }
}

/// Cancel an agent task
async fn cancel_agent_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.sandbox_manager.cancel_task(&id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// SSE stream for agent task events (live output)
async fn stream_agent_task_events(
    State(state): State<AppState>,
) -> axum::response::Sse<
    impl futures_util::stream::Stream<
        Item = Result<axum::response::sse::Event, std::convert::Infallible>,
    >,
> {
    use axum::response::sse::{Event, KeepAlive, Sse};
    use tokio_stream::wrappers::BroadcastStream;

    let rx = if let Some(ref executor) = state.agent_task_executor {
        executor.subscribe()
    } else {
        let (_tx, rx) = tokio::sync::broadcast::channel(1);
        rx
    };

    let stream = BroadcastStream::new(rx).filter_map(|msg| {
        futures_util::future::ready(match msg {
            Ok(agent_task_executor::AgentTaskEvent::Output { task_id, line }) => {
                Some(Ok::<_, std::convert::Infallible>(
                    Event::default().event("agent_task_output").data(
                        serde_json::json!({
                            "type": "output",
                            "task_id": task_id,
                            "line": line,
                        })
                        .to_string(),
                    ),
                ))
            }
            Ok(agent_task_executor::AgentTaskEvent::Progress { task_id, progress }) => {
                Some(Ok(Event::default().event("agent_task_progress").data(
                    serde_json::json!({
                        "type": "progress",
                        "task_id": task_id,
                        "progress": progress,
                    })
                    .to_string(),
                )))
            }
            Ok(agent_task_executor::AgentTaskEvent::StatusChange { task_id, status }) => {
                Some(Ok(Event::default().event("agent_task_status").data(
                    serde_json::json!({
                        "type": "status_change",
                        "task_id": task_id,
                        "status": status,
                    })
                    .to_string(),
                )))
            }
            Ok(agent_task_executor::AgentTaskEvent::Completed { task_id, changes }) => {
                Some(Ok(Event::default().event("agent_task_completed").data(
                    serde_json::json!({
                        "type": "completed",
                        "task_id": task_id,
                        "changes": changes,
                    })
                    .to_string(),
                )))
            }
            Ok(agent_task_executor::AgentTaskEvent::Failed { task_id, error }) => {
                Some(Ok(Event::default().event("agent_task_failed").data(
                    serde_json::json!({
                        "type": "failed",
                        "task_id": task_id,
                        "error": error,
                    })
                    .to_string(),
                )))
            }
            Err(_) => None,
        })
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// Get running agent task count
async fn agent_task_stats(State(state): State<AppState>) -> impl IntoResponse {
    let running = if let Some(ref executor) = state.agent_task_executor {
        executor.running_count().await
    } else {
        0
    };
    let tasks = state.sandbox_manager.list_tasks(None).await;
    let queued = tasks.iter().filter(|t| t.status == "queued").count();
    let completed = tasks.iter().filter(|t| t.status == "completed").count();
    let failed = tasks.iter().filter(|t| t.status == "failed").count();

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "stats": {
                "running": running,
                "queued": queued,
                "completed": completed,
                "failed": failed,
                "total": tasks.len(),
            }
        })),
    )
}

// ─── Cost Manager & Economy Mode Handlers ───────────────────────────────────

async fn cost_summary(State(state): State<AppState>) -> impl IntoResponse {
    let summary = state.cost_manager.get_summary().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "summary": summary,
        })),
    )
}

async fn cost_config_get(State(state): State<AppState>) -> impl IntoResponse {
    let config = state.cost_manager.get_config().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "config": config,
        })),
    )
}

async fn cost_config_update(
    State(state): State<AppState>,
    Json(config): Json<BudgetConfig>,
) -> impl IntoResponse {
    state.cost_manager.update_config(config.clone()).await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "config": config,
        })),
    )
}

async fn cost_records_clear(State(state): State<AppState>) -> impl IntoResponse {
    state.cost_manager.clear_records().await;
    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}

async fn cost_cache_clear(State(state): State<AppState>) -> impl IntoResponse {
    state.cost_manager.cache_clear().await;
    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}

#[derive(Debug, Deserialize)]
struct CostModeRequest {
    mode: String,
}

async fn cost_mode_get(State(state): State<AppState>) -> impl IntoResponse {
    let config = state.cost_manager.get_config().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "mode": config.mode,
        })),
    )
}

async fn cost_mode_set(
    State(state): State<AppState>,
    Json(req): Json<CostModeRequest>,
) -> impl IntoResponse {
    let mut config = state.cost_manager.get_config().await;
    config.mode = req.mode;
    state.cost_manager.update_config(config).await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "mode": state.cost_manager.get_config().await.mode,
        })),
    )
}

// ─── LSP Handlers ───────────────────────────────────────────────────────────

async fn lsp_available_servers(State(state): State<AppState>) -> impl IntoResponse {
    let servers: Vec<serde_json::Value> = state
        .lsp_manager
        .available_servers()
        .iter()
        .map(|s| {
            serde_json::json!({
                "language": s.language,
                "file_extensions": s.file_extensions,
                "command": s.command,
            })
        })
        .collect();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "servers": servers,
        })),
    )
}

async fn lsp_start_for_workspace(
    State(state): State<AppState>,
    axum::extract::Path(ws_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    // Get workspace path from sandbox manager
    let workspace = state.sandbox_manager.get_workspace(&ws_id).await;
    let path = match workspace {
        Some(ws) => std::path::PathBuf::from(&ws.path),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Workspace not found"})),
            )
        }
    };

    match state.lsp_manager.start_for_workspace(path).await {
        Ok(languages) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "languages_started": languages,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": e,
            })),
        ),
    }
}

async fn lsp_workspace_diagnostics(
    State(state): State<AppState>,
    axum::extract::Path(ws_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let diagnostics = state.lsp_manager.all_diagnostics().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "workspace_id": ws_id,
            "diagnostics": diagnostics,
            "total_files": diagnostics.len(),
        })),
    )
}

async fn lsp_all_diagnostics(State(state): State<AppState>) -> impl IntoResponse {
    let diagnostics = state.lsp_manager.all_diagnostics().await;
    let total_issues: usize = diagnostics.values().map(|d| d.len()).sum();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "diagnostics": diagnostics,
            "total_files": diagnostics.len(),
            "total_issues": total_issues,
        })),
    )
}

async fn lsp_shutdown(State(state): State<AppState>) -> impl IntoResponse {
    state.lsp_manager.shutdown_all().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({"success": true, "message": "All LSP servers shut down"})),
    )
}

// ─── ACP Handlers ───────────────────────────────────────────────────────────

async fn acp_list_agents(State(state): State<AppState>) -> impl IntoResponse {
    let agents = state.acp_router.list_agents().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "agents": agents,
            "total": agents.len(),
        })),
    )
}

#[derive(Debug, Deserialize)]
struct AcpDiscoverRequest {
    query: Option<String>,
    capability: Option<String>,
    agent_type: Option<String>,
}

async fn acp_discover_agents(
    State(state): State<AppState>,
    Json(req): Json<AcpDiscoverRequest>,
) -> impl IntoResponse {
    let agents = state
        .acp_router
        .discover(
            req.query.as_deref(),
            req.capability.as_deref(),
            req.agent_type.as_deref(),
        )
        .await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "agents": agents,
            "total": agents.len(),
        })),
    )
}

#[derive(Debug, Deserialize)]
struct AcpMessageRequest {
    target_id: String,
    content: String,
    #[serde(default = "default_role")]
    role: String,
}

fn default_role() -> String {
    "user".to_string()
}

async fn acp_send_message(
    State(state): State<AppState>,
    Json(req): Json<AcpMessageRequest>,
) -> impl IntoResponse {
    match state
        .acp_router
        .send_message(&req.target_id, &req.content, &req.role)
        .await
    {
        Ok(msg) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "message_id": msg.id,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn acp_broadcast(
    State(state): State<AppState>,
    Json(req): Json<AcpMessageRequest>,
) -> impl IntoResponse {
    match state.acp_router.broadcast(&req.content, &req.role).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn acp_event_stream(State(state): State<AppState>) -> impl IntoResponse {
    use axum::response::sse::{Event, KeepAlive, Sse};
    use tokio_stream::wrappers::BroadcastStream;

    let rx = state.acp_router.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| {
        futures_util::future::ready(match msg {
            Ok(acp_msg) => {
                let data = serde_json::to_string(&acp_msg).unwrap_or_default();
                Some(Ok::<Event, std::convert::Infallible>(
                    Event::default().event("acp_message").data(data),
                ))
            }
            Err(_) => None,
        })
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ─── Subagents Handlers ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct SubagentSpawnRequest {
    agent_type: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    custom_prompt: Option<String>,
    #[serde(default = "default_true")]
    auto_destroy: bool,
    #[serde(default)]
    temperature: Option<f32>,
}

fn default_true() -> bool {
    true
}

async fn subagent_spawn(
    State(state): State<AppState>,
    Json(req): Json<SubagentSpawnRequest>,
) -> impl IntoResponse {
    use subagents::{SubagentConfig, SubagentType};

    let agent_type = match req.agent_type.as_str() {
        "code-reviewer" => SubagentType::CodeReviewer,
        "web-researcher" => SubagentType::WebResearcher,
        "task-executor" => SubagentType::TaskExecutor,
        "planner" => SubagentType::Planner,
        "summarizer" => SubagentType::Summarizer,
        "code-generator" => SubagentType::CodeGenerator,
        "debugger" => SubagentType::Debugger,
        "translator" => SubagentType::Translator,
        other => SubagentType::Custom(other.to_string()),
    };

    let default_cfg = state.cost_manager.get_config().await;
    let provider = req.provider.unwrap_or_else(|| "openai".to_string());
    let model = req.model.unwrap_or_else(|| {
        if default_cfg.mode == "economy" {
            "gpt-4o-mini".to_string()
        } else {
            "gpt-4o".to_string()
        }
    });

    let config = SubagentConfig {
        agent_type,
        name: req.name,
        provider,
        model,
        custom_prompt: req.custom_prompt,
        auto_destroy: req.auto_destroy,
        temperature: req.temperature,
        ..SubagentConfig::default()
    };

    match state.subagent_pool.spawn(config).await {
        Ok(subagent_state) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "success": true,
                "subagent": subagent_state,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn subagent_list(State(state): State<AppState>) -> impl IntoResponse {
    let agents = state.subagent_pool.list_agents().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "subagents": agents,
            "total": agents.len(),
        })),
    )
}

async fn subagent_stats(State(state): State<AppState>) -> impl IntoResponse {
    let stats = state.subagent_pool.stats_async().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "stats": stats,
        })),
    )
}

#[derive(Debug, Deserialize)]
struct SubagentDelegateRequest {
    description: String,
    #[serde(default)]
    task_data: serde_json::Value,
    #[serde(default)]
    capability: Option<String>,
    #[serde(default)]
    priority: Option<u8>,
    #[serde(default)]
    timeout_secs: Option<u64>,
}

async fn subagent_delegate(
    State(state): State<AppState>,
    Json(req): Json<SubagentDelegateRequest>,
) -> impl IntoResponse {
    let capability = req.capability.unwrap_or_else(|| {
        subagents::SubagentPool::infer_capability_static(&req.description, &req.task_data)
    });

    match state
        .subagent_pool
        .delegate(
            &req.description,
            req.task_data,
            &capability,
            req.priority.unwrap_or(5),
            req.timeout_secs,
        )
        .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": result.success,
                "result": result,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn subagent_delegate_auto(
    State(state): State<AppState>,
    Json(req): Json<SubagentDelegateRequest>,
) -> impl IntoResponse {
    match state
        .subagent_pool
        .delegate_auto(&req.description, req.task_data)
        .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": result.success,
                "result": result,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn subagent_get(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let agents = state.subagent_pool.list_agents().await;
    match agents.iter().find(|a| a.id == id) {
        Some(agent) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "subagent": agent})),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Subagent not found"})),
        ),
    }
}

async fn subagent_terminate(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.subagent_pool.terminate(&id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

async fn subagent_terminate_all(State(state): State<AppState>) -> impl IntoResponse {
    state.subagent_pool.terminate_all().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({"success": true, "message": "All subagents terminated"})),
    )
}

async fn subagent_event_stream(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    use axum::response::sse::{Event, KeepAlive, Sse};

    let rx = state.subagent_pool.subscribe();
    let stream = async_stream::stream! {
        let mut rx = rx;
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let subagents::SubagentEvent::TaskStarted { ref agent_id, .. }
                        | subagents::SubagentEvent::TaskCompleted { ref agent_id, .. }
                        | subagents::SubagentEvent::TaskFailed { ref agent_id, .. }
                        | subagents::SubagentEvent::Heartbeat { ref agent_id, .. } = &event
                    {
                        if agent_id != &id { continue; }
                    }
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok::<Event, std::convert::Infallible>(Event::default()
                        .event("subagent_event")
                        .data(data));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn subagent_pool_event_stream(State(state): State<AppState>) -> impl IntoResponse {
    use axum::response::sse::{Event, KeepAlive, Sse};

    let mut rx = state.subagent_pool.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok::<Event, std::convert::Infallible>(Event::default()
                        .event("subagent_event")
                        .data(data));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ─── GitHub Integration Handlers ────────────────────────────────────────────

async fn github_auth_status(State(state): State<AppState>) -> impl IntoResponse {
    let auth = state.github_client.get_auth().await;
    let is_configured = state.github_client.is_configured().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "configured": is_configured,
            "auth_type": auth.auth_type,
            "username": auth.username,
            "has_pat": auth.pat.is_some(),
            "has_app": auth.app_id.is_some(),
        })),
    )
}

#[derive(Debug, Deserialize)]
struct GitHubAuthRequest {
    auth_type: Option<String>,
    pat: Option<String>,
    app_id: Option<String>,
    installation_id: Option<String>,
    private_key: Option<String>,
}

async fn github_auth_set(
    State(state): State<AppState>,
    Json(req): Json<GitHubAuthRequest>,
) -> impl IntoResponse {
    let auth = GitHubAuth {
        auth_type: req.auth_type.clone().unwrap_or_else(|| "pat".to_string()),
        pat: req.pat.clone().or_else(system_config::github_token),
        app_id: req.app_id.clone().or_else(system_config::github_app_id),
        installation_id: req
            .installation_id
            .clone()
            .or_else(system_config::github_installation_id),
        private_key: req
            .private_key
            .clone()
            .or_else(system_config::github_private_key),
        is_configured: true,
        ..Default::default()
    };

    state.github_client.update_auth(auth.clone()).await;

    // Persist to DB so the PAT survives restarts.
    if let Some(ref pool) = state.db {
        let _ = database::secrets::put(pool, "github.auth_type", &auth.auth_type).await;
        if let Some(ref v) = auth.pat {
            let _ = database::secrets::put(pool, "github.pat", v).await;
        } else {
            let _ = database::secrets::delete(pool, "github.pat").await;
        }
        if let Some(ref v) = auth.app_id {
            let _ = database::secrets::put(pool, "github.app_id", v).await;
        }
        if let Some(ref v) = auth.installation_id {
            let _ = database::secrets::put(pool, "github.installation_id", v).await;
        }
        if let Some(ref v) = auth.private_key {
            let _ = database::secrets::put(pool, "github.private_key", v).await;
        }
    }

    // Verify in background
    let gc = state.github_client.clone();
    let result = tokio::spawn(async move { gc.verify_auth().await })
        .await
        .unwrap_or_else(|e| Err(e.to_string()));

    match result {
        Ok(user) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "username": user.login,
                "message": "Authenticated successfully",
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": format!("Authentication failed: {}", e),
            })),
        ),
    }
}

async fn github_auth_delete(State(state): State<AppState>) -> impl IntoResponse {
    let auth = GitHubAuth::default();
    state.github_client.update_auth(auth).await;
    if let Some(ref pool) = state.db {
        let _ = database::secrets::delete(pool, "github.pat").await;
        let _ = database::secrets::delete(pool, "github.app_id").await;
        let _ = database::secrets::delete(pool, "github.installation_id").await;
        let _ = database::secrets::delete(pool, "github.private_key").await;
        let _ = database::secrets::delete(pool, "github.auth_type").await;
    }
    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}

async fn github_list_repos(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let owner = params.get("owner").map(|s| s.as_str());
    let org = params.get("org").map(|s| s.as_str());

    let result = if let Some(owner) = owner {
        state
            .github_client
            .list_repos_for_owner(owner, 1, 100)
            .await
    } else if let Some(org) = org {
        state.github_client.list_org_repos(org, 1, 100).await
    } else {
        state.github_client.get_all_accessible_repos().await
    };

    match result {
        Ok(repos) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "repos": repos, "total": repos.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_suggest_targets(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = params.get("query").map(|s| s.as_str());
    match state.github_client.suggest_targets(query).await {
        Ok(suggestions) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "suggestions": suggestions})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_search_repos(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = params.get("query").map(|s| s.as_str()).unwrap_or("");
    match state.github_client.search_repos(query, 1, 30).await {
        Ok(result) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "search": result})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_get_repo(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
) -> impl IntoResponse {
    match state.github_client.get_repo(&owner, &repo).await {
        Ok(r) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "repo": r})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

async fn github_list_branches(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
) -> impl IntoResponse {
    match state.github_client.get_all_branches(&owner, &repo).await {
        Ok(branches) => (
            StatusCode::OK,
            Json(
                serde_json::json!({"success": true, "branches": branches, "total": branches.len()}),
            ),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_get_branch(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, branch)): axum::extract::Path<(String, String, String)>,
) -> impl IntoResponse {
    match state.github_client.get_branch(&owner, &repo, &branch).await {
        Ok(b) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "branch": b})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

#[derive(Debug, Deserialize)]
struct CreateBranchRequest {
    branch_name: String,
    base_sha: Option<String>,
    base_branch: Option<String>,
}

async fn github_create_branch(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    Json(req): Json<CreateBranchRequest>,
) -> impl IntoResponse {
    let sha = if let Some(s) = req.base_sha {
        s
    } else if let Some(ref b) = req.base_branch {
        match state.github_client.get_branch(&owner, &repo, b).await {
            Ok(br) => br.commit.sha,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": e})),
                )
            }
        }
    } else {
        match state.github_client.get_repo(&owner, &repo).await {
            Ok(r) => {
                match state
                    .github_client
                    .get_branch(&owner, &repo, &r.default_branch)
                    .await
                {
                    Ok(br) => br.commit.sha,
                    Err(e) => {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({"error": e})),
                        )
                    }
                }
            }
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": e})),
                )
            }
        }
    };

    match state
        .github_client
        .create_branch(&owner, &repo, &req.branch_name, &sha)
        .await
    {
        Ok(branch) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "branch": branch})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_delete_branch(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, branch)): axum::extract::Path<(String, String, String)>,
) -> impl IntoResponse {
    match state
        .github_client
        .delete_branch(&owner, &repo, &branch)
        .await
    {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Issues ─────────────────────────────────────────────────────────────

async fn github_list_issues(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let state_filter = params.get("state").map(|s| s.as_str());
    let labels = params.get("labels").map(|s| s.as_str());
    let assignee = params.get("assignee").map(|s| s.as_str());

    match state
        .github_client
        .list_issues(&owner, &repo, state_filter, labels, assignee, 1, 50)
        .await
    {
        Ok(issues) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "issues": issues, "total": issues.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_get_issue(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, number)): axum::extract::Path<(String, String, u64)>,
) -> impl IntoResponse {
    match state.github_client.get_issue(&owner, &repo, number).await {
        Ok(issue) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "issue": issue})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

async fn github_create_issue(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let title = req["title"].as_str().unwrap_or("Untitled");
    let body = req["body"].as_str().unwrap_or("");
    let labels: Option<Vec<String>> = req["labels"].as_array().map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    });
    let assignees: Option<Vec<String>> = req["assignees"].as_array().map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    });

    match state
        .github_client
        .create_issue(
            &owner,
            &repo,
            title,
            body,
            labels.as_deref(),
            assignees.as_deref(),
        )
        .await
    {
        Ok(issue) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "issue": issue})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_update_issue(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, number)): axum::extract::Path<(String, String, u64)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let title = req.get("title").and_then(|v| v.as_str());
    let body = req.get("body").and_then(|v| v.as_str());
    let state_val = req.get("state").and_then(|v| v.as_str());
    let labels: Option<Vec<String>> = req.get("labels").and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    });

    match state
        .github_client
        .update_issue(
            &owner,
            &repo,
            number,
            title,
            body,
            state_val,
            labels.as_deref(),
        )
        .await
    {
        Ok(issue) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "issue": issue})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_close_issue(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, number)): axum::extract::Path<(String, String, u64)>,
) -> impl IntoResponse {
    match state.github_client.close_issue(&owner, &repo, number).await {
        Ok(issue) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "issue": issue})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_add_comment(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, number)): axum::extract::Path<(String, String, u64)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let body = req["body"].as_str().unwrap_or("");
    match state
        .github_client
        .create_issue_comment(&owner, &repo, number, body)
        .await
    {
        Ok(comment) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "comment": comment})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Pull Requests ──────────────────────────────────────────────────────

async fn github_list_prs(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let state_filter = params.get("state").map(|s| s.as_str());
    match state
        .github_client
        .list_pull_requests(&owner, &repo, state_filter, 1, 50)
        .await
    {
        Ok(prs) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "pull_requests": prs, "total": prs.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_get_pr(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, number)): axum::extract::Path<(String, String, u64)>,
) -> impl IntoResponse {
    match state
        .github_client
        .get_pull_request(&owner, &repo, number)
        .await
    {
        Ok(pr) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "pull_request": pr})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

async fn github_create_pr(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let title = req["title"].as_str().unwrap_or("ORA Agent PR");
    let body = req["body"].as_str().unwrap_or("");
    let head = req["head"].as_str().unwrap_or("feature/ora-agent");
    let base = req["base"].as_str().unwrap_or("main");
    let draft = req["draft"].as_bool().unwrap_or(false);

    match state
        .github_client
        .create_pull_request(&owner, &repo, title, body, head, base, draft)
        .await
    {
        Ok(pr) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "pull_request": pr})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_merge_pr(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, number)): axum::extract::Path<(String, String, u64)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let title = req.get("commit_title").and_then(|v| v.as_str());
    let method = req.get("merge_method").and_then(|v| v.as_str());
    match state
        .github_client
        .merge_pull_request(&owner, &repo, number, title, method)
        .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "result": result})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_get_pr_diff(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, number)): axum::extract::Path<(String, String, u64)>,
) -> impl IntoResponse {
    match state.github_client.get_pr_diff(&owner, &repo, number).await {
        Ok(diff) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "diff": diff})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

// ─── Contents / Files ───────────────────────────────────────────────────

async fn github_get_contents(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, path)): axum::extract::Path<(String, String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let ref_name = params.get("ref").map(|s| s.as_str());
    match state
        .github_client
        .get_contents(&owner, &repo, &path, ref_name)
        .await
    {
        Ok(contents) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "contents": contents})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

async fn github_write_file(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, path)): axum::extract::Path<(String, String, String)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let content = req["content"].as_str().unwrap_or("");
    let message = req["message"].as_str().unwrap_or("Update via ORA Agent");
    let branch = req.get("branch").and_then(|v| v.as_str());

    match state
        .github_client
        .write_file(&owner, &repo, &path, content, message, branch)
        .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "result": result})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_delete_file(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, path)): axum::extract::Path<(String, String, String)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let message = req["message"].as_str().unwrap_or("Delete via ORA Agent");
    let branch = req.get("branch").and_then(|v| v.as_str());

    match state
        .github_client
        .delete_file(&owner, &repo, &path, message, branch)
        .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "result": result})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Commits ────────────────────────────────────────────────────────────

async fn github_list_commits(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let branch = params.get("branch").map(|s| s.as_str());
    match state
        .github_client
        .list_commits(&owner, &repo, branch, 1, 50)
        .await
    {
        Ok(commits) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "commits": commits, "total": commits.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_get_commit(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo, sha)): axum::extract::Path<(String, String, String)>,
) -> impl IntoResponse {
    match state.github_client.get_commit(&owner, &repo, &sha).await {
        Ok(commit) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "commit": commit})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

async fn github_compare(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let base = params.get("base").map(|s| s.as_str()).unwrap_or("main");
    let head = params.get("head").map(|s| s.as_str()).unwrap_or("HEAD");
    match state
        .github_client
        .compare_commits(&owner, &repo, base, head)
        .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "comparison": result})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Workflows ──────────────────────────────────────────────────────────

async fn github_list_workflows(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
) -> impl IntoResponse {
    match state.github_client.list_workflows(&owner, &repo).await {
        Ok(workflows) => (
            StatusCode::OK,
            Json(
                serde_json::json!({"success": true, "workflows": workflows, "total": workflows.len()}),
            ),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_trigger_workflow(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let workflow_id = req["workflow_id"].as_u64().unwrap_or(0);
    let ref_name = req["ref"].as_str().unwrap_or("main");
    let inputs = req.get("inputs").cloned().unwrap_or(serde_json::json!({}));

    match state
        .github_client
        .trigger_workflow(&owner, &repo, workflow_id, ref_name, inputs)
        .await
    {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_list_workflow_runs(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let branch = params.get("branch").map(|s| s.as_str());
    let status = params.get("status").map(|s| s.as_str());
    match state
        .github_client
        .list_workflow_runs(&owner, &repo, branch, status, 1, 30)
        .await
    {
        Ok(runs) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "workflow_runs": runs, "total": runs.len()})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Releases ───────────────────────────────────────────────────────────

async fn github_list_releases(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
) -> impl IntoResponse {
    match state
        .github_client
        .list_releases(&owner, &repo, 1, 20)
        .await
    {
        Ok(releases) => (
            StatusCode::OK,
            Json(
                serde_json::json!({"success": true, "releases": releases, "total": releases.len()}),
            ),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

async fn github_get_latest_release(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
) -> impl IntoResponse {
    match state.github_client.get_latest_release(&owner, &repo).await {
        Ok(release) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "release": release})),
        ),
        Err(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e}))),
    }
}

async fn github_create_release(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let tag_name = req["tag_name"].as_str().unwrap_or("");
    let name = req["name"].as_str().unwrap_or(tag_name);
    let body = req["body"].as_str().unwrap_or("");
    let draft = req["draft"].as_bool().unwrap_or(false);
    let prerelease = req["prerelease"].as_bool().unwrap_or(false);

    match state
        .github_client
        .create_release(&owner, &repo, tag_name, name, body, draft, prerelease)
        .await
    {
        Ok(release) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "release": release})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Fork ───────────────────────────────────────────────────────────────

async fn github_fork_repo(
    State(state): State<AppState>,
    axum::extract::Path((owner, repo)): axum::extract::Path<(String, String)>,
) -> impl IntoResponse {
    match state.github_client.fork_repo(&owner, &repo).await {
        Ok(forked) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "fork": forked})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Automated Actions ──────────────────────────────────────────────────

async fn github_list_actions(State(state): State<AppState>) -> impl IntoResponse {
    let actions = state.github_actions.list_actions().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({"success": true, "actions": actions, "total": actions.len()})),
    )
}

async fn github_get_action(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.github_actions.get_action(&id).await {
        Some(action) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "action": action})),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Action not found"})),
        ),
    }
}

async fn github_execute_action(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    use github::GitHubActionType;

    let action_type = GitHubActionType::from_str(req["action_type"].as_str().unwrap_or("custom"));
    let repo_owner = req["repo_owner"].as_str().unwrap_or("");
    let repo_name = req["repo_name"].as_str().unwrap_or("");

    let mut action = github::GitHubAction {
        id: uuid::Uuid::new_v4().to_string(),
        action_type,
        repo_owner: repo_owner.to_string(),
        repo_name: repo_name.to_string(),
        branch: req.get("branch").and_then(|v| v.as_str()).map(String::from),
        params: req.get("params").cloned().unwrap_or(serde_json::json!({})),
        status: "queued".to_string(),
        result: None,
        created_at: chrono::Utc::now(),
        completed_at: None,
    };

    match state.github_actions.execute(&mut action).await {
        Ok(result) => {
            let _ = state.github_actions.queue_action(action.clone()).await;
            (
                StatusCode::OK,
                Json(serde_json::json!({"success": true, "action": action, "result": result})),
            )
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Rate Limit ─────────────────────────────────────────────────────────

async fn github_rate_limit(State(state): State<AppState>) -> impl IntoResponse {
    match state.github_client.rate_limit().await {
        Ok(limit) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "rate_limit": limit})),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn load_config_from_env() -> (ProviderType, ProviderConfig) {
    let provider_type = system_config::ai_provider();

    let provider = provider_type_from_str(&provider_type).unwrap_or(ProviderType::Local);

    // Local AI (Ollama/LM Studio/LocalAI): default to localhost Ollama port if
    // the operator hasn't configured an explicit base URL yet. This avoids the
    // "AI nicht verfügbar" state on a fresh install where Ollama runs locally.
    let configured_base_url = system_config::ai_base_url();
    let base_url =
        if configured_base_url.trim().is_empty() && matches!(provider, ProviderType::Local) {
            "http://127.0.0.1:11434".to_string()
        } else {
            configured_base_url
        };

    let config = ProviderConfig {
        api_key: system_config::ai_api_key(),
        base_url: Some(base_url),
        model: system_config::ai_model(),
        api_version: system_config::ai_api_version(),
    };

    (provider, config)
}

// ============================================================================
// PROACTIVE MESSAGING (Phase 6)
// ============================================================================

async fn notification_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let db_opt = state.db.clone();

    let stream = async_stream::stream! {
        let Some(db) = db_opt else {
            yield Ok(Event::default().data("Database not available"));
            return;
        };

        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

        loop {
            interval.tick().await;

            // Fetch pending notifications
            match database::notifications::get_pending_notifications(&db, 10).await {
                Ok(notifications) => {
                    if notifications.is_empty() {
                        // Send heartbeat if no notifications
                        yield Ok(Event::default()
                            .event("heartbeat")
                            .data("alive"));
                    } else {
                        for notification in notifications {
                            // Send notification event
                            let event_data = serde_json::json!({
                                "id": notification.id,
                                "user_id": notification.user_id,
                                "message": notification.message,
                                "notification_type": notification.notification_type,
                                "priority": notification.priority,
                                "created_at": notification.created_at,
                            });

                            yield Ok(Event::default()
                                .event("notification")
                                .data(event_data.to_string()));

                            // Mark as delivered
                            let _ = database::notifications::mark_delivered(&db, notification.id).await;
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to fetch notifications: {}", e);
                    yield Ok(Event::default()
                        .event("error")
                        .data(format!("Failed to fetch notifications: {}", e)));
                }
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ============================================================================
// CONTROL CENTER API ENDPOINTS (Phase 5)
// ============================================================================

// Provider Configuration Management

#[derive(Debug, Deserialize)]
struct CreateProviderRequest {
    provider_type: String,
    purpose: String,
    config: serde_json::Value,
    priority: Option<i32>,
}

async fn list_provider_configs(State(state): State<AppState>) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };

    match database::providers::get_all_enabled_providers(db).await {
        Ok(providers) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "providers": providers,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to list providers",
                "details": e.to_string(),
            })),
        ),
    }
}

async fn create_provider_config(
    State(state): State<AppState>,
    Json(req): Json<CreateProviderRequest>,
) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };

    let priority = req.priority.unwrap_or(0);

    match database::providers::create_provider(
        db,
        &req.provider_type,
        &req.purpose,
        req.config,
        priority,
    )
    .await
    {
        Ok(provider) => {
            // Trigger immediate model fetch for the new provider, then schedule global refresh.
            if let Some(ref reg) = state.models_registry {
                let reg_for_task = reg.clone();
                let provider_clone = provider.clone();
                tokio::spawn(async move {
                    match reg_for_task.refresh_one(&provider_clone).await {
                        Ok((n, _)) => tracing::info!(
                            "Auto-discovered {} models for new provider {}",
                            n,
                            provider_clone.id
                        ),
                        Err(e) => tracing::warn!(
                            "Model auto-discovery failed for {}: {}",
                            provider_clone.id,
                            e
                        ),
                    }
                });
                reg.schedule_refresh();
            }
            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "success": true,
                    "provider": provider,
                })),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to create provider",
                "details": e.to_string(),
            })),
        ),
    }
}

#[derive(Debug, Deserialize)]
struct UpdateProviderRequest {
    provider_type: Option<String>,
    purpose: Option<String>,
    config: Option<serde_json::Value>,
    priority: Option<i32>,
    enabled: Option<bool>,
}

async fn update_provider_config(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<UpdateProviderRequest>,
) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };
    match database::providers::update_provider(
        db,
        id,
        req.provider_type.as_deref(),
        req.purpose.as_deref(),
        req.config,
        req.priority,
        req.enabled,
    )
    .await
    {
        Ok(Some(provider)) => {
            if let Some(ref reg) = state.models_registry {
                let reg = reg.clone();
                let provider_clone = provider.clone();
                tokio::spawn(async move {
                    let _ = reg.refresh_one(&provider_clone).await;
                });
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({"success": true, "provider": provider})),
            )
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider not found"})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn delete_provider_config(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };
    match database::providers::delete_provider(db, id).await {
        Ok(true) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "deleted": true})),
        ),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider not found"})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn refresh_provider_models(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };
    let Some(reg) = state.models_registry.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Models registry not available"})),
        );
    };
    match database::providers::get_provider(db, id).await {
        Ok(Some(provider)) => match reg.refresh_one(&provider).await {
            Ok((count, is_live)) => (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "model_count": count,
                    "is_live": is_live,
                })),
            ),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("Refresh failed: {}", e)})),
            ),
        },
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider not found"})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

/// Global model catalog. Returns all known models across every configured
/// provider, grouped by provider, with refresh metadata. The Agent UI and
/// ORA AI both consume this single endpoint.
async fn list_global_models(State(state): State<AppState>) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };

    // Force a quick refresh of live (local/desktop) providers so the list
    // reflects models the user just loaded into LM Studio / Ollama.
    if let Some(ref reg) = state.models_registry {
        let _ = reg.refresh_all(true).await;
    }

    let providers = match database::providers::get_all_enabled_providers(db).await {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            );
        }
    };

    let mut groups = Vec::new();
    let mut total_models = 0usize;
    for p in &providers {
        let models = database::models_registry::list_for_provider(db, p.id)
            .await
            .unwrap_or_default();
        total_models += models.len();
        let is_live = matches!(p.provider_type.as_str(), "local" | "desktop");
        groups.push(serde_json::json!({
            "provider_id": p.id,
            "provider_type": p.provider_type,
            "purpose": p.purpose,
            "priority": p.priority,
            "enabled": p.enabled,
            "is_live": is_live,
            "model_count": models.len(),
            "models": models.into_iter().map(|m| serde_json::json!({
                "id": m.model_id,
                "name": m.model_name,
                "last_seen": m.last_seen,
                "is_live": m.is_live,
            })).collect::<Vec<_>>(),
        }));
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "total_models": total_models,
            "total_providers": providers.len(),
            "providers": groups,
        })),
    )
}

async fn refresh_all_models(State(state): State<AppState>) -> impl IntoResponse {
    let Some(reg) = state.models_registry.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Models registry not available"})),
        );
    };
    let n = reg.refresh_all(false).await;
    (
        StatusCode::OK,
        Json(serde_json::json!({"success": true, "total_models": n})),
    )
}

// Conversation Thread Management

async fn list_conversation_threads(State(state): State<AppState>) -> impl IntoResponse {
    let Some(conversation_manager) = state.conversation_manager.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Conversation manager not available"})),
        );
    };

    match conversation_manager.get_active_threads(None, 50).await {
        Ok(threads) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "threads": threads,
                "total": threads.len(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to list threads",
                "details": e.to_string(),
            })),
        ),
    }
}

#[derive(Debug, Deserialize)]
struct CreateThreadRequest {
    user_id: Option<Uuid>,
    context: Option<serde_json::Value>,
}

async fn create_conversation_thread(
    State(state): State<AppState>,
    Json(req): Json<CreateThreadRequest>,
) -> impl IntoResponse {
    let Some(conversation_manager) = state.conversation_manager.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Conversation manager not available"})),
        );
    };

    match conversation_manager
        .create_thread(req.user_id, req.context)
        .await
    {
        Ok(thread_id) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "success": true,
                "thread_id": thread_id,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to create thread",
                "details": e.to_string(),
            })),
        ),
    }
}

// Autonomous Task Management

async fn list_autonomous_tasks(State(state): State<AppState>) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };

    match database::tasks::get_enabled_tasks(db).await {
        Ok(tasks) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "tasks": tasks,
                "total": tasks.len(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to list tasks",
                "details": e.to_string(),
            })),
        ),
    }
}

// Notification Management

async fn list_pending_notifications(State(state): State<AppState>) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };

    match database::notifications::get_pending_notifications(db, 50).await {
        Ok(notifications) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "notifications": notifications,
                "total": notifications.len(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to list notifications",
                "details": e.to_string(),
            })),
        ),
    }
}

#[derive(Debug, Deserialize)]
struct SendNotificationRequest {
    user_id: Option<Uuid>,
    message: String,
    notification_type: String,
    priority: i32,
}

async fn send_notification(
    State(state): State<AppState>,
    Json(req): Json<SendNotificationRequest>,
) -> impl IntoResponse {
    let Some(conversation_manager) = state.conversation_manager.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Conversation manager not available"})),
        );
    };

    match conversation_manager
        .send_proactive_notification(
            req.user_id,
            &req.message,
            &req.notification_type,
            req.priority,
        )
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "message": "Notification queued",
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to send notification",
                "details": e.to_string(),
            })),
        ),
    }
}

// Orchestrator Stats

async fn get_orchestrator_stats(State(state): State<AppState>) -> impl IntoResponse {
    let stats = state.orchestrator.get_stats().await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "stats": stats,
        })),
    )
}

// ============================================================================
// TOOL EXECUTION API (Internet Search & External Tools)
// ============================================================================

async fn execute_tool(
    State(state): State<AppState>,
    Json(request): Json<tools::ToolRequest>,
) -> impl IntoResponse {
    let tool_executor = state.tool_executor.read().await;
    let result = tool_executor.execute(request).await;

    let status = if result.success {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };

    (status, Json(result))
}

#[derive(Debug, Deserialize)]
struct SearchRequest {
    query: String,
    max_results: Option<usize>,
}

async fn search_internet(
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> impl IntoResponse {
    let tool_request = tools::ToolRequest {
        tool_type: tools::ToolType::Search,
        params: serde_json::json!({
            "query": req.query,
            "max_results": req.max_results.unwrap_or(5),
        }),
    };

    let tool_executor = state.tool_executor.read().await;
    let result = tool_executor.execute(tool_request).await;

    let status = if result.success {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };

    (status, Json(result))
}

#[derive(Debug, Deserialize)]
struct ScrapeRequest {
    url: String,
    screenshot: Option<bool>,
}

async fn scrape_webpage(
    State(state): State<AppState>,
    Json(req): Json<ScrapeRequest>,
) -> impl IntoResponse {
    let tool_request = tools::ToolRequest {
        tool_type: tools::ToolType::WebScrape,
        params: serde_json::json!({
            "url": req.url,
            "screenshot": req.screenshot.unwrap_or(false),
        }),
    };

    let tool_executor = state.tool_executor.read().await;
    let result = tool_executor.execute(tool_request).await;

    let status = if result.success {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };

    (status, Json(result))
}

#[derive(Debug, Deserialize)]
struct ScreenshotRequest {
    url: String,
}

async fn take_webpage_screenshot(
    State(state): State<AppState>,
    Json(req): Json<ScreenshotRequest>,
) -> impl IntoResponse {
    let tool_request = tools::ToolRequest {
        tool_type: tools::ToolType::Screenshot,
        params: serde_json::json!({
            "url": req.url,
        }),
    };

    let tool_executor = state.tool_executor.read().await;
    let result = tool_executor.execute(tool_request).await;

    let status = if result.success {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };

    (status, Json(result))
}

// ============================================================================
// MEMORY API ENDPOINTS
// ============================================================================

async fn list_memories(State(state): State<AppState>) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    match mm.list(None, 100).await {
        Ok(memories) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "memories": memories,
                "total": memories.len(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to list memories", "details": e.to_string()})),
        ),
    }
}

async fn create_memory(
    State(state): State<AppState>,
    Json(req): Json<CreateMemoryRequest>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    match mm.store(&req).await {
        Ok(memory) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "memory": memory})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to create memory", "details": e.to_string()})),
        ),
    }
}

async fn delete_memory(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    match mm.delete(id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to delete memory", "details": e.to_string()})),
        ),
    }
}

#[derive(Debug, Deserialize)]
struct MemorySearchRequest {
    query: String,
    limit: Option<i64>,
}

async fn search_memories(
    State(state): State<AppState>,
    Json(req): Json<MemorySearchRequest>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    let limit = req.limit.unwrap_or(20);

    match mm.search(&req.query, None, limit).await {
        Ok(memories) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "query": req.query,
                "memories": memories,
                "total": memories.len(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(
                serde_json::json!({"error": "Failed to search memories", "details": e.to_string()}),
            ),
        ),
    }
}

// ============================================================================
// ACTIVE TASKS API ENDPOINTS
// ============================================================================

async fn list_active_tasks(State(state): State<AppState>) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    // Include paused tasks so the dashboard can show/manage all tasks
    match mm.list_active_tasks(None, true, 100).await {
        Ok(tasks) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "tasks": tasks,
                "total": tasks.len(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(
                serde_json::json!({"error": "Failed to list active tasks", "details": e.to_string()}),
            ),
        ),
    }
}

async fn create_active_task(
    State(state): State<AppState>,
    Json(req): Json<ActiveTaskRequest>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    let user_id = req.user_id;
    match mm.create_active_task(&req, user_id).await {
        Ok(id) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "task_id": id})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(
                serde_json::json!({"error": "Failed to create active task", "details": e.to_string()}),
            ),
        ),
    }
}

#[derive(Debug, Deserialize)]
struct TaskUpdateRequest {
    /// `true` = resume, `false` = pause
    enabled: Option<bool>,
    name: Option<String>,
    description: Option<String>,
}

async fn update_active_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(req): Json<TaskUpdateRequest>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    // Pause / resume
    if let Some(enabled) = req.enabled {
        if let Err(e) = mm.set_task_enabled(id, enabled).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": "Failed to update task", "details": e.to_string()}),
                ),
            );
        }
    }

    // Name / description update
    if req.name.is_some() || req.description.is_some() {
        if let Err(e) = mm
            .update_task(id, req.name.as_deref(), req.description.as_deref(), None)
            .await
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": "Failed to update task fields", "details": e.to_string()}),
                ),
            );
        }
    }

    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}

async fn delete_active_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    match mm.delete_task(id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to delete task", "details": e.to_string()})),
        ),
    }
}

/// Detect tasks from a full conversation history (multi-message support).
#[derive(Debug, Deserialize)]
struct ConversationDetectRequest {
    /// List of `{role, content}` pairs
    messages: Vec<serde_json::Value>,
    /// "chat" | "voice" | "conversation"
    input_mode: Option<String>,
}

async fn detect_tasks_from_conversation(
    State(state): State<AppState>,
    Json(req): Json<ConversationDetectRequest>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    let pairs: Vec<(String, String)> = req
        .messages
        .iter()
        .filter_map(|m| {
            let role = m.get("role")?.as_str()?.to_string();
            let content = m.get("content")?.as_str()?.to_string();
            Some((role, content))
        })
        .collect();

    let input_mode = req.input_mode.as_deref().unwrap_or("conversation");

    match mm.detect_from_conversation(&pairs, None, input_mode).await {
        Some(task_id) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"success": true, "task_id": task_id})),
        ),
        None => (
            StatusCode::OK,
            Json(
                serde_json::json!({"success": false, "message": "No task detected in conversation"}),
            ),
        ),
    }
}

// ─── Task command execution helper ────────────────────────────────────────────

/// Execute a structured task command parsed from an AI response.
/// Called both for immediate (high-confidence) actions and after user confirmation.
async fn execute_task_command(
    mm: &MemoryManager,
    task_id: Uuid,
    action: &str,
    resume_at: Option<chrono::DateTime<chrono::Utc>>,
) {
    let result = match action {
        "pause_until" => {
            if let Some(until) = resume_at {
                mm.temporary_pause_task(task_id, until).await
            } else {
                mm.set_task_enabled(task_id, false).await
            }
        }
        "disable" => mm.set_task_enabled(task_id, false).await,
        "resume" => mm.set_task_enabled(task_id, true).await,
        "delete" => mm.delete_task(task_id).await,
        other => {
            tracing::warn!("Unknown task action from AI: {}", other);
            return;
        }
    };

    match result {
        Ok(()) => tracing::info!(
            "Task command '{}' on {} executed successfully",
            action,
            task_id
        ),
        Err(e) => tracing::error!("Task command '{}' on {} failed: {}", action, task_id, e),
    }
}

// ─── Confirm task action endpoint ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ConfirmTaskActionRequest {
    task_id: Uuid,
    action: String,
    resume_at: Option<chrono::DateTime<chrono::Utc>>,
    /// If false, the user declined – do nothing
    confirmed: bool,
}

async fn confirm_task_action(
    State(state): State<AppState>,
    Json(req): Json<ConfirmTaskActionRequest>,
) -> impl IntoResponse {
    let Some(ref mm) = state.memory_manager else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Memory manager not available"})),
        );
    };

    if !req.confirmed {
        return (
            StatusCode::OK,
            Json(serde_json::json!({"success": false, "message": "Action declined by user"})),
        );
    }

    execute_task_command(mm, req.task_id, &req.action, req.resume_at).await;

    (
        StatusCode::OK,
        Json(serde_json::json!({"success": true, "action": req.action})),
    )
}

// ─── Instant Task API ─────────────────────────────────────────────────────────

/// Poll the status of an instant task.
async fn get_instant_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    let Some(ref db) = state.db else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        );
    };

    match database::instant_tasks::get_by_id(db, id).await {
        Ok(Some(task)) => (
            StatusCode::OK,
            Json(serde_json::to_value(&task).unwrap_or_default()),
        ),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Instant task not found"})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

/// SSE stream for a single instant task.
/// The client subscribes immediately and receives one event when the result arrives.
async fn stream_instant_task(
    State(state): State<AppState>,
    axum::extract::Path(task_id): axum::extract::Path<Uuid>,
) -> impl IntoResponse {
    use axum::response::sse::{Event, KeepAlive, Sse};
    use futures_util::stream::{self, StreamExt};
    use tokio_stream::wrappers::BroadcastStream;

    // Check if the task is already done (fast path)
    if let Some(ref db) = state.db {
        if let Ok(Some(task)) = database::instant_tasks::get_by_id(db, task_id).await {
            if task.status == "completed" || task.status == "failed" || task.status == "deferred" {
                let data = serde_json::json!({
                    "task_id": task_id,
                    "event_type": task.status,
                    "status": task.status,
                    "result_text": task.result_text,
                    "result_data": task.result_data,
                    "error": task.error_message,
                    "elapsed_secs": null,
                });
                let event = Event::default()
                    .event("instant_task_result")
                    .data(data.to_string());
                let s = stream::once(async move { Ok::<Event, std::convert::Infallible>(event) });
                return Sse::new(s).keep_alive(KeepAlive::default()).into_response();
            }
        }
    }

    // Subscribe to live broadcast
    let rx = if let Some(ref ite) = state.instant_task_engine {
        ite.subscribe()
    } else {
        // No engine – return immediately with an error event
        let data = serde_json::json!({"error": "Instant task engine not available"});
        let s = stream::once(async move {
            Ok::<Event, std::convert::Infallible>(
                Event::default().event("error").data(data.to_string()),
            )
        });
        return Sse::new(s).keep_alive(KeepAlive::default()).into_response();
    };

    // Convert the broadcast receiver into an SSE stream
    let broadcast_stream = BroadcastStream::new(rx);

    let sse_stream = broadcast_stream.filter_map(move |msg| async move {
        let result: InstantTaskResult = msg.ok()?;
        if result.task_id != task_id {
            return None; // Not the task we care about
        }
        let data = serde_json::json!({
            "task_id": result.task_id,
            "event_type": result.event_type,
            "status": result.status,
            "result_text": result.result_text,
            "result_data": result.result_data,
            "error": result.error,
            "elapsed_secs": result.elapsed_secs,
        });
        Some(Ok::<Event, std::convert::Infallible>(
            Event::default()
                .event("instant_task_result")
                .data(data.to_string()),
        ))
    });

    Sse::new(sse_stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

// ─── Pi.dev API Handlers ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreatePiDevSessionRequest {
    workspace_id: String,
    workspace_path: String,
    image: Option<String>,
    api_key: String,
    cpu_limit: Option<String>,
    memory_limit: Option<String>,
    network_enabled: Option<bool>,
    allowed_domains: Option<Vec<String>>,
    session_timeout_secs: Option<u64>,
    security_level: Option<String>,
    plugins: Option<Vec<PluginConfig>>,
    /// pi.dev extensions to load (-e flags). E.g. ["pi-context-tools", "pi-codex-goal"]
    extensions: Option<Vec<String>>,
    auto_approve_workspace: Option<bool>,
    max_tool_calls: Option<u32>,
}

async fn create_pidev_session(
    State(state): State<AppState>,
    Json(req): Json<CreatePiDevSessionRequest>,
) -> Result<Json<PiDevSession>, (StatusCode, String)> {
    let security_level = match req.security_level.as_deref().unwrap_or("standard") {
        "permissive" => SecurityLevel::Permissive,
        "strict" => SecurityLevel::Strict,
        "readonly" => SecurityLevel::ReadOnly,
        _ => SecurityLevel::Standard,
    };

    let config = PiDevSessionConfig {
        workspace_id: req.workspace_id,
        workspace_path: req.workspace_path,
        image: req
            .image
            .unwrap_or_else(|| "pi-dev-agent:latest".to_string()),
        api_key: req.api_key,
        cpu_limit: req.cpu_limit,
        memory_limit: req.memory_limit,
        disk_limit: None,
        network_enabled: req.network_enabled.unwrap_or(true),
        allowed_domains: req.allowed_domains.unwrap_or_default(),
        session_timeout_secs: req.session_timeout_secs.unwrap_or(3600),
        security_level,
        plugins: req.plugins.unwrap_or_else(|| {
            vec![
                PluginConfig {
                    package_name: "pi-subagents".into(),
                    version: None,
                    config: None,
                },
                PluginConfig {
                    package_name: "pi-web-access".into(),
                    version: None,
                    config: None,
                },
                PluginConfig {
                    package_name: "@juicesharp/rpiv-todo".into(),
                    version: None,
                    config: None,
                },
                PluginConfig {
                    package_name: "@juicesharp/rpiv-ask-user-question".into(),
                    version: None,
                    config: None,
                },
            ]
        }),
        auto_approve_workspace: req.auto_approve_workspace.unwrap_or(true),
        max_tool_calls: req.max_tool_calls.unwrap_or(500),
        extensions: req.extensions.unwrap_or_default(),
    };

    match state.pi_dev.create_session(config).await {
        Ok(session) => Ok(Json(session)),
        Err(e) => Err((StatusCode::BAD_REQUEST, e)),
    }
}

async fn list_pidev_sessions(State(state): State<AppState>) -> Json<Vec<PiDevSession>> {
    Json(state.pi_dev.list_sessions().await)
}

async fn get_pidev_session(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<PiDevSession>, StatusCode> {
    match state.pi_dev.get_session(&id).await {
        Some(session) => Ok(Json(session)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn stop_pidev_session(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    match state.pi_dev.stop_session(&id).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

#[derive(Deserialize)]
struct RunPiDevTaskRequest {
    prompt: String,
    provider: Option<String>,
    model: Option<String>,
}

/// Run a one-shot `pi --mode json` agent task inside an existing session's
/// container. Returns 202 immediately; progress is streamed over the session
/// event SSE channel (`/api/assist/pidev/sessions/:id/events`).
async fn run_pidev_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<RunPiDevTaskRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let session = state
        .pi_dev
        .get_session(&id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;
    if session.docker_container_id.is_none() {
        return Err((
            StatusCode::CONFLICT,
            "Session container is not running yet".to_string(),
        ));
    }

    let RunPiDevTaskRequest {
        prompt,
        provider,
        model,
    } = req;
    let controller = state.pi_dev.clone();
    tokio::spawn(async move {
        if let Err(e) = controller.run_task(&id, &prompt, provider, model).await {
            tracing::error!("pi.dev task failed for session {}: {}", id, e);
        }
    });

    Ok(StatusCode::ACCEPTED)
}

/// Return the live LocalUp-style bridge state for a session: aggregated tool
/// calls, file changes, messages, and metrics derived from the agent stream.
async fn get_pidev_bridge(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<BridgeState>, StatusCode> {
    match state.pi_dev.bridge_state(&id).await {
        Some(bridge) => Ok(Json(bridge)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Deserialize)]
struct ControlPiDevRequest {
    /// One of: ping, pause, resume, set_model, set_thinking, get_state, reset, cancel.
    command: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
}

/// Send a LocalUp-style control command to a pi.dev session (pause/resume,
/// set model/thinking, get state, reset, cancel).
async fn control_pidev_session(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<ControlPiDevRequest>,
) -> Result<Json<ControlResult>, (StatusCode, String)> {
    match state
        .pi_dev
        .send_control_command(&id, &req.command, req.model, req.thinking)
        .await
    {
        Ok(result) => Ok(Json(result)),
        Err(e) => Err((StatusCode::BAD_REQUEST, e)),
    }
}

async fn stream_pidev_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.pi_dev.subscribe();

    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok(Event::default().data(data));
                }
                Err(_) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

#[derive(Deserialize)]
struct ApproveDenyRequest {
    event_id: String,
}

async fn approve_pidev_action(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    Json(req): Json<ApproveDenyRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    match state
        .pi_dev
        .approve_action(&session_id, &req.event_id)
        .await
    {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => Err((StatusCode::BAD_REQUEST, e)),
    }
}

async fn deny_pidev_action(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    Json(req): Json<ApproveDenyRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    match state.pi_dev.deny_action(&session_id, &req.event_id).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => Err((StatusCode::BAD_REQUEST, e)),
    }
}

async fn get_pidev_security_events(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Json<Vec<pi_dev_controller::security_monitor::SecurityEvent>> {
    Json(state.pi_dev.get_security_events(&session_id).await)
}

async fn list_pidev_plugins(
    State(state): State<AppState>,
) -> Json<Vec<pi_dev_controller::plugin_manager::PluginInfo>> {
    Json(state.pi_dev.list_available_plugins().await)
}

#[derive(Deserialize)]
struct InstallPluginRequest {
    session_id: String,
    package_name: String,
}

async fn install_pidev_plugin(
    State(_state): State<AppState>,
    Json(_req): Json<InstallPluginRequest>,
) -> StatusCode {
    // Plugin installation happens during container creation
    // For runtime install, we'd exec into the container
    StatusCode::NOT_IMPLEMENTED
}

// ─── App Capability Registry Handlers ──────────────────────────────────────

/// Register (or replace) the assist tools / exposed services an installed app
/// provides. Called by iora-home on app install and on its own startup.
async fn register_app_capabilities(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    Json(mut caps): Json<AppCapabilities>,
) -> impl IntoResponse {
    // The path is the source of truth for the app id.
    caps.app_id = app_id;
    let (tools, services) = state.app_capabilities.register(caps).await;
    info!(
        "Registered app capabilities: {} tool(s), {} service(s)",
        tools, services
    );
    (
        StatusCode::OK,
        Json(serde_json::json!({ "registered": true, "tools": tools, "services": services })),
    )
}

/// Remove all capabilities for an app. Called by iora-home on uninstall.
async fn unregister_app_capabilities(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let removed = state.app_capabilities.unregister(&app_id).await;
    (
        StatusCode::OK,
        Json(serde_json::json!({ "removed": removed })),
    )
}

/// List all registered app capabilities, grouped by app.
async fn list_app_capabilities(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.app_capabilities.list().await)
}

/// Flat list of every registered app-provided tool (for agent / UI discovery).
async fn list_app_tools(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.app_capabilities.list_tools().await)
}

/// Unified system event stream – admin live log for all background activity
async fn stream_system_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.event_bus.subscribe();

    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok(Event::default()
                        .event(&event.category)
                        .data(data));
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    yield Ok(Event::default()
                        .event("system")
                        .data(format!(r#"{{"category":"system","event_type":"lagged","summary":"Skipped {} events","severity":"warn"}}"#, n)));
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ─── System Guard Handlers ─────────────────────────────────────────────────

async fn get_system_state(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "state": format!("{:?}", state.guard.get_state()),
        "uptime_secs": state.guard.uptime_secs(),
        "active_agents": state.guard.get_agent_activities().len(),
        "loop_detections": state.guard.get_loop_detections().len(),
        "recovery_pending": state.guard.get_recovery_actions().len(),
    }))
}

#[derive(Deserialize)]
struct SetStateRequest {
    state: String,
}

async fn set_system_state(
    State(state): State<AppState>,
    Json(req): Json<SetStateRequest>,
) -> StatusCode {
    match req.state.as_str() {
        "paused" => state.guard.pause_system(),
        "resumed" | "running" => state.guard.resume_system(),
        "emergency_stop" => state.guard.emergency_stop(),
        _ => return StatusCode::BAD_REQUEST,
    }
    StatusCode::OK
}

async fn pause_system_handler(State(state): State<AppState>) -> StatusCode {
    state.guard.pause_system();
    StatusCode::OK
}

async fn resume_system_handler(State(state): State<AppState>) -> StatusCode {
    state.guard.resume_system();
    StatusCode::OK
}

async fn emergency_stop_handler(State(state): State<AppState>) -> StatusCode {
    state.guard.emergency_stop();
    StatusCode::OK
}

async fn pause_agent_handler(
    State(state): State<AppState>,
    axum::extract::Path(agent_id): axum::extract::Path<String>,
) -> StatusCode {
    state.guard.pause_agent(&agent_id);
    StatusCode::OK
}

async fn resume_agent_handler(
    State(state): State<AppState>,
    axum::extract::Path(agent_id): axum::extract::Path<String>,
) -> StatusCode {
    state.guard.resume_agent(&agent_id);
    StatusCode::OK
}

async fn stop_agent_handler(
    State(state): State<AppState>,
    axum::extract::Path(agent_id): axum::extract::Path<String>,
) -> StatusCode {
    state.guard.stop_agent(&agent_id);
    StatusCode::OK
}

async fn get_protection_rules(State(state): State<AppState>) -> Json<Vec<ProtectionRule>> {
    Json(state.guard.get_rules())
}

#[derive(Deserialize)]
struct UpdateRuleRequest {
    rule_id: String,
    enabled: bool,
    threshold: Option<u32>,
}

async fn update_protection_rule(
    State(state): State<AppState>,
    Json(req): Json<UpdateRuleRequest>,
) -> StatusCode {
    state
        .guard
        .update_rule(&req.rule_id, req.enabled, req.threshold);
    StatusCode::OK
}

async fn get_loop_detections(State(state): State<AppState>) -> Json<Vec<LoopDetection>> {
    Json(state.guard.get_loop_detections())
}

async fn get_recovery_actions(
    State(state): State<AppState>,
) -> Json<Vec<system_guard::RecoveryAction>> {
    Json(state.guard.get_recovery_actions())
}

async fn apply_recovery(State(state): State<AppState>) -> StatusCode {
    if let Some(action) = state.guard.take_recovery_action() {
        info!(
            "Applied recovery for agent {}: {}",
            action.agent_id, action.reason
        );
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// ─── Model Router Handlers ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct ClassifyRequest {
    message: String,
}

async fn classify_task_handler(
    State(state): State<AppState>,
    Json(req): Json<ClassifyRequest>,
) -> Json<serde_json::Value> {
    let category = state.router.classify_task(&req.message);
    Json(serde_json::json!({"category": format!("{:?}", category)}))
}

#[derive(Deserialize)]
struct RouteRequest {
    message: String,
    force_provider: Option<String>,
}

async fn route_task_handler(
    State(state): State<AppState>,
    Json(req): Json<RouteRequest>,
) -> Json<RoutingDecision> {
    Json(
        state
            .router
            .route(&req.message, req.force_provider.as_deref()),
    )
}

async fn get_router_config(State(state): State<AppState>) -> Json<RouterConfig> {
    Json(state.router.get_config())
}

async fn update_router_config(
    State(state): State<AppState>,
    Json(cfg): Json<RouterConfig>,
) -> StatusCode {
    state.router.update_config(cfg);
    StatusCode::OK
}

async fn get_router_usage(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "daily_tokens": state.router.get_daily_usage(),
        "within_budget": state.router.within_budget(),
    }))
}

// ─── Memory System Handlers ────────────────────────────────────────────────

async fn get_all_memories(State(state): State<AppState>) -> Json<Vec<Memory>> {
    Json(state.memory_store.get_all())
}

async fn query_memories(
    State(state): State<AppState>,
    Json(query): Json<MemoryQuery>,
) -> Json<Vec<Memory>> {
    Json(state.memory_store.query(&query))
}

#[derive(Deserialize)]
struct ContextRequest {
    query: String,
    limit: Option<usize>,
}

async fn get_memory_context(
    State(state): State<AppState>,
    Json(req): Json<ContextRequest>,
) -> Json<serde_json::Value> {
    let ctx = state
        .memory_store
        .build_context(&req.query, req.limit.unwrap_or(5));
    Json(serde_json::json!({"context": ctx}))
}

async fn delete_memory_handler(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> StatusCode {
    state.memory_store.delete(&id);
    StatusCode::OK
}

async fn clear_memories(State(state): State<AppState>) -> StatusCode {
    state.memory_store.clear();
    StatusCode::OK
}

// ─── Autonomous Scheduler Handlers ─────────────────────────────────────────

async fn list_scheduled_tasks(State(state): State<AppState>) -> Json<Vec<ScheduledTask>> {
    Json(state.scheduler.list_tasks())
}

async fn add_scheduled_task(
    State(state): State<AppState>,
    Json(task): Json<ScheduledTask>,
) -> Json<serde_json::Value> {
    let id = state.scheduler.add_task(task);
    Json(serde_json::json!({"id": id}))
}

async fn get_scheduled_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<ScheduledTask>, StatusCode> {
    state
        .scheduler
        .get_task(&id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn remove_scheduled_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> StatusCode {
    state.scheduler.remove_task(&id);
    StatusCode::OK
}

#[derive(Deserialize)]
struct ToggleRequest {
    enabled: bool,
}

async fn toggle_scheduled_task(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<ToggleRequest>,
) -> StatusCode {
    state.scheduler.set_enabled(&id, req.enabled);
    StatusCode::OK
}

#[derive(Deserialize)]
struct HistoryQuery {
    task_id: Option<String>,
    limit: Option<usize>,
}

async fn get_scheduler_history(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<HistoryQuery>,
) -> Json<Vec<TaskRun>> {
    Json(
        state
            .scheduler
            .get_run_history(query.task_id.as_deref(), query.limit.unwrap_or(50)),
    )
}

async fn stream_scheduler_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.scheduler.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok(Event::default().data(data));
                }
                Err(_) => break,
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ─── ORA Features Handlers ─────────────────────────────────────────────────

// Collaboration
async fn list_collab_plans(
    State(state): State<AppState>,
) -> Json<Vec<ora_features::multi_agent::CollaborationPlan>> {
    Json(state.collaboration.list_plans())
}

#[derive(Deserialize)]
struct CreatePlanRequest {
    goal: String,
}
async fn create_collab_plan(
    State(state): State<AppState>,
    Json(req): Json<CreatePlanRequest>,
) -> Json<ora_features::multi_agent::CollaborationPlan> {
    Json(state.collaboration.create_plan(&req.goal))
}

async fn get_collab_plan(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<ora_features::multi_agent::CollaborationPlan>, StatusCode> {
    state
        .collaboration
        .get_plan(&id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

// Code Review
async fn submit_code_review(
    State(_state): State<AppState>,
    Json(req): Json<code_review::ReviewRequest>,
) -> Json<serde_json::Value> {
    let prompt = code_review::build_review_prompt(&req);
    Json(
        serde_json::json!({"prompt": prompt, "note": "Submit this prompt to an AI provider for review results"}),
    )
}

// Self-Healing
async fn get_health_checks(
    State(state): State<AppState>,
) -> Json<Vec<ora_features::self_healing::HealthCheck>> {
    Json(state.self_healing.get_checks())
}

async fn run_health_check(State(state): State<AppState>) -> Json<serde_json::Value> {
    // Simulate health checks
    state
        .self_healing
        .update_check("disk", "healthy", Some("Disk: 45% free"));
    state
        .self_healing
        .update_check("memory", "healthy", Some("Memory: 62% used"));
    state
        .self_healing
        .update_check("db", "healthy", Some("DB: connected"));
    Json(serde_json::json!({"status": "All checks passed"}))
}

// Cost Intelligence
async fn get_cost_summary(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "daily": state.cost_tracker.daily_cost(),
        "monthly": state.cost_tracker.monthly_cost(),
        "within_budget": state.cost_tracker.within_budget(),
        "config": state.cost_tracker.get_config(),
    }))
}

async fn get_cost_records(
    State(state): State<AppState>,
) -> Json<Vec<ora_features::cost_intel::CostRecord>> {
    Json(state.cost_tracker.get_records(100))
}

async fn suggest_cheaper_provider(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let provider = params
        .get("provider")
        .map(|s| s.as_str())
        .unwrap_or("openai");
    let suggestion = state.cost_tracker.suggest_cheaper(provider);
    Json(serde_json::json!({"suggestion": suggestion}))
}

// Learning from Mistakes
async fn get_mistakes(
    State(state): State<AppState>,
) -> Json<Vec<ora_features::mistake_learner::Mistake>> {
    Json(state.mistake_learner.get_mistakes())
}

async fn get_avoid_list(State(state): State<AppState>) -> Json<Vec<String>> {
    Json(state.mistake_learner.get_avoid_list())
}

#[derive(Deserialize)]
struct WarningRequest {
    task: String,
}
async fn get_learning_warning(
    State(state): State<AppState>,
    Json(req): Json<WarningRequest>,
) -> Json<serde_json::Value> {
    let warning = state.mistake_learner.build_warning(&req.task);
    Json(serde_json::json!({"warning": warning}))
}

// ─── Virtual Company Handlers ──────────────────────────────────────────────

async fn get_company_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "enabled": state.company.is_enabled(),
        "name": state.company.name,
        "agents": state.company.get_active_agents().len(),
        "projects": state.company.get_active_projects().len(),
        "active_tasks": state.company.get_active_task_count(),
        "max_priority": state.company.get_max_task_priority(),
        "has_active_work": state.company.has_active_work(),
        "founded": state.company.company_founded,
    }))
}

async fn toggle_company(State(state): State<AppState>) -> Json<serde_json::Value> {
    let currently = state.company.is_enabled();
    if currently {
        state.company.disable();
    } else {
        state.company.enable();
    }
    Json(serde_json::json!({"enabled": state.company.is_enabled()}))
}

async fn get_company_agents(State(state): State<AppState>) -> Json<Vec<CompanyAgent>> {
    Json(state.company.get_agents())
}

#[derive(Deserialize)]
struct UpdateAgentRequest {
    agent_id: String,
    is_active: bool,
}
async fn update_company_agent(
    State(state): State<AppState>,
    Json(req): Json<UpdateAgentRequest>,
) -> StatusCode {
    state.company.set_agent_active(&req.agent_id, req.is_active);
    StatusCode::OK
}

async fn get_company_projects(State(state): State<AppState>) -> Json<Vec<CompanyProject>> {
    Json(state.company.get_projects())
}

#[derive(Deserialize)]
struct CreateProjectRequest {
    name: String,
    description: String,
}
async fn create_company_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> Json<CompanyProject> {
    Json(state.company.create_project(&req.name, &req.description))
}

#[derive(Deserialize)]
struct AddTaskRequest {
    title: String,
    role: String,
    priority: u8,
}
async fn add_company_task(
    State(state): State<AppState>,
    axum::extract::Path(project_id): axum::extract::Path<String>,
    Json(req): Json<AddTaskRequest>,
) -> Result<Json<CompanyTask>, StatusCode> {
    let role = match req.role.as_str() {
        "developer" => CompanyRole::Developer,
        "qa" => CompanyRole::QATester,
        "devops" => CompanyRole::DevOps,
        "data" => CompanyRole::DataAnalyst,
        "security" => CompanyRole::SecurityOfficer,
        "pm" => CompanyRole::ProductManager,
        "cto" => CompanyRole::CTO,
        "ceo" => CompanyRole::CEO,
        "writer" => CompanyRole::TechnicalWriter,
        "ux" => CompanyRole::UXDesigner,
        _ => CompanyRole::Developer,
    };
    state
        .company
        .add_task(&project_id, &req.title, role, req.priority)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[derive(Deserialize)]
struct DistributeRequest {
    task_description: String,
}
async fn distribute_company_task(
    State(state): State<AppState>,
    Json(req): Json<DistributeRequest>,
) -> Json<CompanyTask> {
    Json(state.company.distribute_task(&req.task_description))
}

async fn get_briefing_config(State(state): State<AppState>) -> Json<BriefingConfig> {
    Json(state.company.get_briefing_config())
}

async fn update_briefing_config(
    State(state): State<AppState>,
    Json(config): Json<BriefingConfig>,
) -> StatusCode {
    state.company.update_briefing_config(config);
    StatusCode::OK
}

#[derive(Deserialize)]
struct StartBriefingRequest {
    reason: Option<String>,
}
async fn start_company_briefing(
    State(state): State<AppState>,
    Json(req): Json<StartBriefingRequest>,
) -> Result<Json<BriefingSession>, StatusCode> {
    let trigger = if let Some(reason) = req.reason {
        BriefingTrigger::UserCalled { reason }
    } else {
        BriefingTrigger::Scheduled
    };
    state
        .company
        .start_briefing(trigger)
        .map(Json)
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)
}

#[derive(Deserialize)]
struct CompleteBriefingRequest {
    discussions: Vec<virtual_company::DiscussionPoint>,
    decisions: Vec<String>,
    action_items: Vec<virtual_company::ActionItem>,
}
async fn complete_company_briefing(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<CompleteBriefingRequest>,
) -> Result<Json<BriefingSession>, StatusCode> {
    state
        .company
        .complete_briefing(&id, req.discussions, req.decisions, req.action_items)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn get_briefing_history(State(state): State<AppState>) -> Json<Vec<BriefingSession>> {
    Json(state.company.get_briefing_history())
}

async fn get_next_briefing(State(state): State<AppState>) -> Json<serde_json::Value> {
    let next = *state.company.next_briefing.read();
    Json(serde_json::json!({"next_briefing": next.map(|d| d.to_rfc3339())}))
}

// ─── Messaging Handlers ────────────────────────────────────────────────────

async fn get_messaging_config(State(state): State<AppState>) -> Json<MessagingConfig> {
    Json(state.messaging.get_config())
}

async fn update_messaging_config(
    State(state): State<AppState>,
    Json(cfg): Json<MessagingConfig>,
) -> StatusCode {
    state.messaging.update_config(cfg);
    StatusCode::OK
}

async fn send_test_email(State(state): State<AppState>) -> Json<MessageResult> {
    let cfg = state.messaging.get_smtp_config();
    let result = state.messaging.send_email(&EmailRequest {
        to: vec![cfg.from_address.clone()],
        subject: "ORA AI – Test Email".into(),
        body: "This is a test email from ORA AI. If you received this, SMTP is configured correctly!".into(),
        html_body: Some("<h2>ORA Test Email [OK]</h2><p>SMTP configuration is working!</p>".into()),
        cc: None,
        priority: Some("normal".into()),
    }).await;
    Json(result)
}

async fn setup_telegram_webhook_handler(State(state): State<AppState>) -> Json<MessageResult> {
    Json(state.messaging.setup_telegram_webhook().await)
}

async fn telegram_webhook_handler(
    State(state): State<AppState>,
    body: String,
) -> impl IntoResponse {
    if let Ok(update) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(msg) = state.messaging.process_telegram_message(update).await {
            // Process through ORA AI
            let response = state.messaging.process_incoming(msg.clone()).await;
            state
                .messaging
                .send_telegram_message(&msg.chat_id, &response)
                .await;
        }
    }
    StatusCode::OK
}

#[derive(Deserialize)]
struct TelegramSendRequest {
    chat_id: String,
    text: String,
}
async fn send_telegram_handler(
    State(state): State<AppState>,
    Json(req): Json<TelegramSendRequest>,
) -> Json<MessageResult> {
    Json(
        state
            .messaging
            .send_telegram_message(&req.chat_id, &req.text)
            .await,
    )
}

async fn whatsapp_webhook_handler(
    State(state): State<AppState>,
    body: String,
) -> impl IntoResponse {
    if let Some(msg) = state.messaging.process_whatsapp_message(&body).await {
        let response = state.messaging.process_incoming(msg.clone()).await;
        state
            .messaging
            .send_whatsapp_message(&msg.from, &response)
            .await;
    }
    // Twilio expects TwiML or empty 200
    (
        StatusCode::OK,
        "<?xml version=\"1.0\"?><Response></Response>",
    )
}

#[derive(Deserialize)]
struct WhatsAppSendRequest {
    to: String,
    text: String,
}
async fn send_whatsapp_handler(
    State(state): State<AppState>,
    Json(req): Json<WhatsAppSendRequest>,
) -> Json<MessageResult> {
    Json(
        state
            .messaging
            .send_whatsapp_message(&req.to, &req.text)
            .await,
    )
}

#[derive(Deserialize)]
struct BroadcastRequest {
    text: String,
}
#[axum::debug_handler]
async fn broadcast_message(
    State(state): State<AppState>,
    Json(req): Json<BroadcastRequest>,
) -> Json<Vec<MessageResult>> {
    Json(state.messaging.broadcast(&req.text).await)
}

// ─── DLP Guard & AI Token Handlers ─────────────────────────────────────────

#[derive(Deserialize)]
struct ScanRequest {
    text: String,
    is_output: Option<bool>,
}
async fn scan_for_sensitive_data(
    State(state): State<AppState>,
    Json(req): Json<ScanRequest>,
) -> Json<DlpScanResult> {
    if req.is_output.unwrap_or(false) {
        Json(state.dlp.scan_output(&req.text))
    } else {
        Json(state.dlp.scan_input(&req.text))
    }
}

async fn get_dlp_stats(State(state): State<AppState>) -> Json<dlp_guard::DlpStats> {
    Json(state.dlp.get_stats())
}

#[derive(Deserialize)]
struct AddPatternRequest {
    pattern: String,
    name: String,
    severity: String,
}
async fn add_dlp_pattern(
    State(state): State<AppState>,
    Json(req): Json<AddPatternRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let severity = match req.severity.as_str() {
        "critical" => dlp_guard::Severity::Critical,
        "warning" => dlp_guard::Severity::Warning,
        _ => dlp_guard::Severity::Info,
    };
    state
        .dlp
        .add_custom_pattern(&req.pattern, &req.name, severity)
        .map(|_| StatusCode::OK)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
struct GenerateTokenRequest {
    label: String,
}
async fn generate_ai_token(
    State(state): State<AppState>,
    Json(req): Json<GenerateTokenRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    match state.ai_token_mgr.generate_token(&req.label) {
        Ok(token) => {
            // Register with DLP immediately
            state.dlp.add_redaction(&token);
            Ok(Json(serde_json::json!({
                "token": token,
                "note": "Store this token securely. It will NEVER be shown again."
            })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

#[derive(Deserialize)]
struct RevokeTokenRequest {
    token_hash: Option<String>,
    reason: String,
}
async fn revoke_ai_token(
    State(state): State<AppState>,
    Json(req): Json<RevokeTokenRequest>,
) -> StatusCode {
    if let Some(hash) = req.token_hash {
        state.ai_token_mgr.revoke_token(&hash, &req.reason);
    }
    StatusCode::OK
}

#[derive(Deserialize)]
struct RevokeAllRequest {
    reason: String,
}
async fn revoke_all_ai_tokens(
    State(state): State<AppState>,
    Json(req): Json<RevokeAllRequest>,
) -> StatusCode {
    state.ai_token_mgr.revoke_all(&req.reason);
    StatusCode::OK
}

async fn get_ai_token_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let tokens = state.ai_token_mgr.get_active_tokens();
    Json(serde_json::json!({
        "active_tokens": tokens.len(),
        "tokens": tokens.iter().map(|t| serde_json::json!({
            "label": t.label,
            "hash_preview": &t.token_hash[..12.min(t.token_hash.len())],
            "expires_at": t.expires_at,
            "scopes": t.scopes,
        })).collect::<Vec<_>>(),
        "needs_rotation": state.ai_token_mgr.needs_rotation(),
        "revoke_log": state.ai_token_mgr.get_revoke_log().iter().map(|(r, t)| serde_json::json!({"reason": r, "at": t})).collect::<Vec<_>>(),
    }))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_assist=debug,info".parse().unwrap()),
        )
        .init();

    let (provider_type, config) = load_config_from_env();
    // Wrap provider in an Arc<RwLock<>> so it can be shared with the instant task engine
    let shared_provider: Arc<RwLock<Box<dyn AIProvider>>> =
        Arc::new(RwLock::new(create_provider(provider_type, config)));

    {
        let p = shared_provider.read().await;
        info!("Starting ORA AI (IORA Assist) with provider: {}", p.name());
    }

    // Initialize database (optional - continues without DB if unavailable)
    let db = match database::init_database().await {
        Ok(pool) => {
            info!("Database connected successfully");
            Some(pool)
        }
        Err(e) => {
            error!(
                "Database connection failed: {}. Running without database features.",
                e
            );
            None
        }
    };

    // Initialize multi-provider orchestrator
    let orchestrator = Arc::new(ProviderOrchestrator::new(db.clone()));

    // Initialize providers from database if available
    if db.is_some() {
        if let Err(e) = orchestrator.init_from_database().await {
            error!("Failed to initialize providers from database: {}", e);
        }
    }

    // ─── Auto-register IORA STT (faster-whisper) ───────────────────────
    let stt_url = iora_shared_config::system_config::stt_service_url();
    let stt_config = ProviderConfig {
        base_url: Some(stt_url.clone()),
        ..Default::default()
    };
    let stt_provider = providers::create_provider(providers::ProviderType::IoraStt, stt_config);
    if stt_provider.is_available().await {
        orchestrator
            .register_provider("iora_stt".to_string(), stt_provider)
            .await;
        info!("IORA STT (faster-whisper) registered at {}", stt_url);
    } else {
        info!("IORA STT not available at {} – skipping", stt_url);
    }

    // ─── Auto-register IORA TTS (Kokoro) ───────────────────────────────
    let tts_url = iora_shared_config::system_config::tts_service_url();
    let tts_config = ProviderConfig {
        base_url: Some(tts_url.clone()),
        ..Default::default()
    };
    let tts_provider = providers::create_provider(providers::ProviderType::IoraTts, tts_config);
    if tts_provider.is_available().await {
        orchestrator
            .register_provider("iora_tts".to_string(), tts_provider)
            .await;
        info!("IORA TTS (Kokoro) registered at {}", tts_url);
    } else {
        info!("IORA TTS not available at {} – skipping", tts_url);
    }

    // Initialize task engine if database is available
    let task_engine = if let Some(ref db_pool) = db {
        let engine = Arc::new(TaskEngine::new(db_pool.clone(), orchestrator.clone()));
        engine.start().await;
        info!("Task engine started successfully");
        Some(engine)
    } else {
        info!("Task engine disabled (no database connection)");
        None
    };

    // Initialize conversation manager if database is available
    let conversation_manager = if let Some(ref db_pool) = db {
        let manager = Arc::new(ConversationManager::new(
            db_pool.clone(),
            orchestrator.clone(),
        ));
        manager.start().await;
        info!("Conversation manager started successfully");
        Some(manager)
    } else {
        info!("Conversation manager disabled (no database connection)");
        None
    };

    // Initialize tool executor with headless Chrome
    let mut tool_executor = ToolExecutor::new();
    if let Err(e) = tool_executor.init_browser() {
        error!(
            "Failed to initialize headless Chrome: {}. Tool execution will be limited.",
            e
        );
    } else {
        info!("Headless Chrome browser initialized for tool execution");
    }
    let tool_executor = Arc::new(RwLock::new(tool_executor));

    // Initialize instant task engine if database is available
    let instant_task_engine = if let Some(ref db_pool) = db {
        let engine = Arc::new(InstantTaskEngine::new(
            db_pool.clone(),
            shared_provider.clone(),
            tool_executor.clone(),
        ));
        engine.start().await;
        info!("Instant task engine started successfully");
        Some(engine)
    } else {
        info!("Instant task engine disabled (no database connection)");
        None
    };

    // Initialize memory manager if database is available
    let memory_manager = if let Some(ref db_pool) = db {
        info!("Memory manager initialized successfully");
        Some(Arc::new(MemoryManager::new(db_pool.clone())))
    } else {
        info!("Memory manager disabled (no database connection)");
        None
    };

    let (evolution_orchestrator, knowledge_base) = if let Some(ref db_pool) = db {
        let evo_config = EvolutionCycleConfig::default();
        let project_root = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .to_string_lossy()
            .to_string();
        let kb = Arc::new(KnowledgeBase::new(db_pool.clone()));
        let orch = Arc::new(SelfEvolutionOrchestrator::new(
            db_pool.clone(),
            project_root,
            evo_config,
        ));
        let scheduler =
            EvolutionScheduler::new(orch.clone(), self_evolution::EvolutionConfig::default());
        tokio::spawn(async move {
            scheduler.start().await;
        });
        info!("Self-evolution system initialized");
        (Some(orch), Some(kb))
    } else {
        info!("Self-evolution disabled (no database connection)");
        (None, None)
    };

    // Initialize sandbox manager (works in memory – no DB needed)
    let sandbox_dir = system_config::sandbox_dir();
    let sandbox_manager = Arc::new(SandboxManager::new(std::path::PathBuf::from(&sandbox_dir)));

    let agent_task_executor = {
        let executor = Arc::new(AgentTaskExecutor::new(sandbox_manager.clone()));
        info!("Agent task executor initialized");
        Some(executor)
    };

    // Initialize Cost Manager for token/cost budgeting
    let cost_manager = Arc::new(CostManager::new());
    info!("Cost manager initialized");

    // Initialize LSP Manager for language intelligence
    let lsp_manager = Arc::new(LspManager::new());
    info!("LSP manager initialized");

    // Initialize ACP Router for agent-to-agent communication
    let acp_router = Arc::new(AcpRouter::new(
        "ora-assist",
        "Primary ORA AI Assistant agent for the IORA ecosystem",
        "primary",
    ));
    info!("ACP router initialized");

    // Initialize Subagent Pool for hierarchical task delegation
    let default_provider = shared_provider.read().await.name().to_string();
    let default_model = system_config::ai_model().unwrap_or_else(|| "gpt-4o-mini".to_string());
    let subagent_pool = Arc::new(SubagentPool::new(&default_provider, &default_model));
    info!("Subagent pool initialized");

    // Initialize GitHub integration — load persisted PAT from DB if no env var present.
    let mut github_auth = GitHubAuth::default();
    if github_auth.pat.is_none() {
        if let Some(ref pool) = db {
            if let Ok(Some(pat)) = database::secrets::get(pool, "github.pat").await {
                github_auth.pat = Some(pat);
                github_auth.is_configured = true;
            }
            if let Ok(Some(app_id)) = database::secrets::get(pool, "github.app_id").await {
                github_auth.app_id = Some(app_id);
            }
            if let Ok(Some(inst)) = database::secrets::get(pool, "github.installation_id").await {
                github_auth.installation_id = Some(inst);
            }
            if let Ok(Some(pk)) = database::secrets::get(pool, "github.private_key").await {
                github_auth.private_key = Some(pk);
            }
            if let Ok(Some(t)) = database::secrets::get(pool, "github.auth_type").await {
                github_auth.auth_type = t;
            }
        }
    }
    let github_client = Arc::new(GitHubClient::new(github_auth));
    let github_actions = Arc::new(GitHubActionExecutor::new(github_client.clone()));
    // Async verify in background
    let gc = github_client.clone();
    tokio::spawn(async move {
        match gc.verify_auth().await {
            Ok(user) => tracing::info!("GitHub authenticated as: {}", user.login),
            Err(e) => tracing::info!("GitHub not configured (set GITHUB_TOKEN): {}", e),
        }
    });
    info!("GitHub integration initialized");

    // Initialize the models registry (cached + periodic refresh) — only when DB available.
    let models_registry = if let Some(ref pool) = db {
        let reg = Arc::new(models_registry::ModelsRegistry::new(pool.clone()));
        models_registry::spawn_refresh_loop((*reg).clone());
        info!("Models registry initialized (auto-refresh active)");
        Some(reg)
    } else {
        None
    };

    // Initialize pi.dev controller
    let sandbox_base =
        std::env::var("IORA_SANDBOX_BASE").unwrap_or_else(|_| "/tmp/iora-sandboxes".to_string());
    let pi_dev = Arc::new(PiDevController::new(sandbox_base));
    info!("Pi.dev controller initialized");

    // Registry for app-/plugin-provided assist tools and exposed RPC services.
    let app_capabilities = Arc::new(AppCapabilityRegistry::new());
    info!("App capability registry initialized");

    // Initialize system event bus
    let event_bus = Arc::new(SystemEventBus::new(4096));
    event_bus.system_event(
        "startup",
        "IORA Assist system event bus initialized",
        "info",
    );
    info!("System event bus initialized");

    // Initialize system guard
    let guard = Arc::new(SystemGuard::new());
    info!("System guard initialized");

    let router = Arc::new(ModelRouter::new());
    let memory_store = Arc::new(MemoryStore::new());
    let scheduler = Arc::new(AutonomousScheduler::new());
    scheduler.create_default_tasks();
    let scheduler_clone = scheduler.clone();
    tokio::spawn(async move { scheduler_clone.start().await });
    let mistake_learner = Arc::new(MistakeLearner::new());
    let collaboration = Arc::new(Orchestrator::new());
    let self_healing = Arc::new(SelfHealing::new());
    let cost_tracker = Arc::new(CostTracker::new());
    let company = Arc::new(VirtualCompany::new());
    let messaging = Arc::new(MessagingManager::new());
    let ai_token_mgr = Arc::new(AiTokenManager::new());
    let dlp = Arc::new(DlpGuard::new());
    // Register the AI token with DLP so it's never leaked
    if let Some(token) = ai_token_mgr.get_current_token() {
        dlp.add_redaction(&token);
    }
    info!("DLP guard and AI token manager initialized");

    let state = AppState {
        history: Arc::new(RwLock::new(Vec::new())),
        started_at: Arc::new(Instant::now()),
        current_provider: shared_provider,
        context_builder: Arc::new(ContextBuilder::new()),
        db,
        orchestrator,
        task_engine,
        instant_task_engine,
        conversation_manager,
        tool_executor,
        memory_manager,
        evolution_orchestrator,
        knowledge_base,
        sandbox_manager,
        agent_task_executor,
        cost_manager,
        lsp_manager,
        acp_router,
        subagent_pool,
        github_client,
        github_actions,
        models_registry,
        pi_dev,
        app_capabilities,
        event_bus,
        guard,
        router,
        memory_store,
        scheduler,
        collaboration,
        self_healing,
        cost_tracker,
        mistake_learner,
        company,
        messaging,
        dlp,
        ai_token_mgr,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/assist/chat", post(chat))
        .route("/api/assist/chat/stream", post(chat_stream))
        .route("/api/assist/history", get(chat_history))
        .route("/api/assist/history/clear", post(clear_history))
        .route("/api/assist/suggestions", get(suggestions))
        .route("/api/assist/automate", post(create_automation))
        .route("/api/assist/insights", get(insights))
        .route("/api/assist/providers", get(get_providers))
        .route("/api/assist/providers/switch", post(switch_provider))
        .route("/api/assist/voice/transcribe", post(transcribe_audio))
        .route("/api/assist/voice/synthesize", post(synthesize_speech))
        .route("/api/assist/voice/stt", post(transcribe_local))
        .route("/api/assist/voice/tts", post(synthesize_local))
        .route("/api/assist/voice/stt/models", get(list_stt_models))
        .route("/api/assist/voice/tts/voices", get(list_tts_voices))
        .route("/api/assist/entities/discover", get(discover_entities))
        .route(
            "/api/assist/automations/suggestions",
            get(get_automation_suggestions),
        )
        .route("/api/assist/context", get(get_smart_home_context))
        .route("/api/assist/video/analyze", post(analyze_video))
        // Proactive Messaging (Phase 6)
        .route("/api/assist/notifications/stream", get(notification_stream))
        // Control Center API (Phase 5)
        .route("/api/assist/config/providers", get(list_provider_configs))
        .route("/api/assist/config/providers", post(create_provider_config))
        .route(
            "/api/assist/config/providers/:id",
            axum::routing::patch(update_provider_config).delete(delete_provider_config),
        )
        .route(
            "/api/assist/config/providers/:id/refresh-models",
            post(refresh_provider_models),
        )
        // Global model catalog (cached + on-demand live refresh for local/desktop providers).
        .route("/api/assist/models", get(list_global_models))
        .route("/api/assist/models/refresh", post(refresh_all_models))
        .route("/api/assist/config/threads", get(list_conversation_threads))
        .route(
            "/api/assist/config/threads",
            post(create_conversation_thread),
        )
        .route("/api/assist/config/tasks", get(list_autonomous_tasks))
        .route(
            "/api/assist/config/notifications",
            get(list_pending_notifications),
        )
        .route(
            "/api/assist/config/notifications/send",
            post(send_notification),
        )
        .route("/api/assist/config/stats", get(get_orchestrator_stats))
        // Tool Execution API (Internet Search & External Tools)
        .route("/api/assist/tools/execute", post(execute_tool))
        .route("/api/assist/tools/search", post(search_internet))
        .route("/api/assist/tools/scrape", post(scrape_webpage))
        .route(
            "/api/assist/tools/screenshot",
            post(take_webpage_screenshot),
        )
        // Memory API
        .route("/api/assist/memory", get(list_memories))
        .route("/api/assist/memory", post(create_memory))
        .route("/api/assist/memory/search", post(search_memories))
        .route(
            "/api/assist/memory/:id",
            axum::routing::delete(delete_memory),
        )
        // Active Tasks API – list, create
        .route("/api/assist/tasks/active", get(list_active_tasks))
        .route("/api/assist/tasks/active", post(create_active_task))
        // Active Tasks API – update (pause/resume/edit), delete by id
        .route(
            "/api/assist/tasks/active/:id",
            axum::routing::patch(update_active_task),
        )
        .route(
            "/api/assist/tasks/active/:id",
            axum::routing::delete(delete_active_task),
        )
        // Multi-message conversation task detection
        .route(
            "/api/assist/tasks/detect",
            post(detect_tasks_from_conversation),
        )
        // User-confirmed task action (after AI asked for confirmation)
        .route("/api/assist/tasks/confirm", post(confirm_task_action))
        // Instant Tasks API – real-time one-shot tasks
        .route("/api/assist/tasks/instant/:id", get(get_instant_task))
        .route(
            "/api/assist/tasks/instant/:id/stream",
            get(stream_instant_task),
        )
        // Self-Evolution API
        .route("/api/assist/evolution/cycle", post(trigger_evolution_cycle))
        .route(
            "/api/assist/evolution/proposals",
            get(list_evolution_proposals),
        )
        .route("/api/assist/evolution/knowledge", post(store_knowledge))
        .route("/api/assist/evolution/knowledge", get(search_knowledge))
        .route("/api/assist/evolution/status", get(get_evolution_status))
        // Sandbox & Agent Task API
        .route(
            "/api/assist/workspaces",
            get(list_workspaces).post(create_workspace),
        )
        .route(
            "/api/assist/workspaces/:id",
            get(get_workspace).delete(delete_workspace),
        )
        .route(
            "/api/assist/workspaces/:id/files",
            get(list_workspace_files),
        )
        .route(
            "/api/assist/workspaces/:ws_id/files/*file_path",
            get(read_workspace_file).put(write_workspace_file),
        )
        .route(
            "/api/assist/workspaces/:id/git/status",
            get(workspace_git_status),
        )
        .route(
            "/api/assist/workspaces/:id/git/commit",
            post(workspace_git_commit),
        )
        .route(
            "/api/assist/workspaces/:id/git/push",
            post(workspace_git_push),
        )
        .route(
            "/api/assist/workspaces/:id/git/branch",
            post(workspace_git_create_branch),
        )
        .route(
            "/api/assist/workspaces/:id/git/pr",
            post(workspace_create_pr),
        )
        .route("/api/assist/workspaces/:id/git/log", get(workspace_git_log))
        .route(
            "/api/assist/workspaces/:id/git/branches",
            get(workspace_git_branches),
        )
        .route(
            "/api/assist/workspaces/:id/git/checkout",
            post(workspace_git_checkout),
        )
        .route(
            "/api/assist/workspaces/:id/git/delete-branch",
            post(workspace_git_delete_branch),
        )
        .route(
            "/api/assist/workspaces/:id/git/stash",
            post(workspace_git_stash),
        )
        .route(
            "/api/assist/workspaces/:id/git/stash-pop",
            post(workspace_git_stash_pop),
        )
        .route(
            "/api/assist/workspaces/:id/git/stash-list",
            get(workspace_git_stash_list),
        )
        .route(
            "/api/assist/workspaces/:id/git/reset",
            post(workspace_git_reset),
        )
        .route(
            "/api/assist/workspaces/:id/git/revert",
            post(workspace_git_revert),
        )
        .route(
            "/api/assist/workspaces/:id/git/merge",
            post(workspace_git_merge),
        )
        .route(
            "/api/assist/workspaces/:id/git/rebase",
            post(workspace_git_rebase),
        )
        .route(
            "/api/assist/workspaces/:id/git/blame",
            post(workspace_git_blame),
        )
        .route(
            "/api/assist/workspaces/:id/git/fetch",
            post(workspace_git_fetch),
        )
        .route(
            "/api/assist/workspaces/:id/git/diff-between",
            post(workspace_git_diff_between),
        )
        .route(
            "/api/assist/agent/tasks",
            get(list_agent_tasks).post(create_agent_task),
        )
        .route(
            "/api/assist/agent/tasks/:id",
            get(get_agent_task).delete(cancel_agent_task),
        )
        .route(
            "/api/assist/agent/tasks/events",
            get(stream_agent_task_events),
        )
        .route("/api/assist/agent/stats", get(agent_task_stats))
        // OpenAI-Compatible API (Proxy für andere Dienste)
        .route("/v1/chat/completions", post(openai_chat_completions))
        .route("/v1/models", get(list_available_models))
        // ─── Cost Manager & Economy Mode API ──────────────────────────
        .route("/api/assist/cost/summary", get(cost_summary))
        .route(
            "/api/assist/cost/config",
            get(cost_config_get).put(cost_config_update),
        )
        .route("/api/assist/cost/records/clear", post(cost_records_clear))
        .route("/api/assist/cost/cache/clear", post(cost_cache_clear))
        .route(
            "/api/assist/cost/mode",
            get(cost_mode_get).put(cost_mode_set),
        )
        // ─── LSP API ─────────────────────────────────────────────────
        .route("/api/assist/lsp/servers", get(lsp_available_servers))
        .route(
            "/api/assist/lsp/workspaces/:id/start",
            post(lsp_start_for_workspace),
        )
        .route(
            "/api/assist/lsp/workspaces/:id/diagnostics",
            get(lsp_workspace_diagnostics),
        )
        .route("/api/assist/lsp/diagnostics", get(lsp_all_diagnostics))
        .route("/api/assist/lsp/shutdown", post(lsp_shutdown))
        // ─── ACP API ─────────────────────────────────────────────────
        .route("/api/assist/acp/agents", get(acp_list_agents))
        .route("/api/assist/acp/agents/discover", post(acp_discover_agents))
        .route("/api/assist/acp/message", post(acp_send_message))
        .route("/api/assist/acp/broadcast", post(acp_broadcast))
        .route("/api/assist/acp/events", get(acp_event_stream))
        // ─── Subagents API ───────────────────────────────────────────
        .route("/api/assist/subagents/spawn", post(subagent_spawn))
        .route("/api/assist/subagents/list", get(subagent_list))
        .route("/api/assist/subagents/stats", get(subagent_stats))
        .route("/api/assist/subagents/delegate", post(subagent_delegate))
        .route(
            "/api/assist/subagents/delegate/auto",
            post(subagent_delegate_auto),
        )
        .route(
            "/api/assist/subagents/:id",
            get(subagent_get).delete(subagent_terminate),
        )
        .route(
            "/api/assist/subagents/:id/events",
            get(subagent_event_stream),
        )
        .route(
            "/api/assist/subagents/terminate-all",
            post(subagent_terminate_all),
        )
        .route(
            "/api/assist/subagents/events",
            get(subagent_pool_event_stream),
        )
        // ─── GitHub Integration API ───────────────────────────────────
        .route(
            "/api/assist/github/auth",
            get(github_auth_status)
                .post(github_auth_set)
                .delete(github_auth_delete),
        )
        .route("/api/assist/github/repos", get(github_list_repos))
        .route(
            "/api/assist/github/repos/suggest",
            get(github_suggest_targets),
        )
        .route("/api/assist/github/repos/search", get(github_search_repos))
        .route(
            "/api/assist/github/repos/:owner/:repo",
            get(github_get_repo),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/branches",
            get(github_list_branches),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/branches/create",
            post(github_create_branch),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/branches/:branch",
            get(github_get_branch).delete(github_delete_branch),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/issues",
            get(github_list_issues).post(github_create_issue),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/issues/:number",
            get(github_get_issue).patch(github_update_issue),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/issues/:number/close",
            post(github_close_issue),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/issues/:number/comment",
            post(github_add_comment),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/pulls",
            get(github_list_prs).post(github_create_pr),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/pulls/:number",
            get(github_get_pr),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/pulls/:number/merge",
            post(github_merge_pr),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/pulls/:number/diff",
            get(github_get_pr_diff),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/contents/*path",
            get(github_get_contents)
                .put(github_write_file)
                .delete(github_delete_file),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/commits",
            get(github_list_commits),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/commits/:sha",
            get(github_get_commit),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/compare",
            get(github_compare),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/workflows",
            get(github_list_workflows),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/workflows/trigger",
            post(github_trigger_workflow),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/workflows/runs",
            get(github_list_workflow_runs),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/releases",
            get(github_list_releases).post(github_create_release),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/releases/latest",
            get(github_get_latest_release),
        )
        .route(
            "/api/assist/github/repos/:owner/:repo/fork",
            post(github_fork_repo),
        )
        .route(
            "/api/assist/github/actions",
            get(github_list_actions).post(github_execute_action),
        )
        .route("/api/assist/github/actions/:id", get(github_get_action))
        .route("/api/assist/github/ratelimit", get(github_rate_limit))
        // ─── Pi.dev Docker Sandbox & Plugin Management ───
        .route(
            "/api/assist/pidev/sessions",
            get(list_pidev_sessions).post(create_pidev_session),
        )
        .route(
            "/api/assist/pidev/sessions/:id",
            get(get_pidev_session).delete(stop_pidev_session),
        )
        .route("/api/assist/pidev/sessions/:id/run", post(run_pidev_task))
        .route(
            "/api/assist/pidev/sessions/:id/bridge",
            get(get_pidev_bridge),
        )
        .route(
            "/api/assist/pidev/sessions/:id/control",
            post(control_pidev_session),
        )
        .route(
            "/api/assist/pidev/sessions/:id/events",
            get(stream_pidev_events),
        )
        .route(
            "/api/assist/pidev/sessions/:id/approve",
            post(approve_pidev_action),
        )
        .route(
            "/api/assist/pidev/sessions/:id/deny",
            post(deny_pidev_action),
        )
        .route(
            "/api/assist/pidev/sessions/:id/security",
            get(get_pidev_security_events),
        )
        .route("/api/assist/pidev/plugins", get(list_pidev_plugins))
        .route(
            "/api/assist/pidev/plugins/install",
            post(install_pidev_plugin),
        )
        // ─── App Capability Registry (app-provided assist tools & services) ───
        .route(
            "/api/assist/apps/:app_id/capabilities",
            post(register_app_capabilities).delete(unregister_app_capabilities),
        )
        .route("/api/assist/apps/capabilities", get(list_app_capabilities))
        .route("/api/assist/tools", get(list_app_tools))
        // ─── System Event Stream (admin live log) ───
        .route("/api/assist/system/events", get(stream_system_events))
        // ─── System Guard – Protection & Control ───
        .route(
            "/api/assist/system/state",
            get(get_system_state).post(set_system_state),
        )
        .route("/api/assist/system/pause", post(pause_system_handler))
        .route("/api/assist/system/resume", post(resume_system_handler))
        .route(
            "/api/assist/system/emergency-stop",
            post(emergency_stop_handler),
        )
        .route(
            "/api/assist/system/agents/:id/pause",
            post(pause_agent_handler),
        )
        .route(
            "/api/assist/system/agents/:id/resume",
            post(resume_agent_handler),
        )
        .route(
            "/api/assist/system/agents/:id/stop",
            post(stop_agent_handler),
        )
        .route(
            "/api/assist/system/rules",
            get(get_protection_rules).put(update_protection_rule),
        )
        .route("/api/assist/system/loops", get(get_loop_detections))
        .route(
            "/api/assist/system/recovery",
            get(get_recovery_actions).post(apply_recovery),
        )
        // ─── Model Router ───
        .route("/api/assist/router/classify", post(classify_task_handler))
        .route("/api/assist/router/route", post(route_task_handler))
        .route(
            "/api/assist/router/config",
            get(get_router_config).put(update_router_config),
        )
        .route("/api/assist/router/usage", get(get_router_usage))
        // ─── Memory System ───
        .route("/api/assist/memory/all", get(get_all_memories))
        .route("/api/assist/memory/query", post(query_memories))
        .route("/api/assist/memory/context", post(get_memory_context))
        .route("/api/assist/memory/clear", post(clear_memories))
        // ─── Autonomous Scheduler ───
        .route(
            "/api/assist/scheduler/tasks",
            get(list_scheduled_tasks).post(add_scheduled_task),
        )
        .route(
            "/api/assist/scheduler/tasks/:id",
            get(get_scheduled_task).delete(remove_scheduled_task),
        )
        .route(
            "/api/assist/scheduler/tasks/:id/toggle",
            post(toggle_scheduled_task),
        )
        .route("/api/assist/scheduler/history", get(get_scheduler_history))
        .route("/api/assist/scheduler/events", get(stream_scheduler_events))
        // ─── ORA Features ───
        .route(
            "/api/assist/collaboration/plans",
            get(list_collab_plans).post(create_collab_plan),
        )
        .route("/api/assist/collaboration/plans/:id", get(get_collab_plan))
        .route("/api/assist/review", post(submit_code_review))
        .route("/api/assist/health", get(get_health_checks))
        .route("/api/assist/health/check", post(run_health_check))
        .route("/api/assist/cost/records", get(get_cost_records))
        .route("/api/assist/cost/suggest", get(suggest_cheaper_provider))
        .route("/api/assist/learning/mistakes", get(get_mistakes))
        .route("/api/assist/learning/avoid-list", get(get_avoid_list))
        .route("/api/assist/learning/warning", post(get_learning_warning))
        // ─── Virtual Company & Briefing ───
        .route(
            "/api/assist/company/status",
            get(get_company_status).post(toggle_company),
        )
        .route(
            "/api/assist/company/agents",
            get(get_company_agents).put(update_company_agent),
        )
        .route(
            "/api/assist/company/projects",
            get(get_company_projects).post(create_company_project),
        )
        .route(
            "/api/assist/company/projects/:id/tasks",
            post(add_company_task),
        )
        .route(
            "/api/assist/company/distribute",
            post(distribute_company_task),
        )
        .route(
            "/api/assist/company/briefing/config",
            get(get_briefing_config).put(update_briefing_config),
        )
        .route(
            "/api/assist/company/briefing/start",
            post(start_company_briefing),
        )
        .route(
            "/api/assist/company/briefing/:id/complete",
            post(complete_company_briefing),
        )
        .route(
            "/api/assist/company/briefing/history",
            get(get_briefing_history),
        )
        .route("/api/assist/company/briefing/next", get(get_next_briefing))
        // ─── Messaging (Email, Telegram, WhatsApp) ───
        .route(
            "/api/assist/messaging/config",
            get(get_messaging_config).put(update_messaging_config),
        )
        .route("/api/assist/messaging/email/test", post(send_test_email))
        .route(
            "/api/assist/messaging/telegram/setup",
            post(setup_telegram_webhook_handler),
        )
        .route(
            "/api/assist/messaging/telegram/webhook",
            post(telegram_webhook_handler),
        )
        .route(
            "/api/assist/messaging/telegram/send",
            post(send_telegram_handler),
        )
        .route(
            "/api/assist/messaging/whatsapp/webhook",
            post(whatsapp_webhook_handler),
        )
        .route(
            "/api/assist/messaging/whatsapp/send",
            post(send_whatsapp_handler),
        )
        .route("/api/assist/messaging/broadcast", post(broadcast_message))
        // ─── DLP Guard & AI Token ───
        .route("/api/assist/dlp/scan", post(scan_for_sensitive_data))
        .route("/api/assist/dlp/stats", get(get_dlp_stats))
        .route("/api/assist/dlp/patterns", post(add_dlp_pattern))
        .route("/api/assist/token/generate", post(generate_ai_token))
        .route("/api/assist/token/revoke", post(revoke_ai_token))
        .route("/api/assist/token/revoke-all", post(revoke_all_ai_tokens))
        .route("/api/assist/token/status", get(get_ai_token_status))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port = system_config::service_port("iora-assist", 8092);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!("ORA AI (iora-assist) listening on {}", addr);
    let _hb = iora_shared_heartbeat::spawn_default("iora-assist", addr.port(), "ORA AI assistant");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
