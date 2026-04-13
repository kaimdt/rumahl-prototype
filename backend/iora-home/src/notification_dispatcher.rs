//! IORA Notification Dispatcher
//!
//! Routes outbound notifications to multiple channels:
//! - **IORA** – internal dashboard notification (DB + WebSocket broadcast)
//! - **HA Mobile** – Home Assistant `notify.mobile_app_*` service (push to smartphones)
//! - **Desktop** – IORA Desktop Client (WebSocket push)
//!
//! Each channel is configured via the `notification_channels` DB table.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::{websocket::WebSocketManager, ha_client::HomeAssistantClient};

// ─── Data Types ─────────────────────────────────────────────────────────────

/// A notification to be dispatched through one or more channels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchRequest {
    pub title: String,
    pub message: String,
    /// Severity level: "info" | "warning" | "critical" | "emergency"
    pub level: String,
    pub source: String,
    pub icon: String,
    pub entity_id: String,
    pub auto_dismiss_secs: i32,
    /// Optional list of channel IDs to target. If empty, all enabled channels are used.
    pub channels: Vec<String>,
    /// Extra data forwarded to channels (e.g. HA `data` block for mobile push).
    pub extra_data: serde_json::Value,
}

impl Default for DispatchRequest {
    fn default() -> Self {
        Self {
            title: "Benachrichtigung".to_string(),
            message: String::new(),
            level: "info".to_string(),
            source: "system".to_string(),
            icon: String::new(),
            entity_id: String::new(),
            auto_dismiss_secs: 0,
            channels: Vec::new(),
            extra_data: serde_json::Value::Null,
        }
    }
}

/// A single notification channel record from the DB.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct NotificationChannel {
    pub id: String,
    pub name: String,
    pub channel_type: String,
    pub target_id: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Result per channel after a dispatch attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelResult {
    pub channel_id: String,
    pub channel_type: String,
    pub status: String, // "ok" | "error" | "skipped"
    pub error: Option<String>,
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

pub struct NotificationDispatcher {
    db: PgPool,
    ws_manager: Arc<WebSocketManager>,
    ha_client: Arc<HomeAssistantClient>,
}

impl NotificationDispatcher {
    pub fn new(
        db: PgPool,
        ws_manager: Arc<WebSocketManager>,
        ha_client: Arc<HomeAssistantClient>,
    ) -> Self {
        Self { db, ws_manager, ha_client }
    }

    /// Load all enabled channels (or a filtered subset by IDs).
    pub async fn load_channels(&self, filter_ids: &[String]) -> Vec<NotificationChannel> {
        let rows: Vec<NotificationChannel> = if filter_ids.is_empty() {
            sqlx::query_as(
                "SELECT id, name, channel_type, target_id, enabled, config, created_at, updated_at \
                 FROM notification_channels WHERE enabled = TRUE ORDER BY created_at ASC"
            )
            .fetch_all(&self.db)
            .await
            .unwrap_or_default()
        } else {
            // SQLx doesn't support dynamic IN with bind so iterate
            let mut result = Vec::new();
            for id in filter_ids {
                let row: Option<NotificationChannel> = sqlx::query_as(
                    "SELECT id, name, channel_type, target_id, enabled, config, created_at, updated_at \
                     FROM notification_channels WHERE id = $1 AND enabled = TRUE"
                )
                .bind(id)
                .fetch_optional(&self.db)
                .await
                .unwrap_or(None);
                if let Some(ch) = row {
                    result.push(ch);
                }
            }
            result
        };
        rows
    }

    /// Dispatch a notification to all applicable channels and persist results.
    /// Always dispatches to the IORA internal channel regardless of `channels` filter.
    pub async fn dispatch(
        &self,
        req: DispatchRequest,
    ) -> (String, Vec<ChannelResult>) {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        // 1. Always persist to IORA internal notification table
        let iora_result = self.dispatch_iora(&id, &req, now).await;
        let mut results = vec![ChannelResult {
            channel_id: "iora".to_string(),
            channel_type: "iora".to_string(),
            status: if iora_result.is_ok() { "ok" } else { "error" }.to_string(),
            error: iora_result.err(),
        }];

        // 2. Load configured channels
        let channels = self.load_channels(&req.channels).await;

        for channel in channels {
            let ch_result = match channel.channel_type.as_str() {
                "iora" => {
                    // Already handled above; skip duplicates
                    ChannelResult {
                        channel_id: channel.id.clone(),
                        channel_type: "iora".to_string(),
                        status: "skipped".to_string(),
                        error: None,
                    }
                }
                "ha_mobile" => {
                    let r = self.dispatch_ha_mobile(&channel, &req).await;
                    ChannelResult {
                        channel_id: channel.id.clone(),
                        channel_type: "ha_mobile".to_string(),
                        status: if r.is_ok() { "ok" } else { "error" }.to_string(),
                        error: r.err(),
                    }
                }
                "desktop" => {
                    let r = self.dispatch_desktop(&channel, &id, &req).await;
                    ChannelResult {
                        channel_id: channel.id.clone(),
                        channel_type: "desktop".to_string(),
                        status: if r.is_ok() { "ok" } else { "error" }.to_string(),
                        error: r.err(),
                    }
                }
                other => ChannelResult {
                    channel_id: channel.id.clone(),
                    channel_type: other.to_string(),
                    status: "skipped".to_string(),
                    error: Some(format!("Unknown channel type: {other}")),
                },
            };

            // Persist dispatch log
            let _ = sqlx::query(
                "INSERT INTO notification_dispatch_log \
                 (id, notification_id, channel_id, channel_type, status, error_message, dispatched_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7)"
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&id)
            .bind(&ch_result.channel_id)
            .bind(&ch_result.channel_type)
            .bind(&ch_result.status)
            .bind(ch_result.error.as_deref().unwrap_or(""))
            .bind(now)
            .execute(&self.db)
            .await;

            results.push(ch_result);
        }

        (id, results)
    }

    // ── Channel implementations ──────────────────────────────────────────────

    /// Persist notification to DB and broadcast over WebSocket to all connected dashboard clients.
    async fn dispatch_iora(
        &self,
        id: &str,
        req: &DispatchRequest,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO notifications \
             (id, title, message, level, source, icon, entity_id, created_at, read, auto_dismiss_secs) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)"
        )
        .bind(id)
        .bind(&req.title)
        .bind(&req.message)
        .bind(&req.level)
        .bind(&req.source)
        .bind(&req.icon)
        .bind(&req.entity_id)
        .bind(now)
        .bind(req.auto_dismiss_secs)
        .execute(&self.db)
        .await
        .map_err(|e| format!("DB insert failed: {e}"))?;

        // Prune old notifications (keep max 200)
        let _ = sqlx::query(
            "DELETE FROM notifications WHERE id NOT IN \
             (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 200)"
        )
        .execute(&self.db)
        .await;

        let notification = serde_json::json!({
            "id": id,
            "title": req.title,
            "message": req.message,
            "level": req.level,
            "source": req.source,
            "icon": req.icon,
            "entity_id": req.entity_id,
            "created_at": now.to_rfc3339(),
            "read": false,
            "auto_dismiss_secs": req.auto_dismiss_secs,
        });

        let event = serde_json::json!({
            "type": "notification",
            "action": "new",
            "notification": notification,
        });
        self.ws_manager.broadcast_json(&event).await;

        info!("[notif] IORA: [{}] {}", req.level, req.title);
        Ok(())
    }

    /// Send push notification via Home Assistant `notify.{target_id}` service.
    ///
    /// HA `notify` service data format:
    /// ```json
    /// { "message": "...", "title": "...", "data": { ... } }
    /// ```
    async fn dispatch_ha_mobile(
        &self,
        channel: &NotificationChannel,
        req: &DispatchRequest,
    ) -> Result<(), String> {
        if channel.target_id.is_empty() {
            return Err("No HA notify target configured".to_string());
        }

        // Build HA notify service payload
        let mut notify_data = serde_json::json!({
            "message": req.message,
            "title": req.title,
        });

        // Merge channel-level config `data` override if present
        let mut ha_data = serde_json::Map::new();
        if let Some(cfg_data) = channel.config.get("data").and_then(|v| v.as_object()) {
            ha_data.extend(cfg_data.clone());
        }
        // Merge request-level extra_data
        if let Some(extra) = req.extra_data.as_object() {
            if let Some(req_data) = extra.get("data").and_then(|v| v.as_object()) {
                ha_data.extend(req_data.clone());
            }
        }
        // Map severity to HA importance
        if !ha_data.contains_key("importance") {
            let importance = match req.level.as_str() {
                "critical" | "emergency" => "high",
                "warning" => "default",
                _ => "low",
            };
            ha_data.insert("importance".to_string(), serde_json::Value::String(importance.to_string()));
        }
        if !ha_data.is_empty() {
            notify_data["data"] = serde_json::Value::Object(ha_data);
        }

        self.ha_client
            .call_service_fast("notify", &channel.target_id, notify_data)
            .await
            .map_err(|e| format!("HA notify failed: {e}"))?;

        info!("[notif] HA mobile → {}: [{}] {}", channel.target_id, req.level, req.title);
        Ok(())
    }

    /// Push a notification directly to the IORA Desktop Client via WebSocket.
    async fn dispatch_desktop(
        &self,
        channel: &NotificationChannel,
        id: &str,
        req: &DispatchRequest,
    ) -> Result<(), String> {
        let event = serde_json::json!({
            "type": "desktop_notification",
            "target": channel.target_id,  // '*' = all connected desktop clients
            "notification": {
                "id": id,
                "title": req.title,
                "message": req.message,
                "level": req.level,
                "source": req.source,
                "icon": req.icon,
                "auto_dismiss_secs": req.auto_dismiss_secs,
            }
        });
        self.ws_manager.broadcast_json(&event).await;
        info!("[notif] Desktop → {}: [{}] {}", channel.target_id, req.level, req.title);
        Ok(())
    }

    // ── Channel CRUD helpers ─────────────────────────────────────────────────

    pub async fn list_channels(&self) -> Vec<NotificationChannel> {
        sqlx::query_as(
            "SELECT id, name, channel_type, target_id, enabled, config, created_at, updated_at \
             FROM notification_channels ORDER BY created_at ASC"
        )
        .fetch_all(&self.db)
        .await
        .unwrap_or_default()
    }

    pub async fn create_channel(
        &self,
        name: String,
        channel_type: String,
        target_id: String,
        config: serde_json::Value,
    ) -> Result<NotificationChannel, String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();
        sqlx::query(
            "INSERT INTO notification_channels (id, name, channel_type, target_id, enabled, config, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, TRUE, $5, $6, $6)"
        )
        .bind(&id)
        .bind(&name)
        .bind(&channel_type)
        .bind(&target_id)
        .bind(&config)
        .bind(now)
        .execute(&self.db)
        .await
        .map_err(|e| format!("DB error: {e}"))?;

        Ok(NotificationChannel {
            id,
            name,
            channel_type,
            target_id,
            enabled: true,
            config,
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn update_channel(
        &self,
        id: &str,
        name: Option<String>,
        target_id: Option<String>,
        enabled: Option<bool>,
        config: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let now = chrono::Utc::now();
        sqlx::query(
            "UPDATE notification_channels SET \
             name = COALESCE($2, name), \
             target_id = COALESCE($3, target_id), \
             enabled = COALESCE($4, enabled), \
             config = COALESCE($5, config), \
             updated_at = $6 \
             WHERE id = $1"
        )
        .bind(id)
        .bind(name.as_deref())
        .bind(target_id.as_deref())
        .bind(enabled)
        .bind(config.as_ref())
        .bind(now)
        .execute(&self.db)
        .await
        .map_err(|e| format!("DB update failed: {e}"))?;
        Ok(())
    }

    pub async fn delete_channel(&self, id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM notification_channels WHERE id = $1")
            .bind(id)
            .execute(&self.db)
            .await
            .map_err(|e| format!("DB delete failed: {e}"))?;
        Ok(())
    }
}
