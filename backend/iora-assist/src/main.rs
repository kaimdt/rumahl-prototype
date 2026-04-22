use std::{sync::Arc, time::Instant};

use axum::{
    body::Body,
    extract::{Multipart, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response, Sse},
    response::sse::{Event, KeepAlive},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{error, info};
use uuid::Uuid;
use futures_util::stream::Stream;
use std::convert::Infallible;

mod providers;
mod context;
mod database;
mod memory;
mod orchestrator;
mod task_engine;
mod conversation_manager;
mod tools;

use context::{ContextBuilder, SmartHomeContext};
use database::DbPool;
use memory::{ActiveTaskRequest, CreateMemoryRequest, MemoryManager};
use orchestrator::{ProviderOrchestrator, TaskPurpose};
use task_engine::TaskEngine;
use conversation_manager::ConversationManager;
use tools::ToolExecutor;

use providers::{
    create_provider, AIProvider, ChatMessage as ProviderChatMessage, ProviderConfig,
    ProviderType,
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
    conversation_manager: Option<Arc<ConversationManager>>,
    tool_executor: Arc<RwLock<ToolExecutor>>,
    memory_manager: Option<Arc<MemoryManager>>,
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

    Json(serde_json::json!({
        "service": "iora-assist",
        "status": "healthy",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
        "ai_provider": provider.name(),
        "ai_available": provider_available,
        "capabilities": {
            "chat": true,
            "voice_input": true,
            "voice_output": true,
            "live_audio": true,
        }
    }))
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

    // Get AI provider
    let provider = state.current_provider.read().await;

    if !provider.is_available().await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "AI provider not available",
                "provider": provider.name(),
                "message": "The configured AI provider is not available. Please check configuration and connectivity.",
            })),
        );
    }

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
    let base_system_prompt = req.system_prompt.as_deref().unwrap_or(
        "You are IORA Assist, an AI assistant integrated into the IORA smart home system. \
         You help users manage their home automation, answer questions, and provide insights."
    ).to_string();

    // Inject relevant memories into the system prompt (if memory manager is available)
    let system_prompt = if let Some(ref mm) = state.memory_manager {
        Some(
            mm.inject_into_prompt(&base_system_prompt, &req.message, None)
                .await,
        )
    } else {
        Some(base_system_prompt)
    };

    // Call AI provider
    match provider.chat(messages, system_prompt).await {
        Ok(response) => {
            // Save assistant message
            let assistant_msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                content: response.message.clone(),
                timestamp: Utc::now().to_rfc3339(),
            };
            state.history.write().await.push(assistant_msg.clone());

            // Post-chat: extract memories and detect tasks in the background
            if let Some(mm) = state.memory_manager.clone() {
                let user_msg = req.message.clone();
                let ai_resp = response.message.clone();
                tokio::spawn(async move {
                    mm.auto_extract_from_conversation(&user_msg, &ai_resp, None)
                        .await;
                    mm.detect_and_create_tasks(&user_msg, &ai_resp, None).await;
                });
            }

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "message": response.message,
                    "model": response.model,
                    "provider": response.provider,
                    "tokens_used": response.tokens_used,
                    "message_id": assistant_msg.id,
                    "timestamp": assistant_msg.timestamp,
                })),
            )
        }
        Err(e) => {
            error!("AI provider error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
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

    // TODO: Implement automation suggestions based on entity history
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "suggestions": [],
            "message": "Automation suggestion analysis coming soon",
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

    // TODO: Implement natural language automation creation
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "message": "Natural language automation creation coming soon",
            "your_description": req.description,
            "entities_mentioned": req.entities,
        })),
    )
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

    // TODO: Implement AI-generated insights
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "insights": [],
            "message": "AI insights analysis coming soon",
        })),
    )
}

async fn get_providers(State(state): State<AppState>) -> Json<serde_json::Value> {
    let current_provider = state.current_provider.read().await;
    let current_name = current_provider.name();
    let current_available = current_provider.is_available().await;

    Json(serde_json::json!({
        "current": {
            "name": current_name,
            "available": current_available,
        },
        "available_providers": [
            {
                "name": "OpenAI",
                "id": "openai",
                "capabilities": ["chat", "stt", "tts"],
                "requires_api_key": true,
            },
            {
                "name": "Anthropic",
                "id": "anthropic",
                "capabilities": ["chat"],
                "requires_api_key": true,
            },
            {
                "name": "LocalAI",
                "id": "local",
                "capabilities": ["chat", "stt", "tts"],
                "requires_api_key": false,
            },
            {
                "name": "DesktopAI",
                "id": "desktop",
                "capabilities": ["chat", "stt", "tts"],
                "requires_api_key": false,
            },
        ],
    }))
}

async fn switch_provider(
    State(state): State<AppState>,
    Json(req): Json<ProviderSwitchRequest>,
) -> impl IntoResponse {
    let provider_type = match req.provider.to_lowercase().as_str() {
        "openai" => ProviderType::OpenAI,
        "anthropic" => ProviderType::Anthropic,
        "local" | "localai" => ProviderType::Local,
        "desktop" | "desktopai" => ProviderType::Desktop,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Invalid provider",
                    "message": format!("Unknown provider: {}", req.provider),
                })),
            );
        }
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
            "available": available,
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

    match provider.synthesize_speech(&req.text, req.voice.as_deref()).await {
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
        Some(state.context_builder.build_system_prompt(ctx, req.system_prompt.as_deref()))
    } else {
        req.system_prompt.clone()
    };

    // Save user message
    let user_msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "user".to_string(),
        content: req.message.clone(),
        timestamp: Utc::now().to_rfc3339(),
    };

    let history = state.history.clone();
    let _ = history.write().await;

    // For now, send the complete response as a stream
    // In future, this could be enhanced to stream tokens
    let message = req.message.clone();
    let provider_name = provider.name().to_string();

    drop(provider); // Release the lock

    let stream = async_stream::stream! {
        yield Ok(Event::default().data(format!(r#"{{"type":"start","provider":"{}"}}"#, provider_name)));

        // Simulate streaming (in production, this would stream actual AI tokens)
        yield Ok(Event::default().data(format!(r#"{{"type":"message","content":"Processing your request: {}"}}"#, message)));

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

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
        Ok(context) => {
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": true,
                    "context": context,
                })),
            )
        }
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

// ─── Main ─────────────────────────────────────────────────────────────────────

fn load_config_from_env() -> (ProviderType, ProviderConfig) {
    let provider_type = std::env::var("ORA_AI_PROVIDER")
        .unwrap_or_else(|_| "local".to_string())
        .to_lowercase();

    let provider = match provider_type.as_str() {
        "openai" => ProviderType::OpenAI,
        "anthropic" | "claude" => ProviderType::Anthropic,
        "desktop" => ProviderType::Desktop,
        _ => ProviderType::Local,
    };

    let config = ProviderConfig {
        api_key: std::env::var("ORA_AI_API_KEY").ok(),
        base_url: std::env::var("ORA_AI_BASE_URL").ok(),
        model: std::env::var("ORA_AI_MODEL").ok(),
        api_version: std::env::var("ORA_AI_API_VERSION").ok(),
    };

    (provider, config)
}

// ============================================================================
// PROACTIVE MESSAGING (Phase 6)
// ============================================================================

async fn notification_stream(State(state): State<AppState>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
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
        Ok(provider) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "success": true,
                "provider": provider,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to create provider",
                "details": e.to_string(),
            })),
        ),
    }
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
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({"success": true})),
        ),
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
            Json(serde_json::json!({"error": "Failed to search memories", "details": e.to_string()})),
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

    match mm.list_active_tasks(None, 50).await {
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
            Json(serde_json::json!({"error": "Failed to list active tasks", "details": e.to_string()})),
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
            Json(serde_json::json!({"error": "Failed to create active task", "details": e.to_string()})),
        ),
    }
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
    let initial_provider = create_provider(provider_type, config);

    info!("Starting ORA AI (IORA Assist) with provider: {}", initial_provider.name());

    // Initialize database (optional - continues without DB if unavailable)
    let db = match database::init_database().await {
        Ok(pool) => {
            info!("Database connected successfully");
            Some(pool)
        }
        Err(e) => {
            error!("Database connection failed: {}. Running without database features.", e);
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
        let manager = Arc::new(ConversationManager::new(db_pool.clone(), orchestrator.clone()));
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
        error!("Failed to initialize headless Chrome: {}. Tool execution will be limited.", e);
    } else {
        info!("Headless Chrome browser initialized for tool execution");
    }

    // Initialize memory manager if database is available
    let memory_manager = if let Some(ref db_pool) = db {
        info!("Memory manager initialized successfully");
        Some(Arc::new(MemoryManager::new(db_pool.clone())))
    } else {
        info!("Memory manager disabled (no database connection)");
        None
    };

    let state = AppState {
        history: Arc::new(RwLock::new(Vec::new())),
        started_at: Arc::new(Instant::now()),
        current_provider: Arc::new(RwLock::new(initial_provider)),
        context_builder: Arc::new(ContextBuilder::new()),
        db,
        orchestrator,
        task_engine,
        conversation_manager,
        tool_executor: Arc::new(RwLock::new(tool_executor)),
        memory_manager,
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
        .route("/api/assist/entities/discover", get(discover_entities))
        .route("/api/assist/automations/suggestions", get(get_automation_suggestions))
        .route("/api/assist/context", get(get_smart_home_context))
        // Proactive Messaging (Phase 6)
        .route("/api/assist/notifications/stream", get(notification_stream))
        // Control Center API (Phase 5)
        .route("/api/assist/config/providers", get(list_provider_configs))
        .route("/api/assist/config/providers", post(create_provider_config))
        .route("/api/assist/config/threads", get(list_conversation_threads))
        .route("/api/assist/config/threads", post(create_conversation_thread))
        .route("/api/assist/config/tasks", get(list_autonomous_tasks))
        .route("/api/assist/config/notifications", get(list_pending_notifications))
        .route("/api/assist/config/notifications/send", post(send_notification))
        .route("/api/assist/config/stats", get(get_orchestrator_stats))
        // Tool Execution API (Internet Search & External Tools)
        .route("/api/assist/tools/execute", post(execute_tool))
        .route("/api/assist/tools/search", post(search_internet))
        .route("/api/assist/tools/scrape", post(scrape_webpage))
        .route("/api/assist/tools/screenshot", post(take_webpage_screenshot))
        // Memory API
        .route("/api/assist/memory", get(list_memories))
        .route("/api/assist/memory", post(create_memory))
        .route("/api/assist/memory/search", post(search_memories))
        .route("/api/assist/memory/:id", axum::routing::delete(delete_memory))
        // Active Tasks API
        .route("/api/assist/tasks/active", get(list_active_tasks))
        .route("/api/assist/tasks/active", post(create_active_task))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8092".to_string())
        .parse::<u16>()?;

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!("ORA AI (iora-assist) listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
