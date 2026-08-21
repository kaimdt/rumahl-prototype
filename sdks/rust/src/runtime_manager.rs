use crate::error::{RumahlError, Result};
use crate::runtime::{AppStatus, RumahlMessage, LogLevel, PermissionToken};
use crate::permissions::Permission;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock, Mutex};
use tokio::time;

/// Configuration for the runtime manager
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    /// App ID
    pub app_id: String,

    /// Heartbeat interval in seconds
    pub heartbeat_interval: u64,

    /// rumahl communication endpoint (Unix socket or WebSocket URL)
    pub rumahl_endpoint: String,

    /// Whether to enable automatic heartbeat
    pub auto_heartbeat: bool,

    /// Maximum query response time in seconds
    pub query_timeout: u64,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            heartbeat_interval: 5,
            rumahl_endpoint: String::new(),
            auto_heartbeat: true,
            query_timeout: 30,
        }
    }
}

/// Runtime manager handles app lifecycle, communication with rumahl, and permission management
pub struct RuntimeManager {
    config: RuntimeConfig,
    status: Arc<RwLock<AppStatus>>,
    permission_tokens: Arc<RwLock<HashMap<String, PermissionToken>>>,
    message_sender: mpsc::UnboundedSender<RumahlMessage>,
    message_receiver: Arc<Mutex<mpsc::UnboundedReceiver<RumahlMessage>>>,
    query_handlers: Arc<RwLock<HashMap<String, Box<dyn Fn(Value) -> Result<Value> + Send + Sync>>>>,
}

impl RuntimeManager {
    /// Create a new runtime manager from environment
    pub async fn from_env() -> Result<Self> {
        let app_id = std::env::var("RUMAHL_APP_ID")
            .map_err(|_| RumahlError::Runtime("RUMAHL_APP_ID not set".to_string()))?;

        let rumahl_endpoint = std::env::var("RUMAHL_ENDPOINT")
            .map_err(|_| RumahlError::Runtime("RUMAHL_ENDPOINT not set".to_string()))?;

        let heartbeat_interval = std::env::var("RUMAHL_HEARTBEAT_INTERVAL")
            .unwrap_or_else(|_| "5".to_string())
            .parse()
            .unwrap_or(5);

        let config = RuntimeConfig {
            app_id,
            heartbeat_interval,
            rumahl_endpoint,
            auto_heartbeat: true,
            query_timeout: 30,
        };

        Self::new(config).await
    }

    /// Create a new runtime manager with custom configuration
    pub async fn new(config: RuntimeConfig) -> Result<Self> {
        let (tx, rx) = mpsc::unbounded_channel();

        let manager = Self {
            config,
            status: Arc::new(RwLock::new(AppStatus::Initializing)),
            permission_tokens: Arc::new(RwLock::new(HashMap::new())),
            message_sender: tx,
            message_receiver: Arc::new(Mutex::new(rx)),
            query_handlers: Arc::new(RwLock::new(HashMap::new())),
        };

        // Register default query handlers
        manager.register_default_handlers().await;

        Ok(manager)
    }

    /// Start the runtime manager
    pub async fn start(&self) -> Result<()> {
        // Update status to idle
        self.set_status(AppStatus::Idle, None).await?;

        // Start heartbeat task
        if self.config.auto_heartbeat {
            self.start_heartbeat_task().await;
        }

        // Start message processing task
        self.start_message_processor().await;

        // Start permission renewal task
        self.start_permission_renewal_task().await;

        Ok(())
    }

    /// Set app status
    pub async fn set_status(&self, new_status: AppStatus, details: Option<String>) -> Result<()> {
        let old_status = {
            let mut status = self.status.write().await;
            let old = *status;
            *status = new_status;
            old
        };

        // Send status update to rumahl
        let message = RumahlMessage::StatusUpdate {
            app_id: self.config.app_id.clone(),
            old_status,
            new_status,
            details,
            timestamp: Self::current_timestamp(),
        };

        self.send_message(message).await?;
        Ok(())
    }

    /// Get current app status
    pub async fn get_status(&self) -> AppStatus {
        *self.status.read().await
    }

    /// Log a message to rumahl
    pub async fn log(&self, level: LogLevel, message: impl Into<String>, context: Option<Value>) -> Result<()> {
        let message = RumahlMessage::Log {
            app_id: self.config.app_id.clone(),
            level,
            message: message.into(),
            context,
            timestamp: Self::current_timestamp(),
        };

        self.send_message(message).await
    }

    /// Request a permission from rumahl
    pub async fn request_permission(
        &self,
        permission: Permission,
        context: impl Into<String>,
        duration: u64,
    ) -> Result<PermissionToken> {
        // Check if we already have a valid token
        {
            let tokens = self.permission_tokens.read().await;
            let permission_str = format!("{:?}", permission);
            if let Some(token) = tokens.get(&permission_str) {
                if !token.is_expired() && !token.needs_renewal() {
                    return Ok(token.clone());
                }
            }
        }

        // Request new token from rumahl
        let message = RumahlMessage::PermissionRequest {
            app_id: self.config.app_id.clone(),
            permission: format!("{:?}", permission),
            context: context.into(),
            duration,
        };

        self.send_message(message).await?;

        // Wait for response (simplified - in real implementation would use async channel)
        // For now, return error indicating async operation
        Err(RumahlError::Runtime("Permission request pending".to_string()))
    }

    /// Store a permission token
    pub async fn store_permission_token(&self, token: PermissionToken) {
        let mut tokens = self.permission_tokens.write().await;
        tokens.insert(token.permission.clone(), token);
    }

    /// Register a query handler
    pub async fn register_query_handler<F>(&self, command: impl Into<String>, handler: F)
    where
        F: Fn(Value) -> Result<Value> + Send + Sync + 'static,
    {
        let mut handlers = self.query_handlers.write().await;
        handlers.insert(command.into(), Box::new(handler));
    }

    /// Send a message to rumahl
    async fn send_message(&self, message: RumahlMessage) -> Result<()> {
        self.message_sender
            .send(message)
            .map_err(|e| RumahlError::Runtime(format!("Failed to send message: {}", e)))
    }

    /// Start heartbeat task
    async fn start_heartbeat_task(&self) {
        let status = self.status.clone();
        let sender = self.message_sender.clone();
        let app_id = self.config.app_id.clone();
        let interval = self.config.heartbeat_interval;

        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(interval));
            loop {
                interval.tick().await;

                let current_status = *status.read().await;
                let message = RumahlMessage::Heartbeat {
                    app_id: app_id.clone(),
                    status: current_status,
                    timestamp: Self::current_timestamp(),
                };

                if sender.send(message).is_err() {
                    break;
                }
            }
        });
    }

    /// Start message processor task
    async fn start_message_processor(&self) {
        let receiver = self.message_receiver.clone();
        let endpoint = self.config.rumahl_endpoint.clone();

        tokio::spawn(async move {
            let mut rx = receiver.lock().await;
            while let Some(message) = rx.recv().await {
                // In real implementation, send message to rumahl via WebSocket/Unix socket
                // For now, just log it
                log::debug!("Sending to rumahl ({}): {:?}", endpoint, message);
            }
        });
    }

    /// Start permission renewal task
    async fn start_permission_renewal_task(&self) {
        let tokens = self.permission_tokens.clone();
        let sender = self.message_sender.clone();
        let app_id = self.config.app_id.clone();

        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(10));
            loop {
                interval.tick().await;

                let tokens_to_renew: Vec<_> = {
                    let tokens = tokens.read().await;
                    tokens
                        .values()
                        .filter(|t| t.needs_renewal())
                        .cloned()
                        .collect()
                };

                for token in tokens_to_renew {
                    let message = RumahlMessage::PermissionRequest {
                        app_id: app_id.clone(),
                        permission: token.permission.clone(),
                        context: "Auto-renewal".to_string(),
                        duration: 300, // Request 5 minutes
                    };

                    let _ = sender.send(message);
                }
            }
        });
    }

    /// Register default query handlers
    async fn register_default_handlers(&self) {
        let status = self.status.clone();
        self.register_query_handler("get_status", move |_| {
            // This is a simplification - in real implementation would be async
            Ok(serde_json::json!({
                "status": "IDLE",
                "uptime": 0,
            }))
        })
        .await;
    }

    /// Get current timestamp
    fn current_timestamp() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }
}

/// Builder for RuntimeManager
pub struct RuntimeManagerBuilder {
    config: RuntimeConfig,
}

impl RuntimeManagerBuilder {
    pub fn new(app_id: impl Into<String>) -> Self {
        let mut config = RuntimeConfig::default();
        config.app_id = app_id.into();
        Self { config }
    }

    pub fn heartbeat_interval(mut self, seconds: u64) -> Self {
        self.config.heartbeat_interval = seconds;
        self
    }

    pub fn rumahl_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.config.rumahl_endpoint = endpoint.into();
        self
    }

    pub fn auto_heartbeat(mut self, enabled: bool) -> Self {
        self.config.auto_heartbeat = enabled;
        self
    }

    pub async fn build(self) -> Result<RuntimeManager> {
        RuntimeManager::new(self.config).await
    }
}
