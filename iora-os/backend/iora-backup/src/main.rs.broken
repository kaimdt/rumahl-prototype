use actix_web::{delete, get, post, web, App, HttpResponse, HttpServer, Responder};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;

mod backup_engine;
mod remote_storage;
mod scheduler;

use backup_engine::{BackupEngine, BackupOptions};
use remote_storage::{RemoteStorageBackend, RemoteStorageConfig};
use scheduler::BackupScheduler;

/// IORA Backup Service
///
/// Provides comprehensive backup and restore functionality for IORA OS:
/// - Full system backups (databases, volumes, config)
/// - Scheduled time-based backups
/// - Pre-update automatic backups
/// - Remote storage backends (FTP, WebDAV, S3)
/// - User-configurable backup content

struct AppState {
    db: PgPool,
    backup_engine: Arc<BackupEngine>,
    scheduler: Arc<RwLock<BackupScheduler>>,
    backup_dir: PathBuf,
}

// ─── Database Models ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct Backup {
    id: Uuid,
    name: String,
    backup_type: String, // "manual", "scheduled", "pre_update"
    created_at: DateTime<Utc>,
    size_bytes: i64,
    local_path: String,
    remote_path: Option<String>,
    remote_backend: Option<String>,
    status: String, // "creating", "completed", "failed", "uploaded"
    error_message: Option<String>,
    content_manifest: serde_json::Value, // What was included in backup
    metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct BackupConfig {
    id: Uuid,
    enabled: bool,

    // Content selection
    include_databases: bool,
    include_docker_volumes: bool,
    include_system_config: bool,
    include_user_data: bool,
    include_apps: bool,

    // Scheduling
    schedule_enabled: bool,
    schedule_cron: Option<String>, // Cron expression
    schedule_retention_days: i32,

    // Pre-update backups
    pre_update_enabled: bool,
    pre_update_retention_count: i32,

    // Remote storage
    remote_storage_enabled: bool,
    remote_storage_backend: Option<String>, // "ftp", "webdav", "s3"
    remote_storage_config: Option<serde_json::Value>,

    updated_at: DateTime<Utc>,
}

// ─── API Request/Response Models ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreateBackupRequest {
    name: String,
    backup_type: Option<String>,

    // Override default config
    include_databases: Option<bool>,
    include_docker_volumes: Option<bool>,
    include_system_config: Option<bool>,
    include_user_data: Option<bool>,
    include_apps: Option<bool>,

    // Upload to remote storage after creation
    upload_to_remote: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RestoreBackupRequest {
    backup_id: Uuid,

    // Selective restore
    restore_databases: Option<bool>,
    restore_docker_volumes: Option<bool>,
    restore_system_config: Option<bool>,
    restore_user_data: Option<bool>,
    restore_apps: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct UpdateConfigRequest {
    enabled: Option<bool>,

    include_databases: Option<bool>,
    include_docker_volumes: Option<bool>,
    include_system_config: Option<bool>,
    include_user_data: Option<bool>,
    include_apps: Option<bool>,

    schedule_enabled: Option<bool>,
    schedule_cron: Option<String>,
    schedule_retention_days: Option<i32>,

    pre_update_enabled: Option<bool>,
    pre_update_retention_count: Option<i32>,

    remote_storage_enabled: Option<bool>,
    remote_storage_backend: Option<String>,
    remote_storage_config: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct BackupListResponse {
    backups: Vec<BackupInfo>,
    total: i64,
    total_size_bytes: i64,
}

#[derive(Debug, Serialize)]
struct BackupInfo {
    id: String,
    name: String,
    backup_type: String,
    created_at: String,
    size_mb: f64,
    status: String,
    has_remote_copy: bool,
    content_summary: ContentSummary,
}

#[derive(Debug, Serialize)]
struct ContentSummary {
    databases: bool,
    docker_volumes: bool,
    system_config: bool,
    user_data: bool,
    apps: bool,
}

// ─── API Endpoints ──────────────────────────────────────────────────────────

/// Health check
#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "iora-backup",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Get backup configuration
#[get("/api/backup/config")]
async fn get_config(data: web::Data<AppState>) -> impl Responder {
    match sqlx::query_as::<_, BackupConfig>(
        "SELECT * FROM backup_config ORDER BY updated_at DESC LIMIT 1"
    )
    .fetch_optional(&data.db)
    .await
    {
        Ok(Some(config)) => HttpResponse::Ok().json(config),
        Ok(None) => {
            // Return default config
            let default_config = serde_json::json!({
                "enabled": false,
                "include_databases": true,
                "include_docker_volumes": true,
                "include_system_config": true,
                "include_user_data": true,
                "include_apps": true,
                "schedule_enabled": false,
                "schedule_cron": "0 2 * * *",
                "schedule_retention_days": 7,
                "pre_update_enabled": true,
                "pre_update_retention_count": 3,
                "remote_storage_enabled": false,
            });
            HttpResponse::Ok().json(default_config)
        }
        Err(e) => {
            error!("Failed to get backup config: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to get backup configuration"
            }))
        }
    }
}

/// Update backup configuration
#[post("/api/backup/config")]
async fn update_config(
    req: web::Json<UpdateConfigRequest>,
    data: web::Data<AppState>,
) -> impl Responder {
    // Get current config or create new one
    let current = sqlx::query_as::<_, BackupConfig>(
        "SELECT * FROM backup_config ORDER BY updated_at DESC LIMIT 1"
    )
    .fetch_optional(&data.db)
    .await;

    let config_id = match current {
        Ok(Some(c)) => c.id,
        _ => Uuid::new_v4(),
    };

    // Build update query
    let result = sqlx::query(
        r#"
        INSERT INTO backup_config (
            id, enabled, include_databases, include_docker_volumes,
            include_system_config, include_user_data, include_apps,
            schedule_enabled, schedule_cron, schedule_retention_days,
            pre_update_enabled, pre_update_retention_count,
            remote_storage_enabled, remote_storage_backend, remote_storage_config,
            updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
            enabled = COALESCE($2, backup_config.enabled),
            include_databases = COALESCE($3, backup_config.include_databases),
            include_docker_volumes = COALESCE($4, backup_config.include_docker_volumes),
            include_system_config = COALESCE($5, backup_config.include_system_config),
            include_user_data = COALESCE($6, backup_config.include_user_data),
            include_apps = COALESCE($7, backup_config.include_apps),
            schedule_enabled = COALESCE($8, backup_config.schedule_enabled),
            schedule_cron = COALESCE($9, backup_config.schedule_cron),
            schedule_retention_days = COALESCE($10, backup_config.schedule_retention_days),
            pre_update_enabled = COALESCE($11, backup_config.pre_update_enabled),
            pre_update_retention_count = COALESCE($12, backup_config.pre_update_retention_count),
            remote_storage_enabled = COALESCE($13, backup_config.remote_storage_enabled),
            remote_storage_backend = COALESCE($14, backup_config.remote_storage_backend),
            remote_storage_config = COALESCE($15, backup_config.remote_storage_config),
            updated_at = $16
        "#
    )
    .bind(&config_id)
    .bind(req.enabled)
    .bind(req.include_databases)
    .bind(req.include_docker_volumes)
    .bind(req.include_system_config)
    .bind(req.include_user_data)
    .bind(req.include_apps)
    .bind(req.schedule_enabled)
    .bind(&req.schedule_cron)
    .bind(req.schedule_retention_days)
    .bind(req.pre_update_enabled)
    .bind(req.pre_update_retention_count)
    .bind(req.remote_storage_enabled)
    .bind(&req.remote_storage_backend)
    .bind(&req.remote_storage_config)
    .bind(Utc::now())
    .execute(&data.db)
    .await;

    match result {
        Ok(_) => {
            // Update scheduler if schedule settings changed
            if req.schedule_enabled.is_some() || req.schedule_cron.is_some() {
                let mut scheduler = data.scheduler.write().await;
                if let Some(cron) = &req.schedule_cron {
                    if let Err(e) = scheduler.update_schedule(cron).await {
                        warn!("Failed to update schedule: {}", e);
                    }
                }
            }

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": "Backup configuration updated"
            }))
        }
        Err(e) => {
            error!("Failed to update backup config: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to update backup configuration"
            }))
        }
    }
}

/// Create a new backup
#[post("/api/backup/create")]
async fn create_backup(
    req: web::Json<CreateBackupRequest>,
    data: web::Data<AppState>,
) -> impl Responder {
    let backup_id = Uuid::new_v4();
    let backup_type = req.backup_type.clone().unwrap_or_else(|| "manual".to_string());

    // Get default config
    let config = sqlx::query_as::<_, BackupConfig>(
        "SELECT * FROM backup_config ORDER BY updated_at DESC LIMIT 1"
    )
    .fetch_optional(&data.db)
    .await
    .ok()
    .flatten();

    // Build backup options
    let options = BackupOptions {
        include_databases: req.include_databases.or(config.as_ref().map(|c| c.include_databases)).unwrap_or(true),
        include_docker_volumes: req.include_docker_volumes.or(config.as_ref().map(|c| c.include_docker_volumes)).unwrap_or(true),
        include_system_config: req.include_system_config.or(config.as_ref().map(|c| c.include_system_config)).unwrap_or(true),
        include_user_data: req.include_user_data.or(config.as_ref().map(|c| c.include_user_data)).unwrap_or(true),
        include_apps: req.include_apps.or(config.as_ref().map(|c| c.include_apps)).unwrap_or(true),
    };

    let content_manifest = serde_json::json!({
        "databases": options.include_databases,
        "docker_volumes": options.include_docker_volumes,
        "system_config": options.include_system_config,
        "user_data": options.include_user_data,
        "apps": options.include_apps,
    });

    // Create backup record
    let local_path = format!("{}/backup_{}_{}.tar.gz",
        data.backup_dir.display(),
        backup_id,
        Utc::now().format("%Y%m%d_%H%M%S")
    );

    let insert_result = sqlx::query(
        r#"
        INSERT INTO backups (
            id, name, backup_type, created_at, size_bytes, local_path,
            remote_path, remote_backend, status, error_message,
            content_manifest, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#
    )
    .bind(&backup_id)
    .bind(&req.name)
    .bind(&backup_type)
    .bind(Utc::now())
    .bind(0i64)
    .bind(&local_path)
    .bind(None::<String>)
    .bind(None::<String>)
    .bind("creating")
    .bind(None::<String>)
    .bind(&content_manifest)
    .bind(serde_json::json!({}))
    .execute(&data.db)
    .await;

    if let Err(e) = insert_result {
        error!("Failed to create backup record: {}", e);
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": "Failed to create backup record"
        }));
    }

    // Start backup process in background
    let engine = data.backup_engine.clone();
    let db = data.db.clone();
    let upload_to_remote = req.upload_to_remote.unwrap_or(false);
    let remote_config = config.and_then(|c| {
        if c.remote_storage_enabled && upload_to_remote {
            c.remote_storage_config
        } else {
            None
        }
    });

    tokio::spawn(async move {
        info!("Starting backup {}", backup_id);

        match engine.create_backup(&backup_id, &local_path, options).await {
            Ok(size_bytes) => {
                info!("Backup {} completed: {} bytes", backup_id, size_bytes);

                // Update backup status
                let _ = sqlx::query(
                    "UPDATE backups SET status = $1, size_bytes = $2 WHERE id = $3"
                )
                .bind("completed")
                .bind(size_bytes as i64)
                .bind(&backup_id)
                .execute(&db)
                .await;

                // Upload to remote storage if configured
                if let Some(remote_cfg) = remote_config {
                    info!("Uploading backup {} to remote storage", backup_id);
                    // TODO: Implement remote upload
                }
            }
            Err(e) => {
                error!("Backup {} failed: {}", backup_id, e);
                let _ = sqlx::query(
                    "UPDATE backups SET status = $1, error_message = $2 WHERE id = $3"
                )
                .bind("failed")
                .bind(e.to_string())
                .bind(&backup_id)
                .execute(&db)
                .await;
            }
        }
    });

    HttpResponse::Accepted().json(serde_json::json!({
        "backup_id": backup_id,
        "status": "creating",
        "message": "Backup creation started"
    }))
}

/// List all backups
#[get("/api/backup/list")]
async fn list_backups(data: web::Data<AppState>) -> impl Responder {
    let backups = match sqlx::query_as::<_, Backup>(
        "SELECT * FROM backups ORDER BY created_at DESC"
    )
    .fetch_all(&data.db)
    .await
    {
        Ok(backups) => backups,
        Err(e) => {
            error!("Failed to list backups: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to list backups"
            }));
        }
    };

    let total = backups.len() as i64;
    let total_size_bytes: i64 = backups.iter().map(|b| b.size_bytes).sum();

    let backup_infos: Vec<BackupInfo> = backups
        .into_iter()
        .map(|b| {
            let manifest = b.content_manifest.as_object().unwrap();
            BackupInfo {
                id: b.id.to_string(),
                name: b.name,
                backup_type: b.backup_type,
                created_at: b.created_at.to_rfc3339(),
                size_mb: b.size_bytes as f64 / 1024.0 / 1024.0,
                status: b.status,
                has_remote_copy: b.remote_path.is_some(),
                content_summary: ContentSummary {
                    databases: manifest.get("databases").and_then(|v| v.as_bool()).unwrap_or(false),
                    docker_volumes: manifest.get("docker_volumes").and_then(|v| v.as_bool()).unwrap_or(false),
                    system_config: manifest.get("system_config").and_then(|v| v.as_bool()).unwrap_or(false),
                    user_data: manifest.get("user_data").and_then(|v| v.as_bool()).unwrap_or(false),
                    apps: manifest.get("apps").and_then(|v| v.as_bool()).unwrap_or(false),
                },
            }
        })
        .collect();

    HttpResponse::Ok().json(BackupListResponse {
        backups: backup_infos,
        total,
        total_size_bytes,
    })
}

/// Get backup details
#[get("/api/backup/{backup_id}")]
async fn get_backup(
    backup_id: web::Path<Uuid>,
    data: web::Data<AppState>,
) -> impl Responder {
    match sqlx::query_as::<_, Backup>(
        "SELECT * FROM backups WHERE id = $1"
    )
    .bind(&*backup_id)
    .fetch_optional(&data.db)
    .await
    {
        Ok(Some(backup)) => HttpResponse::Ok().json(backup),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Backup not found"
        })),
        Err(e) => {
            error!("Failed to get backup: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to get backup"
            }))
        }
    }
}

/// Restore from backup
#[post("/api/backup/restore")]
async fn restore_backup(
    req: web::Json<RestoreBackupRequest>,
    data: web::Data<AppState>,
) -> impl Responder {
    // Get backup info
    let backup = match sqlx::query_as::<_, Backup>(
        "SELECT * FROM backups WHERE id = $1"
    )
    .bind(&req.backup_id)
    .fetch_optional(&data.db)
    .await
    {
        Ok(Some(b)) => b,
        Ok(None) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "Backup not found"
            }));
        }
        Err(e) => {
            error!("Failed to get backup: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to get backup"
            }));
        }
    };

    if backup.status != "completed" {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Cannot restore from incomplete backup"
        }));
    }

    // Build restore options
    let options = BackupOptions {
        include_databases: req.restore_databases.unwrap_or(true),
        include_docker_volumes: req.restore_docker_volumes.unwrap_or(true),
        include_system_config: req.restore_system_config.unwrap_or(true),
        include_user_data: req.restore_user_data.unwrap_or(true),
        include_apps: req.restore_apps.unwrap_or(true),
    };

    // Start restore process
    let engine = data.backup_engine.clone();
    let local_path = backup.local_path.clone();

    tokio::spawn(async move {
        info!("Starting restore from backup {}", req.backup_id);

        match engine.restore_backup(&local_path, options).await {
            Ok(()) => {
                info!("Restore from backup {} completed", req.backup_id);
            }
            Err(e) => {
                error!("Restore from backup {} failed: {}", req.backup_id, e);
            }
        }
    });

    HttpResponse::Accepted().json(serde_json::json!({
        "message": "Restore started",
        "backup_id": req.backup_id
    }))
}

/// Delete a backup
#[delete("/api/backup/{backup_id}")]
async fn delete_backup(
    backup_id: web::Path<Uuid>,
    data: web::Data<AppState>,
) -> impl Responder {
    // Get backup info
    let backup = match sqlx::query_as::<_, Backup>(
        "SELECT * FROM backups WHERE id = $1"
    )
    .bind(&*backup_id)
    .fetch_optional(&data.db)
    .await
    {
        Ok(Some(b)) => b,
        Ok(None) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "Backup not found"
            }));
        }
        Err(e) => {
            error!("Failed to get backup: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to get backup"
            }));
        }
    };

    // Delete local file
    if let Err(e) = tokio::fs::remove_file(&backup.local_path).await {
        warn!("Failed to delete backup file: {}", e);
    }

    // Delete from database
    match sqlx::query("DELETE FROM backups WHERE id = $1")
        .bind(&*backup_id)
        .execute(&data.db)
        .await
    {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "message": "Backup deleted"
        })),
        Err(e) => {
            error!("Failed to delete backup: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to delete backup"
            }))
        }
    }
}

/// Trigger pre-update backup (called by update service)
#[post("/api/backup/pre-update")]
async fn pre_update_backup(data: web::Data<AppState>) -> impl Responder {
    // Check if pre-update backups are enabled
    let config = sqlx::query_as::<_, BackupConfig>(
        "SELECT * FROM backup_config ORDER BY updated_at DESC LIMIT 1"
    )
    .fetch_optional(&data.db)
    .await
    .ok()
    .flatten();

    if let Some(cfg) = config {
        if !cfg.pre_update_enabled {
            return HttpResponse::Ok().json(serde_json::json!({
                "message": "Pre-update backups are disabled",
                "skipped": true
            }));
        }
    }

    // Create pre-update backup
    let req = CreateBackupRequest {
        name: format!("Pre-Update Backup {}", Utc::now().format("%Y-%m-%d %H:%M:%S")),
        backup_type: Some("pre_update".to_string()),
        include_databases: None,
        include_docker_volumes: None,
        include_system_config: None,
        include_user_data: None,
        include_apps: None,
        upload_to_remote: Some(true),
    };

    create_backup(web::Json(req), data).await
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        )
        .init();

    info!("Starting IORA Backup Service...");

    // Get environment variables
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://iora:changeme@postgres:5432/iora_backup".to_string());
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8100".to_string())
        .parse::<u16>()
        .expect("Invalid PORT");
    let backup_dir = PathBuf::from(
        std::env::var("BACKUP_DIR")
            .unwrap_or_else(|_| "/var/lib/iora/backups".to_string())
    );

    // Create backup directory if it doesn't exist
    tokio::fs::create_dir_all(&backup_dir).await?;

    // Connect to database
    info!("Connecting to database...");
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Run migrations
    info!("Running database migrations...");
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("Failed to run migrations");

    // Initialize backup engine
    let backup_engine = Arc::new(BackupEngine::new());

    // Initialize scheduler
    let scheduler = Arc::new(RwLock::new(
        BackupScheduler::new(db.clone(), backup_engine.clone())
    ));

    // Start scheduler
    let scheduler_clone = scheduler.clone();
    tokio::spawn(async move {
        scheduler_clone.write().await.start().await;
    });

    // Create app state
    let app_state = web::Data::new(AppState {
        db: db.clone(),
        backup_engine,
        scheduler,
        backup_dir,
    });

    info!("IORA Backup Service listening on 0.0.0.0:{}", port);

    // Start HTTP server
    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .service(health)
            .service(get_config)
            .service(update_config)
            .service(create_backup)
            .service(list_backups)
            .service(get_backup)
            .service(restore_backup)
            .service(delete_backup)
            .service(pre_update_backup)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
