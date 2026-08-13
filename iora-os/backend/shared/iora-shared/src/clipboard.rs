//! Clipboard manager types.
//!
//! Personal clipboard history per user, shared across devices through the
//! same API. The frontend captures copy/cut events and posts them here; the
//! Clipboard panel (Ctrl+Shift+V) lists, pins, searches and re-copies entries.
//! Cross-device sync is implicit: any authenticated device of the same user
//! reads/writes the same store (a push channel via `app_messaging` is a
//! future enhancement).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Maximum accepted content length (64 KiB); longer payloads are rejected.
pub const MAX_CLIPBOARD_CONTENT_LEN: usize = 65_536;

/// A single clipboard history entry.
#[derive(Debug, Clone, Serialize)]
pub struct ClipboardEntry {
    pub id: String,
    pub content: String,
    /// `text` (default) or a mime-ish hint like `text/html`.
    pub content_type: String,
    /// Device/app identifier that produced the entry (`web`, app id, ...).
    pub source: String,
    pub created_by: String,
    pub pinned: bool,
    pub created_at: DateTime<Utc>,
}

/// Request body for adding a clipboard entry.
#[derive(Debug, Clone, Deserialize)]
pub struct AddClipboardRequest {
    pub content: String,
    #[serde(default = "default_content_type")]
    pub content_type: String,
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_content_type() -> String {
    "text".to_string()
}

fn default_source() -> String {
    "web".to_string()
}
