//! App Webhooks Handler – Webhook management for rumahl apps.
//!
//! API endpoints:
//!   GET    /api/apps/:app_id/webhooks            – List webhooks
//!   POST   /api/apps/:app_id/webhooks            – Create a webhook
//!   GET    /api/apps/:app_id/webhooks/:id        – Get webhook details
//!   PUT    /api/apps/:app_id/webhooks/:id        – Update a webhook
//!   DELETE /api/apps/:app_id/webhooks/:id        – Delete a webhook
//!   POST   /api/apps/:app_id/webhooks/:id/test   – Test a webhook
//!   GET    /api/apps/:app_id/webhooks/:id/logs   – Get delivery logs
//!   GET    /api/apps/:app_id/webhooks/:id/stats  – Get webhook stats

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use tokio::fs;
use tracing::info;

use rumahl_shared::app_webhooks::*;

/// Webhooks data directory
const WEBHOOKS_BASE_DIR: &str = "data/app-webhooks";

#[derive(Clone)]
pub struct AppWebhooksState {
    pub base_dir: PathBuf,
}

impl AppWebhooksState {
    pub fn new() -> Self {
        Self {
            base_dir: PathBuf::from(WEBHOOKS_BASE_DIR),
        }
    }

    fn webhooks_path(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("webhooks.json")
    }

    fn deliveries_path(&self, app_id: &str, webhook_id: &str) -> PathBuf {
        self.base_dir
            .join(app_id)
            .join(format!("deliveries_{}.json", webhook_id))
    }

    async fn load_webhooks(&self, app_id: &str) -> Vec<AppWebhook> {
        let path = self.webhooks_path(app_id);
        if !path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&path).await {
            Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    async fn save_webhooks(&self, app_id: &str, hooks: &[AppWebhook]) -> Result<(), String> {
        if let Some(parent) = self.webhooks_path(app_id).parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string(hooks).map_err(|e| e.to_string())?;
        fs::write(self.webhooks_path(app_id), &content)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// List all webhooks for an app
pub async fn list_webhooks(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Vec<AppWebhook>>, (StatusCode, String)> {
    let hooks = state.load_webhooks(&app_id).await;
    Ok(Json(hooks))
}

/// Create a new webhook
pub async fn create_webhook(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath(app_id): AxumPath<String>,
    Json(req): Json<CreateWebhookRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut hooks = state.load_webhooks(&app_id).await;

    let secret = if req.verify_signature {
        Some(uuid::Uuid::new_v4().to_string())
    } else {
        None
    };

    let webhook = AppWebhook {
        id: uuid::Uuid::new_v4().to_string(),
        name: req.name,
        description: req.description,
        method: req.method,
        target_url: req.target_url,
        header_mapping: req.header_mapping,
        verify_signature: req.verify_signature,
        secret,
        enabled: req.enabled,
        max_retries: req.max_retries,
        rate_limit_per_minute: req.rate_limit_per_minute,
        timeout_seconds: req.timeout_seconds,
        created_at: Utc::now().to_rfc3339(),
    };

    let public_url = format!("/api/webhooks/apps/{}/{}", app_id, webhook.id);

    hooks.push(webhook);
    state
        .save_webhooks(&app_id, &hooks)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    info!("Created webhook for app '{}'", app_id);

    Ok(Json(serde_json::json!({
        "success": true,
        "webhook_id": hooks.last().map(|w| w.id.clone()),
        "public_url": public_url,
    })))
}

/// Get a specific webhook
pub async fn get_webhook(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath((app_id, hook_id)): AxumPath<(String, String)>,
) -> Result<Json<AppWebhook>, (StatusCode, String)> {
    let hooks = state.load_webhooks(&app_id).await;
    hooks
        .into_iter()
        .find(|h| h.id == hook_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Webhook '{}' not found", hook_id),
            )
        })
        .map(Json)
}

/// Update a webhook
pub async fn update_webhook(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath((app_id, hook_id)): AxumPath<(String, String)>,
    Json(req): Json<UpdateWebhookRequest>,
) -> Result<Json<AppWebhook>, (StatusCode, String)> {
    let mut hooks = state.load_webhooks(&app_id).await;

    let hook = hooks.iter_mut().find(|h| h.id == hook_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            format!("Webhook '{}' not found", hook_id),
        )
    })?;

    if let Some(name) = req.name {
        hook.name = name;
    }
    if let Some(desc) = req.description {
        hook.description = desc;
    }
    if let Some(method) = req.method {
        hook.method = method;
    }
    if let Some(url) = req.target_url {
        hook.target_url = url;
    }
    if let Some(mapping) = req.header_mapping {
        hook.header_mapping = mapping;
    }
    if let Some(verify) = req.verify_signature {
        if verify && hook.secret.is_none() {
            hook.secret = Some(uuid::Uuid::new_v4().to_string());
        }
        hook.verify_signature = verify;
    }
    if let Some(enabled) = req.enabled {
        hook.enabled = enabled;
    }
    if let Some(retries) = req.max_retries {
        hook.max_retries = retries;
    }
    if let Some(rate) = req.rate_limit_per_minute {
        hook.rate_limit_per_minute = rate;
    }
    if let Some(timeout) = req.timeout_seconds {
        hook.timeout_seconds = timeout;
    }

    let updated = hook.clone();
    state
        .save_webhooks(&app_id, &hooks)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(updated))
}

/// Delete a webhook
pub async fn delete_webhook(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath((app_id, hook_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut hooks = state.load_webhooks(&app_id).await;
    let before = hooks.len();
    hooks.retain(|h| h.id != hook_id);

    if hooks.len() == before {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Webhook '{}' not found", hook_id),
        ));
    }

    state
        .save_webhooks(&app_id, &hooks)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Clean up delivery logs
    let deliveries_path = state.deliveries_path(&app_id, &hook_id);
    let _ = fs::remove_file(&deliveries_path).await;

    info!("Deleted webhook '{}' for app '{}'", hook_id, app_id);
    Ok(Json(
        serde_json::json!({ "success": true, "deleted": hook_id }),
    ))
}

/// Test a webhook (simulate a delivery)
pub async fn test_webhook(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath((app_id, hook_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let hooks = state.load_webhooks(&app_id).await;
    let hook = hooks.into_iter().find(|h| h.id == hook_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            format!("Webhook '{}' not found", hook_id),
        )
    })?;

    let public_url = format!("/api/webhooks/apps/{}/{}", app_id, hook_id);

    Ok(Json(serde_json::json!({
        "success": true,
        "webhook_id": hook_id,
        "public_url": public_url,
        "method": hook.method,
        "target_url": hook.target_url,
        "verify_signature": hook.verify_signature,
        "has_secret": hook.secret.is_some(),
    })))
}

/// Get delivery logs for a webhook
pub async fn get_webhook_logs(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath((app_id, hook_id)): AxumPath<(String, String)>,
) -> Result<Json<Vec<WebhookDelivery>>, (StatusCode, String)> {
    let path = state.deliveries_path(&app_id, &hook_id);
    if !path.exists() {
        return Ok(Json(Vec::new()));
    }

    let content = fs::read_to_string(&path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read logs: {}", e),
        )
    })?;
    let deliveries: Vec<WebhookDelivery> = serde_json::from_str(&content).unwrap_or_default();

    Ok(Json(deliveries))
}

/// Get webhook statistics
pub async fn get_webhook_stats(
    State(state): State<Arc<AppWebhooksState>>,
    AxumPath((app_id, hook_id)): AxumPath<(String, String)>,
) -> Result<Json<WebhookStats>, (StatusCode, String)> {
    let path = state.deliveries_path(&app_id, &hook_id);
    let deliveries: Vec<WebhookDelivery> = if path.exists() {
        match fs::read_to_string(&path).await {
            Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    let total = deliveries.len() as u64;
    let successful = deliveries
        .iter()
        .filter(|d| d.response.status_code < 400)
        .count() as u64;
    let failed = deliveries
        .iter()
        .filter(|d| d.response.status_code >= 400)
        .count() as u64;
    let total_retries = deliveries.iter().filter(|d| d.attempt > 1).count() as u64;
    let avg_duration = if !deliveries.is_empty() {
        deliveries.iter().map(|d| d.duration_ms).sum::<u64>() as f64 / deliveries.len() as f64
    } else {
        0.0
    };

    Ok(Json(WebhookStats {
        total_received: total,
        successful_deliveries: successful,
        failed_deliveries: failed,
        total_retries,
        average_duration_ms: avg_duration,
        last_delivery: deliveries.into_iter().last(),
    }))
}
