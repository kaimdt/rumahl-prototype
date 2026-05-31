use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{LazyLock, Mutex},
    time::Duration,
};

use crate::{AppState, ErrorResponse};

static RUNTIME: LazyLock<AppRuntimeState> = LazyLock::new(AppRuntimeState::default);

#[derive(Default)]
struct AppRuntimeState {
    jobs: Mutex<HashMap<String, AppRuntimeJob>>,
    queues: Mutex<HashMap<String, VecDeque<String>>>,
    queue_workers: Mutex<HashSet<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppRuntimeJob {
    pub id: String,
    pub app_id: String,
    pub action: String,
    pub mode: AppRunMode,
    pub status: AppRuntimeStatus,
    pub payload: Value,
    pub target_url: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub logs: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppRunMode {
    Queued,
    Parallel,
}

impl Default for AppRunMode {
    fn default() -> Self {
        Self::Queued
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppRuntimeStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Deserialize)]
pub struct AppRunRequest {
    pub action: String,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub mode: AppRunMode,
    #[serde(default)]
    pub target_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AppHttpRequest {
    pub url: String,
    #[serde(default = "default_http_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

fn default_http_method() -> String {
    "GET".to_string()
}

fn default_timeout_secs() -> u64 {
    30
}

pub async fn app_integrations(State(state): State<AppState>) -> Json<Value> {
    let apps = state.local_appstore.list().await;
    let integrations: Vec<Value> = apps
        .into_iter()
        .filter_map(|app| {
            let extra = &app.manifest.extra;
            let declared = extra.get("integrations").cloned().unwrap_or(json!([]));
            let mut surfaces = Vec::new();
            if !app.custom_pages.is_empty() {
                surfaces.push("navigation");
                surfaces.push("pages");
            }
            if extra.get("widgets").is_some() || extra.get("dashboard_widgets").is_some() {
                surfaces.push("widgets");
            }
            if extra.get("assist").is_some() {
                surfaces.push("assist");
            }
            if extra.get("webhooks").is_some() {
                surfaces.push("webhooks");
            }
            if extra.get("messaging").is_some() {
                surfaces.push("messaging");
            }
            if extra.get("schedules").is_some() {
                surfaces.push("scheduler");
            }
            if extra.get("storage").is_some() {
                surfaces.push("storage");
            }
            if extra.get("database").is_some() {
                surfaces.push("database");
            }
            if extra.get("external_apis").is_some() || extra.get("network_access").is_some() {
                surfaces.push("external_apis");
            }
            surfaces.sort_unstable();
            surfaces.dedup();

            if surfaces.is_empty() && declared.as_array().is_none_or(|items| items.is_empty()) {
                return None;
            }

            let granted_permissions: Vec<String> = app
                .permission_grants
                .iter()
                .filter(|grant| grant.is_active)
                .map(|grant| grant.permission.clone())
                .collect();

            Some(json!({
                "id": app.id,
                "name": app.name,
                "version": app.version,
                "developer": app.developer,
                "description": app.description,
                "icon": app.icon,
                "kind": app.kind,
                "enabled": app.enabled,
                "status": app.status,
                "surfaces": surfaces,
                "integrations": declared,
                "custom_pages": app.custom_pages,
                "capabilities": extra.get("capabilities").cloned().unwrap_or(json!({})),
                "granted_permissions": granted_permissions,
                "denied_permissions": app.denied_permissions,
            }))
        })
        .collect();
    let total = integrations.len();
    Json(json!({ "integrations": integrations, "total": total }))
}

pub async fn app_capabilities(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    let app = find_app(&state, &app_id).await?;
    Ok(Json(json!({
        "app_id": app.id,
        "kind": app.kind,
        "manifest_permissions": app.manifest.permissions,
        "granted_permissions": app.permission_grants,
        "denied_permissions": app.denied_permissions,
        "capabilities": app.manifest.extra.get("capabilities").cloned().unwrap_or(json!({})),
        "integrations": app.manifest.extra.get("integrations").cloned().unwrap_or(json!([])),
        "external_apis": app.manifest.extra.get("external_apis").cloned().unwrap_or(json!([])),
    })))
}

pub async fn list_jobs(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    ensure_app_exists(&state, &app_id).await?;
    let jobs: Vec<AppRuntimeJob> = RUNTIME
        .jobs
        .lock()
        .unwrap()
        .values()
        .filter(|job| job.app_id == app_id)
        .cloned()
        .collect();
    Ok(Json(json!({ "jobs": jobs, "total": jobs.len() })))
}

pub async fn get_job(
    State(state): State<AppState>,
    Path((app_id, job_id)): Path<(String, String)>,
) -> Result<Json<AppRuntimeJob>, ErrorResponse> {
    ensure_app_exists(&state, &app_id).await?;
    let job = RUNTIME
        .jobs
        .lock()
        .unwrap()
        .get(&job_id)
        .filter(|job| job.app_id == app_id)
        .cloned()
        .ok_or_else(|| ErrorResponse::not_found(format!("job '{}' not found", job_id)))?;
    Ok(Json(job))
}

pub async fn run_job(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(req): Json<AppRunRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "AppActionExecute").await?;
    if req.action.trim().is_empty() {
        return Err(ErrorResponse::bad_request("action is required"));
    }
    if req.target_url.is_some() {
        require_permission(&state, &app_id, "ExternalHttpRequest").await?;
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    let job = AppRuntimeJob {
        id: job_id.clone(),
        app_id: app_id.clone(),
        action: req.action,
        mode: req.mode,
        status: if req.mode == AppRunMode::Queued {
            AppRuntimeStatus::Queued
        } else {
            AppRuntimeStatus::Running
        },
        payload: req.payload,
        target_url: req.target_url,
        created_at: now_iso(),
        started_at: None,
        finished_at: None,
        result: None,
        error: None,
        logs: vec!["Job accepted by IORA app runtime".to_string()],
    };

    RUNTIME.jobs.lock().unwrap().insert(job_id.clone(), job.clone());

    match req.mode {
        AppRunMode::Parallel => spawn_job(state, app_id, job_id.clone()),
        AppRunMode::Queued => {
            RUNTIME
                .queues
                .lock()
                .unwrap()
                .entry(app_id.clone())
                .or_default()
                .push_back(job_id.clone());
            spawn_queue_worker(state, app_id);
        }
    }

    Ok(Json(json!({ "success": true, "job": job })))
}

pub async fn cancel_job(
    State(state): State<AppState>,
    Path((app_id, job_id)): Path<(String, String)>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "AppQueueManage").await?;
    let mut jobs = RUNTIME.jobs.lock().unwrap();
    let job = jobs
        .get_mut(&job_id)
        .filter(|job| job.app_id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("job '{}' not found", job_id)))?;
    if matches!(job.status, AppRuntimeStatus::Queued) {
        job.status = AppRuntimeStatus::Canceled;
        job.finished_at = Some(now_iso());
        job.logs.push("Job canceled before execution".to_string());
    } else {
        return Err(ErrorResponse::conflict(
            "only queued jobs can be canceled through the app runtime queue",
        ));
    }
    Ok(Json(json!({ "success": true, "job": job.clone() })))
}

pub async fn app_http_request(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(req): Json<AppHttpRequest>,
) -> Response {
    if let Err(err) = require_permission(&state, &app_id, "ExternalHttpRequest").await {
        return err.into_response();
    }
    if let Err(err) = validate_external_url(&req.url) {
        return err.into_response();
    }

    let method = match reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes()) {
        Ok(method) => method,
        Err(_) => return ErrorResponse::bad_request("invalid HTTP method").into_response(),
    };

    let mut request = state
        .http_client
        .request(method, &req.url)
        .timeout(Duration::from_secs(req.timeout_secs.clamp(1, 120)))
        .header("User-Agent", format!("IORA-AppRuntime/1.0 app={app_id}"));
    for (name, value) in req.headers {
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "authorization" | "cookie" | "content-length") {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(body) = req.body {
        request = request.json(&body);
    }

    match request.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let text = resp.text().await.unwrap_or_default();
            (status, Json(json!({ "status": status.as_u16(), "body": text }))).into_response()
        }
        Err(err) => ErrorResponse::bad_gateway(format!("external request failed: {err}")).into_response(),
    }
}

fn spawn_queue_worker(state: AppState, app_id: String) {
    let mut workers = RUNTIME.queue_workers.lock().unwrap();
    if !workers.insert(app_id.clone()) {
        return;
    }
    drop(workers);
    tokio::spawn(async move {
        loop {
            let next = RUNTIME
                .queues
                .lock()
                .unwrap()
                .get_mut(&app_id)
                .and_then(|queue| queue.pop_front());
            let Some(job_id) = next else { break };
            run_job_inner(state.clone(), app_id.clone(), job_id).await;
        }
        RUNTIME.queue_workers.lock().unwrap().remove(&app_id);
    });
}

fn spawn_job(state: AppState, app_id: String, job_id: String) {
    tokio::spawn(async move {
        run_job_inner(state, app_id, job_id).await;
    });
}

async fn run_job_inner(state: AppState, app_id: String, job_id: String) {
    update_job(&job_id, |job| {
        job.status = AppRuntimeStatus::Running;
        job.started_at = Some(now_iso());
        job.logs.push("Job started".to_string());
    });

    let job_snapshot = RUNTIME.jobs.lock().unwrap().get(&job_id).cloned();
    let Some(job) = job_snapshot else { return };

    let result = if let Some(url) = job.target_url.clone() {
        if let Err(err) = validate_external_url(&url) {
            Err(err.error)
        } else {
            let body = json!({
                "app_id": app_id,
                "job_id": job_id,
                "action": job.action,
                "payload": job.payload,
            });
            state
                .http_client
                .post(url)
                .json(&body)
                .timeout(Duration::from_secs(120))
                .send()
                .await
                .map_err(|err| err.to_string())
                .and_then(|resp| {
                    let status = resp.status();
                    if status.is_success() {
                        Ok(json!({ "status": status.as_u16() }))
                    } else {
                        Err(format!("target returned HTTP {}", status.as_u16()))
                    }
                })
        }
    } else {
        Ok(json!({
            "status": "completed",
            "message": "Action recorded by IORA app runtime",
        }))
    };

    update_job(&job_id, |job| match result {
        Ok(value) => {
            job.status = AppRuntimeStatus::Succeeded;
            job.result = Some(value);
            job.logs.push("Job completed".to_string());
        }
        Err(error) => {
            job.status = AppRuntimeStatus::Failed;
            job.error = Some(error.clone());
            job.logs.push(format!("Job failed: {error}"));
        }
    });
    update_job(&job_id, |job| {
        job.finished_at = Some(now_iso());
    });
}

fn update_job(job_id: &str, update: impl FnOnce(&mut AppRuntimeJob)) {
    if let Some(job) = RUNTIME.jobs.lock().unwrap().get_mut(job_id) {
        update(job);
    }
}

async fn find_app(
    state: &AppState,
    app_id: &str,
) -> Result<crate::local_appstore::InstalledApp, ErrorResponse> {
    state
        .local_appstore
        .list()
        .await
        .into_iter()
        .find(|app| app.id == app_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("app '{}' not found", app_id)))
}

async fn ensure_app_exists(state: &AppState, app_id: &str) -> Result<(), ErrorResponse> {
    find_app(state, app_id).await.map(|_| ())
}

async fn require_permission(
    state: &AppState,
    app_id: &str,
    permission: &str,
) -> Result<(), ErrorResponse> {
    ensure_app_exists(state, app_id).await?;
    if state.local_appstore.has_permission(app_id, permission).await {
        Ok(())
    } else {
        Err(ErrorResponse::forbidden(format!(
            "app '{}' requires permission '{}'",
            app_id, permission
        )))
    }
}

fn validate_external_url(url: &str) -> Result<(), ErrorResponse> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| ErrorResponse::bad_request(format!("invalid url: {e}")))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(ErrorResponse::bad_request("only http and https URLs are allowed")),
    }
    if let Some(host) = parsed.host_str() {
        let lower = host.to_ascii_lowercase();
        if lower == "localhost" || lower == "127.0.0.1" || lower == "::1" {
            return Err(ErrorResponse::forbidden("loopback URLs are not allowed"));
        }
    }
    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
