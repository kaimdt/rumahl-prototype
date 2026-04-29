//! IORA Files – Secure file sharing, upload/download, share links, and collaborative
//! file management for the IORA ecosystem.
//!
//! ## Features
//! - Upload/download files with multipart support
//! - Folder hierarchy
//! - Share links (time-limited, password-protected, download limits)
//! - Per-user/group permissions (read/write/admin)
//! - File versioning
//! - Storage quotas per user
//! - Activity logging for audit
//! - Deduplication via SHA-256 content hashing

use anyhow::Result;
use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::fs;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

mod auth;
mod middleware_auth;

// ─── Configuration ──────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    storage_root: PathBuf,
    jwt_secret: String,
    #[allow(dead_code)]
    max_file_size: usize,           // bytes
    default_quota_bytes: i64,       // per user
    base_url: String,               // for share link URLs
}

// ─── Models ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FileRecord {
    pub id: String,
    pub owner_id: String,
    pub filename: String,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256_hash: String,
    pub storage_path: String,
    pub parent_folder_id: Option<String>,
    pub is_folder: bool,
    pub description: Option<String>,
    pub tags: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ShareLink {
    pub id: String,
    pub file_id: String,
    pub created_by: String,
    pub token: String,
    pub password_hash: Option<String>,
    pub expires_at: Option<String>,
    pub max_downloads: Option<i32>,
    pub download_count: i32,
    pub allow_upload: bool,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FilePermission {
    pub id: String,
    pub file_id: String,
    pub grantee_id: String,
    pub grantee_type: String,
    pub permission: String,
    pub granted_by: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FileActivity {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub action: String,
    pub details: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FileVersion {
    pub id: String,
    pub file_id: String,
    pub version_number: i32,
    pub storage_path: String,
    pub size_bytes: i64,
    pub sha256_hash: String,
    pub uploaded_by: String,
    pub comment: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct StorageQuota {
    pub user_id: String,
    pub quota_bytes: i64,
    pub used_bytes: i64,
    pub updated_at: String,
}

// ─── Request / Response DTOs ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListFilesQuery {
    folder_id: Option<String>,
    include_deleted: Option<bool>,
    search: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateFolderRequest {
    name: String,
    parent_folder_id: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateShareLinkRequest {
    file_id: String,
    password: Option<String>,
    expires_in_hours: Option<i64>,
    max_downloads: Option<i32>,
    allow_upload: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ShareLinkAccessRequest {
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SetPermissionRequest {
    file_id: String,
    grantee_id: String,
    grantee_type: Option<String>,
    permission: String, // "read", "write", "admin"
}

#[derive(Debug, Deserialize)]
struct MoveFileRequest {
    target_folder_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RenameFileRequest {
    new_name: String,
}

#[derive(Debug, Serialize)]
struct UploadResponse {
    id: String,
    filename: String,
    original_name: String,
    size_bytes: i64,
    mime_type: String,
    sha256_hash: String,
    url: String,
}

#[derive(Debug, Serialize)]
struct ShareLinkResponse {
    id: String,
    token: String,
    url: String,
    expires_at: Option<String>,
    max_downloads: Option<i32>,
    password_protected: bool,
}

#[derive(Debug, Serialize)]
struct QuotaResponse {
    quota_bytes: i64,
    used_bytes: i64,
    available_bytes: i64,
    usage_percent: f64,
}

#[derive(Debug, Serialize)]
struct FileListResponse {
    files: Vec<FileRecord>,
    total: i64,
    folder_path: Vec<FolderBreadcrumb>,
}

#[derive(Debug, Serialize)]
struct FolderBreadcrumb {
    id: String,
    name: String,
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_files=info,tower_http=info".into()),
        )
        .init();

    let database_url =
        std::env::var("IORA_FILES_DB_URL").unwrap_or_else(|_| "sqlite:./data/files.db?mode=rwc".into());
    let storage_root =
        PathBuf::from(std::env::var("IORA_FILES_STORAGE").unwrap_or_else(|_| "./data/file_storage".into()));
    let jwt_secret =
        std::env::var("IORA_JWT_SECRET").unwrap_or_else(|_| "iora-files-dev-secret-change-me".into());
    let port: u16 = std::env::var("IORA_FILES_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8097);
    let max_file_size: usize = std::env::var("IORA_FILES_MAX_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(512 * 1024 * 1024); // 512 MB default
    let default_quota: i64 = std::env::var("IORA_FILES_DEFAULT_QUOTA")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1073741824); // 1 GB
    let base_url =
        std::env::var("IORA_FILES_BASE_URL").unwrap_or_else(|_| format!("http://localhost:{}", port));

    // Ensure storage directory exists
    fs::create_dir_all(&storage_root).await?;

    let db = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    // Run migrations
    let migration_sql = include_str!("../migrations/001_initial_schema.sql");
    match sqlx::query(migration_sql).execute(&db).await {
        Ok(_) => info!("Database migrations applied"),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("already exists") {
                info!("Database schema already up to date");
            } else {
                return Err(e.into());
            }
        }
    }

    let state = Arc::new(AppState {
        db,
        storage_root,
        jwt_secret,
        max_file_size,
        default_quota_bytes: default_quota,
        base_url,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Public share link access (no auth required)
        .route("/api/files/shared/:token", get(get_shared_file))
        .route("/api/files/shared/:token/download", get(download_shared_file))
        .route("/api/files/shared/:token/info", get(shared_file_info))
        // Health
        .route("/health", get(health_check))
        // Authenticated routes
        .nest(
            "/api/files",
            Router::new()
                // File operations
                .route("/upload", post(upload_file))
                .route("/", get(list_files))
                .route("/:file_id", get(get_file_info))
                .route("/:file_id", delete(delete_file))
                .route("/:file_id/download", get(download_file))
                .route("/:file_id/move", put(move_file))
                .route("/:file_id/rename", put(rename_file))
                .route("/:file_id/restore", post(restore_file))
                .route("/:file_id/versions", get(list_versions))
                // Folder operations
                .route("/folders", post(create_folder))
                // Share links
                .route("/shares", post(create_share_link))
                .route("/shares", get(list_share_links))
                .route("/shares/:share_id", delete(revoke_share_link))
                // Permissions
                .route("/permissions", post(set_permission))
                .route("/permissions/:file_id", get(list_permissions))
                .route("/permissions/revoke/:perm_id", delete(revoke_permission))
                // Quota
                .route("/quota", get(get_quota))
                // Activity
                .route("/activity/:file_id", get(get_activity))
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    middleware_auth::require_auth,
                )),
        )
        .layer(DefaultBodyLimit::max(max_file_size))
        .layer(cors)
        .with_state(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("IORA Files listening on {}", addr);
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-files",
        addr.port(),
        "File sharing service",
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// ─── Health ─────────────────────────────────────────────────────────────────

async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let file_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM files WHERE deleted_at IS NULL")
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    Json(serde_json::json!({
        "status": "healthy",
        "service": "iora-files",
        "files": file_count.0,
        "storage_root": state.storage_root.display().to_string(),
    }))
}

// ─── Upload ─────────────────────────────────────────────────────────────────

async fn upload_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    // Check quota
    ensure_quota(&state, &user_id, 0).await?;

    let folder_id: Option<String> = None;
    let mut file_data: Option<(String, Vec<u8>)> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Multipart error: {}", e))
    })? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                let original_name = field
                    .file_name()
                    .unwrap_or("unnamed")
                    .to_string();
                let data = field.bytes().await.map_err(|e| {
                    (StatusCode::BAD_REQUEST, format!("Read error: {}", e))
                })?;
                file_data = Some((original_name, data.to_vec()));
            }
            _ => {}
        }
    }

    let (original_name, data) = file_data
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "No file field in upload".to_string()))?;

    // Validate filename is safe
    let sanitized_name = sanitize_filename(&original_name);
    if sanitized_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Invalid filename".to_string()));
    }

    // Check quota with actual file size
    ensure_quota(&state, &user_id, data.len() as i64).await?;

    // Compute SHA-256 hash
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    // Determine MIME type
    let mime_type = mime_guess::from_path(&original_name)
        .first_or_octet_stream()
        .to_string();

    // Store file on disk
    let file_id = Uuid::new_v4().to_string();
    let ext = std::path::Path::new(&original_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let storage_filename = format!("{}.{}", file_id, ext);
    let user_dir = state.storage_root.join(&user_id);
    fs::create_dir_all(&user_dir).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Storage error: {}", e))
    })?;
    let storage_path = user_dir.join(&storage_filename);
    fs::write(&storage_path, &data).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Write error: {}", e))
    })?;

    let size = data.len() as i64;
    let now = Utc::now().to_rfc3339();
    let storage_rel = format!("{}/{}", user_id, storage_filename);

    // Insert into DB
    sqlx::query(
        "INSERT INTO files (id, owner_id, filename, original_name, mime_type, size_bytes, sha256_hash, storage_path, parent_folder_id, is_folder, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    )
    .bind(&file_id)
    .bind(&user_id)
    .bind(&storage_filename)
    .bind(&original_name)
    .bind(&mime_type)
    .bind(size)
    .bind(&hash)
    .bind(&storage_rel)
    .bind(&folder_id)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?;

    // Update quota
    sqlx::query(
        "INSERT INTO storage_quotas (user_id, quota_bytes, used_bytes, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET used_bytes = used_bytes + ?, updated_at = ?"
    )
    .bind(&user_id)
    .bind(state.default_quota_bytes)
    .bind(size)
    .bind(&now)
    .bind(size)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Quota update error: {}", e)))?;

    // Activity log
    log_activity(&state, &file_id, &user_id, "upload", None).await;

    Ok(Json(UploadResponse {
        id: file_id.clone(),
        filename: storage_filename,
        original_name,
        size_bytes: size,
        mime_type,
        sha256_hash: hash,
        url: format!("/api/files/{}/download", file_id),
    }))
}

// ─── List Files ─────────────────────────────────────────────────────────────

async fn list_files(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ListFilesQuery>,
) -> Result<Json<FileListResponse>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    let files: Vec<FileRecord> = if let Some(ref search) = query.search {
        let pattern = format!("%{}%", search);
        sqlx::query_as(
            "SELECT * FROM files WHERE owner_id = ? AND original_name LIKE ? AND deleted_at IS NULL ORDER BY is_folder DESC, original_name ASC"
        )
        .bind(&user_id)
        .bind(&pattern)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        let deleted_filter = if query.include_deleted.unwrap_or(false) { "" } else { "AND deleted_at IS NULL" };
        let sql = format!(
            "SELECT * FROM files WHERE owner_id = ? AND parent_folder_id IS ? {} ORDER BY is_folder DESC, original_name ASC",
            deleted_filter
        );
        sqlx::query_as(&sql)
            .bind(&user_id)
            .bind(&query.folder_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    let total = files.len() as i64;

    // Build breadcrumb path
    let folder_path = if let Some(ref fid) = query.folder_id {
        build_breadcrumb(&state, fid).await
    } else {
        vec![]
    };

    Ok(Json(FileListResponse {
        files,
        total,
        folder_path,
    }))
}

// ─── Get File Info ──────────────────────────────────────────────────────────

async fn get_file_info(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<FileRecord>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let file = get_file_with_access(&state, &file_id, &user_id, "read").await?;
    Ok(Json(file))
}

// ─── Download File ──────────────────────────────────────────────────────────

async fn download_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    if file.is_folder {
        return Err((StatusCode::BAD_REQUEST, "Cannot download a folder directly".to_string()));
    }

    let full_path = state.storage_root.join(&file.storage_path);
    let data = fs::read(&full_path).await.map_err(|e| {
        (StatusCode::NOT_FOUND, format!("File not found on disk: {}", e))
    })?;

    log_activity(&state, &file_id, &user_id, "download", None).await;

    let headers = [
        (header::CONTENT_TYPE, file.mime_type.clone()),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", file.original_name),
        ),
    ];
    Ok((headers, data))
}

// ─── Delete File (soft) ─────────────────────────────────────────────────────

async fn delete_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let file = get_file_with_access(&state, &file_id, &user_id, "write").await?;

    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE files SET deleted_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&file_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update quota (return space)
    sqlx::query("UPDATE storage_quotas SET used_bytes = MAX(0, used_bytes - ?), updated_at = ? WHERE user_id = ?")
        .bind(file.size_bytes)
        .bind(&now)
        .bind(&user_id)
        .execute(&state.db)
        .await
        .ok();

    log_activity(&state, &file_id, &user_id, "delete", None).await;

    Ok(Json(serde_json::json!({ "deleted": true, "file_id": file_id })))
}

// ─── Restore File ───────────────────────────────────────────────────────────

async fn restore_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    let file: FileRecord = sqlx::query_as("SELECT * FROM files WHERE id = ? AND owner_id = ?")
        .bind(&file_id)
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    sqlx::query("UPDATE files SET deleted_at = NULL, updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(&file_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Re-consume quota
    sqlx::query("UPDATE storage_quotas SET used_bytes = used_bytes + ?, updated_at = ? WHERE user_id = ?")
        .bind(file.size_bytes)
        .bind(Utc::now().to_rfc3339())
        .bind(&user_id)
        .execute(&state.db)
        .await
        .ok();

    log_activity(&state, &file_id, &user_id, "restore", None).await;

    Ok(Json(serde_json::json!({ "restored": true, "file_id": file_id })))
}

// ─── Move File ──────────────────────────────────────────────────────────────

async fn move_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
    Json(body): Json<MoveFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "write").await?;

    // Validate target folder exists and belongs to user
    if let Some(ref target_id) = body.target_folder_id {
        let folder: Option<FileRecord> = sqlx::query_as(
            "SELECT * FROM files WHERE id = ? AND owner_id = ? AND is_folder = 1 AND deleted_at IS NULL"
        )
        .bind(target_id)
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if folder.is_none() {
            return Err((StatusCode::NOT_FOUND, "Target folder not found".to_string()));
        }
    }

    sqlx::query("UPDATE files SET parent_folder_id = ?, updated_at = ? WHERE id = ?")
        .bind(&body.target_folder_id)
        .bind(Utc::now().to_rfc3339())
        .bind(&file_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    log_activity(&state, &file_id, &user_id, "move", Some(serde_json::json!({"target": body.target_folder_id}))).await;

    Ok(Json(serde_json::json!({ "moved": true })))
}

// ─── Rename File ────────────────────────────────────────────────────────────

async fn rename_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
    Json(body): Json<RenameFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "write").await?;

    let safe_name = sanitize_filename(&body.new_name);
    if safe_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Invalid filename".to_string()));
    }

    sqlx::query("UPDATE files SET original_name = ?, updated_at = ? WHERE id = ?")
        .bind(&safe_name)
        .bind(Utc::now().to_rfc3339())
        .bind(&file_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    log_activity(&state, &file_id, &user_id, "rename", Some(serde_json::json!({"new_name": safe_name}))).await;

    Ok(Json(serde_json::json!({ "renamed": true, "new_name": safe_name })))
}

// ─── Versions ───────────────────────────────────────────────────────────────

async fn list_versions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<Vec<FileVersion>>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    let versions: Vec<FileVersion> = sqlx::query_as(
        "SELECT * FROM file_versions WHERE file_id = ? ORDER BY version_number DESC"
    )
    .bind(&file_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(versions))
}

// ─── Create Folder ──────────────────────────────────────────────────────────

async fn create_folder(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateFolderRequest>,
) -> Result<Json<FileRecord>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    let folder_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let safe_name = sanitize_filename(&body.name);

    sqlx::query(
        "INSERT INTO files (id, owner_id, filename, original_name, mime_type, size_bytes, sha256_hash, storage_path, parent_folder_id, is_folder, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'inode/directory', 0, '', '', ?, 1, ?, ?, ?)"
    )
    .bind(&folder_id)
    .bind(&user_id)
    .bind(&safe_name)
    .bind(&safe_name)
    .bind(&body.parent_folder_id)
    .bind(&body.description)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let folder: FileRecord = sqlx::query_as("SELECT * FROM files WHERE id = ?")
        .bind(&folder_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(folder))
}

// ─── Share Links ────────────────────────────────────────────────────────────

async fn create_share_link(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateShareLinkRequest>,
) -> Result<Json<ShareLinkResponse>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let _file = get_file_with_access(&state, &body.file_id, &user_id, "write").await?;

    let share_id = Uuid::new_v4().to_string();
    let token = generate_share_token();
    let now = Utc::now().to_rfc3339();

    let expires_at = body.expires_in_hours.map(|hours| {
        (Utc::now() + chrono::Duration::hours(hours)).to_rfc3339()
    });

    let password_hash = if let Some(ref pw) = body.password {
        // Use simple SHA-256 for share link passwords (not user auth)
        let mut hasher = Sha256::new();
        hasher.update(pw.as_bytes());
        Some(hex::encode(hasher.finalize()))
    } else {
        None
    };

    sqlx::query(
        "INSERT INTO share_links (id, file_id, created_by, token, password_hash, expires_at, max_downloads, allow_upload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&share_id)
    .bind(&body.file_id)
    .bind(&user_id)
    .bind(&token)
    .bind(&password_hash)
    .bind(&expires_at)
    .bind(body.max_downloads)
    .bind(body.allow_upload.unwrap_or(false))
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    log_activity(&state, &body.file_id, &user_id, "share", Some(serde_json::json!({"token": &token}))).await;

    Ok(Json(ShareLinkResponse {
        id: share_id,
        url: format!("{}/api/files/shared/{}", state.base_url, token),
        token,
        expires_at,
        max_downloads: body.max_downloads,
        password_protected: body.password.is_some(),
    }))
}

async fn list_share_links(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ShareLink>>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    let links: Vec<ShareLink> = sqlx::query_as(
        "SELECT * FROM share_links WHERE created_by = ? AND is_active = 1 ORDER BY created_at DESC"
    )
    .bind(&user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(links))
}

async fn revoke_share_link(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    sqlx::query("UPDATE share_links SET is_active = 0 WHERE id = ? AND created_by = ?")
        .bind(&share_id)
        .bind(&user_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "revoked": true })))
}

// ─── Public Share Access ────────────────────────────────────────────────────

async fn shared_file_info(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let link = validate_share_link(&state, &token).await?;

    let file: FileRecord = sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
        .bind(&link.file_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    Ok(Json(serde_json::json!({
        "filename": file.original_name,
        "size_bytes": file.size_bytes,
        "mime_type": file.mime_type,
        "is_folder": file.is_folder,
        "password_required": link.password_hash.is_some(),
        "expires_at": link.expires_at,
        "download_count": link.download_count,
        "max_downloads": link.max_downloads,
    })))
}

async fn get_shared_file(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    Query(access): Query<ShareLinkAccessRequest>,
) -> Result<Json<FileRecord>, (StatusCode, String)> {
    let link = validate_share_link(&state, &token).await?;
    verify_share_password(&link, &access.password)?;

    let file: FileRecord = sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
        .bind(&link.file_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    Ok(Json(file))
}

async fn download_shared_file(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    Query(access): Query<ShareLinkAccessRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let link = validate_share_link(&state, &token).await?;
    verify_share_password(&link, &access.password)?;

    // Check download limit
    if let Some(max) = link.max_downloads {
        if link.download_count >= max {
            return Err((StatusCode::GONE, "Download limit reached".to_string()));
        }
    }

    let file: FileRecord = sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
        .bind(&link.file_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    let full_path = state.storage_root.join(&file.storage_path);
    let data = fs::read(&full_path).await.map_err(|e| {
        (StatusCode::NOT_FOUND, format!("File not found on disk: {}", e))
    })?;

    // Increment download count
    sqlx::query("UPDATE share_links SET download_count = download_count + 1 WHERE token = ?")
        .bind(&token)
        .execute(&state.db)
        .await
        .ok();

    let headers = [
        (header::CONTENT_TYPE, file.mime_type.clone()),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", file.original_name),
        ),
    ];
    Ok((headers, data))
}

// ─── Permissions ────────────────────────────────────────────────────────────

async fn set_permission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SetPermissionRequest>,
) -> Result<Json<FilePermission>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let _file = get_file_with_access(&state, &body.file_id, &user_id, "admin").await?;

    if !["read", "write", "admin"].contains(&body.permission.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "Invalid permission level".to_string()));
    }

    let perm_id = Uuid::new_v4().to_string();
    let grantee_type = body.grantee_type.as_deref().unwrap_or("user");
    let now = Utc::now().to_rfc3339();

    // Upsert: remove existing permission for same grantee, then insert
    sqlx::query("DELETE FROM file_permissions WHERE file_id = ? AND grantee_id = ?")
        .bind(&body.file_id)
        .bind(&body.grantee_id)
        .execute(&state.db)
        .await
        .ok();

    sqlx::query(
        "INSERT INTO file_permissions (id, file_id, grantee_id, grantee_type, permission, granted_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&perm_id)
    .bind(&body.file_id)
    .bind(&body.grantee_id)
    .bind(grantee_type)
    .bind(&body.permission)
    .bind(&user_id)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    log_activity(
        &state,
        &body.file_id,
        &user_id,
        "permission_change",
        Some(serde_json::json!({"grantee": body.grantee_id, "permission": body.permission})),
    ).await;

    let perm: FilePermission = sqlx::query_as("SELECT * FROM file_permissions WHERE id = ?")
        .bind(&perm_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(perm))
}

async fn list_permissions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<Vec<FilePermission>>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    let perms: Vec<FilePermission> = sqlx::query_as(
        "SELECT * FROM file_permissions WHERE file_id = ?"
    )
    .bind(&file_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(perms))
}

async fn revoke_permission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(perm_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    // Verify user owns the file this permission belongs to
    let perm: Option<FilePermission> = sqlx::query_as("SELECT * FROM file_permissions WHERE id = ?")
        .bind(&perm_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(perm) = perm {
        let _file = get_file_with_access(&state, &perm.file_id, &user_id, "admin").await?;
        sqlx::query("DELETE FROM file_permissions WHERE id = ?")
            .bind(&perm_id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(Json(serde_json::json!({ "revoked": true })))
}

// ─── Quota ──────────────────────────────────────────────────────────────────

async fn get_quota(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<QuotaResponse>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;

    let quota: Option<StorageQuota> = sqlx::query_as("SELECT * FROM storage_quotas WHERE user_id = ?")
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (quota_bytes, used_bytes) = match quota {
        Some(q) => (q.quota_bytes, q.used_bytes),
        None => (state.default_quota_bytes, 0),
    };

    let available = (quota_bytes - used_bytes).max(0);
    let usage_percent = if quota_bytes > 0 {
        (used_bytes as f64 / quota_bytes as f64) * 100.0
    } else {
        0.0
    };

    Ok(Json(QuotaResponse {
        quota_bytes,
        used_bytes,
        available_bytes: available,
        usage_percent,
    }))
}

// ─── Activity ───────────────────────────────────────────────────────────────

async fn get_activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<Vec<FileActivity>>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers, &state.jwt_secret)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    let activity: Vec<FileActivity> = sqlx::query_as(
        "SELECT * FROM file_activity WHERE file_id = ? ORDER BY created_at DESC LIMIT 100"
    )
    .bind(&file_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(activity))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn extract_user_id(headers: &HeaderMap, jwt_secret: &str) -> Result<String, (StatusCode, String)> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing Authorization header".to_string()))?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Invalid Authorization format".to_string()))?;

    auth::verify_token(token, jwt_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("Invalid token: {}", e)))
}

async fn get_file_with_access(
    state: &AppState,
    file_id: &str,
    user_id: &str,
    required_permission: &str,
) -> Result<FileRecord, (StatusCode, String)> {
    let file: FileRecord = sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
        .bind(file_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    // Owner has full access
    if file.owner_id == user_id {
        return Ok(file);
    }

    // Check explicit permissions
    let perm: Option<FilePermission> = sqlx::query_as(
        "SELECT * FROM file_permissions WHERE file_id = ? AND grantee_id = ?"
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let has_access = match perm {
        Some(p) => match required_permission {
            "read" => true,
            "write" => p.permission == "write" || p.permission == "admin",
            "admin" => p.permission == "admin",
            _ => false,
        },
        None => false,
    };

    if !has_access {
        return Err((StatusCode::FORBIDDEN, "Insufficient permissions".to_string()));
    }

    Ok(file)
}

async fn ensure_quota(state: &AppState, user_id: &str, additional_bytes: i64) -> Result<(), (StatusCode, String)> {
    let quota: Option<StorageQuota> = sqlx::query_as("SELECT * FROM storage_quotas WHERE user_id = ?")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (quota_bytes, used_bytes) = match quota {
        Some(q) => (q.quota_bytes, q.used_bytes),
        None => (state.default_quota_bytes, 0),
    };

    if used_bytes + additional_bytes > quota_bytes {
        return Err((
            StatusCode::INSUFFICIENT_STORAGE,
            format!(
                "Storage quota exceeded ({}/{} bytes used, {} requested)",
                used_bytes, quota_bytes, additional_bytes
            ),
        ));
    }

    Ok(())
}

async fn validate_share_link(state: &AppState, token: &str) -> Result<ShareLink, (StatusCode, String)> {
    let link: ShareLink = sqlx::query_as(
        "SELECT * FROM share_links WHERE token = ? AND is_active = 1"
    )
    .bind(token)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Share link not found or expired".to_string()))?;

    // Check expiration
    if let Some(ref expires) = link.expires_at {
        if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(expires) {
            if Utc::now() > exp {
                return Err((StatusCode::GONE, "Share link has expired".to_string()));
            }
        }
    }

    Ok(link)
}

fn verify_share_password(link: &ShareLink, provided: &Option<String>) -> Result<(), (StatusCode, String)> {
    if let Some(ref stored_hash) = link.password_hash {
        let pw = provided
            .as_ref()
            .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Password required".to_string()))?;

        let mut hasher = Sha256::new();
        hasher.update(pw.as_bytes());
        let provided_hash = hex::encode(hasher.finalize());

        if provided_hash != *stored_hash {
            return Err((StatusCode::UNAUTHORIZED, "Invalid password".to_string()));
        }
    }
    Ok(())
}

async fn build_breadcrumb(state: &AppState, folder_id: &str) -> Vec<FolderBreadcrumb> {
    let mut path = vec![];
    let mut current_id = Some(folder_id.to_string());

    while let Some(ref fid) = current_id {
        let folder: Option<FileRecord> = sqlx::query_as("SELECT * FROM files WHERE id = ?")
            .bind(fid)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

        match folder {
            Some(f) => {
                path.push(FolderBreadcrumb {
                    id: f.id.clone(),
                    name: f.original_name.clone(),
                });
                current_id = f.parent_folder_id;
            }
            None => break,
        }
    }

    path.reverse();
    path
}

async fn log_activity(state: &AppState, file_id: &str, user_id: &str, action: &str, details: Option<serde_json::Value>) {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let details_str = details.map(|d| d.to_string());

    if let Err(e) = sqlx::query(
        "INSERT INTO file_activity (id, file_id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(file_id)
    .bind(user_id)
    .bind(action)
    .bind(&details_str)
    .bind(&now)
    .execute(&state.db)
    .await
    {
        warn!("Failed to log activity: {}", e);
    }
}

fn sanitize_filename(name: &str) -> String {
    // Remove path separators and dangerous characters
    let sanitized: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();

    // Remove leading dots (hidden files) and trim
    let trimmed = sanitized.trim().trim_start_matches('.');
    if trimmed.is_empty() {
        return String::new();
    }

    // Limit length
    trimmed.chars().take(255).collect()
}

fn generate_share_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}
