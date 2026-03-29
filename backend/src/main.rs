use axum::{
    extract::{Multipart, Path, RawQuery, State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, get_service, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, net::SocketAddr, path::Path as FsPath, sync::Arc};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::{info, warn};

mod ha_client;
mod ha_websocket;
mod websocket;
mod db;
mod auth;
mod middleware;
mod entity_cache;

use ha_client::HomeAssistantClient;
use ha_websocket::HAWebSocket;
use db::{init_db, DbPool, repositories::ConfigRepository};
use entity_cache::EntityStateCache;

/// Per-entity service call buffer that coalesces rapid-fire requests.
///
/// The **first** call for an entity is sent to HA **immediately** (zero delay).
/// While that call is in flight, any subsequent calls are buffered and only
/// the latest value is kept. After the in-flight call completes, the drain
/// loop checks for buffered data, sleeps briefly, then sends the latest.
/// This gives instant response for single taps while still coalescing slider
/// drags.
pub struct ServiceCallBuffer {
    /// entity_id → latest pending call data (None means drain task should exit)
    pending: tokio::sync::Mutex<HashMap<String, Option<BufferedCall>>>,
}

struct BufferedCall {
    domain: String,
    service: String,
    data: Value,
}

impl ServiceCallBuffer {
    fn new() -> Self {
        Self {
            pending: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Submit a call for an entity. Returns `Some(call)` with the data if this
    /// is the first call (no drain task running). Returns `None` if a drain
    /// task is already active (the data was buffered for it to pick up).
    async fn submit(
        &self,
        entity_id: &str,
        domain: String,
        service: String,
        data: Value,
    ) -> Option<BufferedCall> {
        let mut map = self.pending.lock().await;
        let is_first = !map.contains_key(entity_id);
        if is_first {
            // Reserve the slot so subsequent calls know a drain task exists
            map.insert(entity_id.to_string(), None);
            // Return the call data for immediate dispatch
            Some(BufferedCall { domain, service, data })
        } else {
            // Drain task already running — just buffer the latest value
            map.insert(
                entity_id.to_string(),
                Some(BufferedCall { domain, service, data }),
            );
            None
        }
    }

    /// Take the latest buffered call for an entity. Returns `None` if no new
    /// data has arrived since the last drain (the drain task should exit).
    async fn drain(&self, entity_id: &str) -> Option<BufferedCall> {
        let mut map = self.pending.lock().await;
        match map.get_mut(entity_id) {
            Some(slot) => {
                let call = slot.take(); // take the pending call, leave None
                if call.is_none() {
                    // No new data since last drain — remove entry, signal exit
                    map.remove(entity_id);
                }
                call
            }
            None => None,
        }
    }
}

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub ha_client: Arc<HomeAssistantClient>,
    pub ha_ws: Arc<HAWebSocket>,
    pub ws_manager: Arc<websocket::WebSocketManager>,
    pub db_pool: DbPool,
    pub config_repo: Arc<ConfigRepository>,
    pub entity_cache: Arc<EntityStateCache>,
    pub service_buffer: Arc<ServiceCallBuffer>,
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

/// Error response with proper HTTP status codes
#[derive(Debug)]
pub struct ErrorResponse {
    pub error: String,
    pub status: StatusCode,
}

impl ErrorResponse {
    pub fn internal(error: impl Into<String>) -> Self {
        Self { error: error.into(), status: StatusCode::INTERNAL_SERVER_ERROR }
    }
    pub fn unauthorized(error: impl Into<String>) -> Self {
        Self { error: error.into(), status: StatusCode::UNAUTHORIZED }
    }
    pub fn not_found(error: impl Into<String>) -> Self {
        Self { error: error.into(), status: StatusCode::NOT_FOUND }
    }
    pub fn bad_request(error: impl Into<String>) -> Self {
        Self { error: error.into(), status: StatusCode::BAD_REQUEST }
    }
    pub fn conflict(error: impl Into<String>) -> Self {
        Self { error: error.into(), status: StatusCode::CONFLICT }
    }
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({ "error": self.error }))).into_response()
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

    // Get database configuration
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite:./data/ha-dashboard.db".to_string());

    info!("Starting Home Assistant Dashboard Backend");
    info!("Home Assistant URL: {}", ha_url);
    info!("Database URL: {}", database_url);

    // Initialize database
    let db_pool = init_db(&database_url).await?;

    // Initialize Home Assistant client (REST – used for history/forecasts)
    let ha_client = Arc::new(HomeAssistantClient::new(ha_url.clone(), ha_token.clone()));

    // Initialize WebSocket manager (frontend-facing)
    let ws_manager = Arc::new(websocket::WebSocketManager::new());

    // Initialize configuration repository
    let config_repo = Arc::new(ConfigRepository::new(db_pool.clone()));

    // Initialize entity state cache
    let entity_cache = Arc::new(EntityStateCache::new());

    // Initialize service call buffer
    let service_buffer = Arc::new(ServiceCallBuffer::new());

    // Initialize persistent WebSocket connection to Home Assistant.
    // This replaces REST API polling AND provides instant service call dispatch.
    let ha_ws = Arc::new(HAWebSocket::new(
        ha_url,
        ha_token,
        entity_cache.clone(),
        ws_manager.clone(),
        db_pool.clone(),
    ));

    // Create application state
    let state = AppState {
        ha_client: ha_client.clone(),
        ha_ws,
        ws_manager: ws_manager.clone(),
        db_pool: db_pool.clone(),
        config_repo,
        entity_cache: entity_cache.clone(),
        service_buffer,
    };

    // Start background task to clean up old entity history
    tokio::spawn(cleanup_old_history(db_pool.clone()));

    // Safety-net REST poll: runs infrequently (60s) to catch any drift if the
    // HA WebSocket connection drops. Also does the initial state fetch so the
    // dashboard is usable immediately even while the WS is still connecting.
    tokio::spawn(safety_net_poll(
        ha_client.clone(),
        ws_manager.clone(),
        entity_cache.clone(),
    ));

    // Build router
    // Service routes protected by auth middleware
    let service_routes = Router::new()
        .route(
            "/api/services/:domain/:service",
            post(call_service),
        )
        .layer(axum::middleware::from_fn(middleware::require_auth))
        .with_state(state.clone());

    let app = Router::new()
        // Health check
        .route("/health", get(health_check))
        // Authentication API
        .route("/api/auth/register", post(auth_register))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/verify", get(auth_verify))
        .route("/api/uploads/background", post(upload_background_image))
        // Public media proxy (thumbnails should render even without frontend auth session)
        .route("/api/hass_agent/*path", get(proxy_hass_agent_media))
        .route("/api/image/serve/*path", get(proxy_image_serve_media))
        // Home Assistant API proxy
        .route("/api/states", get(get_states))
        .route("/api/states/:entity_id", get(get_state))
        .route("/api/history/period/:start_time", get(get_history))
        .route("/api/local-history/:entity_id", get(get_local_history))
        // Weather forecast cache
        .route("/api/weather/forecast/:entity_id/:forecast_type", get(get_cached_forecast))
        .route("/api/weather/forecast/:entity_id/:forecast_type", post(save_cached_forecast))
        // Integration API (used by HA custom integration)
        .route("/api/integration/status", get(integration_status))
        .route("/api/integration/command", post(integration_command))
        .route("/api/integration/settings", get(integration_get_settings))
        .route("/api/integration/settings", post(integration_set_settings))
        // Configuration API
        .route("/api/config/users", post(create_user))
        .route("/api/config/users/:username", get(get_user))
        .route("/api/config/users/by-id/:user_id", put(update_user))
        .route("/api/config/devices", post(register_device))
        .route("/api/config/devices/:device_id", get(get_device_info))
        .route("/api/config/devices/:device_id/heartbeat", post(device_heartbeat))
        .route("/api/config/profiles", post(create_profile))
        .route("/api/config/profiles/:profile_id", get(get_profile_data))
        .route("/api/config/profiles/:profile_id/pages", post(save_pages))
        .route("/api/config/profiles/:profile_id/theme", post(save_theme_settings))
        .route("/api/config/profiles/:profile_id/background", post(save_background_config))
        .route("/api/config/preferences/:user_id", post(save_user_preference))
        .route("/api/config/preferences/:user_id", get(get_user_preferences))
        .route("/api/config/system/preferences", post(save_system_preference))
        .route("/api/config/system/preferences", get(get_system_preferences))
        .route("/api/config/sync/changes", get(get_sync_changes))
        // WebSocket endpoint
        .route("/ws", get(websocket_handler))
        .nest_service("/uploads", get_service(ServeDir::new("./data/uploads")))
        // Merge protected service routes
        .merge(service_routes)
        // Serve frontend static assets (JS, CSS, etc.)
        .nest_service("/assets", ServeDir::new("../dist/assets"))
        // SPA fallback – any unmatched route gets index.html for client-side routing
        .fallback(spa_fallback)
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
async fn health_check(
    State(state): State<AppState>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "ha_connected": state.entity_cache.is_ha_connected(),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// SPA fallback – serves index.html for any route not matched by API or static files.
/// This enables client-side routing in the React frontend.
async fn spa_fallback(_uri: Uri) -> impl IntoResponse {
    match tokio::fs::read_to_string("../dist/index.html").await {
        Ok(html) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            html,
        ).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            "Frontend not built. Run 'npm run build' first.",
        ).into_response(),
    }
}

// ---------- Integration API (used by HA custom integration) ----------

/// In-memory dashboard settings controlled by the HA integration.
/// These are stored on the backend so that connected frontends can react.
static DASHBOARD_SETTINGS: std::sync::LazyLock<tokio::sync::RwLock<serde_json::Map<String, Value>>> =
    std::sync::LazyLock::new(|| {
        let mut m = serde_json::Map::new();
        m.insert("screensaver".into(), Value::Bool(false));
        m.insert("auto_theme".into(), Value::Bool(false));
        m.insert("sleep_mode".into(), Value::Bool(false));
        m.insert("webhooks".into(), Value::Bool(true));
        m.insert("brightness".into(), serde_json::json!(100));
        m.insert("theme".into(), Value::String("auto".into()));
        m.insert("current_page".into(), Value::String("home".into()));
        tokio::sync::RwLock::new(m)
    });

/// Returns dashboard status for the HA integration coordinator to poll.
async fn integration_status(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let entity_count = state.entity_cache.count().await;
    let ha_connected = state.entity_cache.is_ha_connected();
    let connected_clients = state.ws_manager.client_count().await;
    let settings = DASHBOARD_SETTINGS.read().await;

    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "ha_connected": ha_connected,
        "connected_clients": connected_clients,
        "entity_count": entity_count,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "settings": Value::Object(settings.clone()),
    }))
}

/// GET /api/integration/settings — returns current dashboard settings.
async fn integration_get_settings() -> impl IntoResponse {
    let settings = DASHBOARD_SETTINGS.read().await;
    Json(serde_json::json!({
        "result": "ok",
        "settings": Value::Object(settings.clone()),
    }))
}

/// POST /api/integration/settings — update one or more settings.
async fn integration_set_settings(
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let updates = body.as_object()
        .ok_or_else(|| ErrorResponse::bad_request("Expected JSON object"))?;
    let mut settings = DASHBOARD_SETTINGS.write().await;
    for (key, value) in updates {
        settings.insert(key.clone(), value.clone());
    }
    Ok(Json(serde_json::json!({
        "result": "ok",
        "settings": Value::Object(settings.clone()),
    })))
}

/// Receives commands from the HA integration (refresh, clear_cache, etc.).
async fn integration_command(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let command = body.get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match command {
        "refresh" => {
            // Trigger a fresh fetch of all entity states from HA
            let entities = state.ha_client.get_states().await
                .map_err(|e| ErrorResponse::internal(format!("HA fetch failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(serde_json::json!({"result": "ok", "action": "refresh"})))
        }
        "notify" => {
            let msg = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            Ok(Json(serde_json::json!({"result": "ok", "action": "notify", "data": msg})))
        }
        "clear_cache" => {
            // Re-fetch everything from HA (effectively clears stale data)
            let entities = state.ha_client.get_states().await
                .map_err(|e| ErrorResponse::internal(format!("Cache clear failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(serde_json::json!({"result": "ok", "action": "clear_cache"})))
        }
        "set_theme" => {
            let theme = body.get("data")
                .and_then(|d| d.get("theme"))
                .and_then(|t| t.as_str())
                .unwrap_or("auto");
            let mut settings = DASHBOARD_SETTINGS.write().await;
            settings.insert("theme".into(), Value::String(theme.into()));
            Ok(Json(serde_json::json!({"result": "ok", "action": "set_theme", "theme": theme})))
        }
        "switch_page" => {
            let page = body.get("data")
                .and_then(|d| d.get("page_id"))
                .and_then(|p| p.as_str())
                .unwrap_or("home");
            let mut settings = DASHBOARD_SETTINGS.write().await;
            settings.insert("current_page".into(), Value::String(page.into()));
            Ok(Json(serde_json::json!({"result": "ok", "action": "switch_page", "page": page})))
        }
        "set_setting" => {
            let data = body.get("data")
                .and_then(|d| d.as_object())
                .ok_or_else(|| ErrorResponse::bad_request("Missing data object"))?;
            let mut settings = DASHBOARD_SETTINGS.write().await;
            for (key, value) in data {
                settings.insert(key.clone(), value.clone());
            }
            Ok(Json(serde_json::json!({"result": "ok", "action": "set_setting"})))
        }
        "set_brightness" => {
            let brightness = body.get("data")
                .and_then(|d| d.get("brightness"))
                .and_then(|b| b.as_u64())
                .unwrap_or(100)
                .min(100);
            let mut settings = DASHBOARD_SETTINGS.write().await;
            settings.insert("brightness".into(), serde_json::json!(brightness));
            Ok(Json(serde_json::json!({"result": "ok", "action": "set_brightness", "brightness": brightness})))
        }
        "restart" => {
            // Trigger a full re-sync (closest thing to a restart without actually stopping the process)
            let entities = state.ha_client.get_states().await
                .map_err(|e| ErrorResponse::internal(format!("Restart re-sync failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(serde_json::json!({"result": "ok", "action": "restart"})))
        }
        _ => Err(ErrorResponse::bad_request(format!("Unknown command: {command}"))),
    }
}

/// Get all entity states (served from cache)
async fn get_states(
    State(state): State<AppState>,
) -> Result<Json<Vec<EntityState>>, ErrorResponse> {
    // Serve from cache if populated
    if state.entity_cache.is_populated().await {
        return Ok(Json(state.entity_cache.get_all().await));
    }
    // Fallback to direct HA call on first request before cache is warm
    match state.ha_client.get_states().await {
        Ok(states) => {
            state.entity_cache.set_ha_connected(true);
            let _ = state.entity_cache.update(states.clone()).await;
            Ok(Json(states))
        }
        Err(e) => {
            warn!("Failed to get states: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get states: {}", e)))
        }
    }
}

/// Get single entity state (served from cache)
async fn get_state(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<EntityState>, ErrorResponse> {
    match state.entity_cache.get(&entity_id).await {
        Some(entity) => Ok(Json(entity)),
        None => Err(ErrorResponse::not_found(format!("Entity {} not found", entity_id))),
    }
}

/// Call Home Assistant service
///
/// For regular service calls (light.turn_on, switch.toggle, etc.) the handler
/// returns 200 OK **immediately** and dispatches the command via the persistent
/// WebSocket connection to HA. This is what the official HA frontend does —
/// commands are dispatched instantly over the existing connection, with no HTTP
/// round-trip or device-confirmation blocking.
///
/// For calls that require a response body (`?return_response` in the query
/// string, e.g. weather.get_forecasts) the handler blocks and returns the
/// full HA response via the REST API.
async fn call_service(
    State(state): State<AppState>,
    Path((domain, service)): Path<(String, String)>,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
    Json(request): Json<ServiceCallRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    let query_str = query.unwrap_or_default();
    let needs_response = query_str.contains("return_response");

    if needs_response {
        // Blocking path — caller needs the response body (e.g. weather forecasts)
        match state
            .ha_client
            .call_service(&domain, &service, request.data, &query_str)
            .await
        {
            Ok(response) => Ok(Json(response)),
            Err(e) => {
                if let Some(status) = e.status_code() {
                    if status >= 500 {
                        warn!("Failed to call service {}.{}: {}", domain, service, e);
                    } else {
                        info!("Service {}.{} returned upstream status {}", domain, service, status);
                    }
                    let status_code = StatusCode::from_u16(status)
                        .unwrap_or(StatusCode::BAD_GATEWAY);
                    return Err(ErrorResponse {
                        error: format!("Failed to call service: {}", e),
                        status: status_code,
                    });
                }
                warn!("Failed to call service {}.{}: {}", domain, service, e);
                Err(ErrorResponse::internal(format!("Failed to call service: {}", e)))
            }
        }
    } else {
        // Fire-and-forget path — dispatch via WebSocket, return 200 immediately.
        //
        // The WebSocket `call_service` command is dispatched instantly over the
        // persistent connection. State changes arrive back via the WS
        // `state_changed` subscription — no need to poll for fresh state.
        let entity_id = request.data
            .get("entity_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let data = request.data;

        if !entity_id.is_empty() {
            // Use the service call buffer to coalesce rapid-fire calls
            // (e.g. brightness slider dragging).
            let first_call = state
                .service_buffer
                .submit(&entity_id, domain.clone(), service.clone(), data)
                .await;

            if let Some(call) = first_call {
                // First call — send IMMEDIATELY
                dispatch_command(&state, &entity_id, &call.domain, &call.service, call.data);

                // Start drain loop for any subsequent buffered calls
                let buffer = state.service_buffer.clone();
                let st = state.clone();
                let eid = entity_id.clone();

                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;

                        let next = match buffer.drain(&eid).await {
                            Some(c) => c,
                            None => break,
                        };

                        dispatch_command(&st, &eid, &next.domain, &next.service, next.data);
                    }
                });
            }
        } else {
            // No entity_id — dispatch directly
            dispatch_command(&state, "", &domain, &service, data);
        }

        Ok(Json(Value::Null))
    }
}

/// Get entity history from Home Assistant
async fn get_history(
    State(state): State<AppState>,
    Path(start_time): Path<String>,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
) -> Result<Json<Value>, ErrorResponse> {
    let query_str = query.unwrap_or_default();
    match state.ha_client.get_history(&start_time, &query_str).await {
        Ok(history) => Ok(Json(history)),
        Err(e) => {
            warn!("Failed to get history: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get history: {}", e)))
        }
    }
}

/// Proxy media assets from Home Assistant hass_agent integration.
/// Uses backend HA credentials for upstream access and is exposed publicly for
/// image tags/clients that do not attach Authorization headers.
async fn proxy_hass_agent_media(
    State(state): State<AppState>,
    Path(path): Path<String>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, ErrorResponse> {
    let query_str = raw_query.unwrap_or_default();

    match state.ha_client.proxy_hass_agent_get(&path, &query_str).await {
        Ok(proxied) => {
            let status = StatusCode::from_u16(proxied.status)
                .unwrap_or(StatusCode::BAD_GATEWAY);
            let mut response = Response::new(axum::body::Body::from(proxied.body));
            *response.status_mut() = status;
            if let Some(content_type) = proxied.content_type {
                if let Ok(value) = header::HeaderValue::from_str(&content_type) {
                    response.headers_mut().insert(header::CONTENT_TYPE, value);
                }
            }
            Ok(response)
        }
        Err(e) => {
            warn!("Failed to proxy hass_agent media: {}", e);
            Err(ErrorResponse::internal(format!("Failed to proxy media: {}", e)))
        }
    }
}

/// Proxy media assets from Home Assistant /api/image/serve endpoint.
/// This keeps image rendering stable for clients that cannot directly reach HA.
async fn proxy_image_serve_media(
    State(state): State<AppState>,
    Path(path): Path<String>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, ErrorResponse> {
    let query_str = raw_query.unwrap_or_default();

    match state.ha_client.proxy_image_serve_get(&path, &query_str).await {
        Ok(proxied) => {
            let status = StatusCode::from_u16(proxied.status)
                .unwrap_or(StatusCode::BAD_GATEWAY);
            let mut response = Response::new(axum::body::Body::from(proxied.body));
            *response.status_mut() = status;
            if let Some(content_type) = proxied.content_type {
                if let Ok(value) = header::HeaderValue::from_str(&content_type) {
                    response.headers_mut().insert(header::CONTENT_TYPE, value);
                }
            }
            Ok(response)
        }
        Err(e) => {
            warn!("Failed to proxy image/serve media: {}", e);
            Err(ErrorResponse::internal(format!("Failed to proxy image media: {}", e)))
        }
    }
}

/// WebSocket handler
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| websocket::handle_socket(
        socket,
        state.ws_manager,
        state.entity_cache,
        state.ha_ws,
        state.ha_client,
        state.service_buffer,
    ))
}

// Configuration API handlers

/// Create a new user
async fn create_user(
    State(state): State<AppState>,
    Json(request): Json<db::models::CreateUserRequest>,
) -> Result<Json<db::models::User>, ErrorResponse> {
    match state.config_repo.create_user(request).await {
        Ok(user) => Ok(Json(user)),
        Err(e) => {
            warn!("Failed to create user: {}", e);
            Err(ErrorResponse::internal(format!("Failed to create user: {}", e)))
        }
    }
}

/// Get user by username
async fn get_user(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<db::models::User>, ErrorResponse> {
    match state.config_repo.get_user_by_username(&username).await {
        Ok(Some(user)) => Ok(Json(user)),
        Ok(None) => Err(ErrorResponse::not_found(format!("User {} not found", username))),
        Err(e) => {
            warn!("Failed to get user: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get user: {}", e)))
        }
    }
}

/// Update user profile fields (username/display name)
async fn update_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<db::models::UpdateUserRequest>,
) -> Result<Json<db::models::User>, ErrorResponse> {
    let token = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(header_value) => {
                if let Some(token) = header_value.strip_prefix("Bearer ") {
                    token
                } else {
                    return Err(ErrorResponse::unauthorized("Invalid authorization header format"));
                }
            }
            Err(_) => {
                return Err(ErrorResponse::unauthorized("Invalid authorization header"));
            }
        },
        None => {
            return Err(ErrorResponse::unauthorized("No authorization header provided"));
        }
    };

    let claims = auth::verify_token(token)
        .map_err(|_| ErrorResponse::unauthorized("Invalid or expired token"))?;

    if claims.sub != user_id {
        return Err(ErrorResponse::unauthorized("Cannot modify another user"));
    }

    match state.config_repo.update_user(&user_id, request).await {
        Ok(Some(user)) => Ok(Json(user)),
        Ok(None) => Err(ErrorResponse::not_found(format!("User {} not found", user_id))),
        Err(e) => {
            if e.to_string().contains("USERNAME_CONFLICT") {
                return Err(ErrorResponse::conflict("Username already exists"));
            }
            warn!("Failed to update user: {}", e);
            Err(ErrorResponse::internal(format!("Failed to update user: {}", e)))
        }
    }
}

/// Register a new device
async fn register_device(
    State(state): State<AppState>,
    Json(request): Json<db::models::RegisterDeviceRequest>,
) -> Result<Json<db::models::Device>, ErrorResponse> {
    match state.config_repo.register_device(request).await {
        Ok(device) => Ok(Json(device)),
        Err(e) => {
            warn!("Failed to register device: {}", e);
            Err(ErrorResponse::internal(format!("Failed to register device: {}", e)))
        }
    }
}

/// Get device information
async fn get_device_info(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
) -> Result<Json<db::models::Device>, ErrorResponse> {
    match state.config_repo.get_device(&device_id).await {
        Ok(Some(device)) => Ok(Json(device)),
        Ok(None) => Err(ErrorResponse::not_found(format!("Device {} not found", device_id))),
        Err(e) => {
            warn!("Failed to get device: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get device: {}", e)))
        }
    }
}

/// Device heartbeat to update last_seen
async fn device_heartbeat(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
) -> Result<StatusCode, ErrorResponse> {
    match state.config_repo.update_device_last_seen(&device_id).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            warn!("Failed to update device heartbeat: {}", e);
            Err(ErrorResponse::internal(format!("Failed to update device heartbeat: {}", e)))
        }
    }
}

/// Create a configuration profile
async fn create_profile(
    State(state): State<AppState>,
    Json(request): Json<db::models::CreateProfileRequest>,
) -> Result<Json<db::models::ConfigurationProfile>, ErrorResponse> {
    match state.config_repo.create_profile(request).await {
        Ok(profile) => Ok(Json(profile)),
        Err(e) => {
            warn!("Failed to create profile: {}", e);
            Err(ErrorResponse::internal(format!("Failed to create profile: {}", e)))
        }
    }
}

/// Get profile with all data
async fn get_profile_data(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<db::models::ProfileWithData>, ErrorResponse> {
    match state.config_repo.get_profile_with_data(&profile_id).await {
        Ok(Some(data)) => Ok(Json(data)),
        Ok(None) => Err(ErrorResponse::not_found(format!("Profile {} not found", profile_id))),
        Err(e) => {
            warn!("Failed to get profile data: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get profile data: {}", e)))
        }
    }
}

/// Save pages configuration
async fn save_pages(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(pages): Json<Vec<db::models::SavePageRequest>>,
) -> Result<StatusCode, ErrorResponse> {
    match state.config_repo.save_pages(&profile_id, pages).await {
        Ok(_) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("pages", &profile_id, "UPDATE", None).await;
            Ok(StatusCode::OK)
        }
        Err(e) => {
            warn!("Failed to save pages: {}", e);
            Err(ErrorResponse::internal(format!("Failed to save pages: {}", e)))
        }
    }
}

/// Save theme settings
async fn save_theme_settings(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(request): Json<db::models::SaveThemeRequest>,
) -> Result<Json<db::models::ThemeSettings>, ErrorResponse> {
    match state.config_repo.save_theme(&profile_id, request).await {
        Ok(theme) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("theme_settings", &profile_id, "UPDATE", None).await;
            Ok(Json(theme))
        }
        Err(e) => {
            warn!("Failed to save theme: {}", e);
            Err(ErrorResponse::internal(format!("Failed to save theme: {}", e)))
        }
    }
}

/// Save background configuration
async fn save_background_config(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(request): Json<db::models::SaveBackgroundRequest>,
) -> Result<Json<db::models::BackgroundConfig>, ErrorResponse> {
    match state.config_repo.save_background(&profile_id, request).await {
        Ok(background) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("background_configs", &profile_id, "UPDATE", None).await;
            Ok(Json(background))
        }
        Err(e) => {
            warn!("Failed to save background: {}", e);
            Err(ErrorResponse::internal(format!("Failed to save background: {}", e)))
        }
    }
}

/// Save user preference
async fn save_user_preference(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(request): Json<db::models::SavePreferenceRequest>,
) -> Result<Json<db::models::UserPreference>, ErrorResponse> {
    match state.config_repo.save_preference(&user_id, None, request).await {
        Ok(pref) => {
            // Record sync metadata
            let _ = state.config_repo.record_change("user_preferences", &user_id, "UPDATE", None).await;
            Ok(Json(pref))
        }
        Err(e) => {
            warn!("Failed to save preference: {}", e);
            Err(ErrorResponse::internal(format!("Failed to save preference: {}", e)))
        }
    }
}

/// Get all user preferences
async fn get_user_preferences(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<Vec<db::models::UserPreference>>, ErrorResponse> {
    match state.config_repo.get_all_preferences(&user_id, None).await {
        Ok(prefs) => Ok(Json(prefs)),
        Err(e) => {
            warn!("Failed to get preferences: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get preferences: {}", e)))
        }
    }
}

/// Save global system preference
async fn save_system_preference(
    State(state): State<AppState>,
    Json(request): Json<db::models::SaveSystemPreferenceRequest>,
) -> Result<Json<db::models::SystemPreference>, ErrorResponse> {
    match state.config_repo.save_system_preference(request).await {
        Ok(pref) => {
            let _ = state.config_repo.record_change("system_preferences", &pref.preference_key, "UPDATE", None).await;
            Ok(Json(pref))
        }
        Err(e) => {
            warn!("Failed to save system preference: {}", e);
            Err(ErrorResponse::internal(format!("Failed to save system preference: {}", e)))
        }
    }
}

/// Get all global system preferences
async fn get_system_preferences(
    State(state): State<AppState>,
) -> Result<Json<Vec<db::models::SystemPreference>>, ErrorResponse> {
    match state.config_repo.get_all_system_preferences().await {
        Ok(prefs) => Ok(Json(prefs)),
        Err(e) => {
            warn!("Failed to get system preferences: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get system preferences: {}", e)))
        }
    }
}

#[derive(Debug, Deserialize)]
struct SyncQuery {
    since: Option<String>,
}

/// Get sync changes since a timestamp
async fn get_sync_changes(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<SyncQuery>,
) -> Result<Json<Vec<db::models::SyncMetadata>>, ErrorResponse> {
    let since = query.since.unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

    match state.config_repo.get_changes_since(&since).await {
        Ok(changes) => Ok(Json(changes)),
        Err(e) => {
            warn!("Failed to get sync changes: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get sync changes: {}", e)))
        }
    }
}

// Authentication API handlers

/// Register a new user
async fn auth_register(
    State(state): State<AppState>,
    Json(request): Json<db::models::RegisterRequest>,
) -> Result<Json<db::models::AuthResponse>, ErrorResponse> {
    // Validate password length
    if request.password.len() < 8 {
        return Err(ErrorResponse::bad_request("Password must be at least 8 characters"));
    }

    // Check if username already exists
    match state.config_repo.get_user_by_username(&request.username).await {
        Ok(Some(_)) => {
            return Err(ErrorResponse::conflict("Username already exists"));
        }
        Ok(None) => {}
        Err(e) => {
            warn!("Failed to check existing user: {}", e);
            return Err(ErrorResponse::internal("Failed to register user"));
        }
    }

    // Hash the password
    let password_hash = match auth::hash_password(&request.password) {
        Ok(hash) => hash,
        Err(e) => {
            warn!("Failed to hash password: {}", e);
            return Err(ErrorResponse::internal("Failed to register user"));
        }
    };

    // Create user with password
    let user_id = uuid::Uuid::new_v4().to_string();
    let query_result = sqlx::query(
        "INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)"
    )
    .bind(&user_id)
    .bind(&request.username)
    .bind(&request.display_name)
    .bind(&password_hash)
    .execute(&state.db_pool)
    .await;

    if let Err(e) = query_result {
        warn!("Failed to create user: {}", e);
        return Err(ErrorResponse::internal("Failed to register user"));
    }

    // Fetch the created user
    let user = match state.config_repo.get_user_by_username(&request.username).await {
        Ok(Some(user)) => user,
        _ => {
            return Err(ErrorResponse::internal("Failed to register user"));
        }
    };

    // Generate JWT token
    let token = match auth::generate_token(&user.id, &user.username, 30) {
        Ok(token) => token,
        Err(e) => {
            warn!("Failed to generate token: {}", e);
            return Err(ErrorResponse::internal("Failed to generate authentication token"));
        }
    };

    Ok(Json(db::models::AuthResponse { token, user }))
}

/// Login an existing user
async fn auth_login(
    State(state): State<AppState>,
    Json(request): Json<db::models::LoginRequest>,
) -> Result<Json<db::models::AuthResponse>, ErrorResponse> {
    // Get user by username
    let user = match state.config_repo.get_user_by_username(&request.username).await {
        Ok(Some(user)) => user,
        Ok(None) => {
            return Err(ErrorResponse::unauthorized("Invalid username or password"));
        }
        Err(e) => {
            warn!("Failed to get user: {}", e);
            return Err(ErrorResponse::internal("Login failed"));
        }
    };

    // Check if user has a password set
    let password_hash = match &user.password_hash {
        Some(hash) => hash,
        None => {
            return Err(ErrorResponse::unauthorized("User has no password set. Please register."));
        }
    };

    // Verify password
    let is_valid = match auth::verify_password(&request.password, password_hash) {
        Ok(valid) => valid,
        Err(e) => {
            warn!("Failed to verify password: {}", e);
            return Err(ErrorResponse::internal("Login failed"));
        }
    };

    if !is_valid {
        return Err(ErrorResponse::unauthorized("Invalid username or password"));
    }

    // Generate JWT token
    let remember_me = request.remember_me.unwrap_or(false);
    let expiration_days = if remember_me { 30 } else { 1 };

    let token = match auth::generate_token(&user.id, &user.username, expiration_days) {
        Ok(token) => token,
        Err(e) => {
            warn!("Failed to generate token: {}", e);
            return Err(ErrorResponse::internal("Failed to generate authentication token"));
        }
    };

    Ok(Json(db::models::AuthResponse { token, user }))
}

#[derive(Debug, Serialize)]
struct UploadResponse {
    url: String,
    file_name: String,
}

async fn upload_background_image(
    State(_state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, ErrorResponse> {
    let token = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(header_value) => header_value.strip_prefix("Bearer ").unwrap_or_default(),
            Err(_) => return Err(ErrorResponse::unauthorized("Invalid authorization header")),
        },
        None => return Err(ErrorResponse::unauthorized("No authorization header provided")),
    };

    if token.is_empty() {
        return Err(ErrorResponse::unauthorized("Missing bearer token"));
    }

    let claims = auth::verify_token(token)
        .map_err(|_| ErrorResponse::unauthorized("Invalid or expired token"))?;

    let user_id = claims.sub;
    let user_upload_dir = format!("./data/uploads/{}", user_id);
    tokio::fs::create_dir_all(&user_upload_dir)
        .await
        .map_err(|e| ErrorResponse::internal(format!("Failed to prepare upload directory: {}", e)))?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("Invalid multipart data: {}", e)))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let original_name = field.file_name().unwrap_or("background.jpg").to_string();
        let extension = FsPath::new(&original_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .filter(|ext| matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif"))
            .unwrap_or_else(|| "jpg".to_string());

        let safe_name = format!("bg-{}.{}", uuid::Uuid::new_v4(), extension);
        let disk_path = format!("{}/{}", user_upload_dir, safe_name);

        let bytes = field
            .bytes()
            .await
            .map_err(|e| ErrorResponse::bad_request(format!("Failed to read upload: {}", e)))?;

        if bytes.is_empty() {
            return Err(ErrorResponse::bad_request("Uploaded file is empty"));
        }

        tokio::fs::write(&disk_path, &bytes)
            .await
            .map_err(|e| ErrorResponse::internal(format!("Failed to save uploaded file: {}", e)))?;

        let public_url = format!("/uploads/{}/{}", user_id, safe_name);
        return Ok(Json(UploadResponse {
            url: public_url,
            file_name: safe_name,
        }));
    }

    Err(ErrorResponse::bad_request("No file field named 'file' provided"))
}

/// Verify a JWT token
async fn auth_verify(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<db::models::User>, ErrorResponse> {
    // Extract token from Authorization header
    let token = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(header_value) => {
                if let Some(token) = header_value.strip_prefix("Bearer ") {
                    token
                } else {
                    return Err(ErrorResponse::unauthorized("Invalid authorization header format"));
                }
            }
            Err(_) => {
                return Err(ErrorResponse::unauthorized("Invalid authorization header"));
            }
        },
        None => {
            return Err(ErrorResponse::unauthorized("No authorization header provided"));
        }
    };

    // Verify token
    let claims = match auth::verify_token(token) {
        Ok(claims) => claims,
        Err(e) => {
            warn!("Token verification failed: {}", e);
            return Err(ErrorResponse::unauthorized("Invalid or expired token"));
        }
    };

    // Get user from database
    let user = match state.config_repo.get_user_by_username(&claims.username).await {
        Ok(Some(user)) => user,
        Ok(None) => {
            return Err(ErrorResponse::unauthorized("User not found"));
        }
        Err(e) => {
            warn!("Failed to get user: {}", e);
            return Err(ErrorResponse::internal("Failed to verify token"));
        }
    };

    Ok(Json(user))
}


#[derive(Debug, Deserialize)]
struct LocalHistoryQuery {
    start: Option<String>,
    end: Option<String>,
}

#[derive(Debug, Serialize)]
struct HistoryRow {
    entity_id: String,
    state: String,
    attributes: Option<serde_json::Value>,
    last_changed: String,
    recorded_at: String,
}

/// Get entity history from local SQLite cache
async fn get_local_history(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<LocalHistoryQuery>,
) -> Result<Json<Vec<HistoryRow>>, ErrorResponse> {
    let start = query.start.unwrap_or_else(|| {
        (chrono::Utc::now() - chrono::Duration::hours(24)).format("%Y-%m-%dT%H:%M:%S").to_string()
    });
    let end = query.end.unwrap_or_else(|| {
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string()
    });

    let rows: Vec<(String, String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT entity_id, state, attributes, last_changed, recorded_at FROM entity_history WHERE entity_id = ? AND recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at ASC"
    )
    .bind(&entity_id)
    .bind(&start)
    .bind(&end)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!("Failed to get local history: {}", e);
        ErrorResponse::internal(format!("Failed to get local history: {}", e))
    })?;

    let history: Vec<HistoryRow> = rows.into_iter().map(|(entity_id, state_val, attrs, last_changed, recorded_at)| {
        let attributes = attrs
            .and_then(|a| serde_json::from_str(&a).ok());
        HistoryRow {
            entity_id,
            state: state_val,
            attributes,
            last_changed,
            recorded_at,
        }
    }).collect();

    Ok(Json(history))
}

/// Get cached weather forecast from local database
async fn get_cached_forecast(
    State(state): State<AppState>,
    Path((entity_id, forecast_type)): Path<(String, String)>,
) -> Result<Json<Value>, ErrorResponse> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT forecast_data, fetched_at FROM weather_forecast_cache WHERE entity_id = ? AND forecast_type = ?"
    )
    .bind(&entity_id)
    .bind(&forecast_type)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        warn!("Failed to get cached forecast: {}", e);
        ErrorResponse::internal(format!("Failed to get cached forecast: {}", e))
    })?;

    match row {
        Some((data, fetched_at)) => {
            let forecast: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
            Ok(Json(serde_json::json!({
                "forecast": forecast,
                "fetched_at": fetched_at,
                "cached": true
            })))
        }
        None => Ok(Json(serde_json::json!({
            "forecast": [],
            "fetched_at": null,
            "cached": false
        }))),
    }
}

/// Save weather forecast to local cache
async fn save_cached_forecast(
    State(state): State<AppState>,
    Path((entity_id, forecast_type)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let forecast_data = body.get("forecast")
        .ok_or_else(|| ErrorResponse::bad_request("Missing 'forecast' field"))?;

    let data_str = serde_json::to_string(forecast_data)
        .map_err(|e| ErrorResponse::internal(format!("Failed to serialize forecast: {}", e)))?;

    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO weather_forecast_cache (entity_id, forecast_type, forecast_data, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(entity_id, forecast_type) DO UPDATE SET forecast_data = excluded.forecast_data, fetched_at = excluded.fetched_at"
    )
    .bind(&entity_id)
    .bind(&forecast_type)
    .bind(&data_str)
    .bind(&now)
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        warn!("Failed to save cached forecast: {}", e);
        ErrorResponse::internal(format!("Failed to save cached forecast: {}", e))
    })?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Dispatch a service call command to Home Assistant.
///
/// If the HA WebSocket is connected, the command goes instantly over WS.
/// Otherwise falls back to the REST API via `call_service_fast` in a
/// background task (fire-and-forget, non-blocking).
fn dispatch_command(state: &AppState, entity_id: &str, domain: &str, service: &str, data: Value) {
    if state.ha_ws.is_connected() {
        // Fast path: instant WS dispatch
        info!("[dispatch] WS → {}.{} entity={} data={}", domain, service, entity_id, data);
        state.ha_ws.call_service(domain, service, entity_id, data);
    } else {
        // Fallback: REST API in background task
        info!("[dispatch] REST fallback → {}.{} entity={}", domain, service, entity_id);
        let ha_client = state.ha_client.clone();
        let domain = domain.to_string();
        let service = service.to_string();
        let entity_id = entity_id.to_string();
        tokio::spawn(async move {
            let mut call_data = data;
            // REST API expects entity_id in the body
            if !entity_id.is_empty() {
                if let Some(obj) = call_data.as_object_mut() {
                    obj.insert("entity_id".to_string(), Value::String(entity_id));
                }
            }
            if let Err(e) = ha_client.call_service_fast(&domain, &service, call_data).await {
                warn!("REST fallback call_service failed: {}", e);
            }
        });
    }
}

/// Safety-net REST poll.
///
/// Does an immediate REST fetch so the dashboard has data even before the HA
/// WebSocket connects.  Then polls every 60 seconds as a fallback in case the
/// WS connection is down.  Real-time updates come from the WS subscription;
/// this is just insurance.
async fn safety_net_poll(
    ha_client: Arc<HomeAssistantClient>,
    ws_manager: Arc<websocket::WebSocketManager>,
    entity_cache: Arc<EntityStateCache>,
) {
    // Immediate initial fetch so the dashboard doesn't start empty
    match ha_client.get_states().await {
        Ok(states) => {
            entity_cache.set_ha_connected(true);
            let (changed, _) = entity_cache.update(states).await;
            if !changed.is_empty() {
                ws_manager.broadcast_state_updates(changed).await;
            }
            info!("Initial state fetch complete ({} entities)", entity_cache.count().await);
        }
        Err(e) => {
            warn!("Initial state fetch failed (HA WS will retry): {}", e);
        }
    }

    // Then poll as a safety net — fast (5s) when WS is down, slow (60s) when up
    loop {
        // Skip full cycle if WS is connected
        if entity_cache.is_ha_connected() {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            continue;
        }

        // WS is down — poll every 5s so state updates still arrive reasonably fast
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        if entity_cache.is_ha_connected() {
            continue;
        }

        match ha_client.get_states().await {
            Ok(states) => {
                entity_cache.set_ha_connected(true);
                let (changed, _) = entity_cache.update(states).await;
                if !changed.is_empty() {
                    ws_manager.broadcast_state_updates(changed).await;
                }
            }
            Err(e) => {
                entity_cache.set_ha_connected(false);
                warn!("Safety-net poll failed: {}", e);
            }
        }
    }
}

/// Background task to clean up old entity history (runs hourly, deletes >7 days)
async fn cleanup_old_history(db_pool: DbPool) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600));

    loop {
        interval.tick().await;

        let cutoff = (chrono::Utc::now() - chrono::Duration::days(7))
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();

        match sqlx::query("DELETE FROM entity_history WHERE recorded_at < ?")
            .bind(&cutoff)
            .execute(&db_pool)
            .await
        {
            Ok(result) => {
                let rows = result.rows_affected();
                if rows > 0 {
                    info!("Cleaned up {} old entity history rows", rows);
                }
            }
            Err(e) => {
                warn!("Failed to clean up entity history: {}", e);
            }
        }
    }
}
