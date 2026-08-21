//! Monitored jobs for high-risk Linux MD RAID operations.

use crate::{
    auth::Claims,
    storage_inventory::{build_plan, parse_mdstat, RaidPlanRequest},
};
use axum::{
    extract::{Extension, Path},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct ExecuteRaidRequest {
    pub request: RaidPlanRequest,
    pub confirmation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageJob {
    pub id: String,
    pub kind: String,
    pub resource: String,
    pub status: String,
    pub progress_percent: f64,
    pub message: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

static JOBS: OnceLock<Mutex<HashMap<String, StorageJob>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, StorageJob>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn execute(
    Extension(claims): Extension<Claims>,
    Json(request): Json<ExecuteRaidRequest>,
) -> Result<(StatusCode, Json<StorageJob>), (StatusCode, Json<Value>)> {
    require_fresh_admin(&claims)?;
    let plan = build_plan(request.request).await?;
    if request.confirmation != plan.confirmation_phrase {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "The typed confirmation does not match the RAID operation plan",
        ));
    }
    if jobs().lock().unwrap().values().any(|job| {
        job.resource == plan.array && matches!(job.status.as_str(), "queued" | "running")
    }) {
        return Err(api_error(
            StatusCode::CONFLICT,
            "A RAID job is already active for this array",
        ));
    }
    for command in &plan.commands {
        if !command_available(&command.program).await {
            return Err(api_error(
                StatusCode::NOT_IMPLEMENTED,
                &format!("Required RAID tool '{}' is not installed", command.program),
            ));
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    let job = StorageJob {
        id: Uuid::new_v4().to_string(),
        kind: plan.operation.clone(),
        resource: plan.array.clone(),
        status: "queued".into(),
        progress_percent: 0.0,
        message: "RAID operation queued".into(),
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        error: None,
    };
    jobs().lock().unwrap().insert(job.id.clone(), job.clone());
    persist_jobs().await;
    let job_id = job.id.clone();
    tokio::spawn(async move {
        run_job(job_id, plan).await;
    });
    tracing::warn!(user_id = %claims.sub, username = %claims.username, job_id = %job.id, operation = %job.kind, array = %job.resource, "RAID write job accepted");
    Ok((StatusCode::ACCEPTED, Json(job)))
}

pub async fn list() -> Json<Value> {
    let mut values: Vec<_> = jobs().lock().unwrap().values().cloned().collect();
    values.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(json!({ "jobs": values }))
}

pub async fn initialize() {
    let path = jobs_path();
    let Ok(data) = tokio::fs::read(&path).await else {
        return;
    };
    let Ok(restored) = serde_json::from_slice::<Vec<StorageJob>>(&data) else {
        tracing::error!(%path, "Could not restore persisted storage jobs");
        return;
    };
    let active: Vec<_> = restored
        .iter()
        .filter(|job| matches!(job.status.as_str(), "queued" | "running"))
        .map(|job| {
            (
                job.id.clone(),
                job.resource.trim_start_matches("/dev/").to_string(),
            )
        })
        .collect();
    jobs()
        .lock()
        .unwrap()
        .extend(restored.into_iter().map(|job| (job.id.clone(), job)));
    for (id, array) in active {
        update(&id, |job| {
            job.status = "running".into();
            job.message = "Resumed kernel RAID monitoring after service restart".into();
        });
        tokio::spawn(async move { monitor_array(&id, &array).await });
    }
}

pub async fn get(Path(id): Path<String>) -> Result<Json<StorageJob>, (StatusCode, Json<Value>)> {
    jobs()
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .map(Json)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Storage job was not found"))
}

async fn run_job(id: String, plan: crate::storage_inventory::RaidOperationPlan) {
    update(&id, |job| {
        job.status = "running".into();
        job.message = "Starting validated RAID commands".into();
    });
    persist_jobs().await;
    for command in &plan.commands {
        let output = Command::new(&command.program)
            .args(&command.arguments)
            .output()
            .await;
        match output {
            Ok(output) if output.status.success() => {}
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                fail(
                    &id,
                    format!(
                        "RAID command failed with {}: {}",
                        output.status,
                        stderr.trim().chars().take(500).collect::<String>()
                    ),
                );
                persist_jobs().await;
                return;
            }
            Err(error) => {
                fail(&id, format!("Could not start RAID command: {error}"));
                persist_jobs().await;
                return;
            }
        }
    }
    monitor_array(&id, plan.array.trim_start_matches("/dev/")).await;
}

async fn monitor_array(id: &str, array: &str) {
    let mut saw_operation = false;
    for attempt in 0..10_080 {
        let mdstat = match tokio::fs::read_to_string("/proc/mdstat").await {
            Ok(value) => value,
            Err(error) => {
                fail(id, format!("Linux MD status became unavailable: {error}"));
                persist_jobs().await;
                return;
            }
        };
        let Some(current) = parse_mdstat(&mdstat)
            .into_iter()
            .find(|entry| entry.name == array)
        else {
            fail(
                id,
                "RAID array disappeared while the job was running".into(),
            );
            persist_jobs().await;
            return;
        };
        saw_operation |= current.operation.is_some();
        let progress = current
            .progress_percent
            .unwrap_or(if current.operation.is_some() {
                0.0
            } else if saw_operation {
                100.0
            } else {
                1.0
            });
        update(id, |job| {
            job.progress_percent = progress;
            job.message = current.operation.as_ref().map_or_else(
                || format!("Array state: {}", current.health),
                |operation| format!("RAID {operation} in progress"),
            );
        });
        persist_jobs().await;
        if current.operation.is_none() && (saw_operation || attempt >= 3) {
            if current.health == "healthy" {
                complete(id);
            } else {
                fail(id, format!("RAID operation stopped with array state '{}'; manual inspection is required", current.health));
            }
            persist_jobs().await;
            return;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    fail(id, "RAID monitoring timed out after 14 hours".into());
    persist_jobs().await;
}

fn update(id: &str, change: impl FnOnce(&mut StorageJob)) {
    if let Some(job) = jobs().lock().unwrap().get_mut(id) {
        change(job);
        job.updated_at = chrono::Utc::now().to_rfc3339();
    }
}
fn complete(id: &str) {
    update(id, |job| {
        job.status = "completed".into();
        job.progress_percent = 100.0;
        job.message = "RAID operation completed and the kernel reports a healthy array".into();
        job.completed_at = Some(chrono::Utc::now().to_rfc3339());
    });
}
fn fail(id: &str, error: String) {
    update(id, |job| {
        job.status = "failed".into();
        job.message = "RAID operation requires attention".into();
        job.error = Some(error);
        job.completed_at = Some(chrono::Utc::now().to_rfc3339());
    });
}
async fn persist_jobs() {
    let snapshot: Vec<_> = jobs().lock().unwrap().values().cloned().collect();
    let Ok(data) = serde_json::to_vec_pretty(&snapshot) else {
        return;
    };
    let path = jobs_path();
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let temporary = format!("{path}.tmp");
    if tokio::fs::write(&temporary, data).await.is_ok() {
        let _ = tokio::fs::rename(temporary, path).await;
    }
}
fn jobs_path() -> String {
    std::env::var("RUMAHL_STORAGE_JOBS_PATH")
        .unwrap_or_else(|_| "/var/lib/rumahl-control/storage-jobs.json".into())
}
async fn command_available(program: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {program} >/dev/null 2>&1")])
        .status()
        .await
        .is_ok_and(|status| status.success())
}
fn require_fresh_admin(claims: &Claims) -> Result<(), (StatusCode, Json<Value>)> {
    let age = chrono::Utc::now()
        .timestamp()
        .saturating_sub(claims.iat as i64);
    if !claims.is_admin {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "Administrator access is required",
        ))
    } else if claims.iat == 0 || age > 300 {
        Err(api_error(StatusCode::UNAUTHORIZED, "Fresh administrator authorization is required; sign in again before executing this operation"))
    } else {
        Ok(())
    }
}
fn api_error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message })))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_recent_admin_token() {
        let now = chrono::Utc::now().timestamp() as usize;
        let claims = Claims {
            sub: "1".into(),
            username: "admin".into(),
            role: String::new(),
            is_admin: true,
            exp: now + 3600,
            iat: now,
        };
        assert!(require_fresh_admin(&claims).is_ok());
        assert!(require_fresh_admin(&Claims {
            iat: now - 301,
            ..claims
        })
        .is_err());
    }
}
