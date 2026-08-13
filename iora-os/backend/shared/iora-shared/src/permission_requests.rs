//! Runtime permission request types.
//!
//! Android/iOS-style permission dialogs: a component (app, plugin, system
//! surface) requests an OS permission the user has not granted yet. The
//! request stays `pending` until the user answers Allow/Deny in the shell
//! dialog; approving writes the grant into `user_os_permissions` so
//! `effective_os_permissions` picks it up immediately.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Lifecycle of a permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionRequestStatus {
    /// Waiting for the user's answer.
    Pending,
    /// User allowed the permission (grant written to `user_os_permissions`).
    Approved,
    /// User denied the permission.
    Denied,
}

impl PermissionRequestStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PermissionRequestStatus::Pending => "pending",
            PermissionRequestStatus::Approved => "approved",
            PermissionRequestStatus::Denied => "denied",
        }
    }
}

/// A permission request as returned by the API.
#[derive(Debug, Clone, Serialize)]
pub struct PermissionRequest {
    pub id: String,
    pub user_id: String,
    /// OS permission id, e.g. `os.files.read` or `os.power`.
    pub permission: String,
    /// Display name of the requesting component ("Files", "Photos", ...).
    pub requester: String,
    /// Technical context (app id or `system`).
    pub scope: String,
    /// Human-readable reason shown in the dialog (English; UI translates).
    pub reason: String,
    pub status: PermissionRequestStatus,
    pub created_at: DateTime<Utc>,
    pub responded_at: Option<DateTime<Utc>>,
    pub responded_by: Option<String>,
}

/// Request body for creating a permission request.
#[derive(Debug, Clone, Deserialize)]
pub struct CreatePermissionRequest {
    pub permission: String,
    #[serde(default = "default_requester")]
    pub requester: String,
    #[serde(default = "default_scope")]
    pub scope: String,
    #[serde(default)]
    pub reason: String,
}

fn default_requester() -> String {
    "system".to_string()
}

fn default_scope() -> String {
    "system".to_string()
}

/// Request body for answering a permission request.
#[derive(Debug, Clone, Deserialize)]
pub struct RespondPermissionRequest {
    pub approved: bool,
}
