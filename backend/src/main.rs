use axum::{
    extract::{Path, State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{info, warn};

mod ha_client;
mod websocket;

use ha_client::HomeAssistantClient;

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub ha_client: Arc<HomeAssistantClient>,
    pub ws_manager: Arc<websocket::WebSocketManager>,
}

/// Entity state from Home Assistant
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityState {
    pub entity_id: String,
    pub state: String,
    pub attributes: serde_json::Value,
    pub last_changed: String,
    pub last_updated: String,
}

/// Service call request
#[derive(Debug, Deserialize)]
pub struct ServiceCallRequest {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(self)).into_response()
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    // Load environment variables
    dotenv::dotenv().ok();

    // Get Home Assistant configuration
    let ha_url = std::env::var("HA_URL")
        .unwrap_or_else(|_| "http://homeassistant.local:8123".to_string());
    let ha_token = std::env::var("HA_TOKEN")
        .expect("HA_TOKEN environment variable must be set");

    info!("Starting Home Assistant Dashboard Backend");
    info!("Home Assistant URL: {}", ha_url);

    // Initialize Home Assistant client
    let ha_client = Arc::new(HomeAssistantClient::new(ha_url, ha_token));

    // Initialize WebSocket manager
    let ws_manager = Arc::new(websocket::WebSocketManager::new());

    // Create application state
    let state = AppState {
        ha_client: ha_client.clone(),
        ws_manager: ws_manager.clone(),
    };

    // Start background task to poll Home Assistant
    tokio::spawn(poll_home_assistant(
        ha_client.clone(),
        ws_manager.clone(),
    ));

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(health_check))
        // Home Assistant API proxy
        .route("/api/states", get(get_states))
        .route("/api/states/:entity_id", get(get_state))
        .route(
            "/api/services/:domain/:service",
            post(call_service),
        )
        // WebSocket endpoint
        .route("/ws", get(websocket_handler))
        // CORS layer
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        // Tracing layer
        .layer(TraceLayer::new_for_http())
        // Add state
        .with_state(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    info!("Backend server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check endpoint
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// Get all entity states
async fn get_states(
    State(state): State<AppState>,
) -> Result<Json<Vec<EntityState>>, ErrorResponse> {
    match state.ha_client.get_states().await {
        Ok(states) => Ok(Json(states)),
        Err(e) => {
            warn!("Failed to get states: {}", e);
            Err(ErrorResponse {
                error: format!("Failed to get states: {}", e),
            })
        }
    }
}

/// Get single entity state
async fn get_state(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<EntityState>, ErrorResponse> {
    match state.ha_client.get_state(&entity_id).await {
        Ok(Some(entity)) => Ok(Json(entity)),
        Ok(None) => Err(ErrorResponse {
            error: format!("Entity {} not found", entity_id),
        }),
        Err(e) => {
            warn!("Failed to get state for {}: {}", entity_id, e);
            Err(ErrorResponse {
                error: format!("Failed to get state: {}", e),
            })
        }
    }
}

/// Call Home Assistant service
async fn call_service(
    State(state): State<AppState>,
    Path((domain, service)): Path<(String, String)>,
    Json(request): Json<ServiceCallRequest>,
) -> Result<StatusCode, ErrorResponse> {
    match state
        .ha_client
        .call_service(&domain, &service, request.data)
        .await
    {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            warn!("Failed to call service {}.{}: {}", domain, service, e);
            Err(ErrorResponse {
                error: format!("Failed to call service: {}", e),
            })
        }
    }
}

/// WebSocket handler
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| websocket::handle_socket(socket, state.ws_manager))
}

/// Background task to poll Home Assistant and broadcast updates
async fn poll_home_assistant(
    ha_client: Arc<HomeAssistantClient>,
    ws_manager: Arc<websocket::WebSocketManager>,
) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));

    loop {
        interval.tick().await;

        match ha_client.get_states().await {
            Ok(states) => {
                ws_manager.broadcast_states(states).await;
            }
            Err(e) => {
                warn!("Failed to poll Home Assistant: {}", e);
            }
        }
    }
}
