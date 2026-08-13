//! Device Registry Handler (Package 3) — curated devices + Wake-on-LAN.
//!
//! API endpoints (authenticated; write actions honour the `os.network.write`
//! permission via the caller's effective permissions where applicable):
//!   GET    /api/devices            – List curated devices
//!   POST   /api/devices            – Create a device
//!   PUT    /api/devices/:id        – Update a device
//!   DELETE /api/devices/:id        – Remove a device
//!   POST   /api/devices/:id/wake   – Send a Wake-on-LAN magic packet
//!
//! WOL sends a classic magic packet (6× 0xFF + 16× MAC) as a UDP broadcast
//! to 255.255.255.255:9 — the standard for same-LAN wake-ups.

use axum::{
    extract::{Extension, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde_json::{json, Value};
use tracing::{debug, warn};
use uuid::Uuid;

use iora_shared::devices::{CreateDeviceRequest, UpdateDeviceRequest, DEVICE_TYPES};

use crate::middleware::AuthIdentity;
use crate::{AppState, ErrorResponse};

/// Row layout: id, name, device_type, mac_address, ip_address, wake_enabled,
/// notes, created_by, created_at.
type DeviceRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    bool,
    String,
    String,
    chrono::DateTime<Utc>,
    Option<String>,
    serde_json::Value,
);

const DEVICE_SELECT: &str = "SELECT id, name, device_type, mac_address, ip_address, \
                             wake_enabled, notes, created_by, created_at, agent_type, agent_config \
                             FROM device_registry";

fn row_to_value(row: &DeviceRow) -> Value {
    json!({
        "id": row.0,
        "name": row.1,
        "device_type": row.2,
        "mac_address": row.3,
        "ip_address": row.4,
        "wake_enabled": row.5,
        "notes": row.6,
        "created_by": row.7,
        "created_at": row.8,
        "agent_type": row.9,
        "agent_config": row.10,
    })
}

/// Validate an agent configuration: known type + object config.
fn validate_agent(
    agent_type: &Option<String>,
    agent_config: &Option<serde_json::Value>,
) -> Result<(), ErrorResponse> {
    let Some(agent_type) = agent_type else {
        return Ok(());
    };
    if !iora_shared::devices::AGENT_TYPES.contains(&agent_type.as_str()) {
        return Err(ErrorResponse::bad_request(format!(
            "invalid agent_type '{agent_type}' (expected tcp or http)"
        )));
    }
    if let Some(config) = agent_config {
        if !config.is_object() {
            return Err(ErrorResponse::bad_request(
                "agent_config must be a JSON object",
            ));
        }
    }
    Ok(())
}

fn validate_mac(mac: &str) -> bool {
    let normalized: String = mac
        .chars()
        .filter(|c| c.is_ascii_hexdigit() || *c == ':' || *c == '-')
        .collect();
    let hex: String = normalized
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    hex.len() == 12 && normalized.matches([':', '-']).count() == 5
}

/// Parse a MAC address (`AA:BB:CC:DD:EE:FF` or dashed) into 6 bytes.
fn parse_mac(mac: &str) -> Result<[u8; 6], String> {
    let hex: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 {
        return Err("invalid MAC address".to_string());
    }
    let mut bytes = [0u8; 6];
    for i in 0..6 {
        bytes[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|e| format!("invalid MAC: {e}"))?;
    }
    Ok(bytes)
}

/// Send a Wake-on-LAN magic packet for a MAC address.
async fn send_wol(mac: &str) -> Result<(), String> {
    let mac_bytes = parse_mac(mac)?;
    let mut packet = vec![0xFFu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&mac_bytes);
    }
    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    socket
        .send_to(&packet, "255.255.255.255:9")
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// GET /api/devices
pub async fn list_devices(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let rows: Vec<DeviceRow> = sqlx::query_as(&format!("{DEVICE_SELECT} ORDER BY created_at DESC"))
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to list devices: {e}")))?;

    let devices: Vec<Value> = rows.iter().map(row_to_value).collect();
    Ok(Json(json!({ "devices": devices })))
}

/// POST /api/devices
pub async fn create_device(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(body): Json<CreateDeviceRequest>,
) -> Result<(StatusCode, Json<Value>), ErrorResponse> {
    let user_id = identity.user_id();

    if body.name.trim().is_empty() {
        return Err(ErrorResponse::bad_request("device name must not be empty"));
    }
    if !DEVICE_TYPES.contains(&body.device_type.as_str()) {
        return Err(ErrorResponse::bad_request(format!(
            "invalid device_type '{}'",
            body.device_type
        )));
    }
    if let Some(mac) = &body.mac_address {
        if !mac.trim().is_empty() && !validate_mac(mac) {
            return Err(ErrorResponse::bad_request(format!(
                "invalid MAC address '{mac}' (expected AA:BB:CC:DD:EE:FF)"
            )));
        }
    }
    validate_agent(&body.agent_type, &body.agent_config)?;

    let id = Uuid::new_v4().to_string();
    let mac = body
        .mac_address
        .as_deref()
        .filter(|m| !m.trim().is_empty())
        .map(|m| m.to_string());
    let agent_type = body.agent_type.as_deref().filter(|a| !a.trim().is_empty());
    let agent_config = body.agent_config.clone().unwrap_or_else(|| json!({}));

    sqlx::query(
        "INSERT INTO device_registry (id, name, device_type, mac_address, ip_address, wake_enabled, notes, created_by, agent_type, agent_config) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(&id)
    .bind(body.name.trim())
    .bind(&body.device_type)
    .bind(&mac)
    .bind(body.ip_address.as_deref().filter(|i| !i.trim().is_empty()))
    .bind(body.wake_enabled)
    .bind(body.notes.trim())
    .bind(user_id)
    .bind(agent_type)
    .bind(&agent_config)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to create device: {e}")))?;

    let row = sqlx::query_as::<_, DeviceRow>(&format!("{DEVICE_SELECT} WHERE id = $1"))
        .bind(&id)
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to reload device: {e}")))?;

    Ok((StatusCode::CREATED, Json(row_to_value(&row))))
}

/// PUT /api/devices/:id
pub async fn update_device(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<UpdateDeviceRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    if let Some(device_type) = &body.device_type {
        if !DEVICE_TYPES.contains(&device_type.as_str()) {
            return Err(ErrorResponse::bad_request(format!(
                "invalid device_type '{device_type}'"
            )));
        }
    }
    if let Some(mac) = &body.mac_address {
        if !mac.trim().is_empty() && !validate_mac(mac) {
            return Err(ErrorResponse::bad_request(format!(
                "invalid MAC address '{mac}'"
            )));
        }
    }
    validate_agent(&body.agent_type, &body.agent_config)?;

    // An explicit empty agent_type clears the agent; bind "" as the marker.
    let agent_type = body.agent_type.as_deref().map(|a| a.trim());

    let affected = sqlx::query(
        "UPDATE device_registry SET \
         name = COALESCE($1, name), \
         device_type = COALESCE($2, device_type), \
         mac_address = COALESCE($3, mac_address), \
         ip_address = COALESCE($4, ip_address), \
         wake_enabled = COALESCE($5, wake_enabled), \
         notes = COALESCE($6, notes), \
         agent_type = CASE WHEN $7 = '' THEN NULL ELSE COALESCE($7, agent_type) END, \
         agent_config = COALESCE($8, agent_config) \
         WHERE id = $9",
    )
    .bind(
        body.name
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty()),
    )
    .bind(body.device_type.as_deref())
    .bind(body.mac_address.as_deref().filter(|m| !m.trim().is_empty()))
    .bind(body.ip_address.as_deref().filter(|i| !i.trim().is_empty()))
    .bind(body.wake_enabled)
    .bind(body.notes.as_deref().map(str::trim))
    .bind(agent_type.unwrap_or(""))
    .bind(body.agent_config.as_ref())
    .bind(&id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to update device: {e}")))?
    .rows_affected();

    if affected == 0 {
        return Err(ErrorResponse::not_found(format!("device {id} not found")));
    }

    let row = sqlx::query_as::<_, DeviceRow>(&format!("{DEVICE_SELECT} WHERE id = $1"))
        .bind(&id)
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to reload device: {e}")))?;

    Ok(Json(row_to_value(&row)))
}

/// DELETE /api/devices/:id
pub async fn delete_device(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let affected = sqlx::query("DELETE FROM device_registry WHERE id = $1")
        .bind(&id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to delete device: {e}")))?
        .rows_affected();

    if affected == 0 {
        return Err(ErrorResponse::not_found(format!("device {id} not found")));
    }
    Ok(Json(json!({ "deleted": true })))
}

/// POST /api/devices/:id/wake — send a Wake-on-LAN magic packet.
pub async fn wake_device(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let row: Option<DeviceRow> =
        sqlx::query_as::<_, DeviceRow>(&format!("{DEVICE_SELECT} WHERE id = $1"))
            .bind(&id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to load device: {e}")))?;

    let Some(row) = row else {
        return Err(ErrorResponse::not_found(format!("device {id} not found")));
    };
    if !row.5 {
        return Err(ErrorResponse::bad_request(format!(
            "wake is disabled for device '{}'",
            row.1
        )));
    }
    let Some(mac) = row.3.as_deref() else {
        return Err(ErrorResponse::bad_request(format!(
            "device '{}' has no MAC address — cannot wake",
            row.1
        )));
    };

    match send_wol(mac).await {
        Ok(()) => {
            debug!("WOL packet sent for {} ({mac})", row.1);
            Ok(Json(json!({ "woken": true, "device_id": row.0 })))
        }
        Err(e) => {
            warn!("WOL failed for {}: {}", row.1, e);
            Err(ErrorResponse::internal(format!(
                "failed to send wake packet: {e}"
            )))
        }
    }
}

/// POST /api/devices/:id/probe — run the device's reachability agent.
pub async fn probe_device(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let row: Option<DeviceRow> =
        sqlx::query_as::<_, DeviceRow>(&format!("{DEVICE_SELECT} WHERE id = $1"))
            .bind(&id)
            .fetch_optional(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to load device: {e}")))?;

    let Some(row) = row else {
        return Err(ErrorResponse::not_found(format!("device {id} not found")));
    };

    let agent_type = row.9.as_deref().unwrap_or("");
    let config = &row.10;
    let fallback_ip = row.4.as_deref().unwrap_or("").to_string();

    let start = std::time::Instant::now();

    match agent_type {
        "tcp" => {
            let host = config
                .get("host")
                .and_then(|v| v.as_str())
                .filter(|h| !h.is_empty())
                .unwrap_or(&fallback_ip)
                .to_string();
            let port = config
                .get("port")
                .and_then(|v| v.as_u64())
                .unwrap_or(22)
                .clamp(1, 65535) as u16;
            if host.is_empty() {
                return Err(ErrorResponse::bad_request(format!(
                    "device '{}' has no host for the tcp agent",
                    row.1
                )));
            }
            match tokio::time::timeout(
                std::time::Duration::from_secs(3),
                tokio::net::TcpStream::connect((host.as_str(), port)),
            )
            .await
            {
                Ok(Ok(_)) => Ok(Json(json!({
                    "reachable": true,
                    "latency_ms": start.elapsed().as_millis(),
                    "detail": format!("tcp {host}:{port} reachable"),
                }))),
                Ok(Err(e)) => Ok(Json(json!({
                    "reachable": false,
                    "latency_ms": start.elapsed().as_millis(),
                    "detail": format!("tcp {host}:{port} refused: {e}"),
                }))),
                Err(_) => Ok(Json(json!({
                    "reachable": false,
                    "latency_ms": start.elapsed().as_millis(),
                    "detail": format!("tcp {host}:{port} timed out"),
                }))),
            }
        }
        "http" => {
            let url = config
                .get("url")
                .and_then(|v| v.as_str())
                .filter(|u| !u.is_empty())
                .unwrap_or_default()
                .to_string();
            if url.is_empty() {
                return Err(ErrorResponse::bad_request(format!(
                    "device '{}' has no url for the http agent",
                    row.1
                )));
            }
            let client = reqwest::Client::new();
            match client
                .get(&url)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
            {
                Ok(response) => {
                    let status = response.status().as_u16();
                    Ok(Json(json!({
                        "reachable": status < 500,
                        "latency_ms": start.elapsed().as_millis(),
                        "detail": format!("http {url} -> {status}"),
                    })))
                }
                Err(e) => Ok(Json(json!({
                    "reachable": false,
                    "latency_ms": start.elapsed().as_millis(),
                    "detail": format!("http {url} failed: {e}"),
                }))),
            }
        }
        _ => Err(ErrorResponse::bad_request(format!(
            "device '{}' has no agent configured",
            row.1
        ))),
    }
}
