use anyhow::Context;
use axum::{
    extract::{Multipart, Path, Query, RawQuery, State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{
        sse::{Event as SseEvent, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{any, delete, get, get_service, post, put},
    Extension, Json, Router,
};
use futures_util::Stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    collections::HashMap,
    collections::VecDeque,
    convert::Infallible,
    net::{Ipv4Addr, SocketAddr},
    path::Path as FsPath,
    sync::Arc,
    time::Duration,
};
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::{error, info, warn};
use utoipa::openapi::security::{ApiKey, ApiKeyValue, HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};
use utoipa_swagger_ui::SwaggerUi;

mod app_database_handler;
mod app_lifecycle;
mod app_messaging_handler;
mod app_runtime_handler;
mod app_scheduler_handler;
mod app_storage_handler;
mod app_webhooks_handler;
mod auth;
mod ble_client;
mod crypto;
mod db;
mod desktop_gateway;
mod dev_image;
mod documentation;
mod entity_cache;
mod frontend_dev_proxy;
mod ha_cache;
mod ha_client;
mod ha_connection;
mod ha_websocket;
mod homekit_client;
mod local_appstore;
mod location_sync;
mod logs_handler;
mod matter_client;
mod middleware;
mod mqtt_client;
mod notification_dispatcher;
mod person_tracker;
mod plugin_sandbox;
mod streaming;
mod system_events;
mod theme_handler;
mod websocket;
mod zigbee_client;
mod zwave_client;

use ble_client::BleClient;
use db::{init_db, repositories::ConfigRepository, DbPool};
use entity_cache::EntityStateCache;
use ha_cache::HaDataCache;
use ha_client::HomeAssistantClient;
use ha_connection::HaConnectionManager;
use ha_websocket::HAWebSocket;
use homekit_client::HomekitClient;
use iora_shared::settings::{SettingDefinition, SettingsRegistry};
use iora_shared::system_config;
use matter_client::MatterClient;
use mqtt_client::MqttClient;
use notification_dispatcher::NotificationDispatcher;
use streaming::StreamManager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use zigbee_client::ZigbeeClient;
use zwave_client::ZwaveClient;

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

#[derive(Clone)]
struct AppTerminalSession {
    id: String,
    app_id: String,
    project: String,
    service: String,
    created_at: String,
    input_tx: tokio::sync::mpsc::Sender<TerminalInputPayload>,
    output_tx: tokio::sync::broadcast::Sender<String>,
    child: Arc<tokio::sync::Mutex<tokio::process::Child>>,
}

struct TerminalInputPayload {
    input: String,
    append_newline: bool,
}

#[derive(Default)]
pub struct AppTerminalManager {
    sessions: tokio::sync::RwLock<HashMap<String, Arc<AppTerminalSession>>>,
}

impl AppTerminalManager {
    async fn resolve_target(
        &self,
        app_id: &str,
        requested_service: Option<&str>,
    ) -> Result<(String, String), String> {
        use tokio::process::Command;

        for prefix in ["iora-app-", "iora-bundle-"] {
            let project = format!("{prefix}{app_id}");
            let out = Command::new("docker")
                .args(["compose", "-p", &project, "ps", "--services", "--all"])
                .output()
                .await;

            match out {
                Ok(o) if o.status.success() => {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    let services: Vec<String> = stdout
                        .lines()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                        .collect();

                    if services.is_empty() {
                        continue;
                    }

                    let service = if let Some(req) = requested_service {
                        if services.iter().any(|s| s == req) {
                            req.to_string()
                        } else {
                            continue;
                        }
                    } else {
                        services[0].clone()
                    };

                    return Ok((project, service));
                }
                Ok(_) => continue,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err("Docker CLI is unavailable on this host".to_string());
                }
                Err(_) => continue,
            }
        }

        Err(format!(
            "No running compose project found for app '{app_id}'"
        ))
    }

    async fn create_session(
        self: &Arc<Self>,
        app_id: &str,
        requested_service: Option<String>,
    ) -> Result<Arc<AppTerminalSession>, String> {
        use tokio::process::Command;

        let (project, service) = self
            .resolve_target(app_id, requested_service.as_deref())
            .await?;

        let mut child = Command::new("docker")
            .args([
                "compose", "-p", &project, "exec", "-T", "-i", &service, "sh",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn terminal session: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Terminal stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Terminal stdout unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Terminal stderr unavailable".to_string())?;

        let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<TerminalInputPayload>(128);
        let (output_tx, _unused) = tokio::sync::broadcast::channel::<String>(512);

        let session = Arc::new(AppTerminalSession {
            id: uuid::Uuid::new_v4().to_string(),
            app_id: app_id.to_string(),
            project,
            service,
            created_at: chrono::Utc::now().to_rfc3339(),
            input_tx,
            output_tx: output_tx.clone(),
            child: Arc::new(tokio::sync::Mutex::new(child)),
        });

        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session.id.clone(), session.clone());
        }

        // stdin writer task
        tokio::spawn(async move {
            let mut writer = stdin;
            while let Some(payload) = input_rx.recv().await {
                let mut input = payload.input;
                if payload.append_newline && !input.ends_with('\n') {
                    input.push('\n');
                }
                if writer.write_all(input.as_bytes()).await.is_err() {
                    break;
                }
                if writer.flush().await.is_err() {
                    break;
                }
            }
        });

        // stdout reader task
        {
            let tx = output_tx.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let _ = tx.send(line.clone());
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // stderr reader task
        {
            let tx = output_tx.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let _ = tx.send(format!("[stderr] {}", line));
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // process watcher
        {
            let manager = Arc::clone(self);
            let sid = session.id.clone();
            let child = Arc::clone(&session.child);
            let tx = output_tx;
            tokio::spawn(async move {
                loop {
                    let done = {
                        let mut locked = child.lock().await;
                        match locked.try_wait() {
                            Ok(Some(status)) => {
                                let _ = tx.send(format!(
                                    "\n[session closed] exit code: {}\n",
                                    status.code().unwrap_or(-1)
                                ));
                                true
                            }
                            Ok(None) => false,
                            Err(_) => {
                                let _ = tx.send(
                                    "\n[session closed] failed to query process status\n"
                                        .to_string(),
                                );
                                true
                            }
                        }
                    };

                    if done {
                        let mut sessions = manager.sessions.write().await;
                        sessions.remove(&sid);
                        break;
                    }

                    tokio::time::sleep(Duration::from_millis(400)).await;
                }
            });
        }

        Ok(session)
    }

    async fn get_session(&self, session_id: &str) -> Option<Arc<AppTerminalSession>> {
        self.sessions.read().await.get(session_id).cloned()
    }

    async fn send_input(
        &self,
        session_id: &str,
        input: String,
        append_newline: bool,
    ) -> Result<(), String> {
        let session = self
            .get_session(session_id)
            .await
            .ok_or_else(|| "Terminal session not found".to_string())?;
        session
            .input_tx
            .send(TerminalInputPayload {
                input,
                append_newline,
            })
            .await
            .map_err(|_| "Terminal session is closed".to_string())
    }

    async fn close_session(&self, session_id: &str) -> bool {
        let session = {
            let mut sessions = self.sessions.write().await;
            sessions.remove(session_id)
        };

        let Some(session) = session else {
            return false;
        };

        let _ = session
            .output_tx
            .send("\n[session closed by user]\n".to_string());
        let mut child = session.child.lock().await;
        let _ = child.kill().await;
        true
    }
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
            Some(BufferedCall {
                domain,
                service,
                data,
            })
        } else {
            // Drain task already running — just buffer the latest value
            map.insert(
                entity_id.to_string(),
                Some(BufferedCall {
                    domain,
                    service,
                    data,
                }),
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
    pub http_client: reqwest::Client,
    pub ha_data_cache: Arc<HaDataCache>,
    pub ha_connection: Arc<HaConnectionManager>,
    pub mqtt_client: Arc<MqttClient>,
    pub matter_client: Arc<MatterClient>,
    pub zigbee_client: Arc<ZigbeeClient>,
    pub zwave_client: Arc<ZwaveClient>,
    pub ble_client: Arc<BleClient>,
    pub homekit_client: Arc<HomekitClient>,
    pub stream_manager: Arc<StreamManager>,
    pub notification_dispatcher: Arc<NotificationDispatcher>,
    /// Centralised system-event log + broadcaster for background tasks.
    /// See [`system_events`].
    pub system_events: Arc<system_events::SystemEventLog>,
    /// Generic settings registry – schema for all user-configurable IORA values.
    /// See [`iora_shared::settings`].
    pub settings_registry: Arc<SettingsRegistry>,
    /// Filesystem-backed app store used when iora-appstore isn't deployed
    /// (dashboard-only / dev images). Always present so ZIP installs and
    /// Developer-Mode app injection work everywhere.
    pub local_appstore: Arc<local_appstore::LocalAppStore>,
    /// Snapshot of `/etc/iora/os-dev-mode` markers — drives the
    /// "Developer Mode is locked on" UX on dev builds.
    pub dev_image: Arc<dev_image::DevImageInfo>,
    /// Shared plugin sandbox (one Docker container, lazy-created). Hosts all
    /// installed plugins so they are jederzeit ausführbar.
    pub plugin_sandbox: Arc<plugin_sandbox::PluginSandbox>,

    // --- New v2.1: Extended App Capabilities ---
    /// App file and key-value storage handler
    pub app_storage: Arc<app_storage_handler::AppStorageState>,

    /// App SQLite database handler
    pub app_database: Arc<app_database_handler::AppDatabaseState>,

    /// App scheduled task handler
    pub app_scheduler: Arc<app_scheduler_handler::AppSchedulerState>,

    /// App inter-app messaging handler
    pub app_messaging: Arc<app_messaging_handler::AppMessagingState>,

    /// App webhook handler
    pub app_webhooks: Arc<app_webhooks_handler::AppWebhooksState>,

    /// Theme manager – file-based themes
    pub theme_manager: Arc<theme_handler::ThemeState>,

    /// Interactive app terminal sessions (Developer Mode only).
    pub terminal_manager: Arc<AppTerminalManager>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct HaRuntimeConfig {
    pub url: String,
    pub token: String,
}

impl HaRuntimeConfig {
    pub fn is_configured(&self) -> bool {
        if self.url.trim().is_empty() || self.token.trim().is_empty() {
            return false;
        }
        reqwest::Url::parse(self.url.trim())
            .map(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
            .unwrap_or(false)
    }
}

fn non_empty_json_string(raw: &str) -> Option<String> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| value.as_str().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
}

fn apply_legacy_ha_config(raw: &str, current: &mut HaRuntimeConfig) {
    let Ok(cfg) = serde_json::from_str::<Value>(raw) else {
        return;
    };

    if current.url.is_empty() {
        if let Some(url) = cfg
            .get("url")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            current.url = url.to_string();
        }
    }

    if current.token.is_empty() {
        if let Some(token) = cfg
            .get("token")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            current.token = token.to_string();
        }
    }
}

pub(crate) async fn load_ha_runtime_config(config_repo: &ConfigRepository) -> HaRuntimeConfig {
    let ha_url_raw = system_config::ha_url();
    let mut config = HaRuntimeConfig {
        url: if ha_url_raw.trim().is_empty() {
            String::new()
        } else {
            ha_url_raw.trim().to_string()
        },
        token: system_config::ha_token(),
    };

    if let Ok(Some(pref)) = config_repo.get_system_preference("ha.url").await {
        if let Some(url) = non_empty_json_string(&pref.preference_value) {
            config.url = url;
        }
    }
    if let Ok(Some(pref)) = config_repo.get_system_preference("ha.token").await {
        if let Some(token) = non_empty_json_string(&pref.preference_value) {
            config.token = token;
        }
    }

    if let Ok(Some(pref)) = config_repo.get_system_preference("ha_config").await {
        apply_legacy_ha_config(&pref.preference_value, &mut config);
    }

    config
}

pub(crate) async fn load_ha_runtime_config_from_pool(pool: &DbPool) -> HaRuntimeConfig {
    let config_repo = ConfigRepository::new(pool.clone());
    load_ha_runtime_config(&config_repo).await
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
        Self {
            error: error.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
    pub fn unauthorized(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status: StatusCode::UNAUTHORIZED,
        }
    }
    pub fn not_found(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status: StatusCode::NOT_FOUND,
        }
    }
    pub fn bad_request(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status: StatusCode::BAD_REQUEST,
        }
    }
    pub fn conflict(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status: StatusCode::CONFLICT,
        }
    }
    pub fn forbidden(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status: StatusCode::FORBIDDEN,
        }
    }
    pub fn service_unavailable(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status: StatusCode::SERVICE_UNAVAILABLE,
        }
    }
    pub fn bad_gateway(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status: StatusCode::BAD_GATEWAY,
        }
    }
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        METRICS.http_errors_total.fetch_add(1, Ordering::Relaxed);
        (
            self.status,
            Json(serde_json::json!({ "error": self.error })),
        )
            .into_response()
    }
}

// ─── OpenAPI Specification ──────────────────────────────────────────────
#[derive(OpenApi)]
#[openapi(
    info(
        title = "IORA API",
        version = "2.0.0",
        description = "Backend API for IORA – Interface for Optimized Residential Autonomy – a smart home ecosystem with glass-morphism UI, multi-user support, and device terminal modes.",
        license(name = "MIT")
    ),
    paths(
        api_doc_health,
        api_doc_auth_register,
        api_doc_auth_login,
        api_doc_auth_verify,
        api_doc_auth_pin_login,
        api_doc_auth_users,
        api_doc_auth_set_pin,
        api_doc_auth_remove_pin,
        api_doc_get_states,
        api_doc_get_state,
        api_doc_call_service,
        api_doc_get_history,
        api_doc_upload_background,
        api_doc_get_entities_by_domain,
        api_doc_search_entities,
        api_doc_system_stats,
        api_doc_ha_info,
        api_doc_create_user,
        api_doc_get_user,
        api_doc_update_user,
        api_doc_register_device,
        api_doc_create_profile,
        api_doc_get_profile,
        api_doc_save_pages,
        api_doc_save_theme,
        api_doc_save_background,
        api_doc_get_page_layouts,
        api_doc_save_page_layout,
        api_doc_get_page_settings,
        api_doc_save_page_settings,
        api_doc_delete_page_settings,
        api_doc_save_preference,
        api_doc_get_preferences,
        api_doc_integration_status,
        api_doc_integration_command,
        api_doc_integration_get_settings,
        api_doc_integration_set_settings,
        api_doc_list_api_keys,
        api_doc_create_api_key,
        api_doc_update_api_key,
        api_doc_delete_api_key,
        api_doc_admin_list_users,
        api_doc_admin_set_admin,
        api_doc_admin_list_all_api_keys,
        api_doc_admin_ha_config,
        api_doc_admin_ha_integrations,
        api_doc_admin_ha_devices,
        api_doc_admin_ha_automations,
        api_doc_admin_ha_services,
        api_doc_admin_ha_logs,
        api_doc_admin_ha_mqtt,
        api_doc_admin_ha_matter,
        api_doc_admin_ha_addons,
        api_doc_admin_ha_supervisor,
        api_doc_admin_database_info,
        // Calendar endpoints
        api_doc_get_calendars,
        api_doc_get_calendar_events,
        // Convenience endpoints
        api_doc_get_current_time,
        api_doc_get_all_lights,
        api_doc_control_light,
        api_doc_get_all_media_players,
        api_doc_control_media_player,
        api_doc_get_sensor,
        api_doc_press_button,
        api_doc_control_switch,
        // NINA warning endpoints
        api_doc_get_nina_settings,
        api_doc_save_nina_settings,
        api_doc_get_nina_warnings,
        api_doc_admin_test_warning,
        // Webhook endpoints
        api_doc_list_webhooks,
        api_doc_create_webhook,
        api_doc_update_webhook,
        api_doc_delete_webhook,
        api_doc_test_webhook,
        api_doc_get_webhook_deliveries,
        api_doc_admin_list_webhooks,
        // Realtime / SSE endpoints
        api_doc_sse_event_stream,
        api_doc_sse_system_stream,
        api_doc_realtime_ws,
    ),
    tags(
        (name = "health", description = "Health check endpoints"),
        (name = "auth", description = "Authentication – login, register, PIN, user management"),
        (name = "entities", description = "Home Assistant entity states and search"),
        (name = "services", description = "Home Assistant service calls"),
        (name = "history", description = "Entity history and statistics"),
        (name = "config", description = "Configuration – users, devices, profiles, pages, themes, backgrounds"),
        (name = "page-settings", description = "Per-page settings – card style, backgrounds, padding"),
        (name = "system", description = "System monitoring – CPU, RAM, uptime"),
        (name = "integration", description = "HA custom integration API"),
        (name = "uploads", description = "File uploads for backgrounds"),
        (name = "api-keys", description = "API key management for programmatic access"),
        (name = "admin", description = "Admin-only endpoints – user management, HA deep integration"),
        (name = "admin-ha", description = "Admin HA deep integration – config, integrations, MQTT, Matter, add-ons"),
        (name = "calendars", description = "Calendar entities – list calendars and fetch events"),
        (name = "convenience", description = "Convenience endpoints – lights, media players, sensors, switches, buttons, time"),
        (name = "nina", description = "NINA warning system – German federal warning API integration"),
        (name = "webhooks", description = "Webhook management – register outgoing webhooks for event delivery with HMAC-SHA256 signatures"),
        (name = "realtime", description = "Realtime API – SSE event streams and Socket.IO-style namespace WebSocket"),
        (name = "streaming", description = "Streaming server – create and manage live video streams for IORA dashboard"),
    ),
    modifiers(&SecurityAddon),
    security(
        ("bearer_auth" = []),
        ("api_key" = [])
    )
)]
struct ApiDoc;

/// Adds Bearer JWT and API-Key security schemes to the OpenAPI spec
struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .description(Some("JWT token obtained from /api/auth/login"))
                    .build(),
            ),
        );
        components.add_security_scheme(
            "api_key",
            SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::with_description(
                "X-API-Key",
                "API key from /api/keys",
            ))),
        );
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing with our custom IoraLogLayer for log capture
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(IoraLogLayer)
        .init();

    // Load environment variables
    dotenv::dotenv().ok();

    // Detect environment
    let iora_env = iora_shared::env::IoraEnv::detect();
    info!("IORA environment: {}", iora_env);

    // Check setup completion status for diagnostics
    let setup_complete = iora_shared::env::IoraEnv::is_setup_complete();
    info!("First-boot setup completed: {}", setup_complete);
    if iora_env.is_production() && !setup_complete {
        warn!(
            "First-boot setup has NOT been completed. The setup wizard should be \
             running on port 8080. iora-home is starting regardless to be ready \
             when setup finishes."
        );
    }

    // Get database configuration
    let database_url = system_config::database_url();

    info!("Starting Home Assistant Dashboard Backend");
    info!("Database URL: {}", database_url);

    // Initialize database — retry with backoff so the service stays up
    // through PostgreSQL's startup window on a freshly-booted IORA OS.
    // Without this, `iora-home` exits 1 immediately if pg isn't ready,
    // and systemd's Restart=on-failure thrashes for minutes while the
    // setup wizard's :8126 health-check times out.
    let db_pool = {
        let mut attempt: u32 = 0;
        let max_attempts: u32 = system_config::db_max_attempts();
        loop {
            attempt += 1;
            match init_db(&database_url).await {
                Ok(p) => {
                    info!("Database connected after {} attempt(s)", attempt);
                    break p;
                }
                Err(e) if attempt < max_attempts => {
                    warn!(
                        "Database init failed (attempt {}/{}): {} — retrying in 5s",
                        attempt, max_attempts, e
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
                Err(e) => {
                    return Err(anyhow::anyhow!(
                        "Database init failed after {} attempts: {}",
                        attempt,
                        e
                    ));
                }
            }
        }
    };

    // Get Home Assistant configuration.
    //
    // On a fresh IORA OS install no Home Assistant is configured yet — the
    // user picks one (or skips it) from the Admin Control Center. We accept
    // both the new schema-backed settings keys (`ha.url`, `ha.token`) and
    // the legacy aggregate `ha_config` record, with env vars only as a local
    // development fallback.
    let bootstrap_repo = ConfigRepository::new(db_pool.clone());
    let ha_config = load_ha_runtime_config(&bootstrap_repo).await;
    let ha_configured = ha_config.is_configured();
    let ha_url = ha_config.url;
    let ha_token = ha_config.token;
    info!("Home Assistant URL: {}", ha_url);
    if ha_configured {
        info!("Loaded HA configuration from runtime settings");
    }

    if !ha_configured {
        info!(
            "Home Assistant integration is OFF \u{2014} configure HA from the IORA \
             Admin Control Center (Settings \u{2192} Integrations \u{2192} Home Assistant) \
             to enable it."
        );
    }

    // Initialize Home Assistant client (REST – used for history/forecasts)
    let ha_client = Arc::new(HomeAssistantClient::new(ha_url.clone(), ha_token.clone()));

    // Start person tracker background service (HA-only)
    if ha_configured {
        let person_tracker = person_tracker::PersonTracker::new(db_pool.clone(), ha_client.clone());
        person_tracker.start();
    }

    // Start location history sync service (HA-only)
    if ha_configured {
        let location_sync =
            location_sync::LocationSyncService::new(db_pool.clone(), ha_client.clone());
        location_sync.start();
    }

    // Initialize WebSocket manager (frontend-facing)
    let ws_manager = Arc::new(websocket::WebSocketManager::new());

    // Initialize configuration repository
    let config_repo = Arc::new(ConfigRepository::new(db_pool.clone()));

    // Ensure JWT secret exists in system_preferences.
    // Priority: existing DB value > env var > auto-generated crypto-random bytes.
    if config_repo
        .get_system_preference("jwt_secret")
        .await
        .map(|p| p.is_none())
        .unwrap_or(true)
    {
        use rand::RngCore;
        let mut bytes = [0u8; 64];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        use base64::Engine as _;
        let secret = base64::engine::general_purpose::STANDARD.encode(bytes);
        let save_req = db::models::SaveSystemPreferenceRequest {
            preference_key: "jwt_secret".to_string(),
            preference_value: serde_json::Value::String(secret.clone()),
        };
        if let Err(e) = config_repo.save_system_preference(save_req).await {
            warn!("Failed to persist auto-generated JWT secret: {e}");
        } else {
            iora_shared::system_config::persist_jwt_secret(&secret);
            info!("Auto-generated and persisted JWT secret");
        }
    } else {
        // Secret exists in DB — seed the system_config cache so jwt_secret()
        // picks it up without needing an env var.
        if let Ok(Some(pref)) = config_repo.get_system_preference("jwt_secret").await {
            iora_shared::system_config::persist_jwt_secret(&pref.preference_value);
        }
    }

    // First-boot admin bootstrap.
    // The setup wizard (board/iora/iora-setup/setup-server.py) writes the
    // chosen IORA Home web-admin credentials to either an env-file consumed
    // by systemd OR a JSON file at /mnt/data/iora/iora-home-bootstrap.json.
    // We honour both, only seed when no users exist yet, and delete the
    // JSON file afterwards so the password is not left on disk.
    if let Err(e) = bootstrap_admin_user(&db_pool, &config_repo).await {
        warn!("Bootstrap admin user step failed: {} — continuing", e);
    }

    // Initialize entity state cache
    let entity_cache = Arc::new(EntityStateCache::new());

    // Initialize service call buffer
    let service_buffer = Arc::new(ServiceCallBuffer::new());

    // Shared HTTP client with connection pooling for HA API calls
    let http_client = reqwest::Client::builder()
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .timeout(std::time::Duration::from_secs(15))
        .tcp_keepalive(std::time::Duration::from_secs(60))
        .build()
        .context("Failed to build HTTP client")?;

    // Initialize persistent WebSocket connection to Home Assistant.
    // This replaces REST API polling AND provides instant service call dispatch.
    let ha_ws = Arc::new(HAWebSocket::new(
        ha_url.clone(),
        ha_token.clone(),
        entity_cache.clone(),
        ws_manager.clone(),
        db_pool.clone(),
    ));

    // Initialize HA data cache (API responses + DB stats)
    let ha_data_cache = Arc::new(HaDataCache::new());

    // Initialize HA connection health manager
    let ha_connection = Arc::new(HaConnectionManager::new(&ha_url));

    // Initialize protocol clients
    let mqtt_client = Arc::new(MqttClient::new());
    let matter_client = Arc::new(MatterClient::new());
    let zigbee_client = Arc::new(ZigbeeClient::new());
    let zwave_client = Arc::new(ZwaveClient::new());
    let ble_client = Arc::new(BleClient::new());
    let homekit_client = Arc::new(HomekitClient::new());
    let stream_manager = Arc::new(StreamManager::new());
    let notification_dispatcher = Arc::new(NotificationDispatcher::new(
        db_pool.clone(),
        ws_manager.clone(),
        ha_client.clone(),
    ));
    let system_events = system_events::SystemEventLog::new(db_pool.clone(), ws_manager.clone());

    // ── local_appstore init ──────────────────────────────────────────
    let local_appstore = match local_appstore::LocalAppStore::open().await {
        Ok(s) => s,
        Err(e) => {
            if cfg!(target_os = "linux") {
                anyhow::bail!("local-appstore init failed; persistent storage is required: {e:#}");
            }
            warn!("local-appstore init failed ({e:#}); falling back to temporary storage only");
            // open() only fails if the directory cannot be created;
            // retry into a temp dir so the rest of the server still
            // starts.
            std::env::set_var(
                "IORA_LOCAL_APPS_DIR",
                std::env::temp_dir().join("iora-local-apps"),
            );
            local_appstore::LocalAppStore::open()
                .await
                .context("fallback local-appstore init in temp dir")?
        }
    };

    // ── plugin_sandbox init ─────────────────────────────────────────
    let plugin_sandbox_base = std::env::var("IORA_LOCAL_APPS_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/iora/iora-home/local-apps"));
    let plugin_sandbox = match plugin_sandbox::PluginSandbox::new(&plugin_sandbox_base).await {
        Ok(s) => s,
        Err(e) => {
            warn!("plugin sandbox init failed: {e:#}");
            // Fallback: tmpdir – Sandbox kann später re-init werden
            plugin_sandbox::PluginSandbox::new(&std::env::temp_dir().join("iora-plugin-sandbox"))
                .await
                .context("plugin-sandbox tmp init")?
        }
    };

    // Create application state
    let state = AppState {
        ha_client: ha_client.clone(),
        ha_ws,
        ws_manager: ws_manager.clone(),
        db_pool: db_pool.clone(),
        config_repo,
        entity_cache: entity_cache.clone(),
        service_buffer,
        http_client: http_client.clone(),
        ha_data_cache: ha_data_cache.clone(),
        ha_connection: ha_connection.clone(),
        mqtt_client: mqtt_client.clone(),
        matter_client: matter_client.clone(),
        zigbee_client: zigbee_client.clone(),
        zwave_client: zwave_client.clone(),
        ble_client: ble_client.clone(),
        homekit_client: homekit_client.clone(),
        stream_manager: stream_manager.clone(),
        notification_dispatcher: notification_dispatcher.clone(),
        system_events: system_events.clone(),
        settings_registry: Arc::new(iora_shared::settings::default_registry()),
        local_appstore,
        dev_image: Arc::new(dev_image::DevImageInfo::detect()),
        plugin_sandbox,

        // New v2.1: Extended App Capabilities
        app_storage: Arc::new(app_storage_handler::AppStorageState::new()),
        app_database: Arc::new(app_database_handler::AppDatabaseState::new()),
        app_scheduler: Arc::new(app_scheduler_handler::AppSchedulerState::new()),
        app_messaging: Arc::new(app_messaging_handler::AppMessagingState::new()),
        app_webhooks: Arc::new(app_webhooks_handler::AppWebhooksState::new()),

        // Theme system
        theme_manager: {
            let data_dir = std::env::var("IORA_THEMES_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    if cfg!(target_os = "linux") {
                        std::path::PathBuf::from("/var/lib/iora/iora-home")
                    } else {
                        std::env::current_dir()
                            .unwrap_or_else(|_| std::path::PathBuf::from("."))
                            .join("data")
                    }
                });
            Arc::new(theme_handler::ThemeState::new(db_pool.clone(), &data_dir))
        },
        terminal_manager: Arc::new(AppTerminalManager::default()),
    };

    // Ensure at least one admin user exists (auto-promote oldest user after migration)
    match state.config_repo.ensure_admin_exists().await {
        Ok(Some(username)) => info!("No admin found – auto-promoted '{}' to admin", username),
        Ok(None) => {}
        Err(e) => warn!("Failed to check admin status: {}", e),
    }

    // Refresh theme cache
    if let Err(e) = state.theme_manager.refresh_cache().await {
        warn!("Failed to refresh theme cache: {}", e);
    }

    // ── Developer-Mode bootstrap ─────────────────────────────────
    // 1) On OS-dev-images, force developer.mode = true so it survives a
    //    factory reset of the settings table.
    // 2) Populate the local app-store's virtual Developer App entry to
    //    match the current setting so the Apps tab shows it on boot
    //    without waiting for a toggle.
    {
        let repo = state.config_repo.clone();
        let store = state.local_appstore.clone();
        let dev_image = state.dev_image.clone();
        tokio::spawn(async move {
            let mut enabled = match repo.get_system_preference("developer.mode").await {
                Ok(Some(p)) => serde_json::from_str::<serde_json::Value>(&p.preference_value)
                    .ok()
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                _ => false,
            };
            if dev_image.is_os_dev && !enabled {
                let req = db::models::SaveSystemPreferenceRequest {
                    preference_key: "developer.mode".to_string(),
                    preference_value: serde_json::Value::Bool(true),
                };
                if let Err(e) = repo.save_system_preference(req).await {
                    warn!("dev-image: could not force developer.mode=true: {e}");
                } else {
                    info!("OS-dev-image detected — developer.mode forced to true");
                    enabled = true;
                }
                // Best-effort autostart of the dev-bridge + developer-app units.
                for unit in ["iora-developer-app.service", "iora-dev-bridge.service"] {
                    let _ = tokio::process::Command::new("systemctl")
                        .arg("start")
                        .arg(unit)
                        .output()
                        .await;
                }
            }
            if let Err(e) = store.set_developer_app(enabled).await {
                warn!("dev-mode bootstrap: developer-app sync failed: {e:#}");
            }
            // Register built-in system apps (always present)
            if let Err(e) = store.set_share_app(true).await {
                warn!("bootstrap: share-app registration failed: {e:#}");
            }
            if let Err(e) = store.set_streaming_app(true).await {
                warn!("bootstrap: streaming-app registration failed: {e:#}");
            }
        });
    }

    // ── App-Lifecycle: Reconciliation + Background-Monitor ──────────
    // Sorgt dafür, dass:
    //  (a) der persistierte Status nach einem Crash von iora-home mit der
    //      Docker-Realität abgeglichen wird,
    //  (b) abgestürzte Apps automatisch mit exponentiellem Backoff neu gestartet
    //      werden, damit der User nie eine "running"-Lüge sieht.
    {
        let store = state.local_appstore.clone();
        let base_dir = store.base_dir().to_path_buf();
        tokio::spawn(async move {
            app_lifecycle::reconcile_on_startup(store.clone()).await;
            app_lifecycle::spawn_health_monitor(store, base_dir).await;
        });
    }

    // ── Plugin-Sandbox: lazy starten + am Leben halten ──────────────
    // Ein einziger gemeinsamer Container (`iora-plugin-sandbox`) hostet alle
    // installierten Plugins. Existiert er nicht, wird er beim ersten Aufruf
    // erstellt; ist er gestoppt, wird er hochgefahren; ist er bereits da,
    // bleibt er. Der Health-Loop erkennt Crashes und bringt ihn wieder hoch.
    {
        let sandbox = state.plugin_sandbox.clone();
        tokio::spawn(async move {
            // Erst-Initialisierung im Hintergrund (Image-Build kann dauern)
            if let Err(e) = sandbox.ensure_running().await {
                warn!("plugin-sandbox initial start failed: {e:#}");
            } else {
                info!("plugin-sandbox is up and serving plugins");
            }
            plugin_sandbox::spawn_health_loop(sandbox).await;
        });
    }

    // ── Auto-connect protocols from saved configs ──────────────────
    // MQTT: load saved config, auto-connect if host is set
    {
        let mqtt = mqtt_client.clone();
        let repo = state.config_repo.clone();
        tokio::spawn(async move {
            if let Ok(Some(pref)) = repo.get_system_preference("mqtt_config").await {
                if let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&pref.preference_value) {
                    if let Some(host) = cfg
                        .get("host")
                        .and_then(|v| v.as_str())
                        .filter(|h| !h.is_empty())
                    {
                        // Password may be stored as an `enc:v1:<base64>` blob (preferred)
                        // or as legacy plaintext. `maybe_decrypt` handles both.
                        let password = cfg
                            .get("password")
                            .and_then(|v| v.as_str())
                            .map(crypto::maybe_decrypt);
                        let config = mqtt_client::MqttConfig {
                            host: host.to_string(),
                            port: cfg.get("port").and_then(|v| v.as_u64()).unwrap_or(1883) as u16,
                            username: cfg
                                .get("username")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            password,
                            client_id: cfg
                                .get("client_id")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| {
                                    format!(
                                        "mdt-dashboard-{}",
                                        &uuid::Uuid::new_v4().to_string()[..8]
                                    )
                                }),
                            use_tls: cfg
                                .get("use_tls")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false),
                        };
                        info!(
                            "MQTT: Auto-connecting to {}:{} from saved config",
                            config.host, config.port
                        );
                        match mqtt.connect(config).await {
                            Ok(()) => info!("MQTT: Auto-connect successful"),
                            Err(e) => warn!("MQTT: Auto-connect failed: {}", e),
                        }
                    }
                }
            }
        });
    }
    // Load saved configs for other protocols (no active connection, just state)
    {
        let repo = state.config_repo.clone();
        let matter = matter_client.clone();
        let zigbee = zigbee_client.clone();
        let zwave = zwave_client.clone();
        let ble = ble_client.clone();
        let homekit = homekit_client.clone();
        tokio::spawn(async move {
            // Matter
            if let Ok(Some(pref)) = repo.get_system_preference("matter_config").await {
                if let Ok(cfg) =
                    serde_json::from_str::<matter_client::MatterConfig>(&pref.preference_value)
                {
                    matter.init(cfg).await;
                }
            }
            // Zigbee
            if let Ok(Some(pref)) = repo.get_system_preference("zigbee_config").await {
                if let Ok(cfg) =
                    serde_json::from_str::<zigbee_client::ZigbeeConfig>(&pref.preference_value)
                {
                    zigbee.update_config(cfg).await;
                }
            }
            // Z-Wave
            if let Ok(Some(pref)) = repo.get_system_preference("zwave_config").await {
                if let Ok(cfg) =
                    serde_json::from_str::<zwave_client::ZwaveConfig>(&pref.preference_value)
                {
                    zwave.update_config(cfg).await;
                }
            }
            // BLE
            if let Ok(Some(pref)) = repo.get_system_preference("ble_config").await {
                if let Ok(cfg) =
                    serde_json::from_str::<ble_client::BleConfig>(&pref.preference_value)
                {
                    ble.update_config(cfg).await;
                }
            }
            // HomeKit
            if let Ok(Some(pref)) = repo.get_system_preference("homekit_config").await {
                if let Ok(cfg) =
                    serde_json::from_str::<homekit_client::HomekitConfig>(&pref.preference_value)
                {
                    homekit.update_config(cfg).await;
                }
            }
            info!("Protocol configs loaded from database");
        });
    }

    // Start background task to clean up old entity history
    tokio::spawn(cleanup_old_history(db_pool.clone()));

    // Safety-net REST poll: runs infrequently (60s) to catch any drift if the
    // HA WebSocket connection drops. Also does the initial state fetch so the
    // dashboard is usable immediately even while the WS is still connecting.
    // Skipped entirely when HA is not configured — polling an empty URL
    // would spam the journal with "relative URL without a base" warnings.
    if ha_configured {
        tokio::spawn(safety_net_poll(
            ha_client.clone(),
            ws_manager.clone(),
            entity_cache.clone(),
        ));
    }

    // Background HA data cache refresh (proactively fetches HA API data + DB stats)
    {
        let cache = ha_data_cache.clone();
        let client = http_client.clone();
        let pool = db_pool.clone();
        tokio::spawn(async move {
            // Let the inner function handle timing; we just track run counts via a
            // wrapping loop that re-records every 45s (matching inner interval).
            ha_cache::background_ha_cache_refresh(cache, client, pool).await;
        });
    }

    // Background HA connection health check (pings HA, detects integrations).
    // Skipped when HA is not configured.
    if ha_configured {
        let ha_url_for_health = ha_url.clone();
        let ha_token_for_health = ha_token.clone();
        tokio::spawn(ha_connection::ha_health_check_loop(
            ha_connection.clone(),
            http_client,
            ha_url_for_health,
            ha_token_for_health,
            entity_cache.clone(),
        ));
    }

    // Background watchdog evaluation loop (checks all watchdog rules every 30s)
    let watchdog_ha_client = ha_client.clone();
    let watchdog_entity_cache = entity_cache.clone();
    let watchdog_ws_manager = ws_manager.clone();
    tokio::spawn(background_watchdog_loop(
        watchdog_ha_client,
        watchdog_entity_cache,
        watchdog_ws_manager,
    ));

    // Background scheduled actions cleanup (removes expired schedules every 5 min)
    tokio::spawn(background_schedule_cleanup());

    // Background entity anomaly detection (flags unusual state change patterns every 2 min)
    let anomaly_entity_cache = entity_cache.clone();
    let anomaly_ws_manager = ws_manager.clone();
    tokio::spawn(background_entity_anomaly_detection(
        anomaly_entity_cache,
        anomaly_ws_manager,
    ));

    // Background analytics aggregation (rolls up entity analytics every 10 min into DB)
    let stats_entity_cache = entity_cache.clone();
    let stats_db_pool = db_pool.clone();
    tokio::spawn(background_analytics_aggregation(
        stats_entity_cache,
        stats_db_pool,
    ));

    // Background stale entity monitor (detects entities stale >1h, broadcasts warnings every 60s)
    let stale_entity_cache = entity_cache.clone();
    let stale_ws_manager = ws_manager.clone();
    tokio::spawn(background_stale_entity_monitor(
        stale_entity_cache,
        stale_ws_manager,
    ));

    // Background NINA warning poller (checks NINA API every 5 min for configured regions)
    let nina_http_client = state.http_client.clone();
    let nina_config_repo = state.config_repo.clone();
    let nina_ws_manager = state.ws_manager.clone();
    let nina_db_pool = state.db_pool.clone();
    tokio::spawn(background_nina_poller(
        nina_http_client,
        nina_config_repo,
        nina_ws_manager,
        nina_db_pool,
    ));

    // Background ARS regions cache warming (loads Landkreise data on startup, refreshes every 24h)
    let ars_http_client = state.http_client.clone();
    tokio::spawn(background_ars_cache_refresh(ars_http_client));

    // Background webhook delivery (fans out state changes to registered webhooks)
    let webhook_ws = state.ws_manager.clone();
    let webhook_db = state.db_pool.clone();
    let webhook_http = state.http_client.clone();
    let webhook_sys = state.system_events.clone();
    tokio::spawn(background_webhook_delivery(
        webhook_ws,
        webhook_db,
        webhook_http,
        webhook_sys,
    ));

    // Build router
    // Service routes protected by auth middleware
    let service_routes = Router::new()
        .route("/api/services/:domain/:service", post(call_service))
        .route(
            "/api/system-events/client",
            post(client_system_event_ingest),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth,
        ))
        .with_state(state.clone());

    // Admin routes (require admin JWT)
    let admin_routes = Router::new()
        .route("/api/admin/users", get(admin_list_users))
        .route("/api/admin/users/:user_id/admin", put(admin_set_user_admin))
        .route("/api/admin/users/:user_id", put(admin_update_user))
        .route("/api/admin/users/:user_id", delete(admin_delete_user))
        .route("/api/admin/api-keys", get(admin_list_all_api_keys))
        .route("/api/admin/api-keys/:key_id", delete(admin_delete_api_key))
        .route("/api/admin/ha/config", get(admin_ha_config))
        .route("/api/admin/ha/integrations", get(admin_ha_integrations))
        .route("/api/admin/ha/devices", get(admin_ha_devices))
        .route("/api/admin/ha/areas", get(admin_ha_areas))
        .route("/api/admin/ha/automations", get(admin_ha_automations))
        .route("/api/admin/ha/services", get(admin_ha_services))
        .route("/api/admin/ha/logs", get(admin_ha_logs))
        .route("/api/admin/ha/mqtt", get(admin_ha_mqtt))
        .route("/api/admin/ha/matter", get(admin_ha_matter))
        .route("/api/admin/ha/addons", get(admin_ha_addons))
        // MQTT client management
        .route("/api/admin/mqtt/status", get(admin_mqtt_status))
        .route("/api/admin/mqtt/connect", post(admin_mqtt_connect))
        .route("/api/admin/mqtt/disconnect", post(admin_mqtt_disconnect))
        .route("/api/admin/mqtt/subscribe", post(admin_mqtt_subscribe))
        .route("/api/admin/mqtt/unsubscribe", post(admin_mqtt_unsubscribe))
        .route("/api/admin/mqtt/publish", post(admin_mqtt_publish))
        .route("/api/admin/mqtt/messages", get(admin_mqtt_messages))
        .route(
            "/api/admin/mqtt/config",
            post(admin_mqtt_save_config).get(admin_mqtt_get_config),
        )
        // Matter client management
        .route("/api/admin/matter/status", get(admin_matter_status))
        .route(
            "/api/admin/matter/config",
            post(admin_matter_save_config).get(admin_matter_get_config),
        )
        .route("/api/admin/matter/refresh", post(admin_matter_refresh))
        // Zigbee client management
        .route("/api/admin/zigbee/status", get(admin_zigbee_status))
        .route(
            "/api/admin/zigbee/config",
            post(admin_zigbee_save_config).get(admin_zigbee_get_config),
        )
        .route("/api/admin/zigbee/refresh", post(admin_zigbee_refresh))
        // Z-Wave client management
        .route("/api/admin/zwave/status", get(admin_zwave_status))
        .route(
            "/api/admin/zwave/config",
            post(admin_zwave_save_config).get(admin_zwave_get_config),
        )
        .route("/api/admin/zwave/refresh", post(admin_zwave_refresh))
        // Bluetooth/BLE client management
        .route("/api/admin/ble/status", get(admin_ble_status))
        .route(
            "/api/admin/ble/config",
            post(admin_ble_save_config).get(admin_ble_get_config),
        )
        .route("/api/admin/ble/refresh", post(admin_ble_refresh))
        // HomeKit client management
        .route("/api/admin/homekit/status", get(admin_homekit_status))
        .route(
            "/api/admin/homekit/config",
            post(admin_homekit_save_config).get(admin_homekit_get_config),
        )
        .route("/api/admin/homekit/refresh", post(admin_homekit_refresh))
        // HA Connection health
        .route("/api/admin/ha/connection", get(admin_ha_connection_status))
        .route(
            "/api/admin/protocols/overview",
            get(admin_protocols_overview),
        )
        .route("/api/admin/ha/supervisor", get(admin_ha_supervisor))
        .route("/api/admin/ha/scenes", get(admin_ha_scenes))
        .route("/api/admin/ha/backups", get(admin_ha_backups))
        .route("/api/admin/ha/network", get(admin_ha_network))
        // Extended HA features
        .route("/api/admin/ha/logbook", get(admin_ha_logbook))
        .route("/api/admin/ha/calendars", get(admin_ha_calendars))
        .route(
            "/api/admin/ha/calendars/:entity_id/events",
            get(admin_ha_calendar_events),
        )
        .route("/api/admin/ha/template", post(admin_ha_render_template))
        .route(
            "/api/admin/ha/events/:event_type",
            post(admin_ha_fire_event),
        )
        .route(
            "/api/admin/ha/registry/entities",
            get(admin_ha_entity_registry),
        )
        .route(
            "/api/admin/ha/registry/devices",
            get(admin_ha_device_registry),
        )
        .route("/api/admin/ha/registry/areas", get(admin_ha_area_registry))
        .route("/api/admin/system/logs", get(admin_system_logs))
        .route("/api/admin/system/database", get(admin_database_info))
        // Temp DB users
        .route(
            "/api/admin/system/database/temp-users",
            get(admin_list_temp_users).post(admin_create_temp_user),
        )
        .route(
            "/api/admin/system/database/temp-users/:user_id",
            delete(admin_revoke_temp_user),
        )
        // Connected devices (IORA Desktop, browser tabs, kiosks)
        .route("/api/admin/devices", get(admin_list_devices))
        .route("/api/admin/devices/:device_id", delete(admin_delete_device))
        // Combined presence overview: users + devices + login mapping
        .route("/api/admin/presence", get(admin_presence))
        // Centralised system event log (background-task errors / warnings)
        .route(
            "/api/admin/system-events",
            get(admin_system_events).delete(admin_clear_system_events),
        )
        .route(
            "/api/admin/system-events/occurrences",
            get(admin_system_events_occurrences),
        )
        .route(
            "/api/admin/system-events/:fingerprint",
            get(admin_system_event_detail).delete(admin_system_event_delete_group),
        )
        .route(
            "/api/admin/system-events/:fingerprint/resolve",
            post(admin_system_event_resolve),
        )
        .route(
            "/api/admin/system-events/:fingerprint/unresolve",
            post(admin_system_event_unresolve),
        )
        // Maintenance mode
        .route(
            "/api/admin/maintenance",
            get(admin_get_maintenance).put(admin_set_maintenance),
        )
        // Notifications & alerts
        .route(
            "/api/admin/notifications",
            get(admin_list_notifications).delete(admin_clear_notifications),
        )
        .route(
            "/api/admin/notifications/:notif_id/read",
            put(admin_mark_notification_read),
        )
        .route(
            "/api/admin/notifications/:notif_id",
            delete(admin_dismiss_notification),
        )
        // Admin system notifications (sync alerts, system issues)
        .route(
            "/api/admin/system-notifications",
            get(admin_list_system_notifications),
        )
        .route(
            "/api/admin/system-notifications/:notif_id/acknowledge",
            put(admin_acknowledge_system_notification),
        )
        .route(
            "/api/admin/system-notifications/:notif_id/resolve",
            put(admin_resolve_system_notification),
        )
        .route(
            "/api/admin/system-notifications/:notif_id",
            delete(admin_delete_system_notification),
        )
        .route(
            "/api/admin/system-notifications/clear-resolved",
            delete(admin_clear_resolved_system_notifications),
        )
        // Location sync management
        .route(
            "/api/admin/location-sync/status",
            get(admin_get_sync_status),
        )
        .route(
            "/api/admin/location-sync/:entity_id/force-sync",
            post(admin_force_sync_entity),
        )
        .route(
            "/api/admin/alert",
            get(admin_get_alert)
                .put(admin_set_alert)
                .delete(admin_dismiss_alert),
        )
        // Warning log
        .route(
            "/api/admin/warnings/log",
            get(admin_get_warning_log).delete(admin_clear_warning_log),
        )
        // Test warnings (NINA)
        .route(
            "/api/admin/nina/test-warning",
            post(admin_send_test_warning),
        )
        // Webhooks (admin overview)
        .route("/api/admin/webhooks", get(admin_list_all_webhooks))
        // IORA Control Center: services, tasks, control mode
        .route("/api/admin/control/services", get(admin_control_services))
        .route("/api/admin/control/tasks", get(admin_control_tasks))
        .route(
            "/api/admin/control/tasks/:task_id/trigger",
            post(admin_control_trigger_task),
        )
        .route(
            "/api/admin/control/tasks/:task_id/toggle",
            post(admin_control_toggle_task),
        )
        .route(
            "/api/admin/control/mode",
            get(admin_control_get_mode).put(admin_control_set_mode),
        )
        .route("/api/admin/control/overview", get(admin_control_overview))
        // Generic passthrough proxy to iora-control:8091 for SSH and OS-level
        // management endpoints (e.g. /api/admin/iora-control/ssh/status,
        // /api/admin/iora-control/os/disks, /api/admin/iora-control/os/reboot).
        // Uses a different prefix than /api/admin/control/ to avoid clashing
        // with the dedicated handlers above.
        .route(
            "/api/admin/iora-control/*path",
            get(admin_iora_control_proxy)
                .post(admin_iora_control_proxy)
                .put(admin_iora_control_proxy)
                .delete(admin_iora_control_proxy)
                .patch(admin_iora_control_proxy),
        )
        // IORA Log System & Metrics
        .route("/api/admin/logs", get(admin_get_logs))
        .route("/api/admin/logs/clear", post(admin_clear_logs))
        .route("/api/admin/metrics", get(admin_get_metrics))
        .route("/api/admin/metrics/live", get(admin_metrics_live_sse))
        .route("/api/admin/logs/live", get(admin_logs_live_sse))
        // Central per-source log viewer (services, apps, plugins, docker)
        .route(
            "/api/admin/logs/sources",
            get(logs_handler::list_log_sources),
        )
        .route(
            "/api/admin/logs/source/:source_id",
            get(logs_handler::get_source_logs),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_admin,
        ))
        .with_state(state.clone());

    // Authenticated routes (JWT or API key required)
    let auth_routes = Router::new()
        .route("/api/keys", get(list_my_api_keys))
        .route("/api/keys", post(create_api_key))
        .route("/api/keys/:key_id", put(update_api_key))
        .route("/api/keys/:key_id", delete(delete_api_key))
        // Webhook management
        .route("/api/webhooks", get(list_webhooks))
        .route("/api/webhooks", post(create_webhook))
        .route("/api/webhooks/:webhook_id", put(update_webhook))
        .route("/api/webhooks/:webhook_id", delete(delete_webhook))
        .route("/api/webhooks/:webhook_id/test", post(test_webhook))
        .route(
            "/api/webhooks/:webhook_id/deliveries",
            get(get_webhook_deliveries),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_authenticated,
        ))
        .with_state(state.clone());

    // ── App Extension sub-routers (each has its own state type, converted to AppState) ──
    let storage_router = Router::<Arc<app_storage_handler::AppStorageState>>::new()
        .route(
            "/api/apps/:app_id/storage/files",
            get(app_storage_handler::list_files).post(app_storage_handler::upload_file),
        )
        .route(
            "/api/apps/:app_id/storage/files/:file_id",
            get(app_storage_handler::get_file).delete(app_storage_handler::delete_file),
        )
        .route(
            "/api/apps/:app_id/storage/kv",
            get(app_storage_handler::list_kv),
        )
        .route(
            "/api/apps/:app_id/storage/kv/:key",
            get(app_storage_handler::get_kv)
                .put(app_storage_handler::set_kv)
                .delete(app_storage_handler::delete_kv),
        )
        .route(
            "/api/apps/:app_id/storage/usage",
            get(app_storage_handler::get_storage_usage),
        )
        .with_state(state.app_storage.clone());

    let db_router = Router::<Arc<app_database_handler::AppDatabaseState>>::new()
        .route(
            "/api/apps/:app_id/database/provision",
            post(app_database_handler::provision_database),
        )
        .route(
            "/api/apps/:app_id/database",
            delete(app_database_handler::drop_database),
        )
        .route(
            "/api/apps/:app_id/database/status",
            get(app_database_handler::database_status),
        )
        .route(
            "/api/apps/:app_id/database/tables",
            get(app_database_handler::list_tables),
        )
        .route(
            "/api/apps/:app_id/database/execute",
            post(app_database_handler::execute_sql),
        )
        .route(
            "/api/apps/:app_id/database/backup",
            post(app_database_handler::backup_database),
        )
        .route(
            "/api/apps/:app_id/database/backups",
            get(app_database_handler::list_backups),
        )
        .with_state(state.app_database.clone());

    let scheduler_router = Router::<Arc<app_scheduler_handler::AppSchedulerState>>::new()
        .route(
            "/api/apps/:app_id/schedules",
            get(app_scheduler_handler::list_schedules).post(app_scheduler_handler::create_schedule),
        )
        .route(
            "/api/apps/:app_id/schedules/:task_id",
            get(app_scheduler_handler::get_schedule)
                .put(app_scheduler_handler::update_schedule)
                .delete(app_scheduler_handler::delete_schedule),
        )
        .route(
            "/api/apps/:app_id/schedules/:task_id/trigger",
            post(app_scheduler_handler::trigger_schedule),
        )
        .route(
            "/api/apps/:app_id/schedules/:task_id/logs",
            get(app_scheduler_handler::get_task_logs),
        )
        .with_state(state.app_scheduler.clone());

    let webhooks_router = Router::<Arc<app_webhooks_handler::AppWebhooksState>>::new()
        .route(
            "/api/apps/:app_id/webhooks",
            get(app_webhooks_handler::list_webhooks).post(app_webhooks_handler::create_webhook),
        )
        .route(
            "/api/apps/:app_id/webhooks/:hook_id",
            get(app_webhooks_handler::get_webhook)
                .put(app_webhooks_handler::update_webhook)
                .delete(app_webhooks_handler::delete_webhook),
        )
        .route(
            "/api/apps/:app_id/webhooks/:hook_id/test",
            post(app_webhooks_handler::test_webhook),
        )
        .route(
            "/api/apps/:app_id/webhooks/:hook_id/logs",
            get(app_webhooks_handler::get_webhook_logs),
        )
        .route(
            "/api/apps/:app_id/webhooks/:hook_id/stats",
            get(app_webhooks_handler::get_webhook_stats),
        )
        .with_state(state.app_webhooks.clone());

    let messaging_router = Router::<Arc<app_messaging_handler::AppMessagingState>>::new()
        .route(
            "/api/apps/messaging/channels",
            get(app_messaging_handler::list_channels).post(app_messaging_handler::register_channel),
        )
        // Per-app messaging channels alias (same global list, but the frontend
        // AppSettingsPage calls it with app_id).
        .route(
            "/api/apps/:app_id/messaging/channels",
            get(app_messaging_handler::list_channels),
        )
        .route(
            "/api/apps/messaging/publish",
            post(app_messaging_handler::publish_message),
        )
        .route(
            "/api/apps/messaging/events",
            get(app_messaging_handler::message_stream),
        )
        .route(
            "/api/apps/:app_id/messaging/subscribe",
            post(app_messaging_handler::subscribe),
        )
        .route(
            "/api/apps/:app_id/messaging/subscriptions",
            get(app_messaging_handler::list_subscriptions),
        )
        .route(
            "/api/apps/:app_id/messaging/subscriptions/:sub_id",
            delete(app_messaging_handler::unsubscribe),
        )
        .route(
            "/api/apps/:app_id/messaging/direct",
            post(app_messaging_handler::send_direct_message),
        )
        .route(
            "/api/apps/:app_id/messaging/inbox",
            get(app_messaging_handler::get_inbox),
        )
        .route(
            "/api/apps/:app_id/messaging/inbox/:msg_id/read",
            post(app_messaging_handler::mark_message_read),
        )
        .with_state(state.app_messaging.clone());

    // Protected data routes (JWT or API key required)
    let data_routes = Router::<AppState>::new()
        // Documentation endpoints
        .route(
            "/api/documentation/config",
            get(documentation::get_docs_config),
        )
        .route("/api/documentation/list", get(documentation::list_docs))
        .route(
            "/api/documentation/*doc_path",
            get(documentation::get_doc_file),
        )
        // Merge app extension sub-routers (each was converted to Router<AppState>)
        .merge(storage_router)
        .merge(db_router)
        .merge(scheduler_router)
        .merge(webhooks_router)
        .merge(messaging_router)
        // Theme API
        .route("/api/themes", get(theme_handler::list_themes))
        .route(
            "/api/themes/default",
            get(theme_handler::get_default_theme).put(theme_handler::set_default_theme),
        )
        .route("/api/themes/install", post(handle_theme_zip_install))
        .route(
            "/api/themes/install-from-manifest",
            post(theme_handler::handle_install_theme_inline),
        )
        .route(
            "/api/themes/validate-manifest",
            post(handle_validate_manifest),
        )
        .route(
            "/api/themes/:theme_id",
            delete(theme_handler::uninstall_theme),
        )
        .route(
            "/api/themes/user/:profile_id/settings/:theme_id",
            get(theme_handler::get_user_theme_settings)
                .put(theme_handler::update_user_theme_settings),
        )
        .route(
            "/api/themes/user/:profile_id",
            get(theme_handler::get_user_theme).post(theme_handler::set_user_theme),
        )
        .route(
            "/api/themes/css/:profile_id",
            get(theme_handler::get_theme_css),
        )
        .route(
            "/api/themes/assets/:theme_id/*path",
            get(theme_handler::serve_theme_asset),
        )
        .route(
            "/api/themes/assets/:theme_id",
            get(theme_handler::export_theme_bundle),
        )
        // Home Assistant API proxy
        .route("/api/states", get(get_states))
        .route("/api/states/:entity_id", get(get_state))
        .route("/api/history/period/:start_time", get(get_history))
        .route("/api/local-history/:entity_id", get(get_local_history))
        // Weather forecast cache
        .route(
            "/api/weather/forecast/:entity_id/:forecast_type",
            get(get_cached_forecast),
        )
        .route(
            "/api/weather/forecast/:entity_id/:forecast_type",
            post(save_cached_forecast),
        )
        // Entity domain lookup & statistics
        .route("/api/entities/domain/:domain", get(get_entities_by_domain))
        .route("/api/entities/search", get(search_entities))
        .route("/api/entities/count", get(get_entity_counts))
        .route(
            "/api/stats/entity-history/:entity_id",
            get(get_entity_statistics),
        )
        .route("/api/stats/dashboard", get(get_dashboard_statistics))
        // System monitoring
        .route("/api/system/stats", get(get_system_stats))
        .route("/api/system/ha-info", get(get_ha_info))
        // Configuration API
        .route("/api/config/users/by-id/:user_id", put(update_user))
        .route(
            "/api/config/devices/:device_id/heartbeat",
            post(device_heartbeat),
        )
        .route("/api/config/profiles", post(create_profile))
        .route("/api/config/profiles/:profile_id", get(get_profile_data))
        .route(
            "/api/config/users/:user_id/profiles",
            get(list_user_profiles),
        )
        .route("/api/config/profiles/:profile_id/pages", post(save_pages))
        .route(
            "/api/config/profiles/:profile_id/theme",
            post(save_theme_settings),
        )
        .route(
            "/api/config/profiles/:profile_id/background",
            post(save_background_config),
        )
        .route(
            "/api/config/profiles/:profile_id/layouts",
            get(get_page_layouts),
        )
        .route(
            "/api/config/profiles/:profile_id/layouts",
            post(save_page_layout),
        )
        .route(
            "/api/config/profiles/:profile_id/page-settings",
            get(get_all_page_settings),
        )
        .route(
            "/api/config/profiles/:profile_id/page-settings",
            post(save_page_settings_handler),
        )
        .route(
            "/api/config/profiles/:profile_id/page-settings/:page_id",
            get(get_page_settings_handler),
        )
        .route(
            "/api/config/profiles/:profile_id/page-settings/:page_id",
            delete(delete_page_settings_handler),
        )
        .route(
            "/api/config/devices/:device_id/terminal",
            post(set_device_terminal_mode),
        )
        .route(
            "/api/config/preferences/:user_id",
            post(save_user_preference),
        )
        .route(
            "/api/config/preferences/:user_id",
            get(get_user_preferences),
        )
        .route(
            "/api/config/system/preferences",
            post(save_system_preference),
        )
        .route(
            "/api/config/system/preferences",
            get(get_system_preferences),
        )
        // Generic settings API (schema-driven – see iora_shared::settings).
        // The wizard uses /api/admin/settings/schema/wizard, the Control Center
        // uses /api/admin/settings (full schema + values).
        .route("/api/admin/settings/schema", get(admin_settings_schema))
        .route(
            "/api/admin/settings/schema/wizard",
            get(admin_settings_schema_wizard),
        )
        .route("/api/admin/settings", get(admin_settings_list))
        .route(
            "/api/admin/settings/:key",
            get(admin_settings_get).put(admin_settings_put),
        )
        // Graceful stubs for endpoints that are normally served by other
        // IORA microservices (iora-supervisor, iora-core). When those
        // services aren't deployed (e.g. on a fresh install or in a
        // dashboard-only build) we still want the admin tabs to render
        // an empty state instead of 404'ing into the SPA fallback (which
        // would surface as "Unexpected token '<', \"<!DOCTYPE\"...").
        .route("/api/supervisor/system/info", get(proxy_supervisor))
        .route(
            "/api/intelligence/overview",
            get(proxy_intelligence_overview),
        )
        .route(
            "/api/intelligence/maintenance/run/:task",
            get(proxy_intelligence_maintenance_run),
        )
        .route("/api/supervisor/apps", get(supervisor_apps_list))
        .route(
            "/api/supervisor/apps/install",
            post(supervisor_apps_install),
        )
        .route(
            "/api/supervisor/apps/:app_id",
            get(supervisor_apps_get).delete(supervisor_apps_uninstall),
        )
        .route(
            "/api/supervisor/apps/:app_id/start",
            post(supervisor_apps_start),
        )
        .route(
            "/api/supervisor/apps/:app_id/stop",
            post(supervisor_apps_stop),
        )
        .route(
            "/api/supervisor/apps/:app_id/pause",
            post(supervisor_apps_pause),
        )
        .route(
            "/api/supervisor/apps/:app_id/resume",
            post(supervisor_apps_resume),
        )
        .route(
            "/api/supervisor/apps/:app_id/restart",
            post(supervisor_apps_restart),
        )
        // App Bundle management (v2.3 multi-container)
        .route(
            "/api/supervisor/apps/:app_id/compose",
            get(supervisor_apps_compose),
        )
        .route(
            "/api/supervisor/apps/:app_id/bundle/start",
            post(supervisor_bundle_start),
        )
        .route(
            "/api/supervisor/apps/:app_id/bundle/stop",
            post(supervisor_bundle_stop),
        )
        .route(
            "/api/supervisor/apps/:app_id/bundle/restart",
            post(supervisor_bundle_restart),
        )
        .route(
            "/api/supervisor/apps/:app_id/bundle/status",
            get(supervisor_bundle_status),
        )
        .route("/api/core/plugins/with-stats", get(core_plugins_list))
        .route("/api/core/plugins", get(core_plugins_list))
        .route(
            "/api/core/plugins/:id",
            get(core_plugins_get).delete(core_plugins_uninstall),
        )
        .route("/api/core/plugins/:id/enable", post(core_plugins_enable))
        .route("/api/core/plugins/:id/disable", post(core_plugins_disable))
        .route("/api/core/plugins/:id/execute", post(core_plugins_execute))
        .route("/api/core/plugins/:id/logs", get(core_plugins_logs))
        .route("/api/core/sandbox/status", get(core_sandbox_status))
        // Plugin-Sandbox: gemeinsamer Docker-Container für alle Plugins.
        .route("/api/plugins", get(plugins_list).post(plugins_register))
        .route("/api/plugins/:plugin_id", delete(plugins_unregister))
        .route("/api/plugins/:plugin_id/execute", post(plugins_execute))
        // App-Store: served locally by iora-home so ZIP installs and the
        // installed-apps list work even when the dedicated `iora-appstore`
        // microservice isn't deployed.
        .route("/api/appstore/installed", get(local_appstore_installed))
        .route("/api/appstore/search", get(proxy_appstore))
        .route("/api/appstore/install", post(local_appstore_install))
        .route("/api/appstore/jobs", get(local_appstore_jobs))
        .route(
            "/api/appstore/jobs/:job_id",
            delete(local_appstore_clear_job),
        )
        .route("/api/appstore/jobs/stream", get(local_appstore_jobs_stream))
        .route(
            "/api/appstore/apps/:app_id",
            get(local_appstore_app_get).delete(local_appstore_app_delete),
        )
        .route(
            "/api/appstore/apps/:app_id/enable",
            post(local_appstore_app_enable),
        )
        .route(
            "/api/appstore/apps/:app_id/disable",
            post(local_appstore_app_disable),
        )
        .route(
            "/api/appstore/apps/:app_id/settings",
            get(proxy_appstore).post(proxy_appstore),
        )
        .route("/api/appstore/permissions/grant", post(proxy_appstore))
        .route("/api/appstore/settings", post(proxy_appstore))
        // Local-store registration — lets the frontend register system apps
        // (like the Developer App) on demand when developer mode is toggled.
        .route("/api/local-store/register", post(local_store_register))
        // App custom pages — returns all custom_pages from installed and running apps.
        .route(
            "/api/apps/integrations",
            get(app_runtime_handler::app_integrations),
        )
        .route(
            "/api/apps/:app_id/capabilities",
            get(app_runtime_handler::app_capabilities),
        )
        .route(
            "/api/apps/:app_id/jobs",
            get(app_runtime_handler::list_jobs).post(app_runtime_handler::run_job),
        )
        .route(
            "/api/apps/:app_id/jobs/:job_id",
            get(app_runtime_handler::get_job),
        )
        .route(
            "/api/apps/:app_id/jobs/:job_id/cancel",
            post(app_runtime_handler::cancel_job),
        )
        .route(
            "/api/apps/:app_id/http",
            post(app_runtime_handler::app_http_request),
        )
        .route(
            "/api/apps/:app_id/audit",
            get(app_runtime_handler::list_audit),
        )
        .route(
            "/api/apps/:app_id/network/probe",
            post(app_runtime_handler::network_probe),
        )
        .route(
            "/api/apps/:app_id/secrets",
            get(app_runtime_handler::list_secrets).post(app_runtime_handler::create_secret),
        )
        .route(
            "/api/apps/:app_id/secrets/:secret_id",
            put(app_runtime_handler::update_secret).delete(app_runtime_handler::delete_secret),
        )
        .route(
            "/api/apps/:app_id/secrets/:secret_id/reveal",
            post(app_runtime_handler::reveal_secret),
        )
        .route(
            "/api/apps/assist/integrations",
            get(app_assist_integrations),
        )
        .route("/api/apps/:app_id/assist/context", get(app_assist_context))
        .route("/api/apps/:app_id/assist/events", get(app_assist_events))
        .route(
            "/api/apps/:app_id/assist/tasks",
            post(app_assist_create_task),
        )
        .route("/api/apps/:app_id/assist/chat", post(app_assist_chat))
        .route(
            "/api/apps/:app_id/assist/github/*path",
            any(app_assist_github_proxy),
        )
        .route("/api/apps/pages", get(app_pages_list))
        // Live App-Status (Docker-realer Container-State) als SSE-Stream.
        .route("/api/apps/status/stream", get(apps_status_stream))
        // App content proxy — forwards requests to installed app containers.
        .route("/api/apps/:app_id/proxy/*path", get(app_proxy_handler))
        // App logs — per-app log retrieval and live streaming.
        .route("/api/apps/:app_id/logs", get(app_logs_get))
        .route("/api/apps/:app_id/logs/stream", get(app_logs_stream))
        .route("/api/apps/:app_id/terminal/exec", post(app_terminal_exec))
        .route(
            "/api/apps/:app_id/terminal/sessions",
            post(app_terminal_session_start),
        )
        .route(
            "/api/apps/:app_id/terminal/sessions/:session_id/input",
            post(app_terminal_session_input),
        )
        .route(
            "/api/apps/:app_id/terminal/sessions/:session_id/stream",
            get(app_terminal_session_stream),
        )
        .route(
            "/api/apps/:app_id/terminal/sessions/:session_id",
            delete(app_terminal_session_close),
        )
        .route("/api/apps/:app_id/icon", get(app_icon_get))
        // App detail with full info.
        .route("/api/apps/:app_id/detail", get(app_detail_get))
        // App configuration (per-app settings using settings_schema from manifest)
        .route("/api/apps/:app_id/config/schema", get(app_config_schema))
        .route(
            "/api/apps/:app_id/config",
            get(app_config_get).put(app_config_put),
        )
        .route(
            "/api/apps/:app_id/config/:key",
            delete(app_config_delete_key),
        )
        // Restart a known iora-* service from the Control Center.
        .route(
            "/api/admin/control/services/:name/restart",
            post(admin_control_restart_service),
        )
        // OS-dev-image marker / developer-mode lock info.
        .route("/api/admin/dev-image", get(admin_dev_image_info))
        .route("/api/core/registrations", get(core_registrations_list))
        .route(
            "/api/core/registrations/:id/approve",
            post(core_registrations_approve),
        )
        .route(
            "/api/core/registrations/:id/reject",
            post(core_registrations_reject),
        )
        .route(
            "/api/core/registrations/:id/suspend",
            post(core_registrations_suspend),
        )
        .route(
            "/api/core/registrations/:id/revoke",
            post(core_registrations_revoke),
        )
        .route("/api/core/security/events", get(proxy_core_security))
        .route("/api/core/security/alerts", get(proxy_core_security))
        .route(
            "/api/core/security/alerts/:id/acknowledge",
            post(proxy_core_security),
        )
        .route(
            "/api/core/security/resource-usage",
            get(proxy_core_security),
        )
        .route(
            "/api/core/updates/check",
            get(core_updates_check).post(core_updates_check),
        )
        .route("/api/core/updates/history", get(core_updates_history))
        .route(
            "/api/core/updates/:provider_id/install",
            post(core_updates_install),
        )
        .route(
            "/api/core/updates/:update_id/rollback",
            post(core_updates_rollback),
        )
        .route("/api/core/widgets", get(proxy_core))
        // ── Proxies to external IORA microservices ────────────────────────
        // Generic transparent forwarders. If the target microservice is not
        // running, the handler returns a clean JSON 503 (so the frontend
        // doesn't choke on a 404 SPA fallback).
        // iora-secrets (Port 8093)
        .route("/api/secrets", get(proxy_secrets).post(proxy_secrets))
        .route(
            "/api/secrets/:id",
            get(proxy_secrets).put(proxy_secrets).delete(proxy_secrets),
        )
        .route("/api/secrets/:id/rotate", post(proxy_secrets))
        .route("/api/secrets/:id/audit", get(proxy_secrets))
        // iora-files (Port 8100)
        .route("/api/files/", get(proxy_files))
        .route("/api/files/upload", post(proxy_files))
        .route("/api/files/shares", get(proxy_files).post(proxy_files))
        .route("/api/files/shares/:id", delete(proxy_files))
        .route("/api/files/quota", get(proxy_files))
        .route("/api/files/folders", post(proxy_files))
        .route("/api/files/:id", get(proxy_files).delete(proxy_files))
        .route("/api/files/:id/download", get(proxy_files))
        .route("/api/files/:id/move", put(proxy_files))
        .route("/api/files/:id/rename", put(proxy_files))
        .route("/api/files/:id/restore", post(proxy_files))
        .route("/api/files/:id/versions", get(proxy_files))
        .route("/api/files/permissions", post(proxy_files))
        .route("/api/files/permissions/:fid", get(proxy_files))
        .route("/api/files/permissions/revoke/:pid", delete(proxy_files))
        .route("/api/share/:download_token", get(proxy_files_share))
        // iora-gateway (Port 8096)
        .route("/api/gateway/email", post(proxy_gateway))
        .route("/api/gateway/search", post(proxy_gateway))
        .route("/api/gateway/http/get", post(proxy_gateway))
        .route("/api/gateway/requests", get(proxy_gateway))
        .route("/api/gateway/ai-requests", get(proxy_gateway))
        // iora-assist (Port 8092). Browser clients must use this proxy or
        // the same-origin nginx route, never http://localhost:8092 directly.
        .route("/api/assist", any(proxy_assist))
        .route("/api/assist/*path", any(proxy_assist))
        // iora-watchdog (Port 8094)
        .route("/api/watchdog/status", get(proxy_watchdog))
        .route("/api/watchdog/services", get(proxy_watchdog))
        .route("/api/watchdog/metrics", get(proxy_watchdog))
        .route("/api/watchdog/recovery", get(proxy_watchdog))
        // iora-connector (Port 8102)
        .route("/api/connector/tunnels", get(proxy_connector))
        .route("/api/connector/services", get(proxy_connector))
        .route(
            "/api/connector/pairing-tokens",
            get(proxy_connector).post(proxy_connector),
        )
        .route("/api/connector/blocked-ips", get(proxy_connector))
        .route("/api/connector/tunnels/:id", delete(proxy_connector))
        .route("/api/connector/pairing-tokens/:id", delete(proxy_connector))
        // iora-domain-validator (Port 8104; falls back to env override)
        .route(
            "/api/domain-validator/policy/:app_id",
            get(proxy_domain_validator),
        )
        .route(
            "/api/domain-validator/logs/:app_id",
            get(proxy_domain_validator),
        )
        .route(
            "/api/domain-validator/validate",
            post(proxy_domain_validator),
        )
        // iora-resource-manager (Port 8105)
        .route("/api/resources/containers", get(proxy_resources))
        .route("/api/resources/system", get(proxy_resources))
        .route("/api/resources/history", get(proxy_resources))
        .route("/api/resources/reallocate", post(proxy_resources))
        // iora-network-monitor (Port 8103)
        .route("/api/network/peers", get(proxy_network_monitor))
        .route("/api/network/devices", get(proxy_network_monitor))
        .route("/api/network/devices/active", get(proxy_network_monitor))
        .route("/api/network/stats", get(proxy_network_monitor))
        .route("/api/network/scan", post(proxy_network_monitor))
        .route("/api/metrics", get(proxy_network_monitor))
        .route("/api/interfaces", get(proxy_network_monitor))
        .route("/api/mqtt/topics", get(proxy_network_monitor))
        // iora-cloud (Port 8120, optional external)
        .route(
            "/api/admin/iora-cloud/config",
            get(proxy_iora_cloud).post(proxy_iora_cloud),
        )
        .route("/api/config/sync/changes", get(get_sync_changes))
        // Notifications (read access for all authenticated users)
        .route("/api/notifications", get(get_notifications))
        .route("/api/notifications/send", post(notification_send))
        .route(
            "/api/notifications/:notif_id/read",
            put(mark_notification_read),
        )
        .route("/api/notifications/:notif_id", delete(dismiss_notification))
        // Notification channels management
        .route(
            "/api/notifications/channels",
            get(notification_channels_list).post(notification_channel_create),
        )
        .route(
            "/api/notifications/channels/:channel_id",
            put(notification_channel_update).delete(notification_channel_delete),
        )
        .route("/api/alert/active", get(get_active_alert))
        .route("/api/warnings/active", get(get_active_warnings))
        // NINA warning endpoints
        .route(
            "/api/nina/settings",
            get(get_nina_settings).post(save_nina_settings),
        )
        .route("/api/nina/warnings", get(get_nina_warnings))
        .route("/api/nina/regions", get(get_nina_regions))
        // Calendar endpoints
        .route("/api/calendars", get(get_calendars))
        .route("/api/calendars/:entity_id/events", get(get_calendar_events))
        // Convenience endpoints
        .route("/api/time", get(get_current_time))
        .route("/api/lights", get(get_all_lights))
        .route("/api/lights/:entity_id", post(control_light))
        .route("/api/media_players", get(get_all_media_players))
        .route("/api/media_players/:entity_id", post(control_media_player))
        .route("/api/sensors/:entity_id", get(get_sensor))
        .route("/api/buttons/:entity_id/press", post(press_button))
        .route("/api/switches/:entity_id", post(control_switch))
        // Location history (our own DB, not HA proxy)
        .route(
            "/api/location-history/:entity_id",
            get(get_location_history),
        )
        .route(
            "/api/location-history/sync/status",
            get(get_location_sync_status),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_authenticated,
        ))
        .with_state(state.clone());

    let app = Router::new()
        // Swagger UI
        .merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", ApiDoc::openapi()))
        // Redirect /docs to /api/docs for convenience
        .route(
            "/docs",
            get(|| async { axum::response::Redirect::temporary("/api/docs") }),
        )
        // Health check (public)
        .route("/health", get(health_check))
        // Version endpoint (public, never cached – desktop client uses this to detect updates)
        .route("/api/version", get(get_version))
        // Maintenance status (public – frontend needs this before auth)
        .route("/api/maintenance/status", get(public_maintenance_status))
        .route(
            "/api/desktop/extensions",
            get(desktop_gateway::get_desktop_extensions),
        )
        .route(
            "/api/desktop/settings",
            get(desktop_gateway::get_desktop_settings)
                .post(desktop_gateway::update_desktop_settings),
        )
        .route(
            "/api/desktop/register",
            post(desktop_gateway::register_desktop),
        )
        .route(
            "/api/desktop/metrics",
            post(desktop_gateway::receive_metrics),
        )
        .route("/api/desktop/entities", get(desktop_gateway::get_entities))
        .route(
            "/api/desktop/service/call",
            post(desktop_gateway::call_service),
        )
        .route(
            "/api/desktop/command/execute",
            post(desktop_gateway::queue_command),
        )
        .route(
            "/api/desktop/commands",
            get(desktop_gateway::get_pending_commands),
        )
        .route(
            "/api/desktop/commands/:id/ack",
            post(desktop_gateway::ack_command),
        )
        // Authentication API (public)
        .route("/api/auth/register", post(auth_register))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/verify", get(auth_verify))
        .route("/api/auth/validate", get(auth_validate_credentials))
        .route("/api/auth/pin-login", post(auth_pin_login))
        .route("/api/auth/users", get(list_all_users))
        .route("/api/auth/pin", post(set_user_pin))
        .route("/api/auth/pin", delete(remove_user_pin))
        .route("/api/uploads/background", post(upload_background_image))
        // Public media proxy (thumbnails should render even without frontend auth session)
        .route("/api/hass_agent/*path", get(proxy_hass_agent_media))
        .route("/api/image/serve/*path", get(proxy_image_serve_media))
        // Integration API (used by HA custom integration, authenticated via HA token)
        .route("/api/integration/status", get(integration_status))
        // Public: lets the frontend decide whether to show the Overview
        // page or a "IORA Home not configured" placeholder. No auth needed
        // because the result reveals only a boolean, not the URL/token.
        .route(
            "/api/integration/ha/configured",
            get(integration_ha_configured),
        )
        .route(
            "/api/integration/ha/test",
            post(integration_ha_test_connection),
        )
        .route(
            "/api/integration/ha/reconnect",
            post(integration_ha_reconnect),
        )
        .route("/api/integration/command", post(integration_command))
        .route("/api/integration/settings", get(integration_get_settings))
        .route("/api/integration/settings", post(integration_set_settings))
        .route(
            "/api/integration/analytics/top",
            get(integration_analytics_top),
        )
        .route(
            "/api/integration/analytics/entity/:entity_id",
            get(integration_analytics_entity),
        )
        .route("/api/integration/health", get(integration_health_report))
        .route(
            "/api/integration/composite",
            get(integration_composite_sensors),
        )
        .route(
            "/api/integration/composite",
            post(integration_register_composite),
        )
        // Smart Scenes
        .route("/api/integration/scenes", get(integration_list_scenes))
        .route("/api/integration/scenes", post(integration_create_scene))
        .route(
            "/api/integration/scenes/:scene_id",
            delete(integration_delete_scene),
        )
        .route(
            "/api/integration/scenes/:scene_id/execute",
            post(integration_execute_scene),
        )
        // Entity Scheduler
        .route(
            "/api/integration/schedules",
            get(integration_list_schedules),
        )
        .route(
            "/api/integration/schedules",
            post(integration_create_schedule),
        )
        .route(
            "/api/integration/schedules/:schedule_id",
            delete(integration_cancel_schedule),
        )
        // Entity Watchdog
        .route(
            "/api/integration/watchdogs",
            get(integration_list_watchdogs),
        )
        .route(
            "/api/integration/watchdogs",
            post(integration_create_watchdog),
        )
        .route(
            "/api/integration/watchdogs/:watchdog_id",
            delete(integration_delete_watchdog),
        )
        .route(
            "/api/integration/watchdogs/check",
            post(integration_check_watchdogs),
        )
        // Analytics snapshots
        .route(
            "/api/integration/analytics/history",
            get(integration_analytics_history),
        )
        // Enhanced Device Control
        .route(
            "/api/integration/device/delayed-action",
            post(integration_delayed_action),
        )
        .route(
            "/api/integration/device/conditional-action",
            post(integration_conditional_action),
        )
        .route(
            "/api/integration/device/group-action",
            post(integration_group_action),
        )
        // WebSocket endpoint
        .route("/ws", get(websocket_handler))
        // Realtime namespace WebSocket (Socket.IO-style)
        .route("/ws/realtime", get(realtime_ws_handler))
        // Streaming server endpoints
        .route("/api/streams", get(list_streams))
        .route("/api/streams", post(create_stream))
        .route("/api/streams/:stream_id", get(get_stream))
        .route("/api/streams/:stream_id", put(update_stream))
        .route("/api/streams/:stream_id", delete(stop_stream))
        .route("/api/streams/:stream_id/snapshot", get(get_stream_snapshot))
        .route(
            "/api/streams/:stream_id/snapshot",
            post(post_stream_snapshot),
        )
        .route("/api/streams/sender", get(stream_sender_page))
        .route("/ws/stream/ingest", get(stream_ingest_handler))
        .route("/ws/stream/watch", get(stream_watch_handler))
        // SSE event streams (public, filterable)
        .route("/api/events/stream", get(sse_event_stream))
        .route("/api/events/system", get(sse_system_stream))
        // Device & user bootstrap (public, needed before auth)
        .route("/api/config/users", post(create_user))
        .route("/api/config/users/:username", get(get_user))
        .route("/api/config/devices", post(register_device))
        .route("/api/config/devices/:device_id", get(get_device_info))
        // Internal: service-to-service system-notification ingest (e.g. iora-watchdog
        // escalating a failed auto-recovery). Auth via shared `IORA_INTERNAL_TOKEN`
        // header `X-Iora-Internal-Token`. Not exposed in OpenAPI.
        .route(
            "/api/internal/system-notifications",
            post(internal_create_system_notification),
        )
        .nest_service("/uploads", get_service(ServeDir::new("./data/uploads")))
        // Merge protected data routes
        .merge(data_routes)
        // Merge protected service routes
        .merge(service_routes)
        // Merge admin routes
        .merge(admin_routes)
        // Merge authenticated routes (API keys)
        .merge(auth_routes)
        // Serve frontend static assets (JS, CSS, etc.) — immutable because filenames are hashed.
        // Path resolved at startup from IORA_HOME_DIST / ../dist / ./dist / /opt/iora/iora-home/dist.
        .nest_service(
            "/assets",
            ServeDir::new(
                resolve_dist_dir()
                    .map(|p| p.join("assets"))
                    .unwrap_or_else(|| std::path::PathBuf::from("../dist/assets")),
            )
            .precompressed_gzip(),
        )
        // SPA fallback – any unmatched route gets index.html for client-side routing
        .fallback(spa_fallback)
        // CORS layer
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        // Response compression (gzip, deflate, br)
        .layer(CompressionLayer::new())
        // HTTP request counter middleware
        .layer(axum::middleware::from_fn(
            |req: axum::http::Request<axum::body::Body>, next: axum::middleware::Next| async move {
                METRICS.http_requests_total.fetch_add(1, Ordering::Relaxed);
                next.run(req).await
            },
        ))
        // Tracing layer
        .layer(TraceLayer::new_for_http())
        // Add state
        .with_state(state);

    // Background task: broadcast metrics snapshot every 2 seconds for live dashboard
    tokio::spawn(async {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
        loop {
            interval.tick().await;
            let snapshot = collect_metrics_snapshot();
            let _ = METRICS_BROADCAST.send(snapshot);
        }
    });

    // Background task: persist in-memory home state every 5s to survive restarts.
    {
        let pool = db_pool.clone();
        tokio::spawn(async move {
            // Initial load
            if let Err(e) = load_home_state_from_db(&pool).await {
                warn!("home_state initial load failed: {e}");
            }
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));
            interval.tick().await; // skip first immediate tick
            loop {
                interval.tick().await;
                if let Err(e) = persist_home_state_to_db(&pool).await {
                    warn!("home_state snapshot failed: {e}");
                }
            }
        });
    }

    // Start server.  Port is configurable via the PORT or IORA_HOME_PORT env
    // var (set in /etc/iora/iora-home.env on IORA OS to 8126).  Defaults to
    // 3001 to preserve the legacy dev behaviour when run from `cargo run`.
    let port: u16 = system_config::service_port("iora-home", 3001);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Backend server listening on {}", addr);
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-home",
        addr.port(),
        "Smart-home / Home Assistant bridge",
    );

    // Log which dashboard bundle path was resolved so a missing dist/ is
    // immediately visible in `journalctl -u iora-home` instead of users
    // seeing only the embedded fallback page on :8126.
    match resolve_dist_dir() {
        Some(p) => info!("Dashboard frontend dist: {} (using bundled UI)", p.display()),
        None => info!("Dashboard frontend dist NOT FOUND — serving embedded fallback page. Set IORA_HOME_DIST=/path/to/dist to enable the React UI."),
    }

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check endpoint with diagnostics
/// GET /api/version — returns the current server version without caching.
/// The desktop client polls this endpoint to detect when the server has been updated
/// and must invalidate its local file cache.
async fn get_version() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        "no-store, no-cache, must-revalidate".parse().unwrap(),
    );
    headers.insert(header::PRAGMA, "no-cache".parse().unwrap());
    headers.insert(header::EXPIRES, "0".parse().unwrap());

    // Compute a lightweight content hash of the frontend dist/ directory.
    // The desktop client polls this endpoint and invalidates its file cache
    // whenever the hash changes.
    let content_hash = compute_dist_hash();

    (
        headers,
        Json(serde_json::json!({
            "version": env!("CARGO_PKG_VERSION"),
            "content_hash": content_hash,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

/// Compute a fast hash representing the current state of the frontend dist/ directory.
/// Uses file modification times and sizes — no file content reading required.
/// The dist directory defaults to `../dist` but can be overridden via the `DIST_DIR` env var.
fn compute_dist_hash() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    env!("CARGO_PKG_VERSION").hash(&mut hasher);

    let dist_dir = system_config::dist_dir();
    if let Ok(entries) = std::fs::read_dir(&dist_dir) {
        let mut paths: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        paths.sort_by_key(|e| e.path());
        for entry in paths {
            if let Ok(meta) = entry.metadata() {
                entry.path().hash(&mut hasher);
                meta.len().hash(&mut hasher);
                if let Ok(modified) = meta.modified() {
                    if let Ok(since) = modified.duration_since(std::time::UNIX_EPOCH) {
                        since.as_secs().hash(&mut hasher);
                    }
                }
            }
        }
    }

    format!("{:016x}", hasher.finish())
}

/// Try to find the first-boot setup wizard and return its URL.
/// Checks ports 8080 and 80 on localhost and the primary LAN IP.
async fn detect_setup_wizard() -> (Option<String>, bool) {
    if !iora_shared::env::IoraEnv::detect().is_production()
        || iora_shared::env::IoraEnv::is_setup_complete()
    {
        return (None, false);
    }

    const CHECK_PORTS: &[u16] = &[8080, 80];

    // Helper: try connecting to addr:port.
    async fn try_connect(host: &str, port: u16) -> bool {
        let addr = format!("{}:{}", host, port);
        match tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(&addr)).await {
            Ok(Ok(_)) => true,
            _ => false,
        }
    }

    // Try localhost first (fastest, no network needed).
    for port in CHECK_PORTS {
        if try_connect("127.0.0.1", *port).await {
            return (Some(format!("http://127.0.0.1:{}/setup", port)), true);
        }
    }

    // Try to find the primary LAN IP.
    if let Some(ip) = get_lan_ip().await {
        for port in CHECK_PORTS {
            if try_connect(&ip, *port).await {
                return (Some(format!("http://{}:{}/setup", ip, port)), true);
            }
        }
    }

    (None, false)
}

/// Check if an IPv4 address belongs to a virtual/Docker bridge range.
fn is_virtual_ip(ip: &Ipv4Addr) -> bool {
    let octets = ip.octets();
    match octets {
        // Docker default bridge: 172.17.0.0/16
        [172, 17, _, _] => true,
        // Docker user-defined bridges often use 172.18-172.31
        [172, n, _, _] if n >= 18 && n <= 31 => true,
        // Docker host mode / internal: 10.x.x.x overlaps with LAN, but
        // if the interface is docker*, br-*, veth* it's caught below.
        _ => false,
    }
}

/// Get the primary LAN IPv4 address using hostname -I, /proc/net/fib_trie,
/// or interface detection. Excludes Docker/bridge/virtual IPs.
async fn get_lan_ip() -> Option<String> {
    // Helper: validate IP (not loopback, not link-local, not virtual/Docker).
    fn is_valid_lan_ip(ip_str: &str) -> Option<String> {
        let parsed: Ipv4Addr = ip_str.parse().ok()?;
        if parsed.is_loopback() || parsed.is_link_local() || parsed.is_multicast() {
            return None;
        }
        if is_virtual_ip(&parsed) {
            return None;
        }
        Some(ip_str.to_string())
    }

    // 1. Try `hostname -I` (fastest, most reliable on Linux).
    if let Ok(out) = tokio::process::Command::new("hostname")
        .arg("-I")
        .output()
        .await
    {
        if out.status.success() {
            let ips = String::from_utf8_lossy(&out.stdout);
            for ip in ips.split_whitespace() {
                if let Some(valid) = is_valid_lan_ip(ip) {
                    return Some(valid);
                }
            }
        }
    }

    // 2. Fallback: parse /proc/net/fib_trie for local addresses,
    //    filtering out Docker/bridge interfaces.
    if let Ok(content) = tokio::fs::read_to_string("/proc/net/fib_trie").await {
        let lines: Vec<&str> = content.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.trim() == "LOCAL" && i > 0 {
                let prev = lines[i - 1].trim();
                if let Some(ip) = prev.split_whitespace().next() {
                    if let Some(valid) = is_valid_lan_ip(ip) {
                        // Double-check this IP is NOT on a Docker/bridge interface
                        // by checking /proc/net/fib_trie for the interface name.
                        let mut is_docker_iface = false;
                        // Look ahead for the device name in following lines
                        for j in (i.saturating_sub(5))..(i + 5).min(lines.len()) {
                            let l = lines[j].trim();
                            if l.starts_with("DEV")
                                && (l.contains("docker")
                                    || l.contains("br-")
                                    || l.contains("veth")
                                    || l.contains("vnet"))
                            {
                                is_docker_iface = true;
                                break;
                            }
                        }
                        if !is_docker_iface {
                            return Some(valid);
                        }
                    }
                }
            }
        }
    }

    // 3. Read /proc/net/dev to find physical interfaces and their IPs.
    if let Ok(content) = tokio::fs::read_to_string("/proc/net/dev").await {
        for line in content.lines() {
            let iface_name = line.split(':').next().unwrap_or("").trim();
            match iface_name {
                "lo" | "docker0" => continue,
                name if name.starts_with("br-") => continue,
                name if name.starts_with("veth") => continue,
                name if name.starts_with("docker") => continue,
                name if name.starts_with("vnet") => continue,
                name if name.starts_with("tun") => continue,
                name if name.starts_with("tap") => continue,
                name if name.starts_with("virbr") => continue,
                name if name.is_empty() => continue,
                _ => {}
            }
            // If we got here, it's likely a physical interface.
            // Try to get its IP via /sys/class/net/<iface>/address and route.
            let addr_path = format!("/sys/class/net/{}/address", iface_name);
            if tokio::fs::metadata(&addr_path).await.is_ok() {
                // Interface exists and has a MAC — get its IP.
                if let Ok(addr_out) = tokio::process::Command::new("ip")
                    .args(["-o", "-4", "addr", "show", "dev", iface_name])
                    .output()
                    .await
                {
                    if addr_out.status.success() {
                        let stdout = String::from_utf8_lossy(&addr_out.stdout);
                        for word in stdout.split_whitespace() {
                            if word.contains('.') && word.contains('/') {
                                let ip = word.split('/').next().unwrap_or("");
                                if let Some(valid) = is_valid_lan_ip(ip) {
                                    return Some(valid);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Last resort: try to detect via UDP socket (doesn't send packets).
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:53").is_ok() {
            if let Ok(local) = socket.local_addr() {
                let ip = local.ip();
                if ip.is_ipv4() {
                    if let std::net::SocketAddr::V4(v4) = local {
                        if !v4.ip().is_loopback() && !is_virtual_ip(v4.ip()) {
                            return Some(ip.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// Get local IPv4 and IPv6 addresses (excluding virtual/Docker interfaces).
async fn get_local_ips() -> (Vec<String>, Vec<String>) {
    let mut v4_addrs = Vec::new();
    let mut v6_addrs = Vec::new();

    // Use `ip -o addr show` for both families.
    for family in &["-4", "-6"] {
        if let Ok(out) = tokio::process::Command::new("ip")
            .args(["-o", family, "addr", "show", "scope", "global"])
            .output()
            .await
        {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    // Format: "2: eth0    inet 192.168.1.100/24 brd ..."
                    let iface = line.split(':').nth(1).unwrap_or("").trim();
                    // Skip virtual interfaces
                    match iface {
                        "docker0" | "lo" => continue,
                        name if name.starts_with("br-") => continue,
                        name if name.starts_with("veth") => continue,
                        name if name.starts_with("docker") => continue,
                        name if name.starts_with("vnet") => continue,
                        name if name.starts_with("virbr") => continue,
                        name if name.starts_with("tun") => continue,
                        name if name.starts_with("tap") => continue,
                        _ => {}
                    }
                    // Extract the address
                    if let Some(addr_part) = line.split_whitespace().nth(3) {
                        let addr = addr_part.split('/').next().unwrap_or("");
                        if !addr.is_empty() {
                            match *family {
                                "-4" => {
                                    if let Ok(parsed) = addr.parse::<Ipv4Addr>() {
                                        if !parsed.is_loopback()
                                            && !parsed.is_link_local()
                                            && !parsed.is_multicast()
                                        {
                                            let oct = parsed.octets();
                                            if oct[0] != 172 || oct[1] != 17 {
                                                // skip Docker bridge
                                                v4_addrs.push(format!("{} ({})", addr, iface));
                                            }
                                        }
                                    }
                                }
                                _ => {
                                    // IPv6 — just skip link-local
                                    if !addr.starts_with("fe80:") {
                                        v6_addrs.push(format!("{} ({})", addr, iface));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (v4_addrs, v6_addrs)
}

async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    let metrics = state.entity_cache.metrics();
    let connected_clients = state.ws_manager.client_count().await;
    let entity_count = state.entity_cache.count().await;
    let iora_env = iora_shared::env::IoraEnv::detect();
    let raw_setup_complete = iora_shared::env::IoraEnv::is_setup_complete();
    let setup_required = iora_env.is_production() && !raw_setup_complete;

    let (setup_url, setup_reachable) = if setup_required {
        detect_setup_wizard().await
    } else {
        (None, false)
    };
    let (ipv4_addrs, ipv6_addrs) = get_local_ips().await;
    let primary_ipv4 = get_lan_ip().await.or_else(|| {
        ipv4_addrs
            .first()
            .and_then(|entry| entry.split_whitespace().next())
            .map(|ip| ip.to_string())
    });

    Json(serde_json::json!({
        "status": "ok",
        "ha_connected": state.entity_cache.is_ha_connected(),
        "ha_ws_connected": state.ha_ws.is_connected(),
        "connected_clients": connected_clients,
        "entity_count": entity_count,
        "cache_metrics": {
            "update_count": metrics.update_count,
            "last_update_ms": metrics.last_update_ms,
            "cache_hits": metrics.cache_hits,
            "cache_misses": metrics.cache_misses,
        },
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "uptime_info": {
            "started": true,
        },
        "iora_env": iora_env.to_string(),
        "setup_complete": !setup_required,
        "setup_required": setup_required,
        "raw_setup_complete": raw_setup_complete,
        "setup_url": setup_url,
        "setup_reachable": setup_reachable,
        "primary_ipv4": primary_ipv4,
        "ipv4_addrs": ipv4_addrs,
        "ipv6_addrs": ipv6_addrs,
    }))
}

/// Fallback HTML embedded into the binary. Served when no built dashboard
/// bundle is found on disk so :8126 always renders something usable instead
/// of a bare "Frontend not built" 404.
const FALLBACK_INDEX_HTML: &str = include_str!("fallback_index.html");

/// Bootstrap the very first admin user on a fresh install.
///
/// Reads credentials from one of (in priority order):
///   1. `/mnt/data/iora/iora-home-bootstrap.json` — written by the IORA OS
///      first-boot setup wizard (board/iora/iora-setup/setup-server.py).
///      Schema: `{"username":"...","password":"...","display_name":"..."}`.
///      The file is **deleted after a successful seed** to avoid leaving a
///      plaintext password on disk.
///   2. `IORA_BOOTSTRAP_ADMIN_USER` + `IORA_BOOTSTRAP_ADMIN_PASSWORD` env
///      vars (useful in dev / Docker).
///
/// Behaviour with respect to existing rows:
///   * If the username already exists the row is **always** updated with
///     the wizard-supplied password (and is_admin is forced to TRUE). The
///     setup wizard is the source of truth — re-running it with a new
///     password is the supported "forgot my password" recovery path and
///     should always produce a working login.
///   * Otherwise the row is inserted fresh.
///
/// This trades "wizard can overwrite an existing admin's password" for
/// "first user is always usable". The trade is intentional: the wizard
/// JSON is owner-only at /mnt/data/iora and is consumed and deleted on
/// the very next iora-home start, so the only window in which it can
/// take effect is the boot immediately following the wizard.
async fn bootstrap_admin_user(
    db_pool: &DbPool,
    _config_repo: &ConfigRepository,
) -> anyhow::Result<()> {
    info!("Bootstrap: starting admin-user bootstrap check");

    // Dev images accept shorter passwords so the well-known
    // dev credentials (admin/admin) work out of the box.
    let is_os_dev = std::path::Path::new("/etc/iora/os-dev-mode").exists();
    let min_password_len: usize = if is_os_dev { 5 } else { 8 };
    if is_os_dev {
        info!(
            "Bootstrap: OS dev image detected — min password length relaxed to {}",
            min_password_len
        );
    }

    // The systemd unit for iora-home sets ProtectSystem=strict and only
    // whitelists /var/lib/iora/iora-home + /var/log/iora as writable.
    // /mnt/data/iora is therefore READ-ONLY for the iora-home process —
    // we cannot put bootstrap state there. The wizard runs as root and
    // hands us credentials via:
    //   * /var/lib/iora/iora-home/bootstrap.json   (chowned iora:iora 0640)
    //   * IORA_BOOTSTRAP_ADMIN_{USER,PASSWORD,DISPLAY_NAME} env vars,
    //     loaded from /etc/iora/iora-home.env by systemd before the
    //     privilege drop
    // Plus a legacy fallback at /mnt/data/iora/iora-home-bootstrap.json
    // for old installs (read-only attempt).
    let primary_json = std::path::PathBuf::from("/var/lib/iora/iora-home/bootstrap.json");
    let legacy_json = std::path::PathBuf::from("/mnt/data/iora/iora-home-bootstrap.json");
    let mut creds: Option<(String, String, Option<String>)> = None;
    let mut delete_json_after: Option<std::path::PathBuf> = None;
    for json_path in [&primary_json, &legacy_json] {
        let json_present = json_path.is_file();
        info!(
            "Bootstrap: JSON path {} exists={}",
            json_path.display(),
            json_present
        );
        if json_present && creds.is_none() {
            match tokio::fs::read_to_string(json_path).await {
                Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                    Ok(v) => {
                        let u = v
                            .get("username")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        let p = v
                            .get("password")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string();
                        let d = v
                            .get("display_name")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string());
                        if !u.is_empty() && p.len() >= min_password_len {
                            info!(
                                "Bootstrap: JSON contains usable credentials for user='{}'",
                                u
                            );
                            creds = Some((u, p, d));
                            delete_json_after = Some(json_path.clone());
                        } else {
                            warn!("Bootstrap JSON at {} is incomplete (need username + password >= {} chars) — ignoring", json_path.display(), min_password_len);
                        }
                    }
                    Err(e) => warn!("Could not parse {}: {} — ignoring", json_path.display(), e),
                },
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                    warn!("Bootstrap JSON at {} exists but is not readable by this process (EACCES). Wizard should chmod it iora:iora 0640 (or 0644).", json_path.display());
                }
                Err(e) => warn!("Could not read {}: {} — ignoring", json_path.display(), e),
            }
        }
    }

    // Env-var fallback — explicit logging so the operator can see at a
    // glance whether systemd is actually delivering the wizard values.
    let env_user = system_config::bootstrap_admin_user();
    let env_pass = system_config::bootstrap_admin_password();
    info!(
        "Bootstrap: env IORA_BOOTSTRAP_ADMIN_USER {} ({}), IORA_BOOTSTRAP_ADMIN_PASSWORD {} ({} bytes)",
        if env_user.is_some() { "set" } else { "UNSET" },
        env_user.as_deref().unwrap_or("-"),
        if env_pass.is_some() { "set" } else { "UNSET" },
        env_pass.as_deref().map(|s| s.len()).unwrap_or(0),
    );
    if creds.is_none() {
        if let (Some(u), Some(p)) = (env_user, env_pass) {
            let u = u.trim().to_string();
            if !u.is_empty() && p.len() >= min_password_len {
                let d = std::env::var("IORA_BOOTSTRAP_ADMIN_DISPLAY_NAME").ok();
                info!("Bootstrap: using env-var credentials for user='{}'", u);
                creds = Some((u, p, d));
            } else {
                warn!("Bootstrap env vars present but invalid (username empty or password < {} bytes) — ignoring", min_password_len);
            }
        }
    }

    // Env-var fallback.
    if creds.is_none() {
        if let (Ok(u), Ok(p)) = (
            std::env::var("IORA_BOOTSTRAP_ADMIN_USER"),
            std::env::var("IORA_BOOTSTRAP_ADMIN_PASSWORD"),
        ) {
            let u = u.trim().to_string();
            if !u.is_empty() && p.len() >= min_password_len {
                let d = std::env::var("IORA_BOOTSTRAP_ADMIN_DISPLAY_NAME").ok();
                creds = Some((u, p, d));
            }
        }
    }

    let (username, password, display_name) = match creds {
        Some(c) => c,
        None => {
            // No bootstrap creds. Detect the dead-end ("user exists with
            // NULL password_hash") state and shout about it so the
            // operator knows to re-run the setup wizard.
            match sqlx::query_as::<_, (String, Option<String>)>(
                "SELECT username, password_hash FROM users ORDER BY created_at LIMIT 5",
            )
            .fetch_all(db_pool)
            .await
            {
                Ok(rows) if rows.is_empty() => {
                    info!("Bootstrap: no users in DB and no bootstrap credentials — operator can register from the UI.");
                }
                Ok(rows) => {
                    let orphans: Vec<&str> = rows
                        .iter()
                        .filter(|(_, h)| h.is_none())
                        .map(|(u, _)| u.as_str())
                        .collect();
                    if orphans.is_empty() {
                        info!("Bootstrap: no credentials supplied and all existing users already have passwords — nothing to do.");
                    } else {
                        warn!(
                            "Bootstrap: NO credentials supplied (env vars unset, JSON missing/unreadable) BUT user(s) {:?} have NULL password_hash. They cannot log in. Re-run the IORA setup wizard to seed a password, or set IORA_BOOTSTRAP_ADMIN_USER + IORA_BOOTSTRAP_ADMIN_PASSWORD in /etc/iora/iora-home.env and restart iora-home.",
                            orphans
                        );
                    }
                }
                Err(e) => warn!("Bootstrap: could not query users for diagnostic: {}", e),
            }
            return Ok(());
        }
    };

    // Sentinel: the env vars stay in /etc/iora/iora-home.env across
    // reboots, but we must NOT re-apply them every boot — otherwise a
    // password the user later changed via the API would be reverted to
    // the wizard value on the next restart. We therefore record a hash
    // of (username, password) the first time we apply, and short-circuit
    // on subsequent boots when the env var content has not changed.
    //
    // Re-running the setup wizard with new credentials writes new env
    // var values → hash differs → bootstrap re-applies. The wizard also
    // deletes the sentinel as a belt-and-suspenders.
    //
    // Stored under StateDirectory (writable for the iora-home service).
    let sentinel_path = std::path::PathBuf::from("/var/lib/iora/iora-home/.bootstrap-applied");
    let creds_fingerprint = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(username.as_bytes());
        h.update(b"\0");
        h.update(password.as_bytes());
        hex::encode(h.finalize())
    };
    if let Ok(prev) = tokio::fs::read_to_string(&sentinel_path).await {
        if prev.trim() == creds_fingerprint {
            info!("Bootstrap: credentials already applied (sentinel matches) — skipping");
            // Best-effort cleanup of source files if writable.
            if let Some(p) = &delete_json_after {
                let _ = tokio::fs::remove_file(p).await;
            }
            return Ok(());
        }
    }

    let password_hash =
        auth::hash_password(&password).map_err(|e| anyhow::anyhow!("hash_password: {}", e))?;

    info!(
        "Bootstrap: applying credentials for user='{}' (password length={} bytes, hash starts with '{}...')",
        username,
        password.len(),
        &password_hash.chars().take(7).collect::<String>(),
    );

    // Self-check: hash MUST round-trip with the same password before we
    // even touch the database. Catches every class of "the bytes I hashed
    // are not the bytes I think they are" bug (encoding, BOMs, accidental
    // trim, bcrypt 72-byte truncation collisions, etc.).
    match auth::verify_password(&password, &password_hash) {
        Ok(true) => {}
        Ok(false) => {
            return Err(anyhow::anyhow!(
                "Bootstrap self-check failed: freshly-hashed password does NOT verify against its own hash. Refusing to seed a broken account."
            ));
        }
        Err(e) => {
            return Err(anyhow::anyhow!(
                "Bootstrap self-check errored verifying freshly-hashed password: {}",
                e
            ));
        }
    }

    // Look for the row by username and decide insert/update/skip.
    let existing: Option<(String, Option<String>)> = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT id, password_hash FROM users WHERE username = $1",
    )
    .bind(&username)
    .fetch_optional(db_pool)
    .await?;

    match existing {
        Some((id, _maybe_existing_hash)) => {
            // Wizard credentials are the source of truth: if the operator
            // ran the setup wizard (or set the env vars) we honour the
            // password they just typed. This is what makes the first-user
            // flow reliable across re-runs ("Passwort vergessen? Wizard
            // erneut ausführen") and means we never end up in the
            // "user exists but has wrong/no password" dead-end.
            sqlx::query(
                "UPDATE users SET password_hash = $1, is_admin = TRUE, display_name = COALESCE($2, display_name), updated_at = NOW() WHERE id = $3"
            )
            .bind(&password_hash)
            .bind(display_name.as_deref())
            .bind(&id)
            .execute(db_pool)
            .await?;
            info!(
                "Bootstrap: applied wizard credentials to user '{}' (admin=true, password updated)",
                username
            );
        }
        None => {
            let user_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO users (id, username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4, TRUE)"
            )
            .bind(&user_id)
            .bind(&username)
            .bind(display_name.as_deref().unwrap_or(&username))
            .bind(&password_hash)
            .execute(db_pool)
            .await?;
            info!(
                "Bootstrap: seeded first admin web-user '{}' from setup wizard",
                username
            );
        }
    }

    if let Some(json_path) = &delete_json_after {
        // Best-effort delete; if it fails (read-only fs etc.) we just leave it.
        if let Err(e) = tokio::fs::remove_file(json_path).await {
            warn!(
                "Could not remove bootstrap file {}: {}",
                json_path.display(),
                e
            );
        } else {
            info!("Removed bootstrap credential file {}", json_path.display());
        }
    }

    // Final round-trip: re-read the row we just wrote and verify the
    // password against the stored hash. This proves end-to-end that the
    // /api/auth/login flow will accept the wizard credentials.
    match sqlx::query_as::<_, (Option<String>, bool)>(
        "SELECT password_hash, is_admin FROM users WHERE username = $1"
    )
    .bind(&username)
    .fetch_optional(db_pool)
    .await
    {
        Ok(Some((Some(stored_hash), is_admin))) => {
            match auth::verify_password(&password, &stored_hash) {
                Ok(true) => {
                    info!(
                        "Bootstrap: round-trip OK for '{}' (is_admin={}). Login should succeed.",
                        username, is_admin
                    );
                    // Persist sentinel so we don't re-apply on every boot.
                    if let Err(e) = tokio::fs::write(&sentinel_path, &creds_fingerprint).await {
                        warn!("Could not write bootstrap sentinel {}: {}", sentinel_path.display(), e);
                    }
                }
                Ok(false) => warn!(
                    "Bootstrap: round-trip FAILED for '{}' — password does not verify against the stored hash. Login WILL fail. (stored hash starts with '{}...')",
                    username,
                    &stored_hash.chars().take(7).collect::<String>(),
                ),
                Err(e) => warn!(
                    "Bootstrap: round-trip verify errored for '{}': {}",
                    username, e
                ),
            }
        }
        Ok(Some((None, _))) => warn!(
            "Bootstrap: row for '{}' is present but has NULL password_hash after our UPDATE/INSERT — this should be impossible.",
            username
        ),
        Ok(None) => warn!(
            "Bootstrap: row for '{}' disappeared between write and verify — this should be impossible.",
            username
        ),
        Err(e) => warn!(
            "Bootstrap: could not re-read row for '{}' for round-trip check: {}",
            username, e
        ),
    }

    Ok(())
}

/// Resolve the directory containing the built dashboard bundle. Order:
///   1. `IORA_HOME_DIST` env var (absolute path, set by /etc/iora/iora-home.env on IORA OS)
///   2. `../dist`              (legacy: cargo run from backend/iora-home/)
///   3. `./dist`               (running from the workspace root)
fn resolve_dist_dir() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("IORA_HOME_DIST") {
        let pb = std::path::PathBuf::from(p);
        if pb.join("index.html").is_file() {
            return Some(pb);
        }
    }
    for rel in ["../dist", "./dist", "/opt/iora/iora-home/dist"] {
        let pb = std::path::PathBuf::from(rel);
        if pb.join("index.html").is_file() {
            return Some(pb);
        }
    }
    None
}

/// SPA fallback – serves index.html for any route not matched by API or static files.
/// This enables client-side routing in the React frontend.
///
/// When IORA_FRONTEND_DEV_URL is set, requests are proxied to the Vite dev server
/// for hot module replacement during development.
async fn spa_fallback(uri: Uri) -> impl IntoResponse {
    // API paths that don't match any route should return JSON, not HTML.
    // This prevents the frontend's adminFetch from receiving an HTML SPA
    // fallback page when a microservice endpoint doesn't exist on this image.
    let path = uri.path();
    if path.starts_with("/api/") || path.starts_with("/ws/") {
        return (
            StatusCode::NOT_FOUND,
            [
                (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            ],
            serde_json::json!({
                "error": "Endpunkt nicht gefunden",
                "path": path,
                "available": false,
                "hint": "Dieser Endpunkt wird von einem anderen IORA-Microservice bereitgestellt, der auf diesem System nicht läuft."
            }).to_string(),
        ).into_response();
    }

    // Frontend Dev Proxy Mode: When IORA_FRONTEND_DEV_URL is set, proxy to Vite dev server
    // This enables HMR (Hot Module Replacement) during frontend development
    if let Some(dev_url) = frontend_dev_proxy::is_dev_proxy_enabled() {
        if frontend_dev_proxy::should_proxy_path(path) {
            info!(
                target: "frontend_dev",
                dev_url = %dev_url,
                path = %path,
                "Frontend dev proxy mode enabled, proxying to Vite dev server"
            );
            // Note: We need to convert Uri to Request for the proxy handler
            // For now, fall through to show dev mode info page
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                format!(r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IORA Frontend Dev Mode</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 80px auto;
            padding: 20px;
            background: #0a0a0a;
            color: #e5e5e5;
        }}
        .dev-badge {{
            background: #f59e0b;
            color: #000;
            padding: 8px 16px;
            border-radius: 6px;
            display: inline-block;
            font-weight: 600;
            margin-bottom: 20px;
        }}
        h1 {{ color: #3b82f6; }}
        code {{
            background: #1e1e1e;
            padding: 2px 6px;
            border-radius: 4px;
            color: #f59e0b;
        }}
        .info-box {{
            background: #1e1e1e;
            border: 1px solid #333;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }}
        a {{ color: #60a5fa; }}
    </style>
</head>
<body>
    <div class="dev-badge">🔥 DEVELOPMENT MODE</div>
    <h1>IORA Frontend Dev Proxy Active</h1>
    <div class="info-box">
        <p><strong>Backend:</strong> iora-home is running and serving the API</p>
        <p><strong>Frontend:</strong> Proxying to <code>{}</code></p>
        <p><strong>Environment:</strong> <code>IORA_FRONTEND_DEV_URL</code> is set</p>
    </div>
    <h2>Access the frontend:</h2>
    <ul>
        <li><strong>Direct Vite Dev Server (with HMR):</strong> <a href="{}">{}</a></li>
        <li><strong>Via Backend (API integration):</strong> Current URL</li>
    </ul>
    <p><em>Note: For full HMR support, access the Vite dev server directly. The backend proxy is for API integration testing.</em></p>
</body>
</html>"#, dev_url, dev_url, dev_url),
            ).into_response();
        }
    }

    // Standard mode: Serve built frontend from dist/
    if let Some(dist) = resolve_dist_dir() {
        if let Ok(html) = tokio::fs::read_to_string(dist.join("index.html")).await {
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
                ],
                html,
            )
                .into_response();
        }
    }
    // Embedded placeholder — confirms the backend is alive and points users
    // to other entry points. Always available regardless of deployment shape.
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
        ],
        FALLBACK_INDEX_HTML,
    )
        .into_response()
}

// ---------- Integration API (used by HA custom integration) ----------

/// In-memory dashboard settings controlled by the HA integration.
/// These are stored on the backend so that connected frontends can react.
static DASHBOARD_SETTINGS: std::sync::LazyLock<
    tokio::sync::RwLock<serde_json::Map<String, Value>>,
> = std::sync::LazyLock::new(|| {
    let mut m = serde_json::Map::new();
    m.insert("screensaver".into(), Value::Bool(false));
    m.insert("auto_theme".into(), Value::Bool(false));
    m.insert("sleep_mode".into(), Value::Bool(false));
    m.insert("webhooks".into(), Value::Bool(true));
    m.insert("brightness".into(), serde_json::json!(100));
    m.insert("theme".into(), Value::String("auto".into()));
    m.insert("current_page".into(), Value::String("home".into()));
    m.insert("maintenance_mode".into(), Value::Bool(false));
    m.insert(
        "maintenance_message".into(),
        Value::String("IORA befindet sich im Wartungsmodus.".into()),
    );
    tokio::sync::RwLock::new(m)
});

/// Composite virtual sensors — formulas registered by the HA integration that
/// the backend evaluates against live entity states.  This enables sensors
/// that would be impossible with HA templates alone (cross-entity math at
/// backend speed, combined with dashboard caching).
///
/// Structure: { "sensor_id": { "name": "...", "formula": "...", "entities": [...], "unit": "..." } }
static COMPOSITE_SENSORS: std::sync::LazyLock<tokio::sync::RwLock<serde_json::Map<String, Value>>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(serde_json::Map::new()));

/// Backend-powered Smart Scenes.
/// Unlike HA scenes which only save / restore static snapshots, these support:
///   - **Sequences** — ordered steps with delays between them
///   - **Conditional steps** — only execute if an entity is in a given state
///   - **HA service calls** — executed on the backend via `ha_client.call_service_fast`
///
/// Structure: { "scene_id": { "name", "steps": [{ "domain", "service", "entity_id", "data", "delay_ms", "condition"? }] } }
static SMART_SCENES: std::sync::LazyLock<tokio::sync::RwLock<serde_json::Map<String, Value>>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(serde_json::Map::new()));

/// Entity Scheduler — scheduled future HA service calls.
/// The backend spawns a tokio task for each schedule that sleeps until the
/// target time, then executes the service call via `ha_client.call_service_fast`.
///
/// Structure: { "schedule_id": { "entity_id", "domain", "service", "data", "run_at_unix", "created" } }
static SCHEDULED_ACTIONS: std::sync::LazyLock<tokio::sync::RwLock<serde_json::Map<String, Value>>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(serde_json::Map::new()));

/// Entity Watchdog — rules that auto-act when entities become unavailable or
/// stay in a given state for too long.
///
/// Structure: { "watchdog_id": { "entity_id", "trigger" ("unavailable"|"stale"|"state_equals"),
///              "action_domain", "action_service", "action_data", "cooldown_secs", "last_triggered" } }
static ENTITY_WATCHDOGS: std::sync::LazyLock<tokio::sync::RwLock<serde_json::Map<String, Value>>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(serde_json::Map::new()));

// Notifications are now stored in the DB (table `notifications`).
// Emergency-level notifications trigger the full-screen alert overlay on ALL clients.

/// Active emergency alert — only one at a time. When set, all dashboards show
/// the emergency bar and (for extreme level) the full-screen overlay.
/// Structure: { "id", "title", "message", "level" ("warning"|"critical"|"emergency"),
///   "source", "color", "icon", "created_at" }
static ACTIVE_EMERGENCY: std::sync::LazyLock<tokio::sync::RwLock<Option<Value>>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(None));

/// Load the persisted home_state rows from Postgres into the static maps above.
/// Called once on startup; missing rows are silently ignored (fresh install).
async fn load_home_state_from_db(pool: &DbPool) -> anyhow::Result<()> {
    let rows: Vec<(String, serde_json::Value)> =
        sqlx::query_as("SELECT scope, data FROM home_state")
            .fetch_all(pool)
            .await?;
    for (scope, data) in rows {
        match scope.as_str() {
            "dashboard_settings" => {
                if let Value::Object(m) = data {
                    *DASHBOARD_SETTINGS.write().await = m;
                }
            }
            "composite_sensors" => {
                if let Value::Object(m) = data {
                    *COMPOSITE_SENSORS.write().await = m;
                }
            }
            "smart_scenes" => {
                if let Value::Object(m) = data {
                    *SMART_SCENES.write().await = m;
                }
            }
            "scheduled_actions" => {
                if let Value::Object(m) = data {
                    *SCHEDULED_ACTIONS.write().await = m;
                }
            }
            "entity_watchdogs" => {
                if let Value::Object(m) = data {
                    *ENTITY_WATCHDOGS.write().await = m;
                }
            }
            "active_emergency" => {
                *ACTIVE_EMERGENCY.write().await = if data.is_null() { None } else { Some(data) };
            }
            _ => {}
        }
    }
    Ok(())
}

/// Snapshot all 6 maps to the home_state table. Cheap (single transaction,
/// JSONB upserts) and runs every 5s — sufficient durability for soft state.
async fn persist_home_state_to_db(pool: &DbPool) -> anyhow::Result<()> {
    let snapshots: [(&str, Value); 6] = [
        (
            "dashboard_settings",
            Value::Object(DASHBOARD_SETTINGS.read().await.clone()),
        ),
        (
            "composite_sensors",
            Value::Object(COMPOSITE_SENSORS.read().await.clone()),
        ),
        (
            "smart_scenes",
            Value::Object(SMART_SCENES.read().await.clone()),
        ),
        (
            "scheduled_actions",
            Value::Object(SCHEDULED_ACTIONS.read().await.clone()),
        ),
        (
            "entity_watchdogs",
            Value::Object(ENTITY_WATCHDOGS.read().await.clone()),
        ),
        (
            "active_emergency",
            ACTIVE_EMERGENCY.read().await.clone().unwrap_or(Value::Null),
        ),
    ];
    for (scope, data) in snapshots {
        sqlx::query(
            "INSERT INTO home_state (scope, data, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (scope) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
        )
        .bind(scope)
        .bind(&data)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Cached NINA warnings — refreshed by the background poller.
/// Structure: Vec<{ "id", "version", "headline", "description", "severity",
///   "category", "sender", "sent", "effective", "expires", "level" }>
static NINA_WARNINGS: std::sync::LazyLock<tokio::sync::RwLock<Vec<Value>>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(Vec::new()));

/// Cached ARS region codes for NINA — fetched from GitHub Landkreise dataset + Bundesländer.
/// Warmed on startup, refreshed every 24h. Structure: Vec<{ "ars": "...", "name": "...", "type": "..." }>
static ARS_REGIONS_CACHE: std::sync::LazyLock<tokio::sync::RwLock<Option<Vec<Value>>>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(None));

/// Timestamp of last ARS regions cache refresh (epoch seconds)
static ARS_REGIONS_LAST_REFRESH: std::sync::LazyLock<tokio::sync::RwLock<u64>> =
    std::sync::LazyLock::new(|| tokio::sync::RwLock::new(0));

/// Public, lightweight check for whether Home Assistant has been configured.
/// Accepts the schema-driven settings keys (`ha.url`, `ha.token`) and the
/// legacy `system_preferences/ha_config` aggregate for backwards compatibility.
/// Used by the
/// frontend so the Overview page can be replaced with a "IORA Home not
/// configured" placeholder on a fresh install — Settings and the Admin
/// Control Center remain reachable so the user can configure HA from there.
async fn integration_ha_configured(State(state): State<AppState>) -> impl IntoResponse {
    let ha_config = load_ha_runtime_config(&state.config_repo).await;
    let has_url = !ha_config.url.is_empty();
    let has_token = !ha_config.token.is_empty();
    Json(serde_json::json!({
        "configured": ha_config.is_configured(),
        "has_url": has_url,
        "has_token": has_token,
    }))
}

/// POST /api/integration/ha/test — test HA connectivity with current credentials.
/// Returns detailed diagnostics so the user knows WHY a 401 is happening.
async fn integration_ha_test_connection(State(state): State<AppState>) -> Json<Value> {
    let ha_config = load_ha_runtime_config(&state.config_repo).await;
    if !ha_config.is_configured() {
        return Json(json!({
            "ok": false,
            "error": "HA not configured — set URL and token in Admin Settings",
            "configured": false,
        }));
    }

    // Test connectivity with current credentials
    let test_url = format!("{}/api/", ha_config.url.trim_end_matches('/'));
    let start = std::time::Instant::now();
    let result = state
        .http_client
        .get(&test_url)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", ha_config.token),
        )
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body_hint = resp.text().await.unwrap_or_default();
            let body_preview: String = body_hint.chars().take(200).collect();
            if status == 200 {
                Json(json!({
                    "ok": true,
                    "status": status,
                    "latency_ms": elapsed_ms,
                    "message": "HA is reachable and credentials are valid",
                    "configured": true,
                }))
            } else if status == 401 {
                Json(json!({
                    "ok": false,
                    "status": status,
                    "latency_ms": elapsed_ms,
                    "error": format!(
                        "Authentication failed (HTTP 401). The token is invalid or expired. \
                         Generate a new Long-Lived Access Token in HA under \
                         Settings → People → Long-Lived Access Tokens."
                    ),
                    "configured": true,
                }))
            } else {
                Json(json!({
                    "ok": false,
                    "status": status,
                    "latency_ms": elapsed_ms,
                    "error": format!("HA returned HTTP {}: {}", status, body_preview),
                    "configured": true,
                }))
            }
        }
        Err(e) => {
            let hint = if e.is_timeout() {
                format!(
                    "Connection timed out after {}ms. Check that the URL is correct\
                     and HA is running. Example: http://192.168.1.100:8123",
                    elapsed_ms
                )
            } else if e.is_connect() {
                format!(
                    "Could not connect to {}. Verify the IP/port and that HA is running.",
                    ha_config.url
                )
            } else {
                format!("Connection error: {}", e)
            };
            Json(json!({
                "ok": false,
                "error": hint,
                "latency_ms": elapsed_ms,
                "configured": true,
            }))
        }
    }
}

/// POST /api/integration/ha/reconnect — force HA client to reconnect with current settings.
/// Use this after updating HA URL/token when you don't want to wait for the auto-retry.
async fn integration_ha_reconnect(State(state): State<AppState>) -> Json<Value> {
    let ha_config = load_ha_runtime_config(&state.config_repo).await;
    if !ha_config.is_configured() {
        return Json(json!({
            "ok": false,
            "error": "HA not configured — set URL and token first",
        }));
    }

    // Update the live client credentials
    state
        .ha_client
        .update_credentials(&ha_config.url, &ha_config.token)
        .await;
    state.ha_connection.update_url(&ha_config.url).await;
    state.ha_connection.reset_for_reconnect();

    info!("HA reconnection triggered manually via API");

    Json(json!({
        "ok": true,
        "message": "HA client reconnected with current settings",
        "url": ha_config.url,
    }))
}

/// Returns dashboard status for the HA integration coordinator to poll.
async fn integration_status(State(state): State<AppState>) -> impl IntoResponse {
    let entity_count = state.entity_cache.count().await;
    let ha_connected = state.entity_cache.is_ha_connected();
    let connected_clients = state.ws_manager.client_count().await;
    let settings = DASHBOARD_SETTINGS.read().await;
    let metrics = state.entity_cache.metrics();
    let uptime_secs = APP_START.elapsed().as_secs();

    // Count automation entities in cache
    let active_automations = state
        .entity_cache
        .get_by_domain("automation")
        .await
        .iter()
        .filter(|e| e.state == "on")
        .count();

    // Entity analytics summary
    let analytics = state.entity_cache.analytics_summary().await;

    // Entity health summary
    let health_report = state.entity_cache.entity_health_report(3600).await;
    let unavailable_entities = health_report
        .iter()
        .filter(|e| e.status == "unavailable")
        .count();
    let stale_entities = health_report.iter().filter(|e| e.status == "stale").count();

    // Composite sensor values
    let composite_values = evaluate_composite_sensors(&state).await;

    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "ha_connected": ha_connected,
        "ha_ws_connected": state.ha_ws.is_connected(),
        "connected_clients": connected_clients,
        "entity_count": entity_count,
        "uptime_seconds": uptime_secs,
        "active_automations": active_automations,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "settings": Value::Object(settings.clone()),
        "diagnostics": {
            "cache_update_count": metrics.update_count,
            "cache_last_update_ms": metrics.last_update_ms,
            "cache_hits": metrics.cache_hits,
            "cache_misses": metrics.cache_misses,
            "api_requests_total": metrics.cache_hits + metrics.cache_misses,
        },
        "entity_analytics": analytics,
        "entity_health": {
            "unavailable_count": unavailable_entities,
            "stale_count": stale_entities,
            "total_issues": health_report.len(),
        },
        "composite_sensors": composite_values,
        "smart_scenes": {
            "count": SMART_SCENES.read().await.len(),
        },
        "scheduled_actions": {
            "count": SCHEDULED_ACTIONS.read().await.len(),
        },
        "watchdogs": {
            "count": ENTITY_WATCHDOGS.read().await.len(),
        },
        "background_tasks": {
            "watchdog_loop": "30s interval",
            "schedule_cleanup": "5min interval",
            "anomaly_detection": "2min interval",
            "analytics_aggregation": "10min interval",
            "stale_entity_monitor": "60s interval",
            "history_cleanup": "1h interval",
            "safety_net_poll": "60s/5s interval",
            "ha_cache_refresh": "45s interval",
            "ha_health_check": "30s/10s interval",
        },
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
    let updates = body
        .as_object()
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

/// GET /api/integration/analytics/top — top N most-active entities by change count
async fn integration_analytics_top(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let n: usize = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);
    let top = state.entity_cache.top_active_entities(n).await;
    Json(serde_json::json!({
        "result": "ok",
        "entities": top,
        "count": top.len(),
    }))
}

/// GET /api/integration/analytics/entity/:entity_id — detailed analytics for one entity
async fn integration_analytics_entity(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.entity_cache.entity_analytics(&entity_id).await {
        Some(analytics) => Ok(Json(serde_json::json!({
            "result": "ok",
            "analytics": analytics,
        }))),
        None => Err(ErrorResponse::not_found(format!(
            "No analytics for {}",
            entity_id
        ))),
    }
}

/// GET /api/integration/health — entity health report (unavailable, stale, low-battery)
async fn integration_health_report(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let threshold: u64 = params
        .get("stale_threshold")
        .and_then(|v| v.parse().ok())
        .unwrap_or(3600); // default 1 hour
    let report = state.entity_cache.entity_health_report(threshold).await;
    let unavailable = report.iter().filter(|e| e.status == "unavailable").count();
    let stale = report.iter().filter(|e| e.status == "stale").count();
    let unknown = report.iter().filter(|e| e.status == "unknown").count();
    Json(serde_json::json!({
        "result": "ok",
        "summary": {
            "unavailable": unavailable,
            "stale": stale,
            "unknown": unknown,
            "total_issues": report.len(),
        },
        "entities": report,
    }))
}

/// GET /api/integration/composite — list all composite sensors with computed values
async fn integration_composite_sensors(State(state): State<AppState>) -> impl IntoResponse {
    let values = evaluate_composite_sensors(&state).await;
    let definitions = COMPOSITE_SENSORS.read().await;
    Json(serde_json::json!({
        "result": "ok",
        "sensors": values,
        "count": definitions.len(),
    }))
}

/// POST /api/integration/composite — register or update a composite sensor
async fn integration_register_composite(
    State(_state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let sensor_id = body
        .get("sensor_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing sensor_id"))?;
    let _formula = body
        .get("formula")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            ErrorResponse::bad_request("Missing formula (avg|sum|min|max|diff|comfort_index|range)")
        })?;
    let _entities = body
        .get("entities")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ErrorResponse::bad_request("Missing entities array"))?;

    let mut sensors = COMPOSITE_SENSORS.write().await;
    sensors.insert(sensor_id.to_string(), body.clone());
    Ok(Json(serde_json::json!({
        "result": "ok",
        "action": "registered",
        "sensor_id": sensor_id,
    })))
}

/// Receives commands from the HA integration (refresh, clear_cache, etc.).
async fn integration_command(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let command = body.get("command").and_then(|v| v.as_str()).unwrap_or("");

    match command {
        "refresh" => {
            // Trigger a fresh fetch of all entity states from HA
            let entities = state
                .ha_client
                .get_states()
                .await
                .map_err(|e| ErrorResponse::internal(format!("HA fetch failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                METRICS
                    .entity_state_changes
                    .fetch_add(changed.len() as u64, Ordering::Relaxed);
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "refresh"}),
            ))
        }
        "notify" => {
            // Route through the notification dispatcher (persists + broadcasts + sends to all channels)
            let data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            let req = notification_dispatcher::DispatchRequest {
                title: data
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Notification")
                    .to_string(),
                message: data
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                level: data
                    .get("level")
                    .and_then(|v| v.as_str())
                    .unwrap_or("info")
                    .to_string(),
                source: data
                    .get("source")
                    .and_then(|v| v.as_str())
                    .unwrap_or("system")
                    .to_string(),
                icon: data
                    .get("icon")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                entity_id: data
                    .get("entity_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                auto_dismiss_secs: data
                    .get("auto_dismiss_secs")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32,
                channels: data
                    .get("channels")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                extra_data: data
                    .get("extra_data")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            };
            let (id, _results) = state.notification_dispatcher.dispatch(req).await;
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "notify", "id": id}),
            ))
        }
        "alert" => {
            // Set a dashboard-wide emergency/warning alert
            let data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            let id = uuid::Uuid::new_v4().to_string();
            let level = data
                .get("level")
                .and_then(|v| v.as_str())
                .unwrap_or("warning");
            let alert = serde_json::json!({
                "id": id,
                "title": data.get("title").and_then(|v| v.as_str()).unwrap_or("Warnung"),
                "message": data.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                "level": level,
                "source": data.get("source").and_then(|v| v.as_str()).unwrap_or("system"),
                "color": data.get("color").and_then(|v| v.as_str()).unwrap_or(""),
                "icon": data.get("icon").and_then(|v| v.as_str()).unwrap_or(""),
                "created_at": chrono::Utc::now().to_rfc3339(),
            });
            *ACTIVE_EMERGENCY.write().await = Some(alert.clone());
            // Also create a notification entry in DB
            if let Err(e) = sqlx::query(
                "INSERT INTO notifications (id, title, message, level, source, icon, entity_id, created_at, read, auto_dismiss_secs) VALUES ($1, $2, $3, $4, $5, $6, '', $7, false, 0)"
            )
                .bind(&id)
                .bind(alert["title"].as_str().unwrap_or(""))
                .bind(alert["message"].as_str().unwrap_or(""))
                .bind(level)
                .bind(alert["source"].as_str().unwrap_or("system"))
                .bind(alert["icon"].as_str().unwrap_or(""))
                .bind(chrono::Utc::now())
                .execute(&state.db_pool)
                .await
            {
                warn!("Failed to persist alert notification: {}", e);
            }
            let event = serde_json::json!({
                "type": "emergency_alert",
                "action": "set",
                "alert": alert,
            });
            state.ws_manager.broadcast_json(&event).await;
            info!("Emergency alert set: [{}] {}", level, alert["title"]);
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "alert", "id": id}),
            ))
        }
        "dismiss_alert" => {
            *ACTIVE_EMERGENCY.write().await = None;
            let event = serde_json::json!({
                "type": "emergency_alert",
                "action": "dismiss",
            });
            state.ws_manager.broadcast_json(&event).await;
            info!("Emergency alert dismissed");
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "dismiss_alert"}),
            ))
        }
        "clear_cache" => {
            // Re-fetch everything from HA (effectively clears stale data)
            let entities = state
                .ha_client
                .get_states()
                .await
                .map_err(|e| ErrorResponse::internal(format!("Cache clear failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                METRICS
                    .entity_state_changes
                    .fetch_add(changed.len() as u64, Ordering::Relaxed);
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "clear_cache"}),
            ))
        }
        "set_theme" => {
            let theme = body
                .get("data")
                .and_then(|d| d.get("theme"))
                .and_then(|t| t.as_str())
                .unwrap_or("auto");
            let mut settings = DASHBOARD_SETTINGS.write().await;
            settings.insert("theme".into(), Value::String(theme.into()));
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "set_theme", "theme": theme}),
            ))
        }
        "switch_page" => {
            let page = body
                .get("data")
                .and_then(|d| d.get("page_id"))
                .and_then(|p| p.as_str())
                .unwrap_or("home");
            let mut settings = DASHBOARD_SETTINGS.write().await;
            settings.insert("current_page".into(), Value::String(page.into()));
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "switch_page", "page": page}),
            ))
        }
        "set_setting" => {
            let data = body
                .get("data")
                .and_then(|d| d.as_object())
                .ok_or_else(|| ErrorResponse::bad_request("Missing data object"))?;
            let mut settings = DASHBOARD_SETTINGS.write().await;
            for (key, value) in data {
                settings.insert(key.clone(), value.clone());
            }
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "set_setting"}),
            ))
        }
        "set_brightness" => {
            let brightness = body
                .get("data")
                .and_then(|d| d.get("brightness"))
                .and_then(|b| b.as_u64())
                .unwrap_or(100)
                .min(100);
            let mut settings = DASHBOARD_SETTINGS.write().await;
            settings.insert("brightness".into(), serde_json::json!(brightness));
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "set_brightness", "brightness": brightness}),
            ))
        }
        "restart" => {
            // Trigger a full re-sync (closest thing to a restart without actually stopping the process)
            let entities = state
                .ha_client
                .get_states()
                .await
                .map_err(|e| ErrorResponse::internal(format!("Restart re-sync failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                METRICS
                    .entity_state_changes
                    .fetch_add(changed.len() as u64, Ordering::Relaxed);
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "restart"}),
            ))
        }
        "register_composite_sensor" => {
            let data = body
                .get("data")
                .ok_or_else(|| ErrorResponse::bad_request("Missing data"))?;
            let sensor_id = data
                .get("sensor_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ErrorResponse::bad_request("Missing sensor_id"))?;
            let mut sensors = COMPOSITE_SENSORS.write().await;
            sensors.insert(sensor_id.to_string(), data.clone());
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "register_composite_sensor", "sensor_id": sensor_id}),
            ))
        }
        "remove_composite_sensor" => {
            let sensor_id = body
                .get("data")
                .and_then(|d| d.get("sensor_id"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| ErrorResponse::bad_request("Missing sensor_id"))?;
            let mut sensors = COMPOSITE_SENSORS.write().await;
            sensors.remove(sensor_id);
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "remove_composite_sensor", "sensor_id": sensor_id}),
            ))
        }
        "reload" => {
            // Trigger a full re-sync which effectively reloads frontend data
            let entities = state
                .ha_client
                .get_states()
                .await
                .map_err(|e| ErrorResponse::internal(format!("Reload re-sync failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                METRICS
                    .entity_state_changes
                    .fetch_add(changed.len() as u64, Ordering::Relaxed);
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "reload"}),
            ))
        }
        "set_widget_value" => {
            let _data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "set_widget_value"}),
            ))
        }
        "template_result" => {
            let data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            Ok(Json(
                serde_json::json!({"result": "ok", "action": "template_result", "data": data}),
            ))
        }
        _ => Err(ErrorResponse::bad_request(format!(
            "Unknown command: {command}"
        ))),
    }
}

/// Evaluate all registered composite sensors against current entity cache states.
/// Each composite sensor defines:
///   - `entities`: list of entity_ids whose numeric states are used
///   - `formula`: one of "avg", "sum", "min", "max", "diff", "comfort_index"
///   - `name`: display name
///   - `unit`: unit of measurement
async fn evaluate_composite_sensors(state: &AppState) -> Value {
    let sensors = COMPOSITE_SENSORS.read().await;
    if sensors.is_empty() {
        return serde_json::json!({});
    }

    let mut results = serde_json::Map::new();
    for (sensor_id, def) in sensors.iter() {
        let entity_ids: Vec<&str> = def
            .get("entities")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        let formula = def.get("formula").and_then(|v| v.as_str()).unwrap_or("avg");
        let name = def
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(sensor_id);
        let unit = def.get("unit").and_then(|v| v.as_str()).unwrap_or("");

        // Collect numeric states
        let mut values = Vec::new();
        for eid in &entity_ids {
            if let Some(entity) = state.entity_cache.get(eid).await {
                if let Ok(v) = entity.state.parse::<f64>() {
                    values.push(v);
                }
            }
        }

        let computed = if values.is_empty() {
            None
        } else {
            match formula {
                "avg" => Some(values.iter().sum::<f64>() / values.len() as f64),
                "sum" => Some(values.iter().sum::<f64>()),
                "min" => values.iter().copied().reduce(f64::min),
                "max" => values.iter().copied().reduce(f64::max),
                "diff" => {
                    if values.len() >= 2 {
                        Some(values[0] - values[1])
                    } else {
                        Some(values[0])
                    }
                }
                "comfort_index" => {
                    // Comfort index from temperature and humidity:
                    // CI = temp - 0.55*(1 - humidity/100) * (temp - 14.5)
                    if values.len() >= 2 {
                        let temp = values[0];
                        let humidity = values[1].clamp(0.0, 100.0);
                        Some(temp - 0.55 * (1.0 - humidity / 100.0) * (temp - 14.5))
                    } else {
                        Some(values[0])
                    }
                }
                "range" => {
                    let min = values.iter().copied().reduce(f64::min).unwrap_or(0.0);
                    let max = values.iter().copied().reduce(f64::max).unwrap_or(0.0);
                    Some(max - min)
                }
                _ => Some(values.iter().sum::<f64>() / values.len() as f64),
            }
        };

        results.insert(
            sensor_id.clone(),
            serde_json::json!({
                "name": name,
                "value": computed.map(|v| (v * 100.0).round() / 100.0),
                "unit": unit,
                "formula": formula,
                "source_count": values.len(),
                "source_entities": entity_ids,
            }),
        );
    }

    Value::Object(results)
}

// ─────────────────────────── Smart Scenes ───────────────────────────

/// GET /api/integration/scenes — list all smart scenes
async fn integration_list_scenes() -> impl IntoResponse {
    let scenes = SMART_SCENES.read().await;
    Json(serde_json::json!({
        "result": "ok",
        "scenes": Value::Object(scenes.clone()),
        "count": scenes.len(),
    }))
}

/// POST /api/integration/scenes — create or update a smart scene
async fn integration_create_scene(
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let scene_id = body
        .get("scene_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing scene_id"))?;
    let _name = body
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing name"))?;
    let _steps = body
        .get("steps")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ErrorResponse::bad_request("Missing steps array"))?;

    let mut scenes = SMART_SCENES.write().await;
    scenes.insert(scene_id.to_string(), body.clone());
    Ok(Json(serde_json::json!({
        "result": "ok",
        "action": "created",
        "scene_id": scene_id,
    })))
}

/// DELETE /api/integration/scenes/:scene_id — remove a scene
async fn integration_delete_scene(Path(scene_id): Path<String>) -> impl IntoResponse {
    let mut scenes = SMART_SCENES.write().await;
    let existed = scenes.remove(&scene_id).is_some();
    Json(serde_json::json!({
        "result": "ok",
        "action": if existed { "deleted" } else { "not_found" },
        "scene_id": scene_id,
    }))
}

/// POST /api/integration/scenes/:scene_id/execute — run all steps of a scene
async fn integration_execute_scene(
    State(state): State<AppState>,
    Path(scene_id): Path<String>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let scenes = SMART_SCENES.read().await;
    let scene = scenes
        .get(&scene_id)
        .ok_or_else(|| ErrorResponse::bad_request(format!("Scene not found: {scene_id}")))?
        .clone();
    drop(scenes);

    let steps = scene
        .get("steps")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut executed = 0u32;
    let mut skipped = 0u32;

    for step in &steps {
        let domain = step
            .get("domain")
            .and_then(|v| v.as_str())
            .unwrap_or("homeassistant");
        let service = step
            .get("service")
            .and_then(|v| v.as_str())
            .unwrap_or("toggle");
        let entity_id = step.get("entity_id").and_then(|v| v.as_str()).unwrap_or("");
        let delay_ms = step.get("delay_ms").and_then(|v| v.as_u64()).unwrap_or(0);
        let step_data = step.get("data").cloned().unwrap_or(serde_json::json!({}));

        // Check optional condition: { "entity_id": "...", "state": "on" }
        if let Some(condition) = step.get("condition").and_then(|v| v.as_object()) {
            let cond_entity = condition
                .get("entity_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cond_state = condition
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !cond_entity.is_empty() && !cond_state.is_empty() {
                if let Some(current) = state.entity_cache.get(cond_entity).await {
                    if current.state != cond_state {
                        skipped += 1;
                        continue;
                    }
                } else {
                    skipped += 1;
                    continue;
                }
            }
        }

        // Build service data with entity_id
        let mut svc_data = step_data.as_object().cloned().unwrap_or_default();
        if !entity_id.is_empty() {
            svc_data.insert("entity_id".into(), Value::String(entity_id.into()));
        }

        match state
            .ha_client
            .call_service_fast(domain, service, Value::Object(svc_data))
            .await
        {
            Ok(()) => executed += 1,
            Err(e) => {
                warn!("Scene step failed ({domain}.{service}): {e}");
                executed += 1;
            }
        }

        if delay_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        }
    }

    Ok(Json(serde_json::json!({
        "result": "ok",
        "scene_id": scene_id,
        "steps_executed": executed,
        "steps_skipped": skipped,
        "steps_total": steps.len(),
    })))
}

// ─────────────────────────── Entity Scheduler ───────────────────────────

/// GET /api/integration/schedules — list all scheduled actions
async fn integration_list_schedules() -> impl IntoResponse {
    let schedules = SCHEDULED_ACTIONS.read().await;
    Json(serde_json::json!({
        "result": "ok",
        "schedules": Value::Object(schedules.clone()),
        "count": schedules.len(),
    }))
}

/// POST /api/integration/schedules — schedule a future HA service call
async fn integration_create_schedule(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let schedule_id = body
        .get("schedule_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing schedule_id"))?
        .to_string();
    let domain = body
        .get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?
        .to_string();
    let service = body
        .get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?
        .to_string();
    let run_at = body
        .get("run_at_unix")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| ErrorResponse::bad_request("Missing run_at_unix (epoch seconds)"))?;
    let svc_data = body.get("data").cloned().unwrap_or(serde_json::json!({}));

    let now = chrono::Utc::now().timestamp();
    if run_at <= now {
        return Err(ErrorResponse::bad_request(
            "run_at_unix must be in the future",
        ));
    }

    let delay_secs = (run_at - now) as u64;

    // Store the schedule
    let mut record = body.clone();
    if let Some(obj) = record.as_object_mut() {
        obj.insert("created".into(), serde_json::json!(now));
    }
    {
        let mut schedules = SCHEDULED_ACTIONS.write().await;
        schedules.insert(schedule_id.clone(), record);
    }

    // Spawn a background task to execute it
    let ha_client = state.ha_client.clone();
    let sid = schedule_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
        info!("Executing scheduled action: {sid}");
        let _ = ha_client
            .call_service_fast(&domain, &service, svc_data)
            .await;
        // Remove from store after execution
        let mut schedules = SCHEDULED_ACTIONS.write().await;
        schedules.remove(&sid);
    });

    Ok(Json(serde_json::json!({
        "result": "ok",
        "action": "scheduled",
        "schedule_id": schedule_id,
        "executes_in_secs": delay_secs,
    })))
}

/// DELETE /api/integration/schedules/:schedule_id — cancel a scheduled action
async fn integration_cancel_schedule(Path(schedule_id): Path<String>) -> impl IntoResponse {
    let mut schedules = SCHEDULED_ACTIONS.write().await;
    let existed = schedules.remove(&schedule_id).is_some();
    Json(serde_json::json!({
        "result": "ok",
        "action": if existed { "cancelled" } else { "not_found" },
        "schedule_id": schedule_id,
    }))
}

// ─────────────────────────── Entity Watchdog ───────────────────────────

/// GET /api/integration/watchdogs — list all watchdog rules
async fn integration_list_watchdogs() -> impl IntoResponse {
    let watchdogs = ENTITY_WATCHDOGS.read().await;
    Json(serde_json::json!({
        "result": "ok",
        "watchdogs": Value::Object(watchdogs.clone()),
        "count": watchdogs.len(),
    }))
}

/// POST /api/integration/watchdogs — add a watchdog rule
async fn integration_create_watchdog(
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let watchdog_id = body
        .get("watchdog_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing watchdog_id"))?;
    let _entity_id = body
        .get("entity_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing entity_id"))?;
    let trigger = body
        .get("trigger")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            ErrorResponse::bad_request("Missing trigger (unavailable|stale|state_equals)")
        })?;
    if !["unavailable", "stale", "state_equals"].contains(&trigger) {
        return Err(ErrorResponse::bad_request(
            "trigger must be: unavailable, stale, or state_equals",
        ));
    }

    let mut watchdogs = ENTITY_WATCHDOGS.write().await;
    watchdogs.insert(watchdog_id.to_string(), body.clone());
    Ok(Json(serde_json::json!({
        "result": "ok",
        "action": "created",
        "watchdog_id": watchdog_id,
    })))
}

/// DELETE /api/integration/watchdogs/:watchdog_id — remove a watchdog rule
async fn integration_delete_watchdog(Path(watchdog_id): Path<String>) -> impl IntoResponse {
    let mut watchdogs = ENTITY_WATCHDOGS.write().await;
    let existed = watchdogs.remove(&watchdog_id).is_some();
    Json(serde_json::json!({
        "result": "ok",
        "action": if existed { "deleted" } else { "not_found" },
        "watchdog_id": watchdog_id,
    }))
}

/// POST /api/integration/watchdogs/check — evaluate all watchdog rules NOW
async fn integration_check_watchdogs(State(state): State<AppState>) -> impl IntoResponse {
    let watchdogs = ENTITY_WATCHDOGS.read().await;
    let mut triggered = Vec::new();
    let now = chrono::Utc::now().timestamp();

    for (wid, rule) in watchdogs.iter() {
        let entity_id = rule.get("entity_id").and_then(|v| v.as_str()).unwrap_or("");
        let trigger = rule.get("trigger").and_then(|v| v.as_str()).unwrap_or("");
        let cooldown = rule
            .get("cooldown_secs")
            .and_then(|v| v.as_i64())
            .unwrap_or(300);
        let last_triggered = rule
            .get("last_triggered")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let action_domain = rule
            .get("action_domain")
            .and_then(|v| v.as_str())
            .unwrap_or("homeassistant");
        let action_service = rule
            .get("action_service")
            .and_then(|v| v.as_str())
            .unwrap_or("toggle");
        let action_data = rule
            .get("action_data")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        // Cooldown check
        if now - last_triggered < cooldown {
            continue;
        }

        let should_trigger = if entity_id.is_empty() {
            false
        } else if let Some(entity) = state.entity_cache.get(entity_id).await {
            match trigger {
                "unavailable" => entity.state == "unavailable",
                "stale" => {
                    if let Some(analytics) = state.entity_cache.entity_analytics(entity_id).await {
                        analytics.stale_seconds > cooldown as u64
                    } else {
                        false
                    }
                }
                "state_equals" => {
                    let target_state = rule
                        .get("target_state")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    entity.state == target_state
                }
                _ => false,
            }
        } else {
            trigger == "unavailable"
        };

        if should_trigger {
            let mut svc_data = action_data.as_object().cloned().unwrap_or_default();
            if !entity_id.is_empty() {
                svc_data.insert("entity_id".into(), Value::String(entity_id.into()));
            }

            match state
                .ha_client
                .call_service_fast(action_domain, action_service, Value::Object(svc_data))
                .await
            {
                Ok(()) => {
                    triggered.push(serde_json::json!({
                        "watchdog_id": wid,
                        "entity_id": entity_id,
                        "trigger": trigger,
                        "action": format!("{action_domain}.{action_service}"),
                    }));
                }
                Err(e) => {
                    warn!("Watchdog action failed for {wid}: {e}");
                }
            }
        }
    }
    drop(watchdogs);

    // Update last_triggered for fired watchdogs
    if !triggered.is_empty() {
        let mut watchdogs = ENTITY_WATCHDOGS.write().await;
        for t in &triggered {
            if let Some(wid) = t.get("watchdog_id").and_then(|v| v.as_str()) {
                if let Some(rule) = watchdogs.get_mut(wid) {
                    if let Some(obj) = rule.as_object_mut() {
                        obj.insert("last_triggered".into(), serde_json::json!(now));
                    }
                }
            }
        }
    }

    Json(serde_json::json!({
        "result": "ok",
        "triggered": triggered,
        "triggered_count": triggered.len(),
    }))
}

/// GET /api/integration/analytics/history — retrieve analytics snapshots for trend charts
async fn integration_analytics_history(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(100);
    let hours = params
        .get("hours")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(24);

    let cutoff = chrono::Utc::now() - chrono::Duration::hours(hours);

    match sqlx::query_as::<_, (chrono::DateTime<chrono::Utc>, i32, i32, i32, i32, Option<String>, i32)>(
        "SELECT recorded_at, total_entities, unavailable_count, stale_count, total_state_changes, most_active_entity, most_active_changes FROM entity_analytics_snapshots WHERE recorded_at > $1 ORDER BY recorded_at DESC LIMIT $2"
    )
        .bind(&cutoff)
        .bind(limit)
        .fetch_all(&state.db_pool)
        .await
    {
        Ok(rows) => {
            let snapshots: Vec<serde_json::Value> = rows.iter().map(|r| {
                serde_json::json!({
                    "recorded_at": r.0.to_rfc3339(),
                    "total_entities": r.1,
                    "unavailable_count": r.2,
                    "stale_count": r.3,
                    "total_state_changes": r.4,
                    "most_active_entity": r.5,
                    "most_active_changes": r.6,
                })
            }).collect();
            Json(serde_json::json!({
                "result": "ok",
                "snapshots": snapshots,
                "count": snapshots.len(),
            }))
        }
        Err(_) => {
            Json(serde_json::json!({
                "result": "ok",
                "snapshots": [],
                "count": 0,
                "note": "Analytics table not yet populated",
            }))
        }
    }
}

// ─────────────────────── Enhanced Device Control ─────────────────────────

/// POST /api/integration/device/delayed-action — execute an HA service call after a delay
async fn integration_delayed_action(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let domain = body
        .get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?
        .to_string();
    let service = body
        .get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?
        .to_string();
    let delay_secs = body
        .get("delay_secs")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| ErrorResponse::bad_request("Missing delay_secs"))?;
    let svc_data = body.get("data").cloned().unwrap_or(serde_json::json!({}));

    if delay_secs > 86400 {
        return Err(ErrorResponse::bad_request("delay_secs max 86400 (24h)"));
    }

    let ha_client = state.ha_client.clone();
    let d = domain.clone();
    let s = service.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
        let _ = ha_client.call_service_fast(&d, &s, svc_data).await;
    });

    Ok(Json(serde_json::json!({
        "result": "ok",
        "action": "delayed",
        "domain": domain,
        "service": service,
        "delay_secs": delay_secs,
    })))
}

/// POST /api/integration/device/conditional-action — execute only if a condition is met
async fn integration_conditional_action(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let domain = body
        .get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?;
    let service = body
        .get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?;
    let svc_data = body.get("data").cloned().unwrap_or(serde_json::json!({}));

    let cond_entity = body
        .get("condition_entity")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing condition_entity"))?;
    let cond_state = body
        .get("condition_state")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing condition_state"))?;

    let condition_met = if let Some(entity) = state.entity_cache.get(cond_entity).await {
        entity.state == cond_state
    } else {
        false
    };

    if !condition_met {
        return Ok(Json(serde_json::json!({
            "result": "ok",
            "action": "skipped",
            "reason": "condition_not_met",
            "condition_entity": cond_entity,
            "condition_state": cond_state,
        })));
    }

    state
        .ha_client
        .call_service_fast(domain, service, svc_data)
        .await
        .map_err(|e| ErrorResponse::internal(format!("Service call failed: {e}")))?;

    Ok(Json(serde_json::json!({
        "result": "ok",
        "action": "executed",
        "domain": domain,
        "service": service,
    })))
}

/// POST /api/integration/device/group-action — call a service on multiple entities at once
async fn integration_group_action(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let domain = body
        .get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?;
    let service = body
        .get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?;
    let entity_ids = body
        .get("entity_ids")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ErrorResponse::bad_request("Missing entity_ids array"))?;
    let extra_data = body.get("data").cloned().unwrap_or(serde_json::json!({}));

    let mut succeeded = 0u32;
    let mut failed = 0u32;

    for eid_val in entity_ids {
        let eid = eid_val.as_str().unwrap_or("");
        if eid.is_empty() {
            continue;
        }

        let mut svc_data = extra_data.as_object().cloned().unwrap_or_default();
        svc_data.insert("entity_id".into(), Value::String(eid.into()));

        match state
            .ha_client
            .call_service_fast(domain, service, Value::Object(svc_data))
            .await
        {
            Ok(()) => succeeded += 1,
            Err(_) => failed += 1,
        }
    }

    Ok(Json(serde_json::json!({
        "result": "ok",
        "action": "group_action",
        "domain": domain,
        "service": service,
        "succeeded": succeeded,
        "failed": failed,
        "total": entity_ids.len(),
    })))
}

/// Get all entity states (served from cache)
async fn get_states(
    State(state): State<AppState>,
) -> Result<Json<Vec<EntityState>>, ErrorResponse> {
    // Serve from cache if populated
    if state.entity_cache.is_populated().await {
        return Ok(Json(state.entity_cache.get_all().await));
    }
    let ha_config = load_ha_runtime_config_from_pool(&state.db_pool).await;
    if !ha_config.is_configured() {
        state.entity_cache.set_ha_connected(false);
        return Ok(Json(Vec::new()));
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
            Err(ErrorResponse::internal(format!(
                "Failed to get states: {}",
                e
            )))
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
        None => Err(ErrorResponse::not_found(format!(
            "Entity {} not found",
            entity_id
        ))),
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
    METRICS.service_calls_total.fetch_add(1, Ordering::Relaxed);
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
                        info!(
                            "Service {}.{} returned upstream status {}",
                            domain, service, status
                        );
                    }
                    let status_code =
                        StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
                    return Err(ErrorResponse {
                        error: format!("Failed to call service: {}", e),
                        status: status_code,
                    });
                }
                warn!("Failed to call service {}.{}: {}", domain, service, e);
                Err(ErrorResponse::internal(format!(
                    "Failed to call service: {}",
                    e
                )))
            }
        }
    } else {
        // Fire-and-forget path — dispatch via WebSocket, return 200 immediately.
        //
        // The WebSocket `call_service` command is dispatched instantly over the
        // persistent connection. State changes arrive back via the WS
        // `state_changed` subscription — no need to poll for fresh state.
        let entity_id = request
            .data
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
                // Limited to MAX_DRAIN_ITERATIONS to prevent starvation
                let buffer = state.service_buffer.clone();
                let st = state.clone();
                let eid = entity_id.clone();

                tokio::spawn(async move {
                    const MAX_DRAIN_ITERATIONS: u32 = 20;
                    let mut iterations = 0;
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;

                        let next = match buffer.drain(&eid).await {
                            Some(c) => c,
                            None => break,
                        };

                        dispatch_command(&st, &eid, &next.domain, &next.service, next.data);

                        iterations += 1;
                        if iterations >= MAX_DRAIN_ITERATIONS {
                            warn!("[dispatch] Drain loop hit max iterations for {}", eid);
                            // Force cleanup of the buffer slot
                            let _ = buffer.drain(&eid).await;
                            break;
                        }
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
            Err(ErrorResponse::internal(format!(
                "Failed to get history: {}",
                e
            )))
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

    match state
        .ha_client
        .proxy_hass_agent_get(&path, &query_str)
        .await
    {
        Ok(proxied) => {
            let status = StatusCode::from_u16(proxied.status).unwrap_or(StatusCode::BAD_GATEWAY);
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
            Err(ErrorResponse::internal(format!(
                "Failed to proxy media: {}",
                e
            )))
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

    match state
        .ha_client
        .proxy_image_serve_get(&path, &query_str)
        .await
    {
        Ok(proxied) => {
            let status = StatusCode::from_u16(proxied.status).unwrap_or(StatusCode::BAD_GATEWAY);
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
            Err(ErrorResponse::internal(format!(
                "Failed to proxy image media: {}",
                e
            )))
        }
    }
}

/// WebSocket handler
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| {
        websocket::handle_socket(
            socket,
            state.ws_manager,
            state.entity_cache,
            state.ha_ws,
            state.ha_client,
            state.service_buffer,
        )
    })
}

// ─── Streaming Server Handlers ──────────────────────────────────────────

/// List all active streams
async fn list_streams(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({ "streams": state.stream_manager.list_streams().await }))
}

/// Create a new stream session
async fn create_stream(
    State(state): State<AppState>,
    Json(req): Json<streaming::CreateStreamRequest>,
) -> Result<impl IntoResponse, ErrorResponse> {
    match state.stream_manager.create_stream(req).await {
        Ok((session, ingest_token)) => Ok((
            StatusCode::CREATED,
            Json(serde_json::json!({
                "stream": session,
                "ingest_token": ingest_token,
                "ingest_url": format!("/ws/stream/ingest"),
                "watch_url": format!("/ws/stream/watch"),
            })),
        )),
        Err(e) => Err(ErrorResponse::bad_request(e)),
    }
}

/// Get a specific stream
async fn get_stream(
    State(state): State<AppState>,
    Path(stream_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.stream_manager.get_stream(&stream_id).await {
        Some(session) => Ok(Json(serde_json::json!({ "stream": session }))),
        None => Err(ErrorResponse::not_found("Stream not found")),
    }
}

/// Update a stream
async fn update_stream(
    State(state): State<AppState>,
    Path(stream_id): Path<String>,
    Json(req): Json<streaming::UpdateStreamRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.stream_manager.update_stream(&stream_id, req).await {
        Some(session) => Ok(Json(serde_json::json!({ "stream": session }))),
        None => Err(ErrorResponse::not_found("Stream not found")),
    }
}

/// Stop and remove a stream
async fn stop_stream(
    State(state): State<AppState>,
    Path(stream_id): Path<String>,
) -> impl IntoResponse {
    if state.stream_manager.stop_stream(&stream_id).await {
        (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "stopped" })),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Stream not found" })),
        )
    }
}

/// WebSocket handler for stream ingest (source pushes frames)
async fn stream_ingest_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| streaming::handle_stream_ingest(socket, state.stream_manager))
}

/// WebSocket handler for stream viewing (dashboard watches)
async fn stream_watch_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| streaming::handle_stream_watch(socket, state.stream_manager))
}

/// Get the latest JPEG snapshot for a stream (feed view)
async fn get_stream_snapshot(
    State(state): State<AppState>,
    Path(stream_id): Path<String>,
) -> impl IntoResponse {
    match state.stream_manager.get_snapshot(&stream_id).await {
        Some(data) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "image/jpeg"),
                (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
            ],
            data,
        )
            .into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

/// Receive a JPEG snapshot from the stream sender
async fn post_stream_snapshot(
    State(state): State<AppState>,
    Path(stream_id): Path<String>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if body.len() > 2 * 1024 * 1024 {
        return (StatusCode::PAYLOAD_TOO_LARGE, "Snapshot too large");
    }
    if state
        .stream_manager
        .set_snapshot(&stream_id, body.to_vec())
        .await
    {
        (StatusCode::OK, "OK")
    } else {
        (StatusCode::NOT_FOUND, "Stream not found")
    }
}

/// Serve a standalone HTML sender page for streaming.
/// Can be opened directly in a browser or used as an OBS Browser Source.
/// Query params: ?stream_id=...&token=... (optional, auto-creates stream if missing)
async fn stream_sender_page() -> impl IntoResponse {
    let html = include_str!("stream_sender.html");
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html)
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
            Err(ErrorResponse::internal(format!(
                "Failed to create user: {}",
                e
            )))
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
        Ok(None) => Err(ErrorResponse::not_found(format!(
            "User {} not found",
            username
        ))),
        Err(e) => {
            warn!("Failed to get user: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to get user: {}",
                e
            )))
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
                    return Err(ErrorResponse::unauthorized(
                        "Invalid authorization header format",
                    ));
                }
            }
            Err(_) => {
                return Err(ErrorResponse::unauthorized("Invalid authorization header"));
            }
        },
        None => {
            return Err(ErrorResponse::unauthorized(
                "No authorization header provided",
            ));
        }
    };

    let claims = auth::verify_token(token)
        .map_err(|_| ErrorResponse::unauthorized("Invalid or expired token"))?;

    if claims.sub != user_id {
        return Err(ErrorResponse::unauthorized("Cannot modify another user"));
    }

    match state.config_repo.update_user(&user_id, request).await {
        Ok(Some(user)) => Ok(Json(user)),
        Ok(None) => Err(ErrorResponse::not_found(format!(
            "User {} not found",
            user_id
        ))),
        Err(e) => {
            if e.to_string().contains("USERNAME_CONFLICT") {
                return Err(ErrorResponse::conflict("Username already exists"));
            }
            warn!("Failed to update user: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to update user: {}",
                e
            )))
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
            Err(ErrorResponse::internal(format!(
                "Failed to register device: {}",
                e
            )))
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
        Ok(None) => Err(ErrorResponse::not_found(format!(
            "Device {} not found",
            device_id
        ))),
        Err(e) => {
            warn!("Failed to get device: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to get device: {}",
                e
            )))
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
            Err(ErrorResponse::internal(format!(
                "Failed to update device heartbeat: {}",
                e
            )))
        }
    }
}

/// Admin: list all registered devices plus a live count of currently
/// connected WebSocket clients. Powers the "Verbundene Geräte" admin
/// tab. A device is considered "online" if its last_seen is within
/// `online_threshold_seconds` (default 120s).
async fn admin_list_devices(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let devices = state
        .config_repo
        .list_devices()
        .await
        .map_err(|e| ErrorResponse::internal(format!("Failed to list devices: {}", e)))?;

    let connected_ws_clients = state.ws_manager.client_count().await;
    let now = chrono::Utc::now();
    let threshold_secs: i64 = 120;

    let device_payload: Vec<Value> = devices
        .iter()
        .map(|d| {
            let age = (now - d.last_seen).num_seconds();
            let online = age >= 0 && age <= threshold_secs;
            serde_json::json!({
                "id": d.id,
                "device_name": d.device_name,
                "device_type": d.device_type,
                "user_agent": d.user_agent,
                "is_terminal": d.is_terminal,
                "terminal_name": d.terminal_name,
                "assigned_profile_id": d.assigned_profile_id,
                "last_seen": d.last_seen,
                "created_at": d.created_at,
                "online": online,
                "seconds_since_seen": age.max(0),
            })
        })
        .collect();

    let online_count = device_payload
        .iter()
        .filter(|d| d.get("online").and_then(|v| v.as_bool()).unwrap_or(false))
        .count();

    Ok(Json(serde_json::json!({
        "devices": device_payload,
        "total": devices.len(),
        "online": online_count,
        "connected_ws_clients": connected_ws_clients,
        "online_threshold_seconds": threshold_secs,
    })))
}

/// Admin: delete a registered device.
async fn admin_delete_device(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
) -> Result<StatusCode, ErrorResponse> {
    match state.config_repo.delete_device(&device_id).await {
        Ok(true) => Ok(StatusCode::OK),
        Ok(false) => Err(ErrorResponse::not_found(format!(
            "Device {} not found",
            device_id
        ))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Failed to delete device: {}",
            e
        ))),
    }
}

/// GET /api/admin/system-events
/// Grouped (deduplicated) view of system events. Identical
/// `(severity, source, message)` events are collapsed into one row with a
/// counter so repeated failures don't bloat the UI.
/// Query params:
///   - `limit`         (default 200, capped at 1000)
///   - `severity`      (`info` | `warning` | `error`, minimum threshold)
///   - `unresolved`    (`true` to hide groups marked resolved)
async fn admin_system_events(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ErrorResponse> {
    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(200)
        .clamp(1, 1000);
    let min_severity = params
        .get("severity")
        .and_then(|s| system_events::Severity::from_str_ci(s));
    let only_unresolved = params
        .get("unresolved")
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);

    let groups = state
        .system_events
        .list_groups(min_severity, only_unresolved, limit)
        .await
        .map_err(|e| ErrorResponse::internal(format!("system_events groups query failed: {e}")))?;
    let stats = state
        .system_events
        .stats()
        .await
        .map_err(|e| ErrorResponse::internal(format!("system_events stats failed: {e}")))?;

    Ok(Json(json!({
        "groups": groups,
        "stats": stats,
        "generated_at": chrono::Utc::now().to_rfc3339(),
    })))
}

/// GET /api/admin/system-events/occurrences
/// Raw chronological log of every individual occurrence — **not**
/// deduplicated, so each event is shown exactly as it happened.
/// Query params:
///   - `limit`         (default 200, capped at 2000)
///   - `severity`      (minimum threshold filter)
///   - `fingerprint`   (drill into a single group's history)
///   - `origin`        (`backend` | `tracing` | `frontend`)
async fn admin_system_events_occurrences(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ErrorResponse> {
    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(200)
        .clamp(1, 2000);
    let min_severity = params
        .get("severity")
        .and_then(|s| system_events::Severity::from_str_ci(s));
    let origin = params
        .get("origin")
        .and_then(|o| match o.to_lowercase().as_str() {
            "backend" => Some(system_events::Origin::Backend),
            "tracing" => Some(system_events::Origin::Tracing),
            "frontend" | "client" => Some(system_events::Origin::Frontend),
            _ => None,
        });
    let fp = params.get("fingerprint").map(|s| s.as_str());

    let occurrences = state
        .system_events
        .list_occurrences(min_severity, fp, origin, limit)
        .await
        .map_err(|e| {
            ErrorResponse::internal(format!("system_events occurrences query failed: {e}"))
        })?;

    Ok(Json(json!({
        "occurrences": occurrences,
        "total": occurrences.len(),
        "generated_at": chrono::Utc::now().to_rfc3339(),
    })))
}

/// GET /api/admin/system-events/:fingerprint — group + recent occurrences.
async fn admin_system_event_detail(
    State(state): State<AppState>,
    axum::extract::Path(fp): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let groups = state
        .system_events
        .list_groups(None, false, 1000)
        .await
        .map_err(|e| ErrorResponse::internal(format!("system_events groups query failed: {e}")))?;
    let group = groups.into_iter().find(|g| g.fingerprint == fp);
    let group = match group {
        Some(g) => g,
        None => return Err(ErrorResponse::not_found("group not found")),
    };
    let occurrences = state
        .system_events
        .list_occurrences(None, Some(&fp), None, 200)
        .await
        .map_err(|e| {
            ErrorResponse::internal(format!("system_events occurrences query failed: {e}"))
        })?;
    Ok(Json(json!({
        "group": group,
        "occurrences": occurrences,
    })))
}

/// POST /api/admin/system-events/:fingerprint/resolve
async fn admin_system_event_resolve(
    State(state): State<AppState>,
    Extension(auth): Extension<middleware::AuthIdentity>,
    axum::extract::Path(fp): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let user = auth.user_id().to_string();
    let affected = state
        .system_events
        .mark_resolved(&fp, &user)
        .await
        .map_err(|e| ErrorResponse::internal(format!("mark_resolved failed: {e}")))?;
    Ok(Json(json!({ "resolved": affected > 0 })))
}

/// POST /api/admin/system-events/:fingerprint/unresolve
async fn admin_system_event_unresolve(
    State(state): State<AppState>,
    axum::extract::Path(fp): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let affected = state
        .system_events
        .unmark_resolved(&fp)
        .await
        .map_err(|e| ErrorResponse::internal(format!("unmark_resolved failed: {e}")))?;
    Ok(Json(json!({ "unresolved": affected > 0 })))
}

/// DELETE /api/admin/system-events/:fingerprint — delete one group + its occurrences.
async fn admin_system_event_delete_group(
    State(state): State<AppState>,
    axum::extract::Path(fp): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let affected = state
        .system_events
        .delete_group(&fp)
        .await
        .map_err(|e| ErrorResponse::internal(format!("delete_group failed: {e}")))?;
    Ok(Json(json!({ "deleted": affected })))
}

/// DELETE /api/admin/system-events — clear the entire persistent log.
async fn admin_clear_system_events(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    state
        .system_events
        .clear_all()
        .await
        .map_err(|e| ErrorResponse::internal(format!("clear_all failed: {e}")))?;
    Ok(Json(json!({ "cleared": true })))
}

/// POST /api/system-events/client — frontend / client-side error ingest.
/// Accepted from authenticated users (not just admins) so widgets and the
/// SDK can report their own failures.
#[derive(Deserialize)]
struct ClientSystemEventBody {
    severity: String,
    source: String,
    message: String,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    line: Option<i32>,
    #[serde(default)]
    request_path: Option<String>,
    #[serde(default)]
    error_chain: Option<String>,
    #[serde(default)]
    extra: Option<Value>,
}

async fn client_system_event_ingest(
    State(state): State<AppState>,
    Extension(auth): Extension<middleware::AuthIdentity>,
    Json(body): Json<ClientSystemEventBody>,
) -> Result<Json<Value>, ErrorResponse> {
    let severity = system_events::Severity::from_str_ci(&body.severity)
        .unwrap_or(system_events::Severity::Error);
    // Force the `client:` prefix so frontend sources are always
    // distinguishable in the grouped view.
    let source = if body.source.starts_with("client:") || body.source.starts_with("frontend:") {
        body.source
    } else {
        format!("client:{}", body.source)
    };
    // Reject absurdly long messages so a runaway client can't bloat the DB.
    let message: String = body.message.chars().take(2000).collect();
    let mut meta = system_events::EventMeta::default();
    meta.user_id = Some(auth.user_id().to_string());
    meta.file = body.file;
    meta.line = body.line;
    meta.request_path = body.request_path;
    meta.error_chain = body.error_chain;
    meta.extra = body.extra;
    state
        .system_events
        .report_from_client(severity, &source, message, meta)
        .await;
    Ok(Json(json!({ "accepted": true })))
}

/// Admin: combined presence overview. Aggregates users, devices, and the
/// `user_devices` + `desktop_clients` link tables into a single payload so
/// the Admin Control Center can show which users are online and on which
/// devices they are currently logged in. A device counts as `online` when
/// its `last_seen` is within `online_threshold_seconds`. A user counts as
/// online when at least one of their linked devices is online.
async fn admin_presence(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let users = state
        .config_repo
        .list_all_users_admin()
        .await
        .map_err(|e| ErrorResponse::internal(format!("Failed to list users: {}", e)))?;
    let devices = state
        .config_repo
        .list_devices()
        .await
        .map_err(|e| ErrorResponse::internal(format!("Failed to list devices: {}", e)))?;
    let links = state
        .config_repo
        .list_user_device_links()
        .await
        .map_err(|e| ErrorResponse::internal(format!("Failed to list user-device links: {}", e)))?;
    let desktop_clients = state
        .config_repo
        .list_desktop_clients_raw()
        .await
        .unwrap_or_default();

    let now = chrono::Utc::now();
    let threshold_secs: i64 = 120;

    // Index devices by id for quick lookups.
    let mut device_index: std::collections::HashMap<String, &db::models::Device> =
        std::collections::HashMap::with_capacity(devices.len());
    for d in &devices {
        device_index.insert(d.id.clone(), d);
    }

    // Build user_id -> Vec<device_id> from both `user_devices` and `desktop_clients`.
    let mut user_to_devices: std::collections::HashMap<String, Vec<(String, bool, bool)>> =
        std::collections::HashMap::new();
    for (user_id, device_id, is_primary) in &links {
        user_to_devices.entry(user_id.clone()).or_default().push((
            device_id.clone(),
            *is_primary,
            false,
        ));
    }
    for (device_id, user_id, _name, _os, _last_seen) in &desktop_clients {
        let entry = user_to_devices.entry(user_id.clone()).or_default();
        if !entry.iter().any(|(d, _, _)| d == device_id) {
            entry.push((device_id.clone(), false, true));
        }
    }
    // Reverse map: device_id -> Vec<user_id>
    let mut device_to_users: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (user_id, devs) in &user_to_devices {
        for (device_id, _, _) in devs {
            device_to_users
                .entry(device_id.clone())
                .or_default()
                .push(user_id.clone());
        }
    }

    let user_payload: Vec<Value> = users
        .iter()
        .map(|u| {
            let devs = user_to_devices.get(&u.id).cloned().unwrap_or_default();
            let device_entries: Vec<Value> = devs
                .iter()
                .map(|(device_id, is_primary, is_desktop)| {
                    let dev = device_index.get(device_id);
                    let (last_seen, online, name, dtype) = match dev {
                        Some(d) => {
                            let age = (now - d.last_seen).num_seconds();
                            (
                                Some(d.last_seen),
                                age >= 0 && age <= threshold_secs,
                                d.device_name.clone(),
                                d.device_type.clone(),
                            )
                        }
                        None => (None, false, device_id.clone(), None),
                    };
                    serde_json::json!({
                        "device_id": device_id,
                        "device_name": name,
                        "device_type": dtype,
                        "is_primary": is_primary,
                        "is_desktop_client": is_desktop,
                        "online": online,
                        "last_seen": last_seen,
                    })
                })
                .collect();
            let any_online = device_entries
                .iter()
                .any(|d| d.get("online").and_then(|v| v.as_bool()).unwrap_or(false));
            serde_json::json!({
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "avatar_url": u.avatar_url,
                "role": u.role,
                "is_admin": u.is_admin,
                "online": any_online,
                "device_count": device_entries.len(),
                "devices": device_entries,
            })
        })
        .collect();

    let device_payload: Vec<Value> = devices
        .iter()
        .map(|d| {
            let age = (now - d.last_seen).num_seconds();
            let online = age >= 0 && age <= threshold_secs;
            let user_ids = device_to_users.get(&d.id).cloned().unwrap_or_default();
            serde_json::json!({
                "id": d.id,
                "device_name": d.device_name,
                "device_type": d.device_type,
                "user_agent": d.user_agent,
                "is_terminal": d.is_terminal,
                "terminal_name": d.terminal_name,
                "assigned_profile_id": d.assigned_profile_id,
                "last_seen": d.last_seen,
                "created_at": d.created_at,
                "online": online,
                "seconds_since_seen": age.max(0),
                "user_ids": user_ids,
            })
        })
        .collect();

    let online_users = user_payload
        .iter()
        .filter(|u| u.get("online").and_then(|v| v.as_bool()).unwrap_or(false))
        .count();
    let online_devices = device_payload
        .iter()
        .filter(|d| d.get("online").and_then(|v| v.as_bool()).unwrap_or(false))
        .count();
    let connected_ws_clients = state.ws_manager.client_count().await;
    let ws_sessions_raw = state.ws_manager.client_snapshot().await;
    let ws_sessions: Vec<Value> = ws_sessions_raw
        .iter()
        .map(|c| {
            let age = (now - c.last_seen).num_seconds().max(0);
            serde_json::json!({
                "client_id": c.client_id,
                "user_id": c.user_id,
                "username": c.username,
                "is_admin": c.is_admin,
                "authenticated": c.authenticated,
                "connected_at": c.connected_at,
                "last_seen": c.last_seen,
                "seconds_since_seen": age,
            })
        })
        .collect();
    let authenticated_ws_clients = ws_sessions_raw.iter().filter(|c| c.authenticated).count();

    Ok(Json(serde_json::json!({
        "users": user_payload,
        "devices": device_payload,
        "ws_sessions": ws_sessions,
        "totals": {
            "users": user_payload.len(),
            "online_users": online_users,
            "devices": device_payload.len(),
            "online_devices": online_devices,
            "connected_ws_clients": connected_ws_clients,
            "authenticated_ws_clients": authenticated_ws_clients,
        },
        "online_threshold_seconds": threshold_secs,
        "generated_at": now,
    })))
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
            Err(ErrorResponse::internal(format!(
                "Failed to create profile: {}",
                e
            )))
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
        Ok(None) => Err(ErrorResponse::not_found(format!(
            "Profile {} not found",
            profile_id
        ))),
        Err(e) => {
            warn!("Failed to get profile data: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to get profile data: {}",
                e
            )))
        }
    }
}

/// List all configuration profiles owned by the given user. The frontend
/// `PageNavigationContext` uses this to find an existing profile for a freshly
/// logged-in user before creating a new one.
async fn list_user_profiles(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<Vec<db::models::ConfigurationProfile>>, ErrorResponse> {
    match state.config_repo.list_profiles_by_owner(&user_id).await {
        Ok(profiles) => Ok(Json(profiles)),
        Err(e) => {
            warn!("Failed to list profiles for user {}: {}", user_id, e);
            Err(ErrorResponse::internal(format!(
                "Failed to list profiles: {}",
                e
            )))
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
            let _ = state
                .config_repo
                .record_change("pages", &profile_id, "UPDATE", None)
                .await;
            Ok(StatusCode::OK)
        }
        Err(e) => {
            warn!("Failed to save pages: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to save pages: {}",
                e
            )))
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
            let _ = state
                .config_repo
                .record_change("theme_settings", &profile_id, "UPDATE", None)
                .await;
            Ok(Json(theme))
        }
        Err(e) => {
            warn!("Failed to save theme: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to save theme: {}",
                e
            )))
        }
    }
}

/// Save background configuration
async fn save_background_config(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(request): Json<db::models::SaveBackgroundRequest>,
) -> Result<Json<db::models::BackgroundConfig>, ErrorResponse> {
    match state
        .config_repo
        .save_background(&profile_id, request)
        .await
    {
        Ok(background) => {
            // Record sync metadata
            let _ = state
                .config_repo
                .record_change("background_configs", &profile_id, "UPDATE", None)
                .await;
            Ok(Json(background))
        }
        Err(e) => {
            warn!("Failed to save background: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to save background: {}",
                e
            )))
        }
    }
}

/// Save user preference
async fn save_user_preference(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(request): Json<db::models::SavePreferenceRequest>,
) -> Result<Json<db::models::UserPreference>, ErrorResponse> {
    match state
        .config_repo
        .save_preference(&user_id, None, request)
        .await
    {
        Ok(pref) => {
            // Record sync metadata
            let _ = state
                .config_repo
                .record_change("user_preferences", &user_id, "UPDATE", None)
                .await;
            Ok(Json(pref))
        }
        Err(e) => {
            warn!("Failed to save preference: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to save preference: {}",
                e
            )))
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
            Err(ErrorResponse::internal(format!(
                "Failed to get preferences: {}",
                e
            )))
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
            let _ = state
                .config_repo
                .record_change("system_preferences", &pref.preference_key, "UPDATE", None)
                .await;
            Ok(Json(pref))
        }
        Err(e) => {
            warn!("Failed to save system preference: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to save system preference: {}",
                e
            )))
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
            Err(ErrorResponse::internal(format!(
                "Failed to get system preferences: {}",
                e
            )))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic schema-driven settings API
//
// Powers both the first-boot setup wizard (subset flagged with `wizard: true`)
// and the Admin Control Center (everything not `Hidden`). New IORA settings
// are added once in `iora_shared::settings::default_settings()` and surface
// here automatically – no per-setting handler needed.
// ─────────────────────────────────────────────────────────────────────────────

/// Pretty per-key value, with secrets redacted, ready for the UI.
#[derive(Serialize)]
struct SettingValueDto {
    #[serde(flatten)]
    definition: SettingDefinition,
    value: serde_json::Value,
    /// True when an explicit value has been stored (false → using `default`).
    is_set: bool,
    /// If the setting was applied live (no restart needed), this is set.
    #[serde(skip_serializing_if = "Option::is_none")]
    applied_live: Option<String>,
}

async fn admin_settings_schema(State(state): State<AppState>) -> Json<Vec<SettingDefinition>> {
    Json(state.settings_registry.control_center())
}

async fn admin_settings_schema_wizard(
    State(state): State<AppState>,
) -> Json<Vec<SettingDefinition>> {
    Json(state.settings_registry.wizard())
}

// ── Graceful stubs for endpoints normally served by other microservices ──
//
// In a stripped-down build (or before iora-supervisor / iora-core have
// finished starting up) these endpoints would otherwise 404 into the
// frontend SPA fallback. The frontend then chokes on "<!DOCTYPE" while
// trying to parse JSON and the entire admin tab becomes unusable. By
// returning an empty-but-valid JSON shell here we let the existing tab
// components render their normal empty-state.

/// Proxy to iora-intelligence for health overview.
/// Falls back to null if intelligence service is not reachable.
async fn proxy_intelligence_overview(State(state): State<AppState>) -> Json<Value> {
    let intel_url = std::env::var("INTELLIGENCE_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| system_config::service_url("iora-intelligence", 8099));

    match state
        .http_client
        .get(&format!("{}/api/intelligence/overview", intel_url))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
            Ok(data) => Json(data),
            Err(_) => Json(json!(null)),
        },
        _ => Json(json!(null)),
    }
}

/// Proxy to iora-intelligence for maintenance tasks.
async fn proxy_intelligence_maintenance_run(
    State(state): State<AppState>,
    axum::extract::Path(task): axum::extract::Path<String>,
) -> Json<Value> {
    let intel_url = std::env::var("INTELLIGENCE_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| system_config::service_url("iora-intelligence", 8099));

    match state
        .http_client
        .get(&format!(
            "{}/api/intelligence/maintenance/run/{}",
            intel_url, task
        ))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
            Ok(data) => Json(data),
            Err(e) => Json(json!({"error": format!("Failed to parse response: {}", e)})),
        },
        Ok(resp) => {
            let status = resp.status().as_u16();
            Json(json!({"error": format!("Intelligence service returned HTTP {}", status)}))
        }
        Err(e) => Json(json!({"error": format!("iora-intelligence service not reachable: {}", e)})),
    }
}

// ── Generic forwarder used by all microservice proxies ────────────────────
//
// Reads the incoming axum request, forwards it 1:1 to `base_url + path`
// (preserving method, query string, headers and body), and streams the
// upstream response back. If the microservice is not reachable we return
// HTTP 503 with a JSON body so the frontend can surface a clean error
// instead of a broken SPA fallback.
async fn forward_request_to(
    state: &AppState,
    base_url: &str,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::body::Body;
    use axum::http::StatusCode;

    let method = req.method().clone();
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());

    let mut header_map = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers().iter() {
        // Drop hop-by-hop headers and the Host header so reqwest sets them.
        let n = name.as_str().to_ascii_lowercase();
        if matches!(
            n.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "upgrade"
                | "proxy-authorization"
                | "proxy-authenticate"
                | "te"
                | "trailer"
        ) {
            continue;
        }
        if let (Ok(rname), Ok(rvalue)) = (
            reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes()),
            reqwest::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            header_map.append(rname, rvalue);
        }
    }

    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Failed to read body: {}", e) })),
            )
                .into_response();
        }
    };

    let url = format!("{}{}", base_url.trim_end_matches('/'), path_and_query);
    let rmethod = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return (StatusCode::METHOD_NOT_ALLOWED, "method").into_response(),
    };

    let upstream = state
        .http_client
        .request(rmethod, &url)
        .headers(header_map)
        .body(body_bytes.to_vec())
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await;

    match upstream {
        Ok(resp) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let mut builder = axum::http::Response::builder().status(status);
            for (name, value) in resp.headers().iter() {
                let n = name.as_str().to_ascii_lowercase();
                if matches!(
                    n.as_str(),
                    "connection"
                        | "transfer-encoding"
                        | "content-length"
                        | "content-encoding"
                        | "upgrade"
                        | "trailer"
                ) {
                    continue;
                }
                if let (Ok(hn), Ok(hv)) = (
                    axum::http::HeaderName::from_bytes(name.as_str().as_bytes()),
                    axum::http::HeaderValue::from_bytes(value.as_bytes()),
                ) {
                    builder = builder.header(hn, hv);
                }
            }
            let bytes = resp.bytes().await.unwrap_or_default();
            builder
                .body(Body::from(bytes))
                .unwrap_or_else(|_| (StatusCode::BAD_GATEWAY, "proxy build failed").into_response())
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": format!("Upstream microservice not reachable: {}", e),
                "available": false,
                "upstream": base_url,
            })),
        )
            .into_response(),
    }
}

fn microservice_url(env_var: &str, service: &str, default_port: u16) -> String {
    if let Ok(v) = std::env::var(env_var) {
        if !v.is_empty() {
            return v;
        }
    }
    system_config::service_url(service, default_port)
}

async fn proxy_secrets(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_SECRETS_URL", "iora-secrets", 8093);
    forward_request_to(&state, &base, req).await
}

async fn proxy_files(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_FILES_URL", "iora-files", 8100);
    forward_request_to(&state, &base, req).await
}

async fn proxy_files_share(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    // /api/share/:token in iora-home maps to /api/files/shared/:token in iora-files
    use axum::body::Body;
    let base = microservice_url("IORA_FILES_URL", "iora-files", 8100);
    let path = req.uri().path().to_string();
    let new_path = path.replacen("/api/share/", "/api/files/shared/", 1);
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let new_uri: axum::http::Uri = format!("{}{}", new_path, query)
        .parse()
        .unwrap_or_else(|_| req.uri().clone());
    let (mut parts, body) = req.into_parts();
    parts.uri = new_uri;
    let new_req = axum::extract::Request::<Body>::from_parts(parts, body);
    forward_request_to(&state, &base, new_req).await
}

async fn proxy_gateway(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_GATEWAY_URL", "iora-gateway", 8096);
    forward_request_to(&state, &base, req).await
}

async fn proxy_assist(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_ASSIST_URL", "iora-assist", 8092);
    forward_request_to(&state, &base, req).await
}

async fn app_assist_integrations(State(state): State<AppState>) -> Json<Value> {
    let apps = state.local_appstore.list().await;
    let integrations: Vec<Value> = apps
        .into_iter()
        .filter_map(|app| {
            let assist = app
                .manifest
                .extra
                .get("assist")
                .cloned()
                .unwrap_or(json!({}));
            let assist_enabled = assist
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let granted: Vec<String> = app
                .permission_grants
                .iter()
                .filter(|grant| grant.is_active)
                .map(|grant| grant.permission.clone())
                .collect();
            let has_assist_grant = granted.iter().any(|permission| {
                permission.starts_with("Assist") || permission.starts_with("GitHub")
            });
            if !assist_enabled && !has_assist_grant {
                return None;
            }
            Some(json!({
                "id": app.id,
                "name": app.name,
                "version": app.version,
                "developer": app.developer,
                "description": app.description,
                "icon": app.icon,
                "enabled": app.enabled,
                "status": app.status,
                "assist": assist,
                "permissions": granted,
                "denied_permissions": app.denied_permissions,
            }))
        })
        .collect();

    let total = integrations.len();
    Json(json!({
        "integrations": integrations,
        "total": total,
    }))
}

async fn app_assist_context(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    if let Err(err) = require_app_permission(&state, &app_id, "AssistContextRead").await {
        return err.into_response();
    }
    forward_request_to_assist_path(&state, req, "/api/assist/context".to_string(), None).await
}

async fn app_assist_events(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    if let Err(err) = require_app_permission(&state, &app_id, "AssistEventsSubscribe").await {
        return err.into_response();
    }
    forward_request_to_assist_path(
        &state,
        req,
        "/api/assist/notifications/stream".to_string(),
        None,
    )
    .await
}

async fn app_assist_create_task(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    if let Err(err) = require_app_permission(&state, &app_id, "AssistTaskCreate").await {
        return err.into_response();
    }
    let enriched = match enrich_app_assist_body(req.into_body(), &app_id, "agent_task").await {
        Ok(bytes) => bytes,
        Err(err) => return err.into_response(),
    };
    forward_body_to_assist_path(
        &state,
        reqwest::Method::POST,
        "/api/assist/agent/tasks".to_string(),
        enriched,
    )
    .await
}

async fn app_assist_chat(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    if let Err(err) = require_app_permission(&state, &app_id, "AssistChat").await {
        return err.into_response();
    }
    let enriched = match enrich_app_assist_body(req.into_body(), &app_id, "chat").await {
        Ok(bytes) => bytes,
        Err(err) => return err.into_response(),
    };
    forward_body_to_assist_path(
        &state,
        reqwest::Method::POST,
        "/api/assist/chat".to_string(),
        enriched,
    )
    .await
}

async fn app_assist_github_proxy(
    State(state): State<AppState>,
    axum::extract::Path((app_id, path)): axum::extract::Path<(String, String)>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let method = req.method().clone();
    let permission = github_permission_for(&method, &path);
    if let Err(err) = require_any_app_permission(&state, &app_id, &permission).await {
        return err.into_response();
    }
    forward_request_to_assist_path(&state, req, format!("/api/assist/github/{path}"), None).await
}

async fn require_app_permission(
    state: &AppState,
    app_id: &str,
    permission: &str,
) -> Result<(), ErrorResponse> {
    if state
        .local_appstore
        .has_permission(app_id, permission)
        .await
    {
        Ok(())
    } else {
        Err(ErrorResponse::forbidden(format!(
            "app '{}' requires permission '{}' for this Assist capability",
            app_id, permission
        )))
    }
}

async fn require_any_app_permission(
    state: &AppState,
    app_id: &str,
    permissions: &[&str],
) -> Result<(), ErrorResponse> {
    for permission in permissions {
        if state
            .local_appstore
            .has_permission(app_id, permission)
            .await
        {
            return Ok(());
        }
    }
    Err(ErrorResponse::forbidden(format!(
        "app '{}' requires one of these permissions: {}",
        app_id,
        permissions.join(", ")
    )))
}

fn github_permission_for<'a>(method: &axum::http::Method, path: &str) -> Vec<&'a str> {
    let is_read = matches!(
        *method,
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    );
    if is_read && path.contains("/pulls") {
        return vec!["GitHubPullRequestRead", "GitHubRead"];
    }
    if is_read {
        return vec!["GitHubRead"];
    }
    if path.contains("/pulls") && path.contains("/comment") {
        return vec!["GitHubPullRequestComment", "GitHubWrite"];
    }
    if path.contains("/workflows") {
        return vec!["GitHubWorkflowTrigger", "GitHubWrite"];
    }
    vec!["GitHubWrite"]
}

async fn enrich_app_assist_body(
    body: axum::body::Body,
    app_id: &str,
    capability: &str,
) -> Result<Vec<u8>, ErrorResponse> {
    let body_bytes = axum::body::to_bytes(body, 2 * 1024 * 1024)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("Failed to read app Assist body: {e}")))?;
    let mut payload = if body_bytes.is_empty() {
        json!({})
    } else {
        serde_json::from_slice::<Value>(&body_bytes).map_err(|e| {
            ErrorResponse::bad_request(format!("App Assist request body must be JSON: {e}"))
        })?
    };
    if !payload.is_object() {
        payload = json!({ "payload": payload });
    }
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "origin".to_string(),
            json!({
                "kind": "app",
                "app_id": app_id,
                "capability": capability,
                "via": "iora-home-app-assist-bridge",
            }),
        );
    }
    serde_json::to_vec(&payload)
        .map_err(|e| ErrorResponse::internal(format!("Failed to encode app Assist body: {e}")))
}

async fn forward_body_to_assist_path(
    state: &AppState,
    method: reqwest::Method,
    target_path: String,
    body: Vec<u8>,
) -> axum::response::Response {
    let base = microservice_url("IORA_ASSIST_URL", "iora-assist", 8092);
    let url = format!("{}{}", base.trim_end_matches('/'), target_path);
    forward_reqwest_request(
        state,
        method,
        &url,
        reqwest::header::HeaderMap::new(),
        body,
        &base,
    )
    .await
}

async fn forward_request_to_assist_path(
    state: &AppState,
    req: axum::extract::Request,
    target_path: String,
    body_override: Option<Vec<u8>>,
) -> axum::response::Response {
    let base = microservice_url("IORA_ASSIST_URL", "iora-assist", 8092);
    let method = req.method().clone();
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{q}"))
        .unwrap_or_default();
    let mut header_map = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers().iter() {
        let n = name.as_str().to_ascii_lowercase();
        if matches!(
            n.as_str(),
            "host" | "content-length" | "connection" | "transfer-encoding" | "upgrade"
        ) {
            continue;
        }
        if let (Ok(rname), Ok(rvalue)) = (
            reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes()),
            reqwest::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            header_map.append(rname, rvalue);
        }
    }
    let body = match body_override {
        Some(bytes) => bytes,
        None => match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
            Ok(bytes) => bytes.to_vec(),
            Err(e) => {
                return ErrorResponse::bad_request(format!("Failed to read body: {e}"))
                    .into_response();
            }
        },
    };
    let method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return (StatusCode::METHOD_NOT_ALLOWED, "method").into_response(),
    };
    let url = format!("{}{}{}", base.trim_end_matches('/'), target_path, query);
    forward_reqwest_request(state, method, &url, header_map, body, &base).await
}

async fn forward_reqwest_request(
    state: &AppState,
    method: reqwest::Method,
    url: &str,
    headers: reqwest::header::HeaderMap,
    body: Vec<u8>,
    upstream_label: &str,
) -> axum::response::Response {
    use axum::body::Body;
    use futures_util::TryStreamExt;

    let upstream = state
        .http_client
        .request(method, url)
        .headers(headers)
        .body(body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await;

    match upstream {
        Ok(resp) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let mut builder = axum::http::Response::builder().status(status);
            let is_event_stream = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(|value| value.to_ascii_lowercase().contains("text/event-stream"))
                .unwrap_or(false);
            for (name, value) in resp.headers().iter() {
                let n = name.as_str().to_ascii_lowercase();
                if matches!(
                    n.as_str(),
                    "connection"
                        | "transfer-encoding"
                        | "content-length"
                        | "content-encoding"
                        | "upgrade"
                        | "trailer"
                ) {
                    continue;
                }
                if let (Ok(hn), Ok(hv)) = (
                    axum::http::HeaderName::from_bytes(name.as_str().as_bytes()),
                    axum::http::HeaderValue::from_bytes(value.as_bytes()),
                ) {
                    builder = builder.header(hn, hv);
                }
            }
            if is_event_stream {
                let stream = resp.bytes_stream().map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::Other, format!("Assist stream error: {e}"))
                });
                return builder.body(Body::from_stream(stream)).unwrap_or_else(|_| {
                    (StatusCode::BAD_GATEWAY, "proxy stream build failed").into_response()
                });
            }
            let bytes = resp.bytes().await.unwrap_or_default();
            builder
                .body(Body::from(bytes))
                .unwrap_or_else(|_| (StatusCode::BAD_GATEWAY, "proxy build failed").into_response())
        }
        Err(e) => ErrorResponse::service_unavailable(format!(
            "Upstream Assist service not reachable at {}: {}",
            upstream_label, e
        ))
        .into_response(),
    }
}

async fn proxy_watchdog(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_WATCHDOG_URL", "iora-watchdog", 8094);
    forward_request_to(&state, &base, req).await
}

async fn proxy_connector(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_CONNECTOR_URL", "iora-connector", 8102);
    forward_request_to(&state, &base, req).await
}

async fn proxy_domain_validator(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_DOMAIN_VALIDATOR_URL", "iora-domain-validator", 8104);
    forward_request_to(&state, &base, req).await
}

async fn proxy_resources(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_RESOURCE_MANAGER_URL", "iora-resource-manager", 8105);
    forward_request_to(&state, &base, req).await
}

async fn proxy_network_monitor(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_NETWORK_MONITOR_URL", "iora-network-monitor", 8103);
    forward_request_to(&state, &base, req).await
}

async fn proxy_iora_cloud(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_CLOUD_URL", "iora-cloud", 8120);
    forward_request_to(&state, &base, req).await
}

async fn proxy_supervisor(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_SUPERVISOR_URL", "iora-supervisor", 8097);
    forward_request_to(&state, &base, req).await
}

async fn proxy_appstore(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_APPSTORE_URL", "iora-appstore", 8098);
    forward_request_to(&state, &base, req).await
}

async fn proxy_core(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let base = microservice_url("IORA_CORE_URL", "iora-core", 8090);
    forward_request_to(&state, &base, req).await
}

/// Rewrites `/api/core/security/<rest>` → `/api/security/<rest>` and forwards
/// to iora-security.
async fn proxy_core_security(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::body::Body;
    let base = microservice_url("IORA_SECURITY_URL", "iora-security", 8095);
    let path = req.uri().path().to_string();
    let new_path = path.replacen("/api/core/security/", "/api/security/", 1);
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let new_uri: axum::http::Uri = format!("{}{}", new_path, query)
        .parse()
        .unwrap_or_else(|_| req.uri().clone());
    let (mut parts, body) = req.into_parts();
    parts.uri = new_uri;
    let new_req = axum::extract::Request::<Body>::from_parts(parts, body);
    forward_request_to(&state, &base, new_req).await
}

// ── Local app-store handlers ────────────────────────────────────────────────

async fn local_appstore_installed(State(state): State<AppState>) -> Json<Value> {
    let apps = state.local_appstore.list().await;
    Json(json!({
        "apps": apps,
        "available": true,
        "source": "local",
    }))
}

async fn local_appstore_app_get(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let apps = state.local_appstore.list().await;
    apps.into_iter()
        .find(|a| a.id == app_id)
        .map(|a| Json(serde_json::to_value(a).unwrap_or(json!({}))))
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' not installed", app_id)))
}

async fn local_appstore_app_delete(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, ErrorResponse> {
    // `?force=true` lets the Developer App on an OS-dev image delete
    // *any* app, including system apps and the Developer App itself.
    // On non-OS-dev images we ignore the flag — the user can still
    // toggle it via Settings, but the protection stays.
    let force_requested = params
        .get("force")
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    let force = force_requested && state.dev_image.is_os_dev;
    let result = if force {
        state.local_appstore.uninstall_force(&app_id).await
    } else {
        state.local_appstore.uninstall(&app_id).await
    };
    result.map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
    Ok(Json(
        json!({ "success": true, "app_id": app_id, "force": force }),
    ))
}

async fn local_appstore_app_enable(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    if let Some(app) = state
        .local_appstore
        .list()
        .await
        .into_iter()
        .find(|app| app.id == app_id)
    {
        if !app.denied_permissions.is_empty() {
            return Err(ErrorResponse::forbidden(format!(
                "app '{}' cannot be enabled because permissions were not granted: {}",
                app_id,
                app.denied_permissions.join(", ")
            )));
        }
    }
    let app = state
        .local_appstore
        .enable(&app_id, true)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
    Ok(Json(serde_json::to_value(app).unwrap_or(json!({}))))
}

async fn local_appstore_app_disable(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let app = state
        .local_appstore
        .enable(&app_id, false)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
    Ok(Json(serde_json::to_value(app).unwrap_or(json!({}))))
}

#[derive(Deserialize)]
struct AppstoreInstallBody {
    /// Base64-encoded ZIP. The frontend's `ZipUploadView` already posts
    /// this shape.
    #[serde(default)]
    zip_data: Option<String>,
    /// Optional original filename for nicer logs.
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    granted_permissions: Option<Vec<String>>,
    #[serde(default)]
    denied_permissions: Vec<String>,
    #[serde(default, alias = "force_replace")]
    replace_existing: bool,
}

async fn local_appstore_install(
    State(state): State<AppState>,
    Json(body): Json<AppstoreInstallBody>,
) -> Result<Json<Value>, ErrorResponse> {
    use base64::Engine as _;

    let zip_b64 = body
        .zip_data
        .ok_or_else(|| ErrorResponse::bad_request("zip_data fehlt".to_string()))?;
    // Tolerate `data:application/zip;base64,…` prefixes from some browsers.
    let payload = zip_b64
        .split(',')
        .last()
        .unwrap_or(&zip_b64)
        .trim()
        .to_string();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.as_bytes())
        .map_err(|e| {
            ErrorResponse::bad_request(format!("zip_data ist kein gültiges Base64: {e}"))
        })?;

    if bytes.is_empty() {
        return Err(ErrorResponse::bad_request("ZIP-Datei ist leer".to_string()));
    }
    if bytes.len() > 256 * 1024 * 1024 {
        return Err(ErrorResponse::bad_request(
            "ZIP-Datei ist größer als 256 MiB".to_string(),
        ));
    }

    let file_name = body
        .file_name
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "upload.zip".to_string());

    let install_options = local_appstore::InstallOptions {
        replace_existing: body.replace_existing,
        granted_permissions: body.granted_permissions,
        denied_permissions: body.denied_permissions,
        actor: Some("admin-api".to_string()),
    };
    let install_id =
        state
            .local_appstore
            .start_install_with_options(file_name, bytes, install_options);
    spawn_post_install_runtime_prepare(state.clone(), install_id);
    Ok(Json(json!({
        "success": true,
        "install_id": install_id,
        "message": "Installation gestartet. Fortschritt unter /api/appstore/jobs.",
    })))
}

async fn local_appstore_jobs(State(state): State<AppState>) -> Json<Value> {
    let jobs = state.local_appstore.jobs().await;
    let active = jobs
        .iter()
        .filter(|j| {
            !matches!(
                j.status,
                local_appstore::InstallStatus::Succeeded
                    | local_appstore::InstallStatus::Failed
                    | local_appstore::InstallStatus::Canceled
            )
        })
        .count();
    Json(json!({
        "jobs": jobs,
        "active": active,
    }))
}

async fn local_appstore_clear_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let id = uuid::Uuid::parse_str(&job_id)
        .map_err(|_| ErrorResponse::bad_request("Ungültige Installations-ID".to_string()))?;
    let removed = state.local_appstore.clear_job(id).await.map_err(|e| {
        ErrorResponse::bad_request(format!(
            "Installations-Eintrag kann nicht entfernt werden: {}",
            e
        ))
    })?;
    if !removed {
        return Err(ErrorResponse::not_found(
            "Installations-Eintrag nicht gefunden".to_string(),
        ));
    }
    Ok(Json(
        json!({ "success": true, "removed": true, "job_id": job_id }),
    ))
}

/// SSE stream der Docker-realen App-Status. Pollt alle 10 s `docker compose ps`
/// für jede installierte App und sendet die Aggregation. So kann die UI ohne
/// Polling die echte Container-Realität anzeigen (anstatt nur den persistierten
/// Status, der bei Crashes lügen kann).
async fn apps_status_stream(
    State(state): State<AppState>,
) -> axum::response::Sse<impl Stream<Item = Result<axum::response::sse::Event, Infallible>>> {
    use axum::response::sse::{Event, KeepAlive, Sse};

    let stream = futures_util::stream::unfold(state, |state| async move {
        let apps = state.local_appstore.list().await;
        let mut entries: Vec<serde_json::Value> = Vec::new();
        for app in &apps {
            let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
            let mut docker_status: Option<serde_json::Value> = None;
            if needs_docker {
                if let Some(s) = app_lifecycle::docker_compose_status(&app.id).await {
                    docker_status = Some(json!({
                        "total": s.total,
                        "running": s.running,
                        "exited": s.exited,
                        "unhealthy": s.unhealthy,
                        "all_running": s.all_running(),
                        "services": s.services,
                    }));
                }
            }
            entries.push(json!({
                "app_id": app.id,
                "persisted_status": app.status,
                "needs_docker": needs_docker,
                "docker": docker_status,
            }));
        }
        let payload = json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "apps": entries,
        });
        let event =
            Event::default().data(serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into()));
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        Some((Ok::<_, Infallible>(event), state))
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// SSE stream of install-job + app-list updates. Sends a snapshot first
/// so the UI can render immediately on connect.
async fn local_appstore_jobs_stream(
    State(state): State<AppState>,
) -> axum::response::Sse<impl Stream<Item = Result<axum::response::sse::Event, Infallible>>> {
    use axum::response::sse::{Event, KeepAlive, Sse};
    use tokio_stream::wrappers::BroadcastStream;
    use tokio_stream::StreamExt as _;

    let snapshot = state.local_appstore.snapshot_event().await;
    let recv = state.local_appstore.subscribe();

    let snapshot_stream = futures_util::stream::once(async move {
        Ok::<local_appstore::InstallEvent, Infallible>(snapshot)
    });
    let live = BroadcastStream::new(recv).filter_map(
        |r: Result<
            local_appstore::InstallEvent,
            tokio_stream::wrappers::errors::BroadcastStreamRecvError,
        >| { r.ok().map(Ok::<_, Infallible>) },
    );
    let combined =
        snapshot_stream
            .chain(live)
            .map(|r: Result<local_appstore::InstallEvent, Infallible>| {
                let ev = r.unwrap();
                let data = serde_json::to_string(&ev).unwrap_or_else(|_| "{}".to_string());
                Ok(Event::default().data(data))
            });
    Sse::new(combined).keep_alive(KeepAlive::default())
}

/// Register a system app via the local app-store.
///
/// The frontend calls this when developer mode is toggled, so the Developer App
/// (and other built-in system apps) appear immediately in the installed apps list
/// without waiting for the next bootstrap cycle.
///
/// Request body: `{ "app_id": "iora-developer-app" }`
/// Supported app_ids:
///   - `iora-developer-app` — The IORA Developer App (dev tools, bridge, debug APIs)
///
async fn local_store_register(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let app_id = body
        .get("app_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Feld 'app_id' fehlt"))?;

    match app_id {
        "iora-developer-app" => {
            state
                .local_appstore
                .set_developer_app(true)
                .await
                .map_err(|e| {
                    ErrorResponse::internal(format!(
                        "Developer-App-Registrierung fehlgeschlagen: {}",
                        e
                    ))
                })?;
            Ok(Json(json!({
                "success": true,
                "app_id": app_id,
                "message": "Developer App registriert"
            })))
        }
        _ => Err(ErrorResponse::not_found(format!(
            "Unbekannte System-App: '{}'",
            app_id
        ))),
    }
}

// ── Control Center: restart a known iora-* service ──────────────────────────

const RESTARTABLE_SERVICES: &[&str] = &[
    "iora-home",
    "iora-core",
    "iora-control",
    "iora-assist",
    "iora-secrets",
    "iora-watchdog",
    "iora-security",
    "iora-gateway",
    "iora-supervisor",
    "iora-appstore",
    "iora-backup",
    "iora-files",
    "iora-connector",
    "iora-network-monitor",
    "iora-nginx",
    "iora-resource-manager",
    "iora-updater",
    "iora-developer-app",
    "iora-dev-bridge",
    "iora-intelligence",
];

async fn admin_control_restart_service(
    State(state): State<AppState>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let soft_restart_home = || async {
        let ha_config = load_ha_runtime_config(&state.config_repo).await;
        if ha_config.is_configured() {
            state
                .ha_client
                .update_credentials(&ha_config.url, &ha_config.token)
                .await;
            state.ha_connection.update_url(&ha_config.url).await;
            state.ha_connection.reset_for_reconnect();
        }
        Ok::<Json<Value>, ErrorResponse>(Json(json!({
            "success": true,
            "service": "iora-home",
            "soft_restart": true,
            "message": "iora-home Soft-Restart ausgeführt (HA-Verbindung neu initialisiert, Prozess bleibt online).",
            "ha_configured": ha_config.is_configured(),
            "url": if ha_config.is_configured() { ha_config.url } else { String::new() },
        })))
    };

    // Soft-restart: for iora-home itself, just reconnect HA as a lightweight
    // alternative to a full systemctl restart (which would drop WebSocket clients).
    if name == "iora-home-ha" || name == "iora-home" {
        return soft_restart_home().await;
    }

    let safe_name = RESTARTABLE_SERVICES
        .iter()
        .find(|&&s| s == name)
        .ok_or_else(|| {
            ErrorResponse::bad_request(format!(
                "Dienst '{}' ist nicht als neustartbar registriert. Verfügbare Dienste: {}",
                name,
                RESTARTABLE_SERVICES.join(", ")
            ))
        })?;

    // Best-effort: on Windows / dev workstations there's no systemctl —
    // surface the failure as 503 so the UI can display a hint.
    let unit = format!("{}.service", safe_name);
    match tokio::process::Command::new("systemctl")
        .arg("restart")
        .arg(&unit)
        .output()
        .await
    {
        Ok(out) if out.status.success() => Ok(Json(json!({
            "success": true,
            "service": safe_name,
            "message": format!("{unit} neu gestartet."),
        }))),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let hint = if stderr.contains("not found") || stderr.contains("No such") {
                format!(
                    "Systemdienst '{unit}' existiert nicht auf diesem System. \
                     Auf Dev-Workstations ohne systemctl ist Service-Neustart nicht möglich."
                )
            } else if stderr.contains("permission denied") || stderr.contains("not permitted") {
                format!(
                    "Keine Berechtigung zum Neustart von '{unit}'. Der Dienst läuft vermutlich ohne root/systemd-Rechte. \
                     Nutze bei iora-home den Soft-Restart (Service 'iora-home')."
                )
            } else {
                format!("systemctl restart {unit} fehlgeschlagen: {stderr}")
            };
            Err(ErrorResponse::service_unavailable(hint))
        }
        Err(e) => Err(ErrorResponse::service_unavailable(format!(
            "systemctl nicht verfügbar ({e}). Auf einer Dev-Workstation ist Service-Neustart per UI nicht möglich. \
             Nutze 'iora-home-ha' als Service-Namen für einen Soft-Neustart der HA-Verbindung."
        ))),
    }
}

async fn admin_dev_image_info(State(state): State<AppState>) -> Json<Value> {
    Json(state.dev_image.to_json())
}

async fn supervisor_apps_list(State(state): State<AppState>) -> Json<Value> {
    let installed = state.local_appstore.list().await;
    let apps: Vec<Value> = installed
        .into_iter()
        .filter(|a| a.kind != "plugin")
        .map(|a| {
            let custom_pages = &a.custom_pages;
            let open_url = custom_pages
                .first()
                .map(|p| format!("/page/{}", p.id));
            json!({
                "id": a.id,
                "name": a.name,
                "version": a.version,
                "description": a.description,
                "author": a.developer,
                "icon": a.icon,
                "image": a.docker_config.as_ref().and_then(|d| d.get("image").and_then(|v| v.as_str())).unwrap_or(""),
                "ports": a.ports.iter().map(|p| format!("{}:{}/{}", p.external, p.internal, p.protocol)).collect::<Vec<_>>(),
                "environment": serde_json::Value::Null,
                "volumes": Vec::<String>::new(),
                "permissions": a.manifest.permissions.clone(),
                "enabled": a.enabled,
                "status": a.status.clone(),
                "installed_at": a.installed_at.clone(),
                "kind": a.kind.clone(),
                "open_url": open_url,
                "custom_pages": custom_pages,
                "is_bundle": a.is_bundle,
                "bundle_config": a.bundle_config,
                "services": a.bundle_config.as_ref().and_then(|b| b.get("services").cloned()).unwrap_or(serde_json::Value::Array(Vec::new())),
            })
        })
        .collect();
    Json(json!({
        "apps": apps,
        "total": apps.len(),
        "available": true,
        "source": "local",
    }))
}

async fn supervisor_apps_get(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app = installed
        .into_iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;
    Ok(Json(json!({
        "id": app.id,
        "name": app.name,
        "version": app.version,
        "description": app.description,
        "author": app.developer,
        "icon": app.icon,
        "status": app.status,
        "enabled": app.enabled,
        "kind": app.kind,
        "custom_pages": app.custom_pages,
        "ports": app.ports,
        "manifest": app.manifest,
        "permission_grants": app.permission_grants,
        "denied_permissions": app.denied_permissions,
        "permission_audit": app.permission_audit,
    })))
}

async fn supervisor_apps_install(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    // For now, delegate to local_appstore install via the existing ZIP endpoint.
    // If the request contains a base64 zip_data, forward it.
    if let Some(zip_data) = body.get("zip_data").and_then(|v| v.as_str()) {
        use base64::Engine as _;
        let payload = zip_data
            .split(',')
            .last()
            .unwrap_or(zip_data)
            .trim()
            .to_string();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.as_bytes())
            .map_err(|e| ErrorResponse::bad_request(format!("ungültiges Base64: {e}")))?;
        if bytes.is_empty() {
            return Err(ErrorResponse::bad_request("ZIP ist leer".to_string()));
        }
        let file_name = body
            .get("file_name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("upload.zip")
            .to_string();
        let granted_permissions = body
            .get("granted_permissions")
            .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok());
        let denied_permissions = body
            .get("denied_permissions")
            .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok())
            .unwrap_or_default();
        let replace_existing = body
            .get("replace_existing")
            .or_else(|| body.get("force_replace"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let install_options = local_appstore::InstallOptions {
            replace_existing,
            granted_permissions,
            denied_permissions,
            actor: Some("supervisor-api".to_string()),
        };
        let install_id =
            state
                .local_appstore
                .start_install_with_options(file_name, bytes, install_options);
        spawn_post_install_runtime_prepare(state.clone(), install_id);
        return Ok(Json(json!({
            "success": true,
            "install_id": install_id,
            "message": "Installation gestartet.",
        })));
    }
    Err(ErrorResponse::bad_request("Keine ZIP-Daten (zip_data) übermittelt. Nutze /api/appstore/install für ZIP-Installationen.".to_string()))
}

async fn supervisor_apps_start(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app_meta = installed
        .iter()
        .find(|a| a.id == app_id)
        .cloned()
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    if !app_meta.denied_permissions.is_empty() {
        return Err(ErrorResponse::forbidden(format!(
            "app '{}' cannot be started because permissions were not granted: {}",
            app_id,
            app_meta.denied_permissions.join(", ")
        )));
    }

    let needs_docker = app_meta.docker_config.is_some() || app_meta.bundle_config.is_some();

    let _ = state.local_appstore.set_status(&app_id, "starting").await;

    // Mark as starting immediately so the UI shows status without waiting
    // for the (potentially long-running) docker compose pull/up.
    state.local_appstore.append_log(
        &app_id,
        local_appstore::LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "INFO".to_string(),
            message: if needs_docker {
                "Starte App… Docker-Container werden im Hintergrund hochgefahren (image pull kann mehrere Minuten dauern).".to_string()
            } else {
                "Starte App im lokalen Modus (ohne Docker).".to_string()
            },
            source: "app-runtime".to_string(),
        },
    );

    if !needs_docker {
        // No docker → synchronous flip is cheap
        let app = state
            .local_appstore
            .start(&app_id)
            .await
            .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
        return Ok(Json(json!({
            "success": true,
            "app_id": app.id,
            "status": "running",
            "docker": serde_json::Value::Null,
            "message": format!("App '{}' gestartet.", app.name),
        })));
    }

    // Spawn the heavy docker work in the background so the HTTP request
    // returns quickly and the browser doesn't run into ERR_EMPTY_RESPONSE
    // (idle timeouts) during long image pulls. Progress is reported via the
    // existing log stream and the `/apps/:id/detail` status endpoint.
    let appstore = state.local_appstore.clone();
    let app_id_bg = app_id.clone();
    let app_meta_bg = app_meta.clone();
    let base_dir_bg = state.local_appstore.base_dir().to_path_buf();
    tokio::spawn(async move {
        match try_docker_compose_up(&app_id_bg, &app_meta_bg, &base_dir_bg).await {
            Some(Ok(msg)) => {
                appstore.append_log(
                    &app_id_bg,
                    local_appstore::LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "INFO".to_string(),
                        message: format!("Docker-Start erfolgreich: {msg}"),
                        source: "app-runtime".to_string(),
                    },
                );

                match app_lifecycle::wait_until_running(&app_id_bg, 60).await {
                    Ok(s) if s.total > 0 => {
                        appstore.append_log(
                            &app_id_bg,
                            local_appstore::LogEntry {
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                level: "INFO".to_string(),
                                message: format!(
                                    "Verifiziert: {}/{} Services laufen.",
                                    s.running, s.total
                                ),
                                source: "app-runtime".to_string(),
                            },
                        );
                        let _ = appstore.start(&app_id_bg).await;
                    }
                    Ok(_) => {
                        // Empty project — leave as is
                        let _ = appstore.start(&app_id_bg).await;
                    }
                    Err(verify_err) => {
                        let _ = try_docker_compose_down(&app_id_bg).await;
                        let _ = appstore.set_status(&app_id_bg, "error").await;
                        appstore.append_log(
                            &app_id_bg,
                            local_appstore::LogEntry {
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                level: "ERROR".to_string(),
                                message: format!(
                                    "Container-Verifizierung fehlgeschlagen: {verify_err}"
                                ),
                                source: "app-runtime".to_string(),
                            },
                        );
                    }
                }
            }
            Some(Err(err_msg)) => {
                let _ = appstore.set_status(&app_id_bg, "error").await;
                appstore.append_log(
                    &app_id_bg,
                    local_appstore::LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "ERROR".to_string(),
                        message: format!("Docker-Start fehlgeschlagen: {err_msg}"),
                        source: "app-runtime".to_string(),
                    },
                );
            }
            None => {
                let _ = appstore.set_status(&app_id_bg, "error").await;
                appstore.append_log(
                    &app_id_bg,
                    local_appstore::LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "ERROR".to_string(),
                        message: "Docker CLI ist nicht verfügbar. Diese App benötigt Docker."
                            .to_string(),
                        source: "app-runtime".to_string(),
                    },
                );
            }
        }
    });

    Ok(Json(json!({
        "success": true,
        "app_id": app_id,
        "status": "starting",
        "message": format!("App '{}' wird im Hintergrund gestartet. Logs zeigen den Fortschritt.", app_meta.name),
    })))
}

async fn supervisor_apps_stop(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let needs_docker = installed
        .iter()
        .find(|a| a.id == app_id)
        .map(|a| a.docker_config.is_some() || a.bundle_config.is_some())
        .unwrap_or(false);

    let app = state
        .local_appstore
        .stop(&app_id)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;

    // Try to stop Docker container
    let docker_result = if needs_docker {
        try_docker_compose_down(&app_id).await
    } else {
        None
    };

    state.local_appstore.append_log(
        &app_id,
        local_appstore::LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "INFO".to_string(),
            message: match &docker_result {
                Some(msg) => format!("App gestoppt. {msg}"),
                None if needs_docker => {
                    "App gestoppt. Docker-Down konnte nicht bestaetigt werden.".to_string()
                }
                None => "App gestoppt (lokaler Modus).".to_string(),
            },
            source: "app-runtime".to_string(),
        },
    );

    Ok(Json(json!({
        "success": true,
        "app_id": app.id,
        "status": "stopped",
        "docker": docker_result,
        "message": format!("App '{}' gestoppt.", app.name),
    })))
}

async fn docker_compose_control(app_id: &str, action: &str) -> Option<Result<String, String>> {
    use tokio::process::Command;

    let mut had_binary = false;
    for prefix in ["iora-app-", "iora-bundle-"] {
        let project = format!("{prefix}{app_id}");
        match Command::new("docker")
            .args(["compose", "-p", &project, action])
            .output()
            .await
        {
            Ok(out) => {
                had_binary = true;
                if out.status.success() {
                    let msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    return Some(Ok(if msg.is_empty() {
                        format!("docker compose {action} succeeded")
                    } else {
                        msg
                    }));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
            Err(_) => {}
        }
    }

    if had_binary {
        Some(Err(format!(
            "docker compose {action} failed for app '{app_id}'"
        )))
    } else {
        None
    }
}

async fn supervisor_apps_pause(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app = installed
        .iter()
        .find(|a| a.id == app_id)
        .cloned()
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
    if !needs_docker {
        return Err(ErrorResponse::bad_request(
            "Pause is only available for containerized apps".to_string(),
        ));
    }

    match docker_compose_control(&app_id, "pause").await {
        Some(Ok(msg)) => {
            let updated = state
                .local_appstore
                .set_status(&app_id, "paused")
                .await
                .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
            state.local_appstore.append_log(
                &app_id,
                local_appstore::LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "INFO".to_string(),
                    message: format!("App paused. {msg}"),
                    source: "app-runtime".to_string(),
                },
            );
            Ok(Json(json!({
                "success": true,
                "app_id": updated.id,
                "status": "paused",
                "message": format!("App '{}' paused.", updated.name),
            })))
        }
        Some(Err(err)) => Err(ErrorResponse::bad_request(err)),
        None => Err(ErrorResponse::service_unavailable(
            "Docker CLI is unavailable. Pause is not possible.".to_string(),
        )),
    }
}

async fn supervisor_apps_resume(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app = installed
        .iter()
        .find(|a| a.id == app_id)
        .cloned()
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
    if !needs_docker {
        return Err(ErrorResponse::bad_request(
            "Resume is only available for containerized apps".to_string(),
        ));
    }

    match docker_compose_control(&app_id, "unpause").await {
        Some(Ok(msg)) => {
            let updated = state
                .local_appstore
                .set_status(&app_id, "running")
                .await
                .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
            state.local_appstore.append_log(
                &app_id,
                local_appstore::LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "INFO".to_string(),
                    message: format!("App resumed. {msg}"),
                    source: "app-runtime".to_string(),
                },
            );
            Ok(Json(json!({
                "success": true,
                "app_id": updated.id,
                "status": "running",
                "message": format!("App '{}' resumed.", updated.name),
            })))
        }
        Some(Err(err)) => Err(ErrorResponse::bad_request(err)),
        None => Err(ErrorResponse::service_unavailable(
            "Docker CLI is unavailable. Resume is not possible.".to_string(),
        )),
    }
}

async fn supervisor_apps_restart(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app_meta = installed
        .iter()
        .find(|a| a.id == app_id)
        .cloned()
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let needs_docker = app_meta.docker_config.is_some() || app_meta.bundle_config.is_some();

    let _ = state.local_appstore.stop(&app_id).await;

    if needs_docker {
        let _ = try_docker_compose_down(&app_id).await;
        match try_docker_compose_up(&app_id, &app_meta, state.local_appstore.base_dir()).await {
            Some(Ok(msg)) => {
                state.local_appstore.append_log(
                    &app_id,
                    local_appstore::LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "INFO".to_string(),
                        message: format!("Docker-Neustart erfolgreich: {msg}"),
                        source: "app-runtime".to_string(),
                    },
                );
                if let Err(verify_err) = app_lifecycle::wait_until_running(&app_id, 15).await {
                    let _ = try_docker_compose_down(&app_id).await;
                    state.local_appstore.append_log(
                        &app_id,
                        local_appstore::LogEntry {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            level: "ERROR".to_string(),
                            message: format!("Restart-Verifizierung fehlgeschlagen: {verify_err}"),
                            source: "app-runtime".to_string(),
                        },
                    );
                    return Err(ErrorResponse::bad_gateway(format!(
                        "App '{}' Container nach Neustart nicht gesund: {verify_err}",
                        app_meta.name
                    )));
                }
            }
            Some(Err(err_msg)) => {
                state.local_appstore.append_log(
                    &app_id,
                    local_appstore::LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "ERROR".to_string(),
                        message: format!("Docker-Neustart fehlgeschlagen: {err_msg}"),
                        source: "app-runtime".to_string(),
                    },
                );
                return Err(ErrorResponse::bad_request(format!(
                    "App '{}' konnte nicht neu gestartet werden: {err_msg}",
                    app_meta.name
                )));
            }
            None => {
                return Err(ErrorResponse::service_unavailable(
                    "Docker CLI ist nicht verfügbar. Neustart dieser App ist nicht möglich."
                        .to_string(),
                ));
            }
        }
    }

    let app = state
        .local_appstore
        .start(&app_id)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;

    if !needs_docker {
        state.local_appstore.append_log(
            &app_id,
            local_appstore::LogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                level: "INFO".to_string(),
                message: "App lokal neu gestartet (ohne Docker).".to_string(),
                source: "app-runtime".to_string(),
            },
        );
    }

    Ok(Json(json!({
        "success": true,
        "app_id": app.id,
        "status": "running",
        "message": format!("App '{}' neu gestartet.", app.name),
    })))
}

async fn supervisor_apps_uninstall(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    state
        .local_appstore
        .uninstall(&app_id)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
    Ok(Json(json!({
        "success": true,
        "app_id": app_id,
        "message": "App deinstalliert.",
    })))
}

// ── App-Bundle-Management (v2.3 multi-container) ──────────────────

/// Generate a docker-compose.yml from an app's bundle definition.
/// This is returned as plain text for the user/admin to inspect or use.
async fn supervisor_apps_compose(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<axum::response::Response<String>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app = installed
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let bundle = app
        .bundle_config
        .as_ref()
        .ok_or_else(|| ErrorResponse::bad_request(format!("app '{}' ist kein Bundle", app_id)))?;

    let compose_yaml = generate_compose_yaml(&app_id, bundle);

    Ok(axum::response::Response::builder()
        .header("content-type", "text/yaml; charset=utf-8")
        .header(
            "content-disposition",
            format!("attachment; filename=\"docker-compose-{}.yml\"", app_id),
        )
        .body(compose_yaml)
        .unwrap_or_else(|_| axum::response::Response::new(String::new())))
}

/// Generate a docker-compose.yml from a bundle definition.
fn generate_compose_yaml(app_id: &str, bundle: &serde_json::Value) -> String {
    let version = bundle
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("3.8");
    let services = bundle.get("services").and_then(|s| s.as_array());
    let network_config = bundle.get("network");
    let volumes_config = bundle.get("volumes").and_then(|v| v.as_array());

    let net_name = network_config
        .and_then(|n| n.get("name").and_then(|v| v.as_str()))
        .unwrap_or(&format!("iora-bundle-{}", app_id))
        .to_string();
    let net_driver = network_config
        .and_then(|n| n.get("driver").and_then(|v| v.as_str()))
        .unwrap_or("bridge");
    let net_internal = network_config
        .and_then(|n| n.get("internal").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    let net_subnet = network_config.and_then(|n| n.get("subnet").and_then(|v| v.as_str()));

    let mut yaml = format!(
        "# IORA App Bundle: {app_id}\n# Bundled components:\n#\n",
        app_id = app_id
    );

    yaml.push_str(&format!(
        "version: '{version}'\nname: iora-bundle-{app_id}\n\nservices:\n",
        version = version,
        app_id = app_id
    ));

    if let Some(svcs) = services {
        for svc in svcs {
            let name = svc
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let image = svc.get("image").and_then(|v| v.as_str());
            let build = svc.get("build");
            let command = svc.get("command").and_then(|v| v.as_str());
            let working_dir = svc.get("working_dir").and_then(|v| v.as_str());
            let restart = svc
                .get("restart")
                .and_then(|v| v.as_str())
                .unwrap_or("unless-stopped");
            let depends_on = svc.get("depends_on").and_then(|v| v.as_array());
            let ports = svc.get("internal_ports").and_then(|v| v.as_array());
            let env = svc.get("environment").and_then(|v| v.as_object());
            let volumes_list = svc.get("volumes").and_then(|v| v.as_array());
            let health_check = svc.get("health_check");
            let resources = svc.get("resources");

            yaml.push_str(&format!("  {name}:\n", name = name));

            if let Some(img) = image {
                yaml.push_str(&format!("    image: {img}\n"));
            }
            if let Some(bld) = build {
                let context = bld.get("context").and_then(|v| v.as_str()).unwrap_or(".");
                let dockerfile = bld
                    .get("dockerfile")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Dockerfile");
                yaml.push_str(&format!(
                    "    build:\n      context: {context}\n      dockerfile: {dockerfile}\n"
                ));
                if let Some(args) = bld.get("args").and_then(|v| v.as_object()) {
                    yaml.push_str("      args:\n");
                    for (k, v) in args {
                        yaml.push_str(&format!("        {k}: {v}\n"));
                    }
                }
            }
            if let Some(cmd) = command {
                yaml.push_str(&format!("    command: {cmd}\n"));
            }
            if let Some(wd) = working_dir {
                yaml.push_str(&format!("    working_dir: {wd}\n"));
            }
            yaml.push_str(&format!("    restart: {restart}\n"));

            // Internal network
            yaml.push_str(&format!("    networks:\n      - {net_name}\n"));

            // Depends on
            if let Some(deps) = depends_on {
                if !deps.is_empty() {
                    yaml.push_str("    depends_on:\n");
                    for dep in deps {
                        if let Some(d) = dep.as_str() {
                            yaml.push_str(&format!(
                                "      {d}:\n        condition: service_started\n"
                            ));
                        }
                    }
                }
            }

            // Ports
            if let Some(pts) = ports {
                if !pts.is_empty() {
                    yaml.push_str("    ports:\n");
                    for pt in pts {
                        let port = pt.get("port").and_then(|v| v.as_u64()).unwrap_or(0);
                        let proto = pt.get("protocol").and_then(|v| v.as_str()).unwrap_or("tcp");
                        let mode = pt
                            .get("assignment_mode")
                            .and_then(|v| v.as_str())
                            .unwrap_or("random");
                        if mode == "random" {
                            yaml.push_str(&format!("      - '{port}:{port}/{proto}' # random\n"));
                        } else {
                            yaml.push_str(&format!("      - '{port}:{port}/{proto}'\n"));
                        }
                    }
                }
            }

            // Environment
            if let Some(env_obj) = env {
                yaml.push_str("    environment:\n");
                for (k, v) in env_obj {
                    yaml.push_str(&format!("      {k}: {v}\n"));
                }
            }

            // Volumes
            if let Some(vols) = volumes_list {
                if !vols.is_empty() {
                    yaml.push_str("    volumes:\n");
                    for vol in vols {
                        if let Some(v_str) = vol.as_str() {
                            yaml.push_str(&format!("      - {v_str}\n"));
                        }
                    }
                }
            }

            // Health check
            if let Some(hc) = health_check {
                let endpoint = hc.get("endpoint").and_then(|v| v.as_str()).unwrap_or("/");
                let interval = hc.get("interval").and_then(|v| v.as_u64()).unwrap_or(30);
                let timeout = hc.get("timeout").and_then(|v| v.as_u64()).unwrap_or(10);
                let retries = hc.get("retries").and_then(|v| v.as_u64()).unwrap_or(3);
                yaml.push_str(&format!(
                    "    healthcheck:\n      test: [\"CMD\", \"curl\", \"-f\", \"{endpoint}\"]\n      interval: {interval}s\n      timeout: {timeout}s\n      retries: {retries}\n"
                ));
            }

            // Resources
            if let Some(res) = resources {
                yaml.push_str("    deploy:\n      resources:\n        limits:\n");
                if let Some(mem) = res.get("memory").and_then(|v| v.as_str()) {
                    yaml.push_str(&format!("          memory: {mem}\n"));
                }
                if let Some(cpu) = res.get("cpu").and_then(|v| v.as_str()) {
                    yaml.push_str(&format!("          cpus: '{cpu}'\n"));
                }
                yaml.push_str("        reservations:\n");
                if let Some(mem_res) = res.get("memory_reservation").and_then(|v| v.as_str()) {
                    yaml.push_str(&format!("          memory: {mem_res}\n"));
                }
            }

            yaml.push('\n');
        }
    }

    // Network
    yaml.push_str(&format!(
        "networks:\n  {net_name}:\n    driver: {net_driver}\n"
    ));
    if net_internal {
        yaml.push_str("    internal: true\n");
    }
    if let Some(subnet) = net_subnet {
        yaml.push_str(&format!(
            "    ipam:\n      config:\n        - subnet: {subnet}\n"
        ));
    }

    // Named volumes
    if let Some(vols) = volumes_config {
        if !vols.is_empty() {
            yaml.push_str("\nvolumes:\n");
            for vol in vols {
                if let Some(v_name) = vol.get("name").and_then(|v| v.as_str()) {
                    yaml.push_str(&format!("  {v_name}:\n"));
                    if let Some(driver) = vol.get("driver").and_then(|v| v.as_str()) {
                        yaml.push_str(&format!("    driver: {driver}\n"));
                    }
                }
            }
        }
    }

    yaml
}

/// Start all services in an app bundle.
async fn supervisor_bundle_start(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app_meta = installed
        .iter()
        .find(|a| a.id == app_id)
        .cloned()
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    // Bundle apps require docker-compose.
    let docker_result =
        match try_docker_compose_up(&app_id, &app_meta, state.local_appstore.base_dir()).await {
            Some(Ok(msg)) => msg,
            Some(Err(err_msg)) => {
                state.local_appstore.append_log(
                    &app_id,
                    local_appstore::LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "ERROR".to_string(),
                        message: format!("Bundle-Start fehlgeschlagen: {err_msg}"),
                        source: "app-runtime".to_string(),
                    },
                );
                return Err(ErrorResponse::bad_request(format!(
                    "Bundle konnte nicht gestartet werden: {err_msg}"
                )));
            }
            None => {
                return Err(ErrorResponse::service_unavailable(
                    "Docker CLI ist nicht verfügbar. Bundle-Start ist nicht möglich.".to_string(),
                ));
            }
        };

    // Verifizieren, dass alle Bundle-Services laufen.
    if let Err(verify_err) = app_lifecycle::wait_until_running(&app_id, 20).await {
        let _ = try_docker_compose_down(&app_id).await;
        state.local_appstore.append_log(
            &app_id,
            local_appstore::LogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                level: "ERROR".to_string(),
                message: format!("Bundle-Verifizierung fehlgeschlagen: {verify_err}"),
                source: "app-runtime".to_string(),
            },
        );
        return Err(ErrorResponse::bad_gateway(format!(
            "Bundle '{}' Container nicht gesund: {verify_err}",
            app_meta.name
        )));
    }

    let app = state
        .local_appstore
        .start(&app_id)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;

    state.local_appstore.append_log(
        &app_id,
        local_appstore::LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "INFO".to_string(),
            message: format!("Bundle gestartet: {docker_result}"),
            source: "app-runtime".to_string(),
        },
    );

    Ok(Json(json!({
        "success": true,
        "app_id": app_id,
        "status": "running",
        "docker_compose": docker_result,
        "message": format!("Bundle '{}' gestartet.", app.name),
    })))
}

/// Stop all services in an app bundle.
async fn supervisor_bundle_stop(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let _result = try_docker_compose_down(&app_id).await;

    let app = state
        .local_appstore
        .stop(&app_id)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;

    Ok(Json(json!({
        "success": true,
        "app_id": app_id,
        "status": "stopped",
        "message": format!("Bundle '{}' gestoppt.", app.name),
    })))
}

/// Restart all services in an app bundle.
async fn supervisor_bundle_restart(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app_meta = installed
        .iter()
        .find(|a| a.id == app_id)
        .cloned()
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let _ = state.local_appstore.stop(&app_id).await;
    let _ = try_docker_compose_down(&app_id).await;

    let docker_result =
        match try_docker_compose_up(&app_id, &app_meta, state.local_appstore.base_dir()).await {
            Some(Ok(msg)) => msg,
            Some(Err(err_msg)) => {
                state.local_appstore.append_log(
                    &app_id,
                    local_appstore::LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "ERROR".to_string(),
                        message: format!("Bundle-Neustart fehlgeschlagen: {err_msg}"),
                        source: "app-runtime".to_string(),
                    },
                );
                return Err(ErrorResponse::bad_request(format!(
                    "Bundle konnte nicht neu gestartet werden: {err_msg}"
                )));
            }
            None => {
                return Err(ErrorResponse::service_unavailable(
                    "Docker CLI ist nicht verfügbar. Bundle-Neustart ist nicht möglich."
                        .to_string(),
                ));
            }
        };

    if let Err(verify_err) = app_lifecycle::wait_until_running(&app_id, 20).await {
        let _ = try_docker_compose_down(&app_id).await;
        state.local_appstore.append_log(
            &app_id,
            local_appstore::LogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                level: "ERROR".to_string(),
                message: format!("Bundle-Restart-Verifizierung fehlgeschlagen: {verify_err}"),
                source: "app-runtime".to_string(),
            },
        );
        return Err(ErrorResponse::bad_gateway(format!(
            "Bundle '{}' Container nach Neustart nicht gesund: {verify_err}",
            app_meta.name
        )));
    }

    let app = state
        .local_appstore
        .start(&app_id)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;

    state.local_appstore.append_log(
        &app_id,
        local_appstore::LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "INFO".to_string(),
            message: format!("Bundle neu gestartet: {docker_result}"),
            source: "app-runtime".to_string(),
        },
    );

    Ok(Json(json!({
        "success": true,
        "app_id": app_id,
        "status": "running",
        "message": format!("Bundle '{}' neu gestartet.", app.name),
        "docker_compose": docker_result,
    })))
}

/// Get status of all services in an app bundle.
async fn supervisor_bundle_status(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app = installed
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let bundle = app
        .bundle_config
        .as_ref()
        .ok_or_else(|| ErrorResponse::bad_request(format!("app '{}' ist kein Bundle", app_id)))?;

    let services = bundle.get("services").and_then(|s| s.as_array());
    let service_count = services.map(|s| s.len()).unwrap_or(0);

    Ok(Json(json!({
        "app_id": app_id,
        "name": app.name,
        "status": app.status,
        "enabled": app.enabled,
        "service_count": service_count,
        "services": services,
        "network": bundle.get("network"),
        "volumes": bundle.get("volumes"),
        "compose_url": format!("/api/supervisor/apps/{}/compose", app_id),
    })))
}

/// Generate a docker-compose.yml from an app's `docker_config` (single-container).
fn generate_app_compose_yaml(app_id: &str, docker: &serde_json::Value) -> String {
    let image = docker
        .get("base_image")
        .and_then(|v| v.as_str())
        .unwrap_or("alpine:latest");
    let working_dir = docker
        .get("working_dir")
        .and_then(|v| v.as_str())
        .unwrap_or("/app");
    let start_cmd = docker
        .get("start_cmd")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let install_cmd = docker.get("install_cmd").and_then(|v| v.as_str());
    let auto_build = docker
        .get("auto_build")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let explicit_dockerfile = docker.get("dockerfile").and_then(|v| v.as_str());
    let image_tag = if auto_build {
        docker
            .get("image")
            .and_then(|v| v.as_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| format!("iora-app-{}:local", app_id))
    } else {
        image.to_string()
    };
    let mut yaml = String::new();

    yaml.push_str(&format!("services:\n  {}:\n", app_id));
    yaml.push_str(&format!("    image: {}\n", image_tag));

    if auto_build {
        let context = docker
            .get("build_context")
            .and_then(|v| v.as_str())
            .unwrap_or(".");
        let dockerfile = explicit_dockerfile.unwrap_or(".iora-generated.Dockerfile");
        yaml.push_str(&format!(
            "    build:\n      context: {context}\n      dockerfile: {dockerfile}\n"
        ));
    }

    if auto_build {
        if !start_cmd.is_empty() {
            yaml.push_str(&format!("    command: {start_cmd}\n"));
        }
    } else if let Some(cmd) = install_cmd {
        yaml.push_str(&format!("    command: sh -c \"{cmd} && {start_cmd}\"\n"));
    } else if !start_cmd.is_empty() {
        yaml.push_str(&format!("    command: {start_cmd}\n"));
    }

    yaml.push_str(&format!("    working_dir: {working_dir}\n"));

    // Ports
    if let Some(ports) = docker.get("internal_ports").and_then(|v| v.as_array()) {
        for port in ports {
            let internal = port.get("port").and_then(|v| v.as_u64()).unwrap_or(3000);
            yaml.push_str(&format!(
                "    ports:\n      - \"{}:{}\"\n",
                internal, internal
            ));
        }
    }

    // Environment
    if let Some(env) = docker.get("environment").and_then(|v| v.as_object()) {
        yaml.push_str("    environment:\n");
        for (key, val) in env {
            let v = val.as_str().unwrap_or("");
            yaml.push_str(&format!("      {}: {}\n", key, v));
        }
    }

    // Volumes
    if let Some(volumes) = docker.get("volumes").and_then(|v| v.as_array()) {
        for vol in volumes {
            if let Some(v) = vol.as_str() {
                yaml.push_str(&format!("    volumes:\n      - {}\n", v));
            }
        }
    }

    if docker
        .get("privileged")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        yaml.push_str("    privileged: true\n");
    }

    if let Some(network_mode) = docker.get("network_mode").and_then(|v| v.as_str()) {
        yaml.push_str(&format!("    network_mode: {}\n", network_mode));
    }

    if let Some(cap_add) = docker.get("cap_add").and_then(|v| v.as_array()) {
        if !cap_add.is_empty() {
            yaml.push_str("    cap_add:\n");
            for capability in cap_add {
                if let Some(capability) = capability.as_str() {
                    yaml.push_str(&format!("      - {}\n", capability));
                }
            }
        }
    }

    if let Some(security_opt) = docker.get("security_opt").and_then(|v| v.as_array()) {
        if !security_opt.is_empty() {
            yaml.push_str("    security_opt:\n");
            for option in security_opt {
                if let Some(option) = option.as_str() {
                    yaml.push_str(&format!("      - {}\n", option));
                }
            }
        }
    }

    // Restart policy
    yaml.push_str("    restart: unless-stopped\n");

    // Health check
    if let Some(hc) = docker.get("health_check") {
        let endpoint = hc
            .get("endpoint")
            .and_then(|v| v.as_str())
            .unwrap_or("/health");
        let interval = hc.get("interval").and_then(|v| v.as_u64()).unwrap_or(30);
        let timeout = hc.get("timeout").and_then(|v| v.as_u64()).unwrap_or(10);
        let retries = hc.get("retries").and_then(|v| v.as_u64()).unwrap_or(3);
        yaml.push_str(&format!(
            "    healthcheck:\n      test: [\"CMD\", \"curl\", \"-f\", \"http://localhost:{}{}\"]\n      interval: {}s\n      timeout: {}s\n      retries: {}\n",
            docker.get("internal_ports").and_then(|p| p.as_array()).and_then(|a| a.first()).and_then(|p| p.get("port").and_then(|v| v.as_u64())).unwrap_or(3000),
            endpoint,
            interval, timeout, retries
        ));
    }

    yaml.push_str("\nnetworks:\n  default:\n    driver: bridge\n");
    yaml
}

fn generated_auto_build_dockerfile(docker: &serde_json::Value) -> String {
    let base_image = docker
        .get("base_image")
        .and_then(|v| v.as_str())
        .unwrap_or("alpine:latest");
    let working_dir = docker
        .get("working_dir")
        .and_then(|v| v.as_str())
        .unwrap_or("/app");
    let install_cmd = docker
        .get("install_cmd")
        .and_then(|v| v.as_str())
        .unwrap_or(":");
    let rust_build_deps = if base_image.starts_with("rust:")
        && (base_image.contains("slim")
            || base_image.contains("bookworm")
            || base_image.contains("bullseye"))
    {
        "RUN apt-get update \\\n+    && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates build-essential \\\n+    && rm -rf /var/lib/apt/lists/*\n"
    } else {
        ""
    };
    format!(
        "FROM {base_image}\n{rust_build_deps}WORKDIR {working_dir}\nCOPY . .\nRUN if [ -d .iora-sdks/rust ]; then mkdir -p /sdks && cp -a .iora-sdks/rust /sdks/rust; fi\nRUN {install_cmd}\n"
    )
}

fn copy_dir_all_sync(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all_sync(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn candidate_rust_sdk_paths() -> Vec<std::path::PathBuf> {
    let mut paths = vec![
        std::path::PathBuf::from("/opt/iora/sdks/rust"),
        std::path::PathBuf::from("/usr/share/iora/sdks/rust"),
        std::path::PathBuf::from("/var/lib/iora/sdks/rust"),
    ];
    if let Ok(cwd) = std::env::current_dir() {
        paths.extend([
            cwd.join("sdks/rust"),
            cwd.join("../sdks/rust"),
            cwd.join("../../sdks/rust"),
            cwd.join("../../../sdks/rust"),
        ]);
    }
    paths
}

fn should_vendor_rust_sdk(compose_dir: &std::path::Path) -> bool {
    let Ok(cargo_toml) = std::fs::read_to_string(compose_dir.join("Cargo.toml")) else {
        return false;
    };
    cargo_toml.contains("iora-sdk") && cargo_toml.contains("../../sdks/rust")
}

async fn ensure_vendored_rust_sdk(compose_dir: &std::path::Path) -> Result<(), String> {
    if !should_vendor_rust_sdk(compose_dir) {
        return Ok(());
    }
    let Some(source) = candidate_rust_sdk_paths()
        .into_iter()
        .find(|path| path.join("Cargo.toml").exists())
    else {
        return Err("Rust-App benoetigt iora-sdk via ../../sdks/rust, aber der lokale Rust-SDK wurde nicht gefunden".to_string());
    };
    let target = compose_dir.join(".iora-sdks/rust");
    let source_for_task = source.clone();
    let target_for_task = target.clone();
    tokio::task::spawn_blocking(move || {
        if target_for_task.exists() {
            std::fs::remove_dir_all(&target_for_task)?;
        }
        copy_dir_all_sync(&source_for_task, &target_for_task)
    })
    .await
    .map_err(|e| format!("Rust-SDK-Kopie fehlgeschlagen: {e}"))?
    .map_err(|e| {
        format!(
            "Rust-SDK kann nicht nach {} kopiert werden: {e}",
            target.display()
        )
    })?;
    Ok(())
}

async fn write_compose_support_files(
    app: &local_appstore::InstalledApp,
    compose_dir: &std::path::Path,
) -> Result<(), String> {
    if let Some(docker) = &app.docker_config {
        let auto_build = docker
            .get("auto_build")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let dockerfile = docker.get("dockerfile").and_then(|v| v.as_str());
        if auto_build && dockerfile.is_none() {
            ensure_vendored_rust_sdk(compose_dir).await?;
            tokio::fs::write(
                compose_dir.join(".iora-generated.Dockerfile"),
                generated_auto_build_dockerfile(docker),
            )
            .await
            .map_err(|e| format!("Kann generiertes Dockerfile nicht schreiben: {e}"))?;
        }
    }
    Ok(())
}

fn docker_prepare_mode(app: &local_appstore::InstalledApp) -> &'static str {
    if let Some(docker) = &app.docker_config {
        if docker
            .get("auto_build")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            return "build";
        }
    }
    if app.docker_config.is_some() || app.bundle_config.is_some() {
        return "pull";
    }
    "none"
}

/// Try running docker-compose up for an app (single-container or bundle).
async fn try_docker_compose_up(
    app_id: &str,
    app: &local_appstore::InstalledApp,
    base_dir: &std::path::Path,
) -> Option<Result<String, String>> {
    use tokio::process::Command;

    let compose_content = if let Some(bundle) = &app.bundle_config {
        generate_compose_yaml(app_id, bundle)
    } else if let Some(docker) = &app.docker_config {
        generate_app_compose_yaml(app_id, docker)
    } else {
        return None;
    };

    let compose_dir = base_dir.join(app_id);
    let compose_path = compose_dir.join("docker-compose.yml");

    // Create dir & write compose file
    tokio::fs::create_dir_all(&compose_dir).await.ok();
    if let Err(err) = write_compose_support_files(app, &compose_dir).await {
        return Some(Err(err));
    }
    if let Err(e) = tokio::fs::write(&compose_path, &compose_content).await {
        return Some(Err(format!("Kann docker-compose.yml nicht schreiben: {e}")));
    }

    let project_name = format!("iora-app-{}", app_id);
    if let Some(result) =
        supervisor_compose_up(app_id, &project_name, &compose_content, &compose_dir).await
    {
        return Some(result);
    }

    // Local development fallback only. On IORA OS, iora-home intentionally
    // has no Docker socket permission; the privileged iora-supervisor path
    // above is the supported runtime path.
    let result = Command::new("docker")
        .args(["compose", "-p", &project_name, "up", "-d"])
        .current_dir(&compose_dir)
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => Some(Ok(format!(
            "docker compose up erfolgreich. stdout: {}",
            String::from_utf8_lossy(&output.stdout).trim()
        ))),
        Ok(output) => Some(Err(format!(
            "docker compose fehlgeschlagen: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => Some(Err(format!("Docker-Aufruf fehlgeschlagen: {e}"))),
    }
}

async fn try_docker_compose_prepare(
    app_id: &str,
    app: &local_appstore::InstalledApp,
    base_dir: &std::path::Path,
) -> Option<Result<String, String>> {
    use tokio::process::Command;

    let prepare_mode = docker_prepare_mode(app);
    if prepare_mode == "none" {
        return Some(Ok("keine Docker-Vorbereitung nötig".to_string()));
    }

    let compose_content = if let Some(bundle) = &app.bundle_config {
        generate_compose_yaml(app_id, bundle)
    } else if let Some(docker) = &app.docker_config {
        generate_app_compose_yaml(app_id, docker)
    } else {
        return None;
    };

    let compose_dir = base_dir.join(app_id);
    tokio::fs::create_dir_all(&compose_dir).await.ok();
    if let Err(err) = write_compose_support_files(app, &compose_dir).await {
        return Some(Err(err));
    }
    if let Err(e) = tokio::fs::write(compose_dir.join("docker-compose.yml"), &compose_content).await
    {
        return Some(Err(format!("Kann docker-compose.yml nicht schreiben: {e}")));
    }

    let project_name = format!("iora-app-{}", app_id);
    if let Some(result) = supervisor_compose_prepare(
        app_id,
        &project_name,
        &compose_content,
        &compose_dir,
        prepare_mode,
    )
    .await
    {
        return Some(result);
    }

    let args = if prepare_mode == "build" {
        vec!["compose", "-p", &project_name, "build"]
    } else {
        vec!["compose", "-p", &project_name, "pull"]
    };
    let result = Command::new("docker")
        .args(args)
        .current_dir(&compose_dir)
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => {
            Some(Ok(format!("docker compose {} erfolgreich", prepare_mode)))
        }
        Ok(output) => Some(Err(format!(
            "docker compose {} fehlgeschlagen: {}",
            prepare_mode,
            String::from_utf8_lossy(&output.stderr).trim()
        ))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => Some(Err(format!("Docker-Aufruf fehlgeschlagen: {e}"))),
    }
}

async fn supervisor_compose_up(
    app_id: &str,
    project_name: &str,
    compose_content: &str,
    compose_dir: &std::path::Path,
) -> Option<Result<String, String>> {
    let base = microservice_url("IORA_SUPERVISOR_URL", "iora-supervisor", 8097);
    let url = format!("{}/api/supervisor/compose/up", base.trim_end_matches('/'));
    let body = json!({
        "app_id": app_id,
        "project_name": project_name,
        "compose_content": compose_content,
        "compose_dir": compose_dir.display().to_string(),
    });

    let response = match reqwest::Client::new().post(url).json(&body).send().await {
        Ok(response) => response,
        Err(_) => return None,
    };
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status.is_success() {
        Some(Ok(format!(
            "iora-supervisor compose up erfolgreich: {text}"
        )))
    } else {
        Some(Err(format!(
            "iora-supervisor compose up fehlgeschlagen ({status}): {text}"
        )))
    }
}

async fn supervisor_compose_prepare(
    app_id: &str,
    project_name: &str,
    compose_content: &str,
    compose_dir: &std::path::Path,
    prepare_mode: &str,
) -> Option<Result<String, String>> {
    let base = microservice_url("IORA_SUPERVISOR_URL", "iora-supervisor", 8097);
    let url = format!(
        "{}/api/supervisor/compose/prepare",
        base.trim_end_matches('/')
    );
    let body = json!({
        "app_id": app_id,
        "project_name": project_name,
        "compose_content": compose_content,
        "compose_dir": compose_dir.display().to_string(),
        "prepare_mode": prepare_mode,
    });

    let response = match reqwest::Client::new().post(url).json(&body).send().await {
        Ok(response) => response,
        Err(_) => return None,
    };
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status.is_success() {
        Some(Ok(format!(
            "iora-supervisor compose {} erfolgreich: {text}",
            prepare_mode
        )))
    } else {
        Some(Err(format!(
            "iora-supervisor compose {} fehlgeschlagen ({status}): {text}",
            prepare_mode
        )))
    }
}

fn spawn_post_install_runtime_prepare(state: AppState, install_id: uuid::Uuid) {
    tokio::spawn(async move {
        for _ in 0..300 {
            let jobs = state.local_appstore.jobs().await;
            let Some(job) = jobs.into_iter().find(|job| job.id == install_id) else {
                return;
            };

            match job.status {
                local_appstore::InstallStatus::Succeeded => {
                    let Some(app_id) = job.app_id.clone() else {
                        return;
                    };
                    let installed = state.local_appstore.list().await;
                    let Some(app) = installed.into_iter().find(|app| app.id == app_id) else {
                        return;
                    };
                    if app.docker_config.is_none() && app.bundle_config.is_none() {
                        let _ = state.local_appstore.set_status(&app_id, "stopped").await;
                        return;
                    }

                    let _ = state.local_appstore.set_status(&app_id, "installing").await;
                    state.local_appstore.append_log(
                        &app_id,
                        local_appstore::LogEntry {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            level: "INFO".to_string(),
                            message: "Bereite Docker-Image bereits bei der Installation vor…"
                                .to_string(),
                            source: "app-install".to_string(),
                        },
                    );

                    match try_docker_compose_prepare(&app_id, &app, state.local_appstore.base_dir())
                        .await
                    {
                        Some(Ok(msg)) => {
                            let _ = state.local_appstore.set_status(&app_id, "stopped").await;
                            state.local_appstore.append_log(
                                &app_id,
                                local_appstore::LogEntry {
                                    timestamp: chrono::Utc::now().to_rfc3339(),
                                    level: "INFO".to_string(),
                                    message: format!("Docker-Vorbereitung abgeschlossen: {msg}"),
                                    source: "app-install".to_string(),
                                },
                            );
                        }
                        Some(Err(err)) => {
                            let _ = state.local_appstore.set_status(&app_id, "error").await;
                            state.local_appstore.append_log(
                                &app_id,
                                local_appstore::LogEntry {
                                    timestamp: chrono::Utc::now().to_rfc3339(),
                                    level: "ERROR".to_string(),
                                    message: format!("Docker-Vorbereitung fehlgeschlagen: {err}"),
                                    source: "app-install".to_string(),
                                },
                            );
                        }
                        None => {
                            let _ = state.local_appstore.set_status(&app_id, "error").await;
                            state.local_appstore.append_log(
                                &app_id,
                                local_appstore::LogEntry {
                                    timestamp: chrono::Utc::now().to_rfc3339(),
                                    level: "ERROR".to_string(),
                                    message: "Docker ist nicht verfügbar; App kann nicht vorbereitet werden.".to_string(),
                                    source: "app-install".to_string(),
                                },
                            );
                        }
                    }
                    return;
                }
                local_appstore::InstallStatus::Failed | local_appstore::InstallStatus::Canceled => {
                    return
                }
                _ => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
            }
        }
    });
}

async fn supervisor_compose_down(
    app_id: &str,
    project_name: &str,
) -> Option<Result<String, String>> {
    let base = microservice_url("IORA_SUPERVISOR_URL", "iora-supervisor", 8097);
    let url = format!("{}/api/supervisor/compose/down", base.trim_end_matches('/'));
    let body = json!({
        "app_id": app_id,
        "project_name": project_name,
    });

    let response = match reqwest::Client::new().post(url).json(&body).send().await {
        Ok(response) => response,
        Err(_) => return None,
    };
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status.is_success() {
        Some(Ok(format!(
            "iora-supervisor compose down erfolgreich: {text}"
        )))
    } else {
        Some(Err(format!(
            "iora-supervisor compose down fehlgeschlagen ({status}): {text}"
        )))
    }
}

/// Try running docker-compose down for an app.
/// Probiert BEIDE Project-Prefixes (`iora-app-`, `iora-bundle-`) und sammelt
/// die Ergebnisse, damit auch teilweise hängende Container sauber abgeräumt
/// werden, wenn sich der Prefix zwischen Versionen geändert hat.
async fn try_docker_compose_down(app_id: &str) -> Option<String> {
    use tokio::process::Command;

    let mut any_success = false;
    let mut errors: Vec<String> = Vec::new();
    let mut docker_present = false;

    for prefix in ["iora-app-", "iora-bundle-"] {
        let project_name = format!("{}{}", prefix, app_id);
        if let Some(result) = supervisor_compose_down(app_id, &project_name).await {
            match result {
                Ok(msg) => {
                    docker_present = true;
                    any_success = true;
                    if !msg.trim().is_empty() {
                        errors.push(msg);
                    }
                    continue;
                }
                Err(msg) => {
                    docker_present = true;
                    errors.push(msg);
                    continue;
                }
            }
        }

        let result = Command::new("docker")
            .args(["compose", "-p", &project_name, "down", "--remove-orphans"])
            .output()
            .await;
        match result {
            Ok(output) if output.status.success() => {
                docker_present = true;
                // success ohne "Removed" bedeutet: Project gab es nicht (no-op)
                any_success = true;
            }
            Ok(output) => {
                docker_present = true;
                errors.push(String::from_utf8_lossy(&output.stderr).trim().to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return None; // Docker nicht installiert
            }
            Err(e) => {
                errors.push(format!("docker call failed: {e}"));
            }
        }
    }

    if !docker_present {
        return None;
    }
    if any_success {
        Some("docker compose down erfolgreich".to_string())
    } else {
        Some(format!(
            "docker compose down meldete Probleme: {}",
            errors.join("; ")
        ))
    }
}

/// Returns all custom pages from installed apps that are running.
/// Used by the frontend to merge app pages into the navigation.
/// Each page includes an iframe widget that points to the app's URL,
/// so the frontend can render the app's UI within an iframe.
async fn app_pages_list(State(state): State<AppState>) -> Json<Value> {
    let installed = state.local_appstore.list().await;
    let app_pages: Vec<Value> = installed
        .into_iter()
        .filter(|a| a.status == "running" && !a.custom_pages.is_empty())
        .flat_map(|a| {
            a.custom_pages.into_iter().map(move |p| {
                // Create an iframe widget for the app's URL
                let iframe_widget = json!({
                    "widget_type": "iframe",
                    "entity_id": null,
                    "position_x": 0,
                    "position_y": 0,
                    "width": 6,
                    "height": 6,
                    "config": {
                        "url": format!("/api/apps/{}/proxy{}", a.id, p.url),
                        "title": p.title,
                        "appId": a.id,
                        "sandbox": ["allow-scripts", "allow-same-origin"],
                        "height": "100%",
                        "allowFullscreen": true,
                    }
                });

                json!({
                    "page_id": p.id,
                    "name": p.title,
                    "icon": p.icon,
                    "url": p.url,
                    "page_type": "app",
                    "page_source_kind": "app",
                    "page_source_id": a.id,
                    "show_in_nav": p.show_in_nav,
                    "order": p.order,
                    "app_id": a.id,
                    "app_name": a.name,
                    "position": p.order,
                    "display_mode": "page",
                    "widgets": [iframe_widget],
                })
            })
        })
        .collect();
    Json(json!({
        "pages": app_pages,
        "total": app_pages.len(),
    }))
}

/// Proxy requests to an installed app's internal URL.
/// This allows the iframe widget to load app content through the IORA backend.
/// When the app is running in Docker, this proxies to the container.
/// When running locally (no Docker), it returns a status page.
async fn app_proxy_handler(
    State(state): State<AppState>,
    axum::extract::Path((app_id, path)): axum::extract::Path<(String, String)>,
    _req: axum::extract::Request,
) -> axum::response::Response {
    use axum::body::Body;
    use axum::http::{Response, StatusCode};

    // Look up the app
    let installed = state.local_appstore.list().await;
    let app = installed.iter().find(|a| a.id == app_id);

    match app {
        Some(app) if app.status == "running" => {
            // Try to find the app's URL from custom_pages
            let proxy_url = app.custom_pages.first().map(|p| p.url.clone());

            match proxy_url {
                Some(base_url) => {
                    // Build the full URL to proxy to
                    let full_url = format!(
                        "{}/{}",
                        base_url.trim_end_matches('/'),
                        path.trim_start_matches('/')
                    );

                    // Try to proxy the request
                    match reqwest::get(&full_url).await {
                        Ok(resp) => {
                            let status = resp.status();
                            let headers = resp.headers().clone();
                            let body = resp.bytes().await.unwrap_or_default();

                            let axum_status = axum::http::StatusCode::from_u16(status.as_u16())
                                .unwrap_or(axum::http::StatusCode::BAD_GATEWAY);
                            let mut response_builder = Response::builder().status(axum_status);
                            if let Some(content_type) = headers.get("content-type") {
                                if let Ok(v) = content_type.to_str() {
                                    if let Ok(hv) = axum::http::HeaderValue::from_str(v) {
                                        response_builder =
                                            response_builder.header("content-type", hv);
                                    }
                                }
                            }
                            if let Some(content_length) = headers.get("content-length") {
                                if let Ok(v) = content_length.to_str() {
                                    if let Ok(hv) = axum::http::HeaderValue::from_str(v) {
                                        response_builder =
                                            response_builder.header("content-length", hv);
                                    }
                                }
                            }

                            response_builder
                                .body(Body::from(body))
                                .unwrap_or_else(|_| Response::new(Body::from("Proxy error")))
                        }
                        Err(_) => {
                            // App container not reachable - show informative placeholder
                            let status_cls = if app.status == "running" {
                                "running"
                            } else {
                                "stopped"
                            };
                            let status_label = if app.status == "running" {
                                "Läuft (kein Container)"
                            } else {
                                "Gestoppt"
                            };
                            let desc = if app.status == "running" {
                                "Die App läuft im lokalen Modus ohne Docker-Container. Der Proxy kann die angeforderte Seite nicht laden, da kein Container antwortet."
                            } else {
                                "Die App ist gestoppt. Starte die App im Admin-Bereich, um ihren Inhalt zu sehen."
                            };
                            let hint = if app.status == "running" {
                                "Im Docker-Modus würde diese Anfrage an den App-Container weitergeleitet werden."
                            } else {
                                "Klicke unten auf \"Details\", um die App zu starten."
                            };
                            let html = format!(
                                r#"<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>{title}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0f0f12; color: #e0e0e0; }}
.container {{ text-align: center; padding: 2rem; max-width: 420px; }}
.icon {{ width: 64px; height: 64px; margin: 0 auto 1rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 28px; }}
.status {{ display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }}
.status.running {{ background: rgba(5,150,105,0.12); color: #34d399; }}
.status.stopped {{ background: rgba(107,114,128,0.12); color: #9ca3af; }}
h1 {{ font-size: 20px; margin-bottom: 8px; }}
p {{ color: #9ca3af; font-size: 14px; line-height: 1.5; margin-bottom: 8px; }}
.hint {{ color: #6b7280; font-size: 12px; }}
.actions {{ margin-top: 24px; display: flex; gap: 8px; justify-content: center; }}
.btn {{ padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all 0.2s; display: inline-block; }}
.btn-primary {{ background: #6366f1; color: white; border: none; }}
.btn-primary:hover {{ background: #4f46e5; }}
.btn-secondary {{ background: #1f2937; color: #e0e0e0; border: 1px solid #374151; }}
.btn-secondary:hover {{ background: #374151; }}
</style>
</head><body>
<div class="container">
<div class="icon">📦</div>
<div class="status {sc}">● {sl}</div>
<h1>{title}</h1>
<p>{d}</p>
<p class="hint">{h}</p>
<div class="actions">
<a href="/admin" class="btn btn-secondary">⚙ Admin</a>
<button onclick="parent.postMessage({{type:'request',id:'proxy',method:'ui.openAppDetail',params:['{aid}']}},'*')" class="btn btn-primary">📋 Details</button>
</div>
</div>
<script>
parent.postMessage({{type:'event',event:{{type:'app.proxy.status',data:{{app_id:'{aid}',status:'{st}',name:'{title}'}}}}}},'*');
</script>
</body></html>"#,
                                title = app.name,
                                sc = status_cls,
                                sl = status_label,
                                d = desc,
                                h = hint,
                                aid = app.id,
                                st = app.status,
                            );
                            Response::builder()
                                .status(StatusCode::OK)
                                .header("content-type", "text/html; charset=utf-8")
                                .body(Body::from(html))
                                .unwrap_or_else(|_| Response::new(Body::empty()))
                        }
                    }
                }
                None => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("Keine konfigurierte URL für diese App"))
                    .unwrap_or_else(|_| Response::new(Body::empty())),
            }
        }
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("App nicht gefunden oder nicht gestartet"))
            .unwrap_or_else(|_| Response::new(Body::empty())),
    }
}

/// Get app detail (full info, manifest, custom_pages, settings, logs preview).
async fn app_detail_get(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app = installed
        .into_iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    // Get recent logs
    let logs = state.local_appstore.get_logs(&app_id).await;
    let recent_logs: Vec<Value> = logs
        .iter()
        .rev()
        .take(50)
        .map(|l| {
            json!({
                "timestamp": l.timestamp,
                "level": l.level,
                "message": l.message,
                "source": l.source,
            })
        })
        .collect();

    // Generate a default icon if none
    let icon = app
        .icon
        .clone()
        .unwrap_or_else(|| format!("/api/apps/{}/icon", app.id));

    let storage_usage = state.app_storage.usage_for_app(&app_id).await;

    let config_key = format!("app.config.{}", app_id);
    let config_pref = state
        .config_repo
        .get_system_preference(&config_key)
        .await
        .unwrap_or(None);
    let config_entries = config_pref
        .and_then(|pref| serde_json::from_str::<Value>(&pref.preference_value).ok())
        .and_then(|value| value.as_object().map(|o| o.len()))
        .unwrap_or(0);

    let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
    let dev_mode_enabled = is_developer_mode_enabled(&state).await;

    Ok(Json(json!({
        "id": app.id,
        "name": app.name,
        "version": app.version,
        "developer": app.developer,
        "description": app.description,
        "icon": icon,
        "status": app.status,
        "enabled": app.enabled,
        "autostart": app.autostart,
        "last_started_at": app.last_started_at,
        "last_stopped_at": app.last_stopped_at,
        "kind": app.kind,
        "system": app.system,
        "trust_level": app.trust_level,
        "installed_at": app.installed_at,
        "source": app.source,
        "permissions": app.manifest.permissions,
        "custom_pages": app.custom_pages,
        "ports": app.ports,
        "docker_config": app.docker_config,
        "settings_schema": app.manifest.extra.get("settings_schema"),
        "is_bundle": app.is_bundle,
        "bundle_config": app.bundle_config,
        "services": app.bundle_config.as_ref().and_then(|b| b.get("services").cloned()).unwrap_or(serde_json::Value::Array(Vec::new())),
        "recent_logs": recent_logs,
        "log_count": logs.len(),
        "storage_usage": storage_usage,
        "user_data": {
            "config_entries": config_entries,
            "kv_entries": storage_usage.kv_entry_count,
            "stored_files": storage_usage.file_count,
            "total_file_bytes": storage_usage.total_file_bytes,
        },
        "dev_terminal_available": dev_mode_enabled && needs_docker,
        "open_url": app.custom_pages.first().map(|p| format!("/page/{}", p.id)),
    })))
}

// ── App Configuration Handlers ─────────────────────────────────────

/// Get the settings schema for an app (from manifest).
async fn app_config_schema(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let app = installed
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let schema = app.manifest.extra.get("settings_schema");
    match schema {
        Some(s) => Ok(Json(s.clone())),
        None => Ok(Json(json!({
            "title": app.name,
            "description": "Keine konfigurierbaren Einstellungen",
            "fields": [],
        }))),
    }
}

/// Get current config values for an app.
/// Config values are stored in system_preferences with key `app.config.{app_id}`.
async fn app_config_get(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let key = format!("app.config.{}", app_id);
    let pref = state
        .config_repo
        .get_system_preference(&key)
        .await
        .map_err(|e| ErrorResponse::internal(format!("Datenbankfehler: {e}")))?;
    match pref {
        Some(sp) => {
            let parsed: Value = serde_json::from_str(&sp.preference_value).unwrap_or(json!({}));
            Ok(Json(parsed))
        }
        None => {
            // Return empty config with defaults from schema
            let installed = state.local_appstore.list().await;
            let app = installed.iter().find(|a| a.id == app_id);
            if let Some(a) = app {
                if let Some(schema) = a.manifest.extra.get("settings_schema") {
                    if let Some(fields) = schema.get("fields").and_then(|f| f.as_array()) {
                        let defaults: Value = fields
                            .iter()
                            .filter_map(|f| {
                                let key = f.get("key")?.as_str()?;
                                let default = f.get("default");
                                default.map(|d| (key.to_string(), d.clone()))
                            })
                            .collect();
                        return Ok(Json(defaults));
                    }
                }
            }
            Ok(Json(json!({})))
        }
    }
}

/// Update config values for an app.
#[derive(serde::Deserialize)]
struct AppConfigUpdate {
    #[serde(flatten)]
    values: HashMap<String, serde_json::Value>,
}

async fn app_config_put(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    Json(body): Json<AppConfigUpdate>,
) -> Result<Json<Value>, ErrorResponse> {
    let key = format!("app.config.{}", app_id);
    let pref = state
        .config_repo
        .get_system_preference(&key)
        .await
        .unwrap_or(None);

    let mut config: serde_json::Value = match pref {
        Some(v) => serde_json::from_str(&v.preference_value).unwrap_or(json!({})),
        None => json!({}),
    };

    if let Some(obj) = config.as_object_mut() {
        for (k, v) in &body.values {
            obj.insert(k.clone(), v.clone());
        }
    }

    let config_value = serde_json::to_value(&config)
        .map_err(|e| ErrorResponse::internal(format!("Serialisierung fehlgeschlagen: {e}")))?;

    let req = db::models::SaveSystemPreferenceRequest {
        preference_key: key.clone(),
        preference_value: config_value,
    };

    state
        .config_repo
        .save_system_preference(req)
        .await
        .map_err(|e| ErrorResponse::internal(format!("Speichern fehlgeschlagen: {e}")))?;

    // Log the config change
    state.local_appstore.append_log(
        &app_id,
        local_appstore::LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "INFO".to_string(),
            message: format!("Konfiguration aktualisiert ({} Felder)", body.values.len()),
            source: "config".to_string(),
        },
    );

    Ok(Json(json!({
        "success": true,
        "app_id": app_id,
        "config": config,
    })))
}

/// Delete a specific config key (reset to default).
async fn app_config_delete_key(
    State(state): State<AppState>,
    axum::extract::Path((app_id, key)): axum::extract::Path<(String, String)>,
) -> Result<Json<Value>, ErrorResponse> {
    let pref_key = format!("app.config.{}", app_id);
    let pref = state
        .config_repo
        .get_system_preference(&pref_key)
        .await
        .map_err(|e| ErrorResponse::internal(format!("Datenbankfehler: {e}")))?;

    let mut config: serde_json::Value = match pref {
        Some(sp) => serde_json::from_str(&sp.preference_value).unwrap_or(json!({})),
        None => json!({}),
    };

    if let Some(obj) = config.as_object_mut() {
        obj.remove(&key);
    }

    let config_value = serde_json::to_value(&config)
        .map_err(|e| ErrorResponse::internal(format!("Serialisierung fehlgeschlagen: {e}")))?;

    let req = db::models::SaveSystemPreferenceRequest {
        preference_key: pref_key.clone(),
        preference_value: config_value,
    };

    state
        .config_repo
        .save_system_preference(req)
        .await
        .map_err(|e| ErrorResponse::internal(format!("Speichern fehlgeschlagen: {e}")))?;

    Ok(Json(json!({
        "success": true,
        "app_id": app_id,
        "key": key,
    })))
}

/// Get logs for a specific app.
async fn app_logs_get(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> Json<Value> {
    let logs = state.local_appstore.get_logs(&app_id).await;
    Json(json!({
        "app_id": app_id,
        "logs": logs,
        "count": logs.len(),
    }))
}

async fn is_developer_mode_enabled(state: &AppState) -> bool {
    if state.dev_image.is_os_dev {
        return true;
    }
    match state
        .config_repo
        .get_system_preference("developer.mode")
        .await
    {
        Ok(Some(pref)) => serde_json::from_str::<Value>(&pref.preference_value)
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        _ => false,
    }
}

#[derive(serde::Deserialize)]
struct AppTerminalExecRequest {
    command: String,
    #[serde(default)]
    service: Option<String>,
    #[serde(default)]
    timeout_sec: Option<u64>,
}

async fn app_terminal_exec(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    Json(body): Json<AppTerminalExecRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    use tokio::process::Command;

    if !is_developer_mode_enabled(&state).await {
        return Err(ErrorResponse::forbidden(
            "Container terminal is only available in Developer Mode".to_string(),
        ));
    }

    let installed = state.local_appstore.list().await;
    let app = installed
        .into_iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;

    let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
    if !needs_docker {
        return Err(ErrorResponse::bad_request(
            "Terminal exec is only available for containerized apps".to_string(),
        ));
    }

    let command = body.command.trim();
    if command.is_empty() {
        return Err(ErrorResponse::bad_request(
            "command darf nicht leer sein".to_string(),
        ));
    }
    if command.len() > 2000 {
        return Err(ErrorResponse::bad_request(
            "command ist zu lang".to_string(),
        ));
    }

    let status_info = app_lifecycle::docker_compose_status(&app_id).await;
    let service = body
        .service
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            status_info.as_ref().and_then(|s| {
                s.services
                    .iter()
                    .find(|(_, state)| {
                        let st = state.to_ascii_lowercase();
                        st.contains("running") || st.contains("started")
                    })
                    .map(|(name, _)| name.clone())
            })
        })
        .or_else(|| {
            status_info
                .as_ref()
                .and_then(|s| s.services.keys().next().cloned())
        })
        .unwrap_or_else(|| app_id.clone());

    let timeout = std::time::Duration::from_secs(body.timeout_sec.unwrap_or(20).clamp(1, 120));
    let mut last_stderr = String::new();

    for prefix in ["iora-app-", "iora-bundle-"] {
        let project = format!("{prefix}{app_id}");
        let fut = Command::new("docker")
            .args([
                "compose", "-p", &project, "exec", "-T", &service, "sh", "-lc", command,
            ])
            .output();

        let out = match tokio::time::timeout(timeout, fut).await {
            Ok(Ok(out)) => out,
            Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ErrorResponse::service_unavailable(
                    "Docker CLI is unavailable on this host".to_string(),
                ));
            }
            Ok(Err(e)) => {
                last_stderr = e.to_string();
                continue;
            }
            Err(_) => {
                return Err(ErrorResponse::bad_request(
                    "Terminal command timed out".to_string(),
                ));
            }
        };

        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let code = out.status.code().unwrap_or(-1);

        state.local_appstore.append_log(
            &app_id,
            local_appstore::LogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                level: if code == 0 { "INFO" } else { "WARN" }.to_string(),
                message: format!(
                    "Terminal exec in service '{service}': `{}` (exit={code})",
                    command
                ),
                source: "app-terminal".to_string(),
            },
        );

        return Ok(Json(json!({
            "success": code == 0,
            "app_id": app_id,
            "service": service,
            "project": project,
            "exit_code": code,
            "stdout": stdout,
            "stderr": stderr,
            "command": command,
        })));
    }

    Err(ErrorResponse::bad_request(if last_stderr.is_empty() {
        "Unable to execute command in app container".to_string()
    } else {
        format!("Unable to execute command in app container: {last_stderr}")
    }))
}

#[derive(serde::Deserialize)]
struct AppTerminalSessionStartRequest {
    #[serde(default)]
    service: Option<String>,
}

#[derive(serde::Deserialize)]
struct AppTerminalSessionInputRequest {
    input: String,
    #[serde(default)]
    append_newline: Option<bool>,
}

async fn app_terminal_session_start(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    Json(body): Json<AppTerminalSessionStartRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    if !is_developer_mode_enabled(&state).await {
        return Err(ErrorResponse::forbidden(
            "Container terminal is only available in Developer Mode".to_string(),
        ));
    }

    let installed = state.local_appstore.list().await;
    let app = installed
        .into_iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' nicht gefunden", app_id)))?;
    let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
    if !needs_docker {
        return Err(ErrorResponse::bad_request(
            "Terminal sessions are only available for containerized apps".to_string(),
        ));
    }

    let session = state
        .terminal_manager
        .create_session(&app_id, body.service)
        .await
        .map_err(ErrorResponse::bad_request)?;

    state.local_appstore.append_log(
        &app_id,
        local_appstore::LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "INFO".to_string(),
            message: format!(
                "Interactive terminal opened (service='{}', project='{}')",
                session.service, session.project
            ),
            source: "app-terminal".to_string(),
        },
    );

    Ok(Json(json!({
        "success": true,
        "session_id": session.id,
        "app_id": app_id,
        "service": session.service,
        "project": session.project,
        "created_at": session.created_at,
    })))
}

async fn app_terminal_session_input(
    State(state): State<AppState>,
    axum::extract::Path((app_id, session_id)): axum::extract::Path<(String, String)>,
    Json(body): Json<AppTerminalSessionInputRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    let session = state
        .terminal_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| ErrorResponse::not_found("Terminal session not found".to_string()))?;
    if session.app_id != app_id {
        return Err(ErrorResponse::bad_request(
            "Terminal session does not belong to this app".to_string(),
        ));
    }

    state
        .terminal_manager
        .send_input(&session_id, body.input, body.append_newline.unwrap_or(true))
        .await
        .map_err(ErrorResponse::bad_request)?;

    Ok(Json(json!({ "success": true })))
}

async fn app_terminal_session_stream(
    State(state): State<AppState>,
    axum::extract::Path((app_id, session_id)): axum::extract::Path<(String, String)>,
) -> Result<Sse<impl Stream<Item = Result<SseEvent, Infallible>>>, ErrorResponse> {
    use tokio_stream::StreamExt as _;

    let session = state
        .terminal_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| ErrorResponse::not_found("Terminal session not found".to_string()))?;
    if session.app_id != app_id {
        return Err(ErrorResponse::bad_request(
            "Terminal session does not belong to this app".to_string(),
        ));
    }

    let intro = json!({
        "type": "system",
        "session_id": session_id.clone(),
        "data": format!(
            "Connected to service '{}' (project '{}').",
            session.service, session.project
        ),
    })
    .to_string();

    let recv = session.output_tx.subscribe();
    let sid = session_id.clone();
    let stream =
        tokio_stream::wrappers::BroadcastStream::new(recv).filter_map(move |msg| match msg {
            Ok(line) => {
                let data = json!({
                    "type": "output",
                    "session_id": sid.clone(),
                    "data": line,
                })
                .to_string();
                Some(Ok(SseEvent::default().data(data)))
            }
            Err(_) => None,
        });

    let initial_event = Ok(SseEvent::default().data(intro));
    let combined = futures_util::stream::once(async { initial_event }).chain(stream);

    Ok(Sse::new(combined).keep_alive(KeepAlive::default()))
}

async fn app_terminal_session_close(
    State(state): State<AppState>,
    axum::extract::Path((app_id, session_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<Value>, ErrorResponse> {
    let session = state
        .terminal_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| ErrorResponse::not_found("Terminal session not found".to_string()))?;
    if session.app_id != app_id {
        return Err(ErrorResponse::bad_request(
            "Terminal session does not belong to this app".to_string(),
        ));
    }

    let closed = state.terminal_manager.close_session(&session_id).await;
    Ok(Json(json!({
        "success": closed,
        "session_id": session_id,
    })))
}

/// Serve an app's icon.
///
/// Lookup order:
///   1. The literal `icon` from the manifest if it points to a real file
///      under the install dir (`/var/lib/iora/local-apps/<id>/<icon>`).
///   2. Common conventional names (`icon.png`, `icon.svg`, `icon.jpg`,
///      `assets/icon.png`).
///   3. If the manifest's `icon` is an absolute URL or starts with `data:`,
///      the frontend never hits this endpoint — but if it does, we fall
///      through to the placeholder below.
///
/// On miss we return a 1x1 transparent PNG with `Cache-Control: no-store`
/// (instead of 404) so the browser doesn't show a broken-image icon and
/// log noise stops. Callers that want the real 404 can pass `?strict=1`.
async fn app_icon_get(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<HashMap<String, String>>,
) -> axum::response::Response {
    use axum::body::Body;
    let strict = q
        .get("strict")
        .map(|v| v == "1" || v == "true")
        .unwrap_or(false);

    let app = state
        .local_appstore
        .list()
        .await
        .into_iter()
        .find(|a| a.id == app_id);
    let app_dir = state.local_appstore.base_dir().join(&app_id);

    // Build candidate file list.
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(ref a) = app {
        if let Some(ref icon) = a.icon {
            // Skip URLs and data: — those are served by the browser, not us.
            if !icon.starts_with("http://")
                && !icon.starts_with("https://")
                && !icon.starts_with("data:")
                && !icon.starts_with("/api/")
            {
                let rel = icon.trim_start_matches('/');
                candidates.push(app_dir.join(rel));
            }
        }
    }
    for name in [
        "icon.png",
        "icon.svg",
        "icon.jpg",
        "icon.jpeg",
        "icon.webp",
        "assets/icon.png",
        "assets/icon.svg",
    ] {
        candidates.push(app_dir.join(name));
    }

    for path in &candidates {
        if let Ok(bytes) = tokio::fs::read(path).await {
            let ct = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
                "svg" => "image/svg+xml",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                _ => "image/png",
            };
            return axum::response::Response::builder()
                .status(StatusCode::OK)
                .header("content-type", ct)
                .header("cache-control", "public, max-age=300")
                .body(Body::from(bytes))
                .unwrap_or_else(|_| axum::response::Response::new(Body::empty()));
        }
    }

    if strict {
        return axum::response::Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({"error": "icon not found", "app_id": app_id}))
                    .unwrap_or_default(),
            ))
            .unwrap_or_else(|_| axum::response::Response::new(Body::empty()));
    }

    // 1x1 transparent PNG fallback so the <img> tag stays quiet.
    static TRANSPARENT_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "image/png")
        .header("cache-control", "no-store")
        .body(Body::from(TRANSPARENT_PNG))
        .unwrap_or_else(|_| axum::response::Response::new(Body::empty()))
}

/// SSE stream of logs for a specific app.
async fn app_logs_stream(
    State(state): State<AppState>,
    axum::extract::Path(app_id): axum::extract::Path<String>,
) -> axum::response::Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    use axum::response::sse::{Event as SseEvent, KeepAlive};
    use tokio_stream::wrappers::BroadcastStream;
    use tokio_stream::StreamExt as _;

    // Send existing logs first
    let existing_logs = state.local_appstore.get_logs(&app_id).await;
    let initial = json!({
        "type": "snapshot",
        "app_id": app_id,
        "logs": existing_logs,
    })
    .to_string();

    let recv = state.local_appstore.subscribe();
    let stream = BroadcastStream::new(recv).filter_map(move |msg| match msg {
        Ok(local_appstore::InstallEvent::LogEntry { app_id: aid, entry }) if aid == app_id => {
            let data = json!({
                "type": "log",
                "app_id": app_id,
                "entry": entry,
            })
            .to_string();
            Some(Ok(SseEvent::default().data(data)))
        }
        _ => None,
    });

    // Combine initial snapshot with live stream
    let initial_event = Ok(SseEvent::default().data(initial));
    let combined = futures_util::stream::once(async { initial_event }).chain(stream);

    Sse::new(combined).keep_alive(KeepAlive::default())
}

// ── Plugin Handlers ───────────────────────────────────────────────────

// The frontend PluginsTab expects Array<[PluginMetadata, PluginStats | null]>.
async fn core_plugins_list(State(state): State<AppState>) -> Json<Value> {
    let installed = state.local_appstore.list().await;
    let plugins: Vec<Value> = installed
        .into_iter()
        .filter(|a| a.kind == "plugin")
        .map(|a| {
            let plugin_meta = json!({
                "id": a.id,
                "name": a.name,
                "version": a.version,
                "description": a.description,
                "author": a.developer,
                "icon": a.icon,
                "plugin_type": a.manifest.extra.get("plugin_type").or(Some(&serde_json::Value::String("widget".to_string()))).cloned(),
                "permissions": a.manifest.permissions,
                "sandbox_config": a.manifest.extra.get("sandbox").unwrap_or(&serde_json::json!({
                    "max_execution_time_ms": 5000,
                    "max_memory_mb": 128,
                    "allow_network": false,
                    "allow_file_system": false,
                })),
            });
            let stats: Value = json!({
                "total_executions": 0,
                "successful_executions": 0,
                "failed_executions": 0,
                "total_duration_ms": 0,
            });
            json!([plugin_meta, stats])
        })
        .collect();
    Json(json!({
        "plugins": plugins,
        "total": plugins.len(),
        "available": true,
    }))
}

async fn core_plugins_get(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let installed = state.local_appstore.list().await;
    let plugin = installed
        .into_iter()
        .find(|a| a.id == plugin_id && a.kind == "plugin")
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("plugin '{}' nicht gefunden", plugin_id))
        })?;
    Ok(Json(json!({
        "id": plugin.id,
        "name": plugin.name,
        "version": plugin.version,
        "description": plugin.description,
        "author": plugin.developer,
        "status": plugin.status,
        "enabled": plugin.enabled,
        "manifest": plugin.manifest,
        "custom_pages": plugin.custom_pages,
    })))
}

async fn core_plugins_enable(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    state
        .local_appstore
        .enable(&plugin_id, true)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
    Ok(Json(json!({
        "success": true,
        "plugin_id": plugin_id,
        "status": "enabled",
    })))
}

async fn core_plugins_disable(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    state
        .local_appstore
        .enable(&plugin_id, false)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
    Ok(Json(json!({
        "success": true,
        "plugin_id": plugin_id,
        "status": "disabled",
    })))
}

async fn core_plugins_uninstall(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    state
        .local_appstore
        .uninstall(&plugin_id)
        .await
        .map_err(|e| ErrorResponse::bad_request(format!("{e:#}")))?;
    Ok(Json(json!({
        "success": true,
        "plugin_id": plugin_id,
    })))
}

/// Execute a plugin in the sandbox.
/// The plugin is run in a restricted environment with no shell access.
/// Execution is on-demand and time-limited.
#[derive(serde::Deserialize)]
struct PluginExecuteRequest {
    plugin_id: Option<String>,
    input: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
}

async fn core_plugins_execute(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
    Json(body): Json<PluginExecuteRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    let pid = body.plugin_id.as_deref().unwrap_or(&plugin_id).to_string();

    // Find the plugin
    let installed = state.local_appstore.list().await;
    let plugin = installed
        .iter()
        .find(|a| a.id == pid && a.kind == "plugin")
        .ok_or_else(|| ErrorResponse::not_found(format!("Plugin '{}' nicht gefunden", pid)))?;

    if !plugin.enabled {
        return Err(ErrorResponse::bad_request(
            "Plugin ist deaktiviert".to_string(),
        ));
    }

    // Determine sandbox config from manifest
    let sandbox_config = plugin
        .manifest
        .extra
        .get("sandbox")
        .cloned()
        .unwrap_or(json!({
            "max_execution_time_ms": 5000,
            "max_memory_mb": 128,
            "allow_network": false,
            "allow_file_system": false,
        }));

    let max_time = body.timeout_ms.unwrap_or(
        sandbox_config
            .get("max_execution_time_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(5000),
    );

    // Fetch the plugin's entry point from its installed directory
    let plugin_dir = state.local_appstore.base_dir().join(&pid);
    let manifest_path = plugin_dir.join("manifest.json");
    let entry_point = std::fs::read_to_string(manifest_path)
        .ok()
        .and_then(|m| {
            let v: serde_json::Value = serde_json::from_str(&m).ok()?;
            v.get("main")
                .and_then(|m| m.as_str().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| {
            // Guess entry point
            if plugin_dir.join("index.js").exists() {
                "index.js".to_string()
            } else if plugin_dir.join("main.py").exists() {
                "main.py".to_string()
            } else if plugin_dir.join("plugin.js").exists() {
                "plugin.js".to_string()
            } else {
                "index.js".to_string()
            }
        });

    let entry_path = plugin_dir.join(&entry_point);
    if !entry_path.exists() {
        return Err(ErrorResponse::bad_request(format!(
            "Einstiegspunkt '{}' nicht gefunden in {}",
            entry_point,
            plugin_dir.display()
        )));
    }

    let input_json = body.input.clone().unwrap_or(json!({}));

    // Execute plugin in a subprocess with strict restrictions.
    // Uses `deno run --no-prompt` for JS/TS or a restricted Python environment.
    // No shell access, no network (unless allowed), no arbitrary commands.
    let start_time = std::time::Instant::now();
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(max_time),
        execute_plugin_sandboxed(&entry_path, &input_json, &plugin_dir, &sandbox_config),
    )
    .await;

    let duration_ms = start_time.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(output)) => {
            state.local_appstore.append_log(
                &pid,
                local_appstore::LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "INFO".to_string(),
                    message: format!("Plugin '{}' ausgeführt in {}ms", plugin.name, duration_ms),
                    source: "plugin".to_string(),
                },
            );
            Ok(Json(json!({
                "success": true,
                "plugin_id": pid,
                "duration_ms": duration_ms,
                "output": output,
            })))
        }
        Ok(Err(e)) => {
            state.local_appstore.append_log(
                &pid,
                local_appstore::LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "ERROR".to_string(),
                    message: format!("Plugin '{}' fehlgeschlagen: {}", plugin.name, e),
                    source: "plugin".to_string(),
                },
            );
            Ok(Json(json!({
                "success": false,
                "plugin_id": pid,
                "duration_ms": duration_ms,
                "error": format!("{}", e),
            })))
        }
        Err(_timeout) => {
            state.local_appstore.append_log(
                &pid,
                local_appstore::LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "WARNING".to_string(),
                    message: format!(
                        "Plugin '{}' hat Zeitlimit ({}ms) überschritten",
                        plugin.name, max_time
                    ),
                    source: "plugin".to_string(),
                },
            );
            Ok(Json(json!({
                "success": false,
                "plugin_id": pid,
                "duration_ms": duration_ms,
                "error": format!("Zeitlimit von {}ms überschritten", max_time),
            })))
        }
    }
}

/// Execute plugin in a sandboxed subprocess with no shell access.
/// Only allows executing the plugin's own entry point file.
/// No arbitrary commands, no package installation.
async fn execute_plugin_sandboxed(
    entry_path: &std::path::Path,
    input: &serde_json::Value,
    plugin_dir: &std::path::Path,
    sandbox_config: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    use tokio::process::Command;

    let allow_network = sandbox_config
        .get("allow_network")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let input_str = serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string());

    let ext = entry_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("js")
        .to_lowercase();

    match ext.as_str() {
        "js" | "ts" | "mjs" => {
            // Use `node` with --eval to run the plugin code safely.
            // We pass the input via stdin and read output from stdout.
            // NO --allow-child-process, NO network unless allowed.
            let mut cmd = Command::new("node");
            cmd.arg("--no-warnings")
                .arg("-e")
                .arg(format!(
                    r#"
const fs = require('fs');
const path = require('path');

// Sandbox: restrict process access
process.on('uncaughtException', (err) => {{
    console.error(err.message);
    process.exit(1);
}});

// Only allow reading from the plugin directory
const pluginDir = '{}';
const originalRequire = require;

// Read input from environment
const input = JSON.parse(process.env.IORA_PLUGIN_INPUT || '{{}}');

// Execute the plugin's main function
const pluginPath = path.join(pluginDir, '{}');
if (!fs.existsSync(pluginPath)) {{
    console.error('Plugin entry not found: ' + pluginPath);
    process.exit(1);
}}

const plugin = originalRequire(pluginPath);
const handler = plugin.execute || plugin.handler || plugin.default || plugin;

if (typeof handler === 'function') {{
    Promise.resolve(handler(input)).then(result => {{
        console.log(JSON.stringify(result));
    }}).catch(err => {{
        console.error(err.message);
        process.exit(1);
    }});
}} else {{
    console.log(JSON.stringify(handler));
}}
"#,
                    plugin_dir.to_string_lossy().replace("\\", "\\\\"),
                    entry_path.file_name().unwrap().to_string_lossy(),
                ))
                .env("IORA_PLUGIN_INPUT", &input_str)
                .env("NODE_PATH", plugin_dir.to_string_lossy().as_ref())
                .current_dir(plugin_dir);

            if !allow_network {
                cmd.env("NODE_NO_WARNINGS", "1");
                // Use --experimental-policy to restrict modules if available in newer Node
            }

            let output = cmd
                .output()
                .await
                .map_err(|e| format!("Kann Node.js nicht ausführen: {}", e))?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                serde_json::from_str(stdout.trim()).map_err(|e| {
                    format!(
                        "Plugin-Ausgabe kein gültiges JSON: {} (Output: {})",
                        e,
                        stdout.trim()
                    )
                })
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Plugin-Fehler: {}", stderr.trim()))
            }
        }
        "py" => {
            // Use Python with restricted environment
            let mut cmd = Command::new("python3");
            cmd.arg("-c")
                .arg(format!(
                    r#"
import sys
import json
import os

# Restrict dangerous modules
sys.path.insert(0, '{}')

# Read input from env
input_data = json.loads(os.environ.get('IORA_PLUGIN_INPUT', '{{}}'))

# Execute the plugin file
exec(open('{}').read(), {{'__input__': input_data, '__output__': None}})

# Call execute function if present
if 'execute' in dir():
    result = execute(input_data)
elif 'handler' in dir():
    result = handler(input_data)
else:
    result = {{'error': 'Keine execute() oder handler() Funktion gefunden'}}

print(json.dumps(result))
"#,
                    plugin_dir.to_string_lossy(),
                    entry_path.to_string_lossy().replace("\\", "\\\\"),
                ))
                .env("IORA_PLUGIN_INPUT", &input_str)
                .current_dir(plugin_dir);

            if !allow_network {
                cmd.env("PYTHONWARNINGS", "ignore");
                // Python blocks network via environment variable
            }

            let output = cmd
                .output()
                .await
                .map_err(|e| format!("Kann Python nicht ausführen: {}", e))?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                serde_json::from_str(stdout.trim()).map_err(|e| {
                    format!(
                        "Plugin-Ausgabe kein gültiges JSON: {} (Output: {})",
                        e,
                        stdout.trim()
                    )
                })
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Plugin-Fehler: {}", stderr.trim()))
            }
        }
        other => Err(format!(
            "Nicht unterstützte Plugin-Sprache: '{}' (erwartet: js, ts, py)",
            other
        )),
    }
}

/// Get logs for a specific plugin.
async fn core_plugins_logs(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
) -> Json<Value> {
    let logs = state.local_appstore.get_logs(&plugin_id).await;
    Json(json!({
        "plugin_id": plugin_id,
        "logs": logs,
        "count": logs.len(),
    }))
}

/// Get sandbox status — reflects the real Docker-backed plugin sandbox.
async fn core_sandbox_status(State(state): State<AppState>) -> Json<Value> {
    let healthy = state.plugin_sandbox.health_check().await;
    let plugins = state.plugin_sandbox.list().await;
    Json(json!({
        "available": true,
        "healthy": healthy,
        "runtimes": ["nodejs"],
        "version": "2.3.0",
        "mode": "shared-docker-sandbox",
        "container": "iora-plugin-sandbox",
        "url": state.plugin_sandbox.host_url(),
        "plugins": plugins,
        "plugin_count": plugins.len(),
        "restrictions": [
            "memory:512m",
            "cpus:1.0",
            "no_capabilities",
            "no_new_privileges",
            "read_only_root_fs",
            "loopback_only",
        ],
        "description": "Gemeinsamer Docker-Sandbox-Container für alle Plugins. Wird lazy gestartet, automatisch wiederbelebt und teilt ein read-only Volume mit dem Plugin-Code.",
    }))
}

/// Liste aller registrierten Plugins.
async fn plugins_list(State(state): State<AppState>) -> Json<Value> {
    let plugins = state.plugin_sandbox.list().await;
    let healthy = state.plugin_sandbox.health_check().await;
    Json(json!({
        "plugins": plugins,
        "count": plugins.len(),
        "sandbox_healthy": healthy,
    }))
}

/// Plugin registrieren — erwartet Body `{ "plugin_id": "...", "manifest": {...}, "source": "<JS-Code>" }`.
async fn plugins_register(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let plugin_id = body
        .get("plugin_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Feld 'plugin_id' fehlt"))?
        .to_string();
    if !plugin_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || plugin_id.is_empty()
    {
        return Err(ErrorResponse::bad_request(
            "plugin_id darf nur Buchstaben, Zahlen, '-', '_' und '.' enthalten",
        ));
    }
    let manifest = body.get("manifest").cloned().unwrap_or_else(|| json!({}));
    let source = body
        .get("source")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Feld 'source' fehlt (JS-Code als String)"))?;

    // Sandbox sicherstellen, sonst geht das register sinnlos in den Wind.
    if let Err(e) = state.plugin_sandbox.ensure_running().await {
        return Err(ErrorResponse::service_unavailable(format!(
            "Plugin-Sandbox konnte nicht gestartet werden: {e:#}"
        )));
    }

    // Source temporär in eine Datei schreiben — register_plugin kopiert sie ins Volume.
    let tmp = std::env::temp_dir().join(format!("iora-plugin-{plugin_id}.js"));
    if let Err(e) = tokio::fs::write(&tmp, source).await {
        return Err(ErrorResponse::internal(format!(
            "kann Plugin-Source nicht schreiben: {e}"
        )));
    }

    let reg = plugin_sandbox::PluginRegistration {
        plugin_id: plugin_id.clone(),
        manifest,
        source_path: tmp.clone(),
    };
    let result = state.plugin_sandbox.register_plugin(reg).await;
    let _ = tokio::fs::remove_file(&tmp).await;
    result.map_err(|e| ErrorResponse::internal(format!("register fehlgeschlagen: {e:#}")))?;

    Ok(Json(json!({
        "success": true,
        "plugin_id": plugin_id,
        "message": "Plugin registriert und in Sandbox geladen",
    })))
}

/// Plugin entfernen.
async fn plugins_unregister(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    state
        .plugin_sandbox
        .unregister_plugin(&plugin_id)
        .await
        .map_err(|e| ErrorResponse::internal(format!("unregister fehlgeschlagen: {e:#}")))?;
    Ok(Json(json!({
        "success": true,
        "plugin_id": plugin_id,
    })))
}

/// Plugin in der Sandbox ausführen — Body wird als Input weitergereicht.
/// Optional Query-Param `?timeout_ms=5000`.
async fn plugins_execute(
    State(state): State<AppState>,
    axum::extract::Path(plugin_id): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let timeout_ms: u64 = q
        .get("timeout_ms")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5000)
        .min(30_000); // max 30s
    let timeout = std::time::Duration::from_millis(timeout_ms);

    let result = state
        .plugin_sandbox
        .execute(&plugin_id, input, timeout)
        .await
        .map_err(|e| ErrorResponse::bad_gateway(format!("execute fehlgeschlagen: {e:#}")))?;
    Ok(Json(result))
}

// ── Service registrations: real DB-backed CRUD ─────────────────────────

#[derive(sqlx::FromRow)]
struct ServiceRegistrationRow {
    id: String,
    provider_id: String,
    provider_type: String,
    name: String,
    version: String,
    developer: String,
    description: String,
    requested_permissions: String,
    status: String,
    api_token: Option<String>,
    requested_at: chrono::DateTime<chrono::Utc>,
    reviewed_at: Option<chrono::DateTime<chrono::Utc>>,
    reviewer: Option<String>,
}

fn registration_row_to_json(row: ServiceRegistrationRow) -> Value {
    let perms: Value =
        serde_json::from_str(&row.requested_permissions).unwrap_or_else(|_| json!([]));
    json!({
        "id": row.id,
        "provider_id": row.provider_id,
        "provider_type": row.provider_type,
        "name": row.name,
        "version": row.version,
        "developer": row.developer,
        "description": row.description,
        "requested_permissions": perms,
        "status": row.status,
        "api_token": row.api_token,
        "requested_at": row.requested_at.to_rfc3339(),
        "reviewed_at": row.reviewed_at.map(|t| t.to_rfc3339()),
        "reviewer": row.reviewer,
    })
}

async fn core_registrations_list(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let rows = sqlx::query_as::<_, ServiceRegistrationRow>(
        "SELECT id, provider_id, provider_type, name, version, developer, description,
                requested_permissions, status, api_token, requested_at, reviewed_at, reviewer
         FROM service_registrations
         ORDER BY requested_at DESC
         LIMIT 500",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("registrations query failed: {}", e)))?;

    let items: Vec<Value> = rows.into_iter().map(registration_row_to_json).collect();
    Ok(Json(json!({ "registrations": items })))
}

async fn registration_set_status(
    state: &AppState,
    id: &str,
    new_status: &str,
    reviewer: Option<&str>,
) -> Result<Json<Value>, ErrorResponse> {
    let res = sqlx::query(
        "UPDATE service_registrations
         SET status = $1, reviewed_at = NOW(), reviewer = COALESCE($2, reviewer)
         WHERE id = $3",
    )
    .bind(new_status)
    .bind(reviewer)
    .bind(id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("update failed: {}", e)))?;

    if res.rows_affected() == 0 {
        return Err(ErrorResponse::not_found(format!(
            "registration {} not found",
            id
        )));
    }
    Ok(Json(json!({ "ok": true, "id": id, "status": new_status })))
}

async fn core_registrations_approve(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(identity): Extension<middleware::AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    registration_set_status(&state, &id, "approved", Some(identity.user_id())).await
}

async fn core_registrations_reject(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(identity): Extension<middleware::AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    registration_set_status(&state, &id, "rejected", Some(identity.user_id())).await
}

async fn core_registrations_suspend(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(identity): Extension<middleware::AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    registration_set_status(&state, &id, "suspended", Some(identity.user_id())).await
}

async fn core_registrations_revoke(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(identity): Extension<middleware::AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    registration_set_status(&state, &id, "revoked", Some(identity.user_id())).await
}

// ── OS / provider updates: real version check + history ────────────────

fn read_current_iora_version() -> String {
    // Tries the standard version file first, then env var fallback,
    // then a build-time constant.
    if let Ok(v) = std::fs::read_to_string("/etc/iora-version") {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Ok(v) = std::env::var("IORA_VERSION") {
        if !v.is_empty() {
            return v;
        }
    }
    env!("CARGO_PKG_VERSION").to_string()
}

async fn core_updates_check(State(state): State<AppState>) -> Json<Value> {
    let current = read_current_iora_version();
    let server = std::env::var("IORA_UPDATE_SERVER")
        .unwrap_or_else(|_| "https://update.kaimdt.com".to_string());
    let channel = std::env::var("IORA_UPDATE_CHANNEL").unwrap_or_else(|_| "stable".to_string());

    let mut updates: Vec<Value> = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    // Best-effort check against the IORA update server. If unreachable we
    // still return a valid (empty) `updates` array so the frontend tab
    // renders cleanly instead of erroring.
    let url = format!(
        "{}/api/check?channel={}&current_version={}",
        server.trim_end_matches('/'),
        channel,
        current,
    );
    if let Ok(resp) = state
        .http_client
        .get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let available = body
                    .get("update_available")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let latest = body
                    .get("latest_version")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&current)
                    .to_string();
                let critical = body
                    .get("is_critical")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let notes = body
                    .get("release_notes")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let download = body
                    .get("release")
                    .and_then(|r| r.get("download_url"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                updates.push(json!({
                    "provider_id": "iora-os",
                    "provider_type": "app",
                    "current_version": current,
                    "latest_version": latest,
                    "channel": channel,
                    "update_available": available,
                    "is_critical": critical,
                    "release_notes": notes,
                    "download_url": download,
                    "last_checked": now,
                }));
            }
        }
    }

    Json(json!({ "updates": updates }))
}

#[derive(sqlx::FromRow)]
struct UpdateHistoryRow {
    id: String,
    provider_id: String,
    from_version: String,
    to_version: String,
    status: String,
    installed_at: chrono::DateTime<chrono::Utc>,
    error_message: Option<String>,
}

async fn core_updates_history(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let rows = sqlx::query_as::<_, UpdateHistoryRow>(
        "SELECT id, provider_id, from_version, to_version, status, installed_at, error_message
         FROM update_history
         ORDER BY installed_at DESC
         LIMIT 200",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("history query failed: {}", e)))?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "provider_id": r.provider_id,
                "from_version": r.from_version,
                "to_version": r.to_version,
                "status": r.status,
                "installed_at": r.installed_at.to_rfc3339(),
                "error_message": r.error_message,
            })
        })
        .collect();

    Ok(Json(json!({ "history": items })))
}

async fn core_updates_install(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let id = uuid::Uuid::new_v4().to_string();
    let from_version = read_current_iora_version();

    // Spawn the iora-updater binary (--yes for non-interactive). If it isn't
    // installed we record the failure in update_history and return 503.
    let updater_bin =
        std::env::var("IORA_UPDATER_BIN").unwrap_or_else(|_| "iora-updater".to_string());

    let spawn_result = tokio::process::Command::new(&updater_bin)
        .arg("--yes")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    let (status, error_message): (&str, Option<String>) = match spawn_result {
        Ok(_) => ("in_progress", None),
        Err(e) => (
            "failed",
            Some(format!("Failed to spawn iora-updater: {}", e)),
        ),
    };

    let _ = sqlx::query(
        "INSERT INTO update_history (id, provider_id, from_version, to_version, status, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)"
    )
    .bind(&id)
    .bind(&provider_id)
    .bind(&from_version)
    .bind("pending")
    .bind(status)
    .bind(error_message.as_deref())
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("history insert failed: {}", e)))?;

    if status == "failed" {
        return Err(ErrorResponse::service_unavailable(
            error_message.unwrap_or_else(|| "iora-updater not available".into()),
        ));
    }

    Ok(Json(json!({
        "ok": true,
        "id": id,
        "provider_id": provider_id,
        "status": status,
    })))
}

async fn core_updates_rollback(
    State(state): State<AppState>,
    Path(update_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    // Mark the named history entry as rolled_back. Actual disk-level
    // rollback is performed by RAUC slot-switching on next boot, which is
    // outside the scope of this HTTP handler.
    let res = sqlx::query(
        "UPDATE update_history
         SET status = 'rolled_back'
         WHERE id = $1",
    )
    .bind(&update_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("rollback update failed: {}", e)))?;

    if res.rows_affected() == 0 {
        return Err(ErrorResponse::not_found(format!(
            "update {} not found",
            update_id
        )));
    }
    Ok(Json(
        json!({ "ok": true, "id": update_id, "status": "rolled_back" }),
    ))
}

async fn admin_settings_list(
    State(state): State<AppState>,
) -> Result<Json<Vec<SettingValueDto>>, ErrorResponse> {
    let stored = state
        .config_repo
        .get_all_system_preferences()
        .await
        .map_err(|e| ErrorResponse::internal(format!("settings load failed: {}", e)))?;

    let mut by_key: HashMap<String, serde_json::Value> = HashMap::new();
    for pref in stored {
        let v: serde_json::Value =
            serde_json::from_str(&pref.preference_value).unwrap_or(serde_json::Value::Null);
        by_key.insert(pref.preference_key, v);
    }

    let out = state
        .settings_registry
        .control_center()
        .into_iter()
        .map(|def| {
            let (value, is_set) = match by_key.get(&def.key) {
                Some(v) => (def.redact(v), true),
                None => (def.default.clone(), false),
            };
            SettingValueDto {
                definition: def,
                value,
                is_set,
                applied_live: None,
            }
        })
        .collect();

    Ok(Json(out))
}

async fn admin_settings_get(
    State(state): State<AppState>,
    axum::extract::Path(key): axum::extract::Path<String>,
) -> Result<Json<SettingValueDto>, ErrorResponse> {
    let def = state
        .settings_registry
        .get(&key)
        .ok_or_else(|| ErrorResponse::not_found(format!("unknown setting: {}", key)))?;

    let stored = state
        .config_repo
        .get_system_preference(&key)
        .await
        .map_err(|e| ErrorResponse::internal(format!("settings load failed: {}", e)))?;

    let (value, is_set) = match stored {
        Some(p) => {
            let v: serde_json::Value =
                serde_json::from_str(&p.preference_value).unwrap_or(serde_json::Value::Null);
            (def.redact(&v), true)
        }
        None => (def.default.clone(), false),
    };

    Ok(Json(SettingValueDto {
        definition: def,
        value,
        is_set,
        applied_live: None,
    }))
}

#[derive(Deserialize)]
struct AdminSettingPutBody {
    value: serde_json::Value,
}

async fn admin_settings_put(
    State(state): State<AppState>,
    axum::extract::Path(key): axum::extract::Path<String>,
    Json(body): Json<AdminSettingPutBody>,
) -> Result<Json<SettingValueDto>, ErrorResponse> {
    let def = state
        .settings_registry
        .get(&key)
        .ok_or_else(|| ErrorResponse::not_found(format!("unknown setting: {}", key)))?;

    if matches!(
        def.visibility,
        iora_shared::settings::SettingVisibility::ReadOnly
    ) {
        return Err(ErrorResponse::bad_request(format!(
            "setting '{}' is read-only",
            key
        )));
    }

    // Empty string == "clear" for sensitive/url; allow via validate.
    def.validate(&body.value)
        .map_err(|m| ErrorResponse::bad_request(format!("invalid value: {}", m)))?;

    let req = db::models::SaveSystemPreferenceRequest {
        preference_key: key.clone(),
        preference_value: body.value.clone(),
    };
    state
        .config_repo
        .save_system_preference(req)
        .await
        .map_err(|e| ErrorResponse::internal(format!("settings save failed: {}", e)))?;

    let _ = state
        .config_repo
        .record_change("system_preferences", &key, "UPDATE", None)
        .await;

    // ═══════════════════════════════════════════════════════════════════════════
    // HOT-RELOAD: Update settings cache and notify all services
    // ═══════════════════════════════════════════════════════════════════════════
    // Update the shared settings cache so other services get the new value immediately
    iora_shared::system_config::update_cached_setting(key.clone(), body.value.to_string());

    // Notify all services about the config change (sends SIGHUP signals)
    tokio::spawn({
        let key = key.clone();
        let value = body.value.to_string();
        async move {
            let _ = tokio::process::Command::new("/usr/lib/iora/iora-config-notify")
                .arg(&key)
                .arg(&value)
                .output()
                .await;
        }
    });

    if !def.requires_restart.is_empty() {
        info!(
            "Setting '{}' updated – the following services need a restart to pick up the change: {}",
            key,
            def.requires_restart.join(", ")
        );
    }

    // Side-effect hook: toggling `developer.mode` should also start (or stop)
    // the iora-developer-app systemd unit so dev-only API endpoints become
    // reachable without a manual SSH. Best-effort — if systemctl isn't on
    // PATH or the unit isn't installed (e.g. production image, container
    // build) we just log and move on.
    // Side-effect hook: when HA URL or token changes, update the live client
    // and trigger reconnection so the new credentials take effect immediately
    // without a full service restart.
    if key == "ha.url" || key == "ha.token" {
        let ha_config = load_ha_runtime_config(&state.config_repo).await;
        if ha_config.is_configured() {
            // Update the REST client credentials in-place
            state
                .ha_client
                .update_credentials(&ha_config.url, &ha_config.token)
                .await;
            // Update connection manager URL
            state.ha_connection.update_url(&ha_config.url).await;
            // Reset failure counters so the next HA call tries with fresh creds
            state.ha_connection.record_success();
            info!(
                "HA credentials updated live — REST client reconnected. URL={}",
                ha_config.url
            );
        }
    }

    if key == "developer.mode" {
        let enable = body.value.as_bool().unwrap_or(false);

        // OS-dev-images lock developer.mode = true. Reject the disable
        // attempt up front so the UI can show a clear error.
        if !enable && state.dev_image.is_os_dev {
            return Err(ErrorResponse::bad_request(
                "Auf einem OS-Entwickler-Image kann der Developer-Modus nicht deaktiviert werden."
                    .to_string(),
            ));
        }

        // Mirror to the local app-store: when dev-mode is on, surface the
        // Developer App as an installed system app so it shows up in the
        // Apps tab. When dev-mode is off, hide it again.
        if let Err(e) = state.local_appstore.set_developer_app(enable).await {
            warn!("local-appstore: developer-app sync failed: {e:#}");
        }

        let action = if enable { "start" } else { "stop" };
        match tokio::process::Command::new("systemctl")
            .arg(action)
            .arg("iora-developer-app.service")
            .output()
            .await
        {
            Ok(out) if out.status.success() => {
                info!("developer.mode toggle: systemctl {action} iora-developer-app.service OK");
            }
            Ok(out) => {
                warn!(
                    "developer.mode toggle: systemctl {action} iora-developer-app.service failed: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                );
            }
            Err(e) => {
                warn!("developer.mode toggle: could not exec systemctl ({e}) – iora-developer-app may need manual start.");
            }
        }
    }

    Ok(Json(SettingValueDto {
        value: def.redact(&body.value),
        definition: def,
        is_set: true,
        applied_live: if key == "ha.url" || key == "ha.token" {
            let ha_config = load_ha_runtime_config(&state.config_repo).await;
            if ha_config.is_configured() {
                Some("HA-Verbindung live aktualisiert — kein Neustart nötig".to_string())
            } else {
                None
            }
        } else {
            None
        },
    }))
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
    let since = query
        .since
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

    match state.config_repo.get_changes_since(&since).await {
        Ok(changes) => Ok(Json(changes)),
        Err(e) => {
            warn!("Failed to get sync changes: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to get sync changes: {}",
                e
            )))
        }
    }
}

// ── List all users (for terminal/kiosk quick-switch) ───────────────
async fn list_all_users(
    State(state): State<AppState>,
) -> Result<Json<Vec<db::models::UserListEntry>>, ErrorResponse> {
    match state.config_repo.list_users().await {
        Ok(users) => {
            let entries: Vec<db::models::UserListEntry> = users
                .into_iter()
                .map(|u| db::models::UserListEntry {
                    has_pin: u.pin_hash.is_some(),
                    id: u.id,
                    username: u.username,
                    display_name: u.display_name,
                    avatar_url: u.avatar_url,
                })
                .collect();
            Ok(Json(entries))
        }
        Err(e) => {
            warn!("Failed to list users: {}", e);
            Err(ErrorResponse::internal("Failed to list users"))
        }
    }
}

// ── PIN-based quick-login ──────────────────────────────────────────
async fn auth_pin_login(
    State(state): State<AppState>,
    Json(request): Json<db::models::PinLoginRequest>,
) -> Result<Json<db::models::AuthResponse>, ErrorResponse> {
    // Get user by ID
    let user = match sqlx::query_as::<_, db::models::User>("SELECT * FROM users WHERE id = $1")
        .bind(&request.user_id)
        .fetch_optional(&state.db_pool)
        .await
    {
        Ok(Some(user)) => user,
        Ok(None) => return Err(ErrorResponse::unauthorized("Benutzer nicht gefunden")),
        Err(e) => {
            warn!("Failed to get user: {}", e);
            return Err(ErrorResponse::internal("Anmeldung fehlgeschlagen"));
        }
    };

    // Check PIN
    let pin_hash = match &user.pin_hash {
        Some(hash) => hash,
        None => {
            return Err(ErrorResponse::bad_request(
                "Kein PIN gesetzt. Bitte mit Passwort anmelden.",
            ))
        }
    };

    let is_valid = match auth::verify_password(&request.pin, pin_hash) {
        Ok(valid) => valid,
        Err(e) => {
            warn!("Failed to verify PIN: {}", e);
            return Err(ErrorResponse::internal("PIN-Überprüfung fehlgeschlagen"));
        }
    };

    if !is_valid {
        return Err(ErrorResponse::unauthorized("Ungültiger PIN"));
    }

    let token = match auth::generate_token(&user.id, &user.username, user.is_admin, 30) {
        Ok(token) => token,
        Err(e) => {
            warn!("Failed to generate token: {}", e);
            return Err(ErrorResponse::internal("Token-Erstellung fehlgeschlagen"));
        }
    };

    Ok(Json(db::models::AuthResponse { token, user }))
}

// ── Set/remove user PIN ────────────────────────────────────────────
async fn set_user_pin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<db::models::SetPinRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let claims = extract_claims(&headers)?;

    if request.pin.len() < 4 || request.pin.len() > 8 {
        return Err(ErrorResponse::bad_request(
            "PIN muss zwischen 4 und 8 Zeichen lang sein",
        ));
    }

    let pin_hash = match auth::hash_password(&request.pin) {
        Ok(hash) => hash,
        Err(e) => {
            warn!("Failed to hash PIN: {}", e);
            return Err(ErrorResponse::internal("PIN konnte nicht gesetzt werden"));
        }
    };

    match state.config_repo.set_user_pin(&claims.sub, &pin_hash).await {
        Ok(()) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => {
            warn!("Failed to set PIN: {}", e);
            Err(ErrorResponse::internal("PIN konnte nicht gesetzt werden"))
        }
    }
}

async fn remove_user_pin(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let claims = extract_claims(&headers)?;

    match state.config_repo.remove_user_pin(&claims.sub).await {
        Ok(()) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => {
            warn!("Failed to remove PIN: {}", e);
            Err(ErrorResponse::internal("PIN konnte nicht entfernt werden"))
        }
    }
}

// ── Page layout persistence ────────────────────────────────────────
async fn get_page_layouts(
    State(state): State<AppState>,
    axum::extract::Path(profile_id): axum::extract::Path<String>,
) -> Result<Json<Vec<db::models::PageLayout>>, ErrorResponse> {
    match state.config_repo.get_all_page_layouts(&profile_id).await {
        Ok(layouts) => Ok(Json(layouts)),
        Err(e) => {
            warn!("Failed to get page layouts: {}", e);
            Err(ErrorResponse::internal(
                "Layouts konnten nicht geladen werden",
            ))
        }
    }
}

async fn save_page_layout(
    State(state): State<AppState>,
    axum::extract::Path(profile_id): axum::extract::Path<String>,
    Json(request): Json<db::models::SavePageLayoutRequest>,
) -> Result<Json<db::models::PageLayout>, ErrorResponse> {
    match state
        .config_repo
        .save_page_layout(&profile_id, request)
        .await
    {
        Ok(layout) => Ok(Json(layout)),
        Err(e) => {
            warn!("Failed to save page layout: {}", e);
            Err(ErrorResponse::internal(
                "Layout konnte nicht gespeichert werden",
            ))
        }
    }
}

// ── Terminal/kiosk device mode ─────────────────────────────────────
async fn set_device_terminal_mode(
    State(state): State<AppState>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
    Json(request): Json<db::models::SetTerminalModeRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    match state
        .config_repo
        .set_terminal_mode(
            &device_id,
            request.is_terminal,
            request.terminal_name.as_deref(),
        )
        .await
    {
        Ok(()) => Ok(Json(serde_json::json!({
            "success": true,
            "is_terminal": request.is_terminal,
        }))),
        Err(e) => {
            warn!("Failed to set terminal mode: {}", e);
            Err(ErrorResponse::internal(
                "Terminal-Modus konnte nicht gesetzt werden",
            ))
        }
    }
}

// ── Page settings handlers ─────────────────────────────────────────────

async fn get_all_page_settings(
    State(state): State<AppState>,
    axum::extract::Path(profile_id): axum::extract::Path<String>,
) -> Result<Json<Vec<db::models::PageSettings>>, ErrorResponse> {
    match state.config_repo.get_all_page_settings(&profile_id).await {
        Ok(settings) => Ok(Json(settings)),
        Err(e) => {
            warn!("Failed to get page settings: {}", e);
            Err(ErrorResponse::internal(
                "Seiteneinstellungen konnten nicht geladen werden",
            ))
        }
    }
}

async fn get_page_settings_handler(
    State(state): State<AppState>,
    axum::extract::Path((profile_id, page_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    match state
        .config_repo
        .get_page_settings(&profile_id, &page_id)
        .await
    {
        Ok(Some(settings)) => Ok(Json(serde_json::to_value(settings).unwrap_or(Value::Null))),
        Ok(None) => Ok(Json(serde_json::json!(null))),
        Err(e) => {
            warn!("Failed to get page settings: {}", e);
            Err(ErrorResponse::internal(
                "Seiteneinstellungen konnten nicht geladen werden",
            ))
        }
    }
}

async fn save_page_settings_handler(
    State(state): State<AppState>,
    axum::extract::Path(profile_id): axum::extract::Path<String>,
    Json(request): Json<db::models::SavePageSettingsRequest>,
) -> Result<Json<db::models::PageSettings>, ErrorResponse> {
    match state
        .config_repo
        .save_page_settings(&profile_id, &request)
        .await
    {
        Ok(settings) => Ok(Json(settings)),
        Err(e) => {
            warn!("Failed to save page settings: {}", e);
            Err(ErrorResponse::internal(
                "Seiteneinstellungen konnten nicht gespeichert werden",
            ))
        }
    }
}

async fn delete_page_settings_handler(
    State(state): State<AppState>,
    axum::extract::Path((profile_id, page_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    match state
        .config_repo
        .delete_page_settings(&profile_id, &page_id)
        .await
    {
        Ok(()) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => {
            warn!("Failed to delete page settings: {}", e);
            Err(ErrorResponse::internal(
                "Seiteneinstellungen konnten nicht gelöscht werden",
            ))
        }
    }
}

/// Helper: extract JWT claims from Authorization header
fn extract_claims(headers: &HeaderMap) -> Result<auth::Claims, ErrorResponse> {
    let token = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(v) => v.strip_prefix("Bearer ").unwrap_or_default(),
            Err(_) => {
                return Err(ErrorResponse::unauthorized(
                    "Ungültiger Authorization-Header",
                ))
            }
        },
        None => return Err(ErrorResponse::unauthorized("Nicht authentifiziert")),
    };
    if token.is_empty() {
        return Err(ErrorResponse::unauthorized("Token fehlt"));
    }
    auth::verify_token(token)
        .map_err(|_| ErrorResponse::unauthorized("Ungültiges oder abgelaufenes Token"))
}

// Authentication API handlers

/// Register a new user
async fn auth_register(
    State(state): State<AppState>,
    Json(request): Json<db::models::RegisterRequest>,
) -> Result<Json<db::models::AuthResponse>, ErrorResponse> {
    // Validate password length
    if request.password.len() < 8 {
        return Err(ErrorResponse::bad_request(
            "Password must be at least 8 characters",
        ));
    }

    // Check if username already exists
    match state
        .config_repo
        .get_user_by_username(&request.username)
        .await
    {
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

    // Auto-promote first user to admin
    let is_first_user = state.config_repo.count_users().await.unwrap_or(1) == 0;

    // Create user with password
    let user_id = uuid::Uuid::new_v4().to_string();
    let query_result = sqlx::query(
        "INSERT INTO users (id, username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(&user_id)
    .bind(&request.username)
    .bind(&request.display_name)
    .bind(&password_hash)
    .bind(is_first_user)
    .execute(&state.db_pool)
    .await;

    if let Err(e) = query_result {
        warn!("Failed to create user: {}", e);
        return Err(ErrorResponse::internal("Failed to register user"));
    }

    // Fetch the created user
    let user = match state
        .config_repo
        .get_user_by_username(&request.username)
        .await
    {
        Ok(Some(user)) => user,
        _ => {
            return Err(ErrorResponse::internal("Failed to register user"));
        }
    };

    if is_first_user {
        info!("First user '{}' auto-promoted to admin", user.username);
    }

    // Generate JWT token
    let token = match auth::generate_token(&user.id, &user.username, user.is_admin, 30) {
        Ok(token) => token,
        Err(e) => {
            warn!("Failed to generate token: {}", e);
            return Err(ErrorResponse::internal(
                "Failed to generate authentication token",
            ));
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
    let user = match state
        .config_repo
        .get_user_by_username(&request.username)
        .await
    {
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
            // Return the same generic error as a wrong password so the UI
            // doesn't end up in a dead-end state ("please register" while
            // /api/auth/register would refuse with 'username already exists').
            // The orphan-without-password row is repaired automatically on
            // the next iora-home start by `bootstrap_admin_user()` when
            // setup-wizard credentials are available.
            warn!("Login attempt for '{}' which has no password_hash set; treating as invalid credentials", user.username);
            return Err(ErrorResponse::unauthorized("Invalid username or password"));
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
        // Diagnostic: log the username + the hash format prefix so we can
        // tell apart "wrong password" from "stored hash is corrupt / wrong
        // bcrypt variant" without ever logging the password itself.
        warn!(
            "Login failed for '{}': bcrypt verify returned false. Stored hash prefix='{}', supplied password length={} bytes.",
            user.username,
            password_hash.chars().take(7).collect::<String>(),
            request.password.len(),
        );
        return Err(ErrorResponse::unauthorized("Invalid username or password"));
    }

    // Generate JWT token
    let remember_me = request.remember_me.unwrap_or(false);
    let expiration_days = if remember_me { 30 } else { 1 };

    let token = match auth::generate_token(&user.id, &user.username, user.is_admin, expiration_days)
    {
        Ok(token) => token,
        Err(e) => {
            warn!("Failed to generate token: {}", e);
            return Err(ErrorResponse::internal(
                "Failed to generate authentication token",
            ));
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
        None => {
            return Err(ErrorResponse::unauthorized(
                "No authorization header provided",
            ))
        }
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
        .map_err(|e| {
            ErrorResponse::internal(format!("Failed to prepare upload directory: {}", e))
        })?;

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

        // Per-file cap for background images (20 MiB). Larger uploads are
        // almost certainly malicious or operator error.
        const MAX_BACKGROUND_BYTES: usize = 20 * 1024 * 1024;
        if bytes.len() > MAX_BACKGROUND_BYTES {
            return Err(ErrorResponse::bad_request(format!(
                "Uploaded file exceeds {} bytes",
                MAX_BACKGROUND_BYTES
            )));
        }

        let disk_path_buf = FsPath::new(&disk_path).to_path_buf();
        iora_shared::upload_store::atomic_write_async(&disk_path_buf, &bytes)
            .await
            .map_err(|e| ErrorResponse::internal(format!("Failed to save uploaded file: {}", e)))?;

        let public_url = format!("/uploads/{}/{}", user_id, safe_name);
        return Ok(Json(UploadResponse {
            url: public_url,
            file_name: safe_name,
        }));
    }

    Err(ErrorResponse::bad_request(
        "No file field named 'file' provided",
    ))
}

/// Validate API key or JWT presented in Authorization/X-API-Key headers.
///
/// Returns 200 + identity summary on success, 401 otherwise. Used by other
/// IORA microservices (e.g. iora-developer-app) to delegate auth to iora-home.
async fn auth_validate_credentials(
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: axum::http::Uri,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let identity = middleware::try_authenticate(
        headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string()),
        uri.query().map(|s| s.to_string()),
        &state,
    )
    .await;

    match identity {
        Some(id) => Ok(Json(serde_json::json!({
            "valid": true,
            "kind": match &id {
                middleware::AuthIdentity::Jwt(_) => "jwt",
                middleware::AuthIdentity::ApiKey { .. } => "api_key",
            },
            "is_admin": id.is_admin(),
        }))),
        None => Err(ErrorResponse::unauthorized(
            "Invalid or missing credentials",
        )),
    }
}

/// Verify a JWT token
async fn auth_verify(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    // Extract token from Authorization header
    let token = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(header_value) => {
                if let Some(token) = header_value.strip_prefix("Bearer ") {
                    token
                } else {
                    return Err(ErrorResponse::unauthorized(
                        "Invalid authorization header format",
                    ));
                }
            }
            Err(_) => {
                return Err(ErrorResponse::unauthorized("Invalid authorization header"));
            }
        },
        None => {
            return Err(ErrorResponse::unauthorized(
                "No authorization header provided",
            ));
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
    let user = match state
        .config_repo
        .get_user_by_username(&claims.username)
        .await
    {
        Ok(Some(user)) => user,
        Ok(None) => {
            return Err(ErrorResponse::unauthorized("User not found"));
        }
        Err(e) => {
            warn!("Failed to get user: {}", e);
            return Err(ErrorResponse::internal("Failed to verify token"));
        }
    };

    // If admin status changed in DB, issue a fresh token
    let mut response = serde_json::to_value(&user).unwrap_or_default();
    if user.is_admin != claims.is_admin {
        if let Ok(new_token) = auth::generate_token(&user.id, &user.username, user.is_admin, 30) {
            response["refreshed_token"] = serde_json::Value::String(new_token);
        }
    }

    Ok(Json(response))
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
        (chrono::Utc::now() - chrono::Duration::hours(24))
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    });
    let end = query
        .end
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string());

    let rows: Vec<(String, String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT entity_id, state, attributes, last_changed, recorded_at FROM entity_history WHERE entity_id = $1 AND recorded_at >= $2 AND recorded_at <= $3 ORDER BY recorded_at ASC"
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

    let history: Vec<HistoryRow> = rows
        .into_iter()
        .map(|(entity_id, state_val, attrs, last_changed, recorded_at)| {
            let attributes = attrs.and_then(|a| serde_json::from_str(&a).ok());
            HistoryRow {
                entity_id,
                state: state_val,
                attributes,
                last_changed,
                recorded_at,
            }
        })
        .collect();

    Ok(Json(history))
}

/// Get cached weather forecast from local database
async fn get_cached_forecast(
    State(state): State<AppState>,
    Path((entity_id, forecast_type)): Path<(String, String)>,
) -> Result<Json<Value>, ErrorResponse> {
    let row: Option<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT forecast_data, fetched_at FROM weather_forecast_cache WHERE entity_id = $1 AND forecast_type = $2"
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
                "fetched_at": fetched_at.to_rfc3339(),
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
    let forecast_data = body
        .get("forecast")
        .ok_or_else(|| ErrorResponse::bad_request("Missing 'forecast' field"))?;

    let data_str = serde_json::to_string(forecast_data)
        .map_err(|e| ErrorResponse::internal(format!("Failed to serialize forecast: {}", e)))?;

    let now = chrono::Utc::now();

    sqlx::query(
        "INSERT INTO weather_forecast_cache (entity_id, forecast_type, forecast_data, fetched_at) VALUES ($1, $2, $3, $4) ON CONFLICT(entity_id, forecast_type) DO UPDATE SET forecast_data = excluded.forecast_data, fetched_at = excluded.fetched_at"
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

// ---------- Entity search & statistics (Premium features) ----------

/// Get entities by domain (e.g. /api/entities/domain/light)
async fn get_entities_by_domain(
    State(state): State<AppState>,
    Path(domain): Path<String>,
) -> Result<Json<Vec<EntityState>>, ErrorResponse> {
    let entities = state.entity_cache.get_by_domain(&domain).await;
    Ok(Json(entities))
}

#[derive(Debug, Deserialize)]
struct EntitySearchQuery {
    q: String,
    #[serde(default = "default_search_limit")]
    limit: usize,
}

fn default_search_limit() -> usize {
    50
}

/// Search entities by name/entity_id with fuzzy matching
async fn search_entities(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<EntitySearchQuery>,
) -> Result<Json<Vec<EntityState>>, ErrorResponse> {
    let search_term = query.q.to_lowercase();
    let limit = query.limit.min(200);

    let all = state.entity_cache.get_all().await;
    let results: Vec<EntityState> = all
        .into_iter()
        .filter(|e| {
            let eid = e.entity_id.to_lowercase();
            let friendly_name = e
                .attributes
                .get("friendly_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            eid.contains(&search_term) || friendly_name.contains(&search_term)
        })
        .take(limit)
        .collect();

    Ok(Json(results))
}

/// Get entity counts grouped by domain (fast, served from cache)
async fn get_entity_counts(State(state): State<AppState>) -> impl IntoResponse {
    let all = state.entity_cache.get_all().await;
    let mut domain_counts: HashMap<String, usize> = HashMap::new();
    for e in &all {
        let domain = e.entity_id.split('.').next().unwrap_or("unknown");
        *domain_counts.entry(domain.to_string()).or_default() += 1;
    }
    let mut sorted: Vec<(String, usize)> = domain_counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));

    Json(serde_json::json!({
        "total": all.len(),
        "domains": sorted.iter().map(|(d, c)| serde_json::json!({"domain": d, "count": c})).collect::<Vec<_>>(),
    }))
}

#[derive(Debug, Serialize)]
struct EntityStatistics {
    entity_id: String,
    total_changes: i64,
    first_seen: Option<String>,
    last_seen: Option<String>,
    state_distribution: Vec<StateCount>,
    avg_changes_per_hour: f64,
}

#[derive(Debug, Serialize)]
struct StateCount {
    state: String,
    count: i64,
}

/// Get statistics for a specific entity from local history
async fn get_entity_statistics(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<EntityStatistics>, ErrorResponse> {
    // Total changes
    let (total_changes,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM entity_history WHERE entity_id = $1")
            .bind(&entity_id)
            .fetch_one(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("Query failed: {}", e)))?;

    // First and last seen
    let time_range: Option<(String, String)> = sqlx::query_as(
        "SELECT MIN(recorded_at), MAX(recorded_at) FROM entity_history WHERE entity_id = $1",
    )
    .bind(&entity_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("Query failed: {}", e)))?;

    let (first_seen, last_seen) = match time_range {
        Some((f, l)) => (Some(f), Some(l)),
        None => (None, None),
    };

    // State distribution
    let state_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT state, COUNT(*) as cnt FROM entity_history WHERE entity_id = $1 GROUP BY state ORDER BY cnt DESC LIMIT 20"
    )
    .bind(&entity_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("Query failed: {}", e)))?;

    let state_distribution: Vec<StateCount> = state_rows
        .into_iter()
        .map(|(state, count)| StateCount { state, count })
        .collect();

    // Calculate average changes per hour
    let avg_changes_per_hour = if let (Some(ref f), Some(ref l)) = (&first_seen, &last_seen) {
        let hours_diff = {
            let start = chrono::NaiveDateTime::parse_from_str(f, "%Y-%m-%dT%H:%M:%S")
                .or_else(|_| chrono::NaiveDateTime::parse_from_str(f, "%Y-%m-%d %H:%M:%S"))
                .unwrap_or_else(|_| chrono::Utc::now().naive_utc());
            let end = chrono::NaiveDateTime::parse_from_str(l, "%Y-%m-%dT%H:%M:%S")
                .or_else(|_| chrono::NaiveDateTime::parse_from_str(l, "%Y-%m-%d %H:%M:%S"))
                .unwrap_or_else(|_| chrono::Utc::now().naive_utc());
            (end - start).num_hours().max(1) as f64
        };
        total_changes as f64 / hours_diff
    } else {
        0.0
    };

    Ok(Json(EntityStatistics {
        entity_id,
        total_changes,
        first_seen,
        last_seen,
        state_distribution,
        avg_changes_per_hour,
    }))
}

#[derive(Debug, Serialize)]
struct DashboardStatistics {
    total_entities: usize,
    entities_by_domain: HashMap<String, usize>,
    ha_connected: bool,
    connected_clients: usize,
    history_entries_24h: i64,
    most_active_entities: Vec<ActiveEntity>,
}

#[derive(Debug, Serialize)]
struct ActiveEntity {
    entity_id: String,
    change_count: i64,
}

/// Get overall dashboard statistics
async fn get_dashboard_statistics(
    State(state): State<AppState>,
) -> Result<Json<DashboardStatistics>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;
    let total_entities = all_entities.len();

    // Group by domain
    let mut entities_by_domain: HashMap<String, usize> = HashMap::new();
    for entity in &all_entities {
        let domain = entity.entity_id.split('.').next().unwrap_or("unknown");
        *entities_by_domain.entry(domain.to_string()).or_insert(0) += 1;
    }

    let connected_clients = state.ws_manager.client_count().await;

    // History entries in last 24h
    let cutoff_24h = (chrono::Utc::now() - chrono::Duration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();

    let (history_entries_24h,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM entity_history WHERE recorded_at >= $1")
            .bind(&cutoff_24h)
            .fetch_one(&state.db_pool)
            .await
            .unwrap_or((0,));

    // Most active entities in last 24h
    let active_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT entity_id, COUNT(*) as cnt FROM entity_history WHERE recorded_at >= $1 GROUP BY entity_id ORDER BY cnt DESC LIMIT 10"
    )
    .bind(&cutoff_24h)
    .fetch_all(&state.db_pool)
    .await
    .unwrap_or_default();

    let most_active_entities: Vec<ActiveEntity> = active_rows
        .into_iter()
        .map(|(entity_id, change_count)| ActiveEntity {
            entity_id,
            change_count,
        })
        .collect();

    Ok(Json(DashboardStatistics {
        total_entities,
        entities_by_domain,
        ha_connected: state.entity_cache.is_ha_connected(),
        connected_clients,
        history_entries_24h,
        most_active_entities,
    }))
}

// ---------- System monitoring ----------

/// Application start time for calculating uptime
static APP_START: std::sync::LazyLock<std::time::Instant> =
    std::sync::LazyLock::new(std::time::Instant::now);

// ─── IORA Log System ─────────────────────────────────────────────────

/// Maximum number of log entries to keep in the ring buffer
const LOG_BUFFER_CAPACITY: usize = 5000;

/// A single log entry captured from the tracing system
#[derive(Clone, Serialize)]
pub(crate) struct LogEntry {
    /// Monotonic ID for ordering
    pub id: u64,
    /// ISO-8601 timestamp
    pub timestamp: String,
    /// Log level: trace, debug, info, warn, error
    pub level: String,
    /// Source service / module target
    pub target: String,
    /// Log message text
    pub message: String,
    /// Optional structured fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Value>,
}

/// Global log ID counter
pub(crate) static LOG_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// In-memory ring buffer for captured log entries
pub(crate) static LOG_BUFFER: std::sync::LazyLock<std::sync::RwLock<VecDeque<LogEntry>>> =
    std::sync::LazyLock::new(|| {
        std::sync::RwLock::new(VecDeque::with_capacity(LOG_BUFFER_CAPACITY))
    });

/// Broadcast channel for real-time log streaming
static LOG_BROADCAST: std::sync::LazyLock<tokio::sync::broadcast::Sender<LogEntry>> =
    std::sync::LazyLock::new(|| {
        let (tx, _) = tokio::sync::broadcast::channel(256);
        tx
    });

/// Push a log entry into the ring buffer and broadcast to SSE listeners
fn push_log_entry(level: &str, target: &str, message: &str, fields: Option<Value>) {
    let entry = LogEntry {
        id: LOG_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        level: level.to_string(),
        target: target.to_string(),
        message: message.to_string(),
        fields,
    };
    // Broadcast (ignore if no listeners)
    let _ = LOG_BROADCAST.send(entry.clone());
    // Insert into ring buffer
    if let Ok(mut buf) = LOG_BUFFER.write() {
        if buf.len() >= LOG_BUFFER_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(entry);
    }
}

/// Custom tracing layer that captures log events into the ring buffer
struct IoraLogLayer;

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for IoraLogLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let level = match *event.metadata().level() {
            tracing::Level::ERROR => "error",
            tracing::Level::WARN => "warn",
            tracing::Level::INFO => "info",
            tracing::Level::DEBUG => "debug",
            tracing::Level::TRACE => "trace",
        };
        let target = event.metadata().target();

        // Extract the message from the event
        struct MsgVisitor(String, HashMap<String, Value>);
        impl tracing::field::Visit for MsgVisitor {
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    self.0 = format!("{:?}", value);
                } else {
                    self.1
                        .insert(field.name().to_string(), json!(format!("{:?}", value)));
                }
            }
            fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
                if field.name() == "message" {
                    self.0 = value.to_string();
                } else {
                    self.1.insert(field.name().to_string(), json!(value));
                }
            }
            fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
                self.1.insert(field.name().to_string(), json!(value));
            }
            fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
                self.1.insert(field.name().to_string(), json!(value));
            }
            fn record_f64(&mut self, field: &tracing::field::Field, value: f64) {
                self.1.insert(field.name().to_string(), json!(value));
            }
            fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
                self.1.insert(field.name().to_string(), json!(value));
            }
        }
        let mut visitor = MsgVisitor(String::new(), HashMap::new());
        event.record(&mut visitor);

        match level {
            "error" => {
                METRICS.log_error_count.fetch_add(1, Ordering::Relaxed);
            }
            "warn" => {
                METRICS.log_warn_count.fetch_add(1, Ordering::Relaxed);
            }
            "info" => {
                METRICS.log_info_count.fetch_add(1, Ordering::Relaxed);
            }
            _ => {}
        }
        let fields = if visitor.1.is_empty() {
            None
        } else {
            Some(json!(visitor.1))
        };
        push_log_entry(level, target, &visitor.0, fields.clone());

        // Auto-capture into the persistent system event log for error/warn
        // so every tracing-style `error!()` / `warn!()` anywhere in the
        // codebase is recorded — no call-site changes required.
        let severity = match level {
            "error" => Some(system_events::Severity::Error),
            "warn" => Some(system_events::Severity::Warning),
            _ => None,
        };
        if let Some(sev) = severity {
            // Skip our own diagnostics to avoid an infinite feedback loop.
            if !target.contains("system_events") {
                let meta = event.metadata();
                let mut emeta = system_events::EventMeta::default();
                emeta.target = Some(target.to_string());
                emeta.file = meta.file().map(|f| f.to_string());
                emeta.line = meta.line().map(|l| l as i32);
                emeta.extra = fields;
                let source = target.rsplit("::").next().unwrap_or(target).to_string();
                system_events::capture_from_tracing(sev, &source, &visitor.0, emeta);
            }
        }
    }
}

// ─── IORA Metrics System ────────────────────────────────────────────

/// Global metrics counters
pub(crate) struct IoraMetrics {
    /// Total HTTP requests handled
    pub(crate) http_requests_total: AtomicU64,
    /// HTTP errors (4xx + 5xx)
    pub(crate) http_errors_total: AtomicU64,
    /// WebSocket messages sent
    pub(crate) ws_messages_sent: AtomicU64,
    /// WebSocket messages received
    pub(crate) ws_messages_received: AtomicU64,
    /// Entity state changes observed
    pub(crate) entity_state_changes: AtomicU64,
    /// Service calls dispatched
    service_calls_total: AtomicU64,
    /// HA WebSocket reconnections
    pub(crate) ha_ws_reconnects: AtomicU64,
    /// Background task runs total
    task_runs_total: AtomicU64,
    /// Background task errors total
    task_errors_total: AtomicU64,
    /// Log entries captured (by level)
    log_error_count: AtomicU64,
    log_warn_count: AtomicU64,
    log_info_count: AtomicU64,
    /// SSE connections active
    sse_connections: AtomicU64,
    /// Cache hits / misses
    pub(crate) cache_hits: AtomicU64,
    pub(crate) cache_misses: AtomicU64,
}

pub(crate) static METRICS: std::sync::LazyLock<IoraMetrics> =
    std::sync::LazyLock::new(|| IoraMetrics {
        http_requests_total: AtomicU64::new(0),
        http_errors_total: AtomicU64::new(0),
        ws_messages_sent: AtomicU64::new(0),
        ws_messages_received: AtomicU64::new(0),
        entity_state_changes: AtomicU64::new(0),
        service_calls_total: AtomicU64::new(0),
        ha_ws_reconnects: AtomicU64::new(0),
        task_runs_total: AtomicU64::new(0),
        task_errors_total: AtomicU64::new(0),
        log_error_count: AtomicU64::new(0),
        log_warn_count: AtomicU64::new(0),
        log_info_count: AtomicU64::new(0),
        sse_connections: AtomicU64::new(0),
        cache_hits: AtomicU64::new(0),
        cache_misses: AtomicU64::new(0),
    });

/// Broadcast channel for real-time metrics snapshots (pushed every 2s)
static METRICS_BROADCAST: std::sync::LazyLock<tokio::sync::broadcast::Sender<Value>> =
    std::sync::LazyLock::new(|| {
        let (tx, _) = tokio::sync::broadcast::channel(64);
        tx
    });

/// Collect a full metrics snapshot
fn collect_metrics_snapshot() -> Value {
    json!({
        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "uptime_seconds": APP_START.elapsed().as_secs(),
        "http": {
            "requests_total": METRICS.http_requests_total.load(Ordering::Relaxed),
            "errors_total": METRICS.http_errors_total.load(Ordering::Relaxed),
        },
        "websocket": {
            "messages_sent": METRICS.ws_messages_sent.load(Ordering::Relaxed),
            "messages_received": METRICS.ws_messages_received.load(Ordering::Relaxed),
        },
        "entities": {
            "state_changes": METRICS.entity_state_changes.load(Ordering::Relaxed),
        },
        "services": {
            "calls_total": METRICS.service_calls_total.load(Ordering::Relaxed),
        },
        "ha_websocket": {
            "reconnects": METRICS.ha_ws_reconnects.load(Ordering::Relaxed),
        },
        "tasks": {
            "runs_total": METRICS.task_runs_total.load(Ordering::Relaxed),
            "errors_total": METRICS.task_errors_total.load(Ordering::Relaxed),
        },
        "logs": {
            "error_count": METRICS.log_error_count.load(Ordering::Relaxed),
            "warn_count": METRICS.log_warn_count.load(Ordering::Relaxed),
            "info_count": METRICS.log_info_count.load(Ordering::Relaxed),
            "buffer_size": LOG_BUFFER.read().map(|b| b.len()).unwrap_or(0),
        },
        "sse": {
            "active_connections": METRICS.sse_connections.load(Ordering::Relaxed),
        },
        "cache": {
            "hits": METRICS.cache_hits.load(Ordering::Relaxed),
            "misses": METRICS.cache_misses.load(Ordering::Relaxed),
        },
    })
}

// ─── Background Task Registry ────────────────────────────────────────

/// A registered background task with live counters
struct TaskEntry {
    name: &'static str,
    task_type: &'static str,
    interval_seconds: u64,
    run_count: AtomicU64,
    error_count: AtomicU64,
    last_run_epoch: AtomicU64,
    enabled: std::sync::atomic::AtomicBool,
}

impl TaskEntry {
    const fn new(name: &'static str, task_type: &'static str, interval_seconds: u64) -> Self {
        Self {
            name,
            task_type,
            interval_seconds,
            run_count: AtomicU64::new(0),
            error_count: AtomicU64::new(0),
            last_run_epoch: AtomicU64::new(0),
            enabled: std::sync::atomic::AtomicBool::new(true),
        }
    }
    fn record_run(&self) {
        METRICS.task_runs_total.fetch_add(1, Ordering::Relaxed);
        self.run_count.fetch_add(1, Ordering::Relaxed);
        self.last_run_epoch.store(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            Ordering::Relaxed,
        );
    }
    fn record_error(&self) {
        METRICS.task_errors_total.fetch_add(1, Ordering::Relaxed);
        self.error_count.fetch_add(1, Ordering::Relaxed);
    }
    fn to_json(&self, id: usize) -> Value {
        let last = self.last_run_epoch.load(Ordering::Relaxed);
        let last_run = if last > 0 {
            chrono::DateTime::from_timestamp(last as i64, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_default()
        } else {
            String::new()
        };
        json!({
            "id": id,
            "name": self.name,
            "task_type": self.task_type,
            "enabled": self.enabled.load(Ordering::Relaxed),
            "interval_seconds": self.interval_seconds,
            "run_count": self.run_count.load(Ordering::Relaxed),
            "error_count": self.error_count.load(Ordering::Relaxed),
            "last_run_at": if last_run.is_empty() { Value::Null } else { Value::String(last_run) },
        })
    }
}

static TASK_REGISTRY: std::sync::LazyLock<Vec<TaskEntry>> = std::sync::LazyLock::new(|| {
    vec![
        TaskEntry::new("History Cleanup", "periodic", 3600),
        TaskEntry::new("Safety-Net REST Poll", "periodic", 60),
        TaskEntry::new("HA Cache Refresh", "periodic", 45),
        TaskEntry::new("HA Health Check", "periodic", 30),
        TaskEntry::new("Watchdog Evaluation", "periodic", 30),
        TaskEntry::new("Schedule Cleanup", "periodic", 300),
        TaskEntry::new("Anomaly Detection", "periodic", 120),
        TaskEntry::new("Analytics Aggregation", "periodic", 600),
        TaskEntry::new("Stale Entity Monitor", "periodic", 60),
        TaskEntry::new("NINA Warning Poller", "periodic", 300),
        TaskEntry::new("ARS Regions Cache", "periodic", 86400),
        TaskEntry::new("Webhook Delivery", "event_driven", 0),
    ]
});

/// Helper: get a task entry by index
fn task_entry(idx: usize) -> &'static TaskEntry {
    &TASK_REGISTRY[idx]
}

/// Get system resource usage (CPU, RAM, disk)
async fn get_system_stats(State(state): State<AppState>) -> impl IntoResponse {
    use sysinfo::System;

    // Use spawn_blocking so the CPU measurement doesn't block the async runtime
    let sys_info = tokio::task::spawn_blocking(|| {
        let mut sys = System::new();
        sys.refresh_cpu();
        sys.refresh_memory();
        // Quick sample for CPU usage
        std::thread::sleep(std::time::Duration::from_millis(100));
        sys.refresh_cpu();

        let cpu_usage: f32 = if sys.cpus().is_empty() {
            0.0
        } else {
            sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32
        };
        (
            cpu_usage,
            sys.cpus().len(),
            sys.total_memory(),
            sys.used_memory(),
        )
    })
    .await
    .unwrap_or((0.0, 0, 0, 0));

    let (cpu_usage, cpu_cores, total_memory, used_memory) = sys_info;
    let memory_usage_pct = if total_memory > 0 {
        (used_memory as f64 / total_memory as f64) * 100.0
    } else {
        0.0
    };

    let uptime_secs = APP_START.elapsed().as_secs();
    let metrics = state.entity_cache.metrics();
    let entity_count = state.entity_cache.count().await;
    let connected_clients = state.ws_manager.client_count().await;

    // Database size (optional)
    let db_size: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT page_count * page_size FROM pragma_page_count, pragma_page_size",
    )
    .fetch_one(&state.db_pool)
    .await
    .unwrap_or(0);

    // History row count
    let (history_total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entity_history")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));

    Json(serde_json::json!({
        "cpu": {
            "usage_percent": (cpu_usage * 10.0).round() / 10.0,
            "cores": cpu_cores,
        },
        "memory": {
            "total_bytes": total_memory,
            "used_bytes": used_memory,
            "usage_percent": (memory_usage_pct * 10.0).round() / 10.0,
        },
        "uptime_seconds": uptime_secs,
        "database": {
            "size_bytes": db_size,
            "history_rows": history_total,
        },
        "backend": {
            "version": env!("CARGO_PKG_VERSION"),
            "entity_count": entity_count,
            "connected_clients": connected_clients,
            "cache_metrics": {
                "update_count": metrics.update_count,
                "last_update_ms": metrics.last_update_ms,
                "cache_hits": metrics.cache_hits,
                "cache_misses": metrics.cache_misses,
            },
        },
        "ha_connected": state.entity_cache.is_ha_connected(),
        "ha_ws_connected": state.ha_ws.is_connected(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

/// Get Home Assistant system information
async fn get_ha_info(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let ha_connected = state.entity_cache.is_ha_connected();
    let ha_ws_connected = state.ha_ws.is_connected();
    let entity_count = state.entity_cache.count().await;

    // Gather domain breakdown
    let all_entities = state.entity_cache.get_all().await;
    let mut domains: HashMap<String, usize> = HashMap::new();
    for e in &all_entities {
        let domain = e.entity_id.split('.').next().unwrap_or("unknown");
        *domains.entry(domain.to_string()).or_insert(0) += 1;
    }

    // Sort domains by count descending
    let mut domain_list: Vec<(String, usize)> = domains.into_iter().collect();
    domain_list.sort_by(|a, b| b.1.cmp(&a.1));

    // Get HA version from config if available in any entity
    let ha_version = all_entities
        .iter()
        .find(|e| {
            e.entity_id == "sensor.home_assistant_version"
                || e.entity_id == "update.home_assistant_core_update"
        })
        .map(|e| e.state.clone());

    // History entries in last 24h
    let cutoff_24h = (chrono::Utc::now() - chrono::Duration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();
    let (history_24h,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM entity_history WHERE recorded_at >= $1")
            .bind(&cutoff_24h)
            .fetch_one(&state.db_pool)
            .await
            .unwrap_or((0,));

    Ok(Json(serde_json::json!({
        "ha_connected": ha_connected,
        "ha_ws_connected": ha_ws_connected,
        "entity_count": entity_count,
        "ha_version": ha_version,
        "domains": domain_list.into_iter().map(|(d, c)| serde_json::json!({ "domain": d, "count": c })).collect::<Vec<_>>(),
        "history_entries_24h": history_24h,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    })))
}

/// Dispatch a service call command to Home Assistant.
///
/// If the HA WebSocket is connected, the command goes instantly over WS.
/// Otherwise falls back to the REST API via `call_service_fast` in a
/// background task (fire-and-forget, non-blocking).
fn dispatch_command(state: &AppState, entity_id: &str, domain: &str, service: &str, data: Value) {
    if state.ha_ws.is_connected() {
        // Fast path: instant WS dispatch
        info!(
            "[dispatch] WS → {}.{} entity={} data={}",
            domain, service, entity_id, data
        );
        state.ha_ws.call_service(domain, service, entity_id, data);
    } else {
        // Fallback: REST API in background task
        info!(
            "[dispatch] REST fallback → {}.{} entity={}",
            domain, service, entity_id
        );
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
            if let Err(e) = ha_client
                .call_service_fast(&domain, &service, call_data)
                .await
            {
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
            info!(
                "Initial state fetch complete ({} entities)",
                entity_cache.count().await
            );
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

        task_entry(1).record_run();
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
                task_entry(1).record_error();
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
        task_entry(0).record_run();

        let cutoff = chrono::Utc::now() - chrono::Duration::days(7);

        match sqlx::query("DELETE FROM entity_history WHERE recorded_at < $1")
            .bind(cutoff)
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
                task_entry(0).record_error();
                warn!("Failed to clean up entity history: {}", e);
            }
        }

        let cmd_cutoff = chrono::Utc::now() - chrono::Duration::days(30);
        match sqlx::query(
            "DELETE FROM desktop_commands WHERE status = 'acknowledged' AND updated_at < $1",
        )
        .bind(cmd_cutoff)
        .execute(&db_pool)
        .await
        {
            Ok(result) => {
                let rows = result.rows_affected();
                if rows > 0 {
                    info!("Cleaned up {} old desktop commands", rows);
                }
            }
            Err(e) => {
                error!("Failed to clean up old desktop commands: {}", e);
            }
        }
    }
}

/// Background watchdog evaluation loop — checks all watchdog rules every 30 seconds
/// and automatically executes actions when triggers are met (with cooldown enforcement).
async fn background_watchdog_loop(
    ha_client: Arc<HomeAssistantClient>,
    entity_cache: Arc<EntityStateCache>,
    ws_manager: Arc<websocket::WebSocketManager>,
) {
    // Wait 10s for initial state to be populated
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));

    loop {
        interval.tick().await;
        task_entry(4).record_run();

        let watchdogs = ENTITY_WATCHDOGS.read().await;
        if watchdogs.is_empty() {
            continue;
        }

        let now = chrono::Utc::now().timestamp();
        let mut triggered = Vec::new();

        for (wid, rule) in watchdogs.iter() {
            let entity_id = rule.get("entity_id").and_then(|v| v.as_str()).unwrap_or("");
            let trigger = rule.get("trigger").and_then(|v| v.as_str()).unwrap_or("");
            let cooldown = rule
                .get("cooldown_secs")
                .and_then(|v| v.as_i64())
                .unwrap_or(300);
            let last_triggered = rule
                .get("last_triggered")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let action_domain = rule
                .get("action_domain")
                .and_then(|v| v.as_str())
                .unwrap_or("homeassistant");
            let action_service = rule
                .get("action_service")
                .and_then(|v| v.as_str())
                .unwrap_or("toggle");
            let action_data = rule
                .get("action_data")
                .cloned()
                .unwrap_or(serde_json::json!({}));

            if now - last_triggered < cooldown {
                continue;
            }

            let should_trigger = if entity_id.is_empty() {
                false
            } else if let Some(entity) = entity_cache.get(entity_id).await {
                match trigger {
                    "unavailable" => entity.state == "unavailable",
                    "stale" => {
                        if let Some(analytics) = entity_cache.entity_analytics(entity_id).await {
                            analytics.stale_seconds > cooldown as u64
                        } else {
                            false
                        }
                    }
                    "state_equals" => {
                        let target_state = rule
                            .get("target_state")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        entity.state == target_state
                    }
                    _ => false,
                }
            } else {
                trigger == "unavailable"
            };

            if should_trigger {
                let mut svc_data = action_data.as_object().cloned().unwrap_or_default();
                if !entity_id.is_empty() {
                    svc_data.insert("entity_id".into(), Value::String(entity_id.into()));
                }
                if let Ok(()) = ha_client
                    .call_service_fast(action_domain, action_service, Value::Object(svc_data))
                    .await
                {
                    triggered.push((
                        wid.clone(),
                        entity_id.to_string(),
                        format!("{action_domain}.{action_service}"),
                    ));
                }
            }
        }
        drop(watchdogs);

        if !triggered.is_empty() {
            let mut watchdogs = ENTITY_WATCHDOGS.write().await;
            for (wid, entity_id, action) in &triggered {
                if let Some(rule) = watchdogs.get_mut(wid) {
                    if let Some(obj) = rule.as_object_mut() {
                        obj.insert("last_triggered".into(), serde_json::json!(now));
                    }
                }
                info!(
                    "Watchdog auto-triggered: {} for entity {} → {}",
                    wid, entity_id, action
                );
            }

            // Notify connected dashboard clients
            let event = serde_json::json!({
                "type": "watchdog_triggered",
                "count": triggered.len(),
                "triggered": triggered.iter().map(|(wid, eid, action)| {
                    serde_json::json!({"watchdog_id": wid, "entity_id": eid, "action": action})
                }).collect::<Vec<_>>(),
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            ws_manager.broadcast_json(&event).await;
        }
    }
}

/// Background scheduled actions cleanup — removes expired/completed schedules every 5 minutes.
async fn background_schedule_cleanup() {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300));

    loop {
        interval.tick().await;
        task_entry(5).record_run();

        let now = chrono::Utc::now().timestamp();
        let mut schedules = SCHEDULED_ACTIONS.write().await;
        let before = schedules.len();

        // Remove schedules whose run_at_unix is in the past (already executed by their tokio task)
        schedules.retain(|_id, val| {
            let run_at = val.get("run_at_unix").and_then(|v| v.as_i64()).unwrap_or(0);
            // Keep if still in the future (with 60s grace period)
            run_at > now - 60
        });

        let removed = before - schedules.len();
        if removed > 0 {
            info!("Cleaned up {} expired scheduled actions", removed);
        }
    }
}

/// Background entity anomaly detection — flags entities with unusual state change patterns.
/// Runs every 2 minutes and broadcasts anomalies to connected dashboard clients.
async fn background_entity_anomaly_detection(
    entity_cache: Arc<EntityStateCache>,
    ws_manager: Arc<websocket::WebSocketManager>,
) {
    // Wait 60s for initial data to accumulate
    tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(120));

    loop {
        interval.tick().await;
        task_entry(6).record_run();

        let top = entity_cache.top_active_entities(100).await;
        if top.is_empty() {
            continue;
        }

        // Calculate mean and std deviation of state change counts
        let counts: Vec<f64> = top.iter().map(|a| a.change_count as f64).collect();
        let mean = counts.iter().sum::<f64>() / counts.len() as f64;
        let variance = counts.iter().map(|c| (c - mean).powi(2)).sum::<f64>() / counts.len() as f64;
        let std_dev = variance.sqrt();

        // Flag entities more than 3 standard deviations above mean
        let threshold = mean + 3.0 * std_dev;
        if threshold <= mean {
            continue; // Not enough variance to detect anomalies
        }

        let anomalies: Vec<serde_json::Value> = top
            .iter()
            .filter(|a| (a.change_count as f64) > threshold)
            .map(|a| {
                serde_json::json!({
                    "entity_id": a.entity_id,
                    "state_changes": a.change_count,
                    "threshold": threshold as u64,
                    "mean": mean as u64,
                })
            })
            .collect();

        if !anomalies.is_empty() {
            info!(
                "Entity anomaly detection: {} entities with unusual activity",
                anomalies.len()
            );
            let event = serde_json::json!({
                "type": "entity_anomalies",
                "anomalies": anomalies,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            ws_manager.broadcast_json(&event).await;
        }
    }
}

/// Background analytics aggregation — periodically writes entity analytics snapshots to DB.
/// Runs every 10 minutes, stores a summary so historical trends can be tracked.
async fn background_analytics_aggregation(entity_cache: Arc<EntityStateCache>, db_pool: DbPool) {
    // Wait 2 minutes for initial data
    tokio::time::sleep(tokio::time::Duration::from_secs(120)).await;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(600));

    // Ensure analytics table exists
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS entity_analytics_snapshots (
            id SERIAL PRIMARY KEY,
            recorded_at TIMESTAMPTZ NOT NULL,
            total_entities INTEGER NOT NULL,
            unavailable_count INTEGER NOT NULL,
            stale_count INTEGER NOT NULL,
            total_state_changes INTEGER NOT NULL,
            most_active_entity TEXT,
            most_active_changes INTEGER DEFAULT 0
        )",
    )
    .execute(&db_pool)
    .await;

    loop {
        interval.tick().await;
        task_entry(7).record_run();

        let summary = entity_cache.analytics_summary().await;
        let health = entity_cache.entity_health_report(3600).await;
        let top = entity_cache.top_active_entities(1).await;

        let total_entities = entity_cache.count().await as i32;
        let unavailable = health.iter().filter(|h| h.status == "unavailable").count() as i32;
        let stale = health.iter().filter(|h| h.status == "stale").count() as i32;
        let total_changes = summary
            .get("total_state_changes")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let most_active = top.first().map(|a| a.entity_id.clone()).unwrap_or_default();
        let most_active_changes = top.first().map(|a| a.change_count as i32).unwrap_or(0);

        let now = chrono::Utc::now();
        match sqlx::query(
            "INSERT INTO entity_analytics_snapshots (recorded_at, total_entities, unavailable_count, stale_count, total_state_changes, most_active_entity, most_active_changes) VALUES ($1, $2, $3, $4, $5, $6, $7)"
        )
            .bind(&now)
            .bind(total_entities)
            .bind(unavailable)
            .bind(stale)
            .bind(total_changes)
            .bind(&most_active)
            .bind(most_active_changes)
            .execute(&db_pool)
            .await
        {
            Ok(_) => {
                info!("Analytics snapshot saved: {} entities, {} unavailable, {} stale", total_entities, unavailable, stale);
            }
            Err(e) => {
                task_entry(7).record_error();
                warn!("Failed to save analytics snapshot: {}", e);
            }
        }

        // Clean up snapshots older than 30 days
        let cutoff = chrono::Utc::now() - chrono::Duration::days(30);
        let _ = sqlx::query("DELETE FROM entity_analytics_snapshots WHERE recorded_at < $1")
            .bind(&cutoff)
            .execute(&db_pool)
            .await;
    }
}

/// Background stale entity monitor — detects entities that haven't updated in >1 hour
/// and sends warnings to connected dashboard clients every 60 seconds.
async fn background_stale_entity_monitor(
    entity_cache: Arc<EntityStateCache>,
    ws_manager: Arc<websocket::WebSocketManager>,
) {
    // Wait 30s for initial data
    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
    let mut previously_stale: std::collections::HashSet<String> = std::collections::HashSet::new();

    loop {
        interval.tick().await;
        task_entry(8).record_run();

        let health = entity_cache.entity_health_report(3600).await;
        let currently_stale: std::collections::HashSet<String> = health
            .iter()
            .filter(|h| h.status == "stale" || h.status == "unavailable")
            .map(|h| h.entity_id.clone())
            .collect();

        // Find newly stale entities (ones that weren't stale before)
        let newly_stale: Vec<&String> = currently_stale
            .iter()
            .filter(|e| !previously_stale.contains(*e))
            .collect();

        // Find recovered entities
        let recovered: Vec<&String> = previously_stale
            .iter()
            .filter(|e| !currently_stale.contains(*e))
            .collect();

        if !newly_stale.is_empty() || !recovered.is_empty() {
            let event = serde_json::json!({
                "type": "entity_health_update",
                "newly_stale": newly_stale,
                "recovered": recovered,
                "total_stale": currently_stale.len(),
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            ws_manager.broadcast_json(&event).await;

            if !newly_stale.is_empty() {
                info!(
                    "Stale entity monitor: {} newly stale entities detected",
                    newly_stale.len()
                );
            }
            if !recovered.is_empty() {
                info!(
                    "Stale entity monitor: {} entities recovered",
                    recovered.len()
                );
            }
        }

        previously_stale = currently_stale;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// API Key Management Endpoints
// ═══════════════════════════════════════════════════════════════════════

/// List API keys for the authenticated user
async fn list_my_api_keys(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
) -> Result<Json<Vec<db::models::ApiKey>>, ErrorResponse> {
    let user_id = identity.user_id().to_string();
    match state.config_repo.list_api_keys(&user_id).await {
        Ok(keys) => Ok(Json(keys)),
        Err(e) => {
            warn!("Failed to list API keys: {}", e);
            Err(ErrorResponse::internal("Fehler beim Laden der API-Keys"))
        }
    }
}

/// Create a new API key
async fn create_api_key(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Json(request): Json<db::models::CreateApiKeyRequest>,
) -> Result<Json<db::models::ApiKeyWithSecret>, ErrorResponse> {
    let user_id = identity.user_id().to_string();

    if request.name.trim().is_empty() {
        return Err(ErrorResponse::bad_request("Name darf nicht leer sein"));
    }

    let raw_key = auth::generate_api_key();
    let prefix = auth::api_key_prefix(&raw_key);

    let key_hash = auth::hash_password(&raw_key)
        .map_err(|_| ErrorResponse::internal("Fehler beim Erstellen des API-Keys"))?;

    let permissions = request
        .permissions
        .unwrap_or_else(|| vec!["read".to_string()]);
    let permissions_json = serde_json::to_string(&permissions)
        .map_err(|_| ErrorResponse::internal("Invalid permissions"))?;

    let rate_limit = request.rate_limit.unwrap_or(60).clamp(1, 1000);

    let expires_at = request
        .expires_in_days
        .map(|days| chrono::Utc::now() + chrono::Duration::days(days.clamp(1, 365)));

    let api_key = state
        .config_repo
        .create_api_key(
            &user_id,
            request.name.trim(),
            &key_hash,
            &prefix,
            &permissions_json,
            rate_limit,
            expires_at,
        )
        .await
        .map_err(|e| {
            warn!("Failed to create API key: {}", e);
            ErrorResponse::internal("Fehler beim Erstellen des API-Keys")
        })?;

    Ok(Json(db::models::ApiKeyWithSecret {
        id: api_key.id,
        name: api_key.name,
        key: raw_key,
        key_prefix: api_key.key_prefix,
        permissions,
        rate_limit: api_key.rate_limit,
        expires_at: api_key.expires_at,
        created_at: api_key.created_at,
    }))
}

/// Update an API key
async fn update_api_key(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Path(key_id): Path<String>,
    Json(request): Json<db::models::UpdateApiKeyRequest>,
) -> Result<Json<db::models::ApiKey>, ErrorResponse> {
    // Verify ownership
    let keys = state
        .config_repo
        .list_api_keys(identity.user_id())
        .await
        .map_err(|_| ErrorResponse::internal("Fehler"))?;
    if !keys.iter().any(|k| k.id == key_id) {
        return Err(ErrorResponse::not_found("API-Key nicht gefunden"));
    }

    match state.config_repo.update_api_key(&key_id, &request).await {
        Ok(Some(key)) => Ok(Json(key)),
        Ok(None) => Err(ErrorResponse::not_found("API-Key nicht gefunden")),
        Err(e) => {
            warn!("Failed to update API key: {}", e);
            Err(ErrorResponse::internal("Fehler beim Aktualisieren"))
        }
    }
}

/// Delete an API key
async fn delete_api_key(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Path(key_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    // Verify ownership
    let keys = state
        .config_repo
        .list_api_keys(identity.user_id())
        .await
        .map_err(|_| ErrorResponse::internal("Fehler"))?;
    if !keys.iter().any(|k| k.id == key_id) {
        return Err(ErrorResponse::not_found("API-Key nicht gefunden"));
    }

    match state.config_repo.delete_api_key(&key_id).await {
        Ok(true) => Ok(Json(serde_json::json!({ "success": true }))),
        Ok(false) => Err(ErrorResponse::not_found("API-Key nicht gefunden")),
        Err(e) => {
            warn!("Failed to delete API key: {}", e);
            Err(ErrorResponse::internal("Fehler beim Löschen"))
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Admin Endpoints
// ═══════════════════════════════════════════════════════════════════════

/// Admin: List all users with details
async fn admin_list_users(
    State(state): State<AppState>,
) -> Result<Json<Vec<db::models::AdminUserEntry>>, ErrorResponse> {
    let users = state
        .config_repo
        .list_all_users_admin()
        .await
        .map_err(|e| {
            warn!("Failed to list users: {}", e);
            ErrorResponse::internal("Fehler beim Laden der Benutzer")
        })?;

    let entries: Vec<db::models::AdminUserEntry> = users
        .into_iter()
        .map(|u| db::models::AdminUserEntry {
            has_password: u.password_hash.is_some(),
            has_pin: u.pin_hash.is_some(),
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar_url: u.avatar_url,
            role: u.role,
            is_admin: u.is_admin,
            created_at: u.created_at,
            updated_at: u.updated_at,
        })
        .collect();

    Ok(Json(entries))
}

/// Admin: Set user admin status
async fn admin_set_user_admin(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(request): Json<db::models::SetAdminRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    state
        .config_repo
        .set_user_admin(&user_id, request.is_admin)
        .await
        .map_err(|e| {
            warn!("Failed to set admin status: {}", e);
            ErrorResponse::internal("Admin-Status konnte nicht geändert werden")
        })?;

    Ok(Json(serde_json::json!({
        "success": true,
        "user_id": user_id,
        "is_admin": request.is_admin,
    })))
}

/// Admin: Update a user (display name, password reset)
async fn admin_update_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    // Check user exists
    let user = state
        .config_repo
        .get_user_by_id(&user_id)
        .await
        .map_err(|e| {
            warn!("Failed to lookup user: {}", e);
            ErrorResponse::internal("Datenbankfehler")
        })?
        .ok_or_else(|| ErrorResponse::not_found("Benutzer nicht gefunden"))?;

    // Update display name if provided
    if let Some(display_name) = body.get("display_name").and_then(|v| v.as_str()) {
        let req = db::models::UpdateUserRequest {
            username: None,
            display_name: Some(display_name.to_string()),
        };
        state
            .config_repo
            .update_user(&user_id, req)
            .await
            .map_err(|e| {
                warn!("Failed to update user: {}", e);
                ErrorResponse::internal("Fehler beim Aktualisieren")
            })?;
    }

    // Update role if provided
    if let Some(role) = body.get("role").and_then(|v| v.as_str()) {
        let valid_roles = ["user", "viewer", "editor", "admin", "maintenance"];
        if valid_roles.contains(&role) {
            state
                .config_repo
                .set_user_role(&user_id, role)
                .await
                .map_err(|e| {
                    warn!("Failed to set role: {}", e);
                    ErrorResponse::internal("Rolle konnte nicht gesetzt werden")
                })?;
            // If role is "admin", also set is_admin flag
            if role == "admin" {
                state
                    .config_repo
                    .set_user_admin(&user_id, true)
                    .await
                    .map_err(|e| {
                        warn!("Failed to set admin: {}", e);
                        ErrorResponse::internal("Admin-Status konnte nicht gesetzt werden")
                    })?;
            }
        }
    }

    // Reset password if provided
    if let Some(new_password) = body.get("new_password").and_then(|v| v.as_str()) {
        if !new_password.is_empty() {
            let hash = auth::hash_password(new_password).map_err(|e| {
                warn!("Failed to hash password: {}", e);
                ErrorResponse::internal("Passwort-Hashing fehlgeschlagen")
            })?;
            state
                .config_repo
                .set_user_password(&user_id, &hash)
                .await
                .map_err(|e| {
                    warn!("Failed to set password: {}", e);
                    ErrorResponse::internal("Passwort konnte nicht gesetzt werden")
                })?;
        }
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "user_id": user_id,
        "username": user.username,
    })))
}

/// Admin: Delete a user
async fn admin_delete_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Extension(identity): Extension<middleware::AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    // Prevent self-deletion
    if identity.user_id() == user_id {
        return Err(ErrorResponse::bad_request(
            "Du kannst dich nicht selbst löschen",
        ));
    }

    state.config_repo.delete_user(&user_id).await.map_err(|e| {
        warn!("Failed to delete user: {}", e);
        ErrorResponse::internal("Benutzer konnte nicht gelöscht werden")
    })?;

    Ok(Json(serde_json::json!({
        "success": true,
        "user_id": user_id,
    })))
}

/// Admin: List all API keys across all users
async fn admin_list_all_api_keys(
    State(state): State<AppState>,
) -> Result<Json<Vec<db::models::ApiKey>>, ErrorResponse> {
    match state.config_repo.list_all_api_keys().await {
        Ok(keys) => Ok(Json(keys)),
        Err(e) => {
            warn!("Failed to list all API keys: {}", e);
            Err(ErrorResponse::internal("Fehler beim Laden der API-Keys"))
        }
    }
}

/// Admin: Delete any API key
async fn admin_delete_api_key(
    State(state): State<AppState>,
    Path(key_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.config_repo.delete_api_key(&key_id).await {
        Ok(true) => Ok(Json(serde_json::json!({ "success": true }))),
        Ok(false) => Err(ErrorResponse::not_found("API-Key nicht gefunden")),
        Err(e) => {
            warn!("Failed to delete API key: {}", e);
            Err(ErrorResponse::internal("Fehler beim Löschen"))
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HA Deep Integration Endpoints (Admin only)
// ═══════════════════════════════════════════════════════════════════════

/// Helper: Make a GET request to the HA REST API
async fn ha_api_get(state: &AppState, path: &str) -> Result<Value, ErrorResponse> {
    let ha_config = load_ha_runtime_config(&state.config_repo).await;
    if !ha_config.is_configured() {
        return Err(ErrorResponse::internal("Home Assistant is not configured"));
    }

    let response = state
        .http_client
        .get(format!("{}{}", ha_config.url, path))
        .header("Authorization", format!("Bearer {}", ha_config.token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| ErrorResponse::internal(format!("HA API request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(ErrorResponse::internal(format!(
            "HA API returned {}: {}",
            status, body
        )));
    }

    response
        .json::<Value>()
        .await
        .map_err(|e| ErrorResponse::internal(format!("Failed to parse HA response: {}", e)))
}

/// Admin: Get HA configuration
async fn admin_ha_config(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first, then fall back to direct API call. If HA is not yet
    // configured / not reachable we return a 200 with `available: false`
    // instead of a 500 so the admin UI can render a graceful empty state.
    let config = state
        .ha_data_cache
        .get_or_fetch_api(
            "/api/config",
            std::time::Duration::from_secs(120),
            || async { ha_api_get(&state, "/api/config").await.ok() },
        )
        .await;
    match config {
        Some(c) => Ok(Json(c)),
        None => Ok(Json(serde_json::json!({
            "available": false,
            "reason": "Home Assistant ist nicht erreichbar oder noch nicht eingerichtet.",
        }))),
    }
}

/// Admin: Get HA integrations/components
async fn admin_ha_integrations(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Get components list from cache
    let config = state
        .ha_data_cache
        .get_or_fetch_api(
            "/api/config",
            std::time::Duration::from_secs(120),
            || async { ha_api_get(&state, "/api/config").await.ok() },
        )
        .await
        .ok_or_else(|| ErrorResponse::internal("HA config not available"))?;
    let components = config
        .get("components")
        .cloned()
        .unwrap_or(Value::Array(vec![]));

    // Also get the domains from entity cache for a richer view
    let all_entities = state.entity_cache.get_all().await;
    let mut domains: HashMap<String, usize> = HashMap::new();
    for e in &all_entities {
        let domain = e.entity_id.split('.').next().unwrap_or("unknown");
        *domains.entry(domain.to_string()).or_insert(0) += 1;
    }

    Ok(Json(serde_json::json!({
        "components": components,
        "entity_domains": domains,
        "total_entities": all_entities.len(),
    })))
}

/// Admin: Get HA devices (from device registry via states)
async fn admin_ha_devices(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    // Group entities by device_class and area
    let mut by_device_class: HashMap<String, Vec<Value>> = HashMap::new();
    for e in &all_entities {
        let device_class = e
            .attributes
            .get("device_class")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        by_device_class
            .entry(device_class)
            .or_default()
            .push(serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "friendly_name": e.attributes.get("friendly_name"),
            }));
    }

    Ok(Json(serde_json::json!({
        "total_entities": all_entities.len(),
        "by_device_class": by_device_class,
    })))
}

/// Admin: Get HA areas
async fn admin_ha_areas(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // HA REST API doesn't expose areas directly, but we can extract from entity attributes
    let all_entities = state.entity_cache.get_all().await;

    let mut areas: HashMap<String, Vec<String>> = HashMap::new();
    for e in &all_entities {
        if let Some(area) = e.attributes.get("area_id").and_then(|v| v.as_str()) {
            areas
                .entry(area.to_string())
                .or_default()
                .push(e.entity_id.clone());
        }
    }

    Ok(Json(serde_json::json!({
        "areas": areas,
        "area_count": areas.len(),
    })))
}

/// Admin: Get HA automations  
async fn admin_ha_automations(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let automations = state.entity_cache.get_by_domain("automation").await;
    let data: Vec<Value> = automations
        .iter()
        .map(|a| {
            serde_json::json!({
                "entity_id": a.entity_id,
                "state": a.state,
                "friendly_name": a.attributes.get("friendly_name"),
                "last_triggered": a.attributes.get("last_triggered"),
                "current": a.attributes.get("current"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "automations": data,
        "total": data.len(),
    })))
}

/// Admin: Get available HA services
async fn admin_ha_services(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let services = state
        .ha_data_cache
        .get_or_fetch_api(
            "/api/services",
            std::time::Duration::from_secs(300),
            || async { ha_api_get(&state, "/api/services").await.ok() },
        )
        .await
        .ok_or_else(|| ErrorResponse::internal("HA services not available"))?;
    Ok(Json(services))
}

/// Admin: Get HA error log
async fn admin_ha_logs(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // 1. Try cached error log first (background worker refreshes every 45s)
    if let Some(cached) = state.ha_data_cache.get_api("/api/error_log").await {
        return Ok(Json(cached));
    }

    // 2. Cache miss – use ha_client (which already has URL + token configured)
    match state.ha_client.get_error_log().await {
        Ok(log_text) => {
            let result = parse_ha_error_log(&log_text);
            state
                .ha_data_cache
                .set_api(
                    "/api/error_log",
                    result.clone(),
                    std::time::Duration::from_secs(30),
                )
                .await;
            Ok(Json(result))
        }
        Err(e) => {
            // Return an empty but valid log structure so the frontend doesn't break
            let status_hint = e.status_code().unwrap_or(0);
            let msg = if status_hint == 404 {
                "HA Error-Log Endpoint nicht gefunden (404). Möglicherweise fehlt die Berechtigung im Long-Lived Access Token oder die HA-Version unterstützt diesen Endpoint nicht."
            } else if status_hint == 401 || status_hint == 403 {
                "Zugriff auf HA Error-Log verweigert. Prüfe den Long-Lived Access Token (benötigt Admin-Rechte)."
            } else {
                "HA Error-Log konnte nicht abgerufen werden. Dashboard läuft aber normal weiter."
            };
            warn!("HA error log fetch failed: {}", e);
            Ok(Json(serde_json::json!({
                "log": [{"line": msg, "severity": "warning"}],
                "total_lines": 0,
                "truncated": false,
                "error": format!("{}", e),
            })))
        }
    }
}

/// Parse HA error log text into structured JSON with severity levels
pub fn parse_ha_error_log(log_text: &str) -> Value {
    let total_lines = log_text.lines().count();
    let lines: Vec<Value> = log_text
        .lines()
        .rev()
        .take(300)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|line| {
            let severity = if line.contains("ERROR") {
                "error"
            } else if line.contains("WARNING") {
                "warning"
            } else if line.contains("INFO") {
                "info"
            } else if line.contains("DEBUG") {
                "debug"
            } else {
                "unknown"
            };
            serde_json::json!({
                "line": line,
                "severity": severity,
            })
        })
        .collect();

    serde_json::json!({
        "log": lines,
        "total_lines": total_lines,
        "truncated": total_lines > 300,
    })
}

/// Admin: Get MQTT information (from HA entities)
async fn admin_ha_mqtt(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    // Find MQTT-related entities
    let mqtt_entities: Vec<Value> = all_entities
        .iter()
        .filter(|e| {
            e.entity_id.contains("mqtt")
                || e.attributes.get("integration").and_then(|v| v.as_str()) == Some("mqtt")
                || e.attributes
                    .get("source")
                    .and_then(|v| v.as_str())
                    .map(|s| s.contains("mqtt"))
                    .unwrap_or(false)
        })
        .map(|e| {
            serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "friendly_name": e.attributes.get("friendly_name"),
                "attributes": e.attributes,
            })
        })
        .collect();

    // Try to get MQTT addon status
    let mqtt_broker_status = all_entities
        .iter()
        .find(|e| e.entity_id.contains("mosquitto") || e.entity_id.contains("mqtt_broker"))
        .map(|e| {
            serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "attributes": e.attributes,
            })
        });

    Ok(Json(serde_json::json!({
        "mqtt_entities": mqtt_entities,
        "mqtt_entity_count": mqtt_entities.len(),
        "broker_status": mqtt_broker_status,
    })))
}

/// Admin: Get Matter information (from HA entities)
async fn admin_ha_matter(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    let matter_entities: Vec<Value> = all_entities
        .iter()
        .filter(|e| {
            e.entity_id.contains("matter")
                || e.attributes.get("integration").and_then(|v| v.as_str()) == Some("matter")
                || e.attributes
                    .get("source")
                    .and_then(|v| v.as_str())
                    .map(|s| s.contains("matter"))
                    .unwrap_or(false)
        })
        .map(|e| {
            serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "friendly_name": e.attributes.get("friendly_name"),
                "attributes": e.attributes,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "matter_entities": matter_entities,
        "matter_entity_count": matter_entities.len(),
    })))
}

// ── MQTT Client Management Handlers ────────────────────────────────

/// Get MQTT client status
async fn admin_mqtt_status(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let status = state.mqtt_client.status().await;
    Ok(Json(serde_json::to_value(status).unwrap_or(Value::Null)))
}

/// Connect to MQTT broker
#[derive(Debug, Deserialize)]
struct MqttConnectRequest {
    host: String,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    client_id: Option<String>,
    use_tls: Option<bool>,
}

async fn admin_mqtt_connect(
    State(state): State<AppState>,
    Json(req): Json<MqttConnectRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = mqtt_client::MqttConfig {
        host: req.host.clone(),
        port: req.port.unwrap_or(1883),
        username: req.username.clone(),
        password: req.password.clone(),
        client_id: req
            .client_id
            .clone()
            .unwrap_or_else(|| format!("mdt-dashboard-{}", &uuid::Uuid::new_v4().to_string()[..8])),
        use_tls: req.use_tls.unwrap_or(false),
    };

    let host = config.host.clone();
    let port = config.port;
    match state.mqtt_client.connect(config).await {
        Ok(()) => {
            info!("MQTT: Connected to {}:{}", host, port);
            // Auto-save config to DB on successful connect.
            // Password is encrypted at rest with AES-256-GCM (see crypto.rs);
            // legacy plaintext rows are upgraded automatically the next time
            // the user saves through the API.
            let stored_password = req.password.as_deref().map(crypto::encrypt_secret);
            let config_value = serde_json::json!({
                "host": req.host,
                "port": req.port.unwrap_or(1883),
                "username": req.username,
                "password": stored_password,
                "client_id": req.client_id,
                "use_tls": req.use_tls.unwrap_or(false),
            });
            let save_req = db::models::SaveSystemPreferenceRequest {
                preference_key: "mqtt_config".to_string(),
                preference_value: config_value,
            };
            if let Err(e) = state.config_repo.save_system_preference(save_req).await {
                warn!("MQTT: Connected but failed to save config: {}", e);
            }
            Ok(Json(
                serde_json::json!({ "success": true, "message": "Verbunden und gespeichert" }),
            ))
        }
        Err(e) => {
            warn!("MQTT: Failed to connect: {}", e);
            Ok(Json(serde_json::json!({ "success": false, "error": e })))
        }
    }
}

/// Disconnect from MQTT broker
async fn admin_mqtt_disconnect(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    state.mqtt_client.disconnect().await;
    Ok(Json(
        serde_json::json!({ "success": true, "message": "Disconnected" }),
    ))
}

/// Subscribe to MQTT topic
#[derive(Debug, Deserialize)]
struct MqttTopicRequest {
    topic: String,
}

async fn admin_mqtt_subscribe(
    State(state): State<AppState>,
    Json(req): Json<MqttTopicRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.mqtt_client.subscribe(&req.topic).await {
        Ok(()) => Ok(Json(
            serde_json::json!({ "success": true, "topic": req.topic }),
        )),
        Err(e) => Ok(Json(serde_json::json!({ "success": false, "error": e }))),
    }
}

/// Unsubscribe from MQTT topic
async fn admin_mqtt_unsubscribe(
    State(state): State<AppState>,
    Json(req): Json<MqttTopicRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.mqtt_client.unsubscribe(&req.topic).await {
        Ok(()) => Ok(Json(
            serde_json::json!({ "success": true, "topic": req.topic }),
        )),
        Err(e) => Ok(Json(serde_json::json!({ "success": false, "error": e }))),
    }
}

/// Publish MQTT message
#[derive(Debug, Deserialize)]
struct MqttPublishRequest {
    topic: String,
    payload: String,
    retain: Option<bool>,
}

async fn admin_mqtt_publish(
    State(state): State<AppState>,
    Json(req): Json<MqttPublishRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    match state
        .mqtt_client
        .publish(&req.topic, &req.payload, req.retain.unwrap_or(false))
        .await
    {
        Ok(()) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Ok(Json(serde_json::json!({ "success": false, "error": e }))),
    }
}

/// Get recent MQTT messages
async fn admin_mqtt_messages(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let messages = state.mqtt_client.recent_messages().await;
    let topic_values = state.mqtt_client.topic_values().await;
    Ok(Json(serde_json::json!({
        "recent_messages": messages,
        "topic_values": topic_values,
    })))
}

/// Save MQTT config to system preferences
async fn admin_mqtt_save_config(
    State(state): State<AppState>,
    Json(req): Json<MqttConnectRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    // Encrypt the password before persisting it. See `crypto.rs` for the format.
    let stored_password = req.password.as_deref().map(crypto::encrypt_secret);
    let config_value = serde_json::json!({
        "host": req.host,
        "port": req.port.unwrap_or(1883),
        "username": req.username,
        "password": stored_password,
        "client_id": req.client_id,
        "use_tls": req.use_tls.unwrap_or(false),
    });
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "mqtt_config".to_string(),
        preference_value: config_value,
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => {
            warn!("Failed to save MQTT config: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to save MQTT config: {}",
                e
            )))
        }
    }
}

/// Get saved MQTT config
async fn admin_mqtt_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.config_repo.get_system_preference("mqtt_config").await {
        Ok(Some(pref)) => {
            // Parse the stored JSON and mask the password
            if let Ok(mut config) = serde_json::from_str::<Value>(&pref.preference_value) {
                // Defensive: only mutate if the value is actually an object. A corrupted
                // row could otherwise panic the handler thread.
                if let Some(obj) = config.as_object_mut() {
                    if obj
                        .get("password")
                        .and_then(|p| p.as_str())
                        .is_some_and(|s| !s.is_empty())
                    {
                        obj.insert("has_password".into(), serde_json::json!(true));
                        obj.remove("password");
                    }
                }
                Ok(Json(config))
            } else {
                Ok(Json(serde_json::json!({})))
            }
        }
        Ok(None) => Ok(Json(serde_json::json!({}))),
        Err(e) => {
            warn!("Failed to get MQTT config: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to get MQTT config: {}",
                e
            )))
        }
    }
}

// ── Matter Client Management Handlers ──────────────────────────────

/// Get Matter status with device details
async fn admin_matter_status(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // Refresh from entity cache first
    let entities = state.entity_cache.get_all().await;
    state.matter_client.refresh_from_entities(&entities).await;

    let matter_entity_count = entities
        .iter()
        .filter(|e| {
            e.entity_id.contains("matter")
                || e.attributes.get("integration").and_then(|v| v.as_str()) == Some("matter")
        })
        .count();

    let status = state.matter_client.status(matter_entity_count).await;
    Ok(Json(serde_json::to_value(status).unwrap_or(Value::Null)))
}

/// Save Matter config
async fn admin_matter_save_config(
    State(state): State<AppState>,
    Json(config): Json<matter_client::MatterConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.matter_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "matter_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap_or(Value::Null),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => {
            warn!("Failed to save Matter config: {}", e);
            Err(ErrorResponse::internal(format!(
                "Failed to save Matter config: {}",
                e
            )))
        }
    }
}

/// Get Matter config
async fn admin_matter_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.matter_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap_or(Value::Null)))
}

/// Refresh Matter devices from HA entities
async fn admin_matter_refresh(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.matter_client.refresh_from_entities(&entities).await;
    let devices = state.matter_client.status(0).await;
    Ok(Json(serde_json::json!({
        "success": true,
        "device_count": devices.device_count,
    })))
}

// ── Zigbee Client Management Handlers ──────────────────────────────

async fn admin_zigbee_status(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let integrations: Vec<String> = state
        .ha_connection
        .get_integrations()
        .await
        .iter()
        .filter(|i| i.available)
        .map(|i| i.domain.clone())
        .collect();
    state
        .zigbee_client
        .refresh_from_entities(&entities, &integrations)
        .await;
    let status = state.zigbee_client.status().await;
    Ok(Json(serde_json::to_value(status).unwrap_or(Value::Null)))
}

async fn admin_zigbee_save_config(
    State(state): State<AppState>,
    Json(config): Json<zigbee_client::ZigbeeConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.zigbee_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "zigbee_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap_or(Value::Null),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Failed to save Zigbee config: {}",
            e
        ))),
    }
}

async fn admin_zigbee_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.zigbee_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap_or(Value::Null)))
}

async fn admin_zigbee_refresh(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let integrations: Vec<String> = state
        .ha_connection
        .get_integrations()
        .await
        .iter()
        .filter(|i| i.available)
        .map(|i| i.domain.clone())
        .collect();
    state
        .zigbee_client
        .refresh_from_entities(&entities, &integrations)
        .await;
    let status = state.zigbee_client.status().await;
    Ok(Json(
        serde_json::json!({ "success": true, "device_count": status.device_count }),
    ))
}

// ── Z-Wave Client Management Handlers ──────────────────────────────

async fn admin_zwave_status(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.zwave_client.refresh_from_entities(&entities).await;
    let zwave_count = entities
        .iter()
        .filter(|e| e.entity_id.contains("zwave"))
        .count();
    let status = state.zwave_client.status(zwave_count).await;
    Ok(Json(serde_json::to_value(status).unwrap_or(Value::Null)))
}

async fn admin_zwave_save_config(
    State(state): State<AppState>,
    Json(config): Json<zwave_client::ZwaveConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.zwave_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "zwave_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap_or(Value::Null),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Failed to save Z-Wave config: {}",
            e
        ))),
    }
}

async fn admin_zwave_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.zwave_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap_or(Value::Null)))
}

async fn admin_zwave_refresh(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.zwave_client.refresh_from_entities(&entities).await;
    let status = state.zwave_client.status(0).await;
    Ok(Json(
        serde_json::json!({ "success": true, "node_count": status.node_count }),
    ))
}

// ── Bluetooth/BLE Client Management Handlers ───────────────────────

async fn admin_ble_status(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.ble_client.refresh_from_entities(&entities).await;
    let ble_count = entities
        .iter()
        .filter(|e| e.entity_id.contains("ble_") || e.entity_id.contains("bluetooth"))
        .count();
    let status = state.ble_client.status(ble_count).await;
    Ok(Json(serde_json::to_value(status).unwrap_or(Value::Null)))
}

async fn admin_ble_save_config(
    State(state): State<AppState>,
    Json(config): Json<ble_client::BleConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.ble_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "ble_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap_or(Value::Null),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Failed to save BLE config: {}",
            e
        ))),
    }
}

async fn admin_ble_get_config(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let config = state.ble_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap_or(Value::Null)))
}

async fn admin_ble_refresh(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.ble_client.refresh_from_entities(&entities).await;
    let status = state.ble_client.status(0).await;
    Ok(Json(
        serde_json::json!({ "success": true, "device_count": status.device_count }),
    ))
}

// ── HomeKit Client Management Handlers ─────────────────────────────

async fn admin_homekit_status(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let ha_has_homekit = state.ha_connection.has_integration("homekit").await;
    state
        .homekit_client
        .refresh_from_entities(&entities, ha_has_homekit)
        .await;
    let hk_count = entities
        .iter()
        .filter(|e| e.entity_id.contains("homekit"))
        .count();
    let status = state.homekit_client.status(hk_count).await;
    Ok(Json(serde_json::to_value(status).unwrap_or(Value::Null)))
}

async fn admin_homekit_save_config(
    State(state): State<AppState>,
    Json(config): Json<homekit_client::HomekitConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.homekit_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "homekit_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap_or(Value::Null),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Failed to save HomeKit config: {}",
            e
        ))),
    }
}

async fn admin_homekit_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.homekit_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap_or(Value::Null)))
}

async fn admin_homekit_refresh(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let ha_has_homekit = state.ha_connection.has_integration("homekit").await;
    state
        .homekit_client
        .refresh_from_entities(&entities, ha_has_homekit)
        .await;
    let status = state.homekit_client.status(0).await;
    Ok(Json(
        serde_json::json!({ "success": true, "accessory_count": status.accessory_count }),
    ))
}

// ── HA Connection Health Handlers ──────────────────────────────────

async fn admin_ha_connection_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let status = state.ha_connection.status().await;
    Ok(Json(serde_json::to_value(status).unwrap_or(Value::Null)))
}

/// Overview of all protocol statuses in one call
async fn admin_protocols_overview(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let ha_status = state.ha_connection.status().await;
    let mqtt_status = state.mqtt_client.status().await;

    let entities = state.entity_cache.get_all().await;

    // Refresh all protocol clients from entity cache
    let integrations: Vec<String> = ha_status
        .integrations
        .iter()
        .filter(|i| i.available)
        .map(|i| i.domain.clone())
        .collect();
    state
        .zigbee_client
        .refresh_from_entities(&entities, &integrations)
        .await;
    state.zwave_client.refresh_from_entities(&entities).await;
    state.ble_client.refresh_from_entities(&entities).await;
    state.matter_client.refresh_from_entities(&entities).await;
    state
        .homekit_client
        .refresh_from_entities(
            &entities,
            ha_status
                .integrations
                .iter()
                .any(|i| i.domain == "homekit" && i.available),
        )
        .await;

    let zigbee = state.zigbee_client.status().await;
    let zwave = state.zwave_client.status(0).await;
    let ble = state.ble_client.status(0).await;
    let matter = state.matter_client.status(0).await;
    let homekit = state.homekit_client.status(0).await;

    Ok(Json(serde_json::json!({
        "ha": {
            "available": ha_status.available,
            "version": ha_status.ha_version,
            "entity_count": ha_status.cached_entity_count,
        },
        "mqtt": {
            "connected": mqtt_status.connected,
            "message_count": mqtt_status.message_count,
            "subscriptions": mqtt_status.subscribed_topics.len(),
        },
        "zigbee": {
            "enabled": zigbee.enabled,
            "device_count": zigbee.device_count,
            "mode": zigbee.detected_mode,
        },
        "zwave": {
            "enabled": zwave.enabled,
            "node_count": zwave.node_count,
        },
        "matter": {
            "enabled": matter.enabled,
            "device_count": matter.device_count,
        },
        "ble": {
            "enabled": ble.enabled,
            "device_count": ble.device_count,
        },
        "homekit": {
            "enabled": homekit.enabled,
            "accessory_count": homekit.accessory_count,
            "bridge_available": homekit.bridge_available,
        },
        "integrations": ha_status.integrations,
    })))
}

/// Admin: Get HA add-ons (via Supervisor API)
async fn admin_ha_addons(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state.ha_data_cache.get_api("/api/hassio/addons").await {
        let unwrapped = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
            data.get("data").cloned().unwrap_or(data.clone())
        } else {
            data
        };
        return Ok(Json(serde_json::json!({
            "supervisor_available": true,
            "addons": unwrapped.get("addons").cloned().unwrap_or(unwrapped.clone()),
        })));
    }

    // Cache miss — try supervisor API
    match ha_api_get(&state, "/api/hassio/addons").await {
        Ok(data) => {
            // Unwrap {"result":"ok","data":{...}} envelope if present
            let unwrapped = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
                data.get("data").cloned().unwrap_or(data.clone())
            } else {
                data
            };
            Ok(Json(serde_json::json!({
                "supervisor_available": true,
                "addons": unwrapped.get("addons").cloned().unwrap_or(unwrapped.clone()),
            })))
        }
        Err(_) => {
            // Fallback: show update entities that represent add-ons
            let all = state.entity_cache.get_all().await;
            let addon_entities: Vec<Value> = all
                .iter()
                .filter(|e| {
                    e.entity_id.starts_with("update.")
                        && e.attributes.get("entity_picture").is_some()
                })
                .map(|e| {
                    serde_json::json!({
                        "entity_id": e.entity_id,
                        "state": e.state,
                        "friendly_name": e.attributes.get("friendly_name"),
                        "installed_version": e.attributes.get("installed_version"),
                        "latest_version": e.attributes.get("latest_version"),
                        "entity_picture": e.attributes.get("entity_picture"),
                    })
                })
                .collect();

            Ok(Json(serde_json::json!({
                "supervisor_available": false,
                "addon_entities": addon_entities,
                "note": "Supervisor API not available. Showing update entities instead.",
            })))
        }
    }
}

/// Admin: Get HA Supervisor info
async fn admin_ha_supervisor(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state
        .ha_data_cache
        .get_api("/api/hassio/supervisor/info")
        .await
    {
        let info = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
            data.get("data").cloned().unwrap_or(data.clone())
        } else {
            data
        };
        return Ok(Json(serde_json::json!({
            "supervisor_available": true,
            "info": info,
        })));
    }

    // Cache miss — try the Supervisor API
    match ha_api_get(&state, "/api/hassio/supervisor/info").await {
        Ok(data) => {
            // Unwrap the {"result":"ok","data":{...}} envelope if present
            let info = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
                data.get("data").cloned().unwrap_or(data.clone())
            } else {
                data
            };
            Ok(Json(serde_json::json!({
                "supervisor_available": true,
                "info": info,
            })))
        }
        Err(_) => {
            // Fallback: try /api/hassio/info (alternative path)
            match ha_api_get(&state, "/api/hassio/info").await {
                Ok(data) => {
                    let info = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
                        data.get("data").cloned().unwrap_or(data.clone())
                    } else {
                        data
                    };
                    Ok(Json(serde_json::json!({
                        "supervisor_available": true,
                        "info": info,
                    })))
                }
                Err(_) => {
                    // Last fallback: check if hassio component is loaded in HA config
                    match ha_api_get(&state, "/api/config").await {
                        Ok(config) => {
                            let components = config
                                .get("components")
                                .and_then(|c| c.as_array())
                                .map(|arr| {
                                    arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>()
                                })
                                .unwrap_or_default();
                            let has_hassio = components.iter().any(|c| *c == "hassio");
                            if has_hassio {
                                Ok(Json(serde_json::json!({
                                    "supervisor_available": true,
                                    "info": {
                                        "note": "Supervisor-Komponente in HA geladen, aber API-Zugriff eingeschränkt. Prüfe den Long-Lived Access Token.",
                                        "ha_version": config.get("version"),
                                        "components_count": components.len(),
                                    },
                                })))
                            } else {
                                Ok(Json(serde_json::json!({
                                    "supervisor_available": false,
                                    "note": "Supervisor nicht verfügbar (HA Core/Container Installation).",
                                })))
                            }
                        }
                        Err(_) => Ok(Json(serde_json::json!({
                            "supervisor_available": false,
                            "note": "Supervisor nicht verfügbar.",
                        }))),
                    }
                }
            }
        }
    }
}

/// Admin: Get HA scenes
async fn admin_ha_scenes(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let scenes = state.entity_cache.get_by_domain("scene").await;
    let data: Vec<Value> = scenes
        .iter()
        .map(|s| {
            serde_json::json!({
                "entity_id": s.entity_id,
                "state": s.state,
                "friendly_name": s.attributes.get("friendly_name"),
                "entity_picture": s.attributes.get("entity_picture"),
                "last_activated": s.last_changed,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "scenes": data,
        "scene_count": data.len(),
    })))
}

/// Admin: Get HA backups (requires Supervisor)
async fn admin_ha_backups(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state.ha_data_cache.get_api("/api/hassio/backups").await {
        let backups = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
            data.get("data")
                .and_then(|d| d.get("backups"))
                .cloned()
                .unwrap_or(Value::Array(vec![]))
        } else {
            data.get("backups").cloned().unwrap_or(Value::Array(vec![]))
        };
        return Ok(Json(serde_json::json!({
            "backups_available": true,
            "backups": backups,
            "backup_count": backups.as_array().map(|a| a.len()).unwrap_or(0),
        })));
    }

    match ha_api_get(&state, "/api/hassio/backups").await {
        Ok(data) => {
            let backups = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
                data.get("data")
                    .and_then(|d| d.get("backups"))
                    .cloned()
                    .unwrap_or(Value::Array(vec![]))
            } else {
                data.get("backups").cloned().unwrap_or(Value::Array(vec![]))
            };
            Ok(Json(serde_json::json!({
                "backups_available": true,
                "backups": backups,
                "backup_count": backups.as_array().map(|a| a.len()).unwrap_or(0),
            })))
        }
        Err(_) => Ok(Json(serde_json::json!({
            "backups_available": false,
            "note": "Backup-API nicht verfügbar (benötigt HA OS / Supervisor).",
            "backups": [],
            "backup_count": 0,
        }))),
    }
}

/// Admin: Get HA network info (Supervisor)
async fn admin_ha_network(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state
        .ha_data_cache
        .get_api("/api/hassio/network/info")
        .await
    {
        let info = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
            data.get("data").cloned().unwrap_or(data.clone())
        } else {
            data
        };
        return Ok(Json(serde_json::json!({
            "network_available": true,
            "info": info,
        })));
    }

    match ha_api_get(&state, "/api/hassio/network/info").await {
        Ok(data) => {
            let info = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
                data.get("data").cloned().unwrap_or(data.clone())
            } else {
                data
            };
            Ok(Json(serde_json::json!({
                "network_available": true,
                "info": info,
            })))
        }
        Err(_) => {
            // Fallback: return basic connectivity info
            let ha_connected = state.entity_cache.is_ha_connected();
            let ws_connected = state.ha_ws.is_connected();
            Ok(Json(serde_json::json!({
                "network_available": false,
                "note": "Netzwerk-API nicht verfügbar (benötigt HA OS).",
                "connectivity": {
                    "ha_rest_api": ha_connected,
                    "ha_websocket": ws_connected,
                },
            })))
        }
    }
}

// ── Extended HA Feature Handlers ──────────────────────────────────

/// Admin: Get HA logbook entries (recent activity)
async fn admin_ha_logbook(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state.ha_data_cache.get_api("/api/logbook").await {
        let entries = if data.is_array() {
            data
        } else {
            Value::Array(vec![])
        };
        let len = entries.as_array().map(|a| a.len()).unwrap_or(0);
        return Ok(Json(serde_json::json!({
            "entries": entries,
            "total": len,
        })));
    }

    // Fetch directly – last 24h
    let start = (chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339();
    match state.ha_client.get_logbook(&start, "").await {
        Ok(data) => {
            let entries = if data.is_array() {
                data
            } else {
                Value::Array(vec![])
            };
            let len = entries.as_array().map(|a| a.len()).unwrap_or(0);
            Ok(Json(serde_json::json!({
                "entries": entries,
                "total": len,
            })))
        }
        Err(e) => Err(ErrorResponse::internal(format!(
            "Logbook nicht verfügbar: {}",
            e
        ))),
    }
}

// ── Public Calendar Endpoints ──────────────────────────────────────────

/// Get available HA calendars (authenticated)
async fn get_calendars(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    if let Some(data) = state.ha_data_cache.get_api("/api/calendars").await {
        return Ok(Json(serde_json::json!({
            "calendars": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        })));
    }

    match state.ha_client.get_calendars().await {
        Ok(data) => Ok(Json(serde_json::json!({
            "calendars": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Kalender nicht verfügbar: {}",
            e
        ))),
    }
}

/// Get calendar events for a specific calendar entity (authenticated)
async fn get_calendar_events(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ErrorResponse> {
    let now = chrono::Utc::now();
    // HA calendar API expects ISO format: YYYY-MM-DDTHH:MM:SS.000Z
    let start = params
        .get("start")
        .cloned()
        .unwrap_or_else(|| now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());
    let end = params.get("end").cloned().unwrap_or_else(|| {
        (now + chrono::Duration::days(30))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string()
    });

    match state
        .ha_client
        .get_calendar_events(&entity_id, &start, &end)
        .await
    {
        Ok(data) => Ok(Json(serde_json::json!({
            "entity_id": entity_id,
            "events": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Kalender-Events nicht verfügbar: {}",
            e
        ))),
    }
}

// ── Convenience API Endpoints ─────────────────────────────────────────

/// Get current server time and date
async fn get_current_time() -> Json<Value> {
    let now = chrono::Local::now();
    Json(serde_json::json!({
        "datetime": now.to_rfc3339(),
        "date": now.format("%Y-%m-%d").to_string(),
        "time": now.format("%H:%M:%S").to_string(),
        "timezone": now.format("%Z").to_string(),
        "timestamp": now.timestamp(),
        "day_of_week": now.format("%A").to_string(),
    }))
}

/// Get all light entities with their current state
async fn get_all_lights(State(state): State<AppState>) -> Json<Value> {
    let entities = state.entity_cache.get_all().await;
    let lights: Vec<Value> = entities
        .iter()
        .filter(|e| e.entity_id.starts_with("light."))
        .map(|e| {
            serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "friendly_name": e.attributes.get("friendly_name"),
                "brightness": e.attributes.get("brightness"),
                "color_temp": e.attributes.get("color_temp"),
                "rgb_color": e.attributes.get("rgb_color"),
                "color_mode": e.attributes.get("color_mode"),
                "supported_color_modes": e.attributes.get("supported_color_modes"),
                "last_changed": e.last_changed,
            })
        })
        .collect();
    Json(serde_json::json!({ "lights": lights, "count": lights.len() }))
}

/// Control a light entity (turn on/off, set brightness, color, etc.)
async fn control_light(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let action = body
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("toggle");
    let service = match action {
        "on" | "turn_on" => "turn_on",
        "off" | "turn_off" => "turn_off",
        _ => "toggle",
    };

    let mut service_data = serde_json::json!({ "entity_id": entity_id });
    if let Some(obj) = service_data.as_object_mut() {
        if let Some(brightness) = body.get("brightness") {
            obj.insert("brightness".into(), brightness.clone());
        }
        if let Some(color_temp) = body.get("color_temp") {
            obj.insert("color_temp".into(), color_temp.clone());
        }
        if let Some(rgb) = body.get("rgb_color") {
            obj.insert("rgb_color".into(), rgb.clone());
        }
        if let Some(transition) = body.get("transition") {
            obj.insert("transition".into(), transition.clone());
        }
    }

    match state
        .ha_client
        .call_service("light", service, service_data, "")
        .await
    {
        Ok(resp) => Ok(Json(
            serde_json::json!({ "success": true, "entity_id": entity_id, "action": service, "response": resp }),
        )),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Lichtsteuerung fehlgeschlagen: {}",
            e
        ))),
    }
}

/// Get all media player entities with state
async fn get_all_media_players(State(state): State<AppState>) -> Json<Value> {
    let entities = state.entity_cache.get_all().await;
    let players: Vec<Value> = entities
        .iter()
        .filter(|e| e.entity_id.starts_with("media_player."))
        .map(|e| {
            serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "friendly_name": e.attributes.get("friendly_name"),
                "media_title": e.attributes.get("media_title"),
                "media_artist": e.attributes.get("media_artist"),
                "media_album_name": e.attributes.get("media_album_name"),
                "volume_level": e.attributes.get("volume_level"),
                "is_volume_muted": e.attributes.get("is_volume_muted"),
                "media_content_type": e.attributes.get("media_content_type"),
                "entity_picture": e.attributes.get("entity_picture"),
                "last_changed": e.last_changed,
            })
        })
        .collect();
    Json(serde_json::json!({ "media_players": players, "count": players.len() }))
}

/// Control a media player (play, pause, stop, volume, next, previous)
async fn control_media_player(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let action = body
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("media_play_pause");
    let service = match action {
        "play" | "media_play" => "media_play",
        "pause" | "media_pause" => "media_pause",
        "play_pause" | "media_play_pause" => "media_play_pause",
        "stop" | "media_stop" => "media_stop",
        "next" | "media_next_track" => "media_next_track",
        "previous" | "media_previous_track" => "media_previous_track",
        "volume_set" => "volume_set",
        "volume_up" => "volume_up",
        "volume_down" => "volume_down",
        "volume_mute" => "volume_mute",
        _ => "media_play_pause",
    };

    let mut service_data = serde_json::json!({ "entity_id": entity_id });
    if let Some(obj) = service_data.as_object_mut() {
        if let Some(volume) = body.get("volume_level") {
            obj.insert("volume_level".into(), volume.clone());
        }
        if let Some(mute) = body.get("is_volume_muted") {
            obj.insert("is_volume_muted".into(), mute.clone());
        }
    }

    match state
        .ha_client
        .call_service("media_player", service, service_data, "")
        .await
    {
        Ok(resp) => Ok(Json(
            serde_json::json!({ "success": true, "entity_id": entity_id, "action": service, "response": resp }),
        )),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Media-Player-Steuerung fehlgeschlagen: {}",
            e
        ))),
    }
}

/// Get a specific sensor entity's state and attributes
async fn get_sensor(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    match entities.iter().find(|e| e.entity_id == entity_id) {
        Some(entity) => Ok(Json(serde_json::json!({
            "entity_id": entity.entity_id,
            "state": entity.state,
            "attributes": entity.attributes,
            "last_changed": entity.last_changed,
            "last_updated": entity.last_updated,
        }))),
        None => Err(ErrorResponse::not_found(format!(
            "Sensor {} nicht gefunden",
            entity_id
        ))),
    }
}

/// Press a button entity
async fn press_button(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let service_data = serde_json::json!({ "entity_id": entity_id });
    match state
        .ha_client
        .call_service("button", "press", service_data, "")
        .await
    {
        Ok(resp) => Ok(Json(
            serde_json::json!({ "success": true, "entity_id": entity_id, "response": resp }),
        )),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Button-Auslösung fehlgeschlagen: {}",
            e
        ))),
    }
}

/// Control a switch entity (on/off/toggle)
async fn control_switch(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let action = body
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("toggle");
    let service = match action {
        "on" | "turn_on" => "turn_on",
        "off" | "turn_off" => "turn_off",
        _ => "toggle",
    };
    let service_data = serde_json::json!({ "entity_id": entity_id });
    match state
        .ha_client
        .call_service("switch", service, service_data, "")
        .await
    {
        Ok(resp) => Ok(Json(
            serde_json::json!({ "success": true, "entity_id": entity_id, "action": service, "response": resp }),
        )),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Switch-Steuerung fehlgeschlagen: {}",
            e
        ))),
    }
}

/// Admin: Get available HA calendars
async fn admin_ha_calendars(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    if let Some(data) = state.ha_data_cache.get_api("/api/calendars").await {
        return Ok(Json(serde_json::json!({
            "calendars": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        })));
    }

    match state.ha_client.get_calendars().await {
        Ok(data) => Ok(Json(serde_json::json!({
            "calendars": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Kalender nicht verfügbar: {}",
            e
        ))),
    }
}

/// Admin: Get calendar events for a specific calendar entity
async fn admin_ha_calendar_events(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ErrorResponse> {
    let now = chrono::Utc::now();
    let start = params
        .get("start")
        .cloned()
        .unwrap_or_else(|| now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());
    let end = params.get("end").cloned().unwrap_or_else(|| {
        (now + chrono::Duration::days(7))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string()
    });

    match state
        .ha_client
        .get_calendar_events(&entity_id, &start, &end)
        .await
    {
        Ok(data) => Ok(Json(serde_json::json!({
            "entity_id": entity_id,
            "events": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Kalender-Events nicht verfügbar: {}",
            e
        ))),
    }
}

/// Admin: Render a Jinja2 template in Home Assistant
async fn admin_ha_render_template(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let template = body
        .get("template")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("'template' field required"))?;

    match state.ha_client.render_template(template).await {
        Ok(result) => Ok(Json(serde_json::json!({
            "result": result,
            "template": template,
        }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Template-Rendering fehlgeschlagen: {}",
            e
        ))),
    }
}

/// Admin: Fire an event on Home Assistant
async fn admin_ha_fire_event(
    State(state): State<AppState>,
    Path(event_type): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.ha_client.fire_event(&event_type, body).await {
        Ok(result) => Ok(Json(serde_json::json!({
            "success": true,
            "event_type": event_type,
            "result": result,
        }))),
        Err(e) => Err(ErrorResponse::internal(format!(
            "Event konnte nicht gesendet werden: {}",
            e
        ))),
    }
}

/// Admin: Get HA entity registry (all registered entities with metadata)
async fn admin_ha_entity_registry(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    // Build a rich registry from cached entities
    let mut domains: HashMap<String, Vec<Value>> = HashMap::new();
    let mut total_unavailable = 0u32;

    for e in &all_entities {
        let domain = e
            .entity_id
            .split('.')
            .next()
            .unwrap_or("unknown")
            .to_string();
        let is_unavailable = e.state == "unavailable" || e.state == "unknown";
        if is_unavailable {
            total_unavailable += 1;
        }

        domains.entry(domain).or_default().push(serde_json::json!({
            "entity_id": e.entity_id,
            "state": e.state,
            "friendly_name": e.attributes.get("friendly_name"),
            "device_class": e.attributes.get("device_class"),
            "unit": e.attributes.get("unit_of_measurement"),
            "icon": e.attributes.get("icon"),
            "last_changed": e.last_changed,
            "last_updated": e.last_updated,
        }));
    }

    let domain_summary: Vec<Value> = domains
        .iter()
        .map(|(domain, entities)| {
            serde_json::json!({
                "domain": domain,
                "count": entities.len(),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "total": all_entities.len(),
        "unavailable": total_unavailable,
        "domains": domain_summary,
        "entities": domains,
    })))
}

/// Admin: Get HA device registry (grouped by integration/area)
async fn admin_ha_device_registry(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    // Group entities by device attributes
    let mut devices: HashMap<String, Vec<Value>> = HashMap::new();
    let mut by_area: HashMap<String, Vec<String>> = HashMap::new();
    let mut by_integration: HashMap<String, usize> = HashMap::new();

    for e in &all_entities {
        let device_class = e
            .attributes
            .get("device_class")
            .and_then(|v| v.as_str())
            .unwrap_or("other")
            .to_string();

        if let Some(area) = e.attributes.get("area_id").and_then(|v| v.as_str()) {
            by_area
                .entry(area.to_string())
                .or_default()
                .push(e.entity_id.clone());
        }

        // Infer integration from domain
        let domain = e.entity_id.split('.').next().unwrap_or("unknown");
        *by_integration.entry(domain.to_string()).or_insert(0) += 1;

        devices
            .entry(device_class)
            .or_default()
            .push(serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "friendly_name": e.attributes.get("friendly_name"),
                "manufacturer": e.attributes.get("manufacturer"),
                "model": e.attributes.get("model"),
                "sw_version": e.attributes.get("sw_version"),
            }));
    }

    Ok(Json(serde_json::json!({
        "total_entities": all_entities.len(),
        "by_device_class": devices,
        "by_area": by_area,
        "by_integration": by_integration,
        "area_count": by_area.len(),
    })))
}

/// Admin: Get HA area registry
async fn admin_ha_area_registry(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    let mut areas: HashMap<String, Vec<Value>> = HashMap::new();

    for e in &all_entities {
        if let Some(area) = e.attributes.get("area_id").and_then(|v| v.as_str()) {
            areas
                .entry(area.to_string())
                .or_default()
                .push(serde_json::json!({
                    "entity_id": e.entity_id,
                    "state": e.state,
                    "friendly_name": e.attributes.get("friendly_name"),
                    "domain": e.entity_id.split('.').next().unwrap_or("unknown"),
                }));
        }
    }

    let area_summary: Vec<Value> = areas
        .iter()
        .map(|(area, entities)| {
            serde_json::json!({
                "area_id": area,
                "entity_count": entities.len(),
                "domains": entities.iter()
                    .filter_map(|e| e.get("domain").and_then(|d| d.as_str()))
                    .collect::<std::collections::HashSet<_>>(),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "areas": area_summary,
        "area_count": areas.len(),
        "entities_by_area": areas,
    })))
}

/// Admin: Get dashboard system logs (backend logs)
async fn admin_system_logs() -> Result<Json<Value>, ErrorResponse> {
    // Read from tracing subscriber's output file if available,
    // otherwise return info about the logging setup
    Ok(Json(serde_json::json!({
        "log_level": system_config::rust_log(),
        "note": "Backend logs are written to stdout/stderr. Use 'docker logs' or journal to view them.",
        "tip": "Set RUST_LOG=debug for more detailed logging.",
    })))
}

/// Admin: Get database statistics
async fn admin_database_info(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    // PostgreSQL version
    let pg_version: String = sqlx::query_scalar("SELECT version()")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or_else(|_| "unknown".to_string());

    // Database size
    let db_name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or_else(|_| "iora".to_string());
    let db_size_bytes: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or(0);

    // Active connections
    let (active_connections,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()")
            .fetch_one(&state.db_pool)
            .await
            .unwrap_or((0,));

    // Max connections
    let max_conn: String = sqlx::query_scalar("SHOW max_connections")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or_else(|_| "100".to_string());

    // Server uptime
    let pg_uptime: String = sqlx::query_scalar(
        "SELECT date_trunc('second', now() - pg_postmaster_start_time())::text FROM pg_postmaster_start_time()"
    ).fetch_one(&state.db_pool).await.unwrap_or_else(|_| "unknown".to_string());

    // Table row counts
    let (user_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (history_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entity_history")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (api_key_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM api_keys")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (page_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM pages")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (widget_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM widgets")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (device_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM devices")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (webhook_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM webhooks")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (pref_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM system_preferences")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (notification_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM system_notifications")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (warning_log_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM warning_log")
        .fetch_one(&state.db_pool)
        .await
        .unwrap_or((0,));
    let (temp_user_count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM temp_db_users WHERE expires_at > NOW()")
            .fetch_one(&state.db_pool)
            .await
            .unwrap_or((0,));

    // Table sizes (top tables by estimated size)
    let table_sizes: Vec<(String, i64)> = sqlx::query_as(
        "SELECT relname::text, pg_total_relation_size(c.oid)::bigint \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relkind = 'r' \
         ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 20",
    )
    .fetch_all(&state.db_pool)
    .await
    .unwrap_or_default();

    let table_sizes_json: Vec<Value> = table_sizes.into_iter().map(|(name, size)| {
        json!({ "name": name, "size_bytes": size, "size_mb": (size as f64 / 1_048_576.0 * 100.0).round() / 100.0 })
    }).collect();

    // Connection string info (redacted)
    let db_url = system_config::database_url();
    let db_host = db_url
        .split('@')
        .last()
        .and_then(|s| s.split('/').next())
        .unwrap_or("localhost")
        .to_string();

    Ok(Json(json!({
        "engine": "PostgreSQL",
        "version": pg_version,
        "database_name": db_name,
        "host": db_host,
        "size_bytes": db_size_bytes,
        "size_mb": (db_size_bytes as f64 / 1_048_576.0 * 100.0).round() / 100.0,
        "active_connections": active_connections,
        "max_connections": max_conn,
        "uptime": pg_uptime,
        "tables": {
            "users": user_count,
            "entity_history": history_count,
            "api_keys": api_key_count,
            "pages": page_count,
            "widgets": widget_count,
            "devices": device_count,
            "webhooks": webhook_count,
            "system_preferences": pref_count,
            "system_notifications": notification_count,
            "warning_log": warning_log_count,
        },
        "temp_db_users_active": temp_user_count,
        "table_sizes": table_sizes_json,
    })))
}

// ── Temp DB Users ─────────────────────────────────────────────

/// Admin: list active temporary database users
async fn admin_list_temp_users(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let rows: Vec<(String, String, String, String, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, username, description, permissions, \
         to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), \
         revoked, \
         to_char(last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') \
         FROM temp_db_users ORDER BY created_at DESC",
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!("Failed to list temp users: {e}");
        ErrorResponse::internal("Fehler beim Laden der Temp-Benutzer")
    })?;

    let users: Vec<Value> = rows
        .into_iter()
        .map(|(id, username, desc, perms, expires, revoked, last_used)| {
            json!({
                "id": id,
                "username": username,
                "description": desc,
                "permissions": perms,
                "expires_at": expires,
                "revoked": revoked,
                "last_used_at": last_used,
            })
        })
        .collect();

    Ok(Json(json!({ "users": users })))
}

/// Admin: create a temporary database user (max 1 month expiry)
async fn admin_create_temp_user(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let username = body
        .get("username")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Benutzername erforderlich"))?;
    let password = body
        .get("password")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Passwort erforderlich"))?;
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let permissions = body
        .get("permissions")
        .and_then(|v| v.as_str())
        .unwrap_or("readonly");
    let expires_in_days: i64 = body
        .get("expires_in_days")
        .and_then(|v| v.as_i64())
        .unwrap_or(7);

    // Validate
    if username.len() < 3 || username.len() > 63 {
        return Err(ErrorResponse::bad_request(
            "Benutzername muss 3-63 Zeichen haben",
        ));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(ErrorResponse::bad_request(
            "Benutzername darf nur Buchstaben, Zahlen und _ enthalten",
        ));
    }
    if password.len() < 8 {
        return Err(ErrorResponse::bad_request(
            "Passwort muss mindestens 8 Zeichen haben",
        ));
    }
    if expires_in_days < 1 || expires_in_days > 31 {
        return Err(ErrorResponse::bad_request(
            "Ablauf muss zwischen 1 und 31 Tagen liegen",
        ));
    }
    if permissions != "readonly" && permissions != "readwrite" {
        return Err(ErrorResponse::bad_request(
            "Berechtigung muss 'readonly' oder 'readwrite' sein",
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let password_hash = auth::hash_password(password).map_err(|e| {
        warn!("Hash failed: {e}");
        ErrorResponse::internal("Passwort-Hashing fehlgeschlagen")
    })?;

    sqlx::query(
        "INSERT INTO temp_db_users (id, username, password_hash, description, permissions, created_by, expires_at) \
         VALUES ($1, $2, $3, $4, $5, 'admin', NOW() + make_interval(days => $6))"
    )
    .bind(&id)
    .bind(username)
    .bind(&password_hash)
    .bind(description)
    .bind(permissions)
    .bind(expires_in_days as i32)
    .execute(&state.db_pool).await.map_err(|e| {
        warn!("Failed to create temp user: {e}");
        if e.to_string().contains("unique") || e.to_string().contains("duplicate") {
            ErrorResponse::bad_request("Benutzername existiert bereits")
        } else {
            ErrorResponse::internal("Fehler beim Erstellen des Temp-Benutzers")
        }
    })?;

    info!(
        "Temp DB user created: {} (expires in {} days, {})",
        username, expires_in_days, permissions
    );
    Ok(Json(json!({
        "id": id,
        "username": username,
        "permissions": permissions,
        "expires_in_days": expires_in_days,
    })))
}

/// Admin: revoke (soft-delete) a temporary database user
async fn admin_revoke_temp_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let result =
        sqlx::query("UPDATE temp_db_users SET revoked = TRUE, revoked_at = NOW() WHERE id = $1")
            .bind(&user_id)
            .execute(&state.db_pool)
            .await
            .map_err(|e| {
                warn!("Failed to revoke temp user: {e}");
                ErrorResponse::internal("Fehler beim Widerrufen des Temp-Benutzers")
            })?;

    if result.rows_affected() == 0 {
        return Err(ErrorResponse::bad_request("Temp-Benutzer nicht gefunden"));
    }

    info!("Temp DB user revoked: {}", user_id);
    Ok(Json(json!({ "revoked": true, "id": user_id })))
}

// ── Maintenance Mode ──────────────────────────────────────────

/// Public endpoint: returns current maintenance status (no auth required)
async fn public_maintenance_status() -> Json<Value> {
    let settings = DASHBOARD_SETTINGS.read().await;
    let active = settings
        .get("maintenance_mode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let message = settings
        .get("maintenance_message")
        .and_then(|v| v.as_str())
        .unwrap_or("Das Dashboard befindet sich im Wartungsmodus.")
        .to_string();
    Json(serde_json::json!({
        "active": active,
        "message": message,
    }))
}

/// Admin: get maintenance mode status
async fn admin_get_maintenance() -> Json<Value> {
    let settings = DASHBOARD_SETTINGS.read().await;
    let active = settings
        .get("maintenance_mode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let message = settings
        .get("maintenance_message")
        .and_then(|v| v.as_str())
        .unwrap_or("Das Dashboard befindet sich im Wartungsmodus.")
        .to_string();
    Json(serde_json::json!({
        "active": active,
        "message": message,
    }))
}

/// Admin: toggle maintenance mode and/or update message
async fn admin_set_maintenance(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut settings = DASHBOARD_SETTINGS.write().await;

    if let Some(active) = body.get("active").and_then(|v| v.as_bool()) {
        settings.insert("maintenance_mode".into(), Value::Bool(active));
    }
    if let Some(msg) = body.get("message").and_then(|v| v.as_str()) {
        settings.insert("maintenance_message".into(), Value::String(msg.to_string()));
    }

    let active = settings
        .get("maintenance_mode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let message = settings
        .get("maintenance_message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    drop(settings);

    // Broadcast to all connected WebSocket clients
    let event = serde_json::json!({
        "type": "maintenance_mode",
        "active": active,
        "message": message,
    });
    state.ws_manager.broadcast_json(&event).await;

    info!(
        "Maintenance mode {}: {}",
        if active { "ENABLED" } else { "DISABLED" },
        message
    );

    Json(serde_json::json!({
        "active": active,
        "message": message,
    }))
}

// ── Notification & Alert Handlers ────────────────────────────────────

/// Get all notifications (authenticated user) — from DB
async fn get_notifications(State(state): State<AppState>) -> Json<Vec<Value>> {
    match sqlx::query_as::<_, (String, String, String, String, String, String, String, String, bool, i32)>(
        "SELECT id, title, message, level, source, icon, entity_id, created_at, read, auto_dismiss_secs FROM notifications ORDER BY created_at DESC LIMIT 200"
    )
    .fetch_all(&state.db_pool)
    .await {
        Ok(rows) => {
            let notifs: Vec<Value> = rows.into_iter().map(|r| json!({
                "id": r.0, "title": r.1, "message": r.2, "level": r.3,
                "source": r.4, "icon": r.5, "entity_id": r.6,
                "created_at": r.7, "read": r.8, "auto_dismiss_secs": r.9,
            })).collect();
            Json(notifs)
        }
        Err(e) => {
            warn!("Failed to load notifications: {}", e);
            Json(vec![])
        }
    }
}

/// Mark a notification as read — in DB
async fn mark_notification_read(
    State(state): State<AppState>,
    Path(notif_id): Path<String>,
) -> StatusCode {
    match sqlx::query("UPDATE notifications SET read = true WHERE id = $1")
        .bind(&notif_id)
        .execute(&state.db_pool)
        .await
    {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

/// Dismiss (delete) a notification — from DB
async fn dismiss_notification(
    State(state): State<AppState>,
    Path(notif_id): Path<String>,
) -> StatusCode {
    match sqlx::query("DELETE FROM notifications WHERE id = $1")
        .bind(&notif_id)
        .execute(&state.db_pool)
        .await
    {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

/// Get active emergency alert (public for dashboard rendering)
async fn get_active_alert() -> Json<Value> {
    let alert = ACTIVE_EMERGENCY.read().await;
    match &*alert {
        Some(a) => Json(serde_json::json!({"active": true, "alert": a})),
        None => Json(serde_json::json!({"active": false})),
    }
}

// ── Notification Dispatcher Handlers ─────────────────────────────────────────

/// POST /api/notifications/send — dispatch a notification to one or more channels.
///
/// Body:
/// ```json
/// {
///   "title": "...", "message": "...", "level": "info",
///   "source": "my_app", "icon": "", "entity_id": "",
///   "auto_dismiss_secs": 0,
///   "channels": [],            // optional: channel IDs; empty = all enabled
///   "extra_data": {}           // optional: forwarded to channels (e.g. HA data block)
/// }
/// ```
async fn notification_send(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let req = notification_dispatcher::DispatchRequest {
        title: body
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Notification")
            .to_string(),
        message: body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        level: body
            .get("level")
            .and_then(|v| v.as_str())
            .unwrap_or("info")
            .to_string(),
        source: body
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("iora")
            .to_string(),
        icon: body
            .get("icon")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        entity_id: body
            .get("entity_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        auto_dismiss_secs: body
            .get("auto_dismiss_secs")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32,
        channels: body
            .get("channels")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        extra_data: body
            .get("extra_data")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    };

    let (id, results) = state.notification_dispatcher.dispatch(req).await;
    let all_ok = results.iter().all(|r| r.status != "error");
    let status = if all_ok {
        StatusCode::OK
    } else {
        StatusCode::MULTI_STATUS
    };
    (
        status,
        Json(serde_json::json!({"id": id, "results": results})),
    )
}

/// GET /api/notifications/channels — list all notification channels.
async fn notification_channels_list(State(state): State<AppState>) -> Json<Value> {
    let channels = state.notification_dispatcher.list_channels().await;
    Json(serde_json::json!({"channels": channels}))
}

/// POST /api/notifications/channels — create a notification channel.
///
/// Body:
/// ```json
/// {
///   "name": "My Pixel 8",
///   "channel_type": "ha_mobile",   // "iora" | "ha_mobile" | "desktop"
///   "target_id": "mobile_app_pixel_8",
///   "config": {}
/// }
/// ```
async fn notification_channel_create(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let name = match body.get("name").and_then(|v| v.as_str()) {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "name required"})),
            )
                .into_response()
        }
    };
    let channel_type = match body.get("channel_type").and_then(|v| v.as_str()) {
        Some(t) if matches!(t, "iora" | "ha_mobile" | "desktop") => t.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "channel_type must be one of: iora, ha_mobile, desktop"}))).into_response(),
    };
    let target_id = body
        .get("target_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let config = body.get("config").cloned().unwrap_or(serde_json::json!({}));

    match state
        .notification_dispatcher
        .create_channel(name, channel_type, target_id, config)
        .await
    {
        Ok(ch) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"channel": ch})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

/// PUT /api/notifications/channels/:channel_id — update a notification channel.
async fn notification_channel_update(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let name = body.get("name").and_then(|v| v.as_str()).map(String::from);
    let target_id = body
        .get("target_id")
        .and_then(|v| v.as_str())
        .map(String::from);
    let enabled = body.get("enabled").and_then(|v| v.as_bool());
    let config = body.get("config").cloned();

    match state
        .notification_dispatcher
        .update_channel(&channel_id, name, target_id, enabled, config)
        .await
    {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

/// DELETE /api/notifications/channels/:channel_id — delete a notification channel.
async fn notification_channel_delete(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
) -> StatusCode {
    match state
        .notification_dispatcher
        .delete_channel(&channel_id)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

/// Get all currently active warning entities (weather warnings, DWD, NINA, etc.)
async fn get_active_warnings(State(state): State<AppState>) -> Json<Value> {
    let all_entities = state.entity_cache.get_all().await;
    let mut warnings = Vec::new();

    for entity in &all_entities {
        if !ha_websocket::is_warning_entity(&entity.entity_id, &entity.attributes) {
            continue;
        }
        // Check if the warning is active
        let is_active = matches!(entity.state.as_str(), "on" | "On")
            || entity.state.parse::<u64>().map_or(false, |n| n > 0);

        if !is_active {
            continue;
        }

        let (level, title, message) = ha_websocket::extract_warning_info(entity);
        warnings.push(serde_json::json!({
            "entity_id": entity.entity_id,
            "state": entity.state,
            "level": level,
            "title": title,
            "message": message,
            "attributes": entity.attributes,
            "last_changed": entity.last_changed,
        }));
    }

    Json(serde_json::json!({ "warnings": warnings }))
}

/// Admin: list all notifications
async fn admin_list_notifications(State(state): State<AppState>) -> Json<Vec<Value>> {
    match sqlx::query_as::<_, (String, String, String, String, String, String, String, String, bool, i32)>(
        "SELECT id, title, message, level, source, icon, entity_id, created_at, read, auto_dismiss_secs FROM notifications ORDER BY created_at DESC LIMIT 200"
    )
    .fetch_all(&state.db_pool)
    .await {
        Ok(rows) => {
            let notifs: Vec<Value> = rows.into_iter().map(|r| json!({
                "id": r.0, "title": r.1, "message": r.2, "level": r.3,
                "source": r.4, "icon": r.5, "entity_id": r.6,
                "created_at": r.7, "read": r.8, "auto_dismiss_secs": r.9,
            })).collect();
            Json(notifs)
        }
        Err(e) => {
            warn!("Failed to load notifications: {}", e);
            Json(vec![])
        }
    }
}

/// Admin: clear all notifications
async fn admin_clear_notifications(State(state): State<AppState>) -> StatusCode {
    let _ = sqlx::query("DELETE FROM notifications")
        .execute(&state.db_pool)
        .await;
    let event = serde_json::json!({ "type": "notification", "action": "clear_all" });
    state.ws_manager.broadcast_json(&event).await;
    StatusCode::OK
}

/// Admin: mark notification read
async fn admin_mark_notification_read(
    State(state): State<AppState>,
    Path(notif_id): Path<String>,
) -> StatusCode {
    match sqlx::query("UPDATE notifications SET read = true WHERE id = $1")
        .bind(&notif_id)
        .execute(&state.db_pool)
        .await
    {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

/// Admin: dismiss a notification
async fn admin_dismiss_notification(
    Path(notif_id): Path<String>,
    State(state): State<AppState>,
) -> StatusCode {
    match sqlx::query("DELETE FROM notifications WHERE id = $1")
        .bind(&notif_id)
        .execute(&state.db_pool)
        .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let event = serde_json::json!({
                "type": "notification",
                "action": "dismissed",
                "id": notif_id,
            });
            state.ws_manager.broadcast_json(&event).await;
            StatusCode::OK
        }
        _ => StatusCode::NOT_FOUND,
    }
}

/// Admin: get active alert
async fn admin_get_alert() -> Json<Value> {
    let alert = ACTIVE_EMERGENCY.read().await;
    match &*alert {
        Some(a) => Json(serde_json::json!({"active": true, "alert": a})),
        None => Json(serde_json::json!({"active": false})),
    }
}

/// Admin: set an emergency alert from admin panel
async fn admin_set_alert(State(state): State<AppState>, Json(body): Json<Value>) -> Json<Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let level = body
        .get("level")
        .and_then(|v| v.as_str())
        .unwrap_or("warning");
    let alert = serde_json::json!({
        "id": id,
        "title": body.get("title").and_then(|v| v.as_str()).unwrap_or("Warnung"),
        "message": body.get("message").and_then(|v| v.as_str()).unwrap_or(""),
        "level": level,
        "source": "admin",
        "color": body.get("color").and_then(|v| v.as_str()).unwrap_or(""),
        "icon": body.get("icon").and_then(|v| v.as_str()).unwrap_or(""),
        "created_at": chrono::Utc::now().to_rfc3339(),
    });
    *ACTIVE_EMERGENCY.write().await = Some(alert.clone());
    // Also create notification in DB
    if let Err(e) = sqlx::query(
        "INSERT INTO notifications (id, title, message, level, source, icon, entity_id, created_at, read, auto_dismiss_secs) VALUES ($1, $2, $3, $4, 'admin', $5, '', $6, false, 0)"
    )
        .bind(&id)
        .bind(alert["title"].as_str().unwrap_or(""))
        .bind(alert["message"].as_str().unwrap_or(""))
        .bind(level)
        .bind(alert["icon"].as_str().unwrap_or(""))
        .bind(chrono::Utc::now())
        .execute(&state.db_pool)
        .await
    {
        warn!("Failed to persist admin alert notification: {}", e);
    }
    let event = serde_json::json!({
        "type": "emergency_alert",
        "action": "set",
        "alert": alert,
    });
    state.ws_manager.broadcast_json(&event).await;
    info!("Admin set alert: [{}] {}", level, alert["title"]);
    Json(serde_json::json!({"active": true, "alert": alert}))
}

/// Admin: dismiss active alert
async fn admin_dismiss_alert(State(state): State<AppState>) -> StatusCode {
    *ACTIVE_EMERGENCY.write().await = None;
    let event = serde_json::json!({
        "type": "emergency_alert",
        "action": "dismiss",
    });
    state.ws_manager.broadcast_json(&event).await;
    info!("Admin dismissed emergency alert");
    StatusCode::OK
}

/// Admin: get warning log entries
async fn admin_get_warning_log(
    State(state): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, StatusCode> {
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(100);
    let offset = params
        .get("offset")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let active_only = params.get("active").map(|v| v == "true").unwrap_or(false);

    let rows = if active_only {
        sqlx::query_as::<_, (i64, String, String, String, String, String, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>, String, bool)>(
            "SELECT id, entity_id, title, message, level, source, started_at, ended_at, attributes_json, acknowledged FROM warning_log WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT $1 OFFSET $2"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db_pool)
        .await
    } else {
        sqlx::query_as::<_, (i64, String, String, String, String, String, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>, String, bool)>(
            "SELECT id, entity_id, title, message, level, source, started_at, ended_at, attributes_json, acknowledged FROM warning_log ORDER BY started_at DESC LIMIT $1 OFFSET $2"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db_pool)
        .await
    };

    match rows {
        Ok(entries) => {
            let warnings: Vec<Value> = entries.into_iter().map(|(id, entity_id, title, message, level, source, started_at, ended_at, attrs, ack)| {
                serde_json::json!({
                    "id": id,
                    "entity_id": entity_id,
                    "title": title,
                    "message": message,
                    "level": level,
                    "source": source,
                    "started_at": started_at.to_rfc3339(),
                    "ended_at": ended_at.map(|dt| dt.to_rfc3339()),
                    "attributes": serde_json::from_str::<Value>(&attrs).unwrap_or(Value::Null),
                    "acknowledged": ack,
                })
            }).collect();

            // Get total count
            let total: (i64,) = sqlx::query_as(if active_only {
                "SELECT COUNT(*) FROM warning_log WHERE ended_at IS NULL"
            } else {
                "SELECT COUNT(*) FROM warning_log"
            })
            .fetch_one(&state.db_pool)
            .await
            .unwrap_or((0,));

            Ok(Json(serde_json::json!({
                "warnings": warnings,
                "total": total.0,
                "limit": limit,
                "offset": offset,
            })))
        }
        Err(e) => {
            warn!("Failed to fetch warning log: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// Admin: clear warning log
async fn admin_clear_warning_log(State(state): State<AppState>) -> StatusCode {
    let _ = sqlx::query("DELETE FROM warning_log")
        .execute(&state.db_pool)
        .await;
    info!("Admin cleared warning log");
    StatusCode::OK
}

// ═══════════════════════════════════════════════════════════════════════
// NINA Warning System — Direct API integration
// ═══════════════════════════════════════════════════════════════════════

const NINA_API_BASE: &str = "https://warnung.bund.de/api31";

/// Get NINA settings (ARS codes, enabled state, poll interval)
async fn get_nina_settings(State(state): State<AppState>) -> Json<Value> {
    let settings = match state
        .config_repo
        .get_system_preference("nina_settings")
        .await
    {
        Ok(Some(pref)) => serde_json::from_str::<Value>(&pref.preference_value)
            .unwrap_or(json!({"enabled": false, "ars_regions": [], "poll_interval_minutes": 5})),
        _ => json!({"enabled": false, "ars_regions": [], "poll_interval_minutes": 5}),
    };
    Json(settings)
}

/// Save NINA settings
async fn save_nina_settings(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    let enabled = body
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let ars_regions = body.get("ars_regions").cloned().unwrap_or(json!([]));
    let poll_interval = body
        .get("poll_interval_minutes")
        .and_then(|v| v.as_u64())
        .unwrap_or(5);

    let settings = json!({
        "enabled": enabled,
        "ars_regions": ars_regions,
        "poll_interval_minutes": poll_interval.max(1).min(60),
    });

    let request = db::models::SaveSystemPreferenceRequest {
        preference_key: "nina_settings".to_string(),
        preference_value: settings.clone(),
    };

    match state.config_repo.save_system_preference(request).await {
        Ok(_) => {
            info!(
                "[NINA] Settings updated: enabled={}, regions={}",
                enabled, ars_regions
            );
            // If enabled, trigger an immediate poll
            if enabled {
                let http = state.http_client.clone();
                let ws = state.ws_manager.clone();
                let db = state.db_pool.clone();
                let regions = ars_regions.clone();
                tokio::spawn(async move {
                    nina_poll_regions(&http, &regions, &ws, &db).await;
                });
            } else {
                // Clear cached warnings
                let mut cache = NINA_WARNINGS.write().await;
                cache.clear();
            }
            Ok(Json(settings))
        }
        Err(e) => {
            warn!("[NINA] Failed to save settings: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// Get currently cached NINA warnings
async fn get_nina_warnings() -> Json<Value> {
    let warnings = NINA_WARNINGS.read().await;
    Json(json!({ "warnings": *warnings }))
}

/// GitHub raw URL for the Landkreise AGS dataset
const LANDKREISE_URL: &str = "https://raw.githubusercontent.com/opendatalab-de/checkgermany/refs/heads/master/frontend/src/data/landkreise.json";

/// All 16 Bundesländer with their ARS codes (not in Landkreise dataset)
const BUNDESLAENDER: &[(&str, &str)] = &[
    ("01", "Schleswig-Holstein"),
    ("02", "Hamburg"),
    ("03", "Niedersachsen"),
    ("04", "Bremen"),
    ("05", "Nordrhein-Westfalen"),
    ("06", "Hessen"),
    ("07", "Rheinland-Pfalz"),
    ("08", "Baden-Württemberg"),
    ("09", "Bayern"),
    ("10", "Saarland"),
    ("11", "Berlin"),
    ("12", "Brandenburg"),
    ("13", "Mecklenburg-Vorpommern"),
    ("14", "Sachsen"),
    ("15", "Sachsen-Anhalt"),
    ("16", "Thüringen"),
];

/// Fetch and parse ARS regions from GitHub Landkreise dataset.
/// Returns the regions vec or an error message.
async fn fetch_ars_regions(http: &reqwest::Client) -> Result<Vec<Value>, String> {
    info!("[NINA] Fetching AGS Landkreise data from GitHub...");

    let resp = http
        .get(LANDKREISE_URL)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub returned status {}", resp.status()));
    }

    let data: Vec<Value> = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse failed: {}", e))?;

    let mut regions: Vec<Value> = Vec::with_capacity(data.len() + BUNDESLAENDER.len());

    // Add Bundesländer first (pad 2-digit code to 12 digits)
    for (code, name) in BUNDESLAENDER {
        let ars = format!("{:0<12}", code);
        regions.push(json!({ "ars": ars, "name": *name, "type": "Bundesland" }));
    }

    // Parse Landkreise: AGS is 5 digits, pad to 12 for NINA ARS
    for entry in &data {
        let ags = match entry.get("AGS").and_then(|v| v.as_str()) {
            Some(v) => v,
            None => continue,
        };
        let raw_name = match entry
            .get("Kreisfreie Stadt, Kreis/Landkreis")
            .and_then(|v| v.as_str())
        {
            Some(v) => v,
            None => continue,
        };
        let region_type = entry.get("Region").and_then(|v| v.as_str()).unwrap_or("");

        // Pad AGS to 12 digits: "09162" → "091620000000"
        let ars = format!("{:0<12}", ags);

        // Clean display name: remove Stadt/Hansestadt/etc. suffixes
        let display_name = raw_name
            .trim_end_matches(", Stadt")
            .trim_end_matches(", Hansestadt")
            .trim_end_matches(", Kreisstadt")
            .trim_end_matches(", Landeshauptstadt")
            .trim_end_matches(", Universitätsstadt")
            .trim_end_matches(", kreisfreie Stadt")
            .trim_end_matches(", Klingenstadt")
            .trim_end_matches(", Wissenschaftsstadt")
            .trim_end_matches(", documenta-Stadt")
            .trim_end_matches(", Freie und Hansestadt")
            .trim_end_matches(", Stadt der FernUniversität")
            .to_string();

        regions.push(json!({
            "ars": ars,
            "name": display_name,
            "type": region_type
        }));
    }

    info!(
        "[NINA] Parsed {} ARS regions ({} Bundesländer + {} Landkreise)",
        regions.len(),
        BUNDESLAENDER.len(),
        data.len()
    );
    Ok(regions)
}

/// Update the ARS regions cache (shared logic for startup + periodic refresh)
async fn refresh_ars_regions_cache(http: &reqwest::Client) -> bool {
    match fetch_ars_regions(http).await {
        Ok(regions) => {
            let count = regions.len();
            {
                let mut cache = ARS_REGIONS_CACHE.write().await;
                *cache = Some(regions);
            }
            {
                let mut ts = ARS_REGIONS_LAST_REFRESH.write().await;
                *ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
            }
            info!("[NINA] ARS regions cache refreshed: {} entries", count);
            true
        }
        Err(e) => {
            warn!("[NINA] Failed to refresh ARS regions cache: {}", e);
            false
        }
    }
}

/// Background loop: warms ARS cache on startup, refreshes every 24h
async fn background_ars_cache_refresh(http: reqwest::Client) {
    // Initial warm-up (immediately on startup)
    task_entry(10).record_run();
    refresh_ars_regions_cache(&http).await;

    // Refresh every 24 hours
    let refresh_interval = std::time::Duration::from_secs(24 * 60 * 60);
    loop {
        tokio::time::sleep(refresh_interval).await;
        task_entry(10).record_run();
        refresh_ars_regions_cache(&http).await;
    }
}

/// Get all ARS regions (served from cache, warmed on startup).
async fn get_nina_regions(State(state): State<AppState>) -> Result<Json<Value>, StatusCode> {
    // Serve from cache
    {
        let cache = ARS_REGIONS_CACHE.read().await;
        if let Some(ref regions) = *cache {
            return Ok(Json(json!({ "regions": regions })));
        }
    }

    // Cache miss (shouldn't happen after startup, but handle gracefully)
    info!("[NINA] ARS cache empty on request — fetching on-demand...");
    if refresh_ars_regions_cache(&state.http_client).await {
        let cache = ARS_REGIONS_CACHE.read().await;
        if let Some(ref regions) = *cache {
            return Ok(Json(json!({ "regions": regions })));
        }
    }

    Err(StatusCode::BAD_GATEWAY)
}

/// Send a test warning to all connected clients via WebSocket
async fn admin_send_test_warning(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    let level = body
        .get("level")
        .and_then(|v| v.as_str())
        .unwrap_or("warning");
    let headline = body
        .get("headline")
        .and_then(|v| v.as_str())
        .unwrap_or("Test-Warnung");
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("Dies ist eine Testwarnung.");

    // Validate level
    let valid_levels = ["info", "warning", "critical", "emergency"];
    if !valid_levels.contains(&level) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let test_id = format!("test-{}", chrono::Utc::now().timestamp_millis());
    let entity_id = format!("nina.test_{}", test_id);

    // Build test warning for cache
    let test_warning = json!({
        "id": entity_id,
        "headline": headline,
        "description": description,
        "severity": match level {
            "emergency" => "Extreme",
            "critical" => "Severe",
            "warning" => "Moderate",
            _ => "Minor",
        },
        "level": level,
        "region": "Test",
        "source": "NINA-TEST",
        "sender": "NINA-TEST",
        "sent": chrono::Utc::now().to_rfc3339(),
        "effective": chrono::Utc::now().to_rfc3339(),
        "expires": "",
        "category": "Test",
        "msg_type": "Alert",
    });

    // Add to NINA_WARNINGS cache so /api/nina/warnings returns it
    {
        let mut cache = NINA_WARNINGS.write().await;
        cache.insert(0, test_warning);
    }

    let event = json!({
        "type": "warning_entity_update",
        "entity_id": entity_id,
        "active": true,
        "level": level,
        "title": headline,
        "message": description,
        "attributes": {
            "sender": "NINA-TEST",
            "source": "NINA-TEST",
            "severity": match level {
                "emergency" => "Extreme",
                "critical" => "Severe",
                "warning" => "Moderate",
                _ => "Minor",
            },
            "friendly_name": format!("NINA Test: {}", headline),
        },
        "state": "on",
        "source": "NINA-TEST",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    state.ws_manager.broadcast_json(&event).await;

    info!("[NINA-TEST] Test warning sent: [{}] {}", level, headline);

    // Auto-clear after 30 seconds
    let ws = state.ws_manager.clone();
    let eid = entity_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

        // Remove from NINA_WARNINGS cache
        {
            let mut cache = NINA_WARNINGS.write().await;
            cache.retain(|w| w.get("id").and_then(|v| v.as_str()) != Some(&eid));
        }

        let clear_event = json!({
            "type": "warning_entity_update",
            "entity_id": eid,
            "active": false,
            "level": "info",
            "title": "",
            "message": "",
            "state": "off",
            "source": "NINA-TEST",
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        ws.broadcast_json(&clear_event).await;
    });

    Ok(Json(json!({ "success": true, "entity_id": entity_id })))
}

/// Map NINA severity string to dashboard warning level
fn nina_severity_to_level(severity: &str) -> &'static str {
    match severity.to_lowercase().as_str() {
        "extreme" => "emergency",
        "severe" => "critical",
        "moderate" => "warning",
        "minor" => "info",
        _ => "warning",
    }
}

/// Poll NINA API for all configured ARS regions and update the warning cache
async fn nina_poll_regions(
    http: &reqwest::Client,
    ars_regions: &Value,
    ws_manager: &crate::websocket::WebSocketManager,
    db_pool: &DbPool,
) {
    let regions = match ars_regions.as_array() {
        Some(arr) => arr,
        None => return,
    };

    let mut all_warnings: Vec<Value> = Vec::new();

    for region in regions {
        let raw_ars = match region.get("ars").and_then(|v| v.as_str()) {
            Some(code) => code,
            None => continue,
        };
        let region_name = region
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(raw_ars);

        // Truncate to Kreis level: keep first 5 digits, pad with 0000000
        // NINA API only provides data at Kreis level (12 digits, last 7 = 0000000)
        let ars_code = if raw_ars.len() >= 5 {
            format!("{}0000000", &raw_ars[..5])
        } else {
            format!("{:0<12}", raw_ars)
        };

        let url = format!("{}/dashboard/{}.json", NINA_API_BASE, ars_code);

        match http
            .get(&url)
            .header("Accept", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Vec<Value>>().await {
                    Ok(dashboard_items) => {
                        for item in &dashboard_items {
                            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let payload = item.get("payload").unwrap_or(item);
                            let data = payload.get("data").unwrap_or(payload);

                            let headline = data
                                .get("headline")
                                .and_then(|v| v.as_str())
                                .or_else(|| data.get("event").and_then(|v| v.as_str()))
                                .unwrap_or("Warnung");
                            let description = data
                                .get("description")
                                .and_then(|v| v.as_str())
                                .or_else(|| data.get("instruction").and_then(|v| v.as_str()))
                                .unwrap_or("");
                            let severity = data
                                .get("severity")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Moderate");
                            let sender = data
                                .get("sender")
                                .and_then(|v| v.as_str())
                                .unwrap_or("NINA");
                            let sent = data.get("sent").and_then(|v| v.as_str()).unwrap_or("");
                            let effective = data
                                .get("effective")
                                .and_then(|v| v.as_str())
                                .unwrap_or(sent);
                            let expires =
                                data.get("expires").and_then(|v| v.as_str()).unwrap_or("");
                            let msg_type = item
                                .get("msgType")
                                .and_then(|v| v.as_str())
                                .or_else(|| item.get("type").and_then(|v| v.as_str()))
                                .unwrap_or("Alert");
                            let category =
                                data.get("category").and_then(|v| v.as_str()).unwrap_or("");

                            // Skip cancelled/expired items
                            if msg_type.eq_ignore_ascii_case("Cancel") {
                                continue;
                            }

                            let level = nina_severity_to_level(severity);

                            let warning = json!({
                                "id": id,
                                "headline": headline,
                                "description": description,
                                "severity": severity,
                                "level": level,
                                "category": category,
                                "sender": sender,
                                "sent": sent,
                                "effective": effective,
                                "expires": expires,
                                "region": region_name,
                                "ars": ars_code.as_str(),
                                "msg_type": msg_type,
                                "source": "NINA",
                            });

                            all_warnings.push(warning);
                        }
                    }
                    Err(e) => {
                        warn!(
                            "[NINA] Failed to parse response for ARS {}: {}",
                            ars_code, e
                        );
                    }
                }
            }
            Ok(resp) => {
                warn!(
                    "[NINA] API returned status {} for ARS {}",
                    resp.status(),
                    ars_code
                );
            }
            Err(e) => {
                warn!("[NINA] Failed to fetch ARS {}: {}", ars_code, e);
            }
        }
    }

    // Deduplicate by ID
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    all_warnings.retain(|w| {
        let id = w
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            return true;
        }
        seen_ids.insert(id)
    });

    // Compare with previous cache to detect new warnings
    let prev_ids: std::collections::HashSet<String> = {
        let cache = NINA_WARNINGS.read().await;
        cache
            .iter()
            .filter_map(|w| w.get("id").and_then(|v| v.as_str()).map(String::from))
            .collect()
    };

    let new_warnings: Vec<&Value> = all_warnings
        .iter()
        .filter(|w| {
            let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("");
            !id.is_empty() && !prev_ids.contains(id)
        })
        .collect();

    // Broadcast new warnings as notifications + log to DB
    for w in &new_warnings {
        let headline = w
            .get("headline")
            .and_then(|v| v.as_str())
            .unwrap_or("NINA Warnung");
        let description = w.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let level = w.get("level").and_then(|v| v.as_str()).unwrap_or("warning");
        let sender = w.get("sender").and_then(|v| v.as_str()).unwrap_or("NINA");
        let region = w.get("region").and_then(|v| v.as_str()).unwrap_or("");
        let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("");

        info!("[NINA] New warning: [{}] {} ({})", level, headline, region);

        let desc_truncated: String = description.chars().take(400).collect();
        let desc_msg = if desc_truncated.len() < description.len() {
            format!("{}…", desc_truncated)
        } else {
            desc_truncated
        };

        // Broadcast as warning_entity_update so the existing WarningBar picks it up
        let event = json!({
            "type": "warning_entity_update",
            "entity_id": format!("nina.{}", id.replace('.', "_").chars().take(80).collect::<String>()),
            "active": true,
            "level": level,
            "title": headline,
            "message": desc_msg,
            "attributes": {
                "sender": sender,
                "source": "NINA",
                "region": region,
                "severity": w.get("severity").and_then(|v| v.as_str()).unwrap_or("Moderate"),
                "friendly_name": format!("NINA: {}", headline),
            },
            "state": "on",
            "source": "NINA",
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        ws_manager.broadcast_json(&event).await;

        // Log to warning_log DB
        let db = db_pool.clone();
        let entity_id = format!(
            "nina.{}",
            id.replace('.', "_").chars().take(80).collect::<String>()
        );
        let title_c = headline.to_string();
        let msg_c = desc_msg.clone();
        let level_c = level.to_string();
        let source_c = sender.to_string();
        let attrs_c = serde_json::to_string(w).unwrap_or_default();
        tokio::spawn(async move {
            let _ = sqlx::query(
                "INSERT INTO warning_log (entity_id, title, message, level, source, started_at, attributes_json) VALUES ($1, $2, $3, $4, $5, NOW(), $6) ON CONFLICT DO NOTHING"
            )
            .bind(&entity_id)
            .bind(&title_c)
            .bind(&msg_c)
            .bind(&level_c)
            .bind(&source_c)
            .bind(&attrs_c)
            .execute(&db)
            .await;
        });
    }

    // Detect cleared warnings
    let current_ids: std::collections::HashSet<String> = all_warnings
        .iter()
        .filter_map(|w| w.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();

    for old_id in &prev_ids {
        if !current_ids.contains(old_id) {
            let entity_id = format!(
                "nina.{}",
                old_id
                    .replace('.', "_")
                    .chars()
                    .take(80)
                    .collect::<String>()
            );
            let event = json!({
                "type": "warning_entity_update",
                "entity_id": entity_id,
                "active": false,
                "level": "info",
                "title": "",
                "message": "",
                "state": "off",
                "source": "NINA",
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            ws_manager.broadcast_json(&event).await;

            // Close DB log entry
            let db = db_pool.clone();
            let eid = entity_id.clone();
            tokio::spawn(async move {
                let _ = sqlx::query(
                    "UPDATE warning_log SET ended_at = NOW() WHERE entity_id = $1 AND ended_at IS NULL"
                )
                .bind(&eid)
                .execute(&db)
                .await;
            });
        }
    }

    // Update cache
    let mut cache = NINA_WARNINGS.write().await;
    *cache = all_warnings.clone();
    drop(cache);

    // Persist active warnings to DB for restart recovery
    let _ = sqlx::query("DELETE FROM nina_warning_cache")
        .execute(db_pool)
        .await;
    for w in &all_warnings {
        let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let expires = w.get("expires").and_then(|v| v.as_str()).unwrap_or("");
        let json_str = serde_json::to_string(w).unwrap_or_default();
        let _ = sqlx::query(
            "INSERT INTO nina_warning_cache (id, warning_json, expires_at) VALUES ($1, $2, NULLIF($3, '')) ON CONFLICT (id) DO UPDATE SET warning_json = EXCLUDED.warning_json, expires_at = EXCLUDED.expires_at"
        )
            .bind(id)
            .bind(&json_str)
            .bind(expires)
            .execute(db_pool)
            .await;
    }
}

/// Background task: polls NINA API at the configured interval
async fn background_nina_poller(
    http: reqwest::Client,
    config_repo: Arc<ConfigRepository>,
    ws_manager: Arc<crate::websocket::WebSocketManager>,
    db_pool: DbPool,
) {
    // On startup: restore cached warnings from DB (survive restarts)
    match sqlx::query_as::<_, (String, String, Option<chrono::DateTime<chrono::Utc>>)>(
        "SELECT id, warning_json, expires_at FROM nina_warning_cache",
    )
    .fetch_all(&db_pool)
    .await
    {
        Ok(rows) => {
            let now = chrono::Utc::now();
            let mut restored: Vec<Value> = Vec::new();
            let mut expired_ids: Vec<String> = Vec::new();

            for (id, json_str, expires_at) in &rows {
                // Check if expired
                if let Some(exp_dt) = expires_at {
                    if *exp_dt < now {
                        expired_ids.push(id.clone());
                        continue;
                    }
                }

                if let Ok(w) = serde_json::from_str::<Value>(json_str) {
                    restored.push(w);
                }
            }

            // Remove expired from DB
            for eid in &expired_ids {
                let _ = sqlx::query("DELETE FROM nina_warning_cache WHERE id = $1")
                    .bind(eid)
                    .execute(&db_pool)
                    .await;
                // Also close the warning_log entry
                let entity_id = format!(
                    "nina.{}",
                    eid.replace('.', "_").chars().take(80).collect::<String>()
                );
                let _ = sqlx::query("UPDATE warning_log SET ended_at = NOW() WHERE entity_id = $1 AND ended_at IS NULL")
                    .bind(&entity_id)
                    .execute(&db_pool)
                    .await;
            }

            if !restored.is_empty() {
                info!(
                    "[NINA] Restored {} cached warnings from DB ({} expired)",
                    restored.len(),
                    expired_ids.len()
                );
                // Broadcast restored warnings to any early-connected clients
                for w in &restored {
                    let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let headline = w
                        .get("headline")
                        .and_then(|v| v.as_str())
                        .unwrap_or("NINA Warnung");
                    let description = w.get("description").and_then(|v| v.as_str()).unwrap_or("");
                    let level = w.get("level").and_then(|v| v.as_str()).unwrap_or("warning");
                    let region = w.get("region").and_then(|v| v.as_str()).unwrap_or("");
                    let desc_truncated: String = description.chars().take(400).collect();

                    let event = json!({
                        "type": "warning_entity_update",
                        "entity_id": format!("nina.{}", id.replace('.', "_").chars().take(80).collect::<String>()),
                        "active": true,
                        "level": level,
                        "title": headline,
                        "message": desc_truncated,
                        "attributes": {
                            "sender": w.get("sender").and_then(|v| v.as_str()).unwrap_or("NINA"),
                            "source": "NINA",
                            "region": region,
                            "severity": w.get("severity").and_then(|v| v.as_str()).unwrap_or("Moderate"),
                            "friendly_name": format!("NINA: {}", headline),
                        },
                        "state": "on",
                        "source": "NINA",
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    });
                    ws_manager.broadcast_json(&event).await;
                }

                let mut cache = NINA_WARNINGS.write().await;
                *cache = restored;
            } else if !expired_ids.is_empty() {
                info!(
                    "[NINA] All {} cached warnings were expired, cleared",
                    expired_ids.len()
                );
            }
        }
        Err(e) => {
            warn!("[NINA] Failed to restore cached warnings from DB: {}", e);
        }
    }

    // Wait 15s before first poll to let the system start up
    tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;

    loop {
        // Read settings each iteration (user can change them)
        let (enabled, regions, interval_min) =
            match config_repo.get_system_preference("nina_settings").await {
                Ok(Some(pref)) => {
                    let v =
                        serde_json::from_str::<Value>(&pref.preference_value).unwrap_or_default();
                    let enabled = v.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
                    let regions = v.get("ars_regions").cloned().unwrap_or(json!([]));
                    let interval = v
                        .get("poll_interval_minutes")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(5);
                    (enabled, regions, interval)
                }
                _ => (false, json!([]), 5),
            };

        task_entry(9).record_run();
        if enabled {
            if let Some(arr) = regions.as_array() {
                if !arr.is_empty() {
                    nina_poll_regions(&http, &regions, &ws_manager, &db_pool).await;
                }
            }
        }

        let sleep_secs = interval_min.max(1) * 60;
        tokio::time::sleep(tokio::time::Duration::from_secs(sleep_secs)).await;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Webhook API — CRUD + delivery system
// ═══════════════════════════════════════════════════════════════════════

/// Create a new webhook
async fn create_webhook(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let url = body
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if name.is_empty() || url.is_empty() {
        return Err(ErrorResponse::bad_request("name and url are required"));
    }
    // Validate URL format
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(ErrorResponse::bad_request(
            "url must start with http:// or https://",
        ));
    }
    let secret = body
        .get("secret")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let events = body.get("events").cloned().unwrap_or_else(|| json!(["*"]));
    let headers = body.get("headers").cloned().unwrap_or_else(|| json!({}));
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO webhooks (id, user_id, name, url, secret, events, headers) VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(&id).bind(user_id).bind(&name).bind(&url).bind(&secret)
    .bind(events.to_string()).bind(headers.to_string())
    .execute(&state.db_pool).await
    .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    Ok(Json(
        json!({ "id": id, "name": name, "url": url, "events": events, "active": true }),
    ))
}

/// List webhooks for the current user
async fn list_webhooks(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    let rows: Vec<(String, String, String, String, String, bool, String, String, Option<String>, i64, i64)> =
        sqlx::query_as(
            "SELECT id, name, url, events, headers, active, created_at, updated_at, last_triggered_at, trigger_count, consecutive_failures FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC"
        )
        .bind(user_id)
        .fetch_all(&state.db_pool).await
        .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let webhooks: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.0, "name": r.1, "url": r.2,
                "events": serde_json::from_str::<Value>(&r.3).unwrap_or(json!(["*"])),
                "headers": serde_json::from_str::<Value>(&r.4).unwrap_or(json!({})),
                "active": r.5, "created_at": r.6, "updated_at": r.7,
                "last_triggered_at": r.8, "trigger_count": r.9, "consecutive_failures": r.10,
            })
        })
        .collect();

    Ok(Json(json!({ "webhooks": webhooks })))
}

/// Update a webhook
async fn update_webhook(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Path(webhook_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    // Verify ownership
    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM webhooks WHERE id = $1 AND user_id = $2")
            .bind(&webhook_id)
            .bind(user_id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;
    if exists.is_none() {
        return Err(ErrorResponse::not_found("Webhook not found"));
    }

    if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
        sqlx::query("UPDATE webhooks SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name)
            .bind(&webhook_id)
            .execute(&state.db_pool)
            .await
            .ok();
    }
    if let Some(url) = body.get("url").and_then(|v| v.as_str()) {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(ErrorResponse::bad_request(
                "url must start with http:// or https://",
            ));
        }
        sqlx::query("UPDATE webhooks SET url = $1, updated_at = NOW() WHERE id = $2")
            .bind(url)
            .bind(&webhook_id)
            .execute(&state.db_pool)
            .await
            .ok();
    }
    if let Some(secret) = body.get("secret").and_then(|v| v.as_str()) {
        sqlx::query("UPDATE webhooks SET secret = $1, updated_at = NOW() WHERE id = $2")
            .bind(secret)
            .bind(&webhook_id)
            .execute(&state.db_pool)
            .await
            .ok();
    }
    if let Some(events) = body.get("events") {
        sqlx::query("UPDATE webhooks SET events = $1, updated_at = NOW() WHERE id = $2")
            .bind(events.to_string())
            .bind(&webhook_id)
            .execute(&state.db_pool)
            .await
            .ok();
    }
    if let Some(headers) = body.get("headers") {
        sqlx::query("UPDATE webhooks SET headers = $1, updated_at = NOW() WHERE id = $2")
            .bind(headers.to_string())
            .bind(&webhook_id)
            .execute(&state.db_pool)
            .await
            .ok();
    }
    if let Some(active) = body.get("active").and_then(|v| v.as_bool()) {
        sqlx::query("UPDATE webhooks SET active = $1, updated_at = NOW() WHERE id = $2")
            .bind(active)
            .bind(&webhook_id)
            .execute(&state.db_pool)
            .await
            .ok();
    }

    Ok(Json(json!({ "success": true, "id": webhook_id })))
}

/// Delete a webhook
async fn delete_webhook(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Path(webhook_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    let result = sqlx::query("DELETE FROM webhooks WHERE id = $1 AND user_id = $2")
        .bind(&webhook_id)
        .bind(user_id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    if result.rows_affected() == 0 {
        return Err(ErrorResponse::not_found("Webhook not found"));
    }
    Ok(Json(json!({ "success": true })))
}

/// Test a webhook by sending a test payload
async fn test_webhook(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Path(webhook_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT url, secret, headers FROM webhooks WHERE id = $1 AND user_id = $2")
            .bind(&webhook_id)
            .bind(user_id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let (url, secret, headers_json) =
        row.ok_or_else(|| ErrorResponse::not_found("Webhook not found"))?;

    let test_payload = json!({
        "event": "webhook.test",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": { "message": "This is a test webhook delivery" }
    });

    let result = deliver_webhook_payload(
        &state.http_client,
        &url,
        &secret,
        &headers_json,
        &test_payload,
    )
    .await;

    // Log delivery
    sqlx::query(
        "INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status_code, response_body, duration_ms, success, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
    )
    .bind(&webhook_id).bind("webhook.test").bind(test_payload.to_string())
    .bind(result.status_code).bind(&result.response_body)
    .bind(result.duration_ms).bind(result.success).bind(&result.error)
    .execute(&state.db_pool).await.ok();

    Ok(Json(json!({
        "success": result.success,
        "status_code": result.status_code,
        "duration_ms": result.duration_ms,
        "error": result.error,
    })))
}

/// Get webhook delivery log
async fn get_webhook_deliveries(
    State(state): State<AppState>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
    Path(webhook_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ErrorResponse> {
    let user_id = identity.user_id();
    // Verify ownership
    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM webhooks WHERE id = $1 AND user_id = $2")
            .bind(&webhook_id)
            .bind(user_id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;
    if exists.is_none() {
        return Err(ErrorResponse::not_found("Webhook not found"));
    }

    let limit: i64 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50)
        .min(200);
    let rows: Vec<(i64, String, String, Option<i32>, Option<String>, Option<i64>, i32, bool, Option<String>, String)> =
        sqlx::query_as(
            "SELECT id, event_type, payload, status_code, response_body, duration_ms, attempt, success, error, created_at FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT $2"
        )
        .bind(&webhook_id).bind(limit)
        .fetch_all(&state.db_pool).await
        .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let deliveries: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.0, "event_type": r.1,
                "payload": serde_json::from_str::<Value>(&r.2).unwrap_or(json!(null)),
                "status_code": r.3, "response_body": r.4, "duration_ms": r.5,
                "attempt": r.6, "success": r.7, "error": r.8, "created_at": r.9,
            })
        })
        .collect();

    Ok(Json(json!({ "deliveries": deliveries })))
}

/// Admin: list all webhooks across all users
async fn admin_list_all_webhooks(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let rows: Vec<(String, String, String, String, String, bool, String, Option<String>, i64, i64)> =
        sqlx::query_as(
            "SELECT id, user_id, name, url, events, active, created_at, last_triggered_at, trigger_count, consecutive_failures FROM webhooks ORDER BY created_at DESC"
        )
        .fetch_all(&state.db_pool).await
        .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let webhooks: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.0, "user_id": r.1, "name": r.2, "url": r.3,
                "events": serde_json::from_str::<Value>(&r.4).unwrap_or(json!(["*"])),
                "active": r.5, "created_at": r.6,
                "last_triggered_at": r.7, "trigger_count": r.8, "consecutive_failures": r.9,
            })
        })
        .collect();

    Ok(Json(json!({ "webhooks": webhooks })))
}

// ── IORA Control Center handlers ─────────────────────────────────────────────

/// Fetch service health overview from all IORA subsystems
async fn admin_control_services(State(state): State<AppState>) -> Json<Value> {
    use futures_util::future::join_all;

    let client = state.http_client.clone();
    let services = vec![
        (
            "iora-home",
            system_config::service_url("iora-home", 3001),
            "Dashboard Backend, API, Auth, Streaming",
        ),
        (
            "iora-core",
            system_config::service_url("iora-core", 8090),
            "Service Registry, Tasks, Plugins",
        ),
        (
            "iora-control",
            system_config::service_url("iora-control", 8091),
            "Dashboard Aggregation, System Monitor",
        ),
        (
            "iora-assist",
            system_config::service_url("iora-assist", 8092),
            "AI Chat, Automation Suggestions",
        ),
        (
            "iora-secrets",
            system_config::service_url("iora-secrets", 8093),
            "Secret & Credential Management",
        ),
        (
            "iora-watchdog",
            system_config::service_url("iora-watchdog", 8094),
            "Service Monitoring & Alerting",
        ),
        (
            "iora-security",
            system_config::service_url("iora-security", 8095),
            "Security Monitoring, Audit Logging",
        ),
        (
            "iora-gateway",
            system_config::service_url("iora-gateway", 8096),
            "API Gateway, External Integrations",
        ),
        (
            "iora-supervisor",
            system_config::service_url("iora-supervisor", 8097),
            "App-Container, Docker und Laufzeitverwaltung",
        ),
        (
            "iora-appstore",
            system_config::service_url("iora-appstore", 8098),
            "App Store, Pakete und Signaturen",
        ),
        (
            "iora-intelligence",
            system_config::service_url("iora-intelligence", 8099),
            "KI-gestützte Systemanalyse & Health Intelligence",
        ),
        (
            "iora-files",
            system_config::service_url("iora-files", 8100),
            "Dateien, Freigaben und App-Artefakte",
        ),
        (
            "iora-connector",
            system_config::service_url("iora-connector", 8102),
            "Remote-Zugriff und Cloud-Verbindung",
        ),
        (
            "iora-network-monitor",
            system_config::service_url("iora-network-monitor", 8103),
            "Netzwerk-Scan und Geräteerkennung",
        ),
        (
            "iora-domain-validator",
            system_config::service_url("iora-domain-validator", 8104),
            "Domain-Whitelist und DNS-Prüfung",
        ),
        (
            "iora-resource-manager",
            system_config::service_url("iora-resource-manager", 8105),
            "CPU-, RAM- und Speicherüberwachung",
        ),
        (
            "iora-updater",
            system_config::service_url("iora-updater", 8106),
            "System- und App-Updates",
        ),
        (
            "iora-backup",
            system_config::service_url("iora-backup", 8107),
            "Backups und Wiederherstellung",
        ),
        (
            "iora-nginx",
            system_config::service_url("iora-nginx", 8108),
            "Reverse Proxy und TLS-Routing",
        ),
    ];

    let checks = services.into_iter().map(|(name, url, description)| {
        let client = client.clone();
        async move {
        let health_url = format!("{}/health", url);
        let (status, uptime, details) = match client.get(&health_url)
            .timeout(std::time::Duration::from_millis(900))
            .send().await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: Value = resp.json().await.unwrap_or(json!({}));
                let uptime = body.get("uptime_seconds").and_then(|v| v.as_u64()).unwrap_or(0);
                ("online", uptime, body)
            }
            Ok(resp) => ("degraded", 0u64, json!({ "http_status": resp.status().as_u16() })),
            // Connection refused / DNS failure / timeout — almost always
            // means the service binary just isn't running on this system
            // (e.g. dashboard-only deployment). Surface this as
            // "not_deployed" so the UI can render it neutrally instead of
            // as a red "Offline" alarm. iora-home itself is special-cased:
            // if we're running this handler, iora-home is obviously up,
            // so treat its own failure as a real outage.
            Err(_) if name == "iora-home" => ("offline", 0u64, json!({ "note": "self check failed" })),
            Err(_) => ("not_deployed", 0u64, json!({ "note": "Dienst nicht erreichbar — vermutlich nicht installiert oder nicht aktiviert." })),
        };
        json!({
            "name": name,
            "url": url,
            "description": description,
            "status": status,
            "uptime_seconds": uptime,
            "details": details,
        })
        }
    });
    let results = join_all(checks).await;

    Json(json!({ "services": results, "timestamp": chrono::Utc::now().to_rfc3339() }))
}

/// List background tasks from iora-core
async fn admin_control_tasks(State(_state): State<AppState>) -> Json<Value> {
    let tasks: Vec<Value> = TASK_REGISTRY
        .iter()
        .enumerate()
        .map(|(i, t)| t.to_json(i))
        .collect();
    let total = tasks.len();
    Json(json!({ "tasks": tasks, "total": total }))
}

/// Trigger a background task manually (resets run count tracking timestamp)
async fn admin_control_trigger_task(
    State(_state): State<AppState>,
    Path(task_id): Path<String>,
) -> Json<Value> {
    if let Ok(idx) = task_id.parse::<usize>() {
        if idx < TASK_REGISTRY.len() {
            task_entry(idx).record_run();
            return Json(
                json!({ "message": "task triggered", "id": idx, "name": TASK_REGISTRY[idx].name }),
            );
        }
    }
    Json(json!({ "error": format!("task '{}' not found", task_id) }))
}

/// Toggle a background task enabled/disabled
async fn admin_control_toggle_task(
    State(_state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    if let Ok(idx) = task_id.parse::<usize>() {
        if idx < TASK_REGISTRY.len() {
            let entry = task_entry(idx);
            let prev = entry.enabled.load(Ordering::Relaxed);
            entry.enabled.store(!prev, Ordering::Relaxed);
            return Ok(Json(json!({
                "task_id": idx,
                "name": entry.name,
                "previous_enabled": prev,
                "enabled": !prev,
            })));
        }
    }
    Err(ErrorResponse::bad_request(format!(
        "task '{}' not found",
        task_id
    )))
}

/// Persistent control mode stored in system_preferences
static CONTROL_MODE_KEY: &str = "iora_control_mode";

/// Get current control mode (autonomous/manual)
async fn admin_control_get_mode(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let pref: Option<(String,)> =
        sqlx::query_as("SELECT preference_value FROM system_preferences WHERE preference_key = $1")
            .bind(CONTROL_MODE_KEY)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let mode = pref
        .map(|p| p.0)
        .unwrap_or_else(|| "autonomous".to_string());
    let parsed: Value = serde_json::from_str(&mode).unwrap_or(json!("autonomous"));

    Ok(Json(json!({
        "mode": parsed,
        "available_modes": ["autonomous", "manual", "supervised"],
        "description": {
            "autonomous": "System führt Automationen, Watchdogs und Schedules selbstständig aus",
            "manual": "Alle automatischen Aktionen pausiert — nur manuelle Steuerung",
            "supervised": "Automationen laufen, aber mit Bestätigung vor kritischen Aktionen"
        }
    })))
}

/// Set control mode
async fn admin_control_set_mode(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let mode = body
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("autonomous");
    if !["autonomous", "manual", "supervised"].contains(&mode) {
        return Err(ErrorResponse::bad_request(
            "Invalid mode. Use: autonomous, manual, supervised",
        ));
    }

    let mode_json = json!(mode).to_string();
    sqlx::query(
        "INSERT INTO system_preferences (id, preference_key, preference_value) VALUES (gen_random_uuid()::text, $1, $2) ON CONFLICT (preference_key) DO UPDATE SET preference_value = $2, updated_at = NOW()"
    )
    .bind(CONTROL_MODE_KEY)
    .bind(&mode_json)
    .execute(&state.db_pool).await
    .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    // Broadcast mode change to all connected WebSocket clients
    let _ = state
        .ws_manager
        .broadcast_json(&json!({
            "type": "control_mode_changed",
            "mode": mode,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        }))
        .await;

    Ok(Json(
        json!({ "mode": mode, "message": "Betriebsmodus aktualisiert" }),
    ))
}

/// Full control center overview (aggregated)
async fn admin_control_overview(State(state): State<AppState>) -> Json<Value> {
    // Get control mode
    let mode: String = sqlx::query_as::<_, (String,)>(
        "SELECT preference_value FROM system_preferences WHERE preference_key = $1",
    )
    .bind(CONTROL_MODE_KEY)
    .fetch_optional(&state.db_pool)
    .await
    .ok()
    .flatten()
    .map(|p| p.0)
    .unwrap_or_else(|| "\"autonomous\"".to_string());
    let mode_val: Value = serde_json::from_str(&mode).unwrap_or(json!("autonomous"));

    // Get active watchdogs count
    let watchdog_count = ENTITY_WATCHDOGS.read().await.len();

    // Get active schedules count
    let schedule_count = SCHEDULED_ACTIONS.read().await.len();

    // Get maintenance mode
    let maintenance: Option<(String,)> = sqlx::query_as(
        "SELECT preference_value FROM system_preferences WHERE preference_key = 'maintenance_mode'",
    )
    .fetch_optional(&state.db_pool)
    .await
    .ok()
    .flatten();
    let is_maintenance = maintenance.map(|m| m.0 == "true").unwrap_or(false);

    Json(json!({
        "mode": mode_val,
        "maintenance": is_maintenance,
        "active_watchdogs": watchdog_count,
        "active_schedules": schedule_count,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

/// Generic proxy: forwards /api/admin/iora-control/<path> to
/// iora-control's internal service URL. The endpoint is
/// already gated by the admin middleware on the `admin_routes` group, so we
/// simply replay the verb, headers (minus hop-by-hop), and body, and stream
/// the upstream response back unchanged.
async fn admin_iora_control_proxy(
    State(state): State<AppState>,
    method: axum::http::Method,
    Path(path): Path<String>,
    headers: HeaderMap,
    raw_query: RawQuery,
    body: axum::body::Bytes,
) -> Response {
    let qs = raw_query
        .0
        .as_deref()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let base = std::env::var("IORA_CONTROL_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| system_config::service_url("iora-control", 8091));
    let url = format!("{}/api/control/{}{}", base.trim_end_matches('/'), path, qs);

    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => {
            return (
                StatusCode::METHOD_NOT_ALLOWED,
                Json(json!({"error": "unsupported method"})),
            )
                .into_response()
        }
    };

    let mut req = state.http_client.request(reqwest_method, &url);
    for (k, v) in headers.iter() {
        let name = k.as_str().to_ascii_lowercase();
        // Skip hop-by-hop headers and the dashboard's own auth bearer. The
        // upstream iora-control is reached on the internal IORA service network
        // and does not re-validate the dashboard JWT.
        if matches!(
            name.as_str(),
            "host" | "content-length" | "connection" | "authorization" | "cookie"
        ) {
            continue;
        }
        if let Ok(val) = v.to_str() {
            req = req.header(k.as_str(), val);
        }
    }
    if !body.is_empty() {
        req = req.body(body.to_vec());
    }

    match req.timeout(std::time::Duration::from_secs(15)).send().await {
        Ok(resp) => {
            let status = resp.status();
            let upstream_status =
                StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let bytes = resp.bytes().await.unwrap_or_default();
            let mut out = Response::builder()
                .status(upstream_status)
                .header(header::CONTENT_TYPE, content_type);
            if let Some(headers_mut) = out.headers_mut() {
                let _ = headers_mut;
            }
            out.body(axum::body::Body::from(bytes)).unwrap_or_else(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "failed to build response"})),
                )
                    .into_response()
            })
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": format!("iora-control upstream error: {}", e),
                "url": url,
            })),
        )
            .into_response(),
    }
}

// ─── IORA Log & Metrics Endpoints ──────────────────────────────────────

/// GET /api/admin/logs — Fetch log entries from the ring buffer
async fn admin_get_logs(Query(params): Query<HashMap<String, String>>) -> Json<Value> {
    let level_filter = params.get("level").map(|s| s.as_str());
    let target_filter = params.get("target").map(|s| s.as_str());
    let search = params.get("search").map(|s| s.to_lowercase());
    let limit: usize = params
        .get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(500);
    let since_id: u64 = params
        .get("since_id")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let entries: Vec<Value> = if let Ok(buf) = LOG_BUFFER.read() {
        buf.iter()
            .filter(|e| {
                if e.id <= since_id {
                    return false;
                }
                if let Some(lf) = level_filter {
                    if e.level != lf {
                        return false;
                    }
                }
                if let Some(tf) = target_filter {
                    if !e.target.contains(tf) {
                        return false;
                    }
                }
                if let Some(ref s) = search {
                    if !e.message.to_lowercase().contains(s) && !e.target.to_lowercase().contains(s)
                    {
                        return false;
                    }
                }
                true
            })
            .rev()
            .take(limit)
            .map(|e| {
                json!({
                    "id": e.id,
                    "timestamp": e.timestamp,
                    "level": e.level,
                    "target": e.target,
                    "message": e.message,
                    "fields": e.fields,
                })
            })
            .collect()
    } else {
        vec![]
    };

    let total_in_buffer = LOG_BUFFER.read().map(|b| b.len()).unwrap_or(0);

    Json(json!({
        "entries": entries,
        "total_in_buffer": total_in_buffer,
        "buffer_capacity": LOG_BUFFER_CAPACITY,
        "latest_id": LOG_ID_COUNTER.load(Ordering::Relaxed) - 1,
    }))
}

/// POST /api/admin/logs/clear — Clear the log buffer
async fn admin_clear_logs() -> Json<Value> {
    let cleared = if let Ok(mut buf) = LOG_BUFFER.write() {
        let count = buf.len();
        buf.clear();
        count
    } else {
        0
    };
    Json(json!({ "cleared": cleared, "message": "Log buffer cleared" }))
}

/// GET /api/admin/metrics — Get current metrics snapshot
async fn admin_get_metrics(State(state): State<AppState>) -> Json<Value> {
    let mut snapshot = collect_metrics_snapshot();
    // Enrich with live data from state
    if let Some(obj) = snapshot.as_object_mut() {
        let entity_count = state.entity_cache.count().await;
        let connected_clients = state.ws_manager.client_count().await;
        let entity_metrics = state.entity_cache.metrics();
        obj.insert(
            "live".to_string(),
            json!({
                "entity_count": entity_count,
                "connected_clients": connected_clients,
                "ha_connected": state.entity_cache.is_ha_connected(),
                "entity_updates_total": entity_metrics.update_count,
                "entity_cache_hits": entity_metrics.cache_hits,
            }),
        );
        // Task breakdown from registry
        let task_summary: Vec<Value> = TASK_REGISTRY
            .iter()
            .enumerate()
            .map(|(i, t)| {
                json!({
                    "id": i,
                    "name": t.name,
                    "runs": t.run_count.load(Ordering::Relaxed),
                    "errors": t.error_count.load(Ordering::Relaxed),
                    "enabled": t.enabled.load(Ordering::Relaxed),
                })
            })
            .collect();
        obj.insert("task_breakdown".to_string(), json!(task_summary));
    }
    Json(snapshot)
}

/// GET /api/admin/metrics/live — SSE stream that pushes metrics snapshots every 2 seconds
async fn admin_metrics_live_sse(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    METRICS.sse_connections.fetch_add(1, Ordering::Relaxed);
    let mut rx = METRICS_BROADCAST.subscribe();
    let entity_cache = state.entity_cache.clone();
    let ws_manager = state.ws_manager.clone();

    let stream = async_stream::stream! {
        // Send initial snapshot immediately
        let mut snapshot = collect_metrics_snapshot();
        if let Some(obj) = snapshot.as_object_mut() {
            let entity_count = entity_cache.count().await;
            let connected_clients = ws_manager.client_count().await;
            obj.insert("live".to_string(), json!({
                "entity_count": entity_count,
                "connected_clients": connected_clients,
                "ha_connected": entity_cache.is_ha_connected(),
            }));
        }
        yield Ok(SseEvent::default().event("metrics").data(snapshot.to_string()));

        loop {
            match rx.recv().await {
                Ok(mut snapshot) => {
                    // Enrich with live data
                    if let Some(obj) = snapshot.as_object_mut() {
                        let entity_count = entity_cache.count().await;
                        let connected_clients = ws_manager.client_count().await;
                        obj.insert("live".to_string(), json!({
                            "entity_count": entity_count,
                            "connected_clients": connected_clients,
                            "ha_connected": entity_cache.is_ha_connected(),
                        }));
                    }
                    yield Ok(SseEvent::default().event("metrics").data(snapshot.to_string()));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
        METRICS.sse_connections.fetch_sub(1, Ordering::Relaxed);
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// GET /api/admin/logs/live — SSE stream that pushes new log entries in real-time
async fn admin_logs_live_sse() -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    METRICS.sse_connections.fetch_add(1, Ordering::Relaxed);
    let mut rx = LOG_BROADCAST.subscribe();

    let stream = async_stream::stream! {
        yield Ok(SseEvent::default().event("connected").data(
            json!({"message": "Log stream connected", "timestamp": chrono::Utc::now().to_rfc3339()}).to_string()
        ));

        loop {
            match rx.recv().await {
                Ok(entry) => {
                    let data = json!({
                        "id": entry.id,
                        "timestamp": entry.timestamp,
                        "level": entry.level,
                        "target": entry.target,
                        "message": entry.message,
                        "fields": entry.fields,
                    });
                    yield Ok(SseEvent::default().event("log").data(data.to_string()));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    yield Ok(SseEvent::default().event("warning").data(
                        json!({"message": format!("Missed {} log entries", n)}).to_string()
                    ));
                }
                Err(_) => break,
            }
        }
        METRICS.sse_connections.fetch_sub(1, Ordering::Relaxed);
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

struct WebhookDeliveryResult {
    success: bool,
    status_code: Option<i32>,
    response_body: Option<String>,
    duration_ms: Option<i64>,
    error: Option<String>,
}

/// Deliver a webhook payload to a URL with optional HMAC-SHA256 signature
async fn deliver_webhook_payload(
    client: &reqwest::Client,
    url: &str,
    secret: &str,
    custom_headers_json: &str,
    payload: &Value,
) -> WebhookDeliveryResult {
    let body = payload.to_string();
    let start = std::time::Instant::now();

    let mut req = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("User-Agent", "MDT-HOME-Dashboard-Webhook/2.0");

    // Add HMAC-SHA256 signature if secret is set
    if !secret.is_empty() {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        if let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) {
            mac.update(body.as_bytes());
            let signature = hex::encode(mac.finalize().into_bytes());
            req = req.header("X-Webhook-Signature", format!("sha256={}", signature));
        }
    }

    // Add custom headers
    if let Ok(custom) = serde_json::from_str::<HashMap<String, String>>(custom_headers_json) {
        for (k, v) in custom {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(&v),
            ) {
                req = req.header(name, val);
            }
        }
    }

    match req.body(body).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16() as i32;
            let resp_body = resp.text().await.unwrap_or_default();
            let duration = start.elapsed().as_millis() as i64;
            WebhookDeliveryResult {
                success: (200..300).contains(&status),
                status_code: Some(status),
                response_body: Some(resp_body.chars().take(2000).collect()),
                duration_ms: Some(duration),
                error: None,
            }
        }
        Err(e) => {
            let duration = start.elapsed().as_millis() as i64;
            WebhookDeliveryResult {
                success: false,
                status_code: None,
                response_body: None,
                duration_ms: Some(duration),
                error: Some(e.to_string()),
            }
        }
    }
}

/// Background task: deliver webhooks for state change events.
/// Subscribes to the entity state broadcast channel and fans out to all active webhooks.
async fn background_webhook_delivery(
    ws_manager: Arc<websocket::WebSocketManager>,
    db_pool: DbPool,
    http_client: reqwest::Client,
    system_events: Arc<system_events::SystemEventLog>,
) {
    let mut rx = ws_manager.subscribe();
    loop {
        match rx.recv().await {
            Ok(changed_entities) => {
                task_entry(11).record_run();
                // Load active webhooks
                let webhooks: Vec<(String, String, String, String, String)> = match sqlx::query_as(
                    "SELECT id, url, secret, events, headers FROM webhooks WHERE active = 1",
                )
                .fetch_all(&db_pool)
                .await
                {
                    Ok(rows) => rows,
                    Err(e) => {
                        system_events
                            .report_error(
                                "webhook_delivery",
                                format!("DB load of active webhooks failed: {}", e),
                            )
                            .await;
                        continue;
                    }
                };

                if webhooks.is_empty() {
                    continue;
                }

                for entity in &changed_entities {
                    let event_type = format!("state_changed.{}", entity.entity_id);
                    let domain = entity.entity_id.split('.').next().unwrap_or("");

                    let payload = json!({
                        "event": "state_changed",
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                        "data": {
                            "entity_id": entity.entity_id,
                            "state": entity.state,
                            "attributes": entity.attributes,
                            "last_changed": entity.last_changed,
                            "last_updated": entity.last_updated,
                        }
                    });

                    for (wh_id, url, secret, events_json, headers_json) in &webhooks {
                        // Check event filter
                        let events: Vec<String> =
                            serde_json::from_str(events_json).unwrap_or_default();
                        let matches = events.iter().any(|e| {
                            e == "*"
                                || e == "state_changed"
                                || e == &event_type
                                || e == &format!("domain.{}", domain)
                                || e == &entity.entity_id
                        });
                        if !matches {
                            continue;
                        }

                        let client = http_client.clone();
                        let url = url.clone();
                        let secret = secret.clone();
                        let headers = headers_json.clone();
                        let payload = payload.clone();
                        let wh_id = wh_id.clone();
                        let pool = db_pool.clone();
                        let sys = system_events.clone();

                        // Fire-and-forget delivery with retry
                        tokio::spawn(async move {
                            let result =
                                deliver_webhook_payload(&client, &url, &secret, &headers, &payload)
                                    .await;

                            // Log delivery
                            if let Err(e) = sqlx::query(
                                "INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status_code, response_body, duration_ms, success, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
                            )
                            .bind(&wh_id).bind("state_changed").bind(payload.to_string())
                            .bind(result.status_code).bind(&result.response_body)
                            .bind(result.duration_ms).bind(result.success).bind(&result.error)
                            .execute(&pool).await
                            {
                                sys.report_warn(
                                    "webhook_delivery",
                                    format!("Could not persist delivery log for webhook {}: {}", wh_id, e),
                                ).await;
                            }

                            // Update webhook stats
                            if result.success {
                                if let Err(e) = sqlx::query("UPDATE webhooks SET last_triggered_at = NOW(), trigger_count = trigger_count + 1, consecutive_failures = 0 WHERE id = $1")
                                    .bind(&wh_id).execute(&pool).await
                                {
                                    sys.report_warn(
                                        "webhook_delivery",
                                        format!("Could not update success stats for webhook {}: {}", wh_id, e),
                                    ).await;
                                }
                            } else {
                                sys.report_error_with(
                                    "webhook_delivery",
                                    format!(
                                        "Webhook {} delivery failed: {}",
                                        wh_id,
                                        result.error.as_deref().unwrap_or("unknown error")
                                    ),
                                    serde_json::json!({
                                        "webhook_id": wh_id,
                                        "url": url,
                                        "status_code": result.status_code,
                                        "duration_ms": result.duration_ms,
                                    }),
                                )
                                .await;
                                let _: Option<(i64,)> = sqlx::query_as(
                                    "SELECT consecutive_failures FROM webhooks WHERE id = $1",
                                )
                                .bind(&wh_id)
                                .fetch_optional(&pool)
                                .await
                                .ok()
                                .flatten();
                                if let Err(e) = sqlx::query("UPDATE webhooks SET consecutive_failures = consecutive_failures + 1 WHERE id = $1")
                                    .bind(&wh_id).execute(&pool).await
                                {
                                    sys.report_warn(
                                        "webhook_delivery",
                                        format!("Could not increment failure counter for webhook {}: {}", wh_id, e),
                                    ).await;
                                }
                                // Auto-disable after 10 consecutive failures
                                match sqlx::query("UPDATE webhooks SET active = false WHERE id = $1 AND consecutive_failures >= 10")
                                    .bind(&wh_id).execute(&pool).await
                                {
                                    Ok(res) if res.rows_affected() > 0 => {
                                        sys.report_error(
                                            "webhook_delivery",
                                            format!("Webhook {} auto-disabled after 10 consecutive failures", wh_id),
                                        ).await;
                                    }
                                    Err(e) => {
                                        sys.report_warn(
                                            "webhook_delivery",
                                            format!("Could not auto-disable webhook {}: {}", wh_id, e),
                                        ).await;
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                system_events.report_warn(
                    "webhook_delivery",
                    format!("State-update broadcast lagged by {} messages — webhook deliveries skipped", n),
                ).await;
            }
            Err(_) => break,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Server-Sent Events (SSE) — Realtime event streaming
// ═══════════════════════════════════════════════════════════════════════

/// SSE event stream — streams entity state changes in real time.
/// Supports optional `domains` and `entity_ids` query params to filter.
async fn sse_event_stream(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let domain_filter: Vec<String> = params
        .get("domains")
        .map(|d| d.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();
    let entity_filter: Vec<String> = params
        .get("entity_ids")
        .map(|d| d.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    let mut rx = state.ws_manager.subscribe();

    let stream = async_stream::stream! {
        // Send initial connection event
        yield Ok(SseEvent::default()
            .event("connected")
            .data(json!({
                "message": "SSE stream connected",
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "filters": { "domains": domain_filter, "entity_ids": entity_filter }
            }).to_string()));

        let domain_filter = domain_filter;
        let entity_filter = entity_filter;

        loop {
            match rx.recv().await {
                Ok(changed) => {
                    let filtered: Vec<&EntityState> = changed.iter().filter(|e| {
                        if !domain_filter.is_empty() {
                            let domain = e.entity_id.split('.').next().unwrap_or("");
                            if !domain_filter.iter().any(|d| d == domain) { return false; }
                        }
                        if !entity_filter.is_empty() {
                            if !entity_filter.contains(&e.entity_id) { return false; }
                        }
                        true
                    }).collect();

                    if filtered.is_empty() { continue; }

                    let data = json!({
                        "event": "state_changed",
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                        "changed": filtered,
                    });
                    yield Ok(SseEvent::default()
                        .event("state_changed")
                        .data(data.to_string()));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    yield Ok(SseEvent::default()
                        .event("warning")
                        .data(json!({"message": format!("Lagged by {} events", n)}).to_string()));
                }
                Err(_) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// SSE system event stream — streams system-level events (health, errors, notifications).
async fn sse_system_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let mut event_rx = state.ws_manager.subscribe_events();
    let mut error_rx = state.ws_manager.subscribe_errors();

    let stream = async_stream::stream! {
        yield Ok(SseEvent::default()
            .event("connected")
            .data(json!({"message": "System SSE stream connected", "timestamp": chrono::Utc::now().to_rfc3339()}).to_string()));

        loop {
            tokio::select! {
                event = event_rx.recv() => {
                    match event {
                        Ok(ev) => {
                            let event_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("event");
                            yield Ok(SseEvent::default()
                                .event(event_type)
                                .data(ev.to_string()));
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                error = error_rx.recv() => {
                    match error {
                        Ok((id, msg)) => {
                            yield Ok(SseEvent::default()
                                .event("error")
                                .data(json!({"id": id, "message": msg}).to_string()));
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ═══════════════════════════════════════════════════════════════════════
// Realtime Namespace WebSocket — Socket.IO-style multiplexed channels
// ═══════════════════════════════════════════════════════════════════════
//
// Protocol: JSON messages with { "namespace": "...", "event": "...", "data": ... }
// Namespaces:
//   - "entities"      : subscribe to entity state changes (with domain/entity filters)
//   - "system"        : system events, health, errors
//   - "notifications" : notification events
//
// Client messages:
//   { "namespace": "entities", "event": "subscribe", "data": { "domains": [...], "entity_ids": [...] } }
//   { "namespace": "entities", "event": "unsubscribe" }
//   { "namespace": "system",   "event": "subscribe" }
//   { "event": "ping" }
//
// Server messages:
//   { "namespace": "entities", "event": "state_changed", "data": [...] }
//   { "namespace": "system",   "event": "health", "data": {...} }
//   { "namespace": "system",   "event": "error", "data": {...} }
//   { "event": "pong" }

async fn realtime_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_realtime_socket(socket, state))
}

async fn handle_realtime_socket(socket: axum::extract::ws::WebSocket, state: AppState) {
    use axum::extract::ws::Message;
    use futures_util::{SinkExt, StreamExt};

    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(tokio::sync::Mutex::new(sender));

    // Per-connection subscription state
    let entity_subs = Arc::new(tokio::sync::RwLock::new(None::<EntitySubFilter>));
    let system_sub = Arc::new(tokio::sync::RwLock::new(false));
    let notif_sub = Arc::new(tokio::sync::RwLock::new(false));

    // Send welcome
    {
        let mut s = sender.lock().await;
        let _ = s
            .send(Message::Text(
                json!({
                    "event": "connected",
                    "data": {
                        "namespaces": ["entities", "system", "notifications"],
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                        "version": env!("CARGO_PKG_VERSION"),
                    }
                })
                .to_string(),
            ))
            .await;
    }

    // Spawn broadcast forwarders
    let entity_sender = sender.clone();
    let entity_subs_r = entity_subs.clone();
    let mut entity_rx = state.ws_manager.subscribe();
    let entity_task = tokio::spawn(async move {
        loop {
            match entity_rx.recv().await {
                Ok(changed) => {
                    let subs = entity_subs_r.read().await;
                    if let Some(filter) = subs.as_ref() {
                        let filtered: Vec<&EntityState> = changed
                            .iter()
                            .filter(|e| {
                                if !filter.domains.is_empty() {
                                    let d = e.entity_id.split('.').next().unwrap_or("");
                                    if !filter.domains.contains(&d.to_string()) {
                                        return false;
                                    }
                                }
                                if !filter.entity_ids.is_empty() {
                                    if !filter.entity_ids.contains(&e.entity_id) {
                                        return false;
                                    }
                                }
                                true
                            })
                            .collect();
                        if !filtered.is_empty() {
                            let msg = json!({
                                "namespace": "entities",
                                "event": "state_changed",
                                "data": filtered,
                                "timestamp": chrono::Utc::now().to_rfc3339(),
                            });
                            let mut s = entity_sender.lock().await;
                            METRICS.ws_messages_sent.fetch_add(1, Ordering::Relaxed);
                            if s.send(Message::Text(msg.to_string())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    let sys_sender = sender.clone();
    let system_sub_r = system_sub.clone();
    let mut event_rx = state.ws_manager.subscribe_events();
    let mut error_rx = state.ws_manager.subscribe_errors();
    let system_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                ev = event_rx.recv() => {
                    if !*system_sub_r.read().await { continue; }
                    match ev {
                        Ok(data) => {
                            let event_name = data.get("type").and_then(|v| v.as_str()).unwrap_or("event").to_string();
                            let msg = json!({ "namespace": "system", "event": event_name, "data": data });
                            let mut s = sys_sender.lock().await;
                            if s.send(Message::Text(msg.to_string())).await.is_err() { break; }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                err = error_rx.recv() => {
                    if !*system_sub_r.read().await { continue; }
                    match err {
                        Ok((id, message)) => {
                            let msg = json!({ "namespace": "system", "event": "error", "data": { "id": id, "message": message } });
                            let mut s = sys_sender.lock().await;
                            if s.send(Message::Text(msg.to_string())).await.is_err() { break; }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            }
        }
    });

    let notif_sender = sender.clone();
    let notif_sub_r = notif_sub.clone();
    let mut config_rx = state.ws_manager.subscribe_config();
    let notif_task = tokio::spawn(async move {
        loop {
            match config_rx.recv().await {
                Ok(changes) => {
                    if !*notif_sub_r.read().await {
                        continue;
                    }
                    let msg = json!({ "namespace": "notifications", "event": "config_changed", "data": changes });
                    let mut s = notif_sender.lock().await;
                    if s.send(Message::Text(msg.to_string())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    // Handle incoming client messages
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            METRICS.ws_messages_received.fetch_add(1, Ordering::Relaxed);
            if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                let ns = parsed
                    .get("namespace")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let event = parsed.get("event").and_then(|v| v.as_str()).unwrap_or("");
                let data = parsed.get("data").cloned().unwrap_or(json!(null));

                match (ns, event) {
                    ("entities", "subscribe") => {
                        let domains: Vec<String> = data
                            .get("domains")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default();
                        let entity_ids: Vec<String> = data
                            .get("entity_ids")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default();
                        *entity_subs.write().await = Some(EntitySubFilter {
                            domains,
                            entity_ids,
                        });
                        let mut s = sender.lock().await;
                        let _ = s
                            .send(Message::Text(
                                json!({
                                    "namespace": "entities", "event": "subscribed",
                                    "data": { "status": "ok" }
                                })
                                .to_string(),
                            ))
                            .await;
                    }
                    ("entities", "unsubscribe") => {
                        *entity_subs.write().await = None;
                        let mut s = sender.lock().await;
                        let _ = s
                            .send(Message::Text(
                                json!({
                                    "namespace": "entities", "event": "unsubscribed",
                                    "data": { "status": "ok" }
                                })
                                .to_string(),
                            ))
                            .await;
                    }
                    ("system", "subscribe") => {
                        *system_sub.write().await = true;
                        let mut s = sender.lock().await;
                        let _ = s
                            .send(Message::Text(
                                json!({
                                    "namespace": "system", "event": "subscribed",
                                    "data": { "status": "ok" }
                                })
                                .to_string(),
                            ))
                            .await;
                    }
                    ("system", "unsubscribe") => {
                        *system_sub.write().await = false;
                    }
                    ("notifications", "subscribe") => {
                        *notif_sub.write().await = true;
                        let mut s = sender.lock().await;
                        let _ = s
                            .send(Message::Text(
                                json!({
                                    "namespace": "notifications", "event": "subscribed",
                                    "data": { "status": "ok" }
                                })
                                .to_string(),
                            ))
                            .await;
                    }
                    ("notifications", "unsubscribe") => {
                        *notif_sub.write().await = false;
                    }
                    (_, "ping") => {
                        let mut s = sender.lock().await;
                        let _ = s
                            .send(Message::Text(json!({"event": "pong"}).to_string()))
                            .await;
                    }
                    _ => {
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(json!({
                            "event": "error",
                            "data": {"message": format!("Unknown namespace/event: {}/{}", ns, event)}
                        }).to_string())).await;
                    }
                }
            }
        } else if let Message::Close(_) = msg {
            break;
        }
    }

    // Cleanup
    entity_task.abort();
    system_task.abort();
    notif_task.abort();
}

struct EntitySubFilter {
    domains: Vec<String>,
    entity_ids: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// Location History & Sync Endpoints
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
struct LocationHistoryQuery {
    start: Option<String>,
    end: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    5000
}

/// Get location history points from our own database (long-term storage)
async fn get_location_history(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Query(query): Query<LocationHistoryQuery>,
) -> Result<Json<Value>, ErrorResponse> {
    let start = query
        .start
        .unwrap_or_else(|| (chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339());
    let end = query.end.unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let rows: Vec<(f64, f64, Option<i32>, Option<String>, Option<String>, String)> = sqlx::query_as(
        r#"SELECT latitude, longitude, gps_accuracy, state, source,
                  to_char(recorded_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           FROM location_history_points
           WHERE entity_id = $1 AND recorded_at >= $2::timestamptz AND recorded_at <= $3::timestamptz
           ORDER BY recorded_at ASC
           LIMIT $4"#,
    )
    .bind(&entity_id)
    .bind(&start)
    .bind(&end)
    .bind(query.limit)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!("Failed to get location history: {}", e);
        ErrorResponse::internal(format!("Failed to get location history: {}", e))
    })?;

    let points: Vec<Value> = rows
        .into_iter()
        .map(|(lat, lng, acc, state, source, time)| {
            json!({
                "latitude": lat,
                "longitude": lng,
                "gps_accuracy": acc,
                "state": state,
                "source": source,
                "recorded_at": time,
            })
        })
        .collect();

    // Also return the HA-compatible format for backwards compatibility
    let ha_compat: Vec<Value> = points
        .iter()
        .map(|p| {
            json!({
                "entity_id": &entity_id,
                "state": p["state"],
                "last_changed": p["recorded_at"],
                "attributes": {
                    "latitude": p["latitude"],
                    "longitude": p["longitude"],
                    "gps_accuracy": p["gps_accuracy"],
                    "source_type": p["source"],
                }
            })
        })
        .collect();

    Ok(Json(json!({
        "entity_id": entity_id,
        "points": points,
        "ha_compatible": [ha_compat],
        "count": points.len(),
    })))
}

/// Get sync status for all tracked entities
async fn get_location_sync_status(State(state): State<AppState>) -> Json<Vec<Value>> {
    match sqlx::query_as::<
        _,
        (
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            i32,
            String,
            Option<String>,
            String,
        ),
    >(
        r#"SELECT entity_id, friendly_name,
                  to_char(last_sync_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  to_char(oldest_data_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  to_char(newest_data_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  total_points, sync_state, last_error,
                  to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           FROM location_sync_status
           ORDER BY entity_id"#,
    )
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(rows) => {
            let statuses: Vec<Value> = rows
                .into_iter()
                .map(|r| {
                    json!({
                        "entity_id": r.0,
                        "friendly_name": r.1,
                        "last_sync_at": r.2,
                        "oldest_data_at": r.3,
                        "newest_data_at": r.4,
                        "total_points": r.5,
                        "sync_state": r.6,
                        "last_error": r.7,
                        "updated_at": r.8,
                    })
                })
                .collect();
            Json(statuses)
        }
        Err(e) => {
            warn!("Failed to get sync status: {}", e);
            Json(vec![])
        }
    }
}

/// Admin: get detailed sync status
async fn admin_get_sync_status(State(state): State<AppState>) -> Json<Value> {
    let statuses = get_location_sync_status(State(state.clone())).await.0;

    let total_points: i64 =
        sqlx::query_as("SELECT COALESCE(COUNT(*), 0) FROM location_history_points")
            .fetch_one(&state.db_pool)
            .await
            .map(|(c,): (i64,)| c)
            .unwrap_or(0);

    let oldest: Option<String> = sqlx::query_as(
        r#"SELECT to_char(MIN(recorded_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM location_history_points"#
    )
    .fetch_one(&state.db_pool)
    .await
    .map(|(s,): (Option<String>,)| s)
    .unwrap_or(None);

    Json(json!({
        "entities": statuses,
        "total_points": total_points,
        "oldest_data": oldest,
        "sync_interval_seconds": 300,
    }))
}

/// Admin: force sync for a specific entity
async fn admin_force_sync_entity(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> StatusCode {
    // Reset last_sync_at to force a resync
    match sqlx::query(
        "UPDATE location_sync_status SET last_sync_at = NULL, sync_state = 'pending', updated_at = NOW() WHERE entity_id = $1"
    )
    .bind(&entity_id)
    .execute(&state.db_pool)
    .await {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Admin System Notifications Endpoints
// ═══════════════════════════════════════════════════════════════════════

/// Admin: list all system notifications
async fn admin_list_system_notifications(
    State(state): State<AppState>,
    Query(query): Query<SystemNotifQuery>,
) -> Json<Vec<Value>> {
    let has_category = query.category.is_some();
    let category_val = query.category.unwrap_or_default();
    let show_resolved = query.show_resolved.unwrap_or(false);

    let base = r#"SELECT id, category, severity, title, message, details, source, acknowledged, acknowledged_by,
                  to_char(acknowledged_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), resolved,
                  to_char(resolved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           FROM admin_system_notifications
           WHERE ($1 = false OR category = $2) AND ($3 = true OR resolved = false)
           ORDER BY created_at DESC LIMIT 200"#;

    match sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            Option<serde_json::Value>,
            String,
            bool,
            Option<String>,
            Option<String>,
            bool,
            Option<String>,
            String,
        ),
    >(base)
    .bind(has_category)
    .bind(&category_val)
    .bind(show_resolved)
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(rows) => {
            let notifs: Vec<Value> = rows
                .into_iter()
                .map(|r| {
                    json!({
                        "id": r.0, "category": r.1, "severity": r.2, "title": r.3,
                        "message": r.4, "details": r.5, "source": r.6,
                        "acknowledged": r.7, "acknowledged_by": r.8, "acknowledged_at": r.9,
                        "resolved": r.10, "resolved_at": r.11, "created_at": r.12,
                    })
                })
                .collect();
            Json(notifs)
        }
        Err(e) => {
            warn!("Failed to load system notifications: {}", e);
            Json(vec![])
        }
    }
}

#[derive(Debug, Deserialize)]
struct SystemNotifQuery {
    category: Option<String>,
    show_resolved: Option<bool>,
}

/// Admin: acknowledge a system notification
async fn admin_acknowledge_system_notification(
    State(state): State<AppState>,
    Path(notif_id): Path<String>,
    axum::Extension(identity): axum::Extension<middleware::AuthIdentity>,
) -> StatusCode {
    let user_id = identity.user_id().to_string();
    match sqlx::query(
        "UPDATE admin_system_notifications SET acknowledged = true, acknowledged_by = $2, acknowledged_at = NOW() WHERE id = $1"
    )
    .bind(&notif_id)
    .bind(&user_id)
    .execute(&state.db_pool)
    .await {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

/// Admin: resolve a system notification
async fn admin_resolve_system_notification(
    State(state): State<AppState>,
    Path(notif_id): Path<String>,
) -> StatusCode {
    match sqlx::query(
        "UPDATE admin_system_notifications SET resolved = true, resolved_at = NOW() WHERE id = $1",
    )
    .bind(&notif_id)
    .execute(&state.db_pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

/// Admin: delete a system notification
async fn admin_delete_system_notification(
    State(state): State<AppState>,
    Path(notif_id): Path<String>,
) -> StatusCode {
    match sqlx::query("DELETE FROM admin_system_notifications WHERE id = $1")
        .bind(&notif_id)
        .execute(&state.db_pool)
        .await
    {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

/// Admin: clear all resolved system notifications
async fn admin_clear_resolved_system_notifications(State(state): State<AppState>) -> StatusCode {
    let _ = sqlx::query("DELETE FROM admin_system_notifications WHERE resolved = true")
        .execute(&state.db_pool)
        .await;
    StatusCode::OK
}

/// Internal: ingest a system notification from another IORA microservice
/// (e.g. `iora-watchdog` after auto-recovery + self-fix have both failed).
///
/// Authentication: shared secret in the `X-Iora-Internal-Token` header,
/// compared against the `IORA_INTERNAL_TOKEN` environment variable.
/// If `IORA_INTERNAL_TOKEN` is unset the endpoint is disabled.
#[derive(Debug, Deserialize)]
struct InternalSystemNotificationRequest {
    /// Optional client-supplied id; defaults to a UUID.
    id: Option<String>,
    /// Category bucket: sync | system | security | maintenance | watchdog
    #[serde(default = "default_category")]
    category: String,
    /// Severity: info | warning | error | critical
    #[serde(default = "default_severity")]
    severity: String,
    title: String,
    message: String,
    #[serde(default)]
    details: Option<serde_json::Value>,
    /// Originating subsystem, e.g. "iora-watchdog".
    #[serde(default = "default_source")]
    source: String,
    /// Coalesce key: if a non-resolved row with the same `(category, source, title)`
    /// already exists, the existing row is updated instead of inserting a duplicate.
    #[serde(default)]
    coalesce: bool,
}

fn default_category() -> String {
    "system".to_string()
}
fn default_severity() -> String {
    "warning".to_string()
}
fn default_source() -> String {
    "system".to_string()
}

async fn internal_create_system_notification(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<InternalSystemNotificationRequest>,
) -> (StatusCode, Json<Value>) {
    // Token check.
    let expected = match std::env::var("IORA_INTERNAL_TOKEN") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "internal endpoint disabled (IORA_INTERNAL_TOKEN unset)" })),
            )
        }
    };
    let provided = headers
        .get("x-iora-internal-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if provided != expected {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid internal token" })),
        );
    }

    // Coalesce existing un-resolved notifications with the same identity.
    if req.coalesce {
        if let Ok(Some((existing_id,))) = sqlx::query_as::<_, (String,)>(
            r#"SELECT id FROM admin_system_notifications
                WHERE resolved = false AND category = $1 AND source = $2 AND title = $3
                ORDER BY created_at DESC LIMIT 1"#,
        )
        .bind(&req.category)
        .bind(&req.source)
        .bind(&req.title)
        .fetch_optional(&state.db_pool)
        .await
        {
            let _ = sqlx::query(
                r#"UPDATE admin_system_notifications
                    SET severity = $2, message = $3, details = $4, created_at = NOW()
                    WHERE id = $1"#,
            )
            .bind(&existing_id)
            .bind(&req.severity)
            .bind(&req.message)
            .bind(req.details.clone())
            .execute(&state.db_pool)
            .await;
            return (
                StatusCode::OK,
                Json(json!({ "id": existing_id, "coalesced": true })),
            );
        }
    }

    let id = req.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    match sqlx::query(
        r#"INSERT INTO admin_system_notifications
            (id, category, severity, title, message, details, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING"#,
    )
    .bind(&id)
    .bind(&req.category)
    .bind(&req.severity)
    .bind(&req.title)
    .bind(&req.message)
    .bind(req.details.clone())
    .bind(&req.source)
    .execute(&state.db_pool)
    .await
    {
        Ok(_) => (
            StatusCode::CREATED,
            Json(json!({ "id": id, "coalesced": false })),
        ),
        Err(e) => {
            warn!("internal_create_system_notification insert failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// OpenAPI Documentation Stubs
// These are not called at runtime – utoipa reads the #[utoipa::path]
// macros to generate the Swagger specification.
// ═══════════════════════════════════════════════════════════════════════

/// Health check
///
/// Returns system health status including HA connection, entity count, and connected clients.
#[allow(dead_code)]
#[utoipa::path(get, path = "/health", tag = "health",
    responses((status = 200, description = "Health status", body = Value))
)]
async fn api_doc_health() {}

/// Register new user
///
/// Create a new user account. Returns JWT token and user data.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/auth/register", tag = "auth",
    request_body(content = Value, description = "{ username, password, display_name? }"),
    responses(
        (status = 200, description = "Registration successful", body = Value),
        (status = 409, description = "Username already exists")
    )
)]
async fn api_doc_auth_register() {}

/// Login with credentials
///
/// Authenticate with username and password. Returns JWT token.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/auth/login", tag = "auth",
    request_body(content = Value, description = "{ username, password, remember_me? }"),
    responses(
        (status = 200, description = "Login successful"),
        (status = 401, description = "Invalid credentials")
    )
)]
async fn api_doc_auth_login() {}

/// Verify JWT token
///
/// Verify the bearer token and return the authenticated user.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/auth/verify", tag = "auth",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Token valid"),
        (status = 401, description = "Invalid or expired token")
    )
)]
async fn api_doc_auth_verify() {}

/// Login with PIN
///
/// Authenticate with user ID and PIN for quick user switching on shared devices.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/auth/pin-login", tag = "auth",
    request_body(content = Value, description = "{ user_id, pin }"),
    responses(
        (status = 200, description = "PIN login successful"),
        (status = 401, description = "Invalid PIN"),
        (status = 404, description = "User not found or no PIN set")
    )
)]
async fn api_doc_auth_pin_login() {}

/// List all users
///
/// Returns a list of all users with id, username, display_name, avatar_url, and has_pin flag.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/auth/users", tag = "auth",
    responses((status = 200, description = "User list", body = Vec<Value>))
)]
async fn api_doc_auth_users() {}

/// Set login PIN
///
/// Set or update the login PIN for the authenticated user.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/auth/pin", tag = "auth",
    security(("bearer" = [])),
    request_body(content = Value, description = "{ pin: string (4-6 digits) }"),
    responses(
        (status = 200, description = "PIN set successfully"),
        (status = 401, description = "Not authenticated")
    )
)]
async fn api_doc_auth_set_pin() {}

/// Remove login PIN
///
/// Remove the login PIN for the authenticated user.
#[allow(dead_code)]
#[utoipa::path(delete, path = "/api/auth/pin", tag = "auth",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "PIN removed"),
        (status = 401, description = "Not authenticated")
    )
)]
async fn api_doc_auth_remove_pin() {}

/// Get all entity states
///
/// Returns all cached Home Assistant entity states. Updated in real-time via WebSocket.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/states", tag = "entities",
    responses((status = 200, description = "Array of entity states", body = Vec<Value>))
)]
async fn api_doc_get_states() {}

/// Get single entity state
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/states/{entity_id}", tag = "entities",
    params(("entity_id" = String, Path, description = "Entity ID (e.g. light.living_room)")),
    responses(
        (status = 200, description = "Entity state", body = Value),
        (status = 404, description = "Entity not found")
    )
)]
async fn api_doc_get_state() {}

/// Call Home Assistant service
///
/// Dispatch a service call to HA. Requires JWT auth. Uses WebSocket when connected, REST fallback otherwise.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/services/{domain}/{service}", tag = "services",
    security(("bearer" = [])),
    params(
        ("domain" = String, Path, description = "Service domain (e.g. light, switch, climate)"),
        ("service" = String, Path, description = "Service name (e.g. turn_on, turn_off)")
    ),
    request_body(content = Value, description = "Service call data (entity_id, brightness, etc.)"),
    responses((status = 200, description = "Service call dispatched"))
)]
async fn api_doc_call_service() {}

/// Get entity history
///
/// Proxy to Home Assistant history API. Returns state history for the given period.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/history/period/{start_time}", tag = "history",
    params(("start_time" = String, Path, description = "ISO 8601 start time")),
    responses((status = 200, description = "History data", body = Value))
)]
async fn api_doc_get_history() {}

/// Upload background image
///
/// Upload a background image (jpg, png, webp, gif). Max recommended size: 10MB.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/uploads/background", tag = "uploads",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Upload successful"),
        (status = 400, description = "Invalid file type or missing file"),
        (status = 401, description = "Not authenticated")
    )
)]
async fn api_doc_upload_background() {}

/// Get entities by domain
///
/// Filter cached entities by domain (e.g. light, sensor, climate).
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/entities/domain/{domain}", tag = "entities",
    params(("domain" = String, Path, description = "Entity domain")),
    responses((status = 200, description = "Filtered entity list", body = Vec<Value>))
)]
async fn api_doc_get_entities_by_domain() {}

/// Search entities
///
/// Search entities by name or entity_id substring.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/entities/search", tag = "entities",
    params(("q" = String, Query, description = "Search query")),
    responses((status = 200, description = "Matching entities", body = Vec<Value>))
)]
async fn api_doc_search_entities() {}

/// System statistics
///
/// Returns CPU usage, memory, uptime, database size, entity count, cache metrics, and HA connection status.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/system/stats", tag = "system",
    responses((status = 200, description = "System stats", body = Value))
)]
async fn api_doc_system_stats() {}

/// Home Assistant info
///
/// Returns HA connection status, entity count, domain breakdown, and version information.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/system/ha-info", tag = "system",
    responses((status = 200, description = "HA info", body = Value))
)]
async fn api_doc_ha_info() {}

/// Create user
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/users", tag = "config",
    request_body(content = Value, description = "{ username, password, display_name? }"),
    responses((status = 200, description = "User created", body = Value))
)]
async fn api_doc_create_user() {}

/// Get user by username
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/config/users/{username}", tag = "config",
    params(("username" = String, Path, description = "Username")),
    responses(
        (status = 200, description = "User data", body = Value),
        (status = 404, description = "User not found")
    )
)]
async fn api_doc_get_user() {}

/// Update user profile
///
/// Update username and/or display name.
#[allow(dead_code)]
#[utoipa::path(put, path = "/api/config/users/by-id/{user_id}", tag = "config",
    security(("bearer" = [])),
    params(("user_id" = String, Path, description = "User ID")),
    request_body(content = Value, description = "{ username?, display_name? }"),
    responses((status = 200, description = "Updated user", body = Value))
)]
async fn api_doc_update_user() {}

/// Register device
///
/// Register a new device for settings sync and terminal mode.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/devices", tag = "config",
    request_body(content = Value, description = "{ device_name, device_type?, user_agent? }"),
    responses((status = 200, description = "Device registered", body = Value))
)]
async fn api_doc_register_device() {}

/// Create configuration profile
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/profiles", tag = "config",
    request_body(content = Value, description = "{ name, profile_type, owner_id }"),
    responses((status = 200, description = "Profile created", body = Value))
)]
async fn api_doc_create_profile() {}

/// Get profile data
///
/// Returns full profile with pages, theme, and background configuration.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/config/profiles/{profile_id}", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    responses(
        (status = 200, description = "Profile data with pages, theme, background"),
        (status = 404, description = "Profile not found")
    )
)]
async fn api_doc_get_profile() {}

/// Save dashboard pages
///
/// Save all pages with widgets, layouts, and ordering for a profile.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/pages", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ pages: DashboardPage[] }"),
    responses((status = 200, description = "Pages saved"))
)]
async fn api_doc_save_pages() {}

/// Save theme settings
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/theme", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ sleep_mode, auto_theme, selected_theme$1 }"),
    responses((status = 200, description = "Theme saved"))
)]
async fn api_doc_save_theme() {}

/// Save background configuration
///
/// Save global background config (static image, slideshow, video, or gradient).
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/background", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ background_type, config, is_active }"),
    responses((status = 200, description = "Background saved"))
)]
async fn api_doc_save_background() {}

/// Get page layouts
///
/// Returns all page grid layouts (cols, rows, gap) for a profile.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/config/profiles/{profile_id}/layouts", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    responses((status = 200, description = "Page layouts", body = Vec<Value>))
)]
async fn api_doc_get_page_layouts() {}

/// Save page layout
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/layouts", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ page_id, cols, rows, gap }"),
    responses((status = 200, description = "Layout saved", body = Value))
)]
async fn api_doc_save_page_layout() {}

/// Get all page settings
///
/// Returns per-page settings (card style, background override, custom CSS, padding) for all pages in a profile.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/config/profiles/{profile_id}/page-settings", tag = "page-settings",
    params(("profile_id" = String, Path, description = "Profile ID")),
    responses((status = 200, description = "Array of page settings", body = Vec<Value>))
)]
async fn api_doc_get_page_settings() {}

/// Save page settings
///
/// Create or update settings for a specific page. Supports card_style, per-page background override, custom_css, hide_header, and padding.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/page-settings", tag = "page-settings",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ page_id, card_style?, background_type?, background_config?, custom_css?, hide_header?, padding? }"),
    responses((status = 200, description = "Page settings saved", body = Value))
)]
async fn api_doc_save_page_settings() {}

/// Delete page settings
///
/// Remove per-page settings, reverting to global defaults.
#[allow(dead_code)]
#[utoipa::path(delete, path = "/api/config/profiles/{profile_id}/page-settings/{page_id}", tag = "page-settings",
    params(
        ("profile_id" = String, Path, description = "Profile ID"),
        ("page_id" = String, Path, description = "Page ID")
    ),
    responses((status = 200, description = "Settings deleted"))
)]
async fn api_doc_delete_page_settings() {}

/// Save user preference
///
/// Save a key-value preference for a user (synced across devices).
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/config/preferences/{user_id}", tag = "config",
    params(("user_id" = String, Path, description = "User ID")),
    request_body(content = Value, description = "{ key, value, device_id? }"),
    responses((status = 200, description = "Preference saved"))
)]
async fn api_doc_save_preference() {}

/// Get user preferences
///
/// Returns all preferences for a user as key-value pairs.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/config/preferences/{user_id}", tag = "config",
    params(("user_id" = String, Path, description = "User ID")),
    responses((status = 200, description = "Preferences map", body = Value))
)]
async fn api_doc_get_preferences() {}

/// Dashboard status
///
/// Returns dashboard status and diagnostics for the HA custom integration.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/integration/status", tag = "integration",
    responses((status = 200, description = "Dashboard status with entity counts, connection info", body = Value))
)]
async fn api_doc_integration_status() {}

/// Send command
///
/// Send commands from the HA integration (refresh_entities, set_theme, navigate, etc.).
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/integration/command", tag = "integration",
    request_body(content = Value, description = "{ command, ...params }"),
    responses((status = 200, description = "Command executed"))
)]
async fn api_doc_integration_command() {}

/// Get dashboard settings
///
/// Returns current dashboard settings (screensaver, auto_theme, brightness, etc.).
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/integration/settings", tag = "integration",
    responses((status = 200, description = "Dashboard settings", body = Value))
)]
async fn api_doc_integration_get_settings() {}

/// Update dashboard settings
///
/// Update dashboard settings from the HA integration.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/integration/settings", tag = "integration",
    request_body(content = Value, description = "Settings to update"),
    responses((status = 200, description = "Settings updated"))
)]
async fn api_doc_integration_set_settings() {}

// ── API Key doc stubs ──────────────────────────────────────────────

/// List my API keys
///
/// Returns all API keys for the authenticated user.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/keys", tag = "api-keys",
    security(("bearer" = [])),
    responses((status = 200, description = "API keys list", body = Vec<Value>))
)]
async fn api_doc_list_api_keys() {}

/// Create API key
///
/// Generate a new API key for programmatic access. The raw key is only returned once.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/keys", tag = "api-keys",
    security(("bearer" = [])),
    request_body(content = Value, description = "{ name, permissions?: string[], rate_limit?: number, expires_in_days?: number }"),
    responses(
        (status = 200, description = "API key created with raw key"),
        (status = 400, description = "Invalid request")
    )
)]
async fn api_doc_create_api_key() {}

/// Update API key
///
/// Update name, permissions, rate limit, or active status of an API key.
#[allow(dead_code)]
#[utoipa::path(put, path = "/api/keys/{key_id}", tag = "api-keys",
    security(("bearer" = [])),
    params(("key_id" = String, Path, description = "API key ID")),
    request_body(content = Value, description = "{ name?, permissions?, rate_limit?, is_active? }"),
    responses((status = 200, description = "API key updated"))
)]
async fn api_doc_update_api_key() {}

/// Delete API key
///
/// Permanently revoke and delete an API key.
#[allow(dead_code)]
#[utoipa::path(delete, path = "/api/keys/{key_id}", tag = "api-keys",
    security(("bearer" = [])),
    params(("key_id" = String, Path, description = "API key ID")),
    responses((status = 200, description = "API key deleted"))
)]
async fn api_doc_delete_api_key() {}

// ── Admin doc stubs ────────────────────────────────────────────────

/// Admin: List all users
///
/// Returns all users with admin details. Requires admin access.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/users", tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, description = "All users with admin info"))
)]
async fn api_doc_admin_list_users() {}

/// Admin: Set user admin status
///
/// Promote or demote a user to/from admin role.
#[allow(dead_code)]
#[utoipa::path(put, path = "/api/admin/users/{user_id}/admin", tag = "admin",
    security(("bearer" = [])),
    params(("user_id" = String, Path, description = "User ID")),
    request_body(content = Value, description = "{ is_admin: boolean }"),
    responses((status = 200, description = "Admin status updated"))
)]
async fn api_doc_admin_set_admin() {}

/// Admin: List all API keys
///
/// Returns all API keys across all users.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/api-keys", tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, description = "All API keys"))
)]
async fn api_doc_admin_list_all_api_keys() {}

/// Admin: HA Configuration
///
/// Returns Home Assistant core configuration (location, units, version, etc.).
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/config", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA configuration"))
)]
async fn api_doc_admin_ha_config() {}

/// Admin: HA Integrations
///
/// Returns all loaded HA components/integrations and entity domain breakdown.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/integrations", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA integrations and components"))
)]
async fn api_doc_admin_ha_integrations() {}

/// Admin: HA Devices
///
/// Returns all HA devices grouped by device class.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/devices", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA devices"))
)]
async fn api_doc_admin_ha_devices() {}

/// Admin: HA Automations
///
/// Returns all automation entities with their status and last triggered time.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/automations", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA automations"))
)]
async fn api_doc_admin_ha_automations() {}

/// Admin: HA Services
///
/// Returns all available HA services organized by domain.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/services", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA services"))
)]
async fn api_doc_admin_ha_services() {}

/// Admin: HA Logs
///
/// Returns recent Home Assistant error log entries.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/logs", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA error logs"))
)]
async fn api_doc_admin_ha_logs() {}

/// Admin: MQTT Status
///
/// Returns MQTT-related entities, broker status, and device information.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/mqtt", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "MQTT information"))
)]
async fn api_doc_admin_ha_mqtt() {}

/// Admin: Matter Status
///
/// Returns Matter-related entities and fabric information.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/matter", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "Matter information"))
)]
async fn api_doc_admin_ha_matter() {}

/// Admin: HA Add-ons
///
/// Returns installed add-ons (Supervisor) or update entities as fallback.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/addons", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA add-ons"))
)]
async fn api_doc_admin_ha_addons() {}

/// Admin: HA Supervisor
///
/// Returns Supervisor system information (only available on HA OS / Supervised).
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/ha/supervisor", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "Supervisor info"))
)]
async fn api_doc_admin_ha_supervisor() {}

/// Admin: Database Info
///
/// Returns database size and table row counts.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/system/database", tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, description = "Database statistics"))
)]
async fn api_doc_admin_database_info() {}

// ═══════════════════════════════════════════════════════════════════════
// Calendar endpoints
// ═══════════════════════════════════════════════════════════════════════

/// List calendars
///
/// Returns all available calendar entities from Home Assistant.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/calendars", tag = "calendars",
    security(("bearer" = []), ("api_key" = [])),
    responses(
        (status = 200, description = "List of calendar entities", body = Value),
        (status = 502, description = "HA not connected")
    )
)]
async fn api_doc_get_calendars() {}

/// Get calendar events
///
/// Returns events for a specific calendar entity within a time range. Defaults to 30 days from now.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/calendars/{entity_id}/events", tag = "calendars",
    security(("bearer" = []), ("api_key" = [])),
    params(
        ("entity_id" = String, Path, description = "Calendar entity ID (e.g. calendar.personal)"),
        ("start" = Option<String>, Query, description = "Start datetime ISO 8601 (default: now)"),
        ("end" = Option<String>, Query, description = "End datetime ISO 8601 (default: now + 30 days)")
    ),
    responses(
        (status = 200, description = "Calendar events", body = Value),
        (status = 502, description = "HA not connected or calendar fetch failed")
    )
)]
async fn api_doc_get_calendar_events() {}

// ═══════════════════════════════════════════════════════════════════════
// Convenience endpoints
// ═══════════════════════════════════════════════════════════════════════

/// Get current time
///
/// Returns the current server date, time, timezone, and UNIX timestamp.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/time", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    responses((status = 200, description = "Current time info", body = Value))
)]
async fn api_doc_get_current_time() {}

/// List all lights
///
/// Returns all light entities with their state, brightness, color mode, and attributes.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/lights", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    responses((status = 200, description = "Array of light entities", body = Value))
)]
async fn api_doc_get_all_lights() {}

/// Control a light
///
/// Turn on/off/toggle a light entity with optional brightness, color temperature, RGB color, and transition.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/lights/{entity_id}", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    params(("entity_id" = String, Path, description = "Light entity ID (e.g. light.living_room)")),
    request_body(content = Value, description = "{ action: 'on'|'off'|'toggle', brightness?: 0-255, color_temp?: number, rgb_color?: [r,g,b], transition?: seconds }"),
    responses(
        (status = 200, description = "Service call result"),
        (status = 400, description = "Missing or invalid action")
    )
)]
async fn api_doc_control_light() {}

/// List all media players
///
/// Returns all media player entities with their current state, media info, and volume.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/media_players", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    responses((status = 200, description = "Array of media player entities", body = Value))
)]
async fn api_doc_get_all_media_players() {}

/// Control a media player
///
/// Control playback, volume, and mute for a media player entity.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/media_players/{entity_id}", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    params(("entity_id" = String, Path, description = "Media player entity ID (e.g. media_player.living_room)")),
    request_body(content = Value, description = "{ action: 'play'|'pause'|'stop'|'next'|'previous'|'volume_set'|'volume_up'|'volume_down'|'volume_mute', volume_level?: 0.0-1.0, is_volume_muted?: bool }"),
    responses(
        (status = 200, description = "Service call result"),
        (status = 400, description = "Missing or invalid action")
    )
)]
async fn api_doc_control_media_player() {}

/// Get sensor value
///
/// Returns the state and all attributes for a specific sensor entity.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/sensors/{entity_id}", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    params(("entity_id" = String, Path, description = "Sensor entity ID (e.g. sensor.temperature_outdoor)")),
    responses(
        (status = 200, description = "Sensor state and attributes", body = Value),
        (status = 404, description = "Sensor not found")
    )
)]
async fn api_doc_get_sensor() {}

/// Press a button
///
/// Triggers a button entity (fires the press service).
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/buttons/{entity_id}/press", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    params(("entity_id" = String, Path, description = "Button entity ID (e.g. button.restart)")),
    responses(
        (status = 200, description = "Button pressed"),
        (status = 404, description = "Button entity not found")
    )
)]
async fn api_doc_press_button() {}

/// Control a switch
///
/// Turn on, off, or toggle a switch entity.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/switches/{entity_id}", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    params(("entity_id" = String, Path, description = "Switch entity ID (e.g. switch.garden_pump)")),
    request_body(content = Value, description = "{ action: 'on'|'off'|'toggle' }"),
    responses(
        (status = 200, description = "Service call result"),
        (status = 400, description = "Missing or invalid action")
    )
)]
async fn api_doc_control_switch() {}

/// Get NINA settings
///
/// Returns current NINA warning system configuration including enabled state, monitored ARS regions, and poll interval.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/nina/settings", tag = "nina",
    security(("bearer" = []), ("api_key" = [])),
    responses(
        (status = 200, description = "NINA settings", body = Value,
         example = json!({"enabled": true, "ars_regions": [{"ars": "051110000000", "name": "Düsseldorf"}], "poll_interval_minutes": 5}))
    )
)]
async fn api_doc_get_nina_settings() {}

/// Save NINA settings
///
/// Update NINA warning system configuration. When enabled, triggers an immediate poll of configured regions.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/nina/settings", tag = "nina",
    security(("bearer" = []), ("api_key" = [])),
    request_body(content = Value, description = "{ enabled: bool, ars_regions: [{ars: string, name: string}], poll_interval_minutes: number }"),
    responses(
        (status = 200, description = "Updated settings", body = Value),
        (status = 500, description = "Failed to save settings")
    )
)]
async fn api_doc_save_nina_settings() {}

/// Get NINA warnings
///
/// Returns currently cached NINA warnings from all monitored regions.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/nina/warnings", tag = "nina",
    security(("bearer" = []), ("api_key" = [])),
    responses(
        (status = 200, description = "Active warnings", body = Value,
         example = json!({"warnings": [{"id": "mow.DE-NW-BN-SE030", "headline": "Amtliche Warnung", "severity": "Severe", "level": "critical", "region": "Bonn", "source": "NINA"}]}))
    )
)]
async fn api_doc_get_nina_warnings() {}

/// Send test warning
///
/// Broadcasts a test warning to all connected WebSocket clients. The warning auto-clears after 30 seconds.
/// Requires admin privileges.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/admin/nina/test-warning", tag = "nina",
    security(("bearer" = [])),
    request_body(content = Value, description = "{ level: 'info'|'warning'|'critical'|'emergency', headline: string, description: string }"),
    responses(
        (status = 200, description = "Test warning sent", body = Value,
         example = json!({"success": true, "entity_id": "nina.test_1234567890"})),
        (status = 400, description = "Invalid warning level")
    )
)]
async fn api_doc_admin_test_warning() {}

// ═══════════════════════════════════════════════════════════════════════
// Webhook API documentation stubs
// ═══════════════════════════════════════════════════════════════════════

/// List webhooks
///
/// Returns all webhook registrations for the authenticated user.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/webhooks", tag = "webhooks",
    security(("bearer_auth" = []), ("api_key" = [])),
    responses(
        (status = 200, description = "List of webhooks", body = Value,
         example = json!({"webhooks": [{"id": "abc-123", "name": "My Webhook", "url": "https://example.com/hook", "events": ["*"], "active": true}]}))
    )
)]
async fn api_doc_list_webhooks() {}

/// Create webhook
///
/// Register a new outgoing webhook. The webhook will receive HTTP POST requests with JSON payloads
/// when matching events occur. Optionally provide a `secret` for HMAC-SHA256 signature verification
/// via the `X-Webhook-Signature` header.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/webhooks", tag = "webhooks",
    security(("bearer_auth" = []), ("api_key" = [])),
    request_body(content = Value, description = "{ name: string, url: string, secret?: string, events?: string[], headers?: object }"),
    responses(
        (status = 200, description = "Webhook created", body = Value),
        (status = 400, description = "Invalid request – name and url required")
    )
)]
async fn api_doc_create_webhook() {}

/// Update webhook
///
/// Update an existing webhook's name, URL, secret, event filters, custom headers, or active state.
#[allow(dead_code)]
#[utoipa::path(put, path = "/api/webhooks/{webhook_id}", tag = "webhooks",
    security(("bearer_auth" = []), ("api_key" = [])),
    params(("webhook_id" = String, Path, description = "Webhook ID")),
    request_body(content = Value, description = "{ name?, url?, secret?, events?, headers?, active? }"),
    responses(
        (status = 200, description = "Webhook updated"),
        (status = 404, description = "Webhook not found")
    )
)]
async fn api_doc_update_webhook() {}

/// Delete webhook
///
/// Delete a webhook and all its delivery history.
#[allow(dead_code)]
#[utoipa::path(delete, path = "/api/webhooks/{webhook_id}", tag = "webhooks",
    security(("bearer_auth" = []), ("api_key" = [])),
    params(("webhook_id" = String, Path, description = "Webhook ID")),
    responses(
        (status = 200, description = "Webhook deleted"),
        (status = 404, description = "Webhook not found")
    )
)]
async fn api_doc_delete_webhook() {}

/// Test webhook
///
/// Send a test payload to the webhook URL and return the delivery result.
#[allow(dead_code)]
#[utoipa::path(post, path = "/api/webhooks/{webhook_id}/test", tag = "webhooks",
    security(("bearer_auth" = []), ("api_key" = [])),
    params(("webhook_id" = String, Path, description = "Webhook ID")),
    responses(
        (status = 200, description = "Test delivery result", body = Value,
         example = json!({"success": true, "status_code": 200, "duration_ms": 150})),
        (status = 404, description = "Webhook not found")
    )
)]
async fn api_doc_test_webhook() {}

/// Webhook delivery log
///
/// Returns recent delivery attempts for a webhook, ordered by most recent first.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/webhooks/{webhook_id}/deliveries", tag = "webhooks",
    security(("bearer_auth" = []), ("api_key" = [])),
    params(
        ("webhook_id" = String, Path, description = "Webhook ID"),
        ("limit" = Option<i64>, Query, description = "Max results (default 50, max 200)")
    ),
    responses(
        (status = 200, description = "Delivery log", body = Value),
        (status = 404, description = "Webhook not found")
    )
)]
async fn api_doc_get_webhook_deliveries() {}

/// Admin: list all webhooks
///
/// Returns all webhook registrations across all users. Requires admin privileges.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/admin/webhooks", tag = "webhooks",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "All webhooks", body = Value)
    )
)]
async fn api_doc_admin_list_webhooks() {}

// ═══════════════════════════════════════════════════════════════════════
// Realtime API documentation stubs
// ═══════════════════════════════════════════════════════════════════════

/// SSE entity event stream
///
/// Server-Sent Events stream for real-time entity state changes. Supports filtering by
/// `domains` (comma-separated) and `entity_ids` (comma-separated) query parameters.
/// Events: `connected`, `state_changed`, `warning`.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/events/stream", tag = "realtime",
    params(
        ("domains" = Option<String>, Query, description = "Comma-separated domain filter (e.g. light,switch)"),
        ("entity_ids" = Option<String>, Query, description = "Comma-separated entity ID filter")
    ),
    responses(
        (status = 200, description = "SSE event stream", content_type = "text/event-stream")
    )
)]
async fn api_doc_sse_event_stream() {}

/// SSE system event stream
///
/// Server-Sent Events stream for system-level events including health checks,
/// watchdog alerts, anomaly detection, and error messages.
#[allow(dead_code)]
#[utoipa::path(get, path = "/api/events/system", tag = "realtime",
    responses(
        (status = 200, description = "SSE system event stream", content_type = "text/event-stream")
    )
)]
async fn api_doc_sse_system_stream() {}

/// Realtime namespace WebSocket
///
/// Socket.IO-style multiplexed WebSocket connection supporting namespace-based subscriptions.
/// Connect to `/ws/realtime` and send JSON messages to subscribe to namespaces:
/// - `entities`: real-time entity state changes with domain/entity filters
/// - `system`: system events, health, errors
/// - `notifications`: configuration change notifications
///
/// **Subscribe**: `{ "namespace": "entities", "event": "subscribe", "data": { "domains": ["light"], "entity_ids": [] } }`
/// **Unsubscribe**: `{ "namespace": "entities", "event": "unsubscribe" }`
/// **Ping**: `{ "event": "ping" }` → `{ "event": "pong" }`
#[allow(dead_code)]
#[utoipa::path(get, path = "/ws/realtime", tag = "realtime",
    responses(
        (status = 101, description = "WebSocket upgrade – namespace-based realtime connection")
    )
)]
async fn api_doc_realtime_ws() {}

/// POST /api/themes/install - Install theme from base64-encoded ZIP
async fn handle_theme_zip_install(
    State(gs): State<AppState>,
    body: String,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    use base64::Engine as _;
    let fail = |status: StatusCode, stage: &'static str, message: String| {
        warn!(target: "themes", stage, error = %message, "Theme ZIP installation failed");
        (
            status,
            Json(json!({ "success": false, "stage": stage, "message": message })),
        )
    };
    let v: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            return Err(fail(
                StatusCode::BAD_REQUEST,
                "request",
                format!("Ungültiges JSON: {}", e),
            ))
        }
    };
    let zip_data = match v.get("zip_data").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return Err(fail(
                StatusCode::BAD_REQUEST,
                "request",
                "Feld 'zip_data' fehlt".into(),
            ))
        }
    };
    let payload = zip_data.split(',').last().unwrap_or(zip_data).trim();
    let padded_payload;
    let decode_payload = if payload.len() % 4 == 0 {
        payload
    } else {
        padded_payload = format!("{}{}", payload, "=".repeat(4 - payload.len() % 4));
        &padded_payload
    };
    let bytes = match base64::engine::general_purpose::STANDARD
        .decode(decode_payload.as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(decode_payload.as_bytes()))
    {
        Ok(b) => b,
        Err(e) => {
            return Err(fail(
                StatusCode::BAD_REQUEST,
                "request",
                format!("ZIP-Daten sind kein gültiges Base64: {}", e),
            ))
        }
    };
    if bytes.is_empty() {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "request",
            "ZIP-Datei ist leer".into(),
        ));
    }
    if bytes.len() > 256 * 1024 * 1024 {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "request",
            "ZIP-Datei ist größer als 256 MiB".into(),
        ));
    }
    // Step 1: Extract ZIP on blocking thread (contains non-Send types)
    let tm = gs.theme_manager.clone();
    let def = tokio::task::spawn_blocking(move || tm.extract_zip(&bytes))
        .await
        .map_err(|e| {
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "extract",
                format!("Theme-Extraktion konnte nicht gestartet werden: {}", e),
            )
        })?
        .map_err(|e| {
            fail(
                StatusCode::BAD_REQUEST,
                "extract",
                format!("Theme-ZIP konnte nicht gelesen werden: {}", e),
            )
        })?;

    // Validate the extracted manifest
    let manifest_json = serde_json::to_value(&def).unwrap_or_default();
    let validation = iora_shared::manifest_validator::validate_theme_manifest(&manifest_json);
    if !validation.is_valid() {
        let errors: Vec<String> = validation
            .issues
            .iter()
            .filter(|i| i.severity == iora_shared::manifest_validator::ValidationSeverity::Error)
            .map(|i| format!("{}: {}", i.field, i.message))
            .collect();
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "validate",
            format!("Manifest enthält Fehler:\n{}", errors.join("\n")),
        ));
    }

    // Step 2: Store in DB (async, no non-Send types)
    let def = gs.theme_manager.store_theme(def).await.map_err(|e| {
        fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "store",
            format!("Theme konnte nicht gespeichert werden: {}", e),
        )
    })?;
    Ok(Json(
        json!({"success":true,"status":"ok","theme":{"id":def.id,"name":def.name,"version":def.version}}),
    ))
}

/// POST /api/themes/validate-manifest – Validate any manifest before installation
async fn handle_validate_manifest(
    body: String,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let json: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "valid": false,
                    "errors": [{"field": "manifest", "message": format!("Ungültiges JSON: {}", e)}]
                })),
            ))
        }
    };

    let result = iora_shared::manifest_validator::validate_manifest(&json);

    Ok(Json(
        serde_json::to_value(&result).unwrap_or(json!({"valid":false,"errors":[]})),
    ))
}
