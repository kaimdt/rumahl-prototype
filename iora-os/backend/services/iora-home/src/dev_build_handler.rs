//! Frontend rebuild endpoint (dev) — Package 0/9 admin tooling.
//!
//! `POST /api/admin/dev/build-frontend` (admin only) runs `npm run build`
//! in the frontend source directory as a system job, so the Admin Center
//! gets a "rebuild frontend" button that works on dev VMs (source mode)
//! and shows its progress in the Job Center.

use std::process::Stdio;

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::middleware::AuthIdentity;
use crate::{AppState, ErrorResponse};

/// POST /api/admin/dev/build-frontend — rebuild the frontend as a job.
pub async fn build_frontend(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthIdentity>,
) -> Result<(StatusCode, Json<Value>), ErrorResponse> {
    if !identity.is_admin() {
        return Err(ErrorResponse::forbidden("admin required"));
    }

    let frontend_dir = std::env::var("IORA_FRONTEND_DIR")
        .unwrap_or_else(|_| "/home/iora/iora/frontend".to_string());
    if !std::path::Path::new(&frontend_dir)
        .join("package.json")
        .exists()
    {
        return Err(ErrorResponse::bad_request(format!(
            "frontend dir '{frontend_dir}' has no package.json — is this a dev VM?"
        )));
    }

    let job_id = Uuid::new_v4().to_string();
    let job_id_spawn = job_id.clone();
    sqlx::query(
        "INSERT INTO system_jobs (id, name, job_type, status, progress, message, source, created_by) \
         VALUES ($1, 'Frontend rebuild', 'build', 'queued', 0, '', 'dev', $2)",
    )
    .bind(&job_id)
    .bind(identity.user_id())
    .execute(&state.db_pool)
    .await
    .map_err(|e| ErrorResponse::internal(format!("failed to create build job: {e}")))?;

    let db = state.db_pool.clone();
    tokio::spawn(async move {
        let _ = sqlx::query(
            "UPDATE system_jobs SET status = 'running', progress = 10, started_at = NOW(), updated_at = NOW() WHERE id = $1",
        )
        .bind(&job_id_spawn)
        .execute(&db)
        .await;

        let result = tokio::process::Command::new("npm")
            .args(["run", "build"])
            .current_dir(&frontend_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match result {
            Ok(output) if output.status.success() => {
                let _ = sqlx::query(
                    "UPDATE system_jobs SET status = 'completed', progress = 100, \
                     message = 'Frontend rebuilt successfully', finished_at = NOW(), updated_at = NOW() WHERE id = $1",
                )
                .bind(&job_id_spawn)
                .execute(&db)
                .await;
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let tail: String = stderr.lines().rev().take(15).collect::<Vec<_>>().join("\n");
                let _ = sqlx::query(
                    "UPDATE system_jobs SET status = 'failed', progress = 0, \
                     message = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1",
                )
                .bind(&job_id_spawn)
                .bind(format!("npm run build failed: {}", tail.trim()))
                .execute(&db)
                .await;
            }
            Err(e) => {
                let _ = sqlx::query(
                    "UPDATE system_jobs SET status = 'failed', progress = 0, \
                     message = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1",
                )
                .bind(&job_id_spawn)
                .bind(format!("npm run build error: {e}"))
                .execute(&db)
                .await;
            }
        }
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "job_id": job_id, "status": "queued" })),
    ))
}
