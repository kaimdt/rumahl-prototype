use axum::extract::ws::{Message, WebSocket};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::time::interval;
use tracing::{debug, info, warn};

use crate::auth;
use crate::EntityState;
use crate::entity_cache::EntityStateCache;
use crate::db::models::SyncMetadata;
use crate::ha_websocket::HAWebSocket;
use crate::ha_client::HomeAssistantClient;
use crate::ServiceCallBuffer;

/// Max commands per second per client (rate limiting)
const MAX_COMMANDS_PER_SECOND: u32 = 30;
/// Max inbound messages per second per client (general flood protection)
const MAX_MESSAGES_PER_SECOND: u32 = 120;
/// Max size of a single inbound text frame in bytes (defensive cap)
const MAX_INBOUND_FRAME_BYTES: usize = 64 * 1024;
/// Disconnect client after this many invalid messages
const MAX_INVALID_MESSAGES: u32 = 10;
/// How often the server sends a Ping frame
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
/// Disconnect client if no inbound activity (pong, msg) within this window
const STALE_AFTER: Duration = Duration::from_secs(75);
/// Time window the client has to send a valid `auth` message after connecting.
/// Commands sent before successful auth are always rejected.
const AUTH_GRACE: Duration = Duration::from_secs(30);
/// Broadcast channel capacities — generously sized to avoid Lagged drops during HA bursts
const BROADCAST_CAP_STATE: usize = 512;
const BROADCAST_CAP_CONFIG: usize = 256;
const BROADCAST_CAP_ERROR: usize = 128;
const BROADCAST_CAP_EVENT: usize = 256;

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WSMessage {
    #[serde(rename = "auth")]
    Auth { token: String },

    #[serde(rename = "auth_ok")]
    AuthOk,

    #[serde(rename = "auth_failed")]
    AuthFailed { message: String },

    #[serde(rename = "state_changed")]
    StateChanged { states: Vec<EntityState> },

    #[serde(rename = "state_update")]
    StateUpdate { changed: Vec<EntityState> },

    #[serde(rename = "config_changed")]
    ConfigChanged { changes: Vec<SyncMetadata> },

    #[serde(rename = "call_service")]
    CallService {
        domain: String,
        service: String,
        entity_id: String,
        #[serde(default)]
        data: serde_json::Value,
    },

    #[serde(rename = "error")]
    Error {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
        message: String,
    },

    #[serde(rename = "ping")]
    Ping,

    #[serde(rename = "pong")]
    Pong,
}

/// Metadata about an authenticated WebSocket connection.
#[derive(Debug, Clone)]
pub struct WsClientInfo {
    pub client_id: u64,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub is_admin: bool,
    pub authenticated: bool,
    pub connected_at: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
}

/// WebSocket connection manager
pub struct WebSocketManager {
    /// Broadcast channel for state updates
    tx: broadcast::Sender<Vec<EntityState>>,
    /// Broadcast channel for configuration sync updates
    config_tx: broadcast::Sender<Vec<SyncMetadata>>,
    /// Broadcast channel for error messages from HA
    error_tx: broadcast::Sender<(u64, String)>,
    /// Broadcast channel for generic JSON events (watchdog, anomaly, health, etc.)
    event_tx: broadcast::Sender<serde_json::Value>,
    /// Per-connection metadata (client_id -> info)
    clients: Arc<RwLock<HashMap<u64, WsClientInfo>>>,
    /// Monotonic counter to generate unique client ids
    next_client_id: AtomicU64,
}

impl WebSocketManager {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAP_STATE);
        let (config_tx, _) = broadcast::channel(BROADCAST_CAP_CONFIG);
        let (error_tx, _) = broadcast::channel(BROADCAST_CAP_ERROR);
        let (event_tx, _) = broadcast::channel(BROADCAST_CAP_EVENT);
        Self {
            tx,
            config_tx,
            error_tx,
            event_tx,
            clients: Arc::new(RwLock::new(HashMap::new())),
            next_client_id: AtomicU64::new(1),
        }
    }

    /// Broadcast only changed entity states to all connected clients
    pub async fn broadcast_state_updates(&self, changed: Vec<EntityState>) {
        if self.clients.read().await.is_empty() {
            return;
        }
        if let Err(e) = self.tx.send(changed) {
            warn!("Failed to broadcast state updates: {}", e);
        }
    }

    /// Broadcast configuration changes to all connected clients
    pub async fn broadcast_config_changes(&self, changes: Vec<SyncMetadata>) {
        if self.clients.read().await.is_empty() {
            return;
        }
        if let Err(e) = self.config_tx.send(changes) {
            warn!("Failed to broadcast config changes: {}", e);
        }
    }

    /// Get a receiver for state updates
    pub fn subscribe(&self) -> broadcast::Receiver<Vec<EntityState>> {
        self.tx.subscribe()
    }

    /// Get a receiver for config updates
    pub fn subscribe_config(&self) -> broadcast::Receiver<Vec<SyncMetadata>> {
        self.config_tx.subscribe()
    }

    /// Get a receiver for error messages
    pub fn subscribe_errors(&self) -> broadcast::Receiver<(u64, String)> {
        self.error_tx.subscribe()
    }

    /// Broadcast an error from HA to all connected frontend clients
    pub async fn broadcast_error(&self, id: u64, message: &str) {
        if self.clients.read().await.is_empty() {
            return;
        }
        let _ = self.error_tx.send((id, message.to_string()));
    }

    /// Broadcast a generic JSON event to all connected clients
    pub async fn broadcast_json(&self, event: &serde_json::Value) {
        if self.clients.read().await.is_empty() {
            return;
        }
        let _ = self.event_tx.send(event.clone());
    }

    /// Get a receiver for generic events
    pub fn subscribe_events(&self) -> broadcast::Receiver<serde_json::Value> {
        self.event_tx.subscribe()
    }

    /// Register a new client connection. Returns a unique client id.
    async fn add_client(&self) -> u64 {
        let client_id = self.next_client_id.fetch_add(1, Ordering::Relaxed);
        let now = chrono::Utc::now();
        let info = WsClientInfo {
            client_id,
            user_id: None,
            username: None,
            is_admin: false,
            authenticated: false,
            connected_at: now,
            last_seen: now,
        };
        let mut clients = self.clients.write().await;
        clients.insert(client_id, info);
        info!("WebSocket client #{} connected. Total: {}", client_id, clients.len());
        client_id
    }

    async fn remove_client(&self, client_id: u64) {
        let mut clients = self.clients.write().await;
        clients.remove(&client_id);
        info!("WebSocket client #{} disconnected. Total: {}", client_id, clients.len());
    }

    async fn mark_authenticated(&self, client_id: u64, claims: &auth::Claims) {
        let mut clients = self.clients.write().await;
        if let Some(info) = clients.get_mut(&client_id) {
            info.authenticated = true;
            info.user_id = Some(claims.sub.clone());
            info.username = Some(claims.username.clone());
            info.is_admin = claims.is_admin;
            info.last_seen = chrono::Utc::now();
        }
    }

    async fn touch_client(&self, client_id: u64) {
        let mut clients = self.clients.write().await;
        if let Some(info) = clients.get_mut(&client_id) {
            info.last_seen = chrono::Utc::now();
        }
    }

    /// Get the number of currently connected frontend clients.
    pub async fn client_count(&self) -> usize {
        self.clients.read().await.len()
    }

    /// Snapshot of all currently connected client metadata.
    pub async fn client_snapshot(&self) -> Vec<WsClientInfo> {
        self.clients.read().await.values().cloned().collect()
    }
}

/// Send a serialized WSMessage to the client via the per-connection mpsc.
/// Returns false if the receiver is gone (client disconnected).
fn send_ws(out: &mpsc::UnboundedSender<Message>, msg: &WSMessage) -> bool {
    match serde_json::to_string(msg) {
        Ok(json) => out.send(Message::Text(json)).is_ok(),
        Err(e) => {
            warn!("[WS] serialize failed: {}", e);
            true
        }
    }
}

/// Handle WebSocket connection
pub async fn handle_socket(
    socket: WebSocket,
    ws_manager: Arc<WebSocketManager>,
    entity_cache: Arc<EntityStateCache>,
    ha_ws: Arc<HAWebSocket>,
    ha_client: Arc<HomeAssistantClient>,
    _service_buffer: Arc<ServiceCallBuffer>,
) {
    let client_id = ws_manager.add_client().await;

    let (mut sender, mut receiver) = socket.split();

    // ── Single-writer pattern: every task sends via this mpsc.
    //    A dedicated writer task drains the channel and writes to the socket.
    //    This eliminates Mutex contention on the WS sink.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();
    let authenticated = Arc::new(AtomicBool::new(false));
    let connect_instant = Instant::now();

    // ── Writer task: owns the SplitSink, also drives the heartbeat ───────
    let writer_authenticated = authenticated.clone();
    let writer_ws_manager = ws_manager.clone();
    let writer_task = tokio::spawn(async move {
        let mut heartbeat = interval(HEARTBEAT_INTERVAL);
        heartbeat.tick().await; // discard immediate tick

        loop {
            tokio::select! {
                msg = out_rx.recv() => {
                    let Some(msg) = msg else { break; };
                    if sender.send(msg).await.is_err() {
                        break;
                    }
                }
                _ = heartbeat.tick() => {
                    // Server-side keepalive
                    if sender.send(Message::Ping(Vec::new())).await.is_err() {
                        break;
                    }
                    // Stale-connection check
                    let last_seen = {
                        let map = writer_ws_manager.clients.read().await;
                        map.get(&client_id).map(|c| c.last_seen)
                    };
                    if let Some(ls) = last_seen {
                        let age = chrono::Utc::now()
                            .signed_duration_since(ls)
                            .num_seconds();
                        if age as u64 > STALE_AFTER.as_secs() {
                            warn!("[WS #{}] stale (no activity for {}s), closing", client_id, age);
                            let _ = sender.send(Message::Close(None)).await;
                            break;
                        }
                    }
                    let _ = writer_authenticated; // silence unused in case of future use
                }
            }
        }
    });

    // ── Reader task: validates inbound messages, enforces auth & rate limits ──
    let reader_out = out_tx.clone();
    let reader_authenticated = authenticated.clone();
    let reader_ws_manager = ws_manager.clone();
    let reader_ha_ws = ha_ws.clone();
    let reader_ha_client = ha_client.clone();
    let reader_task = tokio::spawn(async move {
        let mut command_count: u32 = 0;
        let mut message_count: u32 = 0;
        let mut rate_window_start = Instant::now();
        let mut invalid_count: u32 = 0;

        while let Some(frame) = receiver.next().await {
            let msg = match frame {
                Ok(m) => m,
                Err(e) => {
                    debug!("[WS #{}] recv error: {}", client_id, e);
                    break;
                }
            };

            reader_ws_manager.touch_client(client_id).await;

            // Sliding 1-second window for both message- and command-rate limits
            let now = Instant::now();
            if now.duration_since(rate_window_start).as_secs() >= 1 {
                command_count = 0;
                message_count = 0;
                rate_window_start = now;
            }
            message_count += 1;
            if message_count > MAX_MESSAGES_PER_SECOND {
                warn!("[WS #{}] message flood ({}/s), closing", client_id, message_count);
                let _ = send_ws(&reader_out, &WSMessage::Error {
                    id: None,
                    message: "Message rate limit exceeded.".to_string(),
                });
                break;
            }

            match msg {
                Message::Text(text) => {
                    if text.len() > MAX_INBOUND_FRAME_BYTES {
                        warn!("[WS #{}] oversize frame ({} bytes), closing", client_id, text.len());
                        break;
                    }

                    let parsed = serde_json::from_str::<WSMessage>(&text);
                    let Ok(ws_msg) = parsed else {
                        invalid_count += 1;
                        if invalid_count >= MAX_INVALID_MESSAGES {
                            warn!("[WS #{}] too many invalid messages, closing", client_id);
                            break;
                        }
                        let _ = send_ws(&reader_out, &WSMessage::Error {
                            id: None,
                            message: "Invalid JSON message format".to_string(),
                        });
                        continue;
                    };

                    match ws_msg {
                        WSMessage::Ping => {
                            let _ = send_ws(&reader_out, &WSMessage::Pong);
                        }
                        WSMessage::Pong => {
                            // touch already happened above
                        }
                        WSMessage::Auth { token } => {
                            match auth::verify_token(&token) {
                                Ok(claims) => {
                                    reader_ws_manager.mark_authenticated(client_id, &claims).await;
                                    reader_authenticated.store(true, Ordering::Relaxed);
                                    info!(
                                        "[WS #{}] authenticated as user={} admin={}",
                                        client_id, claims.username, claims.is_admin
                                    );
                                    let _ = send_ws(&reader_out, &WSMessage::AuthOk);
                                }
                                Err(e) => {
                                    warn!("[WS #{}] auth failed: {}", client_id, e);
                                    let _ = send_ws(&reader_out, &WSMessage::AuthFailed {
                                        message: "Invalid or expired token".to_string(),
                                    });
                                    // Give the client a brief moment to read the failure, then close
                                    break;
                                }
                            }
                        }
                        WSMessage::CallService { domain, service, entity_id, data } => {
                            // Hard requirement: authentication before any service call
                            if !reader_authenticated.load(Ordering::Relaxed) {
                                let waited = connect_instant.elapsed();
                                warn!(
                                    "[WS #{}] CallService rejected — unauthenticated (waited {:?})",
                                    client_id, waited
                                );
                                let _ = send_ws(&reader_out, &WSMessage::Error {
                                    id: None,
                                    message: "auth_required".to_string(),
                                });
                                if waited > AUTH_GRACE {
                                    break;
                                }
                                continue;
                            }

                            // Rate limiting on commands
                            command_count += 1;
                            if command_count > MAX_COMMANDS_PER_SECOND {
                                warn!("[WS #{}] command rate limited ({}/s)", client_id, command_count);
                                let _ = send_ws(&reader_out, &WSMessage::Error {
                                    id: None,
                                    message: "Rate limit exceeded. Max 30 commands per second.".to_string(),
                                });
                                continue;
                            }

                            info!("[WS #{}] cmd {}.{} entity={}", client_id, domain, service, entity_id);
                            if reader_ha_ws.is_connected() {
                                let mut service_data = data;
                                if let Some(obj) = service_data.as_object_mut() {
                                    obj.remove("entity_id");
                                }
                                reader_ha_ws.call_service(&domain, &service, &entity_id, service_data);
                            } else {
                                info!("[WS #{}] HA-WS down, REST fallback {}.{}", client_id, domain, service);
                                let client = reader_ha_client.clone();
                                let d = domain;
                                let s = service;
                                let mut call_data = data;
                                if !entity_id.is_empty() {
                                    if let Some(obj) = call_data.as_object_mut() {
                                        obj.insert("entity_id".to_string(), serde_json::Value::String(entity_id));
                                    }
                                }
                                tokio::spawn(async move {
                                    if let Err(e) = client.call_service_fast(&d, &s, call_data).await {
                                        warn!("WS REST fallback failed: {}", e);
                                    }
                                });
                            }
                        }
                        _ => {}
                    }
                }
                Message::Binary(_) => {
                    // Not supported — count as invalid to discourage misuse
                    invalid_count += 1;
                    if invalid_count >= MAX_INVALID_MESSAGES {
                        break;
                    }
                }
                Message::Ping(payload) => {
                    // Axum auto-replies with Pong, but we still register activity
                    let _ = reader_out.send(Message::Pong(payload));
                }
                Message::Pong(_) => {
                    // activity already registered via touch_client above
                }
                Message::Close(_) => break,
            }
        }
    });

    // ── Send initial full snapshot ASAP (no waiting for auth — snapshot is
    //    read-only state already loaded by the cache; sensitive operations
    //    require auth via CallService) ──────────────────────────────────────
    {
        let all_states = entity_cache.get_all().await;
        if !all_states.is_empty() {
            let _ = send_ws(&out_tx, &WSMessage::StateChanged { states: all_states });
        }
    }

    // ── Subscribe to broadcast channels and fan-out into the single writer ──
    let mut rx = ws_manager.subscribe();
    let mut config_rx = ws_manager.subscribe_config();
    let mut error_rx = ws_manager.subscribe_errors();
    let mut event_rx = ws_manager.subscribe_events();

    let state_tx = out_tx.clone();
    let state_send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(changed) => {
                    if changed.is_empty() { continue; }
                    if !send_ws(&state_tx, &WSMessage::StateUpdate { changed }) { break; }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("[WS #{}] state lag: {} skipped", client_id, n);
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let config_tx_clone = out_tx.clone();
    let config_send_task = tokio::spawn(async move {
        loop {
            match config_rx.recv().await {
                Ok(changes) => {
                    if !send_ws(&config_tx_clone, &WSMessage::ConfigChanged { changes }) { break; }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("[WS #{}] config lag: {} skipped", client_id, n);
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let error_tx_clone = out_tx.clone();
    let error_send_task = tokio::spawn(async move {
        loop {
            match error_rx.recv().await {
                Ok((id, message)) => {
                    if !send_ws(&error_tx_clone, &WSMessage::Error { id: Some(id), message }) { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let event_tx_clone = out_tx.clone();
    let event_send_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    if let Ok(json) = serde_json::to_string(&event) {
                        if event_tx_clone.send(Message::Text(json)).is_err() { break; }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // The original sender we keep here just lets us drop it explicitly to
    // close the writer task once any of the critical tasks exit.
    let shutdown_tx = out_tx;

    // Wait for either side to terminate; then tear everything down.
    tokio::select! {
        _ = reader_task => {}
        _ = writer_task => {}
    }

    state_send_task.abort();
    config_send_task.abort();
    error_send_task.abort();
    event_send_task.abort();
    drop(shutdown_tx);
    ws_manager.remove_client(client_id).await;
}
