use axum::extract::ws::{Message, WebSocket};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

use crate::EntityState;
use crate::db::models::SyncMetadata;

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

    #[serde(rename = "config_changed")]
    ConfigChanged { changes: Vec<SyncMetadata> },

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
    /// Connected clients count
    clients: Arc<RwLock<usize>>,
}

impl WebSocketManager {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        let (config_tx, _) = broadcast::channel(100);
        Self {
            tx,
            config_tx,
            clients: Arc::new(RwLock::new(0)),
        }
    }

    /// Broadcast state updates to all connected clients
    pub async fn broadcast_states(&self, states: Vec<EntityState>) {
        if *self.clients.read().await == 0 {
            return; // No clients connected
        }

        if let Err(e) = self.tx.send(states) {
            warn!("Failed to broadcast states: {}", e);
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
}

/// Handle WebSocket connection
pub async fn handle_socket(socket: WebSocket, ws_manager: Arc<WebSocketManager>) {
    ws_manager.add_client().await;

    let (mut sender, mut receiver) = socket.split();
    let mut rx = ws_manager.subscribe();
    let mut config_rx = ws_manager.subscribe_config();

    // Clone sender for config updates
    let config_sender = Arc::new(tokio::sync::Mutex::new(sender));
    let state_sender = config_sender.clone();

    // Spawn task to send state updates to client
    let mut send_task = tokio::spawn(async move {
        while let Ok(states) = rx.recv().await {
            let message = WSMessage::StateChanged { states };
            let json = match serde_json::to_string(&message) {
                Ok(json) => json,
                Err(e) => {
                    warn!("Failed to serialize message: {}", e);
                    continue;
                }
            };

            let mut sender = state_sender.lock().await;
            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    // Spawn task to send config updates to client
    let config_send_task = tokio::spawn(async move {
        while let Ok(changes) = config_rx.recv().await {
            let message = WSMessage::ConfigChanged { changes };
            let json = match serde_json::to_string(&message) {
                Ok(json) => json,
                Err(e) => {
                    warn!("Failed to serialize config message: {}", e);
                    continue;
                }
            };

            let mut sender = config_sender.lock().await;
            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    // Spawn task to receive messages from client
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(ws_msg) = serde_json::from_str::<WSMessage>(&text) {
                    match ws_msg {
                        WSMessage::Ping => {
                            // Respond with pong (handled automatically by axum)
                        }
                        WSMessage::Auth { token: _ } => {
                            // In a production system, validate the token here
                            // For now, accept all connections
                            info!("WebSocket client authenticated");
                        }
                        _ => {}
                    }
                }
            } else if let Message::Close(_) = msg {
                break;
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
