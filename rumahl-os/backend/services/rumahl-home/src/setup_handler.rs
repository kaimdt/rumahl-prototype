use axum::{extract::State, Json};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

use crate::{auth, AppState, ErrorResponse};

const SETUP_SCOPE: &str = "os_initial_setup";
const PRIMARY_MARKER: &str = "/mnt/data/ora/.setup-complete";
const SECONDARY_MARKER: &str = "/etc/ora/.setup-complete";

#[derive(Debug, Serialize)]
pub struct SetupStatus {
    pub required: bool,
    pub completed: bool,
    pub owner_exists: bool,
    pub current_step: String,
    pub draft: Value,
}

#[derive(Debug, Deserialize)]
pub struct SaveSetupDraftRequest {
    pub current_step: String,
    #[serde(default)]
    pub draft: Value,
}

#[derive(Debug, Deserialize)]
pub struct CompleteSetupRequest {
    pub recovery_key: String,
    #[serde(default)]
    pub configuration: Value,
}

#[derive(Debug, Deserialize)]
pub struct RecoverOwnerRequest {
    pub recovery_key: String,
    pub new_password: String,
}

fn setup_is_complete() -> bool {
    rumahl_shared_config::env::RumahlEnv::is_setup_complete()
}

async fn owner_exists(state: &AppState) -> Result<bool, ErrorResponse> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE is_admin = TRUE")
        .fetch_one(&state.db_pool)
        .await
        .map_err(|error| {
            ErrorResponse::internal(format!("Failed to inspect setup owner: {error}"))
        })?;
    Ok(count > 0)
}

async fn read_setup_state(state: &AppState) -> Result<(String, Value), ErrorResponse> {
    let row: Option<(Value,)> = sqlx::query_as("SELECT data FROM home_state WHERE scope = $1")
        .bind(SETUP_SCOPE)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|error| ErrorResponse::internal(format!("Failed to load setup state: {error}")))?;
    let data = row.map(|entry| entry.0).unwrap_or_else(|| json!({}));
    let step = data
        .get("current_step")
        .and_then(Value::as_str)
        .unwrap_or("welcome")
        .to_string();
    let draft = data.get("draft").cloned().unwrap_or_else(|| json!({}));
    Ok((step, draft))
}

pub async fn status(State(state): State<AppState>) -> Result<Json<SetupStatus>, ErrorResponse> {
    let completed = setup_is_complete();
    let owner_exists = owner_exists(&state).await?;
    let (current_step, draft) = read_setup_state(&state).await?;
    Ok(Json(SetupStatus {
        required: !completed || !owner_exists,
        completed,
        owner_exists,
        current_step,
        draft,
    }))
}

pub async fn save_draft(
    State(state): State<AppState>,
    Json(request): Json<SaveSetupDraftRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    if setup_is_complete() {
        return Err(ErrorResponse::conflict("Initial setup is already complete"));
    }
    if request.current_step.len() > 64
        || !request
            .current_step
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(ErrorResponse::bad_request("Invalid setup step"));
    }
    let data = json!({
        "current_step": request.current_step,
        "draft": request.draft,
        "updated_at": chrono::Utc::now().to_rfc3339(),
    });
    sqlx::query(
        "INSERT INTO home_state (scope, data, updated_at) VALUES ($1, $2, NOW()) \
         ON CONFLICT (scope) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
    )
    .bind(SETUP_SCOPE)
    .bind(data)
    .execute(&state.db_pool)
    .await
    .map_err(|error| ErrorResponse::internal(format!("Failed to persist setup state: {error}")))?;
    Ok(Json(json!({ "saved": true })))
}

pub async fn recovery_key(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    if setup_is_complete() {
        return Err(ErrorResponse::conflict("Initial setup is already complete"));
    }
    if !owner_exists(&state).await? {
        return Err(ErrorResponse::bad_request(
            "Create the owner account before generating a recovery key",
        ));
    }
    let groups: Vec<String> = (0..6)
        .map(|_| {
            rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(6)
                .map(char::from)
                .collect::<String>()
                .to_uppercase()
        })
        .collect();
    Ok(Json(
        json!({ "recovery_key": format!("RUMAHL-{}", groups.join("-")) }),
    ))
}

fn write_completion_markers() -> Result<(), ErrorResponse> {
    let mut wrote_marker = false;
    for marker in [PRIMARY_MARKER, SECONDARY_MARKER] {
        let path = Path::new(marker);
        if let Some(parent) = path.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                continue;
            }
        }
        if std::fs::write(path, b"completed\n").is_ok() {
            wrote_marker = true;
        }
    }
    if !wrote_marker {
        return Err(ErrorResponse::internal(
            "Could not persist the OS setup completion marker",
        ));
    }
    Ok(())
}

pub async fn complete(
    State(state): State<AppState>,
    Json(request): Json<CompleteSetupRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    if setup_is_complete() {
        return Err(ErrorResponse::conflict("Initial setup is already complete"));
    }
    if !owner_exists(&state).await? {
        return Err(ErrorResponse::bad_request("An owner account is required"));
    }
    if !request.recovery_key.starts_with("RUMAHL-") || request.recovery_key.len() < 32 {
        return Err(ErrorResponse::bad_request("Invalid recovery key"));
    }

    let recovery_hash = auth::hash_password(&request.recovery_key).map_err(|error| {
        ErrorResponse::internal(format!("Failed to secure recovery key: {error}"))
    })?;
    let completed_state = json!({
        "current_step": "completed",
        "completed_at": chrono::Utc::now().to_rfc3339(),
        "configuration": request.configuration,
        "recovery_key_hash": recovery_hash,
    });

    let mut transaction = state.db_pool.begin().await.map_err(|error| {
        ErrorResponse::internal(format!("Failed to start setup transaction: {error}"))
    })?;
    sqlx::query(
        "INSERT INTO home_state (scope, data, updated_at) VALUES ($1, $2, NOW()) \
         ON CONFLICT (scope) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
    )
    .bind(SETUP_SCOPE)
    .bind(completed_state)
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        ErrorResponse::internal(format!("Failed to persist completed setup: {error}"))
    })?;

    transaction.commit().await.map_err(|error| {
        ErrorResponse::internal(format!("Failed to commit completed setup: {error}"))
    })?;
    write_completion_markers()?;
    Ok(Json(json!({ "completed": true })))
}

pub async fn recover_owner(
    State(state): State<AppState>,
    Json(request): Json<RecoverOwnerRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    if request.new_password.len() < 8 {
        return Err(ErrorResponse::bad_request(
            "The new password must contain at least 8 characters",
        ));
    }
    let row: Option<(Value,)> = sqlx::query_as("SELECT data FROM home_state WHERE scope = $1")
        .bind(SETUP_SCOPE)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|error| {
            ErrorResponse::internal(format!("Failed to load recovery configuration: {error}"))
        })?;
    let recovery_hash = row
        .and_then(|entry| {
            entry
                .0
                .get("recovery_key_hash")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .ok_or_else(|| ErrorResponse::unauthorized("Invalid recovery key"))?;
    let valid = auth::verify_password(&request.recovery_key, &recovery_hash).map_err(|error| {
        ErrorResponse::internal(format!("Failed to verify recovery key: {error}"))
    })?;
    if !valid {
        return Err(ErrorResponse::unauthorized("Invalid recovery key"));
    }
    let password_hash = auth::hash_password(&request.new_password).map_err(|error| {
        ErrorResponse::internal(format!("Failed to secure new password: {error}"))
    })?;
    let result = sqlx::query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = (\
         SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC LIMIT 1)",
    )
    .bind(password_hash)
    .execute(&state.db_pool)
    .await
    .map_err(|error| ErrorResponse::internal(format!("Failed to reset owner password: {error}")))?;
    if result.rows_affected() != 1 {
        return Err(ErrorResponse::internal("Owner account is unavailable"));
    }
    Ok(Json(json!({ "recovered": true })))
}
