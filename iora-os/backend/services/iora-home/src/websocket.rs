use axum::extract::ws::{Message, WebSocket};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

use crate::EntityState;
use crate::entity_cache::EntityStateCache;
use crate::db::models::SyncMetadata;
use crate::ha_websocket::HAWebSocket;
use crate::ha_client::HomeAssistantClient;
use crate::ServiceCallBuffer;

/// Max commands per second per client (rate limiting)
const MAX_COMMANDS_PER_SECOND: u32 = 30;

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
    /// Connected clients count
    clients: Arc<RwLock<usize>>,
}

impl WebSocketManager {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        let (config_tx, _) = broadcast::channel(100);
        let (error_tx, _) = broadcast::channel(50);
        let (event_tx, _) = broadcast::channel(100);
        Self {
            tx,
            config_tx,
            error_tx,
            event_tx,
            clients: Arc::new(RwLock::new(0)),
        }
    }

    /// Broadcast only changed entity states to all connected clients
    pub async fn broadcast_state_updates(&self, changed: Vec<EntityState>) {
        if *self.clients.read().await == 0 {
            return; // No clients connected
        }

        if let Err(e) = self.tx.send(changed) {
            warn!("Failed to broadcast state updates: {}", e);
        }
    }

    /// Broadcast configuration changes to all connected clients
    pub async fn broadcast_config_changes(&self, changes: Vec<SyncMetadata>) {
        if *self.clients.read().await == 0 {
            return; // No clients connected
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
        if *self.clients.read().await == 0 {
            return;
        }
        let _ = self.error_tx.send((id, message.to_string()));
    }

    /// Broadcast a generic JSON event to all connected clients
    pub async fn broadcast_json(&self, event: &serde_json::Value) {
        if *self.clients.read().await == 0 {
            return;
        }
        let _ = self.event_tx.send(event.clone());
    }

    /// Get a receiver for generic events
    pub fn subscribe_events(&self) -> broadcast::Receiver<serde_json::Value> {
        self.event_tx.subscribe()
    }

    /// Increment client count
    async fn add_client(&self) {
        let mut count = self.clients.write().await;
        *count += 1;
        info!("WebSocket client connected. Total clients: {}", *count);
    }

    /// Decrement client count
    async fn remove_client(&self) {
        let mut count = self.clients.write().await;
        if *count > 0 {
            *count -= 1;
        }
        info!("WebSocket client disconnected. Total clients: {}", *count);
    }

    /// Get the number of currently connected frontend clients.
    pub async fn client_count(&self) -> usize {
        *self.clients.read().await
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
    ws_manager.add_client().await;

    let (sender, mut receiver) = socket.split();

    // Wrap sender in Arc<Mutex> so multiple tasks can share it.
    let sender = Arc::new(tokio::sync::Mutex::new(sender));

    // Rate limiter state
    let rate_limit_sender = sender.clone();

    // ── Spawn recv_task FIRST ─────────────────────────────────────
    let mut recv_task = tokio::spawn(async move {
        let mut command_count: u32 = 0;
        let mut rate_window_start = Instant::now();

        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                match serde_json::from_str::<WSMessage>(&text) {
                    Ok(ws_msg) => {
                        match ws_msg {
                            WSMessage::Ping => {
                                // Respond with pong
                            }
                            WSMessage::Auth { token: _ } => {
                                info!("WebSocket client authenticated");
                            }
                            WSMessage::CallService { domain, service, entity_id, data } => {
                                // Rate limiting check
                                let now = Instant::now();
                                if now.duration_since(rate_window_start).as_secs() >= 1 {
                                    command_count = 0;
                                    rate_window_start = now;
                                }
                                command_count += 1;
                                if command_count > MAX_COMMANDS_PER_SECOND {
                                    warn!("WebSocket client rate limited ({} cmds/sec)", command_count);
                                    let error_msg = WSMessage::Error {
                                        id: None,
                                        message: "Rate limit exceeded. Max 30 commands per second.".to_string(),
                                    };
                                    if let Ok(json) = serde_json::to_string(&error_msg) {
                                        let mut s = rate_limit_sender.lock().await;
                                        let _ = s.send(Message::Text(json)).await;
                                    }
                                    continue;
                                }

                                info!("[WS-cmd] {}.{} entity={}", domain, service, entity_id);
                                if ha_ws.is_connected() {
                                    let mut service_data = data;
                                    if let Some(obj) = service_data.as_object_mut() {
                                        obj.remove("entity_id");
                                    }
                                    ha_ws.call_service(&domain, &service, &entity_id, service_data);
                                } else {
                                    info!("[WS-cmd] HA-WS not connected, REST fallback for {}.{}", domain, service);
                                    let client = ha_client.clone();
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
                    Err(_e) => {
                        // Send error back to client for invalid JSON
                        let error_msg = WSMessage::Error {
                            id: None,
                            message: "Invalid JSON message format".to_string(),
                        };
                        if let Ok(json) = serde_json::to_string(&error_msg) {
                            let mut s = rate_limit_sender.lock().await;
                            let _ = s.send(Message::Text(json)).await;
                        }
                    }
                }
            } else if let Message::Close(_) = msg {
                break;
            }
        }
    });

    // ── Send full initial state snapshot ───────────────────────────
    // recv_task is already running, so user commands won't block.
    {
        let all_states = entity_cache.get_all().await;
        if !all_states.is_empty() {
            let message = WSMessage::StateChanged { states: all_states };
            if let Ok(json) = serde_json::to_string(&message) {
                let mut s = sender.lock().await;
                if s.send(Message::Text(json)).await.is_err() {
                    ws_manager.remove_client().await;
                    recv_task.abort();
                    return;
                }
            }
        }
    }

    // Subscribe to broadcast channels AFTER sending the initial snapshot so
    // we don't miss any updates that arrive while serializing/sending.
    let mut rx = ws_manager.subscribe();
    let mut config_rx = ws_manager.subscribe_config();
    let mut error_rx = ws_manager.subscribe_errors();
    let mut event_rx = ws_manager.subscribe_events();

    let state_sender = sender.clone();
    let config_sender = sender.clone();
    let error_sender = sender.clone();
    let event_sender = sender;

    // Spawn task to send state updates to client
    let mut send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(changed) => {
                    if changed.is_empty() {
                        continue;
                    }
                    let message = WSMessage::StateUpdate { changed };
                    let json = match serde_json::to_string(&message) {
                        Ok(json) => json,
                        Err(e) => {
                            warn!("Failed to serialize message: {}", e);
                            continue;
                        }
                    };

                    let mut s = state_sender.lock().await;
                    if s.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("WebSocket client lagged, skipped {} messages", n);
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });

    // Spawn task to send config updates to client
    let _config_send_task = tokio::spawn(async move {
        loop {
            match config_rx.recv().await {
                Ok(changes) => {
                    let message = WSMessage::ConfigChanged { changes };
                    let json = match serde_json::to_string(&message) {
                        Ok(json) => json,
                        Err(e) => {
                            warn!("Failed to serialize config message: {}", e);
                            continue;
                        }
                    };

                    let mut s = config_sender.lock().await;
                    if s.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("WebSocket config client lagged, skipped {} messages", n);
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });

    // Spawn task to forward HA errors to client
    let _error_send_task = tokio::spawn(async move {
        loop {
            match error_rx.recv().await {
                Ok((id, message)) => {
                    let error_msg = WSMessage::Error {
                        id: Some(id),
                        message,
                    };
                    let json = match serde_json::to_string(&error_msg) {
                        Ok(json) => json,
                        Err(_) => continue,
                    };
                    let mut s = error_sender.lock().await;
                    if s.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Spawn task to forward generic JSON events (watchdog, anomaly, health) to client
    let _event_send_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    let json = match serde_json::to_string(&event) {
                        Ok(json) => json,
                        Err(_) => continue,
                    };
                    let mut s = event_sender.lock().await;
                    if s.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Wait for any task to finish
    tokio::select! {
        _ = (&mut send_task) => {
            recv_task.abort();
        }
        _ = (&mut recv_task) => {
            send_task.abort();
        }
    }

    ws_manager.remove_client().await;
}
