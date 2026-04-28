//! App Scheduler Handler – Cron/scheduled task management for IORA apps.
//!
//! API endpoints:
//!   GET    /api/apps/:app_id/schedules       – List scheduled tasks
//!   POST   /api/apps/:app_id/schedules       – Create a scheduled task
//!   GET    /api/apps/:app_id/schedules/:id   – Get task details
//!   PUT    /api/apps/:app_id/schedules/:id   – Update a scheduled task
//!   DELETE /api/apps/:app_id/schedules/:id   – Delete a scheduled task
//!   POST   /api/apps/:app_id/schedules/:id/trigger – Manually trigger
//!   GET    /api/apps/:app_id/schedules/:id/logs – Get execution logs

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tracing::{info, warn};

use iora_shared::app_scheduler::*;

/// Scheduler data directory
const SCHEDULER_BASE_DIR: &str = "data/app-schedules";

#[derive(Clone)]
pub struct AppSchedulerState {
    pub base_dir: PathBuf,
}

impl AppSchedulerState {
    pub fn new() -> Self {
        Self {
            base_dir: PathBuf::from(SCHEDULER_BASE_DIR),
        }
    }

    fn tasks_path(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("tasks.json")
    }

    fn logs_path(&self, app_id: &str) -> PathBuf {
        self.base_dir.join(app_id).join("logs.json")
    }

    async fn load_tasks(&self, app_id: &str) -> Vec<ScheduledTask> {
        let path = self.tasks_path(app_id);
        if !path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    async fn save_tasks(&self, app_id: &str, tasks: &[ScheduledTask]) -> Result<(), String> {
        if let Some(parent) = self.tasks_path(app_id).parent() {
            fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string(tasks).map_err(|e| e.to_string())?;
        fs::write(self.tasks_path(app_id), &content).await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// List all scheduled tasks for an app
pub async fn list_schedules(
    State(state): State<Arc<AppSchedulerState>>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Vec<ScheduledTask>>, (StatusCode, String)> {
    let tasks = state.load_tasks(&app_id).await;
    Ok(Json(tasks))
}

/// Create a new scheduled task
pub async fn create_schedule(
    State(state): State<Arc<AppSchedulerState>>,
    AxumPath(app_id): AxumPath<String>,
    Json(req): Json<CreateScheduleRequest>,
) -> Result<Json<ScheduledTask>, (StatusCode, String)> {
    let mut tasks = state.load_tasks(&app_id).await;

    let task = ScheduledTask {
        id: uuid::Uuid::new_v4().to_string(),
        name: req.name,
        schedule_type: req.schedule_type,
        cron_expression: req.cron_expression,
        interval_seconds: req.interval_seconds,
        run_at: req.run_at,
        payload: req.payload,
        enabled: req.enabled,
        max_retries: req.max_retries,
        retry_delay_seconds: req.retry_delay_seconds,
        tags: req.tags,
    };

    tasks.push(task.clone());
    state.save_tasks(&app_id, &tasks).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    info!("Created schedule '{}' for app '{}'", task.id, app_id);
    Ok(Json(task))
}

/// Get a specific scheduled task
pub async fn get_schedule(
    State(state): State<Arc<AppSchedulerState>>,
    AxumPath((app_id, task_id)): AxumPath<(String, String)>,
) -> Result<Json<ScheduledTask>, (StatusCode, String)> {
    let tasks = state.load_tasks(&app_id).await;
    tasks.into_iter().find(|t| t.id == task_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Task '{}' not found", task_id)))
        .map(Json)
}

/// Update a scheduled task
pub async fn update_schedule(
    State(state): State<Arc<AppSchedulerState>>,
    AxumPath((app_id, task_id)): AxumPath<(String, String)>,
    Json(req): Json<UpdateScheduleRequest>,
) -> Result<Json<ScheduledTask>, (StatusCode, String)> {
    let mut tasks = state.load_tasks(&app_id).await;

    let task = tasks.iter_mut().find(|t| t.id == task_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Task '{}' not found", task_id)))?;

    if let Some(name) = req.name { task.name = name; }
    if let Some(st) = req.schedule_type { task.schedule_type = st; }
    if let Some(cron) = req.cron_expression { task.cron_expression = Some(cron); }
    if let Some(interval) = req.interval_seconds { task.interval_seconds = Some(interval); }
    if let Some(run_at) = req.run_at { task.run_at = Some(run_at); }
    if let Some(payload) = req.payload { task.payload = payload; }
    if let Some(enabled) = req.enabled { task.enabled = enabled; }
    if let Some(retries) = req.max_retries { task.max_retries = retries; }
    if let Some(delay) = req.retry_delay_seconds { task.retry_delay_seconds = delay; }
    if let Some(tags) = req.tags { task.tags = tags; }

    let updated = task.clone();
    state.save_tasks(&app_id, &tasks).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    info!("Updated schedule '{}' for app '{}'", task_id, app_id);
    Ok(Json(updated))
}

/// Delete a scheduled task
pub async fn delete_schedule(
    State(state): State<Arc<AppSchedulerState>>,
    AxumPath((app_id, task_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut tasks = state.load_tasks(&app_id).await;
    let before = tasks.len();
    tasks.retain(|t| t.id != task_id);

    if tasks.len() == before {
        return Err((StatusCode::NOT_FOUND, format!("Task '{}' not found", task_id)));
    }

    state.save_tasks(&app_id, &tasks).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    info!("Deleted schedule '{}' for app '{}'", task_id, app_id);
    Ok(Json(serde_json::json!({ "success": true, "deleted": task_id })))
}

/// Manually trigger a task
pub async fn trigger_schedule(
    State(state): State<Arc<AppSchedulerState>>,
    AxumPath((app_id, task_id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let tasks = state.load_tasks(&app_id).await;
    let task = tasks.into_iter().find(|t| t.id == task_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Task '{}' not found", task_id)))?;

    // Log the manual trigger
    let mut logs: Vec<TaskExecutionLog> = Vec::new();
    let logs_path = state.logs_path(&app_id);
    if logs_path.exists() {
        if let Ok(content) = fs::read_to_string(&logs_path).await {
            logs = serde_json::from_str(&content).unwrap_or_default();
        }
    }

    logs.push(TaskExecutionLog {
        task_id: task_id.clone(),
        executed_at: Utc::now().to_rfc3339(),
        success: true,
        duration_ms: 0,
        error: None,
        status_code: Some(200),
    });

    // Keep last 100 logs
    if logs.len() > 100 {
        logs = logs.split_off(logs.len() - 100);
    }

    if let Some(parent) = logs_path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    if let Ok(content) = serde_json::to_string(&logs) {
        let _ = fs::write(&logs_path, &content).await;
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Task '{}' triggered manually", task_id),
        "task": task,
    })))
}

/// Get execution logs for a task
pub async fn get_task_logs(
    State(state): State<Arc<AppSchedulerState>>,
    AxumPath((app_id, task_id)): AxumPath<(String, String)>,
) -> Result<Json<Vec<TaskExecutionLog>>, (StatusCode, String)> {
    let logs_path = state.logs_path(&app_id);
    if !logs_path.exists() {
        return Ok(Json(Vec::new()));
    }

    let content = fs::read_to_string(&logs_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read logs: {}", e)))?;

    let all_logs: Vec<TaskExecutionLog> = serde_json::from_str(&content).unwrap_or_default();
    let task_logs: Vec<TaskExecutionLog> = all_logs.into_iter()
        .filter(|l| l.task_id == task_id)
        .collect();

    Ok(Json(task_logs))
}
