//! App Storage – File and key-value storage for rumahl apps.
//!
//! Apps can store and retrieve files and structured data through a
//! dedicated per-app storage area. The storage is isolated per app:
//! no app can read another app's data unless explicitly shared.
//!
//! Two storage modes are supported:
//!   - **File storage** – binary blobs (images, configs, archives)
//!   - **Key-Value storage** – structured JSON data

use serde::{Deserialize, Serialize};

/// Storage quota for an app (defined in the manifest).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageQuota {
    /// Maximum file storage in bytes (default: 10 MB)
    #[serde(default = "default_file_limit")]
    pub max_file_storage_bytes: u64,

    /// Maximum key-value entries (default: 1000)
    #[serde(default = "default_kv_limit")]
    pub max_kv_entries: u32,

    /// Maximum individual file size in bytes (default: 5 MB)
    #[serde(default = "default_file_size_limit")]
    pub max_file_size_bytes: u64,
}

fn default_file_limit() -> u64 {
    10 * 1024 * 1024
}
fn default_kv_limit() -> u32 {
    1000
}
fn default_file_size_limit() -> u64 {
    5 * 1024 * 1024
}

impl Default for StorageQuota {
    fn default() -> Self {
        Self {
            max_file_storage_bytes: default_file_limit(),
            max_kv_entries: default_kv_limit(),
            max_file_size_bytes: default_file_size_limit(),
        }
    }
}

/// A stored file descriptor returned by the storage API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredFile {
    /// Unique file identifier
    pub id: String,

    /// Original file name
    pub name: String,

    /// MIME type
    pub mime_type: String,

    /// File size in bytes
    pub size_bytes: u64,

    /// SHA-256 hash
    pub sha256: String,

    /// Storage path (internal)
    #[serde(skip)]
    pub storage_path: String,

    /// Creation timestamp
    pub created_at: String,

    /// Last modification timestamp
    pub updated_at: String,

    /// Arbitrary metadata set by the app
    #[serde(default)]
    pub metadata: serde_json::Value,
}

/// A key-value entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KvEntry {
    pub key: String,
    pub value: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

/// Request to store a file
#[derive(Debug, Deserialize)]
pub struct StoreFileRequest {
    /// File name
    pub name: String,

    /// MIME type
    #[serde(default)]
    pub mime_type: String,

    /// Base64-encoded file content
    pub content: String,

    /// Optional metadata
    #[serde(default)]
    pub metadata: serde_json::Value,
}

/// Response after storing a file
#[derive(Debug, Serialize)]
pub struct StoreFileResponse {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub url: String,
}

/// Request to set a key-value entry
#[derive(Debug, Deserialize)]
pub struct SetKvRequest {
    pub key: String,
    pub value: serde_json::Value,
}

/// Storage usage statistics for an app
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageUsage {
    pub total_file_bytes: u64,
    pub file_count: u32,
    pub kv_entry_count: u32,
    pub quota: StorageQuota,
    pub usage_percent: f64,
}

/// Storage configuration in the app manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    /// Whether storage is enabled for this app
    #[serde(default = "default_storage_enabled")]
    pub enabled: bool,

    /// Storage quota
    #[serde(default)]
    pub quota: StorageQuota,

    /// Whether the app can read its own files via public URLs
    #[serde(default)]
    pub public_files: bool,

    /// Allowed MIME types for file upload (empty = all allowed)
    #[serde(default)]
    pub allowed_mime_types: Vec<String>,
}

fn default_storage_enabled() -> bool {
    true
}
