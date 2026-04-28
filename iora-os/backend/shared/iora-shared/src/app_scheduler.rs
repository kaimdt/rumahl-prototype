//! App Scheduler – Cron/scheduled task interface for IORA apps.
//!
//! Apps can register recurring scheduled tasks using cron expressions
//! or simple intervals. The scheduler runs within the IORA core and
//! triggers the app's webhook endpoint when a task fires.
//!
//! Example: An app that fetches weather data every hour can register
//! a schedule and receive a POST to its webhook with the schedule ID.

use serde::{Deserialize, Serialize};

/// Schedule type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleType {
    /// Cron expression (more flexible)
    Cron,
    /// Fixed interval in seconds
    Interval,
    /// Run once at a specific date/time
    OneShot,
}

/// A scheduled task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    /// Unique task ID (auto-generated if not provided)
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// Schedule type
    pub schedule_type: ScheduleType,

    /// Cron expression (e.g. "0 * * * *" for hourly)
    /// Only used when schedule_type = Cron
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expression: Option<String>,

    /// Interval in seconds (e.g. 3600 for hourly)
    /// Only used when schedule_type = Interval
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_seconds: Option<u64>,

    /// Run-at timestamp (ISO 8601) for one-shot tasks
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_at: Option<String>,

    /// Task payload sent to the app's webhook when the task fires
    #[serde(default)]
    pub payload: serde_json::Value,

    /// Whether the task is enabled
    #[serde(default = "default_enabled")]
    pub enabled: bool,

    /// Maximum retries on failure (0 = no retry)
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,

    /// Retry delay in seconds
    #[serde(default = "default_retry_delay")]
    pub retry_delay_seconds: u64,

    /// Tags for grouping/categorization
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_enabled() -> bool { true }
fn default_max_retries() -> u32 { 3 }
fn default_retry_delay() -> u64 { 60 }

/// Create a scheduled task request
#[derive(Debug, Deserialize)]
pub struct CreateScheduleRequest {
    pub name: String,
    pub schedule_type: ScheduleType,
    pub cron_expression: Option<String>,
    pub interval_seconds: Option<u64>,
    pub run_at: Option<String>,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub max_retries: u32,
    #[serde(default)]
    pub retry_delay_seconds: u64,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Update a scheduled task request
#[derive(Debug, Deserialize)]
pub struct UpdateScheduleRequest {
    pub name: Option<String>,
    pub schedule_type: Option<ScheduleType>,
    pub cron_expression: Option<String>,
    pub interval_seconds: Option<u64>,
    pub run_at: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub enabled: Option<bool>,
    pub max_retries: Option<u32>,
    pub retry_delay_seconds: Option<u64>,
    pub tags: Option<Vec<String>>,
}

/// Scheduled task execution log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskExecutionLog {
    /// Task ID
    pub task_id: String,

    /// Execution timestamp
    pub executed_at: String,

    /// Whether execution was successful
    pub success: bool,

    /// Duration in milliseconds
    pub duration_ms: u64,

    /// Error message (if failed)
    pub error: Option<String>,

    /// HTTP status code returned by the app
    pub status_code: Option<u16>,
}

/// Scheduled task status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub task: ScheduledTask,
    pub last_execution: Option<TaskExecutionLog>,
    pub next_run: Option<String>,
    pub total_executions: u64,
    pub successful_executions: u64,
    pub failed_executions: u64,
}

/// Schedule configuration in the app manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleConfig {
    /// Pre-register schedules on app install
    #[serde(default)]
    pub default_schedules: Vec<ScheduledTask>,
}

/// Webhook target for scheduled task notifications
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleWebhookTarget {
    /// URL to call when the task fires
    pub url: String,

    /// HTTP method to use
    #[serde(default = "default_webhook_method")]
    pub method: String,

    /// Custom headers
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,

    /// Secret for HMAC signature
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

fn default_webhook_method() -> String { "POST".to_string() }
