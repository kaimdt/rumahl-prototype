//! rumahl Backup Service — actix-web HTTP API.

use std::path::PathBuf;
use std::sync::Arc;

use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

mod backup_engine;
mod db;
mod scheduler;

use backup_engine::{BackupEngine, BackupOptions};
use scheduler::BackupScheduler;

struct AppState {
    db: PgPool,
    engine: Arc<BackupEngine>,
    #[allow(dead_code)]
    backup_dir: PathBuf,
    scheduler: BackupScheduler,
}

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "rumahl-backup",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

#[get("/api/backup/config")]
async fn get_config(state: web::Data<AppState>) -> impl Responder {
    match db::load_config(&state.db).await {
        Ok(Some(cfg)) => HttpResponse::Ok().json(cfg),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({"error":"no_config"})),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[post("/api/backup/config")]
async fn update_config(
    state: web::Data<AppState>,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    match db::update_config(&state.db, &req).await {
        Ok(cfg) => HttpResponse::Ok().json(cfg),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[derive(Debug, Deserialize, Default)]
struct CreateBackupRequest {
    name: Option<String>,
    backup_type: Option<String>,
    include_databases: Option<bool>,
    include_docker_volumes: Option<bool>,
    include_system_config: Option<bool>,
    include_user_data: Option<bool>,
    include_apps: Option<bool>,
}

#[post("/api/backup/create")]
async fn create_backup(
    state: web::Data<AppState>,
    req: web::Json<CreateBackupRequest>,
) -> impl Responder {
    let cfg = match db::load_config(&state.db).await {
        Ok(Some(c)) => c,
        Ok(None) => db::BackupConfig::default(),
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({"error": e.to_string()}))
        }
    };
    let opts = BackupOptions {
        include_databases: req.include_databases.unwrap_or(cfg.include_databases),
        include_docker_volumes: req
            .include_docker_volumes
            .unwrap_or(cfg.include_docker_volumes),
        include_system_config: req
            .include_system_config
            .unwrap_or(cfg.include_system_config),
        include_user_data: req.include_user_data.unwrap_or(cfg.include_user_data),
        include_apps: req.include_apps.unwrap_or(cfg.include_apps),
        backup_dir: None,
    };
    let name = req
        .name
        .clone()
        .unwrap_or_else(|| format!("manual-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S")));
    let backup_type = req.backup_type.clone().unwrap_or_else(|| "manual".into());

    let engine = state.engine.clone();
    let res = web::block(move || engine.create_backup(&name, &opts)).await;

    match res {
        Ok(Ok(b)) => {
            if let Err(e) = db::insert_backup(&state.db, &b, &backup_type, "completed", None).await
            {
                warn!("backup created but db insert failed: {e}");
            }
            HttpResponse::Ok().json(b)
        }
        Ok(Err(e)) => {
            error!("backup failed: {e}");
            HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[get("/api/backup/list")]
async fn list_backups(state: web::Data<AppState>) -> impl Responder {
    match db::list_backups(&state.db).await {
        Ok(rows) => HttpResponse::Ok().json(serde_json::json!({"backups": rows})),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[derive(Debug, Deserialize)]
struct RestoreBackupRequest {
    backup_id: Uuid,
}

#[post("/api/backup/restore")]
async fn restore_backup(
    state: web::Data<AppState>,
    req: web::Json<RestoreBackupRequest>,
) -> impl Responder {
    let row = match db::find_backup(&state.db, req.backup_id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::NotFound().json(serde_json::json!({"error":"backup_not_found"}))
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({"error": e.to_string()}))
        }
    };
    let engine = state.engine.clone();
    let path = std::path::PathBuf::from(row.local_path.clone());
    let res = web::block(move || engine.restore_backup(&path)).await;
    match res {
        Ok(Ok(target)) => HttpResponse::Ok().json(serde_json::json!({
            "ok": true,
            "staging_dir": target.to_string_lossy(),
            "note": "Restore is non-destructive. Files were extracted to the staging directory and must be promoted manually by an operator.",
        })),
        Ok(Err(e)) => HttpResponse::InternalServerError()
            .json(serde_json::json!({"error": e.to_string()})),
        Err(e) => HttpResponse::InternalServerError()
            .json(serde_json::json!({"error": e.to_string()})),
    }
}

#[post("/api/backup/pre-update")]
async fn pre_update_backup(state: web::Data<AppState>) -> impl Responder {
    let cfg = match db::load_config(&state.db).await {
        Ok(Some(c)) => c,
        _ => db::BackupConfig::default(),
    };
    if !cfg.pre_update_enabled {
        return HttpResponse::Ok()
            .json(serde_json::json!({"skipped": true, "reason": "pre_update disabled"}));
    }
    let opts = BackupOptions {
        include_databases: cfg.include_databases,
        include_docker_volumes: cfg.include_docker_volumes,
        include_system_config: cfg.include_system_config,
        include_user_data: cfg.include_user_data,
        include_apps: cfg.include_apps,
        backup_dir: None,
    };
    let engine = state.engine.clone();
    let name = format!("pre-update-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
    let res = web::block(move || engine.create_backup(&name, &opts)).await;
    match res {
        Ok(Ok(b)) => {
            let _ = db::insert_backup(&state.db, &b, "pre_update", "completed", None).await;
            HttpResponse::Ok().json(b)
        }
        Ok(Err(e)) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[get("/api/backup/scheduler/status")]
async fn scheduler_status(state: web::Data<AppState>) -> impl Responder {
    let last_run = *state.scheduler.last_run.read().await;
    let last_error = state.scheduler.last_error.read().await.clone();
    HttpResponse::Ok().json(serde_json::json!({
        "last_run": last_run,
        "last_error": last_error,
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let port: u16 = std::env::var("RUMAHL_BACKUP_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8084);

    let backup_dir: PathBuf = std::env::var("RUMAHL_BACKUP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/ora/backups"));
    let _ = std::fs::create_dir_all(&backup_dir);

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://ora:ora@127.0.0.1:5432/ora".to_string());

    let db = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            error!("failed to connect to Postgres ({database_url}): {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = db::init_schema(&db).await {
        error!("failed to init schema: {e}");
        std::process::exit(1);
    }

    let engine = Arc::new(BackupEngine::new(backup_dir.clone(), database_url.clone()));
    let scheduler = BackupScheduler::new(db.clone(), engine.clone());
    scheduler.clone().spawn();

    let _hb = rumahl_shared_heartbeat::spawn_default("rumahl-backup", port, "Backup & restore service");

    info!(
        "rumahl-backup listening on 0.0.0.0:{port}, backup_dir={}",
        backup_dir.display()
    );

    let state = web::Data::new(AppState {
        db,
        engine,
        backup_dir,
        scheduler,
    });

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .app_data(web::JsonConfig::default().limit(2 * 1024 * 1024))
            .service(health)
            .service(get_config)
            .service(update_config)
            .service(create_backup)
            .service(list_backups)
            .service(restore_backup)
            .service(pre_update_backup)
            .service(scheduler_status)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
