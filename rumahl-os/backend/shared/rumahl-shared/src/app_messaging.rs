//! App Messaging – Inter-app pub/sub messaging for rumahl apps.
//!
//! Apps can publish messages to channels and subscribe to messages
//! from other apps. This enables loose coupling between apps while
//! maintaining isolation.
//!
//! Communication patterns:
//!   - **Pub/Sub** – One-to-many broadcast on named channels
//!   - **Direct** – App-to-app direct messaging
//!   - **Events** – System events that apps can listen to
//!
//! Messages are scoped: an app can only subscribe to channels it
//! has declared in its manifest, unless it has the `MessagingWildcard`
//! permission.

use serde::{Deserialize, Serialize};

/// Message channel type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ChannelType {
    /// Public channel (any app with permission can subscribe)
    #[default]
    Public,
    /// Protected channel (only the owning app and permitted apps)
    Protected,
    /// System channel (reserved for rumahl core events)
    System,
}

/// A message channel
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageChannel {
    /// Channel name (namespaced with app ID, e.g. "myapp:alerts")
    pub name: String,

    /// Channel type
    #[serde(default)]
    pub channel_type: ChannelType,

    /// Description of what this channel is for
    #[serde(default)]
    pub description: String,

    /// Apps allowed to publish to this channel (empty = owner only)
    #[serde(default)]
    pub allowed_publishers: Vec<String>,

    /// Apps allowed to subscribe to this channel (empty = any)
    #[serde(default)]
    pub allowed_subscribers: Vec<String>,

    /// Maximum message retention in seconds (0 = no retention)
    #[serde(default = "default_retention")]
    pub retention_seconds: u64,

    /// Maximum message size in bytes
    #[serde(default = "default_max_message_size")]
    pub max_message_size_bytes: u64,
}

fn default_retention() -> u64 {
    3600
}
fn default_max_message_size() -> u64 {
    1024 * 100
} // 100 KB

/// A message published to a channel
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Unique message ID
    pub id: String,

    /// Channel name
    pub channel: String,

    /// Publisher app ID
    pub publisher: String,

    /// Message payload (any JSON value)
    pub payload: serde_json::Value,

    /// Message priority
    #[serde(default)]
    pub priority: MessagePriority,

    /// Timestamp
    pub timestamp: String,

    /// Time-to-live in seconds
    #[serde(default = "default_ttl")]
    pub ttl_seconds: u64,
}

fn default_ttl() -> u64 {
    300
} // 5 minutes

/// Message priority
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum MessagePriority {
    Low,
    #[default]
    Normal,
    High,
    Critical,
}

/// Subscription to a message channel
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    /// Subscription ID
    pub id: String,

    /// App ID that owns this subscription
    pub app_id: String,

    /// Channel name to subscribe to
    pub channel: String,

    /// Optional filter expression (JSON path)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,

    /// Webhook URL to deliver messages to (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,

    /// Created timestamp
    pub created_at: String,
}

/// Request to publish a message
#[derive(Debug, Deserialize)]
pub struct PublishMessageRequest {
    /// Channel name
    pub channel: String,

    /// Message payload
    pub payload: serde_json::Value,

    /// Optional priority
    #[serde(default)]
    pub priority: MessagePriority,

    /// Optional TTL in seconds
    #[serde(default = "default_ttl")]
    pub ttl_seconds: u64,
}

/// Request to subscribe to a channel
#[derive(Debug, Deserialize)]
pub struct SubscribeRequest {
    /// Channel name
    pub channel: String,

    /// Optional JSON path filter
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,

    /// Optional webhook URL for async delivery
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
}

/// Messaging configuration in the app manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagingConfig {
    /// Channels this app declares
    #[serde(default)]
    pub channels: Vec<MessageChannel>,

    /// Default subscriptions to auto-create on install
    #[serde(default)]
    pub default_subscriptions: Vec<String>,
}

/// Direct message between two apps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectMessage {
    pub id: String,
    pub from: String,
    pub to: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
    pub read: bool,
}

/// Send a direct message
#[derive(Debug, Deserialize)]
pub struct SendDirectMessageRequest {
    /// Target app ID
    pub to: String,

    /// Message payload
    pub payload: serde_json::Value,
}
