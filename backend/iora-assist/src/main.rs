use std::{sync::Arc, time::Instant};

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{error, info};
use uuid::Uuid;

mod providers;

use providers::{
    create_provider, AIProvider, ChatMessage as ProviderChatMessage, ProviderConfig,
    ProviderType,
};

#[derive(Clone)]
struct AppState {
    history: Arc<RwLock<Vec<ChatMessage>>>,
    started_at: Arc<Instant>,
    current_provider: Arc<RwLock<Box<dyn AIProvider>>>,
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

    // Get system prompt
    let system_prompt = req.system_prompt.or_else(|| {
        Some("You are IORA Assist, an AI assistant integrated into the IORA smart home system. You help users manage their home automation, answer questions, and provide insights.".to_string())
    });

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

    let state = AppState {
        history: Arc::new(RwLock::new(Vec::new())),
        started_at: Arc::new(Instant::now()),
        current_provider: Arc::new(RwLock::new(initial_provider)),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/assist/chat", post(chat))
        .route("/api/assist/history", get(chat_history))
        .route("/api/assist/history/clear", post(clear_history))
        .route("/api/assist/suggestions", get(suggestions))
        .route("/api/assist/automate", post(create_automation))
        .route("/api/assist/insights", get(insights))
        .route("/api/assist/providers", get(get_providers))
        .route("/api/assist/providers/switch", post(switch_provider))
        .route("/api/assist/voice/transcribe", post(transcribe_audio))
        .route("/api/assist/voice/synthesize", post(synthesize_speech))
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
