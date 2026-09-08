//! User profile types (family / child profiles).
//!
//! Extends `users` with a profile type and per-user restrictions so the
//! shell can support family profiles: children get a whitelist of allowed
//! apps while standard users stay unrestricted. The fields are stored on
//! the `users` row (migration 038) but read separately from the `User`
//! struct so existing queries keep working untouched.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Supported profile types. `guest` and `family` can be added later without
/// schema churn.
pub const PROFILE_TYPE_STANDARD: &str = "standard";
pub const PROFILE_TYPE_CHILD: &str = "child";

/// Restrictions payload attached to a user.
///
/// Currently consumed key:
///   `allowed_app_ids` – whitelist of app ids visible in the shell
///   (dock, launcher, command palette). Missing/empty = unrestricted.
/// Future keys: `allowed_page_ids`, `allowed_hours`, `content_ratings`, ...
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserRestrictions {
    #[serde(default)]
    pub allowed_app_ids: Vec<String>,
}

impl UserRestrictions {
    /// Parse from the JSONB column (tolerant: `{}` or missing fields).
    pub fn from_value(value: &Value) -> Self {
        serde_json::from_value::<UserRestrictions>(value.clone()).unwrap_or_default()
    }
}

/// Request body for updating a user's profile (admin).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateUserProfileRequest {
    #[serde(default)]
    pub profile_type: Option<String>,
    /// Raw JSONB restrictions object; stored as-is (validated to be an object).
    #[serde(default)]
    pub restrictions: Option<Value>,
}

/// Response shape of the profile endpoints.
#[derive(Debug, Clone, Serialize)]
pub struct UserProfile {
    pub profile_type: String,
    pub restrictions: Value,
}
