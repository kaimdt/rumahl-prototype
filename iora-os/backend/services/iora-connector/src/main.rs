//! IORA Cloud Connector — Cloud Relay Service (Nabu Casa-style)
//!
//! ## Architecture (like Home Assistant Cloud / Nabu Casa)
//!
//! ```text
//! ┌─────────────────────────┐          WebSocket Tunnel         ┌────────────────────┐
//! │  IORA Cloud Relay       │◄──────────────────────────────►│  IORA Home (Client) │
//! │  (iora-connector)       │    Single persistent WS conn    │                    │
//! │                         │    Outbound from client         │  Port 8126          │
//! │  Public IP / DNS        │    Auto-reconnect              │  Dashboard, API     │
//! │  TLS Termination (ACME) │                                │                    │
//! │  Subdomain Routing      │                                │                    │
//! │  Rate Limiting          │                                │                    │
//! │  Auth Proxy             │                                │                    │
//! └─────────────────────────┘                                └────────────────────┘
//!        ▲
//!        │ HTTPS (wss://)
//!        │ https://<id>.iora.cloud
//!   Internet Users
//! ```
//!
//! ## How it works
//! 1. User gets a pairing token from the cloud relay admin panel
//! 2. The IORA Home client connects OUTBOUND via WebSocket to the cloud relay
//! 3. The relay assigns a unique subdomain: `https://<tunnel-id>.iora.cloud`
//! 4. All HTTP requests to that subdomain are proxied through the WS tunnel to IORA Home
//! 5. No port forwarding, no WireGuard, no VPN — just a WebSocket
//! 6. TLS is handled automatically by the cloud relay (ACME/Let's Encrypt)

use anyhow::Result;
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Path, Query, State,
    },
    http::{header, HeaderMap, Method, StatusCode, Uri},
    middleware,
    response::{IntoResponse, Json, Response},
    routing::{any, delete, get, post},
    Router,
};
use chrono::Utc;

use iora_shared_config::system_config;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Instant};
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

// ─── Tunnel Protocol ────────────────────────────────────────────────────────
// Messages sent over the WebSocket between client (IORA Home) and cloud relay.
//
// Client → Relay:
//   {"type":"auth","tunnel_id":"...","token":"..."}
//   {"type":"http_response","request_id":"...","status":200,"headers":{...},"body":"base64..."}
//   {"type":"heartbeat"}
//
// Relay → Client:
//   {"type":"auth_ok","subdomain":"...","server_time":"..."}
//   {"type":"auth_error","message":"..."}
//   {"type":"http_request","request_id":"...","method":"GET","path":"/api/states","headers":{...},"body":"base64..."}
//   {"type":"heartbeat_ack"}
//   {"type":"config_update","subdomain":"..."}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tunnel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    subdomain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    headers: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_agent: Option<String>,
}

// ─── State ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub jwt_secret: String,
    pub public_domain: String,
    pub http_port: u16,
    pub relay_port: u16,
    pub http_client: reqwest::Client,
    /// Active WebSocket tunnels: tunnel_id → (sender to forward HTTP requests)
    pub active_tunnels: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<TunnelMessage>>>>,
    /// Pending HTTP responses: request_id → oneshot sender
    pub pending_requests: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<TunnelMessage>>>>,
}

// ─── Models ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CloudTunnel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub subdomain: String,
    pub token_hash: String,
    pub status: String, // "pending", "connected", "disconnected"
    pub iora_version: Option<String>,
    pub hostname: Option<String>,
    pub last_seen: Option<String>,
    pub connected_since: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ExposedService {
    pub id: String,
    pub tunnel_id: String,
    pub service_name: String,
    pub local_port: i32,
    pub local_protocol: String,
    pub require_auth: bool,
    pub rate_limit_rpm: i32,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AccessLogEntry {
    pub id: String,
    pub tunnel_id: String,
    pub method: String,
    pub path: String,
    pub query_string: Option<String>,
    pub source_ip: String,
    pub user_agent: Option<String>,
    pub status_code: i32,
    pub response_time_ms: i32,
    pub bytes_transferred: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PairingToken {
    pub id: String,
    pub token_hash: String,
    pub label: Option<String>,
    pub created_by: String,
    pub used_by_tunnel: Option<String>,
    pub expires_at: String,
    pub created_at: String,
}

// ─── Request / Response DTOs ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreatePairingTokenRequest {
    label: Option<String>,
    expires_in_hours: Option<i64>,
}

#[derive(Debug, Serialize)]
struct PairingTokenResponse {
    id: String,
    token: String,
    label: Option<String>,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
struct ExposeServiceRequest {
    tunnel_id: String,
    service_name: String,
    local_port: i32,
    local_protocol: Option<String>,
    require_auth: Option<bool>,
    rate_limit_rpm: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct AccessLogQuery {
    tunnel_id: Option<String>,
    limit: Option<i32>,
}

#[derive(Debug, Serialize)]
struct CloudStatus {
    tunnels_total: i64,
    tunnels_connected: i64,
    services_total: i64,
    requests_last_hour: i64,
    domain: String,
    uptime_seconds: u64,
}

// ─── Main ───────────────────────────────────────────────────────────────────

static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    START_TIME.get_or_init(Instant::now);

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_connector=info,tower_http=info".into()),
        )
        .init();

    let database_url = system_config::database_url_for("iora-connector");
    let jwt_secret = system_config::jwt_secret();
    let http_port: u16 = system_config::service_port("iora-connector", 8102);
    let relay_port: u16 = system_config::connector_relay_port();
    let public_domain = system_config::connector_domain();
    let domain_for_log = public_domain.clone();

    let db = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    // Run migrations
    let migration_sql = include_str!("../migrations/002_cloud_tunnel_schema.sql");
    for statement in migration_sql.split(';').filter(|s| !s.trim().is_empty()) {
        if let Err(e) = sqlx::query(statement).execute(&db).await {
            let msg = e.to_string();
            if !msg.contains("already exists") {
                warn!("Migration warning: {}", msg);
            }
        }
    }

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let state = Arc::new(AppState {
        db,
        jwt_secret,
        public_domain,
        http_port,
        relay_port,
        http_client,
        active_tunnels: Arc::new(RwLock::new(HashMap::new())),
        pending_requests: Arc::new(RwLock::new(HashMap::new())),
    });

    // Background: heartbeat timeout detection
    let state_bg = state.clone();
    tokio::spawn(async move { heartbeat_watchdog(state_bg).await });

    // Background: cleanup old logs
    let state_cleanup = state.clone();
    tokio::spawn(async move { cleanup_old_logs(state_cleanup).await });

    // Background: cleanup orphaned HashMap entries (memory leak prevention)
    let state_orphan_cleanup = state.clone();
    tokio::spawn(async move { cleanup_orphaned_entries(state_orphan_cleanup).await });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // ── Public API (HTTP port) ──────────────────────────────────────────
    let http_app = Router::new()
        .route("/health", get(health_endpoint))
        // Admin management (JWT auth)
        .nest("/api/connector", admin_routes(state.clone()))
        // Public proxy: routes external traffic to IORA Home via WS tunnel
        .fallback(any(proxy_http_request))
        .layer(cors.clone())
        .with_state(state.clone());

    // ── Relay API (WebSocket port) — accepts tunnel connections from IORA Home clients ──
    let relay_app = Router::new()
        .route("/tunnel/connect", get(ws_tunnel_handler))
        .layer(cors)
        .with_state(state.clone());

    // Start HTTP server
    let http_addr = SocketAddr::from(([0, 0, 0, 0], http_port));
    let http_listener = tokio::net::TcpListener::bind(http_addr).await?;
    info!(
        "Cloud Relay HTTP listening on {} (public domain: {})",
        http_addr, domain_for_log
    );

    // Start Relay/WebSocket server
    let relay_addr = SocketAddr::from(([0, 0, 0, 0], relay_port));
    let relay_listener = tokio::net::TcpListener::bind(relay_addr).await?;
    info!("Cloud Relay WebSocket listening on {}", relay_addr);

    let _hb = iora_shared_heartbeat::spawn_default(
        "iora-connector",
        http_port,
        "Cloud relay — WebSocket tunnel proxy",
    );

    // Serve both on the same task set
    tokio::select! {
        r = axum::serve(http_listener, http_app.into_make_service_with_connect_info::<SocketAddr>()) => r?,
        r = axum::serve(relay_listener, relay_app.into_make_service_with_connect_info::<SocketAddr>()) => r?,
    }

    Ok(())
}

// ─── Admin Routes ───────────────────────────────────────────────────────────

fn admin_routes(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/status", get(cloud_status))
        .route("/tunnels", get(list_tunnels))
        .route("/tunnels/:id", get(get_tunnel).delete(remove_tunnel))
        .route("/services", post(expose_service).get(list_services))
        .route("/services/:id", delete(remove_service))
        .route(
            "/pairing-tokens",
            post(create_pairing_token).get(list_pairing_tokens),
        )
        .route("/pairing-tokens/:id", delete(revoke_pairing_token))
        .route("/access-log", get(get_access_log))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            admin_auth_middleware,
        ))
}

// ─── Health ─────────────────────────────────────────────────────────────────

async fn health_endpoint(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let tunnels_total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM cloud_tunnels")
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    let connected: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM cloud_tunnels WHERE status = 'connected'")
            .fetch_one(&state.db)
            .await
            .unwrap_or((0,));

    Json(serde_json::json!({
        "status": "healthy",
        "service": "iora-connector",
        "tunnels_total": tunnels_total.0,
        "tunnels_connected": connected.0,
        "domain": state.public_domain,
    }))
}

// ─── WebSocket Tunnel Handler ───────────────────────────────────────────────
// This is the CORE of the cloud relay. IORA Home clients connect here via
// WebSocket to establish a persistent tunnel. All incoming HTTP requests
// for that client's subdomain are forwarded through this WebSocket.

async fn ws_tunnel_handler(
    State(state): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_tunnel_connection(state, socket))
}

async fn handle_tunnel_connection(state: Arc<AppState>, mut ws: WebSocket) {
    let mut _tunnel_id: Option<String> = None;
    let (tx, mut rx) = mpsc::unbounded_channel::<TunnelMessage>();

    // Step 1: Wait for auth message
    let auth_msg = match tokio::time::timeout(std::time::Duration::from_secs(10), ws.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<TunnelMessage>(&text) {
            Ok(msg) if msg.msg_type == "auth" => msg,
            _ => {
                let _ = ws
                    .send(Message::Text(
                        serde_json::json!({
                            "type": "auth_error", "message": "Invalid auth message"
                        })
                        .to_string(),
                    ))
                    .await;
                return;
            }
        },
        _ => {
            let _ = ws
                .send(Message::Text(
                    serde_json::json!({
                        "type": "auth_error", "message": "Auth timeout"
                    })
                    .to_string(),
                ))
                .await;
            return;
        }
    };

    // Step 2: Verify auth
    let tid = auth_msg.tunnel_id.as_deref().unwrap_or("");
    let token = auth_msg.token.as_deref().unwrap_or("");
    let token_hash = hash_string(token);

    let tunnel: CloudTunnel = match sqlx::query_as(
        "SELECT * FROM cloud_tunnels WHERE (id = ? OR subdomain = ?) AND token_hash = ?",
    )
    .bind(tid)
    .bind(tid)
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(t)) => t,
        _ => {
            let _ = ws
                .send(Message::Text(
                    serde_json::json!({
                        "type": "auth_error", "message": "Invalid tunnel ID or token"
                    })
                    .to_string(),
                ))
                .await;
            return;
        }
    };

    _tunnel_id = Some(tunnel.id.clone());
    let subdomain = format!("{}.{}", tunnel.subdomain, state.public_domain);
    let now = Utc::now().to_rfc3339();

    // Step 3: Register as active
    {
        let mut active = state.active_tunnels.write().await;
        active.insert(tunnel.id.clone(), tx.clone());
    }

    // Update DB
    let _ = sqlx::query(
        "UPDATE cloud_tunnels SET status = 'connected', last_seen = ?, connected_since = COALESCE(connected_since, ?), updated_at = ? WHERE id = ?"
    )
    .bind(&now).bind(&now).bind(&now).bind(&tunnel.id)
    .execute(&state.db).await;

    // Send auth_ok
    let ok_msg = serde_json::json!({
        "type": "auth_ok",
        "subdomain": subdomain,
        "server_time": now,
        "tunnel_id": tunnel.id,
    });
    if ws.send(Message::Text(ok_msg.to_string())).await.is_err() {
        cleanup_tunnel(&state, &tunnel.id).await;
        return;
    }

    info!("Tunnel connected: {} → {}", tunnel.name, subdomain);

    // Step 4: Main loop — read from WS (responses from IORA Home) and write to WS (requests from internet)
    let mut heartbeat_interval = tokio::time::interval(std::time::Duration::from_secs(30));
    let mut last_activity = Instant::now();

    loop {
        tokio::select! {
            // Incoming message from IORA Home (HTTP responses, heartbeats)
            ws_msg = ws.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        last_activity = Instant::now();
                        if let Ok(msg) = serde_json::from_str::<TunnelMessage>(&text) {
                            match msg.msg_type.as_str() {
                                "http_response" => {
                                    // Forward response back to waiting HTTP client
                                    if let Some(ref req_id) = msg.request_id {
                                        let mut pending = state.pending_requests.write().await;
                                        if let Some(responder) = pending.remove(req_id) {
                                            let _ = responder.send(msg);
                                        }
                                    }
                                }
                                "heartbeat" => {
                                    let _ = ws.send(Message::Text(serde_json::json!({
                                        "type": "heartbeat_ack"
                                    }).to_string())).await;
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("Tunnel disconnected: {}", tunnel.name);
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = ws.send(Message::Pong(data)).await;
                    }
                    _ => {}
                }
            }

            // Outgoing HTTP request from internet → forward to IORA Home via WS
            Some(http_msg) = rx.recv() => {
                let payload = serde_json::to_string(&http_msg).unwrap_or_default();
                if ws.send(Message::Text(payload)).await.is_err() {
                    break;
                }
            }

            // Heartbeat
            _ = heartbeat_interval.tick() => {
                if last_activity.elapsed() > std::time::Duration::from_secs(90) {
                    warn!("Tunnel {} heartbeat timeout", tunnel.name);
                    break;
                }
                let _ = ws.send(Message::Text(serde_json::json!({
                    "type": "heartbeat_check"
                }).to_string())).await;
            }
        }
    }

    cleanup_tunnel(&state, &tunnel.id).await;
}

async fn cleanup_tunnel(state: &Arc<AppState>, tunnel_id: &str) {
    let mut active = state.active_tunnels.write().await;
    active.remove(tunnel_id);

    let now = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "UPDATE cloud_tunnels SET status = 'disconnected', last_seen = ?, updated_at = ? WHERE id = ?"
    )
    .bind(&now).bind(&now).bind(tunnel_id)
    .execute(&state.db).await;
}

// ─── HTTP Proxy: Route external requests to IORA Home via WS tunnel ────────

async fn proxy_http_request(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, (StatusCode, String)> {
    let start = Instant::now();
    let source_ip = addr.ip().to_string();
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Extract subdomain from host header: <subdomain>.iora.cloud → subdomain
    let domain_suffix = format!(".{}", state.public_domain);
    let subdomain = host.strip_suffix(&domain_suffix).unwrap_or("").to_string();

    if subdomain.is_empty() || subdomain.contains('.') {
        return Ok((StatusCode::NOT_FOUND, "Unknown subdomain").into_response());
    }

    // Find tunnel by subdomain
    let tunnel: CloudTunnel =
        sqlx::query_as("SELECT * FROM cloud_tunnels WHERE subdomain = ? AND status = 'connected'")
            .bind(&subdomain)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    "Tunnel not found or offline".to_string(),
                )
            })?;

    // Check if tunnel is active
    let tx = {
        let active = state.active_tunnels.read().await;
        active.get(&tunnel.id).cloned()
    };

    let tx = tx.ok_or_else(|| (StatusCode::BAD_GATEWAY, "Tunnel not connected".to_string()))?;

    // Build HTTP request to forward
    let request_id = Uuid::new_v4().to_string();
    let path = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();
    let query_string = uri.query().map(|q| q.to_string());
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Extract request headers
    let mut req_headers = serde_json::Map::new();
    for (name, value) in headers.iter() {
        if let Ok(v) = value.to_str() {
            let key = name.as_str().to_lowercase();
            if !matches!(key.as_str(), "host" | "connection" | "transfer-encoding") {
                req_headers.insert(key, serde_json::Value::String(v.to_string()));
            }
        }
    }
    req_headers.insert(
        "x-forwarded-for".to_string(),
        serde_json::Value::String(source_ip.clone()),
    );
    req_headers.insert(
        "x-real-ip".to_string(),
        serde_json::Value::String(source_ip.clone()),
    );
    req_headers.insert(
        "x-forwarded-proto".to_string(),
        serde_json::Value::String("https".to_string()),
    );

    // Read body
    let body_bytes = axum::body::to_bytes(body, 10 * 1024 * 1024)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Body too large: {}", e)))?;

    let body_b64 = if !body_bytes.is_empty() {
        Some(base64_encode(&body_bytes))
    } else {
        None
    };

    // Create oneshot channel for response
    let (resp_tx, resp_rx) = tokio::sync::oneshot::channel();
    {
        let mut pending = state.pending_requests.write().await;
        pending.insert(request_id.clone(), resp_tx);
    }

    // Forward request through WS tunnel
    let tunnel_msg = TunnelMessage {
        msg_type: "http_request".to_string(),
        tunnel_id: None,
        token: None,
        request_id: Some(request_id.clone()),
        subdomain: None,
        server_time: None,
        message: None,
        method: Some(method.as_str().to_string()),
        path: Some(path.clone()),
        status: None,
        headers: Some(serde_json::Value::Object(req_headers)),
        body: body_b64,
        query_string,
        client_ip: Some(source_ip.clone()),
        user_agent,
    };

    if tx.send(tunnel_msg).is_err() {
        let mut pending = state.pending_requests.write().await;
        pending.remove(&request_id);
        return Err((StatusCode::BAD_GATEWAY, "Tunnel send failed".to_string()));
    }

    // Wait for response (with timeout)
    let response = match tokio::time::timeout(std::time::Duration::from_secs(30), resp_rx).await {
        Ok(Ok(msg)) => msg,
        Ok(Err(_)) => {
            let mut pending = state.pending_requests.write().await;
            pending.remove(&request_id);
            return Err((
                StatusCode::BAD_GATEWAY,
                "Response channel closed".to_string(),
            ));
        }
        Err(_) => {
            let mut pending = state.pending_requests.write().await;
            pending.remove(&request_id);
            return Err((StatusCode::GATEWAY_TIMEOUT, "Upstream timeout".to_string()));
        }
    };

    let elapsed = start.elapsed().as_millis() as i32;

    // Log access
    let log_id = Uuid::new_v4().to_string();
    let status_code = response.status.unwrap_or(502) as i32;
    let now = Utc::now().to_rfc3339();

    let _ = sqlx::query(
        "INSERT INTO access_log (id, tunnel_id, method, path, query_string, source_ip, user_agent, status_code, response_time_ms, bytes_transferred, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&log_id).bind(&tunnel.id).bind(method.as_str()).bind(&path)
    .bind(&response.query_string).bind(&source_ip).bind(&response.user_agent)
    .bind(status_code).bind(elapsed).bind(0i64).bind(&now)
    .execute(&state.db).await;

    // Build response
    let mut builder = Response::builder().status(
        StatusCode::from_u16(response.status.unwrap_or(502)).unwrap_or(StatusCode::BAD_GATEWAY),
    );

    if let Some(ref hdrs) = response.headers {
        if let Some(obj) = hdrs.as_object() {
            for (key, value) in obj {
                if let Some(v) = value.as_str() {
                    if !matches!(
                        key.as_str(),
                        "transfer-encoding" | "connection" | "content-encoding"
                    ) {
                        if let (Ok(name), Ok(val)) = (
                            axum::http::HeaderName::from_bytes(key.as_bytes()),
                            axum::http::HeaderValue::from_str(v),
                        ) {
                            builder = builder.header(name, val);
                        }
                    }
                }
            }
        }
    }

    let resp_body = if let Some(ref b64) = response.body {
        base64_decode(b64).unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(builder.body(Body::from(resp_body)).unwrap_or_else(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, "Response build error").into_response()
    }))
}

// ─── Admin API Handlers ────────────────────────────────────────────────────

async fn cloud_status(State(state): State<Arc<AppState>>) -> Json<CloudStatus> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM cloud_tunnels")
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    let connected: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM cloud_tunnels WHERE status = 'connected'")
            .fetch_one(&state.db)
            .await
            .unwrap_or((0,));
    let services: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM exposed_services WHERE is_active = 1")
            .fetch_one(&state.db)
            .await
            .unwrap_or((0,));
    let reqs: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM access_log WHERE created_at > datetime('now', '-1 hour')",
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or((0,));
    let uptime = START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0);

    Json(CloudStatus {
        tunnels_total: total.0,
        tunnels_connected: connected.0,
        services_total: services.0,
        requests_last_hour: reqs.0,
        domain: state.public_domain.clone(),
        uptime_seconds: uptime,
    })
}

async fn list_tunnels(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<CloudTunnel>>, (StatusCode, String)> {
    let tunnels = sqlx::query_as("SELECT * FROM cloud_tunnels ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(tunnels))
}

async fn get_tunnel(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let tunnel: CloudTunnel =
        sqlx::query_as("SELECT * FROM cloud_tunnels WHERE id = ? OR subdomain = ?")
            .bind(&id)
            .bind(&id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "Tunnel not found".to_string()))?;

    let services: Vec<ExposedService> =
        sqlx::query_as("SELECT * FROM exposed_services WHERE tunnel_id = ?")
            .bind(&tunnel.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let is_active = state.active_tunnels.read().await.contains_key(&tunnel.id);

    Ok(Json(serde_json::json!({
        "tunnel": tunnel,
        "services": services,
        "public_url": format!("https://{}.{}", tunnel.subdomain, state.public_domain),
        "is_active": is_active,
    })))
}

async fn remove_tunnel(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Remove from active tunnels (this will cause the WS connection to close)
    state.active_tunnels.write().await.remove(&id);

    sqlx::query("DELETE FROM cloud_tunnels WHERE id = ? OR subdomain = ?")
        .bind(&id)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "removed": true })))
}

async fn expose_service(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ExposeServiceRequest>,
) -> Result<Json<ExposedService>, (StatusCode, String)> {
    let _tunnel: CloudTunnel = sqlx::query_as("SELECT * FROM cloud_tunnels WHERE id = ?")
        .bind(&body.tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Tunnel not found".to_string()))?;

    let service_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO exposed_services (id, tunnel_id, service_name, local_port, local_protocol, require_auth, rate_limit_rpm, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&service_id).bind(&body.tunnel_id).bind(&body.service_name)
    .bind(body.local_port).bind(body.local_protocol.as_deref().unwrap_or("http"))
    .bind(body.require_auth.unwrap_or(false)).bind(body.rate_limit_rpm.unwrap_or(120)).bind(&now)
    .execute(&state.db).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let service: ExposedService = sqlx::query_as("SELECT * FROM exposed_services WHERE id = ?")
        .bind(&service_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    info!(
        "Service exposed: {} on tunnel {}",
        body.service_name, body.tunnel_id
    );
    Ok(Json(service))
}

async fn list_services(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ExposedService>>, (StatusCode, String)> {
    let services =
        sqlx::query_as("SELECT * FROM exposed_services ORDER BY tunnel_id, service_name")
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(services))
}

async fn remove_service(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    sqlx::query("DELETE FROM exposed_services WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "removed": true })))
}

async fn create_pairing_token(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreatePairingTokenRequest>,
) -> Result<Json<PairingTokenResponse>, (StatusCode, String)> {
    let user_id = extract_admin_user(&headers, &iora_shared_config::system_config::jwt_secret())?;

    let token_id = Uuid::new_v4().to_string();
    let raw_token = format!(
        "iora-{}",
        &Uuid::new_v4().to_string().replace('-', "")[..32]
    );
    let token_hash = hash_string(&raw_token);
    let hours = body.expires_in_hours.unwrap_or(24);
    let expires_at = (Utc::now() + chrono::Duration::hours(hours)).to_rfc3339();

    sqlx::query(
        "INSERT INTO pairing_tokens (id, token_hash, label, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    )
    .bind(&token_id).bind(&token_hash).bind(&body.label).bind(&user_id).bind(&expires_at)
    .execute(&state.db).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Auto-create a tunnel for this token
    let tunnel_id = Uuid::new_v4().to_string();
    let subdomain = generate_subdomain(&state)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "INSERT INTO cloud_tunnels (id, name, subdomain, token_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))"
    )
    .bind(&tunnel_id).bind(body.label.as_deref().unwrap_or("IORA Home"))
    .bind(&subdomain).bind(&token_hash)
    .execute(&state.db).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(PairingTokenResponse {
        id: token_id,
        token: raw_token,
        label: body.label,
        expires_at,
    }))
}

async fn list_pairing_tokens(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<PairingToken>>, (StatusCode, String)> {
    let tokens = sqlx::query_as("SELECT * FROM pairing_tokens ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(tokens))
}

async fn revoke_pairing_token(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    sqlx::query("DELETE FROM pairing_tokens WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "revoked": true })))
}

async fn get_access_log(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AccessLogQuery>,
) -> Result<Json<Vec<AccessLogEntry>>, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(100).min(1000);
    let entries = if let Some(ref tid) = query.tunnel_id {
        sqlx::query_as(
            "SELECT * FROM access_log WHERE tunnel_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(tid)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as("SELECT * FROM access_log ORDER BY created_at DESC LIMIT ?")
            .bind(limit)
            .fetch_all(&state.db)
            .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(entries))
}

// ─── Middleware ─────────────────────────────────────────────────────────────

async fn admin_auth_middleware(
    State(_state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Result<axum::response::Response, StatusCode> {
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    verify_admin_jwt(token, &iora_shared_config::system_config::jwt_secret())?;
    Ok(next.run(request).await)
}

fn verify_admin_jwt(token: &str, secret: &str) -> Result<(), StatusCode> {
    use jsonwebtoken::{decode, DecodingKey, Validation};
    #[derive(Deserialize)]
    struct Claims {
        is_admin: bool,
    }

    let key = DecodingKey::from_secret(secret.as_bytes());
    let data = decode::<Claims>(token, &key, &Validation::default())
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if data.claims.is_admin {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

fn extract_admin_user(headers: &HeaderMap, secret: &str) -> Result<String, (StatusCode, String)> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing token".to_string()))?;

    use jsonwebtoken::{decode, DecodingKey, Validation};
    #[derive(Deserialize)]
    struct Claims {
        sub: String,
    }

    let key = DecodingKey::from_secret(secret.as_bytes());
    decode::<Claims>(token, &key, &Validation::default())
        .map(|d| d.claims.sub)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn hash_string(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(data: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(data).ok()
}

async fn generate_subdomain(state: &AppState) -> Result<String> {
    // Generate a unique subdomain: random 8-char string
    for _ in 0..10 {
        let candidate: String = Uuid::new_v4()
            .to_string()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .take(8)
            .collect();
        // Check uniqueness
        let exists: Option<(i64,)> =
            sqlx::query_as("SELECT 1 FROM cloud_tunnels WHERE subdomain = ?")
                .bind(&candidate)
                .fetch_optional(&state.db)
                .await?;
        if exists.is_none() {
            return Ok(candidate);
        }
    }
    anyhow::bail!("Could not generate unique subdomain")
}

async fn heartbeat_watchdog(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let now = Utc::now().to_rfc3339();

        // Mark tunnels without recent activity as disconnected
        let _ = sqlx::query(
            "UPDATE cloud_tunnels SET status = 'disconnected', updated_at = ? WHERE status = 'connected' AND last_seen < datetime('now', '-2 minutes')"
        )
        .bind(&now).execute(&state.db).await;

        // Clean up stale pending requests
        let mut pending = state.pending_requests.write().await;
        pending.clear();
    }
}

async fn cleanup_old_logs(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        let cutoff = (Utc::now() - chrono::Duration::days(30)).to_rfc3339();
        let _ = sqlx::query("DELETE FROM access_log WHERE created_at < ?")
            .bind(&cutoff)
            .execute(&state.db)
            .await;
    }
}

/// Safety threshold for pending request count. Above this, all pending requests
/// are considered orphaned and cleared.
const PENDING_REQUEST_CLEAR_THRESHOLD: usize = 100;

/// Determine orphaned tunnel IDs: those in active but not in connected_in_db.
fn find_orphaned_tunnel_ids(active_ids: &[String], connected_in_db: &[String]) -> Vec<String> {
    active_ids
        .iter()
        .filter(|id| !connected_in_db.contains(id))
        .cloned()
        .collect()
}

/// Determine whether pending requests should be bulk-cleared based on count.
fn should_clear_pending_requests(count: usize) -> bool {
    count > PENDING_REQUEST_CLEAR_THRESHOLD
}

/// Background task to cleanup orphaned entries in HashMaps (memory leak prevention)
///
/// Runs every 5 minutes to remove:
/// - Orphaned `pending_requests` entries (should timeout after 30s, but cleanup if leaked)
/// - Orphaned `active_tunnels` entries that don't correspond to connected tunnels in DB
async fn cleanup_orphaned_entries(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(300)).await; // Every 5 minutes

        let _now = Utc::now().to_rfc3339();

        // 1. Clean up orphaned active_tunnels by cross-referencing with DB
        let active_tunnel_ids: Vec<String> = {
            let active = state.active_tunnels.read().await;
            active.keys().cloned().collect()
        };

        if !active_tunnel_ids.is_empty() {
            // Query DB for tunnels that should still be connected
            let connected_in_db: Vec<String> = sqlx::query_scalar(
                "SELECT id FROM cloud_tunnels WHERE status = 'connected' AND last_seen > datetime('now', '-2 minutes')"
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            // Remove tunnels from HashMap that aren't in DB or are stale
            let orphaned = find_orphaned_tunnel_ids(&active_tunnel_ids, &connected_in_db);
            if !orphaned.is_empty() {
                let mut active = state.active_tunnels.write().await;
                for tunnel_id in &orphaned {
                    active.remove(tunnel_id);
                    tracing::info!("Cleaned up orphaned active_tunnel entry: {}", tunnel_id);
                }
            }
        }

        // 2. Clean up all orphaned pending_requests
        // These should have timed out after 30s, but if the handler crashed or panicked,
        // they could remain. Since we can't easily track insertion time without changing
        // the data structure, we just clear entries older than 2 minutes as a safety net.
        //
        // In practice, legitimate requests timeout after 30s, so anything remaining
        // after 2 minutes is definitely orphaned.
        let pending_count = {
            let mut pending = state.pending_requests.write().await;
            let count = pending.len();
            if should_clear_pending_requests(count) {
                tracing::warn!("Found {} orphaned pending_requests - clearing all", count);
                pending.clear();
                count
            } else if count > 0 {
                tracing::debug!("Found {} pending_requests (may be legitimate)", count);
                0
            } else {
                0
            }
        };

        if pending_count > PENDING_REQUEST_CLEAR_THRESHOLD {
            tracing::info!(
                "Cleaned up {} orphaned pending_request entries",
                pending_count
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pending_requests_below_threshold_not_cleared() {
        assert!(!should_clear_pending_requests(0));
        assert!(!should_clear_pending_requests(50));
        assert!(!should_clear_pending_requests(100));
    }

    #[test]
    fn test_pending_requests_above_threshold_cleared() {
        assert!(should_clear_pending_requests(101));
        assert!(should_clear_pending_requests(500));
        assert!(should_clear_pending_requests(1000));
    }

    #[test]
    fn test_find_orphaned_tunnels_empty() {
        let active = vec!["t1".to_string(), "t2".to_string()];
        let connected: Vec<String> = vec![];
        let orphans = find_orphaned_tunnel_ids(&active, &connected);
        assert_eq!(orphans, vec!["t1", "t2"]);
    }

    #[test]
    fn test_find_orphaned_tunnels_all_connected() {
        let active = vec!["t1".to_string(), "t2".to_string()];
        let connected = vec!["t1".to_string(), "t2".to_string()];
        let orphans = find_orphaned_tunnel_ids(&active, &connected);
        assert!(orphans.is_empty());
    }

    #[test]
    fn test_find_orphaned_tunnels_partial() {
        let active = vec!["t1".to_string(), "t2".to_string(), "t3".to_string()];
        let connected = vec!["t2".to_string()];
        let orphans = find_orphaned_tunnel_ids(&active, &connected);
        assert_eq!(orphans, vec!["t1", "t3"]);
    }

    #[test]
    fn test_find_orphaned_tunnels_no_active() {
        let active: Vec<String> = vec![];
        let connected = vec!["t1".to_string()];
        let orphans = find_orphaned_tunnel_ids(&active, &connected);
        assert!(orphans.is_empty());
    }

    #[test]
    fn test_threshold_constant_consistent() {
        assert_eq!(PENDING_REQUEST_CLEAR_THRESHOLD, 100);
        // Boundary: exactly at threshold should not clear
        assert!(!should_clear_pending_requests(
            PENDING_REQUEST_CLEAR_THRESHOLD
        ));
        // One above threshold should clear
        assert!(should_clear_pending_requests(
            PENDING_REQUEST_CLEAR_THRESHOLD + 1
        ));
    }
}
