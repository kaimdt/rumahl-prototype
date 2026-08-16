//! System-wide job manager types.
//!
//! Downloads, file operations, backups, imports and updates run as background
//! jobs that survive app switches. This module defines the wire format shared
//! between the Job Center UI, the `ora.jobs` SDK surface and the executing
//! background components (iora-home handlers, iora-backup, iora-updater,
//! the supervisor, ...).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Lifecycle of a system job.
///
/// `queued -> running -> paused/completed/failed/cancelled`. A paused job can
/// be resumed; `cancelled` is terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    /// Waiting to be picked up by an executor.
    Queued,
    /// Executing right now; `progress` is being advanced.
    Running,
    /// Temporarily halted; can be resumed.
    Paused,
    /// Finished successfully (`progress` should be 100).
    Completed,
    /// Finished with an error; `message` carries the reason.
    Failed,
    /// Aborted by the user or the system.
    Cancelled,
}

impl JobStatus {
    /// Stable lowercase wire representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Queued => "queued",
            JobStatus::Running => "running",
            JobStatus::Paused => "paused",
            JobStatus::Completed => "completed",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }

    /// Parse from the wire representation (fallible, tolerant to unknown values).
    // Not FromStr: tolerant and returns Option instead of Result; keep the
    // name for the established call sites in iora-home.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(JobStatus::Queued),
            "running" => Some(JobStatus::Running),
            "paused" => Some(JobStatus::Paused),
            "completed" => Some(JobStatus::Completed),
            "failed" => Some(JobStatus::Failed),
            "cancelled" => Some(JobStatus::Cancelled),
            _ => None,
        }
    }

    /// Terminal states never transition again.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
        )
    }
}

/// Full system-job record as returned by the Job Center API.
#[derive(Debug, Clone, Serialize)]
pub struct SystemJob {
    pub id: String,
    pub name: String,
    /// Machine-readable category: `generic`, `download`, `upload`,
    /// `backup`, `update`, `import`, `file_op`, `install`, ...
    pub job_type: String,
    pub status: JobStatus,
    /// 0..100; advanced by the executing side.
    pub progress: i32,
    /// Human-readable status line (English; UI translates).
    pub message: String,
    /// Component or app that created the job (e.g. `backup`, `updater`,
    /// `app-store`, an app id, `system`).
    pub source: String,
    /// Source-specific payload (download URL, target paths, backup id, ...).
    pub metadata: Value,
    /// User id or `system` for background components.
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

/// Request body for creating a new job.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateJobRequest {
    pub name: String,
    #[serde(default = "default_job_type")]
    pub job_type: String,
    #[serde(default = "default_job_source")]
    pub source: String,
    #[serde(default)]
    pub metadata: Value,
}

fn default_job_type() -> String {
    "generic".to_string()
}

fn default_job_source() -> String {
    "system".to_string()
}

/// Request body for advancing a job (progress / message / status transitions).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateJobRequest {
    #[serde(default)]
    pub progress: Option<i32>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}
