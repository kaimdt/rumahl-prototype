//! Persistent WebSocket client to Home Assistant.
//!
//! This replaces the REST API for two critical paths:
//!
//! 1. **Service calls** – Instead of HTTP POST (which blocks until HA talks to
//!    the device), we send `call_service` over the WebSocket. HA dispatches the
//!    command immediately and returns a result without waiting for device
//!    confirmation. This is what the official HA frontend does.
//!
//! 2. **State subscriptions** – Instead of polling `/api/states` every N
//!    seconds, we subscribe to `state_changed` events. State changes arrive in
//!    real-time (milliseconds), eliminating both the polling load on HA and the
//!    delay between a device changing and the dashboard reflecting it.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::db::DbPool;
use crate::entity_cache::EntityStateCache;
use crate::websocket::WebSocketManager;
use crate::EntityState;

// ── Public API ──────────────────────────────────────────────────────

pub struct HAWebSocket {
    cmd_tx: mpsc::UnboundedSender<WsCommand>,
    connected: Arc<AtomicBool>,
}

struct WsCommand {
    domain: String,
    service: String,
    entity_id: String,
    service_data: Value,
}

impl HAWebSocket {
    /// Create a new HA WebSocket client. Spawns a background task that
    /// maintains the connection, handles authentication, subscribes to
    /// state_changed events, and dispatches service call commands.
    pub fn new(
        ha_url: String,
        token: String,
        cache: Arc<EntityStateCache>,
        ws_manager: Arc<WebSocketManager>,
        db_pool: DbPool,
    ) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let connected = Arc::new(AtomicBool::new(false));

        tokio::spawn(connection_loop(
            ha_url,
            token,
            cmd_rx,
            cache,
            ws_manager,
            db_pool,
            connected.clone(),
        ));

        Self { cmd_tx, connected }
    }

    /// Returns true if the WebSocket to HA is authenticated and active.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    /// Send a service call to HA via WebSocket. Non-blocking, fire-and-forget.
    /// The command is queued and sent over the persistent connection.
    pub fn call_service(
        &self,
        domain: &str,
        service: &str,
        entity_id: &str,
        service_data: Value,
    ) {
        let _ = self.cmd_tx.send(WsCommand {
            domain: domain.to_string(),
            service: service.to_string(),
            entity_id: entity_id.to_string(),
            service_data,
        });
    }
}

// ── Connection loop with auto-reconnect ─────────────────────────────

async fn connection_loop(
    ha_url: String,
    token: String,
    mut cmd_rx: mpsc::UnboundedReceiver<WsCommand>,
    cache: Arc<EntityStateCache>,
    ws_manager: Arc<WebSocketManager>,
    db_pool: DbPool,
    connected: Arc<AtomicBool>,
) {
    // Bail out cleanly when HA is not configured. Otherwise the loop tries
    // to parse an empty URL forever and floods the journal with errors.
    if ha_url.trim().is_empty() || token.trim().is_empty() {
        info!("[HA-WS] HA not configured (empty URL or token) \u{2014} WebSocket disabled");
        // Drain any commands that arrive so senders don't see backpressure.
        while cmd_rx.recv().await.is_some() {}
        return;
    }
    let ws_url = make_ws_url(&ha_url);
    let is_wss = ws_url.starts_with("wss://");
    let mut backoff = Duration::from_secs(1);

    loop {
        info!("[HA-WS] Connecting to {} ...", ws_url);
        connected.store(false, Ordering::Relaxed);

        match run_connection(
            &ws_url,
            is_wss,
            &token,
            &mut cmd_rx,
            cache.clone(),
            ws_manager.clone(),
            db_pool.clone(),
            &connected,
        )
        .await
        {
            Ok(()) => {
                info!("[HA-WS] Connection closed cleanly");
                backoff = Duration::from_secs(1);
            }
            Err(e) => {
                warn!("[HA-WS] Connection failed: {} (url: {})", e, ws_url);
            }
        }

        connected.store(false, Ordering::Relaxed);
        cache.set_ha_connected(false);
        crate::METRICS.ha_ws_reconnects.fetch_add(1, Ordering::Relaxed);
        info!("[HA-WS] Reconnecting in {:?}", backoff);
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}

// ── Single connection lifecycle ─────────────────────────────────────

async fn run_connection(
    ws_url: &str,
    is_wss: bool,
    token: &str,
    cmd_rx: &mut mpsc::UnboundedReceiver<WsCommand>,
    cache: Arc<EntityStateCache>,
    ws_manager: Arc<WebSocketManager>,
    db_pool: DbPool,
    connected: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Build the WebSocket connection, with TLS support for wss://
    // Accept self-signed certificates (common with HA installations)
    let ws_stream = if is_wss {
        let tls_connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()?;
        let connector = tokio_tungstenite::Connector::NativeTls(tls_connector);
        let (stream, _) = tokio_tungstenite::connect_async_tls_with_config(
            ws_url,
            None,
            false,
            Some(connector),
        )
        .await?;
        stream
    } else {
        let (stream, _) = tokio_tungstenite::connect_async(ws_url).await?;
        stream
    };

    let (mut write, mut read) = ws_stream.split();

    let msg_id = AtomicU64::new(1);

    // ── Step 1: Wait for auth_required (with timeout) ──
    let msg = tokio::time::timeout(
        Duration::from_secs(15),
        read.next(),
    )
    .await
    .map_err(|_| "Timeout waiting for auth_required from HA")?
    .ok_or("Connection closed before auth_required")??;
    let parsed: Value = serde_json::from_str(msg.to_text()?)?;
    if parsed["type"].as_str() != Some("auth_required") {
        return Err(format!("Expected auth_required, got {:?}", parsed["type"]).into());
    }

    // ── Step 2: Authenticate ──
    write
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "auth",
                "access_token": token
            })
            .to_string(),
        ))
        .await?;

    let msg = tokio::time::timeout(
        Duration::from_secs(10),
        read.next(),
    )
    .await
    .map_err(|_| "Timeout waiting for auth response from HA")?
    .ok_or("Connection closed during authentication")??;
    let parsed: Value = serde_json::from_str(msg.to_text()?)?;
    if parsed["type"].as_str() != Some("auth_ok") {
        return Err(format!("Authentication failed: {:?}", parsed).into());
    }

    info!("[HA-WS] Authenticated with Home Assistant");

    // ── Step 3: Fetch initial states ──
    let states_id = msg_id.fetch_add(1, Ordering::Relaxed);
    write
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "id": states_id,
                "type": "get_states"
            })
            .to_string(),
        ))
        .await?;

    // Read until we get the states response
    loop {
        let msg = read
            .next()
            .await
            .ok_or("Connection closed waiting for states")??;
        let text = msg.to_text()?;
        let parsed: Value = serde_json::from_str(text)?;

        if parsed["id"].as_u64() == Some(states_id) && parsed["type"].as_str() == Some("result") {
            if parsed["success"].as_bool() == Some(true) {
                if let Some(result) = parsed.get("result") {
                    let states: Vec<EntityState> = serde_json::from_value(result.clone())?;
                    info!("[HA-WS] Loaded {} entities via WebSocket", states.len());
                    let (changed, _) = cache.update(states).await;
                    if !changed.is_empty() {
                        ws_manager.broadcast_state_updates(changed).await;
                    }
                }
            } else {
                warn!("[HA-WS] get_states failed: {:?}", parsed);
            }
            break;
        }
    }

    cache.set_ha_connected(true);

    // ── Step 4: Subscribe to state_changed events ──
    let sub_id = msg_id.fetch_add(1, Ordering::Relaxed);
    write
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "id": sub_id,
                "type": "subscribe_events",
                "event_type": "state_changed"
            })
            .to_string(),
        ))
        .await?;

    info!("[HA-WS] Subscribed to state_changed events");

    // Mark as connected — commands can now flow through WS
    connected.store(true, Ordering::Relaxed);

    // ── Step 5: Main event loop ──
    //
    // We use `biased` in the select! to prioritize command writes over
    // incoming reads. State change events are handled in background tasks
    // so the select loop returns IMMEDIATELY and can dispatch the next
    // command without waiting for cache updates + broadcasts.
    loop {
        tokio::select! {
            biased;

            // Prioritize outgoing commands — they should never wait for a read
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(command) => {
                        let id = msg_id.fetch_add(1, Ordering::Relaxed);
                        let payload = build_call_service_msg(id, &command);
                        info!("[HA-WS] Sending call_service id={} {}.{} entity={}", id, command.domain, command.service, command.entity_id);
                        if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(payload)).await {
                            warn!("[HA-WS] Write error: {}", e);
                            connected.store(false, Ordering::Relaxed);
                            return Err(e.into());
                        }
                    }
                    None => {
                        // Command channel closed – shutting down
                        return Ok(());
                    }
                }
            }

            msg = read.next() => {
                match msg {
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                        // Spawn state-change handling in a background task so
                        // the select loop is NEVER blocked by cache writes or
                        // broadcast sends. Commands are always processed first.
                        let c = cache.clone();
                        let wm = ws_manager.clone();
                        let dp = db_pool.clone();
                        tokio::spawn(async move {
                            if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                                // Log call_service results (success or error)
                                if parsed["type"].as_str() == Some("result") {
                                    let id = parsed["id"].as_u64().unwrap_or(0);
                                    let success = parsed["success"].as_bool().unwrap_or(false);
                                    if success {
                                        info!("[HA-WS-IN] id={} result: success", id);
                                    } else {
                                        let error_msg = parsed["error"]["message"]
                                            .as_str()
                                            .unwrap_or("Unknown error");
                                        warn!("[HA-WS-IN] id={} result: FAILED: {}", id, error_msg);
                                        // Broadcast error to frontend clients
                                        wm.broadcast_error(
                                            id,
                                            error_msg,
                                        ).await;
                                    }
                                }
                                handle_ha_message(
                                    &parsed, sub_id, &c, &wm, &dp,
                                ).await;
                            }
                        });
                    }
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(data))) => {
                        write.send(tokio_tungstenite::tungstenite::Message::Pong(data)).await?;
                    }
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) | None => {
                        info!("[HA-WS] Connection closed by server");
                        return Ok(());
                    }
                    Some(Err(e)) => {
                        return Err(e.into());
                    }
                    _ => {} // Binary, Pong – ignore
                }
            }
        }
    }
}

// ── Message handlers ────────────────────────────────────────────────

async fn handle_ha_message(
    msg: &Value,
    sub_id: u64,
    cache: &EntityStateCache,
    ws_manager: &WebSocketManager,
    db_pool: &DbPool,
) {
    // We only care about events from our state_changed subscription
    if msg["id"].as_u64() != Some(sub_id) || msg["type"].as_str() != Some("event") {
        return;
    }

    // Handle entity deletion (new_state is null when entity is removed)
    let new_state = match msg.pointer("/event/data/new_state") {
        Some(ns) if !ns.is_null() => ns,
        _ => {
            // Entity was deleted — remove from cache
            if let Some(old_entity_id) = msg
                .pointer("/event/data/entity_id")
                .and_then(|v| v.as_str())
            {
                if cache.remove(old_entity_id).await {
                    info!("[HA-WS] Entity deleted: {}", old_entity_id);
                }
            }
            return;
        }
    };

    let entity: EntityState = match serde_json::from_value(new_state.clone()) {
        Ok(e) => e,
        Err(_) => return, // Unusual format – skip silently
    };

    let changed = cache.update_single(entity.clone()).await;
    if changed {
        crate::METRICS.entity_state_changes.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        ws_manager
            .broadcast_state_updates(vec![entity.clone()])
            .await;

        // Check for warning entities and broadcast warning events
        if is_warning_entity(&entity.entity_id, &entity.attributes) {
            let old_state = msg.pointer("/event/data/old_state/state")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            check_warning_state_change(&entity, old_state, ws_manager, db_pool).await;
        }

        // Log to history in the background (non-blocking)
        let pool = db_pool.clone();
        let ent = entity;
        tokio::spawn(async move {
            let attrs = serde_json::to_string(&ent.attributes).unwrap_or_default();
            let _ = sqlx::query(
                "INSERT INTO entity_history (entity_id, state, attributes, last_changed, recorded_at) VALUES (?, ?, ?, ?, datetime('now'))"
            )
            .bind(&ent.entity_id)
            .bind(&ent.state)
            .bind(&attrs)
            .bind(&ent.last_changed)
            .execute(&pool)
            .await;
        });
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn build_call_service_msg(id: u64, cmd: &WsCommand) -> String {
    // The HA WS protocol wants entity_id in "target", not "service_data".
    // Remove entity_id from service_data if present.
    let mut service_data = cmd.service_data.clone();
    if let Some(obj) = service_data.as_object_mut() {
        obj.remove("entity_id");
    }

    let msg = json!({
        "id": id,
        "type": "call_service",
        "domain": cmd.domain,
        "service": cmd.service,
        "target": {
            "entity_id": cmd.entity_id
        },
        "service_data": service_data
    })
    .to_string();

    info!("[HA-WS-OUT] {}", msg);
    msg
}

fn make_ws_url(ha_url: &str) -> String {
    let base = if ha_url.starts_with("https://") {
        ha_url.replacen("https://", "wss://", 1)
    } else if ha_url.starts_with("http://") {
        ha_url.replacen("http://", "ws://", 1)
    } else {
        format!("ws://{}", ha_url)
    };

    format!("{}/api/websocket", base.trim_end_matches('/'))
}

// ── Warning entity detection ────────────────────────────────────────

/// Known warning-related entity patterns from popular HA integrations:
/// DWD Weather Warnings, NINA, Met Office, NWS, etc.
/// These are the ONLY entity prefixes that trigger the warning bar.
/// Generic safety sensors (smoke, CO, door) are NOT included.
const WARNING_ENTITY_PATTERNS: &[&str] = &[
    // DWD Weather Warnings (Deutscher Wetterdienst)
    "binary_sensor.dwd_weather_warnings_",
    "sensor.dwd_weather_warnings_",
    "binary_sensor.dwd_",
    "sensor.dwd_",
    // NINA (Notfall-Informations- und Nachrichten-App)
    "binary_sensor.nina_",
    "sensor.nina_",
    // MeteoAlarm (European weather)
    "binary_sensor.meteoalarm",
    "sensor.meteoalarm",
    // US National Weather Service
    "binary_sensor.nws_alerts",
    "sensor.nws_alerts",
    // UK Met Office
    "binary_sensor.met_office_weather_warnings",
    // Environment Canada
    "binary_sensor.env_canada_",
];

/// Keywords that MUST appear in the entity_id for keyword-based detection.
/// These are specific to civil protection / weather warning systems.
/// NOT generic words like "alarm" which match smoke/fire sensors.
const WARNING_KEYWORDS: &[&str] = &[
    "weather_warning",
    "unwetterwarnung",
    "sturmwarnung",
    "hochwasser_warnung",
    "severe_weather",
    "weather_alert",
    "civil_protection",
    "katastrophen",
    "warnung_",
    "_warnung",
];

pub fn is_warning_entity(entity_id: &str, attributes: &Value) -> bool {
    let eid_lower = entity_id.to_lowercase();

    // Check known integration patterns first (most reliable)
    for pat in WARNING_ENTITY_PATTERNS {
        if eid_lower.starts_with(pat) {
            return true;
        }
    }

    // Check for specific weather/civil-protection keywords in entity_id
    for kw in WARNING_KEYWORDS {
        if eid_lower.contains(kw) {
            return true;
        }
    }

    // NINA entities can also be identified by their attributes
    if let Some(sender) = attributes.get("sender").and_then(|v| v.as_str()) {
        let sender_lower = sender.to_lowercase();
        if sender_lower.contains("dwd") || sender_lower.contains("bbk")
            || sender_lower.contains("lhp") || sender_lower.contains("mowas") {
            return true;
        }
    }

    false
}

/// Determine the warning severity from entity attributes.
/// Returns (level, title, message)
/// Supports DWD, NINA, MeteoAlarm, NWS formats.
pub fn extract_warning_info(entity: &EntityState) -> (String, String, String) {
    let attrs = &entity.attributes;
    let friendly_name = attrs.get("friendly_name")
        .and_then(|v| v.as_str())
        .unwrap_or(&entity.entity_id);

    // DWD-specific: warning_count, warning_* attributes
    let warning_count = attrs.get("warning_count")
        .and_then(|v| v.as_u64());

    // Try headline from various integration formats
    // NINA: headline, event, sender_name
    // DWD: warning_1_headline, warning_1_name
    let headline = attrs.get("headline")
        .or_else(|| attrs.get("warning_1_headline"))
        .or_else(|| attrs.get("warning_1_name"))
        .or_else(|| attrs.get("title"))
        .or_else(|| attrs.get("event"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Description / message body
    let description = attrs.get("description")
        .or_else(|| attrs.get("warning_1_description"))
        .or_else(|| attrs.get("instruction"))
        .or_else(|| attrs.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Severity detection from attributes
    // NINA: severity attribute ("Minor", "Moderate", "Severe", "Extreme")
    // DWD: warning_1_level (numeric 1-4)
    let severity_str = attrs.get("severity")
        .or_else(|| attrs.get("warning_1_level"))
        .or_else(|| attrs.get("warning_level"))
        .or_else(|| attrs.get("level"))
        .or_else(|| attrs.get("urgency"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();

    let severity_num = attrs.get("warning_1_level")
        .or_else(|| attrs.get("warning_level"))
        .or_else(|| attrs.get("severity"))
        .and_then(|v| v.as_u64());

    // Map severity to notification level
    let level = if severity_str.contains("extreme") || severity_str.contains("extraordinary") || severity_num == Some(4) {
        "emergency"
    } else if severity_str.contains("severe") || severity_str.contains("stark") || severity_num == Some(3) {
        "critical"
    } else if severity_str.contains("moderate") || severity_str.contains("markant") || severity_num == Some(2) {
        "warning"
    } else if severity_str.contains("minor") || severity_str.contains("gering") || severity_num == Some(1) {
        "info"
    } else {
        // Default: if entity is active, treat as at least "warning"
        "warning"
    };

    // Build title - prefer headline, fall back to friendly_name
    let sender = attrs.get("sender").and_then(|v| v.as_str()).unwrap_or("");
    let title = if !headline.is_empty() {
        headline.to_string()
    } else if let Some(count) = warning_count {
        format!("{} – {} Warnung(en)", friendly_name, count)
    } else {
        friendly_name.to_string()
    };

    // Build message - include sender info for NINA
    let mut message = if !description.is_empty() {
        if description.len() > 400 {
            format!("{}…", &description[..400])
        } else {
            description.to_string()
        }
    } else {
        String::new()
    };

    if !sender.is_empty() && !message.contains(sender) {
        if message.is_empty() {
            message = format!("Quelle: {}", sender);
        } else {
            message = format!("{} (Quelle: {})", message, sender);
        }
    }

    (level.to_string(), title, message)
}

/// When a warning entity changes state, broadcast a warning_update event
/// so the frontend can show it in the persistent warning bar.
/// Also logs the warning to the database for the admin dashboard.
async fn check_warning_state_change(
    entity: &EntityState,
    old_state: &str,
    ws_manager: &WebSocketManager,
    db_pool: &DbPool,
) {
    let is_active = matches!(entity.state.as_str(), "on" | "On");
    let was_active = matches!(old_state, "on" | "On");

    // Also check numeric states (some integrations use warning count as state)
    let is_active = is_active || entity.state.parse::<u64>().map_or(false, |n| n > 0);
    let was_active = was_active || old_state.parse::<u64>().map_or(false, |n| n > 0);

    let (level, title, message) = extract_warning_info(entity);

    // Broadcast warning change for the persistent bar
    let event = json!({
        "type": "warning_entity_update",
        "entity_id": entity.entity_id,
        "active": is_active,
        "level": level,
        "title": title,
        "message": message,
        "attributes": entity.attributes,
        "state": entity.state,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    ws_manager.broadcast_json(&event).await;

    // Log to database
    let pool = db_pool.clone();
    let eid = entity.entity_id.clone();
    let attrs_json = serde_json::to_string(&entity.attributes).unwrap_or_default();
    let title_c = title.clone();
    let message_c = message.clone();
    let level_c = level.clone();
    let source = entity.attributes.get("sender")
        .and_then(|v| v.as_str())
        .unwrap_or("Home Assistant")
        .to_string();

    if is_active && !was_active {
        info!("[WARNING] Entity {} activated: [{}] {}", eid, level, title);
        // Insert new warning log entry
        tokio::spawn(async move {
            let _ = sqlx::query(
                "INSERT INTO warning_log (entity_id, title, message, level, source, started_at, attributes_json) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)"
            )
            .bind(&eid)
            .bind(&title_c)
            .bind(&message_c)
            .bind(&level_c)
            .bind(&source)
            .bind(&attrs_json)
            .execute(&pool)
            .await;
        });
    } else if !is_active && was_active {
        info!("[WARNING] Entity {} cleared: {}", eid, title);
        // Close the most recent open log entry for this entity
        tokio::spawn(async move {
            let _ = sqlx::query(
                "UPDATE warning_log SET ended_at = datetime('now') WHERE entity_id = ? AND ended_at IS NULL"
            )
            .bind(&eid)
            .execute(&pool)
            .await;
        });
    }
}
