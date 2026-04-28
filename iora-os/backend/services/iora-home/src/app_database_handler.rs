//! App Database Handler – SQLite database provisioning for IORA apps.
//!
//! API endpoints:
//!   POST   /api/apps/:app_id/database/provision – Provision a new SQLite database
//!   DELETE /api/apps/:app_id/database           – Drop the database
//!   GET    /api/apps/:app_id/database/status    – Get database status
//!   POST   /api/apps/:app_id/database/execute   – Execute SQL
//!   POST   /api/apps/:app_id/database/backup    – Trigger a backup
//!   GET    /api/apps/:app_id/database/backups   – List backups
//!
//! Uses sqlx (not rusqlite) to stay consistent with the rest of the workspace
//! and avoid libsqlite3-sys version conflicts across crates.

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteRow},
    Column, ConnectOptions, Connection, Row, ValueRef,
};
use tokio::fs;
use tracing::{error, info, warn};

use iora_shared::app_database::*;

/// Database base directory
const DB_BASE_DIR: &str = "data/app-databases";

/// Backup directory
const DB_BACKUP_DIR: &str = "data/app-database-backups";

#[derive(Clone)]
pub struct AppDatabaseState {
    pub db_dir: PathBuf,
    pub backup_dir: PathBuf,
}

impl AppDatabaseState {
    pub fn new() -> Self {
        Self {
            db_dir: PathBuf::from(DB_BASE_DIR),
            backup_dir: PathBuf::from(DB_BACKUP_DIR),
        }
    }

    fn db_path(&self, app_id: &str) -> PathBuf {
        self.db_dir.join(format!("{}.db", app_id))
    }

    /// Open a sqlite connection to the given path, creating the file if it doesn't exist.
    async fn open_conn(&self, app_id: &str) -> Result<sqlx::sqlite::SqliteConnection, (StatusCode, String)> {
        let db_path = self.db_path(app_id);
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
        options.connect().await.map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to open SQLite database: {}", e))
        })
    }
}

/// Convert a single sqlx SqliteRow value at the given column index into a serde_json::Value.
fn row_val_to_json(row: &SqliteRow, idx: usize) -> serde_json::Value {
    let raw = match row.try_get_raw(idx) {
        Ok(r) => r,
        Err(_) => return serde_json::Value::Null,
    };
    if raw.is_null() {
        return serde_json::Value::Null;
    }

    // Try text, integer, float, blob in order
    if let Ok(s) = row.try_get::<String, _>(idx) {
        return serde_json::Value::String(s);
    }
    if let Ok(n) = row.try_get::<i64, _>(idx) {
        return serde_json::json!(n);
    }
    if let Ok(f) = row.try_get::<f64, _>(idx) {
        return serde_json::json!(f);
    }
    if let Ok(b) = row.try_get::<Vec<u8>, _>(idx) {
        return serde_json::json!(
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &b)
        );
    }
    serde_json::Value::Null
}

/// Provision a new SQLite database for an app
pub async fn provision_database(
    State(state): State<Arc<AppDatabaseState>>,
    AxumPath(app_id): AxumPath<String>,
    Json(config): Json<SqliteConfig>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db_path = state.db_path(&app_id);

    // Check if already exists
    if db_path.exists() {
        return Err((StatusCode::CONFLICT, format!("Database for app '{}' already exists", app_id)));
    }

    // Create directory
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create DB directory: {}", e))
        })?;
    }

    // Open SQLite connection and configure
    let mut conn = state.open_conn(&app_id).await?;

    // Enable WAL mode if configured
    if config.wal_mode {
        sqlx::query("PRAGMA journal_mode=WAL;")
            .execute(&mut conn)
            .await
            .map_err(|e| {
                let _ = std::fs::remove_file(&db_path);
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to enable WAL mode: {}", e))
            })?;
    }

    // Set max page count (roughly controls max size)
    let max_pages = (config.max_size_bytes / 4096).max(1);
    sqlx::query(&format!("PRAGMA max_page_count={};", max_pages))
        .execute(&mut conn)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_file(&db_path);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to set max page count: {}", e))
        })?;

    // Run init SQL (each statement individually)
    for sql in &config.init_sql {
        sqlx::query(sql)
            .execute(&mut conn)
            .await
            .map_err(|e| {
                let _ = std::fs::remove_file(&db_path);
                (StatusCode::BAD_REQUEST, format!("Init SQL failed: {} (sql: {})", e, sql))
            })?;
    }

    drop(conn);

    info!("Provisioned SQLite database for app '{}' at {:?}", app_id, db_path);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("SQLite database provisioned for app '{}'", app_id),
        "path": db_path.to_string_lossy().to_string(),
        "wal_mode": config.wal_mode,
        "max_size_bytes": config.max_size_bytes,
    })))
}

/// Delete the app's SQLite database
pub async fn drop_database(
    State(state): State<Arc<AppDatabaseState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db_path = state.db_path(&app_id);

    if !db_path.exists() {
        return Err((StatusCode::NOT_FOUND, format!("No database found for app '{}'", app_id)));
    }

    // Remove the database file and WAL/SHM files
    let _ = fs::remove_file(&db_path).await;
    let _ = fs::remove_file(db_path.with_extension("db-wal")).await;
    let _ = fs::remove_file(db_path.with_extension("db-shm")).await;

    info!("Dropped SQLite database for app '{}'", app_id);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Database for app '{}' deleted", app_id)
    })))
}

/// Get database status
pub async fn database_status(
    State(state): State<Arc<AppDatabaseState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<DatabaseStatus>, (StatusCode, String)> {
    let db_path = state.db_path(&app_id);

    if !db_path.exists() {
        return Ok(Json(DatabaseStatus {
            backend: DatabaseBackend::Sqlite,
            connected: false,
            size_bytes: None,
            table_count: None,
            last_backup: None,
            error: Some("Database not provisioned".to_string()),
        }));
    }

    let metadata = std::fs::metadata(&db_path).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read DB metadata: {}", e))
    })?;

    // Count tables
    let table_count = match SqliteConnectOptions::new()
        .filename(&db_path)
        .read_only(true)
        .connect()
        .await
    {
        Ok(mut conn) => {
            let row: Result<(i64,), _> = sqlx::query_as(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
            )
                .fetch_one(&mut conn)
                .await;
            row.ok().map(|(count,)| count as u32)
        }
        Err(_) => None,
    };

    let backup_dir = state.backup_dir.join(&app_id);
    let latest_backup = if backup_dir.exists() {
        let mut entries = fs::read_dir(&backup_dir).await.ok();
        let mut backups = Vec::new();
        if let Some(mut entries) = entries {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.file_type().await.map(|t| t.is_file()).unwrap_or(false) {
                    if let Ok(modified) = entry.metadata().await.map(|m| m.modified().ok()) {
                        if let Some(time) = modified {
                            let datetime: chrono::DateTime<Utc> = time.into();
                            backups.push((datetime, entry.file_name()));
                        }
                    }
                }
            }
        }
        backups.sort_by(|a, b| b.0.cmp(&a.0));
        backups.first().map(|(dt, _)| dt.to_rfc3339())
    } else {
        None
    };

    Ok(Json(DatabaseStatus {
        backend: DatabaseBackend::Sqlite,
        connected: true,
        size_bytes: Some(metadata.len()),
        table_count,
        last_backup: latest_backup,
        error: None,
    }))
}

/// Execute SQL on the app's database
pub async fn execute_sql(
    State(state): State<Arc<AppDatabaseState>>,
    AxumPath(app_id): AxumPath<String>,
    Json(req): Json<ExecuteSqlRequest>,
) -> Result<Json<ExecuteSqlResult>, (StatusCode, String)> {
    let db_path = state.db_path(&app_id);

    if !db_path.exists() {
        return Err((StatusCode::NOT_FOUND, format!("No database for app '{}'. Provision one first.", app_id)));
    }

    let start = std::time::Instant::now();

    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .read_only(false)
        .create_if_missing(false);
    let mut conn = options.connect().await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to open database: {}", e))
    })?;

    // Determine if this is a query (SELECT-like) or a mutation statement
    let is_query = {
        let trimmed = req.sql.trim().to_uppercase();
        trimmed.starts_with("SELECT")
            || trimmed.starts_with("PRAGMA")
            || trimmed.starts_with("EXPLAIN")
    };

    if is_query {
        // Execute query and collect rows
        let rows = sqlx::query(&req.sql)
            .fetch_all(&mut conn)
            .await
            .map_err(|e| {
                (StatusCode::BAD_REQUEST, format!("SQL query error: {}", e))
            })?;

        // Extract column names from the first row (if any)
        let columns: Vec<String> = rows
            .first()
            .map(|row| {
                row.columns()
                    .iter()
                    .map(|c| c.name().to_string())
                    .collect()
            })
            .unwrap_or_default();

        let json_rows: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|i| row_val_to_json(row, i))
                    .collect()
            })
            .collect();

        let duration = start.elapsed().as_millis() as u64;

        return Ok(Json(ExecuteSqlResult {
            success: true,
            rows_affected: None,
            columns,
            rows: json_rows,
            error: None,
            duration_ms: duration,
        }));
    }

    // Execute as statement (INSERT, UPDATE, DELETE, CREATE, etc.)
    let result = sqlx::query(&req.sql)
        .execute(&mut conn)
        .await
        .map_err(|e| {
            (StatusCode::BAD_REQUEST, format!("SQL execute error: {}", e))
        })?;

    let duration = start.elapsed().as_millis() as u64;

    Ok(Json(ExecuteSqlResult {
        success: true,
        rows_affected: Some(result.rows_affected()),
        columns: vec![],
        rows: vec![],
        error: None,
        duration_ms: duration,
    }))
}

/// Trigger a database backup
pub async fn backup_database(
    State(state): State<Arc<AppDatabaseState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db_path = state.db_path(&app_id);

    if !db_path.exists() {
        return Err((StatusCode::NOT_FOUND, format!("No database for app '{}'", app_id)));
    }

    let backup_dir = state.backup_dir.join(&app_id);
    fs::create_dir_all(&backup_dir).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create backup dir: {}", e))
    })?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let backup_name = format!("{}_{}.db", app_id, timestamp);
    let backup_path = backup_dir.join(&backup_name);

    // Copy the database file (simple file-level backup)
    fs::copy(&db_path, &backup_path).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to backup database: {}", e))
    })?;

    info!("Backed up database for app '{}' to {:?}", app_id, backup_path);

    Ok(Json(serde_json::json!({
        "success": true,
        "backup_path": backup_path.to_string_lossy().to_string(),
        "backup_name": backup_name,
    })))
}

/// List backups for an app
pub async fn list_backups(
    State(state): State<Arc<AppDatabaseState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let backup_dir = state.backup_dir.join(&app_id);

    if !backup_dir.exists() {
        return Ok(Json(Vec::new()));
    }

    let mut entries = fs::read_dir(&backup_dir).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list backups: {}", e)))?;

    let mut backups = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_type().await.map(|t| t.is_file()).unwrap_or(false) {
            if let Ok(meta) = entry.metadata().await {
                let modified: chrono::DateTime<Utc> = meta.modified().ok().map(|t| t.into())
                    .unwrap_or_else(Utc::now);
                backups.push(serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "size_bytes": meta.len(),
                    "created_at": modified.to_rfc3339(),
                }));
            }
        }
    }

    backups.sort_by(|a, b| {
        let a_time = a["created_at"].as_str().unwrap_or("");
        let b_time = b["created_at"].as_str().unwrap_or("");
        b_time.cmp(a_time)
    });

    Ok(Json(backups))
}
