//! App Webhooks – Webhook management for IORA apps.
//!
//! Apps can register webhook endpoints that external services can call.
//! The system handles:
//!   - Webhook URL generation
//!   - Request validation (HMAC signatures)
//!   - Retry logic on failure
//!   - Delivery logging
//!   - Rate limiting
//!
//! Each registered webhook gets a unique URL:
//!   `POST /api/webhooks/apps/{app_id}/{webhook_id}`
//!
//! The system forwards incoming webhook calls to the app's internal
//! endpoint with the original payload, plus signature headers for
//! verification.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// HTTP method for the webhook
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum WebhookMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Default for WebhookMethod {
    fn default() -> Self { WebhookMethod::Post }
}

/// A registered webhook
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppWebhook {
    /// Unique webhook ID
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// Description
    #[serde(default)]
    pub description: String,

    /// HTTP method for the external caller
    #[serde(default)]
    pub method: WebhookMethod,

    /// Internal app endpoint to forward to
    pub target_url: String,

    /// Header mapping: incoming_header -> outgoing_header
    #[serde(default)]
    pub header_mapping: HashMap<String, String>,

    /// Whether to verify HMAC signature
    #[serde(default)]
    pub verify_signature: bool,

    /// HMAC secret (auto-generated if verify_signature is true)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,

    /// Whether the webhook is enabled
    #[serde(default = "default_enabled")]
    pub enabled: bool,

    /// Maximum retries on delivery failure
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,

    /// Rate limit: max requests per minute (0 = unlimited)
    #[serde(default)]
    pub rate_limit_per_minute: u32,

    /// Timeout in seconds for forwarding
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,

    /// Created timestamp
    pub created_at: String,
}

fn default_enabled() -> bool { true }
fn default_max_retries() -> u32 { 3 }
fn default_timeout() -> u64 { 30 }

/// Request to register a new webhook
#[derive(Debug, Deserialize)]
pub struct CreateWebhookRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub method: WebhookMethod,
    pub target_url: String,
    #[serde(default)]
    pub header_mapping: HashMap<String, String>,
    #[serde(default)]
    pub verify_signature: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub max_retries: u32,
    #[serde(default)]
    pub rate_limit_per_minute: u32,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}

/// Update a webhook request
#[derive(Debug, Deserialize)]
pub struct UpdateWebhookRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub method: Option<WebhookMethod>,
    pub target_url: Option<String>,
    pub header_mapping: Option<HashMap<String, String>>,
    pub verify_signature: Option<bool>,
    pub enabled: Option<bool>,
    pub max_retries: Option<u32>,
    pub rate_limit_per_minute: Option<u32>,
    pub timeout_seconds: Option<u64>,
}

/// Webhook delivery log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookDelivery {
    /// Delivery ID
    pub id: String,

    /// Webhook ID
    pub webhook_id: String,

    /// Incoming request details
    pub request: WebhookRequestInfo,

    /// Forwarding result
    pub response: WebhookResponseInfo,

    /// Attempt number
    pub attempt: u32,

    /// Delivery timestamp
    pub delivered_at: String,

    /// Duration in milliseconds
    pub duration_ms: u64,
}

/// Incoming webhook request info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookRequestInfo {
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    pub query_params: HashMap<String, String>,
    pub source_ip: Option<String>,
}

/// Forwarding response info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookResponseInfo {
    pub status_code: u16,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Webhook statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookStats {
    pub total_received: u64,
    pub successful_deliveries: u64,
    pub failed_deliveries: u64,
    pub total_retries: u64,
    pub average_duration_ms: f64,
    pub last_delivery: Option<WebhookDelivery>,
}

/// Webhook configuration in the app manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookConfig {
    /// Pre-register webhooks on app install
    #[serde(default)]
    pub default_webhooks: Vec<AppWebhook>,
}
