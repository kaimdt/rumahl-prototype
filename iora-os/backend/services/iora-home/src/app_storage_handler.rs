//! App Storage Handler – File and key-value storage for IORA apps.
//!
//! API endpoints:
//!   GET    /api/apps/:app_id/storage/files          – List stored files
//!   POST   /api/apps/:app_id/storage/files          – Upload a file
//!   GET    /api/apps/:app_id/storage/files/:file_id – Download a file
//!   DELETE /api/apps/:app_id/storage/files/:file_id – Delete a file
//!   GET    /api/apps/:app_id/storage/kv             – List KV entries
//!   PUT    /api/apps/:app_id/storage/kv/:key        – Set a KV entry
//!   GET    /api/apps/:app_id/storage/kv/:key        – Get a KV entry
//!   DELETE /api/apps/:app_id/storage/kv/:key        – Delete a KV entry
//!   GET    /api/apps/:app_id/storage/usage          – Get storage usage

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use tokio::fs;
use tracing::{error, info, warn};

use iora_shared::app_storage::*;
use iora_shared::upload_store::atomic_write_async;

/// Storage backend base path
const STORAGE_BASE_DIR: &str = "data/app-storage";

/// Hard limit per single uploaded file (50 MiB).
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Hard limit for the total storage consumed by a single app (500 MiB).
const MAX_APP_TOTAL_BYTES: u64 = 500 * 1024 * 1024;

/// App state reference (shared via main.rs)
#[derive(Clone)]
pub struct AppStorageState {
    pub base_dir: PathBuf,
}

impl AppStorageState {
    pub fn new() -> Self {
        Self {
            base_dir: PathBuf::from(STORAGE_BASE_DIR),
        }
    }

    fn app_file_dir(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("files")
    }

    fn app_kv_path(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("kv.json")
    }

    fn app_meta_path(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("file_meta.json")
    }
}

/// Query parameters for listing files
#[derive(Debug, Deserialize)]
pub struct ListFilesQuery {
    #[serde(default)]
    pub prefix: Option<String>,
    #[serde(default = "default_list_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

fn default_list_limit() -> usize { 50 }

/// List stored files for an app
pub async fn list_files(
    State(state): State<Arc<AppStorageState>>,
    AxumPath(app_id): AxumPath<String>,
    Query(query): Query<ListFilesQuery>,
) -> Result<Json<Vec<StoredFile>>, (StatusCode, String)> {
    let file_dir = state.app_file_dir(&app_id);
    let meta_path = state.app_meta_path(&app_id);

    let metadatas: Vec<StoredFile> = if meta_path.exists() {
        match fs::read_to_string(&meta_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    let filtered: Vec<StoredFile> = metadatas
        .into_iter()
        .filter(|f| {
            if let Some(ref prefix) = query.prefix {
                f.name.starts_with(prefix)
            } else {
                true
            }
        })
        .skip(query.offset)
        .take(query.limit)
        .collect();

    Ok(Json(filtered))
}

/// Upload (store) a file for an app
pub async fn upload_file(
    State(state): State<Arc<AppStorageState>>,
    AxumPath(app_id): AxumPath<String>,
    Json(req): Json<StoreFileRequest>,
) -> Result<Json<StoreFileResponse>, (StatusCode, String)> {
    let file_dir = state.app_file_dir(&app_id);
    fs::create_dir_all(&file_dir).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create storage dir: {}", e))
    })?;

    // Decode base64 content
    let content = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.content,
    ).map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Invalid base64 content: {}", e))
    })?;

    let size_bytes = content.len() as u64;

    // Enforce per-file quota.
    if size_bytes > MAX_FILE_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "File exceeds per-file limit ({} bytes > {} bytes)",
                size_bytes, MAX_FILE_BYTES
            ),
        ));
    }

    // Enforce per-app total quota by inspecting existing metadata.
    let meta_path_quota = state.app_meta_path(&app_id);
    let existing_total: u64 = if meta_path_quota.exists() {
        match fs::read_to_string(&meta_path_quota).await {
            Ok(c) => serde_json::from_str::<Vec<StoredFile>>(&c)
                .unwrap_or_default()
                .iter()
                .map(|f| f.size_bytes)
                .sum(),
            Err(_) => 0,
        }
    } else {
        0
    };
    if existing_total.saturating_add(size_bytes) > MAX_APP_TOTAL_BYTES {
        return Err((
            StatusCode::INSUFFICIENT_STORAGE,
            format!(
                "App storage quota exceeded ({} + {} > {} bytes)",
                existing_total, size_bytes, MAX_APP_TOTAL_BYTES
            ),
        ));
    }

    // Compute SHA-256
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let sha256 = format!("{:x}", hasher.finalize());

    let file_id = uuid::Uuid::new_v4().to_string();
    let storage_path = file_dir.join(&file_id);

    // Write file atomically (tmp + rename) via shared upload store.
    atomic_write_async(&storage_path, &content).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write file: {}", e))
    })?;

    let now = Utc::now().to_rfc3339();

    let stored = StoredFile {
        id: file_id.clone(),
        name: req.name,
        mime_type: req.mime_type,
        size_bytes,
        sha256: sha256.clone(),
        storage_path: storage_path.to_string_lossy().to_string(),
        created_at: now.clone(),
        updated_at: now,
        metadata: req.metadata,
    };

    // Update metadata index
    let meta_path = state.app_meta_path(&app_id);
    let mut metadatas: Vec<StoredFile> = if meta_path.exists() {
        match fs::read_to_string(&meta_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };
    metadatas.push(stored);
    let meta_json = serde_json::to_string(&metadatas).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize metadata: {}", e))
    })?;
    atomic_write_async(&meta_path, meta_json.as_bytes()).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write metadata: {}", e))
    })?;

    let url = format!("/api/apps/{}/storage/files/{}", app_id, file_id);

    Ok(Json(StoreFileResponse {
        id: file_id,
        name: String::new(),
        size_bytes,
        sha256,
        url,
    }))
}

/// Get a stored file (returns base64-encoded content)
pub async fn get_file(
    State(state): State<Arc<AppStorageState>>,
    AxumPath((app_id, file_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let meta_path = state.app_meta_path(&app_id);
    let metadatas: Vec<StoredFile> = if meta_path.exists() {
        match fs::read_to_string(&meta_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => return Err((StatusCode::NOT_FOUND, "Metadata not found".to_string())),
        }
    } else {
        return Err((StatusCode::NOT_FOUND, "No files stored".to_string()));
    };

    let file_info = metadatas.into_iter().find(|f| f.id == file_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    let content = fs::read(&file_info.storage_path).await
        .map_err(|e| (StatusCode::NOT_FOUND, format!("File not found on disk: {}", e)))?;

    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &content,
    );

    Ok(Json(serde_json::json!({
        "id": file_info.id,
        "name": file_info.name,
        "mime_type": file_info.mime_type,
        "size_bytes": file_info.size_bytes,
        "sha256": file_info.sha256,
        "content": b64,
        "metadata": file_info.metadata,
    })))
}

/// Delete a stored file
pub async fn delete_file(
    State(state): State<Arc<AppStorageState>>,
    AxumPath((app_id, file_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let meta_path = state.app_meta_path(&app_id);
    let metadatas: Vec<StoredFile> = if meta_path.exists() {
        match fs::read_to_string(&meta_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => return Err((StatusCode::NOT_FOUND, "Metadata not found".to_string())),
        }
    } else {
        return Err((StatusCode::NOT_FOUND, "No files stored".to_string()));
    };

    let (remaining, removed): (Vec<StoredFile>, Vec<StoredFile>) = metadatas
        .into_iter()
        .partition(|f| f.id != file_id);

    if removed.is_empty() {
        return Err((StatusCode::NOT_FOUND, "File not found".to_string()));
    }

    // Remove from disk
    if let Some(file) = removed.first() {
        let _ = fs::remove_file(&file.storage_path).await;
    }

    // Update metadata
    let meta_json = serde_json::to_string(&remaining).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize: {}", e))
    })?;
    atomic_write_async(&meta_path, meta_json.as_bytes()).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write metadata: {}", e))
    })?;

    Ok(Json(serde_json::json!({ "success": true, "deleted": file_id })))
}

/// List key-value entries
pub async fn list_kv(
    State(state): State<Arc<AppStorageState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Vec<KvEntry>>, (StatusCode, String)> {
    let kv_path = state.app_kv_path(&app_id);
    if !kv_path.exists() {
        return Ok(Json(Vec::new()));
    }

    let content = fs::read_to_string(&kv_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read KV: {}", e)))?;
    let entries: Vec<KvEntry> = serde_json::from_str(&content).unwrap_or_default();
    Ok(Json(entries))
}

/// Set a key-value entry
pub async fn set_kv(
    State(state): State<Arc<AppStorageState>>,
    AxumPath((app_id, key)): AxumPath<(String, String)>,
    Json(req): Json<SetKvRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let app_dir = state.base_dir.join(&app_id);
    fs::create_dir_all(&app_dir).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create dir: {}", e))
    })?;

    let kv_path = state.app_kv_path(&app_id);
    let mut entries: Vec<KvEntry> = if kv_path.exists() {
        match fs::read_to_string(&kv_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    let now = Utc::now().to_rfc3339();

    // Update existing or add new
    if let Some(existing) = entries.iter_mut().find(|e| e.key == key) {
        existing.value = req.value;
        existing.updated_at = now.clone();
    } else {
        entries.push(KvEntry {
            key: key.clone(),
            value: req.value,
            created_at: now.clone(),
            updated_at: now,
        });
    }

    let content = serde_json::to_string(&entries).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize: {}", e))
    })?;
    atomic_write_async(&kv_path, content.as_bytes()).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write KV: {}", e))
    })?;

    Ok(Json(serde_json::json!({ "success": true, "key": key })))
}

/// Get a single key-value entry
pub async fn get_kv(
    State(state): State<Arc<AppStorageState>>,
    AxumPath((app_id, key)): AxumPath<(String, String)>,
) -> Result<Json<KvEntry>, (StatusCode, String)> {
    let kv_path = state.app_kv_path(&app_id);
    if !kv_path.exists() {
        return Err((StatusCode::NOT_FOUND, "KV store is empty".to_string()));
    }

    let content = fs::read_to_string(&kv_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read KV: {}", e)))?;
    let entries: Vec<KvEntry> = serde_json::from_str(&content).unwrap_or_default();

    entries.into_iter().find(|e| e.key == key)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Key '{}' not found", key)))
        .map(Json)
}

/// Delete a key-value entry
pub async fn delete_kv(
    State(state): State<Arc<AppStorageState>>,
    AxumPath((app_id, key)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let kv_path = state.app_kv_path(&app_id);
    if !kv_path.exists() {
        return Err((StatusCode::NOT_FOUND, "KV store is empty".to_string()));
    }

    let content = fs::read_to_string(&kv_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read KV: {}", e)))?;
    let mut entries: Vec<KvEntry> = serde_json::from_str(&content).unwrap_or_default();

    let before = entries.len();
    entries.retain(|e| e.key != key);

    if entries.len() == before {
        return Err((StatusCode::NOT_FOUND, format!("Key '{}' not found", key)));
    }

    let json = serde_json::to_string(&entries).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize: {}", e))
    })?;
    atomic_write_async(&kv_path, json.as_bytes()).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write KV: {}", e))
    })?;

    Ok(Json(serde_json::json!({ "success": true, "deleted": key })))
}

/// Get storage usage statistics
pub async fn get_storage_usage(
    State(state): State<Arc<AppStorageState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<StorageUsage>, (StatusCode, String)> {
    let file_dir = state.app_file_dir(&app_id);
    let meta_path = state.app_meta_path(&app_id);
    let kv_path = state.app_kv_path(&app_id);

    let metadatas: Vec<StoredFile> = if meta_path.exists() {
        match fs::read_to_string(&meta_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    let total_file_bytes: u64 = metadatas.iter().map(|f| f.size_bytes).sum();
    let file_count = metadatas.len() as u32;

    let kv_entries: Vec<KvEntry> = if kv_path.exists() {
        match fs::read_to_string(&kv_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    let quota = StorageQuota::default();
    let usage_pct = if quota.max_file_storage_bytes > 0 {
        (total_file_bytes as f64 / quota.max_file_storage_bytes as f64) * 100.0
    } else {
        0.0
    };

    Ok(Json(StorageUsage {
        total_file_bytes,
        file_count,
        kv_entry_count: kv_entries.len() as u32,
        quota,
        usage_percent: usage_pct,
    }))
}
