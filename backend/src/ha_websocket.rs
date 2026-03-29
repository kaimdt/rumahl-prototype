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

    // ── Step 1: Wait for auth_required ──
    let msg = read
        .next()
        .await
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

    let msg = read
        .next()
        .await
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
                                        warn!("[HA-WS-IN] id={} result: FAILED {:?}", id, parsed["error"]);
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

    let new_state = match msg.pointer("/event/data/new_state") {
        Some(ns) => ns,
        None => return, // Entity deleted – ignore for now
    };

    let entity: EntityState = match serde_json::from_value(new_state.clone()) {
        Ok(e) => e,
        Err(_) => return, // Unusual format – skip silently
    };

    let changed = cache.update_single(entity.clone()).await;
    if changed {
        ws_manager
            .broadcast_state_updates(vec![entity.clone()])
            .await;

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
