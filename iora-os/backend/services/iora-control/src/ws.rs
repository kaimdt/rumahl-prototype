use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    ServiceStatusUpdate {
        service: String,
        status: String,
        timestamp: String,
    },
    ResourceUpdate {
        cpu_percent: f32,
        memory_mb: f64,
        disk_percent: f32,
        timestamp: String,
    },
    AlertNotification {
        severity: String,
        message: String,
        timestamp: String,
    },
    LogEntry {
        service: String,
        level: String,
        message: String,
        timestamp: String,
    },
}

#[derive(Clone)]
pub struct WsState {
    pub connections: Arc<DashMap<String, broadcast::Sender<String>>>,
    pub global_tx: broadcast::Sender<String>,
}

impl WsState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1000);
        Self {
            connections: Arc::new(DashMap::new()),
            global_tx: tx,
        }
    }

    pub fn broadcast(&self, message: WsMessage) {
        if let Ok(json) = serde_json::to_string(&message) {
            let _ = self.global_tx.send(json);
        }
    }
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<WsState>>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<WsState>) {
    let (sender, mut receiver) = socket.split();
    let conn_id = Uuid::new_v4().to_string();

    let mut rx = state.global_tx.subscribe();
    let sender = Arc::new(tokio::sync::Mutex::new(sender));

    // Spawn task to send messages
    let sender_clone = sender.clone();
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            let mut sender_lock = sender_clone.lock().await;
            if sender_lock.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Receive ping/pong messages
    let conn_id_clone = conn_id.clone();
    let receive_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Ping(_) => {
                    tracing::trace!("Received ping from {}", conn_id_clone);
                }
                Message::Pong(_) => {
                    tracing::trace!("Received pong from {}", conn_id_clone);
                }
                Message::Close(_) => {
                    tracing::info!("WebSocket connection {} closed by client", conn_id_clone);
                    break;
                }
                _ => {}
            }
        }
    });

    tracing::info!("WebSocket connection {} established", conn_id);

    // Wait for either task to finish
    tokio::select! {
        _ = send_task => {},
        _ = receive_task => {},
    }

    tracing::info!("WebSocket connection {} closed", conn_id);
}
