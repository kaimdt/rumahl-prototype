use serde::{Deserialize, Serialize};
use std::fmt;

/// App runtime status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppStatus {
    /// App is starting up
    #[serde(rename = "INITIALIZING")]
    Initializing,

    /// App is running but idle
    #[serde(rename = "IDLE")]
    Idle,

    /// App is actively processing
    #[serde(rename = "ACTIVE")]
    Active,

    /// App is running background tasks
    #[serde(rename = "BACKGROUND_TASK")]
    BackgroundTask,

    /// App is processing a specific task
    #[serde(rename = "PROCESSING")]
    Processing,

    /// App is busy and cannot accept new tasks
    #[serde(rename = "BUSY")]
    Busy,

    /// App encountered an error
    #[serde(rename = "ERROR")]
    Error,

    /// App is shutting down
    #[serde(rename = "SHUTTING_DOWN")]
    ShuttingDown,
}

impl fmt::Display for AppStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppStatus::Initializing => write!(f, "INITIALIZING"),
            AppStatus::Idle => write!(f, "IDLE"),
            AppStatus::Active => write!(f, "ACTIVE"),
            AppStatus::BackgroundTask => write!(f, "BACKGROUND_TASK"),
            AppStatus::Processing => write!(f, "PROCESSING"),
            AppStatus::Busy => write!(f, "BUSY"),
            AppStatus::Error => write!(f, "ERROR"),
            AppStatus::ShuttingDown => write!(f, "SHUTTING_DOWN"),
        }
    }
}

/// Log level for app logging
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogLevel {
    #[serde(rename = "DEBUG")]
    Debug,
    #[serde(rename = "INFO")]
    Info,
    #[serde(rename = "WARNING")]
    Warning,
    #[serde(rename = "ERROR")]
    Error,
    #[serde(rename = "CRITICAL")]
    Critical,
}

impl fmt::Display for LogLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LogLevel::Debug => write!(f, "DEBUG"),
            LogLevel::Info => write!(f, "INFO"),
            LogLevel::Warning => write!(f, "WARNING"),
            LogLevel::Error => write!(f, "ERROR"),
            LogLevel::Critical => write!(f, "CRITICAL"),
        }
    }
}

/// Message types for IORA communication
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IoraMessage {
    /// Heartbeat signal from app to IORA
    Heartbeat {
        app_id: String,
        status: AppStatus,
        timestamp: i64,
    },

    /// Status update from app to IORA
    StatusUpdate {
        app_id: String,
        old_status: AppStatus,
        new_status: AppStatus,
        details: Option<String>,
        timestamp: i64,
    },

    /// Log entry from app to IORA
    Log {
        app_id: String,
        level: LogLevel,
        message: String,
        context: Option<serde_json::Value>,
        timestamp: i64,
    },

    /// Permission request from app to IORA
    PermissionRequest {
        app_id: String,
        permission: String,
        context: String,
        duration: u64,
    },

    /// Permission grant from IORA to app
    PermissionGrant {
        token: String,
        expires_at: i64,
        permission: String,
    },

    /// Permission denial from IORA to app
    PermissionDenied {
        permission: String,
        reason: String,
    },

    /// Query from IORA to app
    Query {
        query_id: String,
        command: String,
        params: Option<serde_json::Value>,
    },

    /// Response from app to IORA
    Response {
        query_id: String,
        data: serde_json::Value,
    },

    /// Error response from app to IORA
    ErrorResponse {
        query_id: String,
        error: String,
    },
}

/// Permission token with expiration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionToken {
    pub token: String,
    pub permission: String,
    pub expires_at: i64,
    pub granted_at: i64,
}

impl PermissionToken {
    /// Check if token is expired
    pub fn is_expired(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        now >= self.expires_at
    }

    /// Check if token needs renewal (within 30 seconds of expiration)
    pub fn needs_renewal(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        (self.expires_at - now) < 30
    }
}
