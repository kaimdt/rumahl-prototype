//! IORA Network Monitor Service
//!
//! This service monitors the local network to discover devices and track IP activity.
//! It listens to DHCP requests, ARP packets, and maintains a database of known devices.
//!
//! Key Features:
//! - DHCP packet monitoring
//! - ARP table scanning
//! - Network device discovery
//! - IP activity tracking with last seen timestamps
//! - Configurable monitoring (can be disabled in settings)
//! - REST API for querying network state

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use iora_shared_config::system_config;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};
use tracing::{error, info};
use uuid::Uuid;

use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use tower_http::cors::CorsLayer;

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_PORT: u16 = 8103;
const SCAN_INTERVAL_SECS: u64 = 60; // Scan network every 60 seconds

// ─── Data Structures ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct NetworkDevice {
    id: Uuid,
    ip_address: String,
    mac_address: Option<String>,
    hostname: Option<String>,
    vendor: Option<String>,
    device_type: Option<String>,
    first_seen: DateTime<Utc>,
    last_seen: DateTime<Utc>,
    is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
struct NetworkStats {
    total_devices: i64,
    active_devices: i64,
    inactive_devices: i64,
    last_scan: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
struct AppState {
    db: PgPool,
    monitoring_enabled: Arc<RwLock<bool>>,
    devices: Arc<RwLock<HashMap<String, NetworkDevice>>>,
    last_scan: Arc<RwLock<Option<DateTime<Utc>>>>,
}

#[derive(Debug, Deserialize)]
struct MonitoringConfig {
    enabled: bool,
}

// ─── Network Monitoring ─────────────────────────────────────────────────────

/// Scan ARP table to discover devices
async fn scan_arp_table(_state: &AppState) -> Result<Vec<NetworkDevice>> {
    info!("Scanning ARP table for network devices...");

    #[cfg(target_os = "linux")]
    let mut devices = Vec::new();
    #[cfg(not(target_os = "linux"))]
    let devices = Vec::new();

    // On Linux, read /proc/net/arp
    #[cfg(target_os = "linux")]
    {
        use std::fs;

        let arp_content =
            fs::read_to_string("/proc/net/arp").context("Failed to read ARP table")?;

        for line in arp_content.lines().skip(1) {
            // Skip header
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 6 {
                let ip = parts[0];
                let mac = parts[3];

                // Skip incomplete entries
                if mac != "00:00:00:00:00:00" && mac.contains(':') {
                    let device = NetworkDevice {
                        id: Uuid::new_v4(),
                        ip_address: ip.to_string(),
                        mac_address: Some(mac.to_string()),
                        hostname: None,
                        vendor: None,
                        device_type: None,
                        first_seen: Utc::now(),
                        last_seen: Utc::now(),
                        is_active: true,
                    };

                    devices.push(device);
                }
            }
        }
    }

    info!("Found {} devices in ARP table", devices.len());
    Ok(devices)
}

/// Try to resolve hostname for an IP address
async fn resolve_hostname(ip: &str) -> Option<String> {
    use std::process::Command;

    // Use nslookup or host command
    let output = Command::new("host").arg(ip).output().ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Parse hostname from output
        for line in stdout.lines() {
            if line.contains("domain name pointer") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(hostname) = parts.last() {
                    return Some(hostname.trim_end_matches('.').to_string());
                }
            }
        }
    }

    None
}

/// Update device in database
async fn update_device_in_db(pool: &PgPool, device: &NetworkDevice) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO network_devices (id, ip_address, mac_address, hostname, vendor, device_type, first_seen, last_seen, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (ip_address)
        DO UPDATE SET
            mac_address = COALESCE(EXCLUDED.mac_address, network_devices.mac_address),
            hostname = COALESCE(EXCLUDED.hostname, network_devices.hostname),
            vendor = COALESCE(EXCLUDED.vendor, network_devices.vendor),
            device_type = COALESCE(EXCLUDED.device_type, network_devices.device_type),
            last_seen = EXCLUDED.last_seen,
            is_active = EXCLUDED.is_active
        "#,
    )
    .bind(device.id)
    .bind(&device.ip_address)
    .bind(&device.mac_address)
    .bind(&device.hostname)
    .bind(&device.vendor)
    .bind(&device.device_type)
    .bind(device.first_seen)
    .bind(device.last_seen)
    .bind(device.is_active)
    .execute(pool)
    .await
    .context("Failed to update device in database")?;

    Ok(())
}

/// Mark inactive devices (not seen in last scan)
async fn mark_inactive_devices(pool: &PgPool, active_ips: &[String]) -> Result<()> {
    let active_ips_array: Vec<String> = active_ips.to_vec();

    sqlx::query(
        r#"
        UPDATE network_devices
        SET is_active = false
        WHERE ip_address != ALL($1)
        "#,
    )
    .bind(&active_ips_array)
    .execute(pool)
    .await
    .context("Failed to mark inactive devices")?;

    Ok(())
}

/// Network monitoring loop
async fn network_monitoring_loop(state: AppState) -> Result<()> {
    let mut scan_timer = interval(Duration::from_secs(SCAN_INTERVAL_SECS));

    loop {
        scan_timer.tick().await;

        // Check if monitoring is enabled
        let enabled = *state.monitoring_enabled.read().await;
        if !enabled {
            info!("Network monitoring is disabled, skipping scan");
            continue;
        }

        info!("Starting network scan...");

        match scan_arp_table(&state).await {
            Ok(mut devices) => {
                let mut active_ips = Vec::new();

                for device in &mut devices {
                    active_ips.push(device.ip_address.clone());

                    // Try to resolve hostname
                    if device.hostname.is_none() {
                        device.hostname = resolve_hostname(&device.ip_address).await;
                    }

                    // Update device in database
                    if let Err(e) = update_device_in_db(&state.db, device).await {
                        error!("Failed to update device {}: {}", device.ip_address, e);
                    }

                    // Update in-memory cache
                    state
                        .devices
                        .write()
                        .await
                        .insert(device.ip_address.clone(), device.clone());
                }

                // Mark devices not in this scan as inactive
                if let Err(e) = mark_inactive_devices(&state.db, &active_ips).await {
                    error!("Failed to mark inactive devices: {}", e);
                }

                // Update last scan time
                *state.last_scan.write().await = Some(Utc::now());

                info!("Network scan completed: {} devices found", devices.len());
            }
            Err(e) => {
                error!("Network scan failed: {}", e);
            }
        }
    }
}

// ─── API Endpoints ──────────────────────────────────────────────────────────

/// Health check
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "iora-network-monitor",
        "status": "healthy",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Get all network devices
async fn list_devices(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query_as::<_, NetworkDevice>(
        "SELECT * FROM network_devices ORDER BY last_seen DESC",
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(devices) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "devices": devices,
                "total": devices.len(),
                "timestamp": Utc::now().to_rfc3339(),
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to fetch devices: {}", e)
            })),
        )
            .into_response(),
    }
}

/// Get active devices only
async fn list_active_devices(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query_as::<_, NetworkDevice>(
        "SELECT * FROM network_devices WHERE is_active = true ORDER BY last_seen DESC",
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(devices) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "devices": devices,
                "total": devices.len(),
                "timestamp": Utc::now().to_rfc3339(),
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to fetch active devices: {}", e)
            })),
        )
            .into_response(),
    }
}

/// Get network statistics
async fn get_stats(State(state): State<AppState>) -> impl IntoResponse {
    let total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM network_devices")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let active =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM network_devices WHERE is_active = true")
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

    let last_scan = *state.last_scan.read().await;

    Json(NetworkStats {
        total_devices: total,
        active_devices: active,
        inactive_devices: total - active,
        last_scan,
    })
}

/// Get monitoring status
async fn get_monitoring_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let enabled = *state.monitoring_enabled.read().await;

    Json(serde_json::json!({
        "enabled": enabled,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Set monitoring status
async fn set_monitoring_status(
    State(state): State<AppState>,
    Json(config): Json<MonitoringConfig>,
) -> impl IntoResponse {
    *state.monitoring_enabled.write().await = config.enabled;

    info!(
        "Network monitoring {}",
        if config.enabled {
            "enabled"
        } else {
            "disabled"
        }
    );

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "enabled": config.enabled,
            "message": format!("Network monitoring {}", if config.enabled { "enabled" } else { "disabled" }),
        })),
    )
}

/// Trigger manual network scan
async fn trigger_scan(State(state): State<AppState>) -> impl IntoResponse {
    let enabled = *state.monitoring_enabled.read().await;

    if !enabled {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Network monitoring is disabled"
            })),
        )
            .into_response();
    }

    // Trigger scan in background
    let state_clone = state.clone();
    tokio::spawn(async move {
        if let Err(e) = scan_arp_table(&state_clone).await {
            error!("Manual scan failed: {}", e);
        }
    });

    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "message": "Network scan triggered"
        })),
    )
        .into_response()
}

// ─── Database Setup ─────────────────────────────────────────────────────────

async fn init_database(pool: &PgPool) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS network_devices (
            id UUID PRIMARY KEY,
            ip_address VARCHAR(45) UNIQUE NOT NULL,
            mac_address VARCHAR(17),
            hostname VARCHAR(255),
            vendor VARCHAR(255),
            device_type VARCHAR(50),
            first_seen TIMESTAMP WITH TIME ZONE NOT NULL,
            last_seen TIMESTAMP WITH TIME ZONE NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create network_devices table")?;

    // Create indexes for performance
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_network_devices_ip ON network_devices(ip_address)")
        .execute(pool)
        .await
        .ok();

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_network_devices_active ON network_devices(is_active)",
    )
    .execute(pool)
    .await
    .ok();

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_network_devices_last_seen ON network_devices(last_seen DESC)")
        .execute(pool)
        .await
        .ok();

    info!("Database initialized successfully");
    Ok(())
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "iora_network_monitor=info".to_string()),
        )
        .init();

    info!("Starting IORA Network Monitor service...");

    // Load environment
    dotenv::dotenv().ok();

    // Database connection
    let database_url = system_config::database_url();

    let pool = PgPool::connect(&database_url)
        .await
        .context("Failed to connect to database")?;

    info!("Connected to database");

    // Initialize database schema
    init_database(&pool).await?;

    // Create app state
    let state = AppState {
        db: pool,
        monitoring_enabled: Arc::new(RwLock::new(true)), // Enabled by default
        devices: Arc::new(RwLock::new(HashMap::new())),
        last_scan: Arc::new(RwLock::new(None)),
    };

    // Spawn network monitoring loop
    let state_clone = state.clone();
    tokio::spawn(async move {
        if let Err(e) = network_monitoring_loop(state_clone).await {
            error!("Network monitoring loop failed: {}", e);
        }
    });

    // Build router
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/network/devices", get(list_devices))
        .route("/api/network/devices/active", get(list_active_devices))
        .route("/api/network/stats", get(get_stats))
        .route(
            "/api/network/monitoring",
            get(get_monitoring_status).post(set_monitoring_status),
        )
        .route("/api/network/scan", axum::routing::post(trigger_scan))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], DEFAULT_PORT));
    info!("iora-network-monitor listening on {}", addr);
    let _hb = iora_shared_heartbeat::spawn_default(
        "iora-network-monitor",
        addr.port(),
        "LAN/WAN network monitor",
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
