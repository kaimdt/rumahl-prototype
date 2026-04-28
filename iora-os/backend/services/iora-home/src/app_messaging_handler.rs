//! App Messaging Handler – Inter-app pub/sub messaging for IORA apps.
//!
//! API endpoints:
//!   GET    /api/apps/messaging/channels         – List available channels
//!   POST   /api/apps/messaging/publish          – Publish a message
//!   POST   /api/apps/:app_id/messaging/subscribe  – Subscribe to a channel
//!   DELETE /api/apps/:app_id/messaging/subscriptions/:id – Unsubscribe
//!   GET    /api/apps/:app_id/messaging/subscriptions – List subscriptions
//!   POST   /api/apps/messaging/direct           – Send direct message
//!   GET    /api/apps/:app_id/messaging/inbox    – Get direct messages
//!   POST   /api/apps/:app_id/messaging/inbox/:id/read – Mark as read
//!   GET    /api/apps/messaging/events           – SSE stream of messages

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::sse::{Event, Sse},
    Json,
};
use chrono::Utc;
use futures_util::Stream;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use iora_shared::app_messaging::*;

/// Messaging data directory
const MESSAGING_BASE_DIR: &str = "data/app-messaging";

#[derive(Clone)]
pub struct AppMessagingState {
    pub base_dir: PathBuf,
    /// Broadcast channel for real-time message streaming
    pub events_tx: broadcast::Sender<Message>,
}

impl AppMessagingState {
    pub fn new() -> Self {
        let (events_tx, _) = broadcast::channel(1024);
        Self {
            base_dir: PathBuf::from(MESSAGING_BASE_DIR),
            events_tx,
        }
    }

    fn channels_path(&self) -> PathBuf {
        self.base_dir.join("channels.json")
    }

    fn subscriptions_path(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("subscriptions.json")
    }

    fn inbox_path(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("inbox.json")
    }

    async fn load_channels(&self) -> Vec<MessageChannel> {
        let path = self.channels_path();
        if !path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&path).await {
            Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    async fn save_channels(&self, channels: &[MessageChannel]) -> Result<(), String> {
        if let Some(parent) = self.channels_path().parent() {
            fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string(channels).map_err(|e| e.to_string())?;
        fs::write(self.channels_path(), &content).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn load_subscriptions(&self, app_id: &str) -> Vec<Subscription> {
        let path = self.subscriptions_path(app_id);
        if !path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&path).await {
            Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    async fn save_subscriptions(&self, app_id: &str, subs: &[Subscription]) -> Result<(), String> {
        if let Some(parent) = self.subscriptions_path(app_id).parent() {
            fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string(subs).map_err(|e| e.to_string())?;
        fs::write(self.subscriptions_path(app_id), &content).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn load_inbox(&self, app_id: &str) -> Vec<DirectMessage> {
        let path = self.inbox_path(app_id);
        if !path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&path).await {
            Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    async fn save_inbox(&self, app_id: &str, msgs: &[DirectMessage]) -> Result<(), String> {
        if let Some(parent) = self.inbox_path(app_id).parent() {
            fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string(msgs).map_err(|e| e.to_string())?;
        fs::write(self.inbox_path(app_id), &content).await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// List all registered message channels
pub async fn list_channels(
    State(state): State<Arc<AppMessagingState>>,
) -> Result<Json<Vec<MessageChannel>>, (StatusCode, String)> {
    let channels = state.load_channels().await;
    Ok(Json(channels))
}

/// Register a new channel
pub async fn register_channel(
    State(state): State<Arc<AppMessagingState>>,
    Json(channel): Json<MessageChannel>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut channels = state.load_channels().await;
    let channel_name = channel.name.clone();

    if channels.iter().any(|c| c.name == channel_name) {
        return Err((StatusCode::CONFLICT, format!("Channel '{}' already exists", channel_name)));
    }

    channels.push(channel);
    state.save_channels(&channels).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({ "success": true, "channel": channel_name })))
}

/// Publish a message to a channel
pub async fn publish_message(
    State(state): State<Arc<AppMessagingState>>,
    Json(req): Json<PublishMessageRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let channels = state.load_channels().await;

    // Verify channel exists
    if !channels.iter().any(|c| c.name == req.channel) {
        return Err((StatusCode::NOT_FOUND, format!("Channel '{}' not found", req.channel)));
    }

    let msg = Message {
        id: uuid::Uuid::new_v4().to_string(),
        channel: req.channel,
        publisher: "system".to_string(),
        payload: req.payload,
        priority: req.priority,
        timestamp: Utc::now().to_rfc3339(),
        ttl_seconds: req.ttl_seconds,
    };

    // Broadcast to subscribers
    let _ = state.events_tx.send(msg.clone());

    info!("Published message to channel '{}'", msg.channel);

    Ok(Json(serde_json::json!({
        "success": true,
        "message_id": msg.id,
        "channel": msg.channel,
        "timestamp": msg.timestamp,
    })))
}

/// Subscribe to a channel
pub async fn subscribe(
    State(state): State<Arc<AppMessagingState>>,
    AxumPath(app_id): AxumPath<String>,
    Json(req): Json<SubscribeRequest>,
) -> Result<Json<Subscription>, (StatusCode, String)> {
    let channels = state.load_channels().await;
    if !channels.iter().any(|c| c.name == req.channel) {
        return Err((StatusCode::NOT_FOUND, format!("Channel '{}' not found", req.channel)));
    }

    let mut subs = state.load_subscriptions(&app_id).await;

    let subscription = Subscription {
        id: uuid::Uuid::new_v4().to_string(),
        app_id: app_id.clone(),
        channel: req.channel,
        filter: req.filter,
        webhook_url: req.webhook_url,
        created_at: Utc::now().to_rfc3339(),
    };

    subs.push(subscription.clone());
    state.save_subscriptions(&app_id, &subs).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    info!("App '{}' subscribed to channel '{}'", app_id, subscription.channel);
    Ok(Json(subscription))
}

/// List subscriptions for an app
pub async fn list_subscriptions(
    State(state): State<Arc<AppMessagingState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Vec<Subscription>>, (StatusCode, String)> {
    let subs = state.load_subscriptions(&app_id).await;
    Ok(Json(subs))
}

/// Unsubscribe from a channel
pub async fn unsubscribe(
    State(state): State<Arc<AppMessagingState>>,
    AxumPath((app_id, sub_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut subs = state.load_subscriptions(&app_id).await;
    let before = subs.len();
    subs.retain(|s| s.id != sub_id);

    if subs.len() == before {
        return Err((StatusCode::NOT_FOUND, format!("Subscription '{}' not found", sub_id)));
    }

    state.save_subscriptions(&app_id, &subs).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({ "success": true, "deleted": sub_id })))
}

/// Send a direct message to another app
pub async fn send_direct_message(
    State(state): State<Arc<AppMessagingState>>,
    AxumPath(from_app_id): AxumPath<String>,
    Json(req): Json<SendDirectMessageRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let msg = DirectMessage {
        id: uuid::Uuid::new_v4().to_string(),
        from: from_app_id,
        to: req.to.clone(),
        payload: req.payload,
        timestamp: Utc::now().to_rfc3339(),
        read: false,
    };

    // Store in recipient's inbox
    let mut inbox = state.load_inbox(&req.to).await;
    inbox.push(msg.clone());
    state.save_inbox(&req.to, &inbox).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Also emit via broadcast
    let _ = state.events_tx.send(Message {
        id: msg.id.clone(),
        channel: format!("direct:{}", req.to),
        publisher: msg.from.clone(),
        payload: serde_json::json!({
            "from": msg.from,
            "to": msg.to,
            "payload": msg.payload,
        }),
        priority: MessagePriority::Normal,
        timestamp: msg.timestamp.clone(),
        ttl_seconds: 3600,
    });

    Ok(Json(serde_json::json!({
        "success": true,
        "message_id": msg.id,
    })))
}

/// Get inbox (direct messages) for an app
pub async fn get_inbox(
    State(state): State<Arc<AppMessagingState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Vec<DirectMessage>>, (StatusCode, String)> {
    let inbox = state.load_inbox(&app_id).await;
    Ok(Json(inbox))
}

/// Mark a direct message as read
pub async fn mark_message_read(
    State(state): State<Arc<AppMessagingState>>,
    AxumPath((app_id, msg_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut inbox = state.load_inbox(&app_id).await;

    let msg = inbox.iter_mut().find(|m| m.id == msg_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Message '{}' not found", msg_id)))?;

    msg.read = true;

    state.save_inbox(&app_id, &inbox).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({ "success": true, "message_id": msg_id, "read": true })))
}

/// SSE stream for real-time messages
pub async fn message_stream(
    State(state): State<Arc<AppMessagingState>>,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.events_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(message) => {
            let data = serde_json::to_string(&message).unwrap_or_default();
            Some(Ok(Event::default().data(data)))
        }
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}
