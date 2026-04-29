//! IORA Connector – Datacenter relay service that exposes selected local IORA services
//! publicly via encrypted WireGuard VPN tunnels.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────┐         WireGuard VPN          ┌───────────────────┐
//! │  IORA Connector     │◄──────────────────────────────►│  IORA Home        │
//! │  (Datacenter)       │    Encrypted Tunnel            │  (User's Home)    │
//! │                     │                                 │                   │
//! │  Public IP / DNS    │                                 │  Private Network  │
//! │  TLS Termination    │                                 │  Port 8080, etc.  │
//! │  Rate Limiting      │                                 │                   │
//! │  Access Control     │                                 │                   │
//! │  DDoS Protection    │                                 │                   │
//! └─────────────────────┘                                 └───────────────────┘
//!        ▲
//!        │ HTTPS
//!        │
//!   Internet Users
//! ```
//!
//! ## Features
//! - WireGuard VPN tunnel management (config generation, peer management)
//! - Reverse proxy from public internet to local IORA services
//! - Per-service access control (IP allowlists, user auth, rate limits)
//! - TLS termination with auto-ACME or custom certificates
//! - Health monitoring of tunneled services
//! - Access logging and DDoS protection
//! - Pairing token system for secure tunnel registration

use anyhow::Result;
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, Method, StatusCode, Uri},
    middleware,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use std::{net::SocketAddr, sync::Arc, time::Instant};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

mod auth;
mod tunnel;
mod proxy;
mod health;

// ─── Configuration ──────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub jwt_secret: String,
    pub wireguard_config_dir: String,
    pub server_public_ip: String,
    pub default_domain: String,
    pub vpn_subnet: String,
    pub wireguard_port: u16,
    pub http_client: reqwest::Client,
    pub tunnel_status: Arc<RwLock<std::collections::HashMap<String, TunnelLiveStatus>>>,
}

#[derive(Debug, Clone)]
pub struct TunnelLiveStatus {
    pub connected: bool,
    pub last_handshake: Option<String>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub latency_ms: Option<u32>,
}

// ─── Models ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tunnel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub peer_public_key: String,
    pub peer_endpoint: Option<String>,
    pub assigned_ip: String,
    pub status: String,
    pub last_handshake: Option<String>,
    pub last_seen: Option<String>,
    pub bytes_sent: i64,
    pub bytes_received: i64,
    pub auth_token_hash: String,
    pub iora_version: Option<String>,
    pub hostname: Option<String>,
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
    pub public_subdomain: Option<String>,
    pub public_path: String,
    pub public_port: Option<i32>,
    pub require_auth: bool,
    pub allowed_ips: Option<String>,
    pub allowed_users: Option<String>,
    pub rate_limit_rpm: i32,
    pub tls_enabled: bool,
    pub custom_domain: Option<String>,
    pub is_active: bool,
    pub health_status: String,
    pub last_health_check: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AccessLogEntry {
    pub id: String,
    pub service_id: String,
    pub tunnel_id: String,
    pub method: String,
    pub path: String,
    pub query_string: Option<String>,
    pub source_ip: String,
    pub user_agent: Option<String>,
    pub authenticated_user: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ConnectorConfigEntry {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

// ─── Request / Response DTOs ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RegisterTunnelRequest {
    name: String,
    description: Option<String>,
    pairing_token: String,
    peer_public_key: String,
    hostname: Option<String>,
    iora_version: Option<String>,
}

#[derive(Debug, Serialize)]
struct RegisterTunnelResponse {
    tunnel_id: String,
    assigned_ip: String,
    server_public_key: String,
    server_endpoint: String,
    wireguard_config: String,
    dns: String,
}

#[derive(Debug, Deserialize)]
struct ExposeServiceRequest {
    tunnel_id: String,
    service_name: String,
    local_port: i32,
    local_protocol: Option<String>,
    public_subdomain: Option<String>,
    public_path: Option<String>,
    require_auth: Option<bool>,
    allowed_ips: Option<Vec<String>>,
    rate_limit_rpm: Option<i32>,
    custom_domain: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateServiceRequest {
    is_active: Option<bool>,
    require_auth: Option<bool>,
    allowed_ips: Option<Vec<String>>,
    allowed_users: Option<Vec<String>>,
    rate_limit_rpm: Option<i32>,
    public_subdomain: Option<String>,
    public_path: Option<String>,
    custom_domain: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreatePairingTokenRequest {
    label: Option<String>,
    expires_in_hours: Option<i64>,
}

#[derive(Debug, Serialize)]
struct PairingTokenResponse {
    id: String,
    token: String, // plaintext token, only shown once
    label: Option<String>,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
struct AccessLogQuery {
    service_id: Option<String>,
    tunnel_id: Option<String>,
    #[allow(dead_code)]
    since: Option<String>,
    limit: Option<i32>,
}

#[derive(Debug, Serialize)]
struct ConnectorStatus {
    tunnels_total: i64,
    tunnels_connected: i64,
    services_total: i64,
    services_healthy: i64,
    requests_last_hour: i64,
    blocked_ips: i64,
    wireguard_port: u16,
    server_ip: String,
    domain: String,
    vpn_subnet: String,
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

    let database_url = std::env::var("IORA_CONNECTOR_DB_URL")
        .unwrap_or_else(|_| "sqlite:./data/connector.db?mode=rwc".into());
    let jwt_secret = std::env::var("IORA_JWT_SECRET")
        .unwrap_or_else(|_| "iora-connector-dev-secret-change-me".into());
    let port: u16 = std::env::var("IORA_CONNECTOR_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8098);
    let wg_config_dir = std::env::var("IORA_WG_CONFIG_DIR")
        .unwrap_or_else(|_| "/etc/wireguard".into());
    let server_ip = std::env::var("IORA_CONNECTOR_PUBLIC_IP")
        .unwrap_or_else(|_| "0.0.0.0".into());
    let domain = std::env::var("IORA_CONNECTOR_DOMAIN")
        .unwrap_or_else(|_| "iora-connect.local".into());
    let vpn_subnet = std::env::var("IORA_CONNECTOR_VPN_SUBNET")
        .unwrap_or_else(|_| "10.100.0.0/24".into());
    let wg_port: u16 = std::env::var("IORA_CONNECTOR_WG_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(51820);

    let db = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    // Run migrations (tolerant of pre-existing objects)
    let migration_sql = include_str!("../migrations/001_initial_schema.sql");
    match sqlx::query(migration_sql).execute(&db).await {
        Ok(_) => info!("Database migrations applied"),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("already exists") {
                info!("Database schema already up to date");
            } else {
                return Err(e.into());
            }
        }
    }

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .danger_accept_invalid_certs(true) // local VPN traffic
        .build()?;

    let state = Arc::new(AppState {
        db,
        jwt_secret,
        wireguard_config_dir: wg_config_dir,
        server_public_ip: server_ip,
        default_domain: domain,
        vpn_subnet: vpn_subnet,
        wireguard_port: wg_port,
        http_client,
        tunnel_status: Arc::new(RwLock::new(std::collections::HashMap::new())),
    });

    // Background tasks
    let state_health = state.clone();
    tokio::spawn(async move {
        health::health_check_loop(state_health).await;
    });

    let state_wg = state.clone();
    tokio::spawn(async move {
        tunnel::wireguard_status_poller(state_wg).await;
    });

    let state_cleanup = state.clone();
    tokio::spawn(async move {
        cleanup_old_logs(state_cleanup).await;
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Public health & status
        .route("/health", get(health_endpoint))
        // Tunnel registration (authenticated via pairing token, not JWT)
        .route("/api/connector/register", post(register_tunnel))
        .route("/api/connector/heartbeat/:tunnel_id", post(tunnel_heartbeat))
        // Admin management API (JWT auth)
        .nest(
            "/api/connector",
            Router::new()
                // Status
                .route("/status", get(connector_status))
                // Tunnel management
                .route("/tunnels", get(list_tunnels))
                .route("/tunnels/:tunnel_id", get(get_tunnel))
                .route("/tunnels/:tunnel_id", delete(remove_tunnel))
                .route("/tunnels/:tunnel_id/config", get(get_wireguard_config))
                // Service exposure
                .route("/services", post(expose_service))
                .route("/services", get(list_services))
                .route("/services/:service_id", get(get_service))
                .route("/services/:service_id", put(update_service))
                .route("/services/:service_id", delete(remove_service))
                .route("/services/:service_id/health", get(check_service_health))
                // Pairing tokens
                .route("/pairing-tokens", post(create_pairing_token))
                .route("/pairing-tokens", get(list_pairing_tokens))
                .route("/pairing-tokens/:token_id", delete(revoke_pairing_token))
                // Access logs
                .route("/access-log", get(get_access_log))
                // Blocked IPs
                .route("/blocked-ips", get(list_blocked_ips))
                .route("/blocked-ips/:ip", post(block_ip))
                .route("/blocked-ips/:ip", delete(unblock_ip))
                // Configuration
                .route("/config", get(get_config))
                .route("/config", put(update_config))
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    admin_auth_middleware,
                )),
        )
        // Public proxy endpoint: routes external traffic to local IORA services
        .route("/proxy/*path", get(proxy_request).post(proxy_request).put(proxy_request).delete(proxy_request))
        .layer(cors)
        .with_state(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("IORA Connector listening on {} (WireGuard on UDP {})", addr, wg_port);
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-connector",
        addr.port(),
        "WireGuard / public exposure connector",
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

// ─── Health ─────────────────────────────────────────────────────────────────

async fn health_endpoint(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let tunnels: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnels")
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    let connected: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnels WHERE status = 'connected'")
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));

    Json(serde_json::json!({
        "status": "healthy",
        "service": "iora-connector",
        "tunnels_total": tunnels.0,
        "tunnels_connected": connected.0,
        "wireguard_port": state.wireguard_port,
        "domain": state.default_domain,
    }))
}

// ─── Tunnel Registration ────────────────────────────────────────────────────

async fn register_tunnel(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterTunnelRequest>,
) -> Result<Json<RegisterTunnelResponse>, (StatusCode, String)> {
    // Verify pairing token
    let token_hash = hash_string(&body.pairing_token);
    let pairing: Option<PairingToken> = sqlx::query_as(
        "SELECT * FROM pairing_tokens WHERE token_hash = ? AND used_by_tunnel IS NULL AND expires_at > datetime('now')"
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let pairing = pairing.ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, "Invalid or expired pairing token".to_string())
    })?;

    // Allocate VPN IP
    let assigned_ip = allocate_vpn_ip(&state).await?;

    // Create tunnel
    let tunnel_id = Uuid::new_v4().to_string();
    let auth_token = Uuid::new_v4().to_string();
    let auth_hash = hash_string(&auth_token);
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO tunnels (id, name, description, peer_public_key, assigned_ip, auth_token_hash, iora_version, hostname, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&tunnel_id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(&body.peer_public_key)
    .bind(&assigned_ip)
    .bind(&auth_hash)
    .bind(&body.iora_version)
    .bind(&body.hostname)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Mark pairing token as used
    sqlx::query("UPDATE pairing_tokens SET used_by_tunnel = ? WHERE id = ?")
        .bind(&tunnel_id)
        .bind(&pairing.id)
        .execute(&state.db)
        .await
        .ok();

    // Generate WireGuard config for the peer
    let server_wg_pubkey = tunnel::get_or_generate_server_keypair(&state).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let wg_config = format!(
        "[Interface]\n\
        Address = {}/32\n\
        # PrivateKey = <your private key>\n\
        DNS = 10.100.0.1\n\
        \n\
        [Peer]\n\
        PublicKey = {}\n\
        Endpoint = {}:{}\n\
        AllowedIPs = {}\n\
        PersistentKeepalive = 25\n",
        assigned_ip,
        server_wg_pubkey,
        state.server_public_ip,
        state.wireguard_port,
        state.vpn_subnet,
    );

    // Apply WireGuard config
    if let Err(e) = tunnel::add_wireguard_peer(&state, &body.peer_public_key, &assigned_ip).await {
        warn!("Failed to add WireGuard peer (manual config may be needed): {}", e);
    }

    info!("New tunnel registered: {} ({})", body.name, tunnel_id);

    Ok(Json(RegisterTunnelResponse {
        tunnel_id,
        assigned_ip,
        server_public_key: server_wg_pubkey,
        server_endpoint: format!("{}:{}", state.server_public_ip, state.wireguard_port),
        wireguard_config: wg_config,
        dns: "10.100.0.1".to_string(),
    }))
}

// ─── Tunnel Heartbeat ───────────────────────────────────────────────────────

async fn tunnel_heartbeat(
    State(state): State<Arc<AppState>>,
    Path(tunnel_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Authenticate via auth token header
    let auth_token = headers
        .get("X-Tunnel-Auth")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing X-Tunnel-Auth header".to_string()))?;

    let token_hash = hash_string(auth_token);
    let tunnel: Option<Tunnel> = sqlx::query_as(
        "SELECT * FROM tunnels WHERE id = ? AND auth_token_hash = ?"
    )
    .bind(&tunnel_id)
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _tunnel = tunnel.ok_or_else(|| (StatusCode::UNAUTHORIZED, "Invalid tunnel credentials".to_string()))?;

    let now = Utc::now().to_rfc3339();
    let version = body.get("iora_version").and_then(|v| v.as_str());
    let hostname = body.get("hostname").and_then(|v| v.as_str());

    sqlx::query(
        "UPDATE tunnels SET status = 'connected', last_seen = ?, iora_version = COALESCE(?, iora_version), hostname = COALESCE(?, hostname), updated_at = ? WHERE id = ?"
    )
    .bind(&now)
    .bind(version)
    .bind(hostname)
    .bind(&now)
    .bind(&tunnel_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "status": "ok", "server_time": now })))
}

// ─── Admin: Tunnel Management ───────────────────────────────────────────────

async fn connector_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ConnectorStatus>, (StatusCode, String)> {
    let tunnels_total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnels")
        .fetch_one(&state.db).await.unwrap_or((0,));
    let tunnels_connected: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnels WHERE status = 'connected'")
        .fetch_one(&state.db).await.unwrap_or((0,));
    let services_total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM exposed_services WHERE is_active = 1")
        .fetch_one(&state.db).await.unwrap_or((0,));
    let services_healthy: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM exposed_services WHERE health_status = 'healthy' AND is_active = 1")
        .fetch_one(&state.db).await.unwrap_or((0,));
    let requests_last_hour: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM access_log WHERE created_at > datetime('now', '-1 hour')"
    ).fetch_one(&state.db).await.unwrap_or((0,));
    let blocked: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blocked_ips")
        .fetch_one(&state.db).await.unwrap_or((0,));

    let uptime = START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0);

    Ok(Json(ConnectorStatus {
        tunnels_total: tunnels_total.0,
        tunnels_connected: tunnels_connected.0,
        services_total: services_total.0,
        services_healthy: services_healthy.0,
        requests_last_hour: requests_last_hour.0,
        blocked_ips: blocked.0,
        wireguard_port: state.wireguard_port,
        server_ip: state.server_public_ip.clone(),
        domain: state.default_domain.clone(),
        vpn_subnet: state.vpn_subnet.clone(),
        uptime_seconds: uptime,
    }))
}

async fn list_tunnels(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Tunnel>>, (StatusCode, String)> {
    let tunnels: Vec<Tunnel> = sqlx::query_as("SELECT * FROM tunnels ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(tunnels))
}

async fn get_tunnel(
    State(state): State<Arc<AppState>>,
    Path(tunnel_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let tunnel: Tunnel = sqlx::query_as("SELECT * FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Tunnel not found".to_string()))?;

    let services: Vec<ExposedService> = sqlx::query_as(
        "SELECT * FROM exposed_services WHERE tunnel_id = ?"
    )
    .bind(&tunnel_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Get live status from WG poller
    let live_status = state.tunnel_status.read().await.get(&tunnel_id).cloned();

    Ok(Json(serde_json::json!({
        "tunnel": tunnel,
        "services": services,
        "live_status": live_status.map(|s| serde_json::json!({
            "connected": s.connected,
            "last_handshake": s.last_handshake,
            "bytes_sent": s.bytes_sent,
            "bytes_received": s.bytes_received,
            "latency_ms": s.latency_ms,
        })),
    })))
}

async fn remove_tunnel(
    State(state): State<Arc<AppState>>,
    Path(tunnel_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let tunnel: Option<Tunnel> = sqlx::query_as("SELECT * FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(t) = tunnel {
        // Remove WireGuard peer
        if let Err(e) = tunnel::remove_wireguard_peer(&state, &t.peer_public_key).await {
            warn!("Failed to remove WireGuard peer: {}", e);
        }

        sqlx::query("DELETE FROM tunnels WHERE id = ?")
            .bind(&tunnel_id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(Json(serde_json::json!({ "removed": true })))
}

async fn get_wireguard_config(
    State(state): State<Arc<AppState>>,
    Path(tunnel_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let tunnel: Tunnel = sqlx::query_as("SELECT * FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Tunnel not found".to_string()))?;

    let server_pubkey = tunnel::get_or_generate_server_keypair(&state).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let config = format!(
        "[Interface]\n\
        Address = {}/32\n\
        # PrivateKey = <paste your private key>\n\
        DNS = 10.100.0.1\n\
        \n\
        [Peer]\n\
        PublicKey = {}\n\
        Endpoint = {}:{}\n\
        AllowedIPs = {}\n\
        PersistentKeepalive = 25\n",
        tunnel.assigned_ip,
        server_pubkey,
        state.server_public_ip,
        state.wireguard_port,
        state.vpn_subnet,
    );

    Ok(Json(serde_json::json!({
        "tunnel_id": tunnel_id,
        "assigned_ip": tunnel.assigned_ip,
        "server_endpoint": format!("{}:{}", state.server_public_ip, state.wireguard_port),
        "wireguard_config": config,
    })))
}

// ─── Admin: Service Exposure ────────────────────────────────────────────────

async fn expose_service(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ExposeServiceRequest>,
) -> Result<Json<ExposedService>, (StatusCode, String)> {
    // Verify tunnel exists
    let _tunnel: Tunnel = sqlx::query_as("SELECT * FROM tunnels WHERE id = ?")
        .bind(&body.tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Tunnel not found".to_string()))?;

    let service_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let protocol = body.local_protocol.as_deref().unwrap_or("http");
    let path = body.public_path.as_deref().unwrap_or("/");
    let allowed_ips_json = body.allowed_ips.as_ref().map(|ips| serde_json::to_string(ips).unwrap_or_default());

    sqlx::query(
        "INSERT INTO exposed_services (id, tunnel_id, service_name, local_port, local_protocol, public_subdomain, public_path, require_auth, allowed_ips, rate_limit_rpm, custom_domain, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&service_id)
    .bind(&body.tunnel_id)
    .bind(&body.service_name)
    .bind(body.local_port)
    .bind(protocol)
    .bind(&body.public_subdomain)
    .bind(path)
    .bind(body.require_auth.unwrap_or(true))
    .bind(&allowed_ips_json)
    .bind(body.rate_limit_rpm.unwrap_or(120))
    .bind(&body.custom_domain)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let service: ExposedService = sqlx::query_as("SELECT * FROM exposed_services WHERE id = ?")
        .bind(&service_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    info!("Service exposed: {} ({}) via tunnel {}", body.service_name, service_id, body.tunnel_id);

    Ok(Json(service))
}

async fn list_services(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ExposedService>>, (StatusCode, String)> {
    let services: Vec<ExposedService> = sqlx::query_as(
        "SELECT * FROM exposed_services ORDER BY tunnel_id, service_name"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(services))
}

async fn get_service(
    State(state): State<Arc<AppState>>,
    Path(service_id): Path<String>,
) -> Result<Json<ExposedService>, (StatusCode, String)> {
    let service: ExposedService = sqlx::query_as("SELECT * FROM exposed_services WHERE id = ?")
        .bind(&service_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Service not found".to_string()))?;
    Ok(Json(service))
}

async fn update_service(
    State(state): State<Arc<AppState>>,
    Path(service_id): Path<String>,
    Json(body): Json<UpdateServiceRequest>,
) -> Result<Json<ExposedService>, (StatusCode, String)> {
    let _existing: ExposedService = sqlx::query_as("SELECT * FROM exposed_services WHERE id = ?")
        .bind(&service_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Service not found".to_string()))?;

    let now = Utc::now().to_rfc3339();

    if let Some(active) = body.is_active {
        sqlx::query("UPDATE exposed_services SET is_active = ?, updated_at = ? WHERE id = ?")
            .bind(active).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }
    if let Some(auth) = body.require_auth {
        sqlx::query("UPDATE exposed_services SET require_auth = ?, updated_at = ? WHERE id = ?")
            .bind(auth).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }
    if let Some(ref ips) = body.allowed_ips {
        let json = serde_json::to_string(ips).unwrap_or_default();
        sqlx::query("UPDATE exposed_services SET allowed_ips = ?, updated_at = ? WHERE id = ?")
            .bind(&json).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }
    if let Some(ref users) = body.allowed_users {
        let json = serde_json::to_string(users).unwrap_or_default();
        sqlx::query("UPDATE exposed_services SET allowed_users = ?, updated_at = ? WHERE id = ?")
            .bind(&json).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }
    if let Some(rpm) = body.rate_limit_rpm {
        sqlx::query("UPDATE exposed_services SET rate_limit_rpm = ?, updated_at = ? WHERE id = ?")
            .bind(rpm).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }
    if let Some(ref subdomain) = body.public_subdomain {
        sqlx::query("UPDATE exposed_services SET public_subdomain = ?, updated_at = ? WHERE id = ?")
            .bind(subdomain).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }
    if let Some(ref path) = body.public_path {
        sqlx::query("UPDATE exposed_services SET public_path = ?, updated_at = ? WHERE id = ?")
            .bind(path).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }
    if let Some(ref domain) = body.custom_domain {
        sqlx::query("UPDATE exposed_services SET custom_domain = ?, updated_at = ? WHERE id = ?")
            .bind(domain).bind(&now).bind(&service_id).execute(&state.db).await.ok();
    }

    let updated: ExposedService = sqlx::query_as("SELECT * FROM exposed_services WHERE id = ?")
        .bind(&service_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(updated))
}

async fn remove_service(
    State(state): State<Arc<AppState>>,
    Path(service_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    sqlx::query("DELETE FROM exposed_services WHERE id = ?")
        .bind(&service_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "removed": true })))
}

async fn check_service_health(
    State(state): State<Arc<AppState>>,
    Path(service_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let service: ExposedService = sqlx::query_as("SELECT * FROM exposed_services WHERE id = ?")
        .bind(&service_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Service not found".to_string()))?;

    let tunnel: Tunnel = sqlx::query_as("SELECT * FROM tunnels WHERE id = ?")
        .bind(&service.tunnel_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let url = format!("{}://{}:{}/health",
        service.local_protocol, tunnel.assigned_ip, service.local_port);

    let result = state.http_client.get(&url).timeout(std::time::Duration::from_secs(5)).send().await;

    let (status, message) = match result {
        Ok(resp) if resp.status().is_success() => ("healthy".to_string(), "Service responding".to_string()),
        Ok(resp) => ("degraded".to_string(), format!("HTTP {}", resp.status())),
        Err(e) => ("unhealthy".to_string(), format!("Connection failed: {}", e)),
    };

    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE exposed_services SET health_status = ?, last_health_check = ?, updated_at = ? WHERE id = ?")
        .bind(&status)
        .bind(&now)
        .bind(&now)
        .bind(&service_id)
        .execute(&state.db)
        .await
        .ok();

    Ok(Json(serde_json::json!({
        "service_id": service_id,
        "health_status": status,
        "message": message,
        "checked_at": now,
    })))
}

// ─── Admin: Pairing Tokens ─────────────────────────────────────────────────

async fn create_pairing_token(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreatePairingTokenRequest>,
) -> Result<Json<PairingTokenResponse>, (StatusCode, String)> {
    let user_id = extract_admin_user(&headers, &state.jwt_secret)?;

    let token_id = Uuid::new_v4().to_string();
    let raw_token = format!("iora-pair-{}", Uuid::new_v4());
    let token_hash = hash_string(&raw_token);
    let hours = body.expires_in_hours.unwrap_or(24);
    let expires_at = (Utc::now() + chrono::Duration::hours(hours)).to_rfc3339();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO pairing_tokens (id, token_hash, label, created_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&token_id)
    .bind(&token_hash)
    .bind(&body.label)
    .bind(&user_id)
    .bind(&expires_at)
    .bind(&now)
    .execute(&state.db)
    .await
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
    let tokens: Vec<PairingToken> = sqlx::query_as(
        "SELECT * FROM pairing_tokens ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(tokens))
}

async fn revoke_pairing_token(
    State(state): State<Arc<AppState>>,
    Path(token_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    sqlx::query("DELETE FROM pairing_tokens WHERE id = ?")
        .bind(&token_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "revoked": true })))
}

// ─── Admin: Access Log ──────────────────────────────────────────────────────

async fn get_access_log(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AccessLogQuery>,
) -> Result<Json<Vec<AccessLogEntry>>, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(100).min(1000);

    let entries: Vec<AccessLogEntry> = if let Some(ref sid) = query.service_id {
        sqlx::query_as("SELECT * FROM access_log WHERE service_id = ? ORDER BY created_at DESC LIMIT ?")
            .bind(sid)
            .bind(limit)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else if let Some(ref tid) = query.tunnel_id {
        sqlx::query_as("SELECT * FROM access_log WHERE tunnel_id = ? ORDER BY created_at DESC LIMIT ?")
            .bind(tid)
            .bind(limit)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        sqlx::query_as("SELECT * FROM access_log ORDER BY created_at DESC LIMIT ?")
            .bind(limit)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    Ok(Json(entries))
}

// ─── Admin: Blocked IPs ────────────────────────────────────────────────────

async fn list_blocked_ips(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT ip, reason, blocked_until, created_at FROM blocked_ips ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let result: Vec<serde_json::Value> = rows.into_iter().map(|(ip, reason, until, created)| {
        serde_json::json!({ "ip": ip, "reason": reason, "blocked_until": until, "created_at": created })
    }).collect();

    Ok(Json(result))
}

async fn block_ip(
    State(state): State<Arc<AppState>>,
    Path(ip): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let reason = body.get("reason").and_then(|v| v.as_str()).unwrap_or("manual block");
    let until = body.get("blocked_until").and_then(|v| v.as_str());

    sqlx::query(
        "INSERT OR REPLACE INTO blocked_ips (ip, reason, blocked_until) VALUES (?, ?, ?)"
    )
    .bind(&ip)
    .bind(reason)
    .bind(until)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "blocked": true, "ip": ip })))
}

async fn unblock_ip(
    State(state): State<Arc<AppState>>,
    Path(ip): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    sqlx::query("DELETE FROM blocked_ips WHERE ip = ?")
        .bind(&ip)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "unblocked": true })))
}

// ─── Admin: Config ──────────────────────────────────────────────────────────

async fn get_config(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ConnectorConfigEntry>>, (StatusCode, String)> {
    let configs: Vec<ConnectorConfigEntry> = sqlx::query_as("SELECT * FROM connector_config ORDER BY key")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(configs))
}

async fn update_config(
    State(state): State<Arc<AppState>>,
    Json(body): Json<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let now = Utc::now().to_rfc3339();
    for (key, value) in &body {
        sqlx::query(
            "INSERT INTO connector_config (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?"
        )
        .bind(key)
        .bind(value)
        .bind(&now)
        .bind(value)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    Ok(Json(serde_json::json!({ "updated": body.len() })))
}

// ─── Proxy: Route external traffic to local IORA ────────────────────────────

async fn proxy_request(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let start = Instant::now();
    let source_ip = addr.ip().to_string();

    // Check blocked IPs
    let blocked: Option<(String,)> = sqlx::query_as(
        "SELECT ip FROM blocked_ips WHERE ip = ? AND (blocked_until IS NULL OR blocked_until > datetime('now'))"
    )
    .bind(&source_ip)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if blocked.is_some() {
        return Err((StatusCode::FORBIDDEN, "IP blocked".to_string()));
    }

    // Extract subdomain and path from URI
    let path = uri.path().strip_prefix("/proxy/").unwrap_or(uri.path());
    let parts: Vec<&str> = path.splitn(2, '/').collect();
    let subdomain = parts.first().unwrap_or(&"");
    let remaining_path = if parts.len() > 1 { parts[1] } else { "" };

    // Find matching service
    let service: ExposedService = sqlx::query_as(
        "SELECT * FROM exposed_services WHERE public_subdomain = ? AND is_active = 1"
    )
    .bind(subdomain)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Service not found".to_string()))?;

    // Get tunnel
    let tunnel: Tunnel = sqlx::query_as("SELECT * FROM tunnels WHERE id = ?")
        .bind(&service.tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, "Tunnel not found".to_string()))?;

    if tunnel.status != "connected" {
        return Err((StatusCode::BAD_GATEWAY, "Tunnel disconnected".to_string()));
    }

    // Check IP allowlist
    if let Some(ref allowed) = service.allowed_ips {
        if let Ok(ips) = serde_json::from_str::<Vec<String>>(allowed) {
            if !ips.is_empty() && !ips.contains(&source_ip) {
                return Err((StatusCode::FORBIDDEN, "IP not allowed".to_string()));
            }
        }
    }

    // Forward request to local IORA service via VPN
    let target_url = format!(
        "{}://{}:{}/{}",
        service.local_protocol, tunnel.assigned_ip, service.local_port, remaining_path
    );

    let query_string = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();
    let full_url = format!("{}{}", target_url, query_string);

    let req_method = reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut proxy_req = state.http_client.request(req_method, &full_url);

    // Forward relevant headers (convert between http crate versions)
    for (name, value) in headers.iter() {
        if !matches!(
            name.as_str(),
            "host" | "connection" | "transfer-encoding"
        ) {
            if let Ok(val_str) = value.to_str() {
                proxy_req = proxy_req.header(name.as_str(), val_str);
            }
        }
    }
    proxy_req = proxy_req.header("X-Forwarded-For", &source_ip);
    proxy_req = proxy_req.header("X-Real-IP", &source_ip);
    proxy_req = proxy_req.header("X-Forwarded-Proto", "https");

    // Send body
    let body_bytes = axum::body::to_bytes(body, 10 * 1024 * 1024)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Body read error: {}", e)))?;

    if !body_bytes.is_empty() {
        proxy_req = proxy_req.body(body_bytes.clone());
    }

    let response = proxy_req.send().await.map_err(|e| {
        (StatusCode::BAD_GATEWAY, format!("Upstream error: {}", e))
    })?;

    let status_code = response.status().as_u16() as i32;
    let resp_headers = response.headers().clone();
    let resp_bytes = response.bytes().await.map_err(|e| {
        (StatusCode::BAD_GATEWAY, format!("Response read error: {}", e))
    })?;

    let elapsed = start.elapsed().as_millis() as i32;

    // Log access
    let log_id = Uuid::new_v4().to_string();
    let user_agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO access_log (id, service_id, tunnel_id, method, path, query_string, source_ip, user_agent, status_code, response_time_ms, bytes_transferred, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&log_id)
    .bind(&service.id)
    .bind(&service.tunnel_id)
    .bind(method.as_str())
    .bind(path)
    .bind(uri.query())
    .bind(&source_ip)
    .bind(&user_agent)
    .bind(status_code)
    .bind(elapsed)
    .bind(resp_bytes.len() as i64)
    .bind(&now)
    .execute(&state.db)
    .await
    .ok();

    // Build response
    let mut axum_resp = (
        StatusCode::from_u16(status_code as u16).unwrap_or(StatusCode::BAD_GATEWAY),
        resp_bytes.to_vec(),
    ).into_response();

    // Copy relevant response headers (convert between http crate versions)
    for (name, value) in resp_headers.iter() {
        if !matches!(name.as_str(), "transfer-encoding" | "connection") {
            if let (Ok(n), Ok(v)) = (
                axum::http::HeaderName::from_bytes(name.as_str().as_bytes()),
                axum::http::HeaderValue::from_str(value.to_str().unwrap_or_default()),
            ) {
                axum_resp.headers_mut().insert(n, v);
            }
        }
    }

    Ok(axum_resp)
}

// ─── Middleware ──────────────────────────────────────────────────────────────

async fn admin_auth_middleware(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Result<axum::response::Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..],
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    match auth::verify_admin_token(token, &state.jwt_secret) {
        Ok(_) => Ok(next.run(request).await),
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn extract_admin_user(headers: &HeaderMap, jwt_secret: &str) -> Result<String, (StatusCode, String)> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing Authorization".to_string()))?;
    let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, "Invalid Authorization format".to_string())
    })?;
    auth::verify_admin_token(token, jwt_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))
}

fn hash_string(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

async fn allocate_vpn_ip(state: &AppState) -> Result<String, (StatusCode, String)> {
    // Get existing assigned IPs
    let existing: Vec<(String,)> = sqlx::query_as("SELECT assigned_ip FROM tunnels")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let used_ips: Vec<String> = existing.into_iter().map(|(ip,)| ip).collect();

    // Allocate from 10.100.0.2 to 10.100.0.254 (10.100.0.1 is server)
    for i in 2..=254 {
        let candidate = format!("10.100.0.{}", i);
        if !used_ips.contains(&candidate) {
            return Ok(candidate);
        }
    }

    Err((StatusCode::INSUFFICIENT_STORAGE, "No VPN IPs available".to_string()))
}

async fn cleanup_old_logs(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        let cutoff = (Utc::now() - chrono::Duration::days(30)).to_rfc3339();
        if let Err(e) = sqlx::query("DELETE FROM access_log WHERE created_at < ?")
            .bind(&cutoff)
            .execute(&state.db)
            .await
        {
            warn!("Failed to clean old access logs: {}", e);
        }
    }
}
