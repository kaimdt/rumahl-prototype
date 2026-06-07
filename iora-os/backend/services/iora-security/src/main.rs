use std::{collections::HashMap, sync::Arc, time::Instant};

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use iora_shared::env::IoraEnv;
use iora_shared::system_config;
use ipnetwork::IpNetwork;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Postgres, Row, SqlitePool};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── State ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    security_db: Arc<SqlitePool>, // Encrypted SQLite for security logs
    postgres_admin: Arc<Pool<Postgres>>, // PostgreSQL with admin privileges
    encryption_key: Arc<[u8; 32]>, // AES-256 key for SQLite encryption
    lockdown_state: Arc<RwLock<LockdownState>>,
    started_at: Arc<Instant>,
    whitelist: Arc<RwLock<Vec<IpNetwork>>>,
    threat_cache: Arc<RwLock<HashMap<String, ThreatInfo>>>,
}

#[derive(Debug, Clone)]
struct LockdownState {
    is_locked: bool,
    level: u8, // 0=normal, 1=warning, 2=suspicious, 3=confirmed, 4=critical
    triggered_at: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThreatInfo {
    ip_address: String,
    threat_level: i32,
    incident_count: i32,
    blocked: bool,
    last_seen: String,
}

// ─── Data Structures ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct SecurityEvent {
    id: Option<i64>,
    timestamp: String,
    event_type: String,
    severity: String,
    source_ip: Option<String>,
    service_name: Option<String>,
    user_id: Option<String>,
    event_data: Option<String>,
    hash: String,
    prev_hash: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct DatabaseConnection {
    id: Option<i64>,
    timestamp: String,
    pid: Option<i32>,
    source_ip: Option<String>,
    database_name: Option<String>,
    username: Option<String>,
    application_name: Option<String>,
    is_authorized: bool,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct PostgresUser {
    username: String,
    service_name: String,
    database_name: String,
    created_at: String,
    rotation_count: i32,
    next_rotation_due: String,
    is_active: bool,
}

#[derive(Debug, Deserialize)]
struct CreateUserRequest {
    service_name: String,
    database_name: String,
    permissions: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct WhitelistRequest {
    ip_address: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LockdownRequest {
    level: u8,
    reason: String,
}

// ─── Encryption & Hashing ────────────────────────────────────────────────────

fn encrypt_data(key: &[u8; 32], plaintext: &str) -> Result<String> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(hex::encode(combined))
}

#[allow(dead_code)]
fn decrypt_data(key: &[u8; 32], encrypted_hex: &str) -> Result<String> {
    let combined = hex::decode(encrypted_hex)?;
    if combined.len() < 12 {
        anyhow::bail!("Invalid encrypted data");
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).context("Invalid UTF-8")
}

fn compute_event_hash(event: &SecurityEvent) -> String {
    let data = format!(
        "{}|{}|{}|{}|{}|{}",
        event.timestamp,
        event.event_type,
        event.severity,
        event.source_ip.as_deref().unwrap_or(""),
        event.service_name.as_deref().unwrap_or(""),
        event.prev_hash.as_deref().unwrap_or("")
    );
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

// ─── Security Logging ────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn log_security_event(
    db: &SqlitePool,
    key: &[u8; 32],
    event_type: &str,
    severity: &str,
    source_ip: Option<&str>,
    service_name: Option<&str>,
    user_id: Option<&str>,
    event_data: Option<&str>,
) -> Result<()> {
    // Get previous hash for chain
    let prev_hash: Option<String> =
        sqlx::query_scalar("SELECT hash FROM security_events ORDER BY id DESC LIMIT 1")
            .fetch_optional(db)
            .await?;

    // Encrypt sensitive event data
    let encrypted_data = if let Some(data) = event_data {
        Some(encrypt_data(key, data)?)
    } else {
        None
    };

    let mut event = SecurityEvent {
        id: None,
        timestamp: Utc::now().to_rfc3339(),
        event_type: event_type.to_string(),
        severity: severity.to_string(),
        source_ip: source_ip.map(String::from),
        service_name: service_name.map(String::from),
        user_id: user_id.map(String::from),
        event_data: encrypted_data,
        hash: String::new(),
        prev_hash,
    };

    event.hash = compute_event_hash(&event);

    sqlx::query(
        "INSERT INTO security_events (timestamp, event_type, severity, source_ip, service_name, user_id, event_data, hash, prev_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&event.timestamp)
    .bind(&event.event_type)
    .bind(&event.severity)
    .bind(&event.source_ip)
    .bind(&event.service_name)
    .bind(&event.user_id)
    .bind(&event.event_data)
    .bind(&event.hash)
    .bind(&event.prev_hash)
    .execute(db)
    .await?;

    Ok(())
}

// ─── PostgreSQL Connection Monitoring ────────────────────────────────────────

async fn monitor_postgres_connections(state: AppState) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

    loop {
        interval.tick().await;

        if let Err(e) = check_database_connections(&state).await {
            error!("Failed to check database connections: {}", e);
        }
    }
}

async fn check_database_connections(state: &AppState) -> Result<()> {
    // Query pg_stat_activity for all active connections
    let rows = sqlx::query(
        "SELECT pid, usename, application_name, client_addr::text, datname, state, query_start
         FROM pg_stat_activity
         WHERE datname IS NOT NULL AND pid != pg_backend_pid()",
    )
    .fetch_all(&*state.postgres_admin)
    .await?;

    let whitelist = state.whitelist.read().await;

    for row in rows {
        let client_addr: Option<String> = row.try_get("client_addr").ok();
        let username: Option<String> = row.try_get("usename").ok();
        let database: Option<String> = row.try_get("datname").ok();
        let pid: Option<i32> = row.try_get("pid").ok();
        let app_name: Option<String> = row.try_get("application_name").ok();

        // Known IORA service users are always authorized – never block ourselves
        let is_known_service_user = username
            .as_deref()
            .is_some_and(|u| matches!(u, "iora" | "postgres") || u.starts_with("iora_"));

        // Check if connection is authorized
        let is_authorized = is_known_service_user
            || if let Some(ref addr_str) = client_addr {
                // Local connections are always authorized
                if addr_str == "127.0.0.1" || addr_str == "::1" || addr_str.is_empty() {
                    true
                } else {
                    // Check against whitelist
                    whitelist.iter().any(|net| {
                        addr_str
                            .parse::<std::net::IpAddr>()
                            .ok()
                            .map(|ip| net.contains(ip))
                            .unwrap_or(false)
                    })
                }
            } else {
                true // Unix socket connections
            };

        // Log unauthorized connections
        if !is_authorized {
            warn!(
                "Unauthorized database connection detected: IP={}, user={}, database={}",
                client_addr.as_deref().unwrap_or("unknown"),
                username.as_deref().unwrap_or("unknown"),
                database.as_deref().unwrap_or("unknown")
            );

            log_security_event(
                &state.security_db,
                &state.encryption_key,
                "unauthorized_connection",
                "critical",
                client_addr.as_deref(),
                None,
                username.as_deref(),
                Some(&format!(
                    "{{\"database\":\"{}\",\"application\":\"{}\"}}",
                    database.as_deref().unwrap_or("unknown"),
                    app_name.as_deref().unwrap_or("unknown")
                )),
            )
            .await
            .ok();

            // Update threat intelligence
            if let Some(ip) = client_addr.as_ref() {
                update_threat_level(state, ip, 3).await;
            }

            // Trigger alert
            create_alert(
                &state.security_db,
                "unauthorized_connection",
                "critical",
                "Unauthorized Database Connection",
                &format!(
                    "Unknown IP {} connected to database {}",
                    client_addr.as_deref().unwrap_or("unknown"),
                    database.as_deref().unwrap_or("unknown")
                ),
            )
            .await
            .ok();
        }

        // Store connection info
        sqlx::query(
            "INSERT INTO database_connections (timestamp, pid, source_ip, database_name, username, application_name, is_authorized, connected_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(Utc::now().to_rfc3339())
        .bind(pid)
        .bind(client_addr)
        .bind(database)
        .bind(username)
        .bind(app_name)
        .bind(is_authorized)
        .bind(Utc::now().to_rfc3339())
        .execute(&*state.security_db)
        .await
        .ok();
    }

    Ok(())
}

// ─── PostgreSQL User Management ──────────────────────────────────────────────

async fn create_postgres_user(
    state: &AppState,
    service_name: &str,
    database_name: &str,
    permissions: &[String],
) -> Result<(String, String)> {
    let username = format!(
        "iora_{}_{}",
        service_name,
        Uuid::new_v4().to_string()[..8].to_lowercase()
    );

    // Generate secure password
    let mut password_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut password_bytes);
    let password = hex::encode(password_bytes);

    // Create user in PostgreSQL
    sqlx::query(&format!(
        "CREATE USER {} WITH PASSWORD '{}'",
        username, password
    ))
    .execute(&*state.postgres_admin)
    .await?;

    // Grant permissions
    for perm in permissions {
        let grant_query = match perm.as_str() {
            "read" => format!(
                "GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}",
                username
            ),
            "write" => format!(
                "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO {}",
                username
            ),
            "full" => format!(
                "GRANT ALL PRIVILEGES ON DATABASE {} TO {}",
                database_name, username
            ),
            _ => continue,
        };
        sqlx::query(&grant_query)
            .execute(&*state.postgres_admin)
            .await
            .ok();
    }

    // Set default permissions for future tables
    sqlx::query(&format!(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {}",
        username
    ))
    .execute(&*state.postgres_admin)
    .await
    .ok();

    // Calculate next rotation (30 days from now)
    let next_rotation = chrono::Utc::now() + chrono::Duration::days(30);

    // Store user info in security database
    let encrypted_password = encrypt_data(&state.encryption_key, &password)?;
    sqlx::query(
        "INSERT INTO postgres_users (username, service_name, database_name, created_at, rotation_count, next_rotation_due, is_active, password_hash, permissions)
         VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?)"
    )
    .bind(&username)
    .bind(service_name)
    .bind(database_name)
    .bind(Utc::now().to_rfc3339())
    .bind(next_rotation.to_rfc3339())
    .bind(encrypted_password)
    .bind(serde_json::to_string(permissions)?)
    .execute(&*state.security_db)
    .await?;

    log_security_event(
        &state.security_db,
        &state.encryption_key,
        "user_rotation",
        "info",
        None,
        Some(service_name),
        Some(&username),
        Some(&format!(
            "{{\"action\":\"create\",\"database\":\"{}\"}}",
            database_name
        )),
    )
    .await?;

    info!(
        "Created PostgreSQL user: {} for service: {}",
        username, service_name
    );

    Ok((username, password))
}

async fn rotate_user_credentials(state: &AppState, username: &str) -> Result<String> {
    // Generate new password
    let mut password_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut password_bytes);
    let new_password = hex::encode(password_bytes);

    // Update password in PostgreSQL
    sqlx::query(&format!(
        "ALTER USER {} WITH PASSWORD '{}'",
        username, new_password
    ))
    .execute(&*state.postgres_admin)
    .await?;

    // Update in security database
    let encrypted_password = encrypt_data(&state.encryption_key, &new_password)?;
    let next_rotation = chrono::Utc::now() + chrono::Duration::days(30);

    sqlx::query(
        "UPDATE postgres_users SET rotated_at = ?, rotation_count = rotation_count + 1, next_rotation_due = ?, password_hash = ?
         WHERE username = ?"
    )
    .bind(Utc::now().to_rfc3339())
    .bind(next_rotation.to_rfc3339())
    .bind(encrypted_password)
    .bind(username)
    .execute(&*state.security_db)
    .await?;

    log_security_event(
        &state.security_db,
        &state.encryption_key,
        "user_rotation",
        "info",
        None,
        None,
        Some(username),
        Some("{\"action\":\"rotate\"}"),
    )
    .await?;

    info!("Rotated credentials for user: {}", username);

    Ok(new_password)
}

async fn auto_rotate_credentials(state: AppState) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600)); // Check hourly

    loop {
        interval.tick().await;

        let now = Utc::now().to_rfc3339();
        let rows = sqlx::query(
            "SELECT username FROM postgres_users WHERE is_active = 1 AND next_rotation_due < ?",
        )
        .bind(&now)
        .fetch_all(&*state.security_db)
        .await;

        if let Ok(users) = rows {
            for row in users {
                if let Ok(username) = row.try_get::<String, _>("username") {
                    if let Err(e) = rotate_user_credentials(&state, &username).await {
                        error!("Failed to rotate credentials for {}: {}", username, e);
                    }
                }
            }
        }
    }
}

// ─── Threat Intelligence ─────────────────────────────────────────────────────

async fn update_threat_level(state: &AppState, ip: &str, increase_by: i32) {
    let mut cache = state.threat_cache.write().await;

    let threat = cache.entry(ip.to_string()).or_insert(ThreatInfo {
        ip_address: ip.to_string(),
        threat_level: 0,
        incident_count: 0,
        blocked: false,
        last_seen: Utc::now().to_rfc3339(),
    });

    threat.threat_level += increase_by;
    threat.incident_count += 1;
    threat.last_seen = Utc::now().to_rfc3339();

    // Auto-block if threat level exceeds threshold
    if threat.threat_level >= 7 && !threat.blocked {
        threat.blocked = true;
        warn!(
            "Auto-blocking IP {} due to threat level {}",
            ip, threat.threat_level
        );

        // Trigger lockdown if critical
        if threat.threat_level >= 9 {
            trigger_lockdown(state, 3, &format!("Critical threat from IP {}", ip)).await;
        }
    }

    // Persist to database
    sqlx::query(
        "INSERT INTO threat_intelligence (ip_address, threat_level, first_seen, last_seen, incident_count, blocked)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(ip_address) DO UPDATE SET
         threat_level = ?, last_seen = ?, incident_count = incident_count + 1, blocked = ?"
    )
    .bind(ip)
    .bind(threat.threat_level)
    .bind(&threat.last_seen)
    .bind(&threat.last_seen)
    .bind(threat.incident_count)
    .bind(threat.blocked)
    .bind(threat.threat_level)
    .bind(&threat.last_seen)
    .bind(threat.blocked)
    .execute(&*state.security_db)
    .await
    .ok();
}

// ─── Lockdown System ─────────────────────────────────────────────────────────

async fn trigger_lockdown(state: &AppState, level: u8, reason: &str) {
    let mut lockdown = state.lockdown_state.write().await;

    if lockdown.level >= level {
        return; // Already in higher lockdown
    }

    lockdown.is_locked = true;
    lockdown.level = level;
    lockdown.triggered_at = Some(Utc::now().to_rfc3339());
    lockdown.reason = Some(reason.to_string());

    error!("🚨 LOCKDOWN LEVEL {} TRIGGERED: {}", level, reason);

    // Log lockdown event
    log_security_event(
        &state.security_db,
        &state.encryption_key,
        "lockdown",
        "critical",
        None,
        None,
        None,
        Some(&format!(
            "{{\"level\":{},\"reason\":\"{}\"}}",
            level, reason
        )),
    )
    .await
    .ok();

    // Store in database
    sqlx::query(
        "INSERT INTO system_lockdowns (triggered_at, trigger_reason, lockdown_level)
         VALUES (?, ?, ?)",
    )
    .bind(lockdown.triggered_at.as_ref())
    .bind(reason)
    .bind(level as i32)
    .execute(&*state.security_db)
    .await
    .ok();

    // Create critical alert
    create_alert(
        &state.security_db,
        "lockdown",
        "critical",
        &format!("System Lockdown Level {}", level),
        reason,
    )
    .await
    .ok();
}

async fn release_lockdown(state: &AppState, admin_user: &str) {
    let mut lockdown = state.lockdown_state.write().await;

    if !lockdown.is_locked {
        return;
    }

    info!("Lockdown released by: {}", admin_user);

    lockdown.is_locked = false;
    lockdown.level = 0;
    lockdown.reason = None;

    log_security_event(
        &state.security_db,
        &state.encryption_key,
        "lockdown_release",
        "info",
        None,
        None,
        Some(admin_user),
        None,
    )
    .await
    .ok();

    // Update database
    sqlx::query(
        "UPDATE system_lockdowns SET released_at = ?, released_by = ?
         WHERE released_at IS NULL
         ORDER BY id DESC LIMIT 1",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(admin_user)
    .execute(&*state.security_db)
    .await
    .ok();
}

// ─── Alert System ────────────────────────────────────────────────────────────

async fn create_alert(
    db: &SqlitePool,
    alert_type: &str,
    severity: &str,
    title: &str,
    message: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO pending_alerts (alert_type, severity, title, message, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(alert_type)
    .bind(severity)
    .bind(title)
    .bind(message)
    .bind(Utc::now().to_rfc3339())
    .execute(db)
    .await?;

    Ok(())
}

// ─── API Handlers ────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let lockdown = state.lockdown_state.read().await;

    Json(serde_json::json!({
        "service": "iora-security",
        "status": if lockdown.is_locked { "locked" } else { "healthy" },
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
        "lockdown_level": lockdown.level,
        "encryption": "aes-256-gcm",
        "database": "sqlite-encrypted",
    }))
}

async fn get_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let lockdown = state.lockdown_state.read().await;

    Json(serde_json::json!({
        "is_locked": lockdown.is_locked,
        "lockdown_level": lockdown.level,
        "triggered_at": lockdown.triggered_at,
        "reason": lockdown.reason,
    }))
}

/// Lightweight resource snapshot read directly from /proc on Linux.
/// On non-Linux hosts (development workstations) we return zeros with
/// `available: false` so the admin UI renders a clean placeholder.
async fn get_resource_usage() -> Json<serde_json::Value> {
    #[cfg(target_os = "linux")]
    {
        let meminfo = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let mut total_kb: u64 = 0;
        let mut avail_kb: u64 = 0;
        for line in meminfo.lines() {
            if let Some(rest) = line.strip_prefix("MemTotal:") {
                total_kb = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
            } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
                avail_kb = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
            }
        }
        let mem_pct = if total_kb > 0 {
            ((total_kb - avail_kb) as f64 / total_kb as f64) * 100.0
        } else {
            0.0
        };

        let loadavg = std::fs::read_to_string("/proc/loadavg").unwrap_or_default();
        let load1: f64 = loadavg
            .split_whitespace()
            .next()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);

        let cpu_count = std::thread::available_parallelism()
            .map(|n| n.get() as f64)
            .unwrap_or(1.0);
        let cpu_pct = ((load1 / cpu_count) * 100.0).min(100.0);

        // Disk (root mount). Best-effort via `statvfs` would need a crate;
        // approximate with /proc/mounts + std::fs::metadata.
        let disk_pct = read_root_disk_percent().unwrap_or(0.0);

        Json(serde_json::json!({
            "available": true,
            "cpu_percent": cpu_pct,
            "memory_percent": mem_pct,
            "disk_percent": disk_pct,
            "memory_total_kb": total_kb,
            "memory_available_kb": avail_kb,
            "load_avg_1m": load1,
            "cpu_count": cpu_count,
        }))
    }
    #[cfg(not(target_os = "linux"))]
    {
        Json(serde_json::json!({
            "available": false,
            "cpu_percent": 0.0,
            "memory_percent": 0.0,
            "disk_percent": 0.0,
            "note": "resource-usage is only available on Linux",
        }))
    }
}

#[cfg(target_os = "linux")]
fn read_root_disk_percent() -> Option<f64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(std::path::Path::new("/").as_os_str().as_bytes()).ok()?;
    unsafe {
        let mut stat: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(path.as_ptr(), &mut stat) != 0 {
            return None;
        }
        let total = stat.f_blocks as f64 * stat.f_frsize as f64;
        let avail = stat.f_bavail as f64 * stat.f_frsize as f64;
        if total <= 0.0 {
            return None;
        }
        Some(((total - avail) / total) * 100.0)
    }
}

async fn get_connections(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query("SELECT * FROM database_connections ORDER BY timestamp DESC LIMIT 100")
        .fetch_all(&*state.security_db)
        .await
        .map_err(AppError::Database)?;

    let connections: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "timestamp": row.get::<String, _>("timestamp"),
                "source_ip": row.get::<Option<String>, _>("source_ip"),
                "username": row.get::<Option<String>, _>("username"),
                "database_name": row.get::<Option<String>, _>("database_name"),
                "is_authorized": row.get::<bool, _>("is_authorized"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "connections": connections,
        "total": connections.len(),
    })))
}

async fn get_events(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        "SELECT id, timestamp, event_type, severity, source_ip, service_name, user_id
         FROM security_events ORDER BY id DESC LIMIT 100",
    )
    .fetch_all(&*state.security_db)
    .await
    .map_err(AppError::Database)?;

    let events: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "timestamp": row.get::<String, _>("timestamp"),
                "event_type": row.get::<String, _>("event_type"),
                "severity": row.get::<String, _>("severity"),
                "source_ip": row.get::<Option<String>, _>("source_ip"),
                "service_name": row.get::<Option<String>, _>("service_name"),
                "user_id": row.get::<Option<String>, _>("user_id"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "events": events,
        "total": events.len(),
    })))
}

async fn get_threats(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let rows =
        sqlx::query("SELECT * FROM threat_intelligence ORDER BY threat_level DESC LIMIT 100")
            .fetch_all(&*state.security_db)
            .await
            .map_err(AppError::Database)?;

    let threats: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "ip_address": row.get::<String, _>("ip_address"),
                "threat_level": row.get::<i32, _>("threat_level"),
                "incident_count": row.get::<i32, _>("incident_count"),
                "blocked": row.get::<bool, _>("blocked"),
                "last_seen": row.get::<String, _>("last_seen"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "threats": threats,
        "total": threats.len(),
    })))
}

async fn add_whitelist(
    State(state): State<AppState>,
    Json(req): Json<WhitelistRequest>,
) -> Result<impl IntoResponse, AppError> {
    let network: IpNetwork = req
        .ip_address
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid IP address or range".to_string()))?;

    // Add to runtime whitelist
    state.whitelist.write().await.push(network);

    // Store in database
    sqlx::query(
        "INSERT INTO ip_whitelist (ip_address, description, added_by, added_at, is_active)
         VALUES (?, ?, 'admin', ?, 1)",
    )
    .bind(&req.ip_address)
    .bind(&req.description)
    .bind(Utc::now().to_rfc3339())
    .execute(&*state.security_db)
    .await
    .map_err(AppError::Database)?;

    log_security_event(
        &state.security_db,
        &state.encryption_key,
        "whitelist_add",
        "info",
        Some(&req.ip_address),
        None,
        None,
        req.description.as_deref(),
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({
        "message": "IP added to whitelist",
        "ip": req.ip_address,
    })))
}

async fn block_ip(
    State(state): State<AppState>,
    AxumPath(ip): AxumPath<String>,
) -> Result<impl IntoResponse, AppError> {
    update_threat_level(&state, &ip, 10).await;

    Ok(Json(serde_json::json!({
        "message": "IP blocked",
        "ip": ip,
    })))
}

async fn manual_lockdown(
    State(state): State<AppState>,
    Json(req): Json<LockdownRequest>,
) -> Result<impl IntoResponse, AppError> {
    trigger_lockdown(&state, req.level, &req.reason).await;

    Ok(Json(serde_json::json!({
        "message": "Lockdown activated",
        "level": req.level,
    })))
}

async fn release_lockdown_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    release_lockdown(&state, "admin").await;

    Ok(Json(serde_json::json!({
        "message": "Lockdown released",
    })))
}

async fn create_user_handler(
    State(state): State<AppState>,
    Json(req): Json<CreateUserRequest>,
) -> Result<impl IntoResponse, AppError> {
    let (username, password) = create_postgres_user(
        &state,
        &req.service_name,
        &req.database_name,
        &req.permissions,
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "username": username,
            "password": password,
            "database": req.database_name,
            "message": "PostgreSQL user created successfully",
        })),
    ))
}

async fn get_alerts(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        "SELECT * FROM pending_alerts WHERE sent_at IS NULL ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(&*state.security_db)
    .await
    .map_err(AppError::Database)?;

    let alerts: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let ack: Option<String> = row
                .try_get::<Option<String>, _>("acknowledged_at")
                .ok()
                .flatten();
            // Normalize severity to the UI's expected enum (low|medium|high|critical).
            // Internal log levels ("info","warning","error") are mapped to UI buckets
            // so the admin panel's severity badges and filters work correctly.
            let raw_sev: String = row.get::<String, _>("severity");
            let severity = match raw_sev.to_ascii_lowercase().as_str() {
                "critical" | "crit" => "critical",
                "error" | "err" | "high" => "high",
                "warning" | "warn" | "medium" | "med" => "medium",
                "info" | "low" | "debug" | "trace" => "low",
                _ => "low",
            };
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "alert_type": row.get::<String, _>("alert_type"),
                "severity": severity,
                "title": row.get::<String, _>("title"),
                "message": row.get::<String, _>("message"),
                "created_at": row.get::<String, _>("created_at"),
                "acknowledged": ack.is_some(),
                "acknowledged_at": ack,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "alerts": alerts,
        "total": alerts.len(),
    })))
}

/// Mark a pending alert as acknowledged. The frontend security panel uses this
/// to dismiss critical/high warnings after operator review.
async fn acknowledge_alert(
    AxumPath(id): AxumPath<i64>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "UPDATE pending_alerts SET acknowledged_at = ?, acknowledged_by = COALESCE(acknowledged_by, 'admin') WHERE id = ?"
    )
    .bind(&now)
    .bind(id)
    .execute(&*state.security_db)
    .await
    .map_err(AppError::Database)?;

    if result.rows_affected() == 0 {
        return Err(AppError::BadRequest(format!("alert {} not found", id)));
    }

    Ok(Json(serde_json::json!({
        "id": id,
        "acknowledged": true,
        "acknowledged_at": now,
    })))
}

// ─── Error Handling ──────────────────────────────────────────────────────────

#[derive(Debug)]
enum AppError {
    Database(sqlx::Error),
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            AppError::Database(e) => {
                error!("Database error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Database error".to_string(),
                )
            }
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Internal(msg) => {
                error!("Internal error: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
        };

        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    // Load encryption key for SQLite
    let encryption_key_hex = system_config::security_db_key();
    if encryption_key_hex.is_empty() {
        anyhow::bail!("SECURITY_DB_KEY must be set");
    }
    let key_bytes =
        hex::decode(&encryption_key_hex).context("SECURITY_DB_KEY must be a valid hex string")?;
    if key_bytes.len() != 32 {
        anyhow::bail!("SECURITY_DB_KEY must be exactly 32 bytes (64 hex characters)");
    }
    let mut encryption_key = [0u8; 32];
    encryption_key.copy_from_slice(&key_bytes);

    // Connect to encrypted SQLite database
    let db_path = system_config::security_db_path();

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    info!("Opening encrypted security database at: {}", db_path);
    let security_db = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", db_path))
        .await
        .context("Failed to connect to security database")?;

    // Run migrations
    sqlx::migrate!("./migrations")
        .run(&security_db)
        .await
        .context("Failed to run migrations")?;

    // Detect environment
    let iora_env = IoraEnv::detect();
    info!("IORA environment: {}", iora_env);

    // Connect to PostgreSQL using the shared DATABASE_URL.
    // In production the iora user already has the required privileges.
    // POSTGRES_ADMIN_URL is accepted as an optional override.
    let postgres_url =
        system_config::postgres_admin_url().unwrap_or_else(system_config::database_url);
    if postgres_url.is_empty() {
        anyhow::bail!("DATABASE_URL must be set");
    }

    let postgres_admin = match Pool::<Postgres>::connect(&postgres_url).await {
        Ok(pool) => {
            info!("Connected to PostgreSQL for security monitoring");
            pool
        }
        Err(e) if iora_env.is_development() => {
            warn!("Could not connect to PostgreSQL (dev mode – continuing without PG monitoring): {e}");
            // Create a minimal pool that will fail on use; monitoring tasks
            // will log errors but the service stays up.
            Pool::<Postgres>::connect(&postgres_url)
                .await
                .context("PostgreSQL connection required")?
        }
        Err(e) => {
            return Err(e.into());
        }
    };

    // Initialize whitelist from database
    let whitelist_rows = sqlx::query("SELECT ip_address FROM ip_whitelist WHERE is_active = 1")
        .fetch_all(&security_db)
        .await?;

    let mut whitelist = Vec::new();
    for row in whitelist_rows {
        if let Ok(ip_str) = row.try_get::<String, _>("ip_address") {
            if let Ok(network) = ip_str.parse::<IpNetwork>() {
                whitelist.push(network);
            }
        }
    }
    // Add default local IPs
    whitelist.push("127.0.0.1/32".parse().unwrap());
    whitelist.push("::1/128".parse().unwrap());
    // Add RFC 1918 private networks (Docker, LAN, etc.)
    whitelist.push("10.0.0.0/8".parse().unwrap());
    whitelist.push("172.16.0.0/12".parse().unwrap());
    whitelist.push("192.168.0.0/16".parse().unwrap());
    // Add IPv6 link-local
    whitelist.push("fe80::/10".parse().unwrap());

    let state = AppState {
        security_db: Arc::new(security_db),
        postgres_admin: Arc::new(postgres_admin),
        encryption_key: Arc::new(encryption_key),
        lockdown_state: Arc::new(RwLock::new(LockdownState {
            is_locked: false,
            level: 0,
            triggered_at: None,
            reason: None,
        })),
        started_at: Arc::new(Instant::now()),
        whitelist: Arc::new(RwLock::new(whitelist)),
        threat_cache: Arc::new(RwLock::new(HashMap::new())),
    };

    // Start background tasks
    tokio::spawn(monitor_postgres_connections(state.clone()));
    tokio::spawn(auto_rotate_credentials(state.clone()));

    // Log startup
    log_security_event(
        &state.security_db,
        &state.encryption_key,
        "system_start",
        "info",
        None,
        Some("iora-security"),
        None,
        None,
    )
    .await?;

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/security/status", get(get_status))
        .route("/api/security/connections", get(get_connections))
        .route("/api/security/events", get(get_events))
        .route("/api/security/threats", get(get_threats))
        .route("/api/security/alerts", get(get_alerts))
        .route(
            "/api/security/alerts/:id/acknowledge",
            post(acknowledge_alert),
        )
        .route("/api/security/resource-usage", get(get_resource_usage))
        .route("/api/security/whitelist", post(add_whitelist))
        .route("/api/security/block/:ip", post(block_ip))
        .route("/api/security/lockdown", post(manual_lockdown))
        .route("/api/security/release", post(release_lockdown_handler))
        .route("/api/security/users", post(create_user_handler))
        .layer(CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let port = system_config::service_port("iora-security", 8095).to_string();
    let addr = format!("0.0.0.0:{}", port);

    info!("🔒 iora-security starting on {} ({})", addr, iora_env);
    info!("Security monitoring active");
    info!("PostgreSQL user management enabled");
    info!("Encrypted audit logging enabled");
    if iora_env.is_production() {
        info!("Running in PRODUCTION mode – stricter security policies");
    }

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-security",
        port.parse::<u16>().unwrap_or(8095),
        "Security policy & intrusion detection",
    );
    axum::serve(listener, app).await?;

    Ok(())
}
