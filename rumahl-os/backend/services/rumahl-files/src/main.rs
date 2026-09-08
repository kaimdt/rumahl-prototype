//! rumahl Files – Secure file sharing, upload/download, share links, and collaborative
//! file management for the rumahl ecosystem.
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
    extract::{DefaultBodyLimit, Multipart, OriginalUri, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use chrono::Utc;
use rumahl_shared_config::system_config;
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
    #[allow(dead_code)]
    max_file_size: usize, // bytes
    default_quota_bytes: i64, // per user
    base_url: String,         // for share link URLs
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

/// Create an "app shortcut" entry in a folder (e.g. the Desktop). It is a
/// normal `files` row with a dedicated mime type; `app_page_id` is stored in
/// `description` so the frontend can resolve and open the target app.
#[derive(Debug, Deserialize)]
struct CreateAppShortcutRequest {
    name: String,
    app_page_id: String,
    parent_folder_id: Option<String>,
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
struct CopyFileRequest {
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
                .unwrap_or_else(|_| "rumahl_files=info,tower_http=info".into()),
        )
        .init();

    let database_url = system_config::database_url_for("rumahl-files");
    let storage_root = PathBuf::from(system_config::files_storage_dir());
    let port: u16 = system_config::service_port("rumahl-files", 8100);
    let max_file_size: usize = system_config::files_max_size_bytes();
    let default_quota: i64 = system_config::files_default_quota();
    let base_url = system_config::files_base_url(port);

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
        .route(
            "/api/files/shared/:token/download",
            get(download_shared_file),
        )
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
                .route("/:file_id/copy", post(copy_file))
                .route("/:file_id/rename", put(rename_file))
                .route("/:file_id/restore", post(restore_file))
                .route("/:file_id/versions", get(list_versions))
                // App shortcuts: lightweight file entries that represent an
                // app on the desktop. Stored as a normal `files` row with a
                // dedicated mime type; the target app pageId lives in
                // `description`. Delete uses the regular DELETE /:file_id.
                .route("/shortcuts", post(app_shortcut))
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
                .route("/resolve-path", get(resolve_path))
                .route("/system-path", get(system_path))
                .route("/system-folder", get(get_system_folder))
                .route("/network/shares", get(scan_network_shares))
                .route(
                    "/network/mounts",
                    get(net_mounts_list).post(net_mount_create),
                )
                .route("/network/mounts/:id", delete(net_mount_delete))
                .route("/network/mounts/:id/files", get(net_mount_files))
                .route("/network/mounts/:id/download", get(net_mount_download))
                // Activity
                .route("/activity/:file_id", get(get_activity))
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    middleware_auth::require_auth,
                )),
        )
        // axum 0.7 quirk: `nest("/api/files", …)` matches `/api/files` but NOT
        // `/api/files/` (trailing slash) — the form the frontend actually calls.
        // Mount a second, auth-protected nest so both spellings work.
        // The `/user/:username/*path` wildcard route is registered top-level:
        // axum 0.7 nested routers do not match wildcard routes reliably.
        .route(
            "/api/files/user/:username/*path",
            get(download_user_path).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                middleware_auth::require_auth,
            )),
        )
        .nest(
            "/api/files/",
            Router::new()
                .route("/", get(list_files))
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    middleware_auth::require_auth,
                )),
        )
        .layer(DefaultBodyLimit::max(max_file_size))
        .layer(cors)
        .with_state(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("rumahl Files listening on {}", addr);
    let _hb =
        rumahl_shared_heartbeat::spawn_default("rumahl-files", addr.port(), "File sharing service");
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
        "service": "rumahl-files",
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
    let user_id = extract_user_id(&headers)?;

    // Check quota
    ensure_quota(&state, &user_id, 0).await?;

    let mut folder_id: Option<String> = None;
    let mut file_data: Option<(String, Vec<u8>)> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Multipart error: {}", e)))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name.as_str() == "file" {
            let original_name = field.file_name().unwrap_or("unnamed").to_string();
            let data = field
                .bytes()
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Read error: {}", e)))?;
            file_data = Some((original_name, data.to_vec()));
        } else if name.as_str() == "folder_id" {
            let value = field
                .text()
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Read error: {}", e)))?;
            if !value.trim().is_empty() {
                folder_id = Some(value);
            }
        }
    }

    let (original_name, data) = file_data.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "No file field in upload".to_string(),
        )
    })?;

    // Validate filename is safe
    let sanitized_name = sanitize_filename(&original_name);
    if sanitized_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Invalid filename".to_string()));
    }

    if let Some(ref target_folder_id) = folder_id {
        let target_exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM files WHERE id = ? AND owner_id = ? AND is_folder = 1 AND deleted_at IS NULL",
        )
        .bind(target_folder_id)
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if target_exists.is_none() {
            return Err((StatusCode::NOT_FOUND, "Target folder not found".to_string()));
        }
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
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Storage error: {}", e),
        )
    })?;
    let storage_path = user_dir.join(&storage_filename);
    rumahl_shared_upload::atomic_write_async(&storage_path, &data)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Write error: {}", e),
            )
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
    let user_id = extract_user_id(&headers)?;

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
    } else if let Some(ref folder_id) = query.folder_id {
        // Inside a folder: own content, or the children of a family-shared
        // folder owned by someone else.
        let is_family_shared: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM file_permissions WHERE file_id = ? AND grantee_type = 'family'",
        )
        .bind(folder_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
        if is_family_shared > 0 {
            sqlx::query_as(
                "SELECT * FROM files WHERE parent_folder_id = ? AND deleted_at IS NULL \
                 ORDER BY is_folder DESC, original_name ASC",
            )
            .bind(folder_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        } else {
            sqlx::query_as(
                "SELECT * FROM files WHERE owner_id = ? AND parent_folder_id = ? AND deleted_at IS NULL \
                 ORDER BY is_folder DESC, original_name ASC",
            )
            .bind(&user_id)
            .bind(folder_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        }
    } else {
        let deleted_filter = if query.include_deleted.unwrap_or(false) {
            ""
        } else {
            "AND deleted_at IS NULL"
        };
        // Root listing: own files plus family-shared entries of other owners.
        let own = sqlx::query_as(&format!(
            "SELECT * FROM files WHERE owner_id = ? AND parent_folder_id IS ? {} ORDER BY is_folder DESC, original_name ASC",
            deleted_filter
        ))
        .bind(&user_id)
        .bind(&query.folder_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let shared = sqlx::query_as(
            "SELECT * FROM files WHERE deleted_at IS NULL AND parent_folder_id IS NULL \
             AND owner_id != ? \
             AND id IN (SELECT file_id FROM file_permissions WHERE grantee_type = 'family') \
             ORDER BY is_folder DESC, original_name ASC",
        )
        .bind(&user_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let mut merged = own;
        merged.extend(shared);
        merged
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
    let user_id = extract_user_id(&headers)?;
    let file = get_file_with_access(&state, &file_id, &user_id, "read").await?;
    Ok(Json(file))
}

// ─── Download File ──────────────────────────────────────────────────────────

async fn download_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
    Path(file_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Accept `?token=` as well as the Authorization header: CSS backgrounds
    // and <img> tags cannot send headers, so the frontend appends the token
    // to the query string for them.
    let user_id = extract_user_id_with_query(&headers, uri.query())?;
    let file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    if file.is_folder {
        return Err((
            StatusCode::BAD_REQUEST,
            "Cannot download a folder directly".to_string(),
        ));
    }

    let full_path = state.storage_root.join(&file.storage_path);
    let data = fs::read(&full_path).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            format!("File not found on disk: {}", e),
        )
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

/// Download a file through its stable, user-visible virtual path.
/// The path is always scoped to the authenticated JWT username and owner ID.
async fn download_user_path(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
    Path((username, path)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let claims = extract_claims(&headers, uri.query())?;
    if username != claims.username {
        return Err((StatusCode::FORBIDDEN, "User path is private".to_string()));
    }

    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.is_empty()
        || segments
            .iter()
            .any(|segment| *segment == "." || *segment == "..")
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid user path".to_string()));
    }

    let mut parent_id: Option<String> = None;
    let mut file: Option<FileRecord> = None;
    for (index, segment) in segments.iter().enumerate() {
        let is_folder = index + 1 < segments.len();
        file = sqlx::query_as::<_, FileRecord>(
            "SELECT * FROM files WHERE owner_id = ? AND original_name = ? AND parent_folder_id IS ? AND is_folder = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(&claims.sub)
        .bind(*segment)
        .bind(&parent_id)
        .bind(is_folder)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        let Some(current) = file.as_ref() else {
            return Err((StatusCode::NOT_FOUND, "File not found".to_string()));
        };
        parent_id = Some(current.id.clone());
    }

    let file = file.ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;
    if file.is_folder {
        return Err((
            StatusCode::BAD_REQUEST,
            "Cannot download a folder directly".to_string(),
        ));
    }

    let data = fs::read(state.storage_root.join(&file.storage_path))
        .await
        .map_err(|error| {
            (
                StatusCode::NOT_FOUND,
                format!("File not found on disk: {error}"),
            )
        })?;
    log_activity(&state, &file.id, &claims.sub, "download", None).await;
    Ok((
        [
            (header::CONTENT_TYPE, file.mime_type),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", file.original_name),
            ),
        ],
        data,
    ))
}

// ─── Delete File (soft) ─────────────────────────────────────────────────────

async fn delete_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
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

    Ok(Json(
        serde_json::json!({ "deleted": true, "file_id": file_id }),
    ))
}

// ─── Restore File ───────────────────────────────────────────────────────────

async fn restore_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;

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
    sqlx::query(
        "UPDATE storage_quotas SET used_bytes = used_bytes + ?, updated_at = ? WHERE user_id = ?",
    )
    .bind(file.size_bytes)
    .bind(Utc::now().to_rfc3339())
    .bind(&user_id)
    .execute(&state.db)
    .await
    .ok();

    log_activity(&state, &file_id, &user_id, "restore", None).await;

    Ok(Json(
        serde_json::json!({ "restored": true, "file_id": file_id }),
    ))
}

// ─── Move File ──────────────────────────────────────────────────────────────

async fn move_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
    Json(body): Json<MoveFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
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

    log_activity(
        &state,
        &file_id,
        &user_id,
        "move",
        Some(serde_json::json!({"target": body.target_folder_id})),
    )
    .await;

    Ok(Json(serde_json::json!({ "moved": true })))
}

// ─── Copy File / Folder ────────────────────────────────────────────────────

async fn copy_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
    Json(body): Json<CopyFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
    let source = get_file_with_access(&state, &file_id, &user_id, "write").await?;

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

    // Prevent copying a folder into itself or one of its own subfolders (cycles)
    if source.is_folder {
        if let Some(ref target_id) = body.target_folder_id {
            if target_id == &source.id || is_descendant_of(&state, target_id, &source.id).await {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "Cannot copy a folder into itself or its own subfolder".to_string(),
                ));
            }
        }
    }

    // Pre-check quota for the whole subtree before writing anything
    let additional_size = if source.is_folder {
        compute_subtree_size(&state, &source.id).await?
    } else {
        source.size_bytes
    };
    ensure_quota(&state, &user_id, additional_size).await?;

    let (new_id, _added) =
        copy_entry_recursive(&state, &source, body.target_folder_id.clone(), &user_id).await?;

    // Update quota
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO storage_quotas (user_id, quota_bytes, used_bytes, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET used_bytes = used_bytes + ?, updated_at = ?"
    )
    .bind(&user_id)
    .bind(state.default_quota_bytes)
    .bind(additional_size)
    .bind(&now)
    .bind(additional_size)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Quota update error: {}", e)))?;

    log_activity(
        &state,
        &source.id,
        &user_id,
        "copy",
        Some(serde_json::json!({"target": body.target_folder_id, "new_id": new_id})),
    )
    .await;

    Ok(Json(serde_json::json!({ "copied": true, "id": new_id })))
}

/// Returns true if `folder_id` equals `ancestor_id` or is nested below it.
async fn is_descendant_of(state: &AppState, folder_id: &str, ancestor_id: &str) -> bool {
    let mut current: Option<String> = Some(folder_id.to_string());
    let mut hops = 0;
    while let Some(fid) = current {
        if fid == ancestor_id {
            return true;
        }
        hops += 1;
        if hops > 200 {
            break; // safety valve against corrupt parent chains
        }
        let row: Option<FileRecord> = sqlx::query_as("SELECT * FROM files WHERE id = ?")
            .bind(&fid)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
        current = row.and_then(|r| r.parent_folder_id);
    }
    false
}

/// Total size in bytes of every file below `folder_id` (folders themselves are free).
type SubtreeFuture<'a, T> = std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<T, (StatusCode, String)>> + Send + 'a>,
>;
fn compute_subtree_size<'a>(state: &'a AppState, folder_id: &'a str) -> SubtreeFuture<'a, i64> {
    Box::pin(async move {
        let children: Vec<FileRecord> =
            sqlx::query_as("SELECT * FROM files WHERE parent_folder_id = ? AND deleted_at IS NULL")
                .bind(folder_id)
                .fetch_all(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let mut total = 0i64;
        for child in children {
            if child.is_folder {
                total += compute_subtree_size(state, &child.id).await?;
            } else {
                total += child.size_bytes;
            }
        }
        Ok(total)
    })
}

/// Deep-copies `source` (file or folder tree) into `target_parent_id`.
/// Returns the new record id and the number of file bytes added.
fn copy_entry_recursive<'a>(
    state: &'a AppState,
    source: &'a FileRecord,
    target_parent_id: Option<String>,
    user_id: &'a str,
) -> SubtreeFuture<'a, (String, i64)> {
    Box::pin(async move {
        let now = Utc::now().to_rfc3339();
        let new_id = Uuid::new_v4().to_string();

        if source.is_folder {
            let new_name = copy_display_name(&source.original_name);
            sqlx::query(
            "INSERT INTO files (id, owner_id, filename, original_name, mime_type, size_bytes, sha256_hash, storage_path, parent_folder_id, is_folder, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'inode/directory', 0, '', '', ?, 1, ?, ?, ?)"
        )
        .bind(&new_id)
        .bind(user_id)
        .bind(&new_name)
        .bind(&new_name)
        .bind(&target_parent_id)
        .bind(&source.description)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?;

            // Recurse into children
            let children: Vec<FileRecord> = sqlx::query_as(
                "SELECT * FROM files WHERE parent_folder_id = ? AND deleted_at IS NULL",
            )
            .bind(&source.id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let mut added = 0i64;
            for child in children {
                let (_child_id, child_added) =
                    copy_entry_recursive(state, &child, Some(new_id.clone()), user_id).await?;
                added += child_added;
            }
            Ok((new_id, added))
        } else {
            // Physical blob copy
            let source_abs = state.storage_root.join(&source.storage_path);
            let data = fs::read(&source_abs).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Storage error: {}", e),
                )
            })?;

            let ext = std::path::Path::new(&source.filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("bin");
            let storage_filename = format!("{}.{}", new_id, ext);
            let user_dir = state.storage_root.join(user_id);
            fs::create_dir_all(&user_dir).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Storage error: {}", e),
                )
            })?;
            let new_abs = user_dir.join(&storage_filename);
            rumahl_shared_upload::atomic_write_async(&new_abs, &data)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Write error: {}", e),
                    )
                })?;

            let new_name = copy_display_name(&source.original_name);
            let storage_rel = format!("{}/{}", user_id, storage_filename);
            sqlx::query(
            "INSERT INTO files (id, owner_id, filename, original_name, mime_type, size_bytes, sha256_hash, storage_path, parent_folder_id, is_folder, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
        )
        .bind(&new_id)
        .bind(user_id)
        .bind(&storage_filename)
        .bind(&new_name)
        .bind(&source.mime_type)
        .bind(source.size_bytes)
        .bind(&source.sha256_hash)
        .bind(&storage_rel)
        .bind(&target_parent_id)
        .bind(&source.description)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?;

            Ok((new_id, source.size_bytes))
        }
    })
}

/// "report.pdf" -> "report (copy).pdf", "notes (copy).md" -> "notes (copy).md"
fn copy_display_name(name: &str) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(idx) if idx > 0 => name.split_at(idx),
        _ => (name, ""),
    };
    let clean = stem.strip_suffix(" (copy)").unwrap_or(stem);
    format!("{clean} (copy){ext}")
}

// ─── Rename File ────────────────────────────────────────────────────────────

async fn rename_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
    Json(body): Json<RenameFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
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

    log_activity(
        &state,
        &file_id,
        &user_id,
        "rename",
        Some(serde_json::json!({"new_name": safe_name})),
    )
    .await;

    Ok(Json(
        serde_json::json!({ "renamed": true, "new_name": safe_name }),
    ))
}

// ─── Versions ───────────────────────────────────────────────────────────────

async fn list_versions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<Vec<FileVersion>>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    let versions: Vec<FileVersion> = sqlx::query_as(
        "SELECT * FROM file_versions WHERE file_id = ? ORDER BY version_number DESC",
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
    let user_id = extract_user_id(&headers)?;

    let folder_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let safe_name = sanitize_filename(&body.name);
    if safe_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Invalid folder name".to_string()));
    }

    if let Some(ref parent_folder_id) = body.parent_folder_id {
        let parent_exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM files WHERE id = ? AND owner_id = ? AND is_folder = 1 AND deleted_at IS NULL",
        )
        .bind(parent_folder_id)
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if parent_exists.is_none() {
            return Err((StatusCode::NOT_FOUND, "Parent folder not found".to_string()));
        }
    }

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

/// POST /api/files/shortcuts — create an app-shortcut entry (e.g. on the
/// Desktop). The entry is a real `files` row so both the desktop surface and
/// the Files "Desktop" folder show exactly the same items; deleting it uses the
/// regular DELETE /api/files/:file_id.
async fn app_shortcut(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateAppShortcutRequest>,
) -> Result<Json<FileRecord>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;

    let safe_name = sanitize_filename(&body.name);
    let app_page_id = body.app_page_id.trim().to_string();
    if safe_name.is_empty() || app_page_id.is_empty() || app_page_id.len() > 128 {
        return Err((StatusCode::BAD_REQUEST, "Invalid shortcut".to_string()));
    }

    if let Some(ref parent_folder_id) = body.parent_folder_id {
        let parent_exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM files WHERE id = ? AND owner_id = ? AND is_folder = 1 AND deleted_at IS NULL",
        )
        .bind(parent_folder_id)
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if parent_exists.is_none() {
            return Err((StatusCode::NOT_FOUND, "Parent folder not found".to_string()));
        }
    }

    let shortcut_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO files (id, owner_id, filename, original_name, mime_type, size_bytes, sha256_hash, storage_path, parent_folder_id, is_folder, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'application/x-rumahl-app-shortcut', 0, '', '', ?, 0, ?, ?, ?)"
    )
    .bind(&shortcut_id)
    .bind(&user_id)
    .bind(&safe_name)
    .bind(&safe_name)
    .bind(&body.parent_folder_id)
    .bind(&app_page_id)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let shortcut: FileRecord = sqlx::query_as("SELECT * FROM files WHERE id = ?")
        .bind(&shortcut_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(shortcut))
}

// ─── Share Links ────────────────────────────────────────────────────────────

async fn create_share_link(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateShareLinkRequest>,
) -> Result<Json<ShareLinkResponse>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
    let _file = get_file_with_access(&state, &body.file_id, &user_id, "write").await?;

    let share_id = Uuid::new_v4().to_string();
    let token = generate_share_token();
    let now = Utc::now().to_rfc3339();

    let expires_at = body
        .expires_in_hours
        .map(|hours| (Utc::now() + chrono::Duration::hours(hours)).to_rfc3339());

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

    log_activity(
        &state,
        &body.file_id,
        &user_id,
        "share",
        Some(serde_json::json!({"token": &token})),
    )
    .await;

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
    let user_id = extract_user_id(&headers)?;

    let links: Vec<ShareLink> = sqlx::query_as(
        "SELECT * FROM share_links WHERE created_by = ? AND is_active = 1 ORDER BY created_at DESC",
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
    let user_id = extract_user_id(&headers)?;

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

    let file: FileRecord =
        sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
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

    let file: FileRecord =
        sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
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

    let file: FileRecord =
        sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
            .bind(&link.file_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    let full_path = state.storage_root.join(&file.storage_path);
    let data = fs::read(&full_path).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            format!("File not found on disk: {}", e),
        )
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
    let user_id = extract_user_id(&headers)?;
    let _file = get_file_with_access(&state, &body.file_id, &user_id, "admin").await?;

    if !["read", "write", "admin"].contains(&body.permission.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid permission level".to_string(),
        ));
    }

    let perm_id = Uuid::new_v4().to_string();
    let grantee_type = body.grantee_type.as_deref().unwrap_or("user");
    // Family shares use a fixed grantee identity: every authenticated
    // (non-guest) family member gets access via the `family` grantee type.
    if !["user", "family"].contains(&grantee_type) {
        return Err((StatusCode::BAD_REQUEST, "Invalid grantee type".to_string()));
    }
    let grantee_id = if grantee_type == "family" {
        "family".to_string()
    } else {
        body.grantee_id.clone()
    };
    let now = Utc::now().to_rfc3339();

    // Upsert: remove existing permission for same grantee, then insert
    sqlx::query("DELETE FROM file_permissions WHERE file_id = ? AND grantee_id = ?")
        .bind(&body.file_id)
        .bind(&grantee_id)
        .execute(&state.db)
        .await
        .ok();

    sqlx::query(
        "INSERT INTO file_permissions (id, file_id, grantee_id, grantee_type, permission, granted_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&perm_id)
    .bind(&body.file_id)
    .bind(&grantee_id)
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
        Some(serde_json::json!({"grantee": grantee_id, "permission": body.permission})),
    )
    .await;

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
    let user_id = extract_user_id(&headers)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    let perms: Vec<FilePermission> =
        sqlx::query_as("SELECT * FROM file_permissions WHERE file_id = ?")
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
    let user_id = extract_user_id(&headers)?;

    // Verify user owns the file this permission belongs to
    let perm: Option<FilePermission> =
        sqlx::query_as("SELECT * FROM file_permissions WHERE id = ?")
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

mod network_scan;
mod smb_mount;

async fn scan_network_shares() -> Json<serde_json::Value> {
    let hosts = network_scan::scan_network_shares().await;
    Json(serde_json::json!({ "hosts": hosts }))
}

#[derive(serde::Deserialize)]
struct MountCreateRequest {
    ip: String,
    share: String,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

async fn net_mounts_list() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "mounts": smb_mount::list_mounts().await }))
}

async fn net_mount_create(
    Json(body): Json<MountCreateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    match smb_mount::mount_share(
        &body.ip,
        &body.share,
        body.username.as_deref(),
        body.password.as_deref(),
    )
    .await
    {
        Ok(record) => Ok(Json(serde_json::json!({ "mount": record }))),
        Err(e) => Err((StatusCode::BAD_REQUEST, e)),
    }
}

async fn net_mount_delete(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    smb_mount::unmount_mount(&id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn net_mount_files(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let files = smb_mount::list_mount_files(&id).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::json!({ "files": files })))
}

async fn net_mount_download(
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let path = query.get("path").cloned().unwrap_or_default();
    let bytes = smb_mount::read_mount_file(&id, &path).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok((
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
        bytes,
    )
        .into_response())
}

async fn get_quota(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<QuotaResponse>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;

    let quota: Option<StorageQuota> =
        sqlx::query_as("SELECT * FROM storage_quotas WHERE user_id = ?")
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
    let user_id = extract_user_id(&headers)?;
    let _file = get_file_with_access(&state, &file_id, &user_id, "read").await?;

    let activity: Vec<FileActivity> = sqlx::query_as(
        "SELECT * FROM file_activity WHERE file_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&file_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(activity))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Resolve an rumahl path (`/icons`, `/Photos/x.jpg`, …) against the current
/// user's file tree. `found:false` means the path is NOT an rumahl path — the
/// frontend then treats it as a web path. This resolves the ambiguity between
/// web namespaces (e.g. `/icons/` from `public/icons`) and user-created root
/// folders that share the same name.
async fn resolve_path(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
    let path = query.get("path").cloned().unwrap_or_default();
    let segments: Vec<&str> = path.split('/').filter(|seg| !seg.is_empty()).collect();
    if segments.is_empty() || segments.iter().any(|seg| *seg == "." || *seg == "..") {
        return Ok(Json(serde_json::json!({ "found": false })));
    }
    let mut parent_id: Option<String> = None;
    let mut file: Option<FileRecord> = None;
    for (index, segment) in segments.iter().enumerate() {
        let is_last = index + 1 == segments.len();
        let query_segment = |is_folder: bool| {
            sqlx::query_as::<_, FileRecord>(
                "SELECT * FROM files WHERE owner_id = ? AND original_name = ? AND parent_folder_id IS ? AND is_folder = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
            )
            .bind(&user_id)
            .bind(segment)
            .bind(&parent_id)
            .bind(is_folder)
            .fetch_optional(&state.db)
        };
        // Intermediate segments must be folders; the last segment may be a
        // folder OR a file (a path like `/icons` can point to a folder).
        if is_last {
            file = query_segment(true)
                .await
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
                .or(None);
            if file.is_none() {
                file = query_segment(false)
                    .await
                    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            }
        } else {
            file = query_segment(true)
                .await
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
        match &file {
            Some(found) => parent_id = Some(found.id.clone()),
            None => return Ok(Json(serde_json::json!({ "found": false }))),
        }
    }
    match file {
        Some(found) => Ok(Json(serde_json::json!({
            "found": true,
            "file_id": found.id,
            "is_folder": found.is_folder,
            "name": found.original_name,
        }))),
        None => Ok(Json(serde_json::json!({ "found": false }))),
    }
}

/// Read a file from the host filesystem (absolute paths like `/var/lib/ora/…`).
/// Access is limited to rumahl data roots, files only, with a size limit.
async fn system_path(
    State(_state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let _user_id = extract_user_id(&headers)?;
    let raw = query.get("path").cloned().unwrap_or_default();
    const ALLOWED_ROOTS: [&str; 4] = ["/opt/rumahl", "/var/lib/ora", "/home/ora/ora", "/tmp"];
    if !ALLOWED_ROOTS.iter().any(|root| raw.starts_with(root)) {
        return Err((
            StatusCode::FORBIDDEN,
            "Path is outside the allowed roots".to_string(),
        ));
    }
    let canonical = std::fs::canonicalize(&raw)
        .map_err(|_| (StatusCode::NOT_FOUND, "Path does not exist".to_string()))?;
    let meta = tokio::fs::metadata(&canonical)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "Path does not exist".to_string()))?;
    if !meta.is_file() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Only files can be read".to_string(),
        ));
    }
    if meta.len() > 25 * 1024 * 1024 {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "File is too large".to_string(),
        ));
    }
    let bytes = tokio::fs::read(&canonical)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mime = mime_guess::from_path(&canonical).first_or_octet_stream();
    Ok((
        [(axum::http::header::CONTENT_TYPE, mime.as_ref().to_string())],
        bytes,
    ))
}

/// Like `extract_user_id` but also accepts the token via `?token=` in the
/// query string (used by native browser elements that cannot send headers).
fn extract_user_id_with_query(
    headers: &HeaderMap,
    query: Option<&str>,
) -> Result<String, (StatusCode, String)> {
    // Read the shared JWT secret fresh so a late-appearing shared file is
    // picked up without a restart (all services must validate with the same
    // secret that rumahl-home persists to /etc/ora/jwt-secret).
    let jwt_secret = system_config::jwt_secret();
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .or_else(|| {
            query.and_then(|q| {
                q.split('&').find_map(|part| {
                    let (key, value) = part.split_once('=')?;
                    (key == "token").then_some(value)
                })
            })
        })
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                "Missing authentication".to_string(),
            )
        })?;
    match crate::auth::verify_token(token, &jwt_secret) {
        Ok(user_id) => Ok(user_id),
        Err(_) => Err((StatusCode::UNAUTHORIZED, "Invalid token".to_string())),
    }
}

fn extract_user_id(headers: &HeaderMap) -> Result<String, (StatusCode, String)> {
    let jwt_secret = system_config::jwt_secret();
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                "Missing Authorization header".to_string(),
            )
        })?;

    let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Invalid Authorization format".to_string(),
        )
    })?;

    auth::verify_token(token, &jwt_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("Invalid token: {}", e)))
}

fn extract_claims(
    headers: &HeaderMap,
    query: Option<&str>,
) -> Result<auth::Claims, (StatusCode, String)> {
    let jwt_secret = system_config::jwt_secret();
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .or_else(|| {
            query.and_then(|value| {
                value.split('&').find_map(|part| {
                    let (key, token) = part.split_once('=')?;
                    (key == "token").then_some(token)
                })
            })
        })
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                "Missing authentication token".to_string(),
            )
        })?;

    auth::verify_claims(token, &jwt_secret)
        .map_err(|error| (StatusCode::UNAUTHORIZED, format!("Invalid token: {error}")))
}

async fn get_file_with_access(
    state: &AppState,
    file_id: &str,
    user_id: &str,
    required_permission: &str,
) -> Result<FileRecord, (StatusCode, String)> {
    let file: FileRecord =
        sqlx::query_as("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL")
            .bind(file_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    // Owner has full access
    if file.owner_id == user_id {
        return Ok(file);
    }

    // Check explicit permissions (user-specific grants win over family shares)
    let perm: Option<FilePermission> =
        sqlx::query_as(
            "SELECT * FROM file_permissions WHERE file_id = ? AND (grantee_id = ? OR grantee_type = 'family') \
             ORDER BY CASE WHEN grantee_id = ? THEN 0 ELSE 1 END LIMIT 1",
        )
        .bind(file_id)
        .bind(user_id)
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
        return Err((
            StatusCode::FORBIDDEN,
            "Insufficient permissions".to_string(),
        ));
    }

    Ok(file)
}

async fn ensure_quota(
    state: &AppState,
    user_id: &str,
    additional_bytes: i64,
) -> Result<(), (StatusCode, String)> {
    let quota: Option<StorageQuota> =
        sqlx::query_as("SELECT * FROM storage_quotas WHERE user_id = ?")
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

async fn validate_share_link(
    state: &AppState,
    token: &str,
) -> Result<ShareLink, (StatusCode, String)> {
    let link: ShareLink =
        sqlx::query_as("SELECT * FROM share_links WHERE token = ? AND is_active = 1")
            .bind(token)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    "Share link not found or expired".to_string(),
                )
            })?;

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

fn verify_share_password(
    link: &ShareLink,
    provided: &Option<String>,
) -> Result<(), (StatusCode, String)> {
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

async fn log_activity(
    state: &AppState,
    file_id: &str,
    user_id: &str,
    action: &str,
    details: Option<serde_json::Value>,
) {
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
        .filter(|c| {
            !matches!(
                c,
                '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        })
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

/// Query for the system-folder endpoint.
#[derive(Debug, Deserialize)]
struct SystemFolderQuery {
    name: String,
}

/// GET /api/files/system-folder?name=Downloads
///
/// Returns the user's personal system folder (Downloads, Documents, Photos,
/// Videos…) in the root, creating it on first use. The Downloads folder is
/// the anchor for the Package 6 download manager; every user gets their own.
async fn get_system_folder(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SystemFolderQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_user_id(&headers)?;
    let name = query.name.trim().to_string();
    if name.is_empty() || name.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "Invalid folder name".to_string()));
    }

    // Alias map so legacy localized names (e.g. "Dokumente") are reused
    // instead of creating a duplicate with the canonical English name.
    let aliases: Vec<String> = match name.as_str() {
        "Documents" => vec!["Documents".into(), "Dokumente".into()],
        "Photos" => vec!["Photos".into(), "Fotos".into()],
        _ => vec![name.clone()],
    };

    // Reuse an existing root folder with this name (or a known alias).
    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT id, original_name FROM files \
         WHERE owner_id = ? AND parent_folder_id IS NULL \
           AND original_name IN (SELECT value FROM json_each(?)) \
           AND is_folder = 1 AND deleted_at IS NULL \
         LIMIT 1",
    )
    .bind(&user_id)
    .bind(serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".into()))
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some((id, original_name)) = existing {
        return Ok(Json(serde_json::json!({
            "folder": { "id": id, "name": original_name, "created": false }
        })));
    }

    // Create the personal system folder.
    let folder_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO files (id, owner_id, filename, original_name, mime_type, size_bytes, sha256_hash, storage_path, parent_folder_id, is_folder, description, created_at, updated_at) \
         VALUES (?, ?, ?, ?, 'inode/directory', 0, '', '', NULL, 1, ?, ?, ?)",
    )
    .bind(&folder_id)
    .bind(&user_id)
    .bind(&name)
    .bind(&name)
    .bind(&name)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({
        "folder": { "id": folder_id, "name": name, "created": true }
    })))
}
