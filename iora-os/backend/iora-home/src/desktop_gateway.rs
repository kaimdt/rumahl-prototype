//! Desktop Client Gateway – Secure proxy for desktop clients to interact with Home Assistant
//!
//! This module provides a secure intermediary between IORA Desktop clients and Home Assistant.
//! All desktop-HA communication flows through this gateway to:
//! - Validate and authenticate desktop clients
//! - Control which HA services can be called
//! - Audit all desktop actions
//! - Rate limit requests per client
//! - Centralize control over external integrations

use axum::{
    extract::State,
    http::StatusCode,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use tracing::{info, warn};

use crate::{middleware::AuthIdentity, AppState};

// ─── Request/Response Types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DesktopRegistration {
    pub device_id: String,
    pub device_name: String,
    pub os: String,
}

#[derive(Debug, Serialize)]
pub struct DesktopRegistrationResponse {
    pub device_id: String,
    pub registered_at: String,
}

#[derive(Debug, Serialize)]
pub struct DesktopCustomElement {
    pub id: String,
    pub tag: String,
    pub description: String,
    pub documentation_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DesktopCustomPage {
    pub id: String,
    pub title: String,
    pub url: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct DesktopExtensionManifest {
    pub custom_elements: Vec<DesktopCustomElement>,
    pub custom_pages: Vec<DesktopCustomPage>,
}

#[derive(Debug, Serialize)]
pub struct DesktopSettingField {
    pub key: String,
    pub label: String,
    pub description: String,
    pub field_type: String,
    pub options: Option<Vec<String>>,
    pub default_value: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct DesktopSettingsManifest {
    pub fields: Vec<DesktopSettingField>,
}

#[derive(Debug, Deserialize)]
pub struct DesktopSettingsUpdate {
    pub settings: HashMap<String, Value>,
}

pub async fn get_desktop_extensions() -> Result<Json<DesktopExtensionManifest>, StatusCode> {
    Ok(Json(DesktopExtensionManifest {
        custom_elements: vec![
            DesktopCustomElement {
                id: "desktop-status-card".to_string(),
                tag: "desktop-status-card".to_string(),
                description: "A custom desktop status widget for IORA Home pages.".to_string(),
                documentation_url: None,
            },
        ],
        custom_pages: vec![
            DesktopCustomPage {
                id: "desktop-settings".to_string(),
                title: "Desktop Einstellungen".to_string(),
                url: "/desktop-settings".to_string(),
                description: "A desktop-specific settings page exposed to IORA Home.".to_string(),
            },
        ],
    }))
}

pub async fn get_desktop_settings() -> Result<Json<DesktopSettingsManifest>, StatusCode> {
    Ok(Json(DesktopSettingsManifest {
        fields: vec![
            DesktopSettingField {
                key: "display_brightness".to_string(),
                label: "Display-Helligkeit".to_string(),
                description: "Steuere die Desktop-Helligkeit.".to_string(),
                field_type: "range".to_string(),
                options: None,
                default_value: Some(Value::from(0)),
            },
            DesktopSettingField {
                key: "notifications_enabled".to_string(),
                label: "Benachrichtigungen".to_string(),
                description: "Aktiviere oder deaktiviere Desktop-Benachrichtigungen.".to_string(),
                field_type: "boolean".to_string(),
                options: None,
                default_value: Some(Value::from(true)),
            },
            DesktopSettingField {
                key: "kiosk_mode".to_string(),
                label: "Kiosk-Modus".to_string(),
                description: "Zeige Desktop im Kioskmodus ohne Steuerleisten.".to_string(),
                field_type: "boolean".to_string(),
                options: None,
                default_value: Some(Value::from(false)),
            },
        ],
    }))
}

pub async fn update_desktop_settings(
    Json(update): Json<DesktopSettingsUpdate>,
) -> Result<StatusCode, StatusCode> {
    info!("Desktop settings update requested: {:#?}", update.settings);
    Ok(StatusCode::OK)
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SystemMetrics {
    pub timestamp: String,
    pub hostname: String,
    pub cpu_usage: f32,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_percent: f32,
    pub disk_total: u64,
    pub disk_used: u64,
    pub disk_percent: f32,
    pub network_rx_mb: f64,
    pub network_tx_mb: f64,
    pub battery_percent: Option<f32>,
    pub battery_charging: Option<bool>,
    pub screen_on: bool,
    pub uptime_secs: u64,
}

#[derive(Debug, Deserialize)]
pub struct ServiceCallRequest {
    pub domain: String,
    pub service: String,
    pub entity_id: Option<String>,
    pub data: Option<HashMap<String, Value>>,
}

#[derive(Debug, Deserialize)]
pub struct CommandRequest {
    pub command: String,
}

#[derive(Debug, Serialize)]
pub struct HaEntity {
    pub entity_id: String,
    pub state: String,
    pub attributes: Value,
    pub last_changed: String,
    pub last_updated: String,
}

// ─── Desktop Gateway Handlers ────────────────────────────────────────────────

/// POST /api/desktop/register
/// Register a desktop client with the system
#[utoipa::path(
    post,
    path = "/api/desktop/register",
    tag = "desktop",
    request_body = DesktopRegistration,
    responses(
        (status = 200, description = "Desktop client registered successfully", body = DesktopRegistrationResponse),
        (status = 401, description = "Unauthorized - invalid or missing token"),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn register_desktop(
    State(_state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(req): Json<DesktopRegistration>,
) -> Result<Json<DesktopRegistrationResponse>, StatusCode> {
    let user_id = identity.user_id();

    info!(
        "Desktop registration: device_id={}, device_name={}, os={}, user_id={}",
        req.device_id, req.device_name, req.os, user_id
    );

    // Store registration in database (future: track desktop clients)
    // For now, just acknowledge registration

    Ok(Json(DesktopRegistrationResponse {
        device_id: req.device_id,
        registered_at: chrono::Utc::now().to_rfc3339(),
    }))
}

/// POST /api/desktop/metrics
/// Accept system metrics from desktop client and forward to Home Assistant
#[utoipa::path(
    post,
    path = "/api/desktop/metrics",
    tag = "desktop",
    request_body = SystemMetrics,
    responses(
        (status = 200, description = "Metrics received and forwarded to HA"),
        (status = 401, description = "Unauthorized"),
        (status = 502, description = "Failed to forward metrics to HA"),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn receive_metrics(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(metrics): Json<SystemMetrics>,
) -> Result<StatusCode, StatusCode> {
    let user_id = identity.user_id();

    info!(
        "Received metrics from desktop: hostname={}, cpu={}%, mem={}%, user_id={}",
        metrics.hostname, metrics.cpu_usage, metrics.memory_percent, user_id
    );

    // Forward metrics to Home Assistant as sensor updates
    let ha = &state.ha_client;
    let device_name = &metrics.hostname;

    // Create sensor entities in Home Assistant
    let sensors = vec![
        (format!("sensor.iora_desktop_{}_cpu", device_name), metrics.cpu_usage, "%", "CPU Usage"),
        (format!("sensor.iora_desktop_{}_memory", device_name), metrics.memory_percent, "%", "Memory Usage"),
        (format!("sensor.iora_desktop_{}_disk", device_name), metrics.disk_percent, "%", "Disk Usage"),
        (format!("sensor.iora_desktop_{}_network_rx", device_name), metrics.network_rx_mb as f32, "MB", "Network RX"),
        (format!("sensor.iora_desktop_{}_network_tx", device_name), metrics.network_tx_mb as f32, "MB", "Network TX"),
        (format!("sensor.iora_desktop_{}_uptime", device_name), metrics.uptime_secs as f32, "s", "Uptime"),
    ];

    let mut errors = 0;
    for (entity_id, value, unit, friendly_name) in sensors {
        let state_data = json!({
            "state": value,
            "attributes": {
                "unit_of_measurement": unit,
                "friendly_name": friendly_name,
                "device_class": "measurement",
                "source": "iora_desktop",
                "hostname": device_name,
                "timestamp": metrics.timestamp,
            }
        });

        if let Err(e) = ha.set_state(&entity_id, state_data).await {
            warn!("Failed to update sensor {}: {}", entity_id, e);
            errors += 1;
        }
    }

    // Handle battery if present
    if let Some(battery_pct) = metrics.battery_percent {
        let entity_id = format!("sensor.iora_desktop_{}_battery", device_name);
        let state_data = json!({
            "state": battery_pct,
            "attributes": {
                "unit_of_measurement": "%",
                "friendly_name": "Battery Level",
                "device_class": "battery",
                "charging": metrics.battery_charging.unwrap_or(false),
                "source": "iora_desktop",
                "hostname": device_name,
                "timestamp": metrics.timestamp,
            }
        });

        if let Err(e) = ha.set_state(&entity_id, state_data).await {
            warn!("Failed to update battery sensor {}: {}", entity_id, e);
            errors += 1;
        }
    }

    if errors > 0 {
        warn!("Failed to update {} sensors for {}", errors, device_name);
        Err(StatusCode::BAD_GATEWAY)
    } else {
        info!("Successfully updated all sensors for {}", device_name);
        Ok(StatusCode::OK)
    }
}

/// GET /api/desktop/entities
/// Get Home Assistant entities (proxied through secure gateway)
#[utoipa::path(
    get,
    path = "/api/desktop/entities",
    tag = "desktop",
    responses(
        (status = 200, description = "List of HA entities", body = Vec<HaEntity>),
        (status = 401, description = "Unauthorized"),
        (status = 502, description = "Failed to fetch from HA"),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn get_entities(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
) -> Result<Json<Vec<HaEntity>>, StatusCode> {
    let user_id = identity.user_id();
    info!("Desktop client requesting entities: user_id={}", user_id);

    let ha_states = state.ha_client.get_states()
        .await
        .map_err(|e| {
            warn!("Failed to fetch entities from HA: {}", e);
            StatusCode::BAD_GATEWAY
        })?;

    let entities: Vec<HaEntity> = ha_states
        .into_iter()
        .map(|s| HaEntity {
            entity_id: s.entity_id,
            state: s.state,
            attributes: s.attributes,
            last_changed: s.last_changed,
            last_updated: s.last_updated,
        })
        .collect();

    Ok(Json(entities))
}

/// POST /api/desktop/service/call
/// Call a Home Assistant service (with validation and rate limiting)
#[utoipa::path(
    post,
    path = "/api/desktop/service/call",
    tag = "desktop",
    request_body = ServiceCallRequest,
    responses(
        (status = 200, description = "Service call executed successfully"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Service call not allowed (validation failed)"),
        (status = 502, description = "Failed to call HA service"),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn call_service(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(req): Json<ServiceCallRequest>,
) -> Result<StatusCode, StatusCode> {
    let user_id = identity.user_id();

    info!(
        "Desktop service call: domain={}, service={}, entity_id={:?}, user_id={}",
        req.domain, req.service, req.entity_id, user_id
    );

    // Validate service call (whitelist approach)
    if !is_service_allowed(&req.domain, &req.service) {
        warn!(
            "Service call rejected: {}.{} is not whitelisted for desktop clients",
            req.domain, req.service
        );
        return Err(StatusCode::FORBIDDEN);
    }

    // Build service call data
    let mut service_data = req.data.unwrap_or_default();
    if let Some(entity_id) = req.entity_id {
        service_data.insert("entity_id".to_string(), json!(entity_id));
    }

    // Call HA service (use call_service_fast for better performance)
    state.ha_client
        .call_service_fast(&req.domain, &req.service, json!(service_data))
        .await
        .map_err(|e| {
            warn!("Failed to call HA service {}.{}: {}", req.domain, req.service, e);
            StatusCode::BAD_GATEWAY
        })?;

    info!("Successfully called service {}.{}", req.domain, req.service);
    Ok(StatusCode::OK)
}

/// POST /api/desktop/command/execute
/// Execute a system command on the desktop client
/// NOTE: This endpoint queues commands for the desktop client to poll, it doesn't execute directly
#[utoipa::path(
    post,
    path = "/api/desktop/command/execute",
    tag = "desktop",
    request_body = CommandRequest,
    responses(
        (status = 200, description = "Command queued for desktop client"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Command not allowed or user not admin"),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn queue_command(
    Extension(identity): Extension<AuthIdentity>,
    Json(req): Json<CommandRequest>,
) -> Result<StatusCode, StatusCode> {
    // Only admins can queue system commands
    if !identity.is_admin() {
        warn!("Non-admin user {} attempted to queue command: {}", identity.user_id(), req.command);
        return Err(StatusCode::FORBIDDEN);
    }

    // Validate command
    if !is_command_allowed(&req.command) {
        warn!("Command not allowed: {}", req.command);
        return Err(StatusCode::FORBIDDEN);
    }

    info!("Queuing command for desktop client: {}", req.command);

    // TODO: Store command in database for desktop client to poll
    // For now, just acknowledge

    Ok(StatusCode::OK)
}

// ─── Validation Functions ────────────────────────────────────────────────────

/// Whitelist of allowed Home Assistant services for desktop clients
fn is_service_allowed(domain: &str, service: &str) -> bool {
    // Allow all light controls
    if domain == "light" && matches!(service, "turn_on" | "turn_off" | "toggle") {
        return true;
    }

    // Allow all switch controls
    if domain == "switch" && matches!(service, "turn_on" | "turn_off" | "toggle") {
        return true;
    }

    // Allow media player controls
    if domain == "media_player" && matches!(
        service,
        "turn_on" | "turn_off" | "toggle" | "media_play" | "media_pause" |
        "media_stop" | "media_next_track" | "media_previous_track" |
        "volume_up" | "volume_down" | "volume_set" | "volume_mute"
    ) {
        return true;
    }

    // Allow climate controls
    if domain == "climate" && matches!(
        service,
        "set_temperature" | "set_hvac_mode" | "set_preset_mode"
    ) {
        return true;
    }

    // Allow cover controls
    if domain == "cover" && matches!(
        service,
        "open_cover" | "close_cover" | "stop_cover" | "set_cover_position"
    ) {
        return true;
    }

    // Allow fan controls
    if domain == "fan" && matches!(
        service,
        "turn_on" | "turn_off" | "toggle" | "set_percentage" | "set_preset_mode"
    ) {
        return true;
    }

    // Allow lock controls
    if domain == "lock" && matches!(service, "lock" | "unlock") {
        return true;
    }

    // Allow automation triggers
    if domain == "automation" && matches!(service, "trigger" | "turn_on" | "turn_off") {
        return true;
    }

    // Allow scene activation
    if domain == "scene" && service == "turn_on" {
        return true;
    }

    // Allow script execution
    if domain == "script" && matches!(service, "turn_on" | "toggle") {
        return true;
    }

    // Allow input controls
    if matches!(domain, "input_boolean" | "input_select" | "input_number" | "input_text" | "input_datetime") {
        return true;
    }

    // Allow button presses
    if domain == "button" && service == "press" {
        return true;
    }

    // Deny everything else (including dangerous services like homeassistant.restart)
    false
}

/// Whitelist of allowed system commands for desktop clients
fn is_command_allowed(command: &str) -> bool {
    matches!(
        command,
        "shutdown" | "reboot" | "sleep" | "hibernate" | "lock" | "logout"
    )
}
