use axum::{
    extract::{Multipart, Path, Query, RawQuery, State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response, sse::{Event as SseEvent, KeepAlive, Sse}},
    routing::{delete, get, get_service, post, put},
    Extension, Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, collections::VecDeque, convert::Infallible, net::SocketAddr, path::Path as FsPath, sync::Arc};
use std::sync::atomic::{AtomicU64, Ordering};
use futures_util::Stream;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::{info, warn};
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme, ApiKey, ApiKeyValue};
use utoipa::{Modify, OpenApi};
use utoipa_swagger_ui::SwaggerUi;

mod ha_client;
mod ha_websocket;
mod websocket;
mod db;
mod auth;
mod middleware;
mod entity_cache;
mod ha_cache;
mod mqtt_client;
mod matter_client;
mod ha_connection;
mod zigbee_client;
mod zwave_client;
mod ble_client;
mod homekit_client;
mod streaming;
mod person_tracker;
mod location_sync;
mod desktop_gateway;
mod notification_dispatcher;
mod documentation;

use ha_client::HomeAssistantClient;
use ha_websocket::HAWebSocket;
use db::{init_db, DbPool, repositories::ConfigRepository};
use entity_cache::EntityStateCache;
use ha_cache::HaDataCache;
use mqtt_client::MqttClient;
use matter_client::MatterClient;
use ha_connection::HaConnectionManager;
use zigbee_client::ZigbeeClient;
use zwave_client::ZwaveClient;
use ble_client::BleClient;
use homekit_client::HomekitClient;
use notification_dispatcher::NotificationDispatcher;
use streaming::StreamManager;
use iora_shared::settings::{SettingsRegistry, SettingDefinition};

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
    /// Generic settings registry – schema for all user-configurable IORA values.
    /// See [`iora_shared::settings`].
    pub settings_registry: Arc<SettingsRegistry>,
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
        METRICS.http_errors_total.fetch_add(1, Ordering::Relaxed);
        (self.status, Json(serde_json::json!({ "error": self.error }))).into_response()
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
            SecurityScheme::ApiKey(ApiKey::Header(
                ApiKeyValue::with_description("X-API-Key", "API key from /api/keys"),
            )),
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

    // Get Home Assistant configuration.
    //
    // On a fresh IORA OS install no Home Assistant is configured yet — the
    // user picks one (or skips it) from the Admin Control Center.  We treat
    // both "unset" and "empty" as not-configured so that the env file the
    // setup wizard writes (with HA_URL= / HA_TOKEN= placeholders) doesn't
    // make us spam the journal with "relative URL without a base" warnings
    // from the safety-net poll, the WS reconnect loop, the connection
    // health checker, the location sync, and the person tracker.
    let ha_url_raw = std::env::var("HA_URL").unwrap_or_default();
    let mut ha_url = if ha_url_raw.trim().is_empty() {
        String::new()
    } else {
        ha_url_raw.trim().to_string()
    };
    let mut ha_token = std::env::var("HA_TOKEN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();
    // ha_configured will be re-evaluated AFTER we attempt to load HA settings
    // from the database below — env values are only the fallback.

    // Get database configuration
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://iora:iora_password@localhost:5432/iora_home".to_string());

    info!("Starting Home Assistant Dashboard Backend");
    info!("Home Assistant URL: {}", ha_url);
    info!("Database URL: {}", database_url);

    // Initialize database — retry with backoff so the service stays up
    // through PostgreSQL's startup window on a freshly-booted IORA OS.
    // Without this, `iora-home` exits 1 immediately if pg isn't ready,
    // and systemd's Restart=on-failure thrashes for minutes while the
    // setup wizard's :8126 health-check times out.
    let db_pool = {
        let mut attempt: u32 = 0;
        let max_attempts: u32 = std::env::var("IORA_HOME_DB_MAX_ATTEMPTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60); // ~5 min @ 5s
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
                        attempt, e
                    ));
                }
            }
        }
    };

    // Override HA settings from the DB-backed system_preferences table when
    // present.  This is the path the Admin Control Center writes to via
    // PUT /api/config/system/preferences (key="ha_config"), which is also
    // how the first-boot setup wizard configures Home Assistant when the
    // user opts in.  Falling back to env vars keeps `cargo run`-style local
    // development working with HA_URL / HA_TOKEN exported in the shell.
    {
        let bootstrap_repo = ConfigRepository::new(db_pool.clone());
        if let Ok(Some(pref)) = bootstrap_repo.get_system_preference("ha_config").await {
            match serde_json::from_str::<serde_json::Value>(&pref.preference_value) {
                Ok(cfg) => {
                    if let Some(u) = cfg.get("url").and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                    {
                        ha_url = u.trim().to_string();
                    }
                    if let Some(t) = cfg.get("token").and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                    {
                        ha_token = t.trim().to_string();
                    }
                    if !ha_url.is_empty() && !ha_token.is_empty() {
                        info!("Loaded HA configuration from system_preferences (DB)");
                    }
                }
                Err(e) => warn!("Failed to parse system_preferences/ha_config: {}", e),
            }
        }
    }
    // Re-evaluate the ha_configured flag now that the DB may have populated
    // the URL / token. Only spawn HA-touching background tasks when both
    // values are non-empty.
    let ha_configured = !ha_url.is_empty() && !ha_token.is_empty();
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
        let location_sync = location_sync::LocationSyncService::new(db_pool.clone(), ha_client.clone());
        location_sync.start();
    }

    // Initialize WebSocket manager (frontend-facing)
    let ws_manager = Arc::new(websocket::WebSocketManager::new());

    // Initialize configuration repository
    let config_repo = Arc::new(ConfigRepository::new(db_pool.clone()));

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
        .expect("Failed to build HTTP client");

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
        settings_registry: Arc::new(iora_shared::settings::default_registry()),
    };

    // Ensure at least one admin user exists (auto-promote oldest user after migration)
    match state.config_repo.ensure_admin_exists().await {
        Ok(Some(username)) => info!("No admin found – auto-promoted '{}' to admin", username),
        Ok(None) => {}
        Err(e) => warn!("Failed to check admin status: {}", e),
    }

    // ── Auto-connect protocols from saved configs ──────────────────
    // MQTT: load saved config, auto-connect if host is set
    {
        let mqtt = mqtt_client.clone();
        let repo = state.config_repo.clone();
        tokio::spawn(async move {
            if let Ok(Some(pref)) = repo.get_system_preference("mqtt_config").await {
                if let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&pref.preference_value) {
                    if let Some(host) = cfg.get("host").and_then(|v| v.as_str()).filter(|h| !h.is_empty()) {
                        let config = mqtt_client::MqttConfig {
                            host: host.to_string(),
                            port: cfg.get("port").and_then(|v| v.as_u64()).unwrap_or(1883) as u16,
                            username: cfg.get("username").and_then(|v| v.as_str()).map(String::from),
                            password: cfg.get("password").and_then(|v| v.as_str()).map(String::from),
                            client_id: cfg.get("client_id").and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| format!("mdt-dashboard-{}", &uuid::Uuid::new_v4().to_string()[..8])),
                            use_tls: cfg.get("use_tls").and_then(|v| v.as_bool()).unwrap_or(false),
                        };
                        info!("MQTT: Auto-connecting to {}:{} from saved config", config.host, config.port);
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
                if let Ok(cfg) = serde_json::from_str::<matter_client::MatterConfig>(&pref.preference_value) {
                    matter.init(cfg).await;
                }
            }
            // Zigbee
            if let Ok(Some(pref)) = repo.get_system_preference("zigbee_config").await {
                if let Ok(cfg) = serde_json::from_str::<zigbee_client::ZigbeeConfig>(&pref.preference_value) {
                    zigbee.update_config(cfg).await;
                }
            }
            // Z-Wave
            if let Ok(Some(pref)) = repo.get_system_preference("zwave_config").await {
                if let Ok(cfg) = serde_json::from_str::<zwave_client::ZwaveConfig>(&pref.preference_value) {
                    zwave.update_config(cfg).await;
                }
            }
            // BLE
            if let Ok(Some(pref)) = repo.get_system_preference("ble_config").await {
                if let Ok(cfg) = serde_json::from_str::<ble_client::BleConfig>(&pref.preference_value) {
                    ble.update_config(cfg).await;
                }
            }
            // HomeKit
            if let Ok(Some(pref)) = repo.get_system_preference("homekit_config").await {
                if let Ok(cfg) = serde_json::from_str::<homekit_client::HomekitConfig>(&pref.preference_value) {
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
    tokio::spawn(background_watchdog_loop(watchdog_ha_client, watchdog_entity_cache, watchdog_ws_manager));

    // Background scheduled actions cleanup (removes expired schedules every 5 min)
    tokio::spawn(background_schedule_cleanup());

    // Background entity anomaly detection (flags unusual state change patterns every 2 min)
    let anomaly_entity_cache = entity_cache.clone();
    let anomaly_ws_manager = ws_manager.clone();
    tokio::spawn(background_entity_anomaly_detection(anomaly_entity_cache, anomaly_ws_manager));

    // Background analytics aggregation (rolls up entity analytics every 10 min into DB)
    let stats_entity_cache = entity_cache.clone();
    let stats_db_pool = db_pool.clone();
    tokio::spawn(background_analytics_aggregation(stats_entity_cache, stats_db_pool));

    // Background stale entity monitor (detects entities stale >1h, broadcasts warnings every 60s)
    let stale_entity_cache = entity_cache.clone();
    let stale_ws_manager = ws_manager.clone();
    tokio::spawn(background_stale_entity_monitor(stale_entity_cache, stale_ws_manager));

    // Background NINA warning poller (checks NINA API every 5 min for configured regions)
    let nina_http_client = state.http_client.clone();
    let nina_config_repo = state.config_repo.clone();
    let nina_ws_manager = state.ws_manager.clone();
    let nina_db_pool = state.db_pool.clone();
    tokio::spawn(background_nina_poller(nina_http_client, nina_config_repo, nina_ws_manager, nina_db_pool));

    // Background ARS regions cache warming (loads Landkreise data on startup, refreshes every 24h)
    let ars_http_client = state.http_client.clone();
    tokio::spawn(background_ars_cache_refresh(ars_http_client));

    // Background webhook delivery (fans out state changes to registered webhooks)
    let webhook_ws = state.ws_manager.clone();
    let webhook_db = state.db_pool.clone();
    let webhook_http = state.http_client.clone();
    tokio::spawn(background_webhook_delivery(webhook_ws, webhook_db, webhook_http));

    // Build router
    // Service routes protected by auth middleware
    let service_routes = Router::new()
        .route(
            "/api/services/:domain/:service",
            post(call_service),
        )
        .layer(axum::middleware::from_fn_with_state(state.clone(), middleware::require_auth))
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
        .route("/api/admin/mqtt/config", post(admin_mqtt_save_config).get(admin_mqtt_get_config))
        // Matter client management
        .route("/api/admin/matter/status", get(admin_matter_status))
        .route("/api/admin/matter/config", post(admin_matter_save_config).get(admin_matter_get_config))
        .route("/api/admin/matter/refresh", post(admin_matter_refresh))
        // Zigbee client management
        .route("/api/admin/zigbee/status", get(admin_zigbee_status))
        .route("/api/admin/zigbee/config", post(admin_zigbee_save_config).get(admin_zigbee_get_config))
        .route("/api/admin/zigbee/refresh", post(admin_zigbee_refresh))
        // Z-Wave client management
        .route("/api/admin/zwave/status", get(admin_zwave_status))
        .route("/api/admin/zwave/config", post(admin_zwave_save_config).get(admin_zwave_get_config))
        .route("/api/admin/zwave/refresh", post(admin_zwave_refresh))
        // Bluetooth/BLE client management
        .route("/api/admin/ble/status", get(admin_ble_status))
        .route("/api/admin/ble/config", post(admin_ble_save_config).get(admin_ble_get_config))
        .route("/api/admin/ble/refresh", post(admin_ble_refresh))
        // HomeKit client management
        .route("/api/admin/homekit/status", get(admin_homekit_status))
        .route("/api/admin/homekit/config", post(admin_homekit_save_config).get(admin_homekit_get_config))
        .route("/api/admin/homekit/refresh", post(admin_homekit_refresh))
        // HA Connection health
        .route("/api/admin/ha/connection", get(admin_ha_connection_status))
        .route("/api/admin/protocols/overview", get(admin_protocols_overview))
        .route("/api/admin/ha/supervisor", get(admin_ha_supervisor))
        .route("/api/admin/ha/scenes", get(admin_ha_scenes))
        .route("/api/admin/ha/backups", get(admin_ha_backups))
        .route("/api/admin/ha/network", get(admin_ha_network))
        // Extended HA features
        .route("/api/admin/ha/logbook", get(admin_ha_logbook))
        .route("/api/admin/ha/calendars", get(admin_ha_calendars))
        .route("/api/admin/ha/calendars/:entity_id/events", get(admin_ha_calendar_events))
        .route("/api/admin/ha/template", post(admin_ha_render_template))
        .route("/api/admin/ha/events/:event_type", post(admin_ha_fire_event))
        .route("/api/admin/ha/registry/entities", get(admin_ha_entity_registry))
        .route("/api/admin/ha/registry/devices", get(admin_ha_device_registry))
        .route("/api/admin/ha/registry/areas", get(admin_ha_area_registry))
        .route("/api/admin/system/logs", get(admin_system_logs))
        .route("/api/admin/system/database", get(admin_database_info))
        // Temp DB users
        .route("/api/admin/system/database/temp-users", get(admin_list_temp_users).post(admin_create_temp_user))
        .route("/api/admin/system/database/temp-users/:user_id", delete(admin_revoke_temp_user))
        // Maintenance mode
        .route("/api/admin/maintenance", get(admin_get_maintenance).put(admin_set_maintenance))
        // Notifications & alerts
        .route("/api/admin/notifications", get(admin_list_notifications).delete(admin_clear_notifications))
        .route("/api/admin/notifications/:notif_id/read", put(admin_mark_notification_read))
        .route("/api/admin/notifications/:notif_id", delete(admin_dismiss_notification))
        // Admin system notifications (sync alerts, system issues)
        .route("/api/admin/system-notifications", get(admin_list_system_notifications))
        .route("/api/admin/system-notifications/:notif_id/acknowledge", put(admin_acknowledge_system_notification))
        .route("/api/admin/system-notifications/:notif_id/resolve", put(admin_resolve_system_notification))
        .route("/api/admin/system-notifications/:notif_id", delete(admin_delete_system_notification))
        .route("/api/admin/system-notifications/clear-resolved", delete(admin_clear_resolved_system_notifications))
        // Location sync management
        .route("/api/admin/location-sync/status", get(admin_get_sync_status))
        .route("/api/admin/location-sync/:entity_id/force-sync", post(admin_force_sync_entity))
        .route("/api/admin/alert", get(admin_get_alert).put(admin_set_alert).delete(admin_dismiss_alert))
        // Warning log
        .route("/api/admin/warnings/log", get(admin_get_warning_log).delete(admin_clear_warning_log))
        // Test warnings (NINA)
        .route("/api/admin/nina/test-warning", post(admin_send_test_warning))
        // Webhooks (admin overview)
        .route("/api/admin/webhooks", get(admin_list_all_webhooks))
        // IORA Control Center: services, tasks, control mode
        .route("/api/admin/control/services", get(admin_control_services))
        .route("/api/admin/control/tasks", get(admin_control_tasks))
        .route("/api/admin/control/tasks/:task_id/trigger", post(admin_control_trigger_task))
        .route("/api/admin/control/tasks/:task_id/toggle", post(admin_control_toggle_task))
        .route("/api/admin/control/mode", get(admin_control_get_mode).put(admin_control_set_mode))
        .route("/api/admin/control/overview", get(admin_control_overview))
        // IORA Log System & Metrics
        .route("/api/admin/logs", get(admin_get_logs))
        .route("/api/admin/logs/clear", post(admin_clear_logs))
        .route("/api/admin/metrics", get(admin_get_metrics))
        .route("/api/admin/metrics/live", get(admin_metrics_live_sse))
        .route("/api/admin/logs/live", get(admin_logs_live_sse))
        .layer(axum::middleware::from_fn_with_state(state.clone(), middleware::require_admin))
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
        .route("/api/webhooks/:webhook_id/deliveries", get(get_webhook_deliveries))
        .layer(axum::middleware::from_fn_with_state(state.clone(), middleware::require_authenticated))
        .with_state(state.clone());

    // Protected data routes (JWT or API key required)
    let data_routes = Router::new()
        // Documentation endpoints
        .route("/api/documentation/config", get(documentation::get_docs_config))
        .route("/api/documentation/list", get(documentation::list_docs))
        .route("/api/documentation/*doc_path", get(documentation::get_doc_file))
        // Home Assistant API proxy
        .route("/api/states", get(get_states))
        .route("/api/states/:entity_id", get(get_state))
        .route("/api/history/period/:start_time", get(get_history))
        .route("/api/local-history/:entity_id", get(get_local_history))
        // Weather forecast cache
        .route("/api/weather/forecast/:entity_id/:forecast_type", get(get_cached_forecast))
        .route("/api/weather/forecast/:entity_id/:forecast_type", post(save_cached_forecast))
        // Entity domain lookup & statistics
        .route("/api/entities/domain/:domain", get(get_entities_by_domain))
        .route("/api/entities/search", get(search_entities))
        .route("/api/entities/count", get(get_entity_counts))
        .route("/api/stats/entity-history/:entity_id", get(get_entity_statistics))
        .route("/api/stats/dashboard", get(get_dashboard_statistics))
        // System monitoring
        .route("/api/system/stats", get(get_system_stats))
        .route("/api/system/ha-info", get(get_ha_info))
        // Configuration API
        .route("/api/config/users/by-id/:user_id", put(update_user))
        .route("/api/config/devices/:device_id/heartbeat", post(device_heartbeat))
        .route("/api/config/profiles", post(create_profile))
        .route("/api/config/profiles/:profile_id", get(get_profile_data))
        .route("/api/config/profiles/:profile_id/pages", post(save_pages))
        .route("/api/config/profiles/:profile_id/theme", post(save_theme_settings))
        .route("/api/config/profiles/:profile_id/background", post(save_background_config))
        .route("/api/config/profiles/:profile_id/layouts", get(get_page_layouts))
        .route("/api/config/profiles/:profile_id/layouts", post(save_page_layout))
        .route("/api/config/profiles/:profile_id/page-settings", get(get_all_page_settings))
        .route("/api/config/profiles/:profile_id/page-settings", post(save_page_settings_handler))
        .route("/api/config/profiles/:profile_id/page-settings/:page_id", get(get_page_settings_handler))
        .route("/api/config/profiles/:profile_id/page-settings/:page_id", delete(delete_page_settings_handler))
        .route("/api/config/devices/:device_id/terminal", post(set_device_terminal_mode))
        .route("/api/config/preferences/:user_id", post(save_user_preference))
        .route("/api/config/preferences/:user_id", get(get_user_preferences))
        .route("/api/config/system/preferences", post(save_system_preference))
        .route("/api/config/system/preferences", get(get_system_preferences))
        // Generic settings API (schema-driven – see iora_shared::settings).
        // The wizard uses /api/admin/settings/schema/wizard, the Control Center
        // uses /api/admin/settings (full schema + values).
        .route("/api/admin/settings/schema", get(admin_settings_schema))
        .route("/api/admin/settings/schema/wizard", get(admin_settings_schema_wizard))
        .route("/api/admin/settings", get(admin_settings_list))
        .route("/api/admin/settings/:key", get(admin_settings_get).put(admin_settings_put))
        .route("/api/config/sync/changes", get(get_sync_changes))
        // Notifications (read access for all authenticated users)
        .route("/api/notifications", get(get_notifications))
        .route("/api/notifications/send", post(notification_send))
        .route("/api/notifications/:notif_id/read", put(mark_notification_read))
        .route("/api/notifications/:notif_id", delete(dismiss_notification))
        // Notification channels management
        .route("/api/notifications/channels", get(notification_channels_list).post(notification_channel_create))
        .route("/api/notifications/channels/:channel_id", put(notification_channel_update).delete(notification_channel_delete))
        .route("/api/alert/active", get(get_active_alert))
        .route("/api/warnings/active", get(get_active_warnings))
        // NINA warning endpoints
        .route("/api/nina/settings", get(get_nina_settings).post(save_nina_settings))
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
        .route("/api/location-history/:entity_id", get(get_location_history))
        .route("/api/location-history/sync/status", get(get_location_sync_status))
        .layer(axum::middleware::from_fn_with_state(state.clone(), middleware::require_authenticated))
        .with_state(state.clone());

    let app = Router::new()
        // Swagger UI
        .merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", ApiDoc::openapi()))
        // Health check (public)
        .route("/health", get(health_check))
        // Version endpoint (public, never cached – desktop client uses this to detect updates)
        .route("/api/version", get(get_version))
        // Maintenance status (public – frontend needs this before auth)
        .route("/api/maintenance/status", get(public_maintenance_status))
        .route("/api/desktop/extensions", get(desktop_gateway::get_desktop_extensions))
        .route("/api/desktop/settings", get(desktop_gateway::get_desktop_settings).post(desktop_gateway::update_desktop_settings))
        // Authentication API (public)
        .route("/api/auth/register", post(auth_register))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/verify", get(auth_verify))
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
        .route("/api/integration/ha/configured", get(integration_ha_configured))
        .route("/api/integration/command", post(integration_command))
        .route("/api/integration/settings", get(integration_get_settings))
        .route("/api/integration/settings", post(integration_set_settings))
        .route("/api/integration/analytics/top", get(integration_analytics_top))
        .route("/api/integration/analytics/entity/:entity_id", get(integration_analytics_entity))
        .route("/api/integration/health", get(integration_health_report))
        .route("/api/integration/composite", get(integration_composite_sensors))
        .route("/api/integration/composite", post(integration_register_composite))
        // Smart Scenes
        .route("/api/integration/scenes", get(integration_list_scenes))
        .route("/api/integration/scenes", post(integration_create_scene))
        .route("/api/integration/scenes/:scene_id", delete(integration_delete_scene))
        .route("/api/integration/scenes/:scene_id/execute", post(integration_execute_scene))
        // Entity Scheduler
        .route("/api/integration/schedules", get(integration_list_schedules))
        .route("/api/integration/schedules", post(integration_create_schedule))
        .route("/api/integration/schedules/:schedule_id", delete(integration_cancel_schedule))
        // Entity Watchdog
        .route("/api/integration/watchdogs", get(integration_list_watchdogs))
        .route("/api/integration/watchdogs", post(integration_create_watchdog))
        .route("/api/integration/watchdogs/:watchdog_id", delete(integration_delete_watchdog))
        .route("/api/integration/watchdogs/check", post(integration_check_watchdogs))
        // Analytics snapshots
        .route("/api/integration/analytics/history", get(integration_analytics_history))
        // Enhanced Device Control
        .route("/api/integration/device/delayed-action", post(integration_delayed_action))
        .route("/api/integration/device/conditional-action", post(integration_conditional_action))
        .route("/api/integration/device/group-action", post(integration_group_action))
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
        .route("/api/streams/:stream_id/snapshot", post(post_stream_snapshot))
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
        .nest_service("/assets",
            ServeDir::new(
                resolve_dist_dir()
                    .map(|p| p.join("assets"))
                    .unwrap_or_else(|| std::path::PathBuf::from("../dist/assets"))
            ).precompressed_gzip()
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
        .layer(axum::middleware::from_fn(|req: axum::http::Request<axum::body::Body>, next: axum::middleware::Next| async move {
            METRICS.http_requests_total.fetch_add(1, Ordering::Relaxed);
            next.run(req).await
        }))
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

    // Start server.  Port is configurable via the PORT or IORA_HOME_PORT env
    // var (set in /etc/iora/iora-home.env on IORA OS to 8126).  Defaults to
    // 3001 to preserve the legacy dev behaviour when run from `cargo run`.
    let port: u16 = std::env::var("IORA_HOME_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3001);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Backend server listening on {}", addr);

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
    headers.insert(header::CACHE_CONTROL, "no-store, no-cache, must-revalidate".parse().unwrap());
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
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;

    let mut hasher = DefaultHasher::new();
    env!("CARGO_PKG_VERSION").hash(&mut hasher);

    let dist_dir = std::env::var("DIST_DIR").unwrap_or_else(|_| "../dist".to_string());
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

async fn health_check(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let metrics = state.entity_cache.metrics();
    let connected_clients = state.ws_manager.client_count().await;
    let entity_count = state.entity_cache.count().await;

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
        }
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
    info!("Bootstrap: JSON path {} exists={}", json_path.display(), json_present);
    if json_present && creds.is_none() {
        match tokio::fs::read_to_string(json_path).await {
            Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(v) => {
                    let u = v.get("username").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
                    let p = v.get("password").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let d = v.get("display_name").and_then(|x| x.as_str()).map(|s| s.to_string());
                    if !u.is_empty() && p.len() >= 8 {
                        info!("Bootstrap: JSON contains usable credentials for user='{}'", u);
                        creds = Some((u, p, d));
                        delete_json_after = Some(json_path.clone());
                    } else {
                        warn!("Bootstrap JSON at {} is incomplete (need username + password >= 8 chars) — ignoring", json_path.display());
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
    let env_user = std::env::var("IORA_BOOTSTRAP_ADMIN_USER").ok();
    let env_pass = std::env::var("IORA_BOOTSTRAP_ADMIN_PASSWORD").ok();
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
            if !u.is_empty() && p.len() >= 8 {
                let d = std::env::var("IORA_BOOTSTRAP_ADMIN_DISPLAY_NAME").ok();
                info!("Bootstrap: using env-var credentials for user='{}'", u);
                creds = Some((u, p, d));
            } else {
                warn!("Bootstrap env vars present but invalid (username empty or password < 8 bytes) — ignoring");
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
            if !u.is_empty() && p.len() >= 8 {
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
                "SELECT username, password_hash FROM users ORDER BY created_at LIMIT 5"
            )
            .fetch_all(db_pool)
            .await
            {
                Ok(rows) if rows.is_empty() => {
                    info!("Bootstrap: no users in DB and no bootstrap credentials — operator can register from the UI.");
                }
                Ok(rows) => {
                    let orphans: Vec<&str> = rows.iter()
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

    let password_hash = auth::hash_password(&password)
        .map_err(|e| anyhow::anyhow!("hash_password: {}", e))?;

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
        "SELECT id, password_hash FROM users WHERE username = $1"
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
            info!("Bootstrap: applied wizard credentials to user '{}' (admin=true, password updated)", username);
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
            info!("Bootstrap: seeded first admin web-user '{}' from setup wizard", username);
        }
    }

    if let Some(json_path) = &delete_json_after {
        // Best-effort delete; if it fails (read-only fs etc.) we just leave it.
        if let Err(e) = tokio::fs::remove_file(json_path).await {
            warn!("Could not remove bootstrap file {}: {}", json_path.display(), e);
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
        if pb.join("index.html").is_file() { return Some(pb); }
    }
    for rel in ["../dist", "./dist", "/opt/iora/iora-home/dist"] {
        let pb = std::path::PathBuf::from(rel);
        if pb.join("index.html").is_file() { return Some(pb); }
    }
    None
}

/// SPA fallback – serves index.html for any route not matched by API or static files.
/// This enables client-side routing in the React frontend.
async fn spa_fallback(_uri: Uri) -> impl IntoResponse {
    if let Some(dist) = resolve_dist_dir() {
        if let Ok(html) = tokio::fs::read_to_string(dist.join("index.html")).await {
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
                ],
                html,
            ).into_response();
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
    ).into_response()
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
        m.insert("maintenance_mode".into(), Value::Bool(false));
        m.insert("maintenance_message".into(), Value::String("IORA befindet sich im Wartungsmodus.".into()));
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

/// Public, lightweight check for whether Home Assistant has been configured
/// (URL + token both present in `system_preferences/ha_config`). Used by the
/// frontend so the Overview page can be replaced with a "IORA Home not
/// configured" placeholder on a fresh install — Settings and the Admin
/// Control Center remain reachable so the user can configure HA from there.
async fn integration_ha_configured(State(state): State<AppState>) -> impl IntoResponse {
    let mut has_url = false;
    let mut has_token = false;
    if let Ok(Some(pref)) = state.config_repo.get_system_preference("ha_config").await {
        if let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&pref.preference_value) {
            has_url = cfg.get("url").and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false);
            has_token = cfg.get("token").and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false);
        }
    }
    Json(serde_json::json!({
        "configured": has_url && has_token,
        "has_url": has_url,
        "has_token": has_token,
    }))
}

/// Returns dashboard status for the HA integration coordinator to poll.
async fn integration_status(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let entity_count = state.entity_cache.count().await;
    let ha_connected = state.entity_cache.is_ha_connected();
    let connected_clients = state.ws_manager.client_count().await;
    let settings = DASHBOARD_SETTINGS.read().await;
    let metrics = state.entity_cache.metrics();
    let uptime_secs = APP_START.elapsed().as_secs();

    // Count automation entities in cache
    let active_automations = state.entity_cache.get_by_domain("automation").await
        .iter()
        .filter(|e| e.state == "on")
        .count();

    // Entity analytics summary
    let analytics = state.entity_cache.analytics_summary().await;

    // Entity health summary
    let health_report = state.entity_cache.entity_health_report(3600).await;
    let unavailable_entities = health_report.iter().filter(|e| e.status == "unavailable").count();
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

/// GET /api/integration/analytics/top — top N most-active entities by change count
async fn integration_analytics_top(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let n: usize = params.get("limit")
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
        None => Err(ErrorResponse::not_found(format!("No analytics for {}", entity_id))),
    }
}

/// GET /api/integration/health — entity health report (unavailable, stale, low-battery)
async fn integration_health_report(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let threshold: u64 = params.get("stale_threshold")
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
async fn integration_composite_sensors(
    State(state): State<AppState>,
) -> impl IntoResponse {
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
    let sensor_id = body.get("sensor_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing sensor_id"))?;
    let _formula = body.get("formula")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing formula (avg|sum|min|max|diff|comfort_index|range)"))?;
    let _entities = body.get("entities")
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
                METRICS.entity_state_changes.fetch_add(changed.len() as u64, Ordering::Relaxed);
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(serde_json::json!({"result": "ok", "action": "refresh"})))
        }
        "notify" => {
            // Route through the notification dispatcher (persists + broadcasts + sends to all channels)
            let data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            let req = notification_dispatcher::DispatchRequest {
                title: data.get("title").and_then(|v| v.as_str()).unwrap_or("Notification").to_string(),
                message: data.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                level: data.get("level").and_then(|v| v.as_str()).unwrap_or("info").to_string(),
                source: data.get("source").and_then(|v| v.as_str()).unwrap_or("system").to_string(),
                icon: data.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                entity_id: data.get("entity_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                auto_dismiss_secs: data.get("auto_dismiss_secs").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                channels: data.get("channels")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
                extra_data: data.get("extra_data").cloned().unwrap_or(serde_json::Value::Null),
            };
            let (id, _results) = state.notification_dispatcher.dispatch(req).await;
            Ok(Json(serde_json::json!({"result": "ok", "action": "notify", "id": id})))
        }
        "alert" => {
            // Set a dashboard-wide emergency/warning alert
            let data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            let id = uuid::Uuid::new_v4().to_string();
            let level = data.get("level").and_then(|v| v.as_str()).unwrap_or("warning");
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
            Ok(Json(serde_json::json!({"result": "ok", "action": "alert", "id": id})))
        }
        "dismiss_alert" => {
            *ACTIVE_EMERGENCY.write().await = None;
            let event = serde_json::json!({
                "type": "emergency_alert",
                "action": "dismiss",
            });
            state.ws_manager.broadcast_json(&event).await;
            info!("Emergency alert dismissed");
            Ok(Json(serde_json::json!({"result": "ok", "action": "dismiss_alert"})))
        }
        "clear_cache" => {
            // Re-fetch everything from HA (effectively clears stale data)
            let entities = state.ha_client.get_states().await
                .map_err(|e| ErrorResponse::internal(format!("Cache clear failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                METRICS.entity_state_changes.fetch_add(changed.len() as u64, Ordering::Relaxed);
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
                METRICS.entity_state_changes.fetch_add(changed.len() as u64, Ordering::Relaxed);
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(serde_json::json!({"result": "ok", "action": "restart"})))
        }
        "register_composite_sensor" => {
            let data = body.get("data")
                .ok_or_else(|| ErrorResponse::bad_request("Missing data"))?;
            let sensor_id = data.get("sensor_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ErrorResponse::bad_request("Missing sensor_id"))?;
            let mut sensors = COMPOSITE_SENSORS.write().await;
            sensors.insert(sensor_id.to_string(), data.clone());
            Ok(Json(serde_json::json!({"result": "ok", "action": "register_composite_sensor", "sensor_id": sensor_id})))
        }
        "remove_composite_sensor" => {
            let sensor_id = body.get("data")
                .and_then(|d| d.get("sensor_id"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| ErrorResponse::bad_request("Missing sensor_id"))?;
            let mut sensors = COMPOSITE_SENSORS.write().await;
            sensors.remove(sensor_id);
            Ok(Json(serde_json::json!({"result": "ok", "action": "remove_composite_sensor", "sensor_id": sensor_id})))
        }
        "reload" => {
            // Trigger a full re-sync which effectively reloads frontend data
            let entities = state.ha_client.get_states().await
                .map_err(|e| ErrorResponse::internal(format!("Reload re-sync failed: {e}")))?;
            let (changed, _) = state.entity_cache.update(entities).await;
            if !changed.is_empty() {
                METRICS.entity_state_changes.fetch_add(changed.len() as u64, Ordering::Relaxed);
                state.ws_manager.broadcast_state_updates(changed).await;
            }
            Ok(Json(serde_json::json!({"result": "ok", "action": "reload"})))
        }
        "set_widget_value" => {
            let _data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            Ok(Json(serde_json::json!({"result": "ok", "action": "set_widget_value"})))
        }
        "template_result" => {
            let data = body.get("data").cloned().unwrap_or(serde_json::json!({}));
            Ok(Json(serde_json::json!({"result": "ok", "action": "template_result", "data": data})))
        }
        _ => Err(ErrorResponse::bad_request(format!("Unknown command: {command}"))),
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
        let entity_ids: Vec<&str> = def.get("entities")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        let formula = def.get("formula").and_then(|v| v.as_str()).unwrap_or("avg");
        let name = def.get("name").and_then(|v| v.as_str()).unwrap_or(sensor_id);
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

        results.insert(sensor_id.clone(), serde_json::json!({
            "name": name,
            "value": computed.map(|v| (v * 100.0).round() / 100.0),
            "unit": unit,
            "formula": formula,
            "source_count": values.len(),
            "source_entities": entity_ids,
        }));
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
    let scene_id = body.get("scene_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing scene_id"))?;
    let _name = body.get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing name"))?;
    let _steps = body.get("steps")
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
async fn integration_delete_scene(
    Path(scene_id): Path<String>,
) -> impl IntoResponse {
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
    let scene = scenes.get(&scene_id)
        .ok_or_else(|| ErrorResponse::bad_request(format!("Scene not found: {scene_id}")))?
        .clone();
    drop(scenes);

    let steps = scene.get("steps")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut executed = 0u32;
    let mut skipped = 0u32;

    for step in &steps {
        let domain = step.get("domain").and_then(|v| v.as_str()).unwrap_or("homeassistant");
        let service = step.get("service").and_then(|v| v.as_str()).unwrap_or("toggle");
        let entity_id = step.get("entity_id").and_then(|v| v.as_str()).unwrap_or("");
        let delay_ms = step.get("delay_ms").and_then(|v| v.as_u64()).unwrap_or(0);
        let step_data = step.get("data").cloned().unwrap_or(serde_json::json!({}));

        // Check optional condition: { "entity_id": "...", "state": "on" }
        if let Some(condition) = step.get("condition").and_then(|v| v.as_object()) {
            let cond_entity = condition.get("entity_id").and_then(|v| v.as_str()).unwrap_or("");
            let cond_state = condition.get("state").and_then(|v| v.as_str()).unwrap_or("");
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

        match state.ha_client.call_service_fast(domain, service, Value::Object(svc_data)).await {
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
    let schedule_id = body.get("schedule_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing schedule_id"))?
        .to_string();
    let domain = body.get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?
        .to_string();
    let service = body.get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?
        .to_string();
    let run_at = body.get("run_at_unix")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| ErrorResponse::bad_request("Missing run_at_unix (epoch seconds)"))?;
    let svc_data = body.get("data").cloned().unwrap_or(serde_json::json!({}));

    let now = chrono::Utc::now().timestamp();
    if run_at <= now {
        return Err(ErrorResponse::bad_request("run_at_unix must be in the future"));
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
        let _ = ha_client.call_service_fast(&domain, &service, svc_data).await;
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
async fn integration_cancel_schedule(
    Path(schedule_id): Path<String>,
) -> impl IntoResponse {
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
    let watchdog_id = body.get("watchdog_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing watchdog_id"))?;
    let _entity_id = body.get("entity_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing entity_id"))?;
    let trigger = body.get("trigger")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing trigger (unavailable|stale|state_equals)"))?;
    if !["unavailable", "stale", "state_equals"].contains(&trigger) {
        return Err(ErrorResponse::bad_request("trigger must be: unavailable, stale, or state_equals"));
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
async fn integration_delete_watchdog(
    Path(watchdog_id): Path<String>,
) -> impl IntoResponse {
    let mut watchdogs = ENTITY_WATCHDOGS.write().await;
    let existed = watchdogs.remove(&watchdog_id).is_some();
    Json(serde_json::json!({
        "result": "ok",
        "action": if existed { "deleted" } else { "not_found" },
        "watchdog_id": watchdog_id,
    }))
}

/// POST /api/integration/watchdogs/check — evaluate all watchdog rules NOW
async fn integration_check_watchdogs(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let watchdogs = ENTITY_WATCHDOGS.read().await;
    let mut triggered = Vec::new();
    let now = chrono::Utc::now().timestamp();

    for (wid, rule) in watchdogs.iter() {
        let entity_id = rule.get("entity_id").and_then(|v| v.as_str()).unwrap_or("");
        let trigger = rule.get("trigger").and_then(|v| v.as_str()).unwrap_or("");
        let cooldown = rule.get("cooldown_secs").and_then(|v| v.as_i64()).unwrap_or(300);
        let last_triggered = rule.get("last_triggered").and_then(|v| v.as_i64()).unwrap_or(0);
        let action_domain = rule.get("action_domain").and_then(|v| v.as_str()).unwrap_or("homeassistant");
        let action_service = rule.get("action_service").and_then(|v| v.as_str()).unwrap_or("toggle");
        let action_data = rule.get("action_data").cloned().unwrap_or(serde_json::json!({}));

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
                    let target_state = rule.get("target_state").and_then(|v| v.as_str()).unwrap_or("");
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

            match state.ha_client.call_service_fast(action_domain, action_service, Value::Object(svc_data)).await {
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
    let limit = params.get("limit").and_then(|v| v.parse::<i64>().ok()).unwrap_or(100);
    let hours = params.get("hours").and_then(|v| v.parse::<i64>().ok()).unwrap_or(24);

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
    let domain = body.get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?
        .to_string();
    let service = body.get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?
        .to_string();
    let delay_secs = body.get("delay_secs")
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
    let domain = body.get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?;
    let service = body.get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?;
    let svc_data = body.get("data").cloned().unwrap_or(serde_json::json!({}));

    let cond_entity = body.get("condition_entity")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing condition_entity"))?;
    let cond_state = body.get("condition_state")
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

    state.ha_client.call_service_fast(domain, service, svc_data).await
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
    let domain = body.get("domain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing domain"))?;
    let service = body.get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Missing service"))?;
    let entity_ids = body.get("entity_ids")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ErrorResponse::bad_request("Missing entity_ids array"))?;
    let extra_data = body.get("data").cloned().unwrap_or(serde_json::json!({}));

    let mut succeeded = 0u32;
    let mut failed = 0u32;

    for eid_val in entity_ids {
        let eid = eid_val.as_str().unwrap_or("");
        if eid.is_empty() { continue; }

        let mut svc_data = extra_data.as_object().cloned().unwrap_or_default();
        svc_data.insert("entity_id".into(), Value::String(eid.into()));

        match state.ha_client.call_service_fast(domain, service, Value::Object(svc_data)).await {
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

// ─── Streaming Server Handlers ──────────────────────────────────────────

/// List all active streams
async fn list_streams(
    State(state): State<AppState>,
) -> impl IntoResponse {
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
        (StatusCode::OK, Json(serde_json::json!({ "status": "stopped" })))
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Stream not found" })))
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
        ).into_response(),
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
    if state.stream_manager.set_snapshot(&stream_id, body.to_vec()).await {
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
}

async fn admin_settings_schema(
    State(state): State<AppState>,
) -> Json<Vec<SettingDefinition>> {
    Json(state.settings_registry.control_center())
}

async fn admin_settings_schema_wizard(
    State(state): State<AppState>,
) -> Json<Vec<SettingDefinition>> {
    Json(state.settings_registry.wizard())
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

    if !def.requires_restart.is_empty() {
        info!(
            "Setting '{}' updated – the following services need a restart to pick up the change: {}",
            key,
            def.requires_restart.join(", ")
        );
    }

    Ok(Json(SettingValueDto {
        value: def.redact(&body.value),
        definition: def,
        is_set: true,
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
    let since = query.since.unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

    match state.config_repo.get_changes_since(&since).await {
        Ok(changes) => Ok(Json(changes)),
        Err(e) => {
            warn!("Failed to get sync changes: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get sync changes: {}", e)))
        }
    }
}

// ── List all users (for terminal/kiosk quick-switch) ───────────────
async fn list_all_users(
    State(state): State<AppState>,
) -> Result<Json<Vec<db::models::UserListEntry>>, ErrorResponse> {
    match state.config_repo.list_users().await {
        Ok(users) => {
            let entries: Vec<db::models::UserListEntry> = users.into_iter().map(|u| {
                db::models::UserListEntry {
                    has_pin: u.pin_hash.is_some(),
                    id: u.id,
                    username: u.username,
                    display_name: u.display_name,
                    avatar_url: u.avatar_url,
                }
            }).collect();
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
        None => return Err(ErrorResponse::bad_request("Kein PIN gesetzt. Bitte mit Passwort anmelden.")),
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
        return Err(ErrorResponse::bad_request("PIN muss zwischen 4 und 8 Zeichen lang sein"));
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
            Err(ErrorResponse::internal("Layouts konnten nicht geladen werden"))
        }
    }
}

async fn save_page_layout(
    State(state): State<AppState>,
    axum::extract::Path(profile_id): axum::extract::Path<String>,
    Json(request): Json<db::models::SavePageLayoutRequest>,
) -> Result<Json<db::models::PageLayout>, ErrorResponse> {
    match state.config_repo.save_page_layout(&profile_id, request).await {
        Ok(layout) => Ok(Json(layout)),
        Err(e) => {
            warn!("Failed to save page layout: {}", e);
            Err(ErrorResponse::internal("Layout konnte nicht gespeichert werden"))
        }
    }
}

// ── Terminal/kiosk device mode ─────────────────────────────────────
async fn set_device_terminal_mode(
    State(state): State<AppState>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
    Json(request): Json<db::models::SetTerminalModeRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    match state.config_repo.set_terminal_mode(&device_id, request.is_terminal, request.terminal_name.as_deref()).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "success": true,
            "is_terminal": request.is_terminal,
        }))),
        Err(e) => {
            warn!("Failed to set terminal mode: {}", e);
            Err(ErrorResponse::internal("Terminal-Modus konnte nicht gesetzt werden"))
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
            Err(ErrorResponse::internal("Seiteneinstellungen konnten nicht geladen werden"))
        }
    }
}

async fn get_page_settings_handler(
    State(state): State<AppState>,
    axum::extract::Path((profile_id, page_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    match state.config_repo.get_page_settings(&profile_id, &page_id).await {
        Ok(Some(settings)) => Ok(Json(serde_json::to_value(settings).unwrap())),
        Ok(None) => Ok(Json(serde_json::json!(null))),
        Err(e) => {
            warn!("Failed to get page settings: {}", e);
            Err(ErrorResponse::internal("Seiteneinstellungen konnten nicht geladen werden"))
        }
    }
}

async fn save_page_settings_handler(
    State(state): State<AppState>,
    axum::extract::Path(profile_id): axum::extract::Path<String>,
    Json(request): Json<db::models::SavePageSettingsRequest>,
) -> Result<Json<db::models::PageSettings>, ErrorResponse> {
    match state.config_repo.save_page_settings(&profile_id, &request).await {
        Ok(settings) => Ok(Json(settings)),
        Err(e) => {
            warn!("Failed to save page settings: {}", e);
            Err(ErrorResponse::internal("Seiteneinstellungen konnten nicht gespeichert werden"))
        }
    }
}

async fn delete_page_settings_handler(
    State(state): State<AppState>,
    axum::extract::Path((profile_id, page_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    match state.config_repo.delete_page_settings(&profile_id, &page_id).await {
        Ok(()) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => {
            warn!("Failed to delete page settings: {}", e);
            Err(ErrorResponse::internal("Seiteneinstellungen konnten nicht gelöscht werden"))
        }
    }
}

/// Helper: extract JWT claims from Authorization header
fn extract_claims(headers: &HeaderMap) -> Result<auth::Claims, ErrorResponse> {
    let token = match headers.get(header::AUTHORIZATION) {
        Some(value) => match value.to_str() {
            Ok(v) => v.strip_prefix("Bearer ").unwrap_or_default(),
            Err(_) => return Err(ErrorResponse::unauthorized("Ungültiger Authorization-Header")),
        },
        None => return Err(ErrorResponse::unauthorized("Nicht authentifiziert")),
    };
    if token.is_empty() {
        return Err(ErrorResponse::unauthorized("Token fehlt"));
    }
    auth::verify_token(token).map_err(|_| ErrorResponse::unauthorized("Ungültiges oder abgelaufenes Token"))
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
    let user = match state.config_repo.get_user_by_username(&request.username).await {
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

    let token = match auth::generate_token(&user.id, &user.username, user.is_admin, expiration_days) {
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
) -> Result<Json<serde_json::Value>, ErrorResponse> {
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
        (chrono::Utc::now() - chrono::Duration::hours(24)).format("%Y-%m-%dT%H:%M:%S").to_string()
    });
    let end = query.end.unwrap_or_else(|| {
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string()
    });

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
    let forecast_data = body.get("forecast")
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
            let friendly_name = e.attributes
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
async fn get_entity_counts(
    State(state): State<AppState>,
) -> impl IntoResponse {
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
    let (total_changes,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM entity_history WHERE entity_id = $1"
    )
    .bind(&entity_id)
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("Query failed: {}", e)))?;

    // First and last seen
    let time_range: Option<(String, String)> = sqlx::query_as(
        "SELECT MIN(recorded_at), MAX(recorded_at) FROM entity_history WHERE entity_id = $1"
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

    let (history_entries_24h,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM entity_history WHERE recorded_at >= $1"
    )
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
        .map(|(entity_id, change_count)| ActiveEntity { entity_id, change_count })
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
struct LogEntry {
    /// Monotonic ID for ordering
    id: u64,
    /// ISO-8601 timestamp
    timestamp: String,
    /// Log level: trace, debug, info, warn, error
    level: String,
    /// Source service / module target
    target: String,
    /// Log message text
    message: String,
    /// Optional structured fields
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<Value>,
}

/// Global log ID counter
static LOG_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// In-memory ring buffer for captured log entries
static LOG_BUFFER: std::sync::LazyLock<std::sync::RwLock<VecDeque<LogEntry>>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(VecDeque::with_capacity(LOG_BUFFER_CAPACITY)));

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
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: tracing_subscriber::layer::Context<'_, S>) {
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
                    self.1.insert(field.name().to_string(), json!(format!("{:?}", value)));
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
            "error" => { METRICS.log_error_count.fetch_add(1, Ordering::Relaxed); }
            "warn" => { METRICS.log_warn_count.fetch_add(1, Ordering::Relaxed); }
            "info" => { METRICS.log_info_count.fetch_add(1, Ordering::Relaxed); }
            _ => {}
        }
        let fields = if visitor.1.is_empty() { None } else { Some(json!(visitor.1)) };
        push_log_entry(level, target, &visitor.0, fields);
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

pub(crate) static METRICS: std::sync::LazyLock<IoraMetrics> = std::sync::LazyLock::new(|| IoraMetrics {
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
async fn get_system_stats(
    State(state): State<AppState>,
) -> impl IntoResponse {
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
        (cpu_usage, sys.cpus().len(), sys.total_memory(), sys.used_memory())
    }).await.unwrap_or((0.0, 0, 0, 0));

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
        "SELECT page_count * page_size FROM pragma_page_count, pragma_page_size"
    )
    .fetch_one(&state.db_pool)
    .await
    .unwrap_or(0);

    // History row count
    let (history_total,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM entity_history"
    )
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
async fn get_ha_info(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
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
    let ha_version = all_entities.iter()
        .find(|e| e.entity_id == "sensor.home_assistant_version" || e.entity_id == "update.home_assistant_core_update")
        .map(|e| e.state.clone());

    // History entries in last 24h
    let cutoff_24h = (chrono::Utc::now() - chrono::Duration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();
    let (history_24h,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM entity_history WHERE recorded_at >= $1"
    )
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
            let cooldown = rule.get("cooldown_secs").and_then(|v| v.as_i64()).unwrap_or(300);
            let last_triggered = rule.get("last_triggered").and_then(|v| v.as_i64()).unwrap_or(0);
            let action_domain = rule.get("action_domain").and_then(|v| v.as_str()).unwrap_or("homeassistant");
            let action_service = rule.get("action_service").and_then(|v| v.as_str()).unwrap_or("toggle");
            let action_data = rule.get("action_data").cloned().unwrap_or(serde_json::json!({}));

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
                        let target_state = rule.get("target_state").and_then(|v| v.as_str()).unwrap_or("");
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
                if let Ok(()) = ha_client.call_service_fast(action_domain, action_service, Value::Object(svc_data)).await {
                    triggered.push((wid.clone(), entity_id.to_string(), format!("{action_domain}.{action_service}")));
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
                info!("Watchdog auto-triggered: {} for entity {} → {}", wid, entity_id, action);
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

        let anomalies: Vec<serde_json::Value> = top.iter()
            .filter(|a| (a.change_count as f64) > threshold)
            .map(|a| serde_json::json!({
                "entity_id": a.entity_id,
                "state_changes": a.change_count,
                "threshold": threshold as u64,
                "mean": mean as u64,
            }))
            .collect();

        if !anomalies.is_empty() {
            info!("Entity anomaly detection: {} entities with unusual activity", anomalies.len());
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
async fn background_analytics_aggregation(
    entity_cache: Arc<EntityStateCache>,
    db_pool: DbPool,
) {
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
        )"
    ).execute(&db_pool).await;

    loop {
        interval.tick().await;
        task_entry(7).record_run();

        let summary = entity_cache.analytics_summary().await;
        let health = entity_cache.entity_health_report(3600).await;
        let top = entity_cache.top_active_entities(1).await;

        let total_entities = entity_cache.count().await as i32;
        let unavailable = health.iter().filter(|h| h.status == "unavailable").count() as i32;
        let stale = health.iter().filter(|h| h.status == "stale").count() as i32;
        let total_changes = summary.get("total_state_changes").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
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
        let currently_stale: std::collections::HashSet<String> = health.iter()
            .filter(|h| h.status == "stale" || h.status == "unavailable")
            .map(|h| h.entity_id.clone())
            .collect();

        // Find newly stale entities (ones that weren't stale before)
        let newly_stale: Vec<&String> = currently_stale.iter()
            .filter(|e| !previously_stale.contains(*e))
            .collect();

        // Find recovered entities
        let recovered: Vec<&String> = previously_stale.iter()
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
                info!("Stale entity monitor: {} newly stale entities detected", newly_stale.len());
            }
            if !recovered.is_empty() {
                info!("Stale entity monitor: {} entities recovered", recovered.len());
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

    let permissions = request.permissions.unwrap_or_else(|| vec!["read".to_string()]);
    let permissions_json = serde_json::to_string(&permissions)
        .map_err(|_| ErrorResponse::internal("Invalid permissions"))?;

    let rate_limit = request.rate_limit.unwrap_or(60).clamp(1, 1000);

    let expires_at = request.expires_in_days.map(|days| {
        chrono::Utc::now() + chrono::Duration::days(days.clamp(1, 365))
    });

    let api_key = state.config_repo.create_api_key(
        &user_id,
        request.name.trim(),
        &key_hash,
        &prefix,
        &permissions_json,
        rate_limit,
        expires_at,
    ).await.map_err(|e| {
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
    let keys = state.config_repo.list_api_keys(identity.user_id()).await
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
    let keys = state.config_repo.list_api_keys(identity.user_id()).await
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
    let users = state.config_repo.list_all_users_admin().await
        .map_err(|e| {
            warn!("Failed to list users: {}", e);
            ErrorResponse::internal("Fehler beim Laden der Benutzer")
        })?;

    let entries: Vec<db::models::AdminUserEntry> = users.into_iter().map(|u| {
        db::models::AdminUserEntry {
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
        }
    }).collect();

    Ok(Json(entries))
}

/// Admin: Set user admin status
async fn admin_set_user_admin(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(request): Json<db::models::SetAdminRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    state.config_repo.set_user_admin(&user_id, request.is_admin).await
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
    let user = state.config_repo.get_user_by_id(&user_id).await
        .map_err(|e| { warn!("Failed to lookup user: {}", e); ErrorResponse::internal("Datenbankfehler") })?
        .ok_or_else(|| ErrorResponse::not_found("Benutzer nicht gefunden"))?;

    // Update display name if provided
    if let Some(display_name) = body.get("display_name").and_then(|v| v.as_str()) {
        let req = db::models::UpdateUserRequest {
            username: None,
            display_name: Some(display_name.to_string()),
        };
        state.config_repo.update_user(&user_id, req).await
            .map_err(|e| { warn!("Failed to update user: {}", e); ErrorResponse::internal("Fehler beim Aktualisieren") })?;
    }

    // Update role if provided
    if let Some(role) = body.get("role").and_then(|v| v.as_str()) {
        let valid_roles = ["user", "viewer", "editor", "admin", "maintenance"];
        if valid_roles.contains(&role) {
            state.config_repo.set_user_role(&user_id, role).await
                .map_err(|e| { warn!("Failed to set role: {}", e); ErrorResponse::internal("Rolle konnte nicht gesetzt werden") })?;
            // If role is "admin", also set is_admin flag
            if role == "admin" {
                state.config_repo.set_user_admin(&user_id, true).await
                    .map_err(|e| { warn!("Failed to set admin: {}", e); ErrorResponse::internal("Admin-Status konnte nicht gesetzt werden") })?;
            }
        }
    }

    // Reset password if provided
    if let Some(new_password) = body.get("new_password").and_then(|v| v.as_str()) {
        if !new_password.is_empty() {
            let hash = auth::hash_password(new_password)
                .map_err(|e| { warn!("Failed to hash password: {}", e); ErrorResponse::internal("Passwort-Hashing fehlgeschlagen") })?;
            state.config_repo.set_user_password(&user_id, &hash).await
                .map_err(|e| { warn!("Failed to set password: {}", e); ErrorResponse::internal("Passwort konnte nicht gesetzt werden") })?;
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
        return Err(ErrorResponse::bad_request("Du kannst dich nicht selbst löschen"));
    }

    state.config_repo.delete_user(&user_id).await
        .map_err(|e| {
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
    let ha_url = std::env::var("HA_URL")
        .unwrap_or_else(|_| "http://homeassistant.local:8123".to_string());
    let ha_token = std::env::var("HA_TOKEN")
        .map_err(|_| ErrorResponse::internal("HA_TOKEN not configured"))?;

    let response = state.http_client
        .get(format!("{}{}", ha_url, path))
        .header("Authorization", format!("Bearer {}", ha_token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| ErrorResponse::internal(format!("HA API request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(ErrorResponse::internal(format!("HA API returned {}: {}", status, body)));
    }

    response.json::<Value>().await
        .map_err(|e| ErrorResponse::internal(format!("Failed to parse HA response: {}", e)))
}

/// Admin: Get HA configuration
async fn admin_ha_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first, then fall back to direct API call
    let config = state.ha_data_cache
        .get_or_fetch_api("/api/config", std::time::Duration::from_secs(120), || async {
            ha_api_get(&state, "/api/config").await.ok()
        })
        .await
        .ok_or_else(|| ErrorResponse::internal("HA config not available"))?;
    Ok(Json(config))
}

/// Admin: Get HA integrations/components
async fn admin_ha_integrations(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Get components list from cache
    let config = state.ha_data_cache
        .get_or_fetch_api("/api/config", std::time::Duration::from_secs(120), || async {
            ha_api_get(&state, "/api/config").await.ok()
        })
        .await
        .ok_or_else(|| ErrorResponse::internal("HA config not available"))?;
    let components = config.get("components").cloned().unwrap_or(Value::Array(vec![]));

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
async fn admin_ha_devices(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    // Group entities by device_class and area
    let mut by_device_class: HashMap<String, Vec<Value>> = HashMap::new();
    for e in &all_entities {
        let device_class = e.attributes
            .get("device_class")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        by_device_class.entry(device_class).or_default().push(serde_json::json!({
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
async fn admin_ha_areas(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // HA REST API doesn't expose areas directly, but we can extract from entity attributes
    let all_entities = state.entity_cache.get_all().await;

    let mut areas: HashMap<String, Vec<String>> = HashMap::new();
    for e in &all_entities {
        if let Some(area) = e.attributes.get("area_id").and_then(|v| v.as_str()) {
            areas.entry(area.to_string()).or_default().push(e.entity_id.clone());
        }
    }

    Ok(Json(serde_json::json!({
        "areas": areas,
        "area_count": areas.len(),
    })))
}

/// Admin: Get HA automations  
async fn admin_ha_automations(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let automations = state.entity_cache.get_by_domain("automation").await;
    let data: Vec<Value> = automations.iter().map(|a| {
        serde_json::json!({
            "entity_id": a.entity_id,
            "state": a.state,
            "friendly_name": a.attributes.get("friendly_name"),
            "last_triggered": a.attributes.get("last_triggered"),
            "current": a.attributes.get("current"),
        })
    }).collect();

    Ok(Json(serde_json::json!({
        "automations": data,
        "total": data.len(),
    })))
}

/// Admin: Get available HA services
async fn admin_ha_services(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let services = state.ha_data_cache
        .get_or_fetch_api("/api/services", std::time::Duration::from_secs(300), || async {
            ha_api_get(&state, "/api/services").await.ok()
        })
        .await
        .ok_or_else(|| ErrorResponse::internal("HA services not available"))?;
    Ok(Json(services))
}

/// Admin: Get HA error log
async fn admin_ha_logs(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // 1. Try cached error log first (background worker refreshes every 45s)
    if let Some(cached) = state.ha_data_cache.get_api("/api/error_log").await {
        return Ok(Json(cached));
    }

    // 2. Cache miss – use ha_client (which already has URL + token configured)
    match state.ha_client.get_error_log().await {
        Ok(log_text) => {
            let result = parse_ha_error_log(&log_text);
            state.ha_data_cache.set_api(
                "/api/error_log",
                result.clone(),
                std::time::Duration::from_secs(30),
            ).await;
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
async fn admin_ha_mqtt(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    // Find MQTT-related entities  
    let mqtt_entities: Vec<Value> = all_entities.iter()
        .filter(|e| {
            e.entity_id.contains("mqtt") ||
            e.attributes.get("integration").and_then(|v| v.as_str()) == Some("mqtt") ||
            e.attributes.get("source").and_then(|v| v.as_str()).map(|s| s.contains("mqtt")).unwrap_or(false)
        })
        .map(|e| serde_json::json!({
            "entity_id": e.entity_id,
            "state": e.state,
            "friendly_name": e.attributes.get("friendly_name"),
            "attributes": e.attributes,
        }))
        .collect();

    // Try to get MQTT addon status
    let mqtt_broker_status = all_entities.iter()
        .find(|e| e.entity_id.contains("mosquitto") || e.entity_id.contains("mqtt_broker"))
        .map(|e| serde_json::json!({
            "entity_id": e.entity_id,
            "state": e.state,
            "attributes": e.attributes,
        }));

    Ok(Json(serde_json::json!({
        "mqtt_entities": mqtt_entities,
        "mqtt_entity_count": mqtt_entities.len(),
        "broker_status": mqtt_broker_status,
    })))
}

/// Admin: Get Matter information (from HA entities)
async fn admin_ha_matter(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let all_entities = state.entity_cache.get_all().await;

    let matter_entities: Vec<Value> = all_entities.iter()
        .filter(|e| {
            e.entity_id.contains("matter") ||
            e.attributes.get("integration").and_then(|v| v.as_str()) == Some("matter") ||
            e.attributes.get("source").and_then(|v| v.as_str()).map(|s| s.contains("matter")).unwrap_or(false)
        })
        .map(|e| serde_json::json!({
            "entity_id": e.entity_id,
            "state": e.state,
            "friendly_name": e.attributes.get("friendly_name"),
            "attributes": e.attributes,
        }))
        .collect();

    Ok(Json(serde_json::json!({
        "matter_entities": matter_entities,
        "matter_entity_count": matter_entities.len(),
    })))
}

// ── MQTT Client Management Handlers ────────────────────────────────

/// Get MQTT client status
async fn admin_mqtt_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let status = state.mqtt_client.status().await;
    Ok(Json(serde_json::to_value(status).unwrap()))
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
        client_id: req.client_id.clone().unwrap_or_else(|| format!("mdt-dashboard-{}", &uuid::Uuid::new_v4().to_string()[..8])),
        use_tls: req.use_tls.unwrap_or(false),
    };

    let host = config.host.clone();
    let port = config.port;
    match state.mqtt_client.connect(config).await {
        Ok(()) => {
            info!("MQTT: Connected to {}:{}", host, port);
            // Auto-save config to DB on successful connect
            let config_value = serde_json::json!({
                "host": req.host,
                "port": req.port.unwrap_or(1883),
                "username": req.username,
                "password": req.password,
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
            Ok(Json(serde_json::json!({ "success": true, "message": "Verbunden und gespeichert" })))
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
    Ok(Json(serde_json::json!({ "success": true, "message": "Disconnected" })))
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
        Ok(()) => Ok(Json(serde_json::json!({ "success": true, "topic": req.topic }))),
        Err(e) => Ok(Json(serde_json::json!({ "success": false, "error": e }))),
    }
}

/// Unsubscribe from MQTT topic
async fn admin_mqtt_unsubscribe(
    State(state): State<AppState>,
    Json(req): Json<MqttTopicRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    match state.mqtt_client.unsubscribe(&req.topic).await {
        Ok(()) => Ok(Json(serde_json::json!({ "success": true, "topic": req.topic }))),
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
    match state.mqtt_client.publish(&req.topic, &req.payload, req.retain.unwrap_or(false)).await {
        Ok(()) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Ok(Json(serde_json::json!({ "success": false, "error": e }))),
    }
}

/// Get recent MQTT messages
async fn admin_mqtt_messages(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
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
    let config_value = serde_json::json!({
        "host": req.host,
        "port": req.port.unwrap_or(1883),
        "username": req.username,
        "password": req.password,
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
            Err(ErrorResponse::internal(format!("Failed to save MQTT config: {}", e)))
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
                if config.get("password").and_then(|p| p.as_str()).is_some() {
                    config.as_object_mut().unwrap().insert("has_password".into(), serde_json::json!(true));
                    config.as_object_mut().unwrap().remove("password");
                }
                Ok(Json(config))
            } else {
                Ok(Json(serde_json::json!({})))
            }
        }
        Ok(None) => Ok(Json(serde_json::json!({}))),
        Err(e) => {
            warn!("Failed to get MQTT config: {}", e);
            Err(ErrorResponse::internal(format!("Failed to get MQTT config: {}", e)))
        }
    }
}

// ── Matter Client Management Handlers ──────────────────────────────

/// Get Matter status with device details 
async fn admin_matter_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Refresh from entity cache first
    let entities = state.entity_cache.get_all().await;
    state.matter_client.refresh_from_entities(&entities).await;

    let matter_entity_count = entities.iter()
        .filter(|e| {
            e.entity_id.contains("matter") ||
            e.attributes.get("integration").and_then(|v| v.as_str()) == Some("matter")
        })
        .count();

    let status = state.matter_client.status(matter_entity_count).await;
    Ok(Json(serde_json::to_value(status).unwrap()))
}

/// Save Matter config
async fn admin_matter_save_config(
    State(state): State<AppState>,
    Json(config): Json<matter_client::MatterConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.matter_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "matter_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap(),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => {
            warn!("Failed to save Matter config: {}", e);
            Err(ErrorResponse::internal(format!("Failed to save Matter config: {}", e)))
        }
    }
}

/// Get Matter config
async fn admin_matter_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.matter_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap()))
}

/// Refresh Matter devices from HA entities
async fn admin_matter_refresh(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.matter_client.refresh_from_entities(&entities).await;
    let devices = state.matter_client.status(0).await;
    Ok(Json(serde_json::json!({
        "success": true,
        "device_count": devices.device_count,
    })))
}

// ── Zigbee Client Management Handlers ──────────────────────────────

async fn admin_zigbee_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let integrations: Vec<String> = state.ha_connection.get_integrations().await.iter()
        .filter(|i| i.available).map(|i| i.domain.clone()).collect();
    state.zigbee_client.refresh_from_entities(&entities, &integrations).await;
    let status = state.zigbee_client.status().await;
    Ok(Json(serde_json::to_value(status).unwrap()))
}

async fn admin_zigbee_save_config(
    State(state): State<AppState>,
    Json(config): Json<zigbee_client::ZigbeeConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.zigbee_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "zigbee_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap(),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!("Failed to save Zigbee config: {}", e))),
    }
}

async fn admin_zigbee_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.zigbee_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap()))
}

async fn admin_zigbee_refresh(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let integrations: Vec<String> = state.ha_connection.get_integrations().await.iter()
        .filter(|i| i.available).map(|i| i.domain.clone()).collect();
    state.zigbee_client.refresh_from_entities(&entities, &integrations).await;
    let status = state.zigbee_client.status().await;
    Ok(Json(serde_json::json!({ "success": true, "device_count": status.device_count })))
}

// ── Z-Wave Client Management Handlers ──────────────────────────────

async fn admin_zwave_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.zwave_client.refresh_from_entities(&entities).await;
    let zwave_count = entities.iter().filter(|e| e.entity_id.contains("zwave")).count();
    let status = state.zwave_client.status(zwave_count).await;
    Ok(Json(serde_json::to_value(status).unwrap()))
}

async fn admin_zwave_save_config(
    State(state): State<AppState>,
    Json(config): Json<zwave_client::ZwaveConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.zwave_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "zwave_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap(),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!("Failed to save Z-Wave config: {}", e))),
    }
}

async fn admin_zwave_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.zwave_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap()))
}

async fn admin_zwave_refresh(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.zwave_client.refresh_from_entities(&entities).await;
    let status = state.zwave_client.status(0).await;
    Ok(Json(serde_json::json!({ "success": true, "node_count": status.node_count })))
}

// ── Bluetooth/BLE Client Management Handlers ───────────────────────

async fn admin_ble_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.ble_client.refresh_from_entities(&entities).await;
    let ble_count = entities.iter().filter(|e| {
        e.entity_id.contains("ble_") || e.entity_id.contains("bluetooth")
    }).count();
    let status = state.ble_client.status(ble_count).await;
    Ok(Json(serde_json::to_value(status).unwrap()))
}

async fn admin_ble_save_config(
    State(state): State<AppState>,
    Json(config): Json<ble_client::BleConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.ble_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "ble_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap(),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!("Failed to save BLE config: {}", e))),
    }
}

async fn admin_ble_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.ble_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap()))
}

async fn admin_ble_refresh(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    state.ble_client.refresh_from_entities(&entities).await;
    let status = state.ble_client.status(0).await;
    Ok(Json(serde_json::json!({ "success": true, "device_count": status.device_count })))
}

// ── HomeKit Client Management Handlers ─────────────────────────────

async fn admin_homekit_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let ha_has_homekit = state.ha_connection.has_integration("homekit").await;
    state.homekit_client.refresh_from_entities(&entities, ha_has_homekit).await;
    let hk_count = entities.iter().filter(|e| e.entity_id.contains("homekit")).count();
    let status = state.homekit_client.status(hk_count).await;
    Ok(Json(serde_json::to_value(status).unwrap()))
}

async fn admin_homekit_save_config(
    State(state): State<AppState>,
    Json(config): Json<homekit_client::HomekitConfig>,
) -> Result<Json<Value>, ErrorResponse> {
    state.homekit_client.update_config(config.clone()).await;
    let save_req = db::models::SaveSystemPreferenceRequest {
        preference_key: "homekit_config".to_string(),
        preference_value: serde_json::to_value(&config).unwrap(),
    };
    match state.config_repo.save_system_preference(save_req).await {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err(ErrorResponse::internal(format!("Failed to save HomeKit config: {}", e))),
    }
}

async fn admin_homekit_get_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let config = state.homekit_client.get_config().await;
    Ok(Json(serde_json::to_value(config).unwrap()))
}

async fn admin_homekit_refresh(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let entities = state.entity_cache.get_all().await;
    let ha_has_homekit = state.ha_connection.has_integration("homekit").await;
    state.homekit_client.refresh_from_entities(&entities, ha_has_homekit).await;
    let status = state.homekit_client.status(0).await;
    Ok(Json(serde_json::json!({ "success": true, "accessory_count": status.accessory_count })))
}

// ── HA Connection Health Handlers ──────────────────────────────────

async fn admin_ha_connection_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let status = state.ha_connection.status().await;
    Ok(Json(serde_json::to_value(status).unwrap()))
}

/// Overview of all protocol statuses in one call
async fn admin_protocols_overview(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let ha_status = state.ha_connection.status().await;
    let mqtt_status = state.mqtt_client.status().await;

    let entities = state.entity_cache.get_all().await;

    // Refresh all protocol clients from entity cache
    let integrations: Vec<String> = ha_status.integrations.iter()
        .filter(|i| i.available).map(|i| i.domain.clone()).collect();
    state.zigbee_client.refresh_from_entities(&entities, &integrations).await;
    state.zwave_client.refresh_from_entities(&entities).await;
    state.ble_client.refresh_from_entities(&entities).await;
    state.matter_client.refresh_from_entities(&entities).await;
    state.homekit_client.refresh_from_entities(&entities, ha_status.integrations.iter().any(|i| i.domain == "homekit" && i.available)).await;

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
async fn admin_ha_addons(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
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
            let addon_entities: Vec<Value> = all.iter()
                .filter(|e| e.entity_id.starts_with("update.") &&
                    e.attributes.get("entity_picture").is_some())
                .map(|e| serde_json::json!({
                    "entity_id": e.entity_id,
                    "state": e.state,
                    "friendly_name": e.attributes.get("friendly_name"),
                    "installed_version": e.attributes.get("installed_version"),
                    "latest_version": e.attributes.get("latest_version"),
                    "entity_picture": e.attributes.get("entity_picture"),
                }))
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
async fn admin_ha_supervisor(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state.ha_data_cache.get_api("/api/hassio/supervisor/info").await {
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
                            let components = config.get("components")
                                .and_then(|c| c.as_array())
                                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
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
async fn admin_ha_scenes(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let scenes = state.entity_cache.get_by_domain("scene").await;
    let data: Vec<Value> = scenes.iter().map(|s| {
        serde_json::json!({
            "entity_id": s.entity_id,
            "state": s.state,
            "friendly_name": s.attributes.get("friendly_name"),
            "entity_picture": s.attributes.get("entity_picture"),
            "last_activated": s.last_changed,
        })
    }).collect();

    Ok(Json(serde_json::json!({
        "scenes": data,
        "scene_count": data.len(),
    })))
}

/// Admin: Get HA backups (requires Supervisor)
async fn admin_ha_backups(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state.ha_data_cache.get_api("/api/hassio/backups").await {
        let backups = if data.get("result").and_then(|v| v.as_str()) == Some("ok") {
            data.get("data").and_then(|d| d.get("backups")).cloned().unwrap_or(Value::Array(vec![]))
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
                data.get("data").and_then(|d| d.get("backups")).cloned().unwrap_or(Value::Array(vec![]))
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
async fn admin_ha_network(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state.ha_data_cache.get_api("/api/hassio/network/info").await {
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
async fn admin_ha_logbook(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // Try cache first
    if let Some(data) = state.ha_data_cache.get_api("/api/logbook").await {
        let entries = if data.is_array() { data } else { Value::Array(vec![]) };
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
            let entries = if data.is_array() { data } else { Value::Array(vec![]) };
            let len = entries.as_array().map(|a| a.len()).unwrap_or(0);
            Ok(Json(serde_json::json!({
                "entries": entries,
                "total": len,
            })))
        }
        Err(e) => Err(ErrorResponse::internal(format!("Logbook nicht verfügbar: {}", e))),
    }
}

// ── Public Calendar Endpoints ──────────────────────────────────────────

/// Get available HA calendars (authenticated)
async fn get_calendars(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
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
        Err(e) => Err(ErrorResponse::internal(format!("Kalender nicht verfügbar: {}", e))),
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
    let start = params.get("start")
        .cloned()
        .unwrap_or_else(|| now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());
    let end = params.get("end")
        .cloned()
        .unwrap_or_else(|| (now + chrono::Duration::days(30)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());

    match state.ha_client.get_calendar_events(&entity_id, &start, &end).await {
        Ok(data) => Ok(Json(serde_json::json!({
            "entity_id": entity_id,
            "events": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        }))),
        Err(e) => Err(ErrorResponse::internal(format!("Kalender-Events nicht verfügbar: {}", e))),
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
async fn get_all_lights(
    State(state): State<AppState>,
) -> Json<Value> {
    let entities = state.entity_cache.get_all().await;
    let lights: Vec<Value> = entities.iter()
        .filter(|e| e.entity_id.starts_with("light."))
        .map(|e| serde_json::json!({
            "entity_id": e.entity_id,
            "state": e.state,
            "friendly_name": e.attributes.get("friendly_name"),
            "brightness": e.attributes.get("brightness"),
            "color_temp": e.attributes.get("color_temp"),
            "rgb_color": e.attributes.get("rgb_color"),
            "color_mode": e.attributes.get("color_mode"),
            "supported_color_modes": e.attributes.get("supported_color_modes"),
            "last_changed": e.last_changed,
        }))
        .collect();
    Json(serde_json::json!({ "lights": lights, "count": lights.len() }))
}

/// Control a light entity (turn on/off, set brightness, color, etc.)
async fn control_light(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("toggle");
    let service = match action {
        "on" | "turn_on" => "turn_on",
        "off" | "turn_off" => "turn_off",
        _ => "toggle",
    };

    let mut service_data = serde_json::json!({ "entity_id": entity_id });
    if let Some(obj) = service_data.as_object_mut() {
        if let Some(brightness) = body.get("brightness") { obj.insert("brightness".into(), brightness.clone()); }
        if let Some(color_temp) = body.get("color_temp") { obj.insert("color_temp".into(), color_temp.clone()); }
        if let Some(rgb) = body.get("rgb_color") { obj.insert("rgb_color".into(), rgb.clone()); }
        if let Some(transition) = body.get("transition") { obj.insert("transition".into(), transition.clone()); }
    }

    match state.ha_client.call_service("light", service, service_data, "").await {
        Ok(resp) => Ok(Json(serde_json::json!({ "success": true, "entity_id": entity_id, "action": service, "response": resp }))),
        Err(e) => Err(ErrorResponse::internal(format!("Lichtsteuerung fehlgeschlagen: {}", e))),
    }
}

/// Get all media player entities with state
async fn get_all_media_players(
    State(state): State<AppState>,
) -> Json<Value> {
    let entities = state.entity_cache.get_all().await;
    let players: Vec<Value> = entities.iter()
        .filter(|e| e.entity_id.starts_with("media_player."))
        .map(|e| serde_json::json!({
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
        }))
        .collect();
    Json(serde_json::json!({ "media_players": players, "count": players.len() }))
}

/// Control a media player (play, pause, stop, volume, next, previous)
async fn control_media_player(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("media_play_pause");
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
        if let Some(volume) = body.get("volume_level") { obj.insert("volume_level".into(), volume.clone()); }
        if let Some(mute) = body.get("is_volume_muted") { obj.insert("is_volume_muted".into(), mute.clone()); }
    }

    match state.ha_client.call_service("media_player", service, service_data, "").await {
        Ok(resp) => Ok(Json(serde_json::json!({ "success": true, "entity_id": entity_id, "action": service, "response": resp }))),
        Err(e) => Err(ErrorResponse::internal(format!("Media-Player-Steuerung fehlgeschlagen: {}", e))),
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
        None => Err(ErrorResponse::not_found(format!("Sensor {} nicht gefunden", entity_id))),
    }
}

/// Press a button entity
async fn press_button(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let service_data = serde_json::json!({ "entity_id": entity_id });
    match state.ha_client.call_service("button", "press", service_data, "").await {
        Ok(resp) => Ok(Json(serde_json::json!({ "success": true, "entity_id": entity_id, "response": resp }))),
        Err(e) => Err(ErrorResponse::internal(format!("Button-Auslösung fehlgeschlagen: {}", e))),
    }
}

/// Control a switch entity (on/off/toggle)
async fn control_switch(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("toggle");
    let service = match action {
        "on" | "turn_on" => "turn_on",
        "off" | "turn_off" => "turn_off",
        _ => "toggle",
    };
    let service_data = serde_json::json!({ "entity_id": entity_id });
    match state.ha_client.call_service("switch", service, service_data, "").await {
        Ok(resp) => Ok(Json(serde_json::json!({ "success": true, "entity_id": entity_id, "action": service, "response": resp }))),
        Err(e) => Err(ErrorResponse::internal(format!("Switch-Steuerung fehlgeschlagen: {}", e))),
    }
}

/// Admin: Get available HA calendars
async fn admin_ha_calendars(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
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
        Err(e) => Err(ErrorResponse::internal(format!("Kalender nicht verfügbar: {}", e))),
    }
}

/// Admin: Get calendar events for a specific calendar entity
async fn admin_ha_calendar_events(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ErrorResponse> {
    let now = chrono::Utc::now();
    let start = params.get("start")
        .cloned()
        .unwrap_or_else(|| now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());
    let end = params.get("end")
        .cloned()
        .unwrap_or_else(|| (now + chrono::Duration::days(7)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());

    match state.ha_client.get_calendar_events(&entity_id, &start, &end).await {
        Ok(data) => Ok(Json(serde_json::json!({
            "entity_id": entity_id,
            "events": data,
            "count": data.as_array().map(|a| a.len()).unwrap_or(0),
        }))),
        Err(e) => Err(ErrorResponse::internal(format!("Kalender-Events nicht verfügbar: {}", e))),
    }
}

/// Admin: Render a Jinja2 template in Home Assistant
async fn admin_ha_render_template(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let template = body.get("template")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("'template' field required"))?;

    match state.ha_client.render_template(template).await {
        Ok(result) => Ok(Json(serde_json::json!({
            "result": result,
            "template": template,
        }))),
        Err(e) => Err(ErrorResponse::internal(format!("Template-Rendering fehlgeschlagen: {}", e))),
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
        Err(e) => Err(ErrorResponse::internal(format!("Event konnte nicht gesendet werden: {}", e))),
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
        let domain = e.entity_id.split('.').next().unwrap_or("unknown").to_string();
        let is_unavailable = e.state == "unavailable" || e.state == "unknown";
        if is_unavailable { total_unavailable += 1; }

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

    let domain_summary: Vec<Value> = domains.iter()
        .map(|(domain, entities)| serde_json::json!({
            "domain": domain,
            "count": entities.len(),
        }))
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
        let device_class = e.attributes
            .get("device_class")
            .and_then(|v| v.as_str())
            .unwrap_or("other")
            .to_string();

        if let Some(area) = e.attributes.get("area_id").and_then(|v| v.as_str()) {
            by_area.entry(area.to_string()).or_default().push(e.entity_id.clone());
        }

        // Infer integration from domain
        let domain = e.entity_id.split('.').next().unwrap_or("unknown");
        *by_integration.entry(domain.to_string()).or_insert(0) += 1;

        devices.entry(device_class).or_default().push(serde_json::json!({
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
            areas.entry(area.to_string()).or_default().push(serde_json::json!({
                "entity_id": e.entity_id,
                "state": e.state,
                "friendly_name": e.attributes.get("friendly_name"),
                "domain": e.entity_id.split('.').next().unwrap_or("unknown"),
            }));
        }
    }

    let area_summary: Vec<Value> = areas.iter()
        .map(|(area, entities)| serde_json::json!({
            "area_id": area,
            "entity_count": entities.len(),
            "domains": entities.iter()
                .filter_map(|e| e.get("domain").and_then(|d| d.as_str()))
                .collect::<std::collections::HashSet<_>>(),
        }))
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
        "log_level": std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        "note": "Backend logs are written to stdout/stderr. Use 'docker logs' or journal to view them.",
        "tip": "Set RUST_LOG=debug for more detailed logging.",
    })))
}

/// Admin: Get database statistics
async fn admin_database_info(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    // PostgreSQL version
    let pg_version: String = sqlx::query_scalar("SELECT version()")
        .fetch_one(&state.db_pool).await.unwrap_or_else(|_| "unknown".to_string());

    // Database size
    let db_name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&state.db_pool).await.unwrap_or_else(|_| "iora".to_string());
    let db_size_bytes: i64 = sqlx::query_scalar(
        "SELECT pg_database_size(current_database())"
    ).fetch_one(&state.db_pool).await.unwrap_or(0);

    // Active connections
    let (active_connections,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()"
    ).fetch_one(&state.db_pool).await.unwrap_or((0,));

    // Max connections
    let max_conn: String = sqlx::query_scalar("SHOW max_connections")
        .fetch_one(&state.db_pool).await.unwrap_or_else(|_| "100".to_string());

    // Server uptime
    let pg_uptime: String = sqlx::query_scalar(
        "SELECT date_trunc('second', now() - pg_postmaster_start_time())::text FROM pg_postmaster_start_time()"
    ).fetch_one(&state.db_pool).await.unwrap_or_else(|_| "unknown".to_string());

    // Table row counts  
    let (user_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (history_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entity_history")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (api_key_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM api_keys")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (page_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM pages")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (widget_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM widgets")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (device_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM devices")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (webhook_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM webhooks")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (pref_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM system_preferences")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (notification_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM system_notifications")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (warning_log_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM warning_log")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));
    let (temp_user_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM temp_db_users WHERE expires_at > NOW()")
        .fetch_one(&state.db_pool).await.unwrap_or((0,));

    // Table sizes (top tables by estimated size)
    let table_sizes: Vec<(String, i64)> = sqlx::query_as(
        "SELECT relname::text, pg_total_relation_size(c.oid)::bigint \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relkind = 'r' \
         ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 20"
    ).fetch_all(&state.db_pool).await.unwrap_or_default();

    let table_sizes_json: Vec<Value> = table_sizes.into_iter().map(|(name, size)| {
        json!({ "name": name, "size_bytes": size, "size_mb": (size as f64 / 1_048_576.0 * 100.0).round() / 100.0 })
    }).collect();

    // Connection string info (redacted)
    let db_url = std::env::var("DATABASE_URL").unwrap_or_default();
    let db_host = db_url.split('@').last().and_then(|s| s.split('/').next()).unwrap_or("localhost").to_string();

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
         FROM temp_db_users ORDER BY created_at DESC"
    ).fetch_all(&state.db_pool).await.map_err(|e| {
        warn!("Failed to list temp users: {e}");
        ErrorResponse::internal("Fehler beim Laden der Temp-Benutzer")
    })?;

    let users: Vec<Value> = rows.into_iter().map(|(id, username, desc, perms, expires, revoked, last_used)| {
        json!({
            "id": id,
            "username": username,
            "description": desc,
            "permissions": perms,
            "expires_at": expires,
            "revoked": revoked,
            "last_used_at": last_used,
        })
    }).collect();

    Ok(Json(json!({ "users": users })))
}

/// Admin: create a temporary database user (max 1 month expiry)
async fn admin_create_temp_user(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ErrorResponse> {
    let username = body.get("username").and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Benutzername erforderlich"))?;
    let password = body.get("password").and_then(|v| v.as_str())
        .ok_or_else(|| ErrorResponse::bad_request("Passwort erforderlich"))?;
    let description = body.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let permissions = body.get("permissions").and_then(|v| v.as_str()).unwrap_or("readonly");
    let expires_in_days: i64 = body.get("expires_in_days").and_then(|v| v.as_i64()).unwrap_or(7);

    // Validate
    if username.len() < 3 || username.len() > 63 {
        return Err(ErrorResponse::bad_request("Benutzername muss 3-63 Zeichen haben"));
    }
    if !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(ErrorResponse::bad_request("Benutzername darf nur Buchstaben, Zahlen und _ enthalten"));
    }
    if password.len() < 8 {
        return Err(ErrorResponse::bad_request("Passwort muss mindestens 8 Zeichen haben"));
    }
    if expires_in_days < 1 || expires_in_days > 31 {
        return Err(ErrorResponse::bad_request("Ablauf muss zwischen 1 und 31 Tagen liegen"));
    }
    if permissions != "readonly" && permissions != "readwrite" {
        return Err(ErrorResponse::bad_request("Berechtigung muss 'readonly' oder 'readwrite' sein"));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let password_hash = auth::hash_password(password)
        .map_err(|e| { warn!("Hash failed: {e}"); ErrorResponse::internal("Passwort-Hashing fehlgeschlagen") })?;

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

    info!("Temp DB user created: {} (expires in {} days, {})", username, expires_in_days, permissions);
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
    let result = sqlx::query(
        "UPDATE temp_db_users SET revoked = TRUE, revoked_at = NOW() WHERE id = $1"
    )
    .bind(&user_id)
    .execute(&state.db_pool).await.map_err(|e| {
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
    let active = settings.get("maintenance_mode").and_then(|v| v.as_bool()).unwrap_or(false);
    let message = settings.get("maintenance_message")
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
    let active = settings.get("maintenance_mode").and_then(|v| v.as_bool()).unwrap_or(false);
    let message = settings.get("maintenance_message")
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

    let active = settings.get("maintenance_mode").and_then(|v| v.as_bool()).unwrap_or(false);
    let message = settings.get("maintenance_message")
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

    info!("Maintenance mode {}: {}", if active { "ENABLED" } else { "DISABLED" }, message);

    Json(serde_json::json!({
        "active": active,
        "message": message,
    }))
}

// ── Notification & Alert Handlers ────────────────────────────────────

/// Get all notifications (authenticated user) — from DB
async fn get_notifications(
    State(state): State<AppState>,
) -> Json<Vec<Value>> {
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
        .await {
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
        .await {
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
        title: body.get("title").and_then(|v| v.as_str()).unwrap_or("Notification").to_string(),
        message: body.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        level: body.get("level").and_then(|v| v.as_str()).unwrap_or("info").to_string(),
        source: body.get("source").and_then(|v| v.as_str()).unwrap_or("iora").to_string(),
        icon: body.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        entity_id: body.get("entity_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        auto_dismiss_secs: body.get("auto_dismiss_secs").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        channels: body.get("channels")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        extra_data: body.get("extra_data").cloned().unwrap_or(serde_json::Value::Null),
    };

    let (id, results) = state.notification_dispatcher.dispatch(req).await;
    let all_ok = results.iter().all(|r| r.status != "error");
    let status = if all_ok { StatusCode::OK } else { StatusCode::MULTI_STATUS };
    (status, Json(serde_json::json!({"id": id, "results": results})))
}

/// GET /api/notifications/channels — list all notification channels.
async fn notification_channels_list(
    State(state): State<AppState>,
) -> Json<Value> {
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
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "name required"}))).into_response(),
    };
    let channel_type = match body.get("channel_type").and_then(|v| v.as_str()) {
        Some(t) if matches!(t, "iora" | "ha_mobile" | "desktop") => t.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "channel_type must be one of: iora, ha_mobile, desktop"}))).into_response(),
    };
    let target_id = body.get("target_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let config = body.get("config").cloned().unwrap_or(serde_json::json!({}));

    match state.notification_dispatcher.create_channel(name, channel_type, target_id, config).await {
        Ok(ch) => (StatusCode::CREATED, Json(serde_json::json!({"channel": ch}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
    }
}

/// PUT /api/notifications/channels/:channel_id — update a notification channel.
async fn notification_channel_update(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let name = body.get("name").and_then(|v| v.as_str()).map(String::from);
    let target_id = body.get("target_id").and_then(|v| v.as_str()).map(String::from);
    let enabled = body.get("enabled").and_then(|v| v.as_bool());
    let config = body.get("config").cloned();

    match state.notification_dispatcher.update_channel(&channel_id, name, target_id, enabled, config).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
    }
}

/// DELETE /api/notifications/channels/:channel_id — delete a notification channel.
async fn notification_channel_delete(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
) -> StatusCode {
    match state.notification_dispatcher.delete_channel(&channel_id).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

/// Get all currently active warning entities (weather warnings, DWD, NINA, etc.)
async fn get_active_warnings(
    State(state): State<AppState>,
) -> Json<Value> {
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
async fn admin_list_notifications(
    State(state): State<AppState>,
) -> Json<Vec<Value>> {
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
async fn admin_clear_notifications(
    State(state): State<AppState>,
) -> StatusCode {
    let _ = sqlx::query("DELETE FROM notifications").execute(&state.db_pool).await;
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
        .await {
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
        .await {
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
async fn admin_set_alert(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let level = body.get("level").and_then(|v| v.as_str()).unwrap_or("warning");
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
async fn admin_dismiss_alert(
    State(state): State<AppState>,
) -> StatusCode {
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
    let limit = params.get("limit").and_then(|v| v.parse::<i64>().ok()).unwrap_or(100);
    let offset = params.get("offset").and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
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
            let total: (i64,) = sqlx::query_as(
                if active_only {
                    "SELECT COUNT(*) FROM warning_log WHERE ended_at IS NULL"
                } else {
                    "SELECT COUNT(*) FROM warning_log"
                }
            )
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
async fn admin_clear_warning_log(
    State(state): State<AppState>,
) -> StatusCode {
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
async fn get_nina_settings(
    State(state): State<AppState>,
) -> Json<Value> {
    let settings = match state.config_repo.get_system_preference("nina_settings").await {
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
    let enabled = body.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
    let ars_regions = body.get("ars_regions").cloned().unwrap_or(json!([]));
    let poll_interval = body.get("poll_interval_minutes").and_then(|v| v.as_u64()).unwrap_or(5);

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
            info!("[NINA] Settings updated: enabled={}, regions={}", enabled, ars_regions);
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
async fn get_nina_warnings(
) -> Json<Value> {
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

    let data: Vec<Value> = resp.json().await
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
        let raw_name = match entry.get("Kreisfreie Stadt, Kreis/Landkreis").and_then(|v| v.as_str()) {
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

    info!("[NINA] Parsed {} ARS regions ({} Bundesländer + {} Landkreise)", regions.len(), BUNDESLAENDER.len(), data.len());
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
async fn get_nina_regions(
    State(state): State<AppState>,
) -> Result<Json<Value>, StatusCode> {
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
    let level = body.get("level").and_then(|v| v.as_str()).unwrap_or("warning");
    let headline = body.get("headline").and_then(|v| v.as_str()).unwrap_or("Test-Warnung");
    let description = body.get("description").and_then(|v| v.as_str()).unwrap_or("Dies ist eine Testwarnung.");

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
        let region_name = region.get("name").and_then(|v| v.as_str()).unwrap_or(raw_ars);

        // Truncate to Kreis level: keep first 5 digits, pad with 0000000
        // NINA API only provides data at Kreis level (12 digits, last 7 = 0000000)
        let ars_code = if raw_ars.len() >= 5 {
            format!("{}0000000", &raw_ars[..5])
        } else {
            format!("{:0<12}", raw_ars)
        };

        let url = format!("{}/dashboard/{}.json", NINA_API_BASE, ars_code);

        match http.get(&url)
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

                            let headline = data.get("headline").and_then(|v| v.as_str())
                                .or_else(|| data.get("event").and_then(|v| v.as_str()))
                                .unwrap_or("Warnung");
                            let description = data.get("description").and_then(|v| v.as_str())
                                .or_else(|| data.get("instruction").and_then(|v| v.as_str()))
                                .unwrap_or("");
                            let severity = data.get("severity").and_then(|v| v.as_str())
                                .unwrap_or("Moderate");
                            let sender = data.get("sender").and_then(|v| v.as_str())
                                .unwrap_or("NINA");
                            let sent = data.get("sent").and_then(|v| v.as_str()).unwrap_or("");
                            let effective = data.get("effective").and_then(|v| v.as_str()).unwrap_or(sent);
                            let expires = data.get("expires").and_then(|v| v.as_str()).unwrap_or("");
                            let msg_type = item.get("msgType").and_then(|v| v.as_str())
                                .or_else(|| item.get("type").and_then(|v| v.as_str()))
                                .unwrap_or("Alert");
                            let category = data.get("category").and_then(|v| v.as_str()).unwrap_or("");

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
                        warn!("[NINA] Failed to parse response for ARS {}: {}", ars_code, e);
                    }
                }
            }
            Ok(resp) => {
                warn!("[NINA] API returned status {} for ARS {}", resp.status(), ars_code);
            }
            Err(e) => {
                warn!("[NINA] Failed to fetch ARS {}: {}", ars_code, e);
            }
        }
    }

    // Deduplicate by ID
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    all_warnings.retain(|w| {
        let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if id.is_empty() { return true; }
        seen_ids.insert(id)
    });

    // Compare with previous cache to detect new warnings
    let prev_ids: std::collections::HashSet<String> = {
        let cache = NINA_WARNINGS.read().await;
        cache.iter().filter_map(|w| w.get("id").and_then(|v| v.as_str()).map(String::from)).collect()
    };

    let new_warnings: Vec<&Value> = all_warnings.iter().filter(|w| {
        let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("");
        !id.is_empty() && !prev_ids.contains(id)
    }).collect();

    // Broadcast new warnings as notifications + log to DB
    for w in &new_warnings {
        let headline = w.get("headline").and_then(|v| v.as_str()).unwrap_or("NINA Warnung");
        let description = w.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let level = w.get("level").and_then(|v| v.as_str()).unwrap_or("warning");
        let sender = w.get("sender").and_then(|v| v.as_str()).unwrap_or("NINA");
        let region = w.get("region").and_then(|v| v.as_str()).unwrap_or("");
        let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("");

        info!("[NINA] New warning: [{}] {} ({})", level, headline, region);

        let desc_truncated: String = description.chars().take(400).collect();
        let desc_msg = if desc_truncated.len() < description.len() { format!("{}…", desc_truncated) } else { desc_truncated };

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
        let entity_id = format!("nina.{}", id.replace('.', "_").chars().take(80).collect::<String>());
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
    let current_ids: std::collections::HashSet<String> = all_warnings.iter()
        .filter_map(|w| w.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();

    for old_id in &prev_ids {
        if !current_ids.contains(old_id) {
            let entity_id = format!("nina.{}", old_id.replace('.', "_").chars().take(80).collect::<String>());
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
    let _ = sqlx::query("DELETE FROM nina_warning_cache").execute(db_pool).await;
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
        "SELECT id, warning_json, expires_at FROM nina_warning_cache"
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
                let entity_id = format!("nina.{}", eid.replace('.', "_").chars().take(80).collect::<String>());
                let _ = sqlx::query("UPDATE warning_log SET ended_at = NOW() WHERE entity_id = $1 AND ended_at IS NULL")
                    .bind(&entity_id)
                    .execute(&db_pool)
                    .await;
            }

            if !restored.is_empty() {
                info!("[NINA] Restored {} cached warnings from DB ({} expired)", restored.len(), expired_ids.len());
                // Broadcast restored warnings to any early-connected clients
                for w in &restored {
                    let id = w.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let headline = w.get("headline").and_then(|v| v.as_str()).unwrap_or("NINA Warnung");
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
                info!("[NINA] All {} cached warnings were expired, cleared", expired_ids.len());
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
        let (enabled, regions, interval_min) = match config_repo.get_system_preference("nina_settings").await {
            Ok(Some(pref)) => {
                let v = serde_json::from_str::<Value>(&pref.preference_value).unwrap_or_default();
                let enabled = v.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
                let regions = v.get("ars_regions").cloned().unwrap_or(json!([]));
                let interval = v.get("poll_interval_minutes").and_then(|v| v.as_u64()).unwrap_or(5);
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
    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let url = body.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if name.is_empty() || url.is_empty() {
        return Err(ErrorResponse::bad_request("name and url are required"));
    }
    // Validate URL format
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(ErrorResponse::bad_request("url must start with http:// or https://"));
    }
    let secret = body.get("secret").and_then(|v| v.as_str()).unwrap_or("").to_string();
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

    Ok(Json(json!({ "id": id, "name": name, "url": url, "events": events, "active": true })))
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

    let webhooks: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.0, "name": r.1, "url": r.2,
        "events": serde_json::from_str::<Value>(&r.3).unwrap_or(json!(["*"])),
        "headers": serde_json::from_str::<Value>(&r.4).unwrap_or(json!({})),
        "active": r.5, "created_at": r.6, "updated_at": r.7,
        "last_triggered_at": r.8, "trigger_count": r.9, "consecutive_failures": r.10,
    })).collect();

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
    let exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM webhooks WHERE id = $1 AND user_id = $2")
        .bind(&webhook_id).bind(user_id)
        .fetch_optional(&state.db_pool).await
        .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;
    if exists.is_none() {
        return Err(ErrorResponse::not_found("Webhook not found"));
    }

    if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
        sqlx::query("UPDATE webhooks SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name).bind(&webhook_id).execute(&state.db_pool).await.ok();
    }
    if let Some(url) = body.get("url").and_then(|v| v.as_str()) {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(ErrorResponse::bad_request("url must start with http:// or https://"));
        }
        sqlx::query("UPDATE webhooks SET url = $1, updated_at = NOW() WHERE id = $2")
            .bind(url).bind(&webhook_id).execute(&state.db_pool).await.ok();
    }
    if let Some(secret) = body.get("secret").and_then(|v| v.as_str()) {
        sqlx::query("UPDATE webhooks SET secret = $1, updated_at = NOW() WHERE id = $2")
            .bind(secret).bind(&webhook_id).execute(&state.db_pool).await.ok();
    }
    if let Some(events) = body.get("events") {
        sqlx::query("UPDATE webhooks SET events = $1, updated_at = NOW() WHERE id = $2")
            .bind(events.to_string()).bind(&webhook_id).execute(&state.db_pool).await.ok();
    }
    if let Some(headers) = body.get("headers") {
        sqlx::query("UPDATE webhooks SET headers = $1, updated_at = NOW() WHERE id = $2")
            .bind(headers.to_string()).bind(&webhook_id).execute(&state.db_pool).await.ok();
    }
    if let Some(active) = body.get("active").and_then(|v| v.as_bool()) {
        sqlx::query("UPDATE webhooks SET active = $1, updated_at = NOW() WHERE id = $2")
            .bind(active).bind(&webhook_id).execute(&state.db_pool).await.ok();
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
        .bind(&webhook_id).bind(user_id)
        .execute(&state.db_pool).await
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
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT url, secret, headers FROM webhooks WHERE id = $1 AND user_id = $2"
    )
    .bind(&webhook_id).bind(user_id)
    .fetch_optional(&state.db_pool).await
    .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let (url, secret, headers_json) = row.ok_or_else(|| ErrorResponse::not_found("Webhook not found"))?;

    let test_payload = json!({
        "event": "webhook.test",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": { "message": "This is a test webhook delivery" }
    });

    let result = deliver_webhook_payload(&state.http_client, &url, &secret, &headers_json, &test_payload).await;

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
    let exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM webhooks WHERE id = $1 AND user_id = $2")
        .bind(&webhook_id).bind(user_id)
        .fetch_optional(&state.db_pool).await
        .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;
    if exists.is_none() {
        return Err(ErrorResponse::not_found("Webhook not found"));
    }

    let limit: i64 = params.get("limit").and_then(|v| v.parse().ok()).unwrap_or(50).min(200);
    let rows: Vec<(i64, String, String, Option<i32>, Option<String>, Option<i64>, i32, bool, Option<String>, String)> =
        sqlx::query_as(
            "SELECT id, event_type, payload, status_code, response_body, duration_ms, attempt, success, error, created_at FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT $2"
        )
        .bind(&webhook_id).bind(limit)
        .fetch_all(&state.db_pool).await
        .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let deliveries: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.0, "event_type": r.1,
        "payload": serde_json::from_str::<Value>(&r.2).unwrap_or(json!(null)),
        "status_code": r.3, "response_body": r.4, "duration_ms": r.5,
        "attempt": r.6, "success": r.7, "error": r.8, "created_at": r.9,
    })).collect();

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

    let webhooks: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.0, "user_id": r.1, "name": r.2, "url": r.3,
        "events": serde_json::from_str::<Value>(&r.4).unwrap_or(json!(["*"])),
        "active": r.5, "created_at": r.6,
        "last_triggered_at": r.7, "trigger_count": r.8, "consecutive_failures": r.9,
    })).collect();

    Ok(Json(json!({ "webhooks": webhooks })))
}

// ── IORA Control Center handlers ─────────────────────────────────────────────

/// Fetch service health overview from all IORA subsystems
async fn admin_control_services(
    State(state): State<AppState>,
) -> Json<Value> {
    let client = &state.http_client;
    let services = vec![
        ("iora-home", "http://localhost:3001".to_string(), "Dashboard Backend, API, Auth, Streaming"),
        ("iora-core", format!("http://localhost:{}", std::env::var("CORE_PORT").unwrap_or_else(|_| "8090".to_string())), "Service Registry, Tasks, Plugins"),
        ("iora-control", "http://localhost:8091".to_string(), "Dashboard Aggregation, System Monitor"),
        ("iora-assist", "http://localhost:8092".to_string(), "AI Chat, Automation Suggestions"),
        ("iora-secrets", format!("http://localhost:{}", std::env::var("SECRETS_PORT").unwrap_or_else(|_| "8093".to_string())), "Secret & Credential Management"),
        ("iora-watchdog", format!("http://localhost:{}", std::env::var("WATCHDOG_PORT").unwrap_or_else(|_| "8094".to_string())), "Service Monitoring & Alerting"),
        ("iora-security", format!("http://localhost:{}", std::env::var("SECURITY_PORT").unwrap_or_else(|_| "8095".to_string())), "Security Monitoring, Audit Logging"),
        ("iora-gateway", format!("http://localhost:{}", std::env::var("GATEWAY_PORT").unwrap_or_else(|_| "8096".to_string())), "API Gateway, External Integrations"),
    ];

    let mut results = Vec::new();
    for (name, url, description) in &services {
        let health_url = format!("{}/health", url);
        let (status, uptime, details) = match client.get(&health_url)
            .timeout(std::time::Duration::from_secs(3))
            .send().await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: Value = resp.json().await.unwrap_or(json!({}));
                let uptime = body.get("uptime_seconds").and_then(|v| v.as_u64()).unwrap_or(0);
                ("online", uptime, body)
            }
            Ok(resp) => ("degraded", 0u64, json!({ "http_status": resp.status().as_u16() })),
            Err(_) => ("offline", 0u64, json!({})),
        };
        results.push(json!({
            "name": name,
            "url": url,
            "description": description,
            "status": status,
            "uptime_seconds": uptime,
            "details": details,
        }));
    }

    Json(json!({ "services": results, "timestamp": chrono::Utc::now().to_rfc3339() }))
}

/// List background tasks from iora-core
async fn admin_control_tasks(
    State(_state): State<AppState>,
) -> Json<Value> {
    let tasks: Vec<Value> = TASK_REGISTRY.iter().enumerate()
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
            return Json(json!({ "message": "task triggered", "id": idx, "name": TASK_REGISTRY[idx].name }));
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
    Err(ErrorResponse::bad_request(format!("task '{}' not found", task_id)))
}

/// Persistent control mode stored in system_preferences
static CONTROL_MODE_KEY: &str = "iora_control_mode";

/// Get current control mode (autonomous/manual)
async fn admin_control_get_mode(
    State(state): State<AppState>,
) -> Result<Json<Value>, ErrorResponse> {
    let pref: Option<(String,)> = sqlx::query_as(
        "SELECT preference_value FROM system_preferences WHERE preference_key = $1"
    )
    .bind(CONTROL_MODE_KEY)
    .fetch_optional(&state.db_pool).await
    .map_err(|e| ErrorResponse::internal(format!("DB error: {}", e)))?;

    let mode = pref.map(|p| p.0).unwrap_or_else(|| "autonomous".to_string());
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
    let mode = body.get("mode").and_then(|v| v.as_str()).unwrap_or("autonomous");
    if !["autonomous", "manual", "supervised"].contains(&mode) {
        return Err(ErrorResponse::bad_request("Invalid mode. Use: autonomous, manual, supervised"));
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
    let _ = state.ws_manager.broadcast_json(&json!({
        "type": "control_mode_changed",
        "mode": mode,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    })).await;

    Ok(Json(json!({ "mode": mode, "message": "Betriebsmodus aktualisiert" })))
}

/// Full control center overview (aggregated)
async fn admin_control_overview(
    State(state): State<AppState>,
) -> Json<Value> {
    // Get control mode
    let mode: String = sqlx::query_as::<_, (String,)>(
        "SELECT preference_value FROM system_preferences WHERE preference_key = $1"
    )
    .bind(CONTROL_MODE_KEY)
    .fetch_optional(&state.db_pool).await
    .ok().flatten()
    .map(|p| p.0)
    .unwrap_or_else(|| "\"autonomous\"".to_string());
    let mode_val: Value = serde_json::from_str(&mode).unwrap_or(json!("autonomous"));

    // Get active watchdogs count
    let watchdog_count = ENTITY_WATCHDOGS.read().await.len();

    // Get active schedules count
    let schedule_count = SCHEDULED_ACTIONS.read().await.len();

    // Get maintenance mode
    let maintenance: Option<(String,)> = sqlx::query_as(
        "SELECT preference_value FROM system_preferences WHERE preference_key = 'maintenance_mode'"
    )
    .fetch_optional(&state.db_pool).await.ok().flatten();
    let is_maintenance = maintenance.map(|m| m.0 == "true").unwrap_or(false);

    Json(json!({
        "mode": mode_val,
        "maintenance": is_maintenance,
        "active_watchdogs": watchdog_count,
        "active_schedules": schedule_count,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

// ─── IORA Log & Metrics Endpoints ──────────────────────────────────────

/// GET /api/admin/logs — Fetch log entries from the ring buffer
async fn admin_get_logs(
    Query(params): Query<HashMap<String, String>>,
) -> Json<Value> {
    let level_filter = params.get("level").map(|s| s.as_str());
    let target_filter = params.get("target").map(|s| s.as_str());
    let search = params.get("search").map(|s| s.to_lowercase());
    let limit: usize = params.get("limit").and_then(|s| s.parse().ok()).unwrap_or(500);
    let since_id: u64 = params.get("since_id").and_then(|s| s.parse().ok()).unwrap_or(0);

    let entries: Vec<Value> = if let Ok(buf) = LOG_BUFFER.read() {
        buf.iter()
            .filter(|e| {
                if e.id <= since_id { return false; }
                if let Some(lf) = level_filter {
                    if e.level != lf { return false; }
                }
                if let Some(tf) = target_filter {
                    if !e.target.contains(tf) { return false; }
                }
                if let Some(ref s) = search {
                    if !e.message.to_lowercase().contains(s) && !e.target.to_lowercase().contains(s) {
                        return false;
                    }
                }
                true
            })
            .rev()
            .take(limit)
            .map(|e| json!({
                "id": e.id,
                "timestamp": e.timestamp,
                "level": e.level,
                "target": e.target,
                "message": e.message,
                "fields": e.fields,
            }))
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
async fn admin_get_metrics(
    State(state): State<AppState>,
) -> Json<Value> {
    let mut snapshot = collect_metrics_snapshot();
    // Enrich with live data from state
    if let Some(obj) = snapshot.as_object_mut() {
        let entity_count = state.entity_cache.count().await;
        let connected_clients = state.ws_manager.client_count().await;
        let entity_metrics = state.entity_cache.metrics();
        obj.insert("live".to_string(), json!({
            "entity_count": entity_count,
            "connected_clients": connected_clients,
            "ha_connected": state.entity_cache.is_ha_connected(),
            "entity_updates_total": entity_metrics.update_count,
            "entity_cache_hits": entity_metrics.cache_hits,
        }));
        // Task breakdown from registry
        let task_summary: Vec<Value> = TASK_REGISTRY.iter().enumerate()
            .map(|(i, t)| json!({
                "id": i,
                "name": t.name,
                "runs": t.run_count.load(Ordering::Relaxed),
                "errors": t.error_count.load(Ordering::Relaxed),
                "enabled": t.enabled.load(Ordering::Relaxed),
            }))
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

    let mut req = client.post(url)
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
) {
    let mut rx = ws_manager.subscribe();
    loop {
        match rx.recv().await {
            Ok(changed_entities) => {
                task_entry(11).record_run();
                // Load active webhooks
                let webhooks: Vec<(String, String, String, String, String)> = match sqlx::query_as(
                    "SELECT id, url, secret, events, headers FROM webhooks WHERE active = 1"
                ).fetch_all(&db_pool).await {
                    Ok(rows) => rows,
                    Err(_) => continue,
                };

                if webhooks.is_empty() { continue; }

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
                        let events: Vec<String> = serde_json::from_str(events_json).unwrap_or_default();
                        let matches = events.iter().any(|e| {
                            e == "*" || e == "state_changed" || e == &event_type
                                || e == &format!("domain.{}", domain)
                                || e == &entity.entity_id
                        });
                        if !matches { continue; }

                        let client = http_client.clone();
                        let url = url.clone();
                        let secret = secret.clone();
                        let headers = headers_json.clone();
                        let payload = payload.clone();
                        let wh_id = wh_id.clone();
                        let pool = db_pool.clone();

                        // Fire-and-forget delivery with retry
                        tokio::spawn(async move {
                            let result = deliver_webhook_payload(&client, &url, &secret, &headers, &payload).await;

                            // Log delivery
                            sqlx::query(
                                "INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status_code, response_body, duration_ms, success, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
                            )
                            .bind(&wh_id).bind("state_changed").bind(payload.to_string())
                            .bind(result.status_code).bind(&result.response_body)
                            .bind(result.duration_ms).bind(result.success).bind(&result.error)
                            .execute(&pool).await.ok();

                            // Update webhook stats
                            if result.success {
                                sqlx::query("UPDATE webhooks SET last_triggered_at = NOW(), trigger_count = trigger_count + 1, consecutive_failures = 0 WHERE id = $1")
                                    .bind(&wh_id).execute(&pool).await.ok();
                            } else {
                                let _: Option<(i64,)> = sqlx::query_as("SELECT consecutive_failures FROM webhooks WHERE id = $1")
                                    .bind(&wh_id).fetch_optional(&pool).await.ok().flatten();
                                sqlx::query("UPDATE webhooks SET consecutive_failures = consecutive_failures + 1 WHERE id = $1")
                                    .bind(&wh_id).execute(&pool).await.ok();
                                // Auto-disable after 10 consecutive failures
                                sqlx::query("UPDATE webhooks SET active = false WHERE id = $1 AND consecutive_failures >= 10")
                                    .bind(&wh_id).execute(&pool).await.ok();
                            }
                        });
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!("Webhook delivery lagged by {} messages", n);
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
    let domain_filter: Vec<String> = params.get("domains")
        .map(|d| d.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();
    let entity_filter: Vec<String> = params.get("entity_ids")
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

async fn handle_realtime_socket(
    socket: axum::extract::ws::WebSocket,
    state: AppState,
) {
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
        let _ = s.send(Message::Text(json!({
            "event": "connected",
            "data": {
                "namespaces": ["entities", "system", "notifications"],
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "version": env!("CARGO_PKG_VERSION"),
            }
        }).to_string())).await;
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
                        let filtered: Vec<&EntityState> = changed.iter().filter(|e| {
                            if !filter.domains.is_empty() {
                                let d = e.entity_id.split('.').next().unwrap_or("");
                                if !filter.domains.contains(&d.to_string()) { return false; }
                            }
                            if !filter.entity_ids.is_empty() {
                                if !filter.entity_ids.contains(&e.entity_id) { return false; }
                            }
                            true
                        }).collect();
                        if !filtered.is_empty() {
                            let msg = json!({
                                "namespace": "entities",
                                "event": "state_changed",
                                "data": filtered,
                                "timestamp": chrono::Utc::now().to_rfc3339(),
                            });
                            let mut s = entity_sender.lock().await;
                            METRICS.ws_messages_sent.fetch_add(1, Ordering::Relaxed);
                            if s.send(Message::Text(msg.to_string())).await.is_err() { break; }
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
                    if !*notif_sub_r.read().await { continue; }
                    let msg = json!({ "namespace": "notifications", "event": "config_changed", "data": changes });
                    let mut s = notif_sender.lock().await;
                    if s.send(Message::Text(msg.to_string())).await.is_err() { break; }
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
                let ns = parsed.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
                let event = parsed.get("event").and_then(|v| v.as_str()).unwrap_or("");
                let data = parsed.get("data").cloned().unwrap_or(json!(null));

                match (ns, event) {
                    ("entities", "subscribe") => {
                        let domains: Vec<String> = data.get("domains")
                            .and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                            .unwrap_or_default();
                        let entity_ids: Vec<String> = data.get("entity_ids")
                            .and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                            .unwrap_or_default();
                        *entity_subs.write().await = Some(EntitySubFilter { domains, entity_ids });
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(json!({
                            "namespace": "entities", "event": "subscribed",
                            "data": { "status": "ok" }
                        }).to_string())).await;
                    }
                    ("entities", "unsubscribe") => {
                        *entity_subs.write().await = None;
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(json!({
                            "namespace": "entities", "event": "unsubscribed",
                            "data": { "status": "ok" }
                        }).to_string())).await;
                    }
                    ("system", "subscribe") => {
                        *system_sub.write().await = true;
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(json!({
                            "namespace": "system", "event": "subscribed",
                            "data": { "status": "ok" }
                        }).to_string())).await;
                    }
                    ("system", "unsubscribe") => {
                        *system_sub.write().await = false;
                    }
                    ("notifications", "subscribe") => {
                        *notif_sub.write().await = true;
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(json!({
                            "namespace": "notifications", "event": "subscribed",
                            "data": { "status": "ok" }
                        }).to_string())).await;
                    }
                    ("notifications", "unsubscribe") => {
                        *notif_sub.write().await = false;
                    }
                    (_, "ping") => {
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(json!({"event": "pong"}).to_string())).await;
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

fn default_limit() -> i64 { 5000 }

/// Get location history points from our own database (long-term storage)
async fn get_location_history(
    State(state): State<AppState>,
    Path(entity_id): Path<String>,
    Query(query): Query<LocationHistoryQuery>,
) -> Result<Json<Value>, ErrorResponse> {
    let start = query.start.unwrap_or_else(|| {
        (chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339()
    });
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

    let points: Vec<Value> = rows.into_iter().map(|(lat, lng, acc, state, source, time)| {
        json!({
            "latitude": lat,
            "longitude": lng,
            "gps_accuracy": acc,
            "state": state,
            "source": source,
            "recorded_at": time,
        })
    }).collect();

    // Also return the HA-compatible format for backwards compatibility
    let ha_compat: Vec<Value> = points.iter().map(|p| {
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
    }).collect();

    Ok(Json(json!({
        "entity_id": entity_id,
        "points": points,
        "ha_compatible": [ha_compat],
        "count": points.len(),
    })))
}

/// Get sync status for all tracked entities
async fn get_location_sync_status(
    State(state): State<AppState>,
) -> Json<Vec<Value>> {
    match sqlx::query_as::<_, (String, String, Option<String>, Option<String>, Option<String>, i32, String, Option<String>, String)>(
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
    .await {
        Ok(rows) => {
            let statuses: Vec<Value> = rows.into_iter().map(|r| json!({
                "entity_id": r.0,
                "friendly_name": r.1,
                "last_sync_at": r.2,
                "oldest_data_at": r.3,
                "newest_data_at": r.4,
                "total_points": r.5,
                "sync_state": r.6,
                "last_error": r.7,
                "updated_at": r.8,
            })).collect();
            Json(statuses)
        }
        Err(e) => {
            warn!("Failed to get sync status: {}", e);
            Json(vec![])
        }
    }
}

/// Admin: get detailed sync status
async fn admin_get_sync_status(
    State(state): State<AppState>,
) -> Json<Value> {
    let statuses = get_location_sync_status(State(state.clone())).await.0;

    let total_points: i64 = sqlx::query_as("SELECT COALESCE(COUNT(*), 0) FROM location_history_points")
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

    match sqlx::query_as::<_, (String, String, String, String, String, Option<serde_json::Value>, String, bool, Option<String>, Option<String>, bool, Option<String>, String)>(base)
        .bind(has_category)
        .bind(&category_val)
        .bind(show_resolved)
        .fetch_all(&state.db_pool)
        .await {
        Ok(rows) => {
            let notifs: Vec<Value> = rows.into_iter().map(|r| json!({
                "id": r.0, "category": r.1, "severity": r.2, "title": r.3,
                "message": r.4, "details": r.5, "source": r.6,
                "acknowledged": r.7, "acknowledged_by": r.8, "acknowledged_at": r.9,
                "resolved": r.10, "resolved_at": r.11, "created_at": r.12,
            })).collect();
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
        "UPDATE admin_system_notifications SET resolved = true, resolved_at = NOW() WHERE id = $1"
    )
    .bind(&notif_id)
    .execute(&state.db_pool)
    .await {
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
        .await {
        Ok(r) if r.rows_affected() > 0 => StatusCode::OK,
        _ => StatusCode::NOT_FOUND,
    }
}

/// Admin: clear all resolved system notifications
async fn admin_clear_resolved_system_notifications(
    State(state): State<AppState>,
) -> StatusCode {
    let _ = sqlx::query("DELETE FROM admin_system_notifications WHERE resolved = true")
        .execute(&state.db_pool)
        .await;
    StatusCode::OK
}

// ═══════════════════════════════════════════════════════════════════════
// OpenAPI Documentation Stubs
// These are not called at runtime – utoipa reads the #[utoipa::path]
// macros to generate the Swagger specification.
// ═══════════════════════════════════════════════════════════════════════

/// Health check
///
/// Returns system health status including HA connection, entity count, and connected clients.
#[utoipa::path(get, path = "/health", tag = "health",
    responses((status = 200, description = "Health status", body = Value))
)]
async fn api_doc_health() {}

/// Register new user
///
/// Create a new user account. Returns JWT token and user data.
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
#[utoipa::path(get, path = "/api/auth/users", tag = "auth",
    responses((status = 200, description = "User list", body = Vec<Value>))
)]
async fn api_doc_auth_users() {}

/// Set login PIN
///
/// Set or update the login PIN for the authenticated user.
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
#[utoipa::path(get, path = "/api/states", tag = "entities",
    responses((status = 200, description = "Array of entity states", body = Vec<Value>))
)]
async fn api_doc_get_states() {}

/// Get single entity state
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
#[utoipa::path(get, path = "/api/history/period/{start_time}", tag = "history",
    params(("start_time" = String, Path, description = "ISO 8601 start time")),
    responses((status = 200, description = "History data", body = Value))
)]
async fn api_doc_get_history() {}

/// Upload background image
///
/// Upload a background image (jpg, png, webp, gif). Max recommended size: 10MB.
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
#[utoipa::path(get, path = "/api/entities/domain/{domain}", tag = "entities",
    params(("domain" = String, Path, description = "Entity domain")),
    responses((status = 200, description = "Filtered entity list", body = Vec<Value>))
)]
async fn api_doc_get_entities_by_domain() {}

/// Search entities
///
/// Search entities by name or entity_id substring.
#[utoipa::path(get, path = "/api/entities/search", tag = "entities",
    params(("q" = String, Query, description = "Search query")),
    responses((status = 200, description = "Matching entities", body = Vec<Value>))
)]
async fn api_doc_search_entities() {}

/// System statistics
///
/// Returns CPU usage, memory, uptime, database size, entity count, cache metrics, and HA connection status.
#[utoipa::path(get, path = "/api/system/stats", tag = "system",
    responses((status = 200, description = "System stats", body = Value))
)]
async fn api_doc_system_stats() {}

/// Home Assistant info
///
/// Returns HA connection status, entity count, domain breakdown, and version information.
#[utoipa::path(get, path = "/api/system/ha-info", tag = "system",
    responses((status = 200, description = "HA info", body = Value))
)]
async fn api_doc_ha_info() {}

/// Create user
#[utoipa::path(post, path = "/api/config/users", tag = "config",
    request_body(content = Value, description = "{ username, password, display_name? }"),
    responses((status = 200, description = "User created", body = Value))
)]
async fn api_doc_create_user() {}

/// Get user by username
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
#[utoipa::path(post, path = "/api/config/devices", tag = "config",
    request_body(content = Value, description = "{ device_name, device_type?, user_agent? }"),
    responses((status = 200, description = "Device registered", body = Value))
)]
async fn api_doc_register_device() {}

/// Create configuration profile
#[utoipa::path(post, path = "/api/config/profiles", tag = "config",
    request_body(content = Value, description = "{ name, profile_type, owner_id }"),
    responses((status = 200, description = "Profile created", body = Value))
)]
async fn api_doc_create_profile() {}

/// Get profile data
///
/// Returns full profile with pages, theme, and background configuration.
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
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/pages", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ pages: DashboardPage[] }"),
    responses((status = 200, description = "Pages saved"))
)]
async fn api_doc_save_pages() {}

/// Save theme settings
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/theme", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ sleep_mode, auto_theme, selected_theme$1 }"),
    responses((status = 200, description = "Theme saved"))
)]
async fn api_doc_save_theme() {}

/// Save background configuration
///
/// Save global background config (static image, slideshow, video, or gradient).
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/background", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ background_type, config, is_active }"),
    responses((status = 200, description = "Background saved"))
)]
async fn api_doc_save_background() {}

/// Get page layouts
///
/// Returns all page grid layouts (cols, rows, gap) for a profile.
#[utoipa::path(get, path = "/api/config/profiles/{profile_id}/layouts", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    responses((status = 200, description = "Page layouts", body = Vec<Value>))
)]
async fn api_doc_get_page_layouts() {}

/// Save page layout
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/layouts", tag = "config",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ page_id, cols, rows, gap }"),
    responses((status = 200, description = "Layout saved", body = Value))
)]
async fn api_doc_save_page_layout() {}

/// Get all page settings
///
/// Returns per-page settings (card style, background override, custom CSS, padding) for all pages in a profile.
#[utoipa::path(get, path = "/api/config/profiles/{profile_id}/page-settings", tag = "page-settings",
    params(("profile_id" = String, Path, description = "Profile ID")),
    responses((status = 200, description = "Array of page settings", body = Vec<Value>))
)]
async fn api_doc_get_page_settings() {}

/// Save page settings
///
/// Create or update settings for a specific page. Supports card_style, per-page background override, custom_css, hide_header, and padding.
#[utoipa::path(post, path = "/api/config/profiles/{profile_id}/page-settings", tag = "page-settings",
    params(("profile_id" = String, Path, description = "Profile ID")),
    request_body(content = Value, description = "{ page_id, card_style?, background_type?, background_config?, custom_css?, hide_header?, padding? }"),
    responses((status = 200, description = "Page settings saved", body = Value))
)]
async fn api_doc_save_page_settings() {}

/// Delete page settings
///
/// Remove per-page settings, reverting to global defaults.
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
#[utoipa::path(post, path = "/api/config/preferences/{user_id}", tag = "config",
    params(("user_id" = String, Path, description = "User ID")),
    request_body(content = Value, description = "{ key, value, device_id? }"),
    responses((status = 200, description = "Preference saved"))
)]
async fn api_doc_save_preference() {}

/// Get user preferences
///
/// Returns all preferences for a user as key-value pairs.
#[utoipa::path(get, path = "/api/config/preferences/{user_id}", tag = "config",
    params(("user_id" = String, Path, description = "User ID")),
    responses((status = 200, description = "Preferences map", body = Value))
)]
async fn api_doc_get_preferences() {}

/// Dashboard status
///
/// Returns dashboard status and diagnostics for the HA custom integration.
#[utoipa::path(get, path = "/api/integration/status", tag = "integration",
    responses((status = 200, description = "Dashboard status with entity counts, connection info", body = Value))
)]
async fn api_doc_integration_status() {}

/// Send command
///
/// Send commands from the HA integration (refresh_entities, set_theme, navigate, etc.).
#[utoipa::path(post, path = "/api/integration/command", tag = "integration",
    request_body(content = Value, description = "{ command, ...params }"),
    responses((status = 200, description = "Command executed"))
)]
async fn api_doc_integration_command() {}

/// Get dashboard settings
///
/// Returns current dashboard settings (screensaver, auto_theme, brightness, etc.).
#[utoipa::path(get, path = "/api/integration/settings", tag = "integration",
    responses((status = 200, description = "Dashboard settings", body = Value))
)]
async fn api_doc_integration_get_settings() {}

/// Update dashboard settings
///
/// Update dashboard settings from the HA integration.
#[utoipa::path(post, path = "/api/integration/settings", tag = "integration",
    request_body(content = Value, description = "Settings to update"),
    responses((status = 200, description = "Settings updated"))
)]
async fn api_doc_integration_set_settings() {}

// ── API Key doc stubs ──────────────────────────────────────────────

/// List my API keys
///
/// Returns all API keys for the authenticated user.
#[utoipa::path(get, path = "/api/keys", tag = "api-keys",
    security(("bearer" = [])),
    responses((status = 200, description = "API keys list", body = Vec<Value>))
)]
async fn api_doc_list_api_keys() {}

/// Create API key
///
/// Generate a new API key for programmatic access. The raw key is only returned once.
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
#[utoipa::path(get, path = "/api/admin/users", tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, description = "All users with admin info"))
)]
async fn api_doc_admin_list_users() {}

/// Admin: Set user admin status
///
/// Promote or demote a user to/from admin role.
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
#[utoipa::path(get, path = "/api/admin/api-keys", tag = "admin",
    security(("bearer" = [])),
    responses((status = 200, description = "All API keys"))
)]
async fn api_doc_admin_list_all_api_keys() {}

/// Admin: HA Configuration
///
/// Returns Home Assistant core configuration (location, units, version, etc.).
#[utoipa::path(get, path = "/api/admin/ha/config", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA configuration"))
)]
async fn api_doc_admin_ha_config() {}

/// Admin: HA Integrations
///
/// Returns all loaded HA components/integrations and entity domain breakdown.
#[utoipa::path(get, path = "/api/admin/ha/integrations", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA integrations and components"))
)]
async fn api_doc_admin_ha_integrations() {}

/// Admin: HA Devices
///
/// Returns all HA devices grouped by device class.
#[utoipa::path(get, path = "/api/admin/ha/devices", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA devices"))
)]
async fn api_doc_admin_ha_devices() {}

/// Admin: HA Automations
///
/// Returns all automation entities with their status and last triggered time.
#[utoipa::path(get, path = "/api/admin/ha/automations", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA automations"))
)]
async fn api_doc_admin_ha_automations() {}

/// Admin: HA Services
///
/// Returns all available HA services organized by domain.
#[utoipa::path(get, path = "/api/admin/ha/services", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA services"))
)]
async fn api_doc_admin_ha_services() {}

/// Admin: HA Logs
///
/// Returns recent Home Assistant error log entries.
#[utoipa::path(get, path = "/api/admin/ha/logs", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA error logs"))
)]
async fn api_doc_admin_ha_logs() {}

/// Admin: MQTT Status
///
/// Returns MQTT-related entities, broker status, and device information.
#[utoipa::path(get, path = "/api/admin/ha/mqtt", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "MQTT information"))
)]
async fn api_doc_admin_ha_mqtt() {}

/// Admin: Matter Status
///
/// Returns Matter-related entities and fabric information.
#[utoipa::path(get, path = "/api/admin/ha/matter", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "Matter information"))
)]
async fn api_doc_admin_ha_matter() {}

/// Admin: HA Add-ons
///
/// Returns installed add-ons (Supervisor) or update entities as fallback.
#[utoipa::path(get, path = "/api/admin/ha/addons", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "HA add-ons"))
)]
async fn api_doc_admin_ha_addons() {}

/// Admin: HA Supervisor
///
/// Returns Supervisor system information (only available on HA OS / Supervised).
#[utoipa::path(get, path = "/api/admin/ha/supervisor", tag = "admin-ha",
    security(("bearer" = [])),
    responses((status = 200, description = "Supervisor info"))
)]
async fn api_doc_admin_ha_supervisor() {}

/// Admin: Database Info
///
/// Returns database size and table row counts.
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
#[utoipa::path(get, path = "/api/time", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    responses((status = 200, description = "Current time info", body = Value))
)]
async fn api_doc_get_current_time() {}

/// List all lights
///
/// Returns all light entities with their state, brightness, color mode, and attributes.
#[utoipa::path(get, path = "/api/lights", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    responses((status = 200, description = "Array of light entities", body = Value))
)]
async fn api_doc_get_all_lights() {}

/// Control a light
///
/// Turn on/off/toggle a light entity with optional brightness, color temperature, RGB color, and transition.
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
#[utoipa::path(get, path = "/api/media_players", tag = "convenience",
    security(("bearer" = []), ("api_key" = [])),
    responses((status = 200, description = "Array of media player entities", body = Value))
)]
async fn api_doc_get_all_media_players() {}

/// Control a media player
///
/// Control playback, volume, and mute for a media player entity.
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
#[utoipa::path(get, path = "/ws/realtime", tag = "realtime",
    responses(
        (status = 101, description = "WebSocket upgrade – namespace-based realtime connection")
    )
)]
async fn api_doc_realtime_ws() {}
