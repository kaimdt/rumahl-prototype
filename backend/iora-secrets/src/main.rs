use std::{sync::Arc, time::Instant};

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::{SaltString, PasswordHash};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::Utc;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use uuid::Uuid;

type DbPool = PgPool;

// ─── State ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db: Arc<DbPool>,
    master_key: Arc<[u8; 32]>,
    started_at: Arc<Instant>,
}

// ─── Data Structures ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Secret {
    id: Uuid,
    name: String,
    description: Option<String>,
    secret_type: String,
    allowed_services: Vec<String>,
    expires_at: Option<String>,
    created_at: String,
    updated_at: String,
    created_by: Option<String>,
    rotation_count: i32,
    last_rotated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateSecretRequest {
    name: String,
    description: Option<String>,
    value: String,
    secret_type: String,
    allowed_services: Option<Vec<String>>,
    expires_at: Option<String>,
    created_by: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateSecretRequest {
    description: Option<String>,
    value: Option<String>,
    allowed_services: Option<Vec<String>>,
    expires_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct SecretValue {
    id: Uuid,
    name: String,
    value: String,
    secret_type: String,
}

#[derive(Debug, Serialize)]
struct AccessLogEntry {
    id: i32,
    secret_id: Uuid,
    service_name: String,
    access_type: String,
    success: bool,
    error_message: Option<String>,
    timestamp: String,
}

// ─── Encryption ──────────────────────────────────────────────────────────────

fn encrypt_value(master_key: &[u8; 32], plaintext: &str) -> Result<(Vec<u8>, Vec<u8>)> {
    let cipher = Aes256Gcm::new(master_key.into());

    // Generate random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

fn decrypt_value(master_key: &[u8; 32], ciphertext: &[u8], nonce: &[u8]) -> Result<String> {
    let cipher = Aes256Gcm::new(master_key.into());
    let nonce = Nonce::from_slice(nonce);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).context("Invalid UTF-8 in decrypted value")
}

// ─── Audit Logging ───────────────────────────────────────────────────────────

async fn log_access(
    db: &DbPool,
    secret_id: Uuid,
    service_name: &str,
    access_type: &str,
    success: bool,
    error_message: Option<&str>,
) {
    let result = sqlx::query(
        "INSERT INTO secret_access_log (secret_id, service_name, access_type, success, error_message)
         VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(secret_id)
    .bind(service_name)
    .bind(access_type)
    .bind(success)
    .bind(error_message)
    .execute(db)
    .await;

    if let Err(e) = result {
        error!("Failed to log access: {}", e);
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "iora-secrets",
        "status": "healthy",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
        "encryption": "aes-256-gcm",
    }))
}

async fn create_secret(
    State(state): State<AppState>,
    Json(req): Json<CreateSecretRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Encrypt the secret value
    let (encrypted_value, nonce) = encrypt_value(&state.master_key, &req.value)
        .map_err(|e| AppError::Internal(format!("Encryption failed: {}", e)))?;

    let allowed_services = serde_json::to_value(req.allowed_services.unwrap_or_default())
        .map_err(|e| AppError::Internal(format!("JSON serialization failed: {}", e)))?;

    let expires_at = req.expires_at.as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.naive_utc());

    let id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO secrets (id, name, description, encrypted_value, encryption_nonce,
         secret_type, allowed_services, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
    )
    .bind(id)
    .bind(&req.name)
    .bind(&req.description)
    .bind(&encrypted_value)
    .bind(&nonce)
    .bind(&req.secret_type)
    .bind(&allowed_services)
    .bind(expires_at)
    .bind(&req.created_by)
    .execute(&*state.db)
    .await
    .map_err(|e| {
        if e.to_string().contains("unique") {
            AppError::Conflict("Secret with this name already exists".to_string())
        } else {
            AppError::Database(e)
        }
    })?;

    log_access(&state.db, id, "system", "create", true, None).await;

    info!("Created secret: {} (type: {})", req.name, req.secret_type);

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "name": req.name,
            "message": "Secret created successfully"
        })),
    ))
}

async fn list_secrets(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        "SELECT id, name, description, secret_type, allowed_services, expires_at,
         created_at, updated_at, created_by, rotation_count, last_rotated_at
         FROM secrets ORDER BY created_at DESC"
    )
    .fetch_all(&*state.db)
    .await
    .map_err(AppError::Database)?;

    let secrets: Vec<Secret> = rows
        .into_iter()
        .map(|row| Secret {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            secret_type: row.get("secret_type"),
            allowed_services: serde_json::from_value(row.get("allowed_services")).unwrap_or_default(),
            expires_at: row.get::<Option<chrono::NaiveDateTime>, _>("expires_at")
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string()),
            created_at: row.get::<chrono::NaiveDateTime, _>("created_at").format("%Y-%m-%dT%H:%M:%S").to_string(),
            updated_at: row.get::<chrono::NaiveDateTime, _>("updated_at").format("%Y-%m-%dT%H:%M:%S").to_string(),
            created_by: row.get("created_by"),
            rotation_count: row.get("rotation_count"),
            last_rotated_at: row.get::<Option<chrono::NaiveDateTime>, _>("last_rotated_at")
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string()),
        })
        .collect();

    Ok(Json(serde_json::json!({
        "secrets": secrets,
        "total": secrets.len(),
    })))
}

async fn get_secret(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query(
        "SELECT id, name, encrypted_value, encryption_nonce, secret_type, allowed_services
         FROM secrets WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&*state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or(AppError::NotFound("Secret not found".to_string()))?;

    let encrypted_value: Vec<u8> = row.get("encrypted_value");
    let nonce: Vec<u8> = row.get("encryption_nonce");

    // Decrypt the value
    let decrypted_value = decrypt_value(&state.master_key, &encrypted_value, &nonce)
        .map_err(|e| {
            log_access(&state.db, id, "system", "read", false, Some(&e.to_string()));
            AppError::Internal(format!("Decryption failed: {}", e))
        })?;

    log_access(&state.db, id, "system", "read", true, None).await;

    Ok(Json(SecretValue {
        id: row.get("id"),
        name: row.get("name"),
        value: decrypted_value,
        secret_type: row.get("secret_type"),
    }))
}

async fn update_secret(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateSecretRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Check if secret exists
    let exists = sqlx::query("SELECT id FROM secrets WHERE id = $1")
        .bind(id)
        .fetch_optional(&*state.db)
        .await
        .map_err(AppError::Database)?
        .is_some();

    if !exists {
        return Err(AppError::NotFound("Secret not found".to_string()));
    }

    // Update description and allowed_services if provided
    if req.description.is_some() || req.allowed_services.is_some() {
        let allowed_services = req.allowed_services.as_ref()
            .map(|v| serde_json::to_value(v).unwrap_or(serde_json::json!([])))
            .unwrap_or_else(|| serde_json::json!(null));

        sqlx::query(
            "UPDATE secrets SET description = COALESCE($1, description),
             allowed_services = COALESCE($2, allowed_services)
             WHERE id = $3"
        )
        .bind(&req.description)
        .bind(allowed_services)
        .bind(id)
        .execute(&*state.db)
        .await
        .map_err(AppError::Database)?;
    }

    // Update value if provided
    if let Some(new_value) = req.value {
        let (encrypted_value, nonce) = encrypt_value(&state.master_key, &new_value)
            .map_err(|e| AppError::Internal(format!("Encryption failed: {}", e)))?;

        sqlx::query(
            "UPDATE secrets SET encrypted_value = $1, encryption_nonce = $2 WHERE id = $3"
        )
        .bind(&encrypted_value)
        .bind(&nonce)
        .bind(id)
        .execute(&*state.db)
        .await
        .map_err(AppError::Database)?;
    }

    log_access(&state.db, id, "system", "update", true, None).await;

    Ok(Json(serde_json::json!({
        "id": id,
        "message": "Secret updated successfully"
    })))
}

async fn delete_secret(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query("DELETE FROM secrets WHERE id = $1")
        .bind(id)
        .execute(&*state.db)
        .await
        .map_err(AppError::Database)?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Secret not found".to_string()));
    }

    log_access(&state.db, id, "system", "delete", true, None).await;

    Ok(Json(serde_json::json!({
        "message": "Secret deleted successfully"
    })))
}

async fn rotate_secret(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<serde_json::Value>,
) -> Result<impl IntoResponse, AppError> {
    let new_value = req.get("value")
        .and_then(|v| v.as_str())
        .ok_or(AppError::BadRequest("Missing 'value' field".to_string()))?;

    let (encrypted_value, nonce) = encrypt_value(&state.master_key, new_value)
        .map_err(|e| AppError::Internal(format!("Encryption failed: {}", e)))?;

    let result = sqlx::query(
        "UPDATE secrets SET encrypted_value = $1, encryption_nonce = $2,
         rotation_count = rotation_count + 1, last_rotated_at = NOW()
         WHERE id = $3"
    )
    .bind(&encrypted_value)
    .bind(&nonce)
    .bind(id)
    .execute(&*state.db)
    .await
    .map_err(AppError::Database)?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Secret not found".to_string()));
    }

    log_access(&state.db, id, "system", "rotate", true, None).await;

    Ok(Json(serde_json::json!({
        "id": id,
        "message": "Secret rotated successfully"
    })))
}

async fn get_audit_log(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        "SELECT id, secret_id, service_name, access_type, success, error_message, timestamp
         FROM secret_access_log WHERE secret_id = $1 ORDER BY timestamp DESC LIMIT 100"
    )
    .bind(id)
    .fetch_all(&*state.db)
    .await
    .map_err(AppError::Database)?;

    let logs: Vec<AccessLogEntry> = rows
        .into_iter()
        .map(|row| AccessLogEntry {
            id: row.get("id"),
            secret_id: row.get("secret_id"),
            service_name: row.get("service_name"),
            access_type: row.get("access_type"),
            success: row.get("success"),
            error_message: row.get("error_message"),
            timestamp: row.get::<chrono::NaiveDateTime, _>("timestamp").format("%Y-%m-%dT%H:%M:%S").to_string(),
        })
        .collect();

    Ok(Json(serde_json::json!({
        "logs": logs,
        "total": logs.len(),
    })))
}

// ─── Error Handling ──────────────────────────────────────────────────────────

#[derive(Debug)]
enum AppError {
    Database(sqlx::Error),
    NotFound(String),
    Conflict(String),
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            AppError::Database(e) => {
                error!("Database error: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
            }
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Internal(msg) => {
                error!("Internal error: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
        };

        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    // Load master key from environment
    let master_key_hex = std::env::var("SECRETS_MASTER_KEY")
        .context("SECRETS_MASTER_KEY environment variable must be set")?;

    let master_key_bytes = hex::decode(&master_key_hex)
        .context("SECRETS_MASTER_KEY must be a valid hex string")?;

    if master_key_bytes.len() != 32 {
        anyhow::bail!("SECRETS_MASTER_KEY must be exactly 32 bytes (64 hex characters)");
    }

    let mut master_key = [0u8; 32];
    master_key.copy_from_slice(&master_key_bytes);

    // Connect to database
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://iora:iora_password@localhost:5432/iora_secrets".to_string());

    info!("Connecting to database...");
    let db = PgPool::connect(&database_url)
        .await
        .context("Failed to connect to database")?;

    // Run migrations
    info!("Running migrations...");
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .context("Failed to run migrations")?;

    let state = AppState {
        db: Arc::new(db),
        master_key: Arc::new(master_key),
        started_at: Arc::new(Instant::now()),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/secrets", post(create_secret).get(list_secrets))
        .route("/api/secrets/:id", get(get_secret).put(update_secret).delete(delete_secret))
        .route("/api/secrets/:id/rotate", post(rotate_secret))
        .route("/api/secrets/:id/audit", get(get_audit_log))
        .layer(CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8093".to_string());
    let addr = format!("0.0.0.0:{}", port);

    info!("🔐 iora-secrets starting on {}", addr);
    info!("Master key loaded successfully");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
