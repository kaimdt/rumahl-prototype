//! System Job Manager Handler – system-wide background jobs.
//!
//! Downloads, file operations, backups, imports and updates run as jobs that
//! survive app switches. This module provides the Job Center REST API:
//!
//!   GET    /api/jobs                 – List jobs (optional ?status= filter)
//!   GET    /api/jobs/:id             – Job details
//!   POST   /api/jobs                 – Create a job (queued)
//!   POST   /api/jobs/:id/progress    – Advance progress / message / status
//!   POST   /api/jobs/:id/pause       – Pause a running job
//!   POST   /api/jobs/:id/resume      – Resume a paused job
//!   POST   /api/jobs/:id/cancel      – Cancel a queued/running/paused job
//!   DELETE /api/jobs/:id             – Remove a single job
//!   DELETE /api/jobs                 – Bulk cleanup of terminal jobs
//!
//! Executing components (background tasks, apps via the `ora.jobs` SDK)
//! call `/api/jobs/:id/progress` to keep the record fresh. Status transitions
//! are validated: only queued/running can pause, only paused can resume,
//! terminal states are final.

use axum::{
    extract::{Extension, Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::warn;
use uuid::Uuid;

use iora_shared::system_jobs::{CreateJobRequest, JobStatus, UpdateJobRequest};

use crate::db::DbPool;
use crate::middleware::AuthIdentity;
use crate::{AppState, ErrorResponse};

/// Row layout: id, name, job_type, status, progress, message, source,
/// metadata, created_by, created_at, started_at, finished_at, updated_at.
type JobRow = (
    String,
    String,
    String,
    String,
    i32,
    String,
    String,
    Value,
    String,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
);

const JOB_SELECT: &str = "SELECT id, name, job_type, status, progress, message, source, metadata, \
                          created_by, created_at, started_at, finished_at, updated_at \
                          FROM system_jobs";

fn row_to_value(row: &JobRow) -> Value {
    json!({
        "id": row.0,
        "name": row.1,
        "job_type": row.2,
        "status": row.3,
        "progress": row.4,
        "message": row.5,
        "source": row.6,
        "metadata": row.7,
        "created_by": row.8,
        "created_at": row.9,
        "started_at": row.10,
        "finished_at": row.11,
        "updated_at": row.12,
    })
}

/// GET /api/jobs?status=running
pub async fn list_jobs(
    State(state): State<AppState>,
    Query(params): Query<JobListParams>,
) -> Result<Json<Value>, ErrorResponse> {
    let result = match params.status {
        Some(status) if !status.trim().is_empty() => {
            sqlx::query_as::<_, JobRow>(&format!(
                "{JOB_SELECT} WHERE status = $1 ORDER BY created_at DESC LIMIT 100"
            ))
            .bind(status)
            .fetch_all(&state.db_pool)
            .await
        }
        _ => {
            sqlx::query_as::<_, JobRow>(&format!("{JOB_SELECT} ORDER BY created_at DESC LIMIT 100"))
                .fetch_all(&state.db_pool)
                .await
        }
    };

    match result {
        Ok(rows) => {
            let jobs: Vec<Value> = rows.iter().map(row_to_value).collect();
            Ok(Json(json!({ "jobs": jobs })))
        }
        Err(e) => {
            warn!("Failed to list system jobs: {}", e);
            Err(ErrorResponse::internal(format!("failed to list jobs: {e}")))
        }
    }
}

/// GET /api/jobs/:id
pub async fn get_job(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let row = sqlx::query_as::<_, JobRow>(&format!("{JOB_SELECT} WHERE id = $1"))
        .bind(&id)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to load job: {e}")))?;

    match row {
        Some(row) => Ok(Json(row_to_value(&row))),
        None => Err(ErrorResponse::not_found(format!("job {id} not found"))),
    }
}

/// POST /api/jobs
pub async fn create_job(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
    Json(body): Json<CreateJobRequest>,
) -> Result<(StatusCode, Json<Value>), ErrorResponse> {
    let id = Uuid::new_v4().to_string();
    let created_by = identity.user_id().to_string();
    let metadata = if body.metadata.is_null() {
        json!({})
    } else {
        body.metadata
    };

    let result = sqlx::query(
        "INSERT INTO system_jobs (id, name, job_type, status, progress, message, source, metadata, created_by) \
         VALUES ($1, $2, $3, 'queued', 0, '', $4, $5, $6)",
    )
    .bind(&id)
    .bind(&body.name)
    .bind(&body.job_type)
    .bind(&body.source)
    .bind(&metadata)
    .bind(&created_by)
    .execute(&state.db_pool)
    .await;

    match result {
        Ok(_) => {
            let row = sqlx::query_as::<_, JobRow>(&format!("{JOB_SELECT} WHERE id = $1"))
                .bind(&id)
                .fetch_one(&state.db_pool)
                .await
                .map_err(|e| ErrorResponse::internal(format!("failed to reload job: {e}")))?;
            Ok((StatusCode::CREATED, Json(row_to_value(&row))))
        }
        Err(e) => {
            warn!("Failed to create system job: {}", e);
            Err(ErrorResponse::internal(format!(
                "failed to create job: {e}"
            )))
        }
    }
}

/// POST /api/jobs/:id/progress
pub async fn update_job_progress(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<UpdateJobRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    let current = load_job(&state.db_pool, &id).await?;
    let Some(current) = current else {
        return Err(ErrorResponse::not_found(format!("job {id} not found")));
    };

    let mut status = current.3.clone();
    let mut started_at = current.10;
    let mut finished_at = current.11;

    if let Some(next) = &body.status {
        if let Some(parsed) = JobStatus::from_str(next) {
            // Terminal states are final; reject transitions away from them.
            let current_status = JobStatus::from_str(&status).unwrap_or(JobStatus::Queued);
            if !current_status.is_terminal() {
                status = parsed.as_str().to_string();
                if parsed == JobStatus::Running && started_at.is_none() {
                    started_at = Some(Utc::now());
                }
                if parsed.is_terminal() && finished_at.is_none() {
                    finished_at = Some(Utc::now());
                }
            }
        }
    }

    let progress = body.progress.unwrap_or(current.4).clamp(0, 100);
    let message = body.message.unwrap_or(current.5);

    sqlx::query(
        "UPDATE system_jobs SET status = $1, progress = $2, message = $3, \
         started_at = $4, finished_at = $5, updated_at = NOW() WHERE id = $6",
    )
    .bind(&status)
    .bind(progress)
    .bind(&message)
    .bind(started_at)
    .bind(finished_at)
    .bind(&id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to update job: {e}")))?;

    let updated = load_job(&state.db_pool, &id)
        .await?
        .ok_or_else(|| ErrorResponse::not_found(format!("job {id} not found")))?;
    Ok(Json(row_to_value(&updated)))
}

/// POST /api/jobs/:id/pause
pub async fn pause_job(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    transition_job(&state, &id, JobStatus::Paused).await
}

/// POST /api/jobs/:id/resume
pub async fn resume_job(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    transition_job(&state, &id, JobStatus::Running).await
}

/// POST /api/jobs/:id/cancel
pub async fn cancel_job(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    transition_job(&state, &id, JobStatus::Cancelled).await
}

/// Shared state-machine transition for pause/resume/cancel.
async fn transition_job(
    state: &AppState,
    id: &str,
    target: JobStatus,
) -> Result<Json<Value>, ErrorResponse> {
    let current = load_job(&state.db_pool, id).await?;
    let Some(current) = current else {
        return Err(ErrorResponse::not_found(format!("job {id} not found")));
    };

    let current_status = JobStatus::from_str(&current.3).unwrap_or(JobStatus::Queued);
    // Guard invalid transitions (e.g. resume a completed job, cancel a
    // completed job).
    let allowed = match target {
        JobStatus::Paused => matches!(current_status, JobStatus::Queued | JobStatus::Running),
        JobStatus::Running => matches!(current_status, JobStatus::Queued | JobStatus::Paused),
        JobStatus::Cancelled => !current_status.is_terminal(),
        _ => false,
    };
    if !allowed {
        return Err(ErrorResponse::conflict(format!(
            "cannot transition job {id} from {} to {}",
            current_status.as_str(),
            target.as_str()
        )));
    }

    let mut started_at = current.10;
    let finished_at = if target.is_terminal() {
        Some(Utc::now())
    } else {
        None
    };
    if target == JobStatus::Running && started_at.is_none() {
        started_at = Some(Utc::now());
    }

    sqlx::query(
        "UPDATE system_jobs SET status = $1, started_at = $2, finished_at = $3, updated_at = NOW() WHERE id = $4",
    )
    .bind(target.as_str())
    .bind(started_at)
    .bind(finished_at)
    .bind(id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to transition job: {e}")))?;

    let updated = load_job(&state.db_pool, id)
        .await?
        .ok_or_else(|| ErrorResponse::not_found(format!("job {id} not found")))?;
    Ok(Json(row_to_value(&updated)))
}

/// DELETE /api/jobs/:id
pub async fn delete_job(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let affected = sqlx::query("DELETE FROM system_jobs WHERE id = $1")
        .bind(&id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to delete job: {e}")))?
        .rows_affected();

    Ok(Json(json!({ "deleted": affected > 0 })))
}

/// DELETE /api/jobs — remove all terminal jobs (completed/failed/cancelled).
pub async fn cleanup_jobs(State(state): State<AppState>) -> Result<Json<Value>, ErrorResponse> {
    let affected =
        sqlx::query("DELETE FROM system_jobs WHERE status IN ('completed', 'failed', 'cancelled')")
            .execute(&state.db_pool)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to clean up jobs: {e}")))?
            .rows_affected();

    Ok(Json(json!({ "deleted": affected })))
}

async fn load_job(pool: &DbPool, id: &str) -> Result<Option<JobRow>, ErrorResponse> {
    sqlx::query_as::<_, JobRow>(&format!("{JOB_SELECT} WHERE id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to load job: {e}")))
}

#[derive(Deserialize)]
pub struct JobListParams {
    pub status: Option<String>,
}
