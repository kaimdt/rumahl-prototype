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
    net::IpAddr,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tokio::{net::TcpStream, time::timeout};

use crate::{crypto, AppState, ErrorResponse};

static RUNTIME: LazyLock<AppRuntimeState> = LazyLock::new(AppRuntimeState::default);

#[derive(Default)]
struct AppRuntimeState {
    jobs: Mutex<HashMap<String, AppRuntimeJob>>,
    queues: Mutex<HashMap<String, VecDeque<String>>>,
    queue_workers: Mutex<HashSet<String>>,
    audit: Mutex<VecDeque<AppRuntimeAuditEntry>>,
    http_rate_limits: Mutex<HashMap<String, AppRateLimitWindow>>,
}

#[derive(Debug, Clone, Default)]
struct AppRateLimitWindow {
    window_minute: i64,
    count: u32,
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

#[derive(Debug, Clone, Serialize)]
pub struct AppRuntimeAuditEntry {
    pub id: String,
    pub app_id: String,
    pub event_type: String,
    pub status: String,
    pub target: Option<String>,
    pub message: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AppRunMode {
    #[default]
    Queued,
    Parallel,
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
    pub secret_headers: HashMap<String, String>,
    #[serde(default)]
    pub bearer_token_secret: Option<String>,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSecretEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_secret_type")]
    pub secret_type: String,
    pub encrypted_value: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppSecretMetadata {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub secret_type: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AppSecretWriteRequest {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_secret_type")]
    pub secret_type: String,
}

#[derive(Debug, Deserialize)]
pub struct AppSecretUpdateRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub secret_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppSecretRevealResponse {
    pub id: String,
    pub name: String,
    pub value: String,
    pub secret_type: String,
}

#[derive(Debug, Deserialize)]
pub struct AppNetworkProbeRequest {
    pub host: String,
    pub port: u16,
    #[serde(default = "default_probe_timeout_secs")]
    pub timeout_secs: u64,
}

fn default_probe_timeout_secs() -> u64 {
    5
}

fn default_http_method() -> String {
    "GET".to_string()
}

fn default_timeout_secs() -> u64 {
    30
}

fn default_secret_type() -> String {
    "api_key".to_string()
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
        "secrets": app.manifest.extra.get("secrets").cloned().unwrap_or(json!([])),
    })))
}

pub async fn list_audit(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "AppRuntimeAuditRead").await?;
    let entries: Vec<AppRuntimeAuditEntry> = RUNTIME
        .audit
        .lock()
        .unwrap()
        .iter()
        .filter(|entry| entry.app_id == app_id)
        .cloned()
        .collect();
    Ok(Json(json!({ "events": entries, "total": entries.len() })))
}

pub async fn list_secrets(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "AppSecretsRead").await?;
    let secrets = load_app_secrets(&state, &app_id).await?;
    let items: Vec<AppSecretMetadata> = secrets.iter().map(secret_metadata).collect();
    Ok(Json(json!({ "secrets": items, "total": items.len() })))
}

pub async fn create_secret(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(req): Json<AppSecretWriteRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "AppSecretsWrite").await?;
    let name = normalize_secret_name(&req.name)?;
    if req.value.is_empty() {
        return Err(ErrorResponse::bad_request("secret value is required"));
    }
    let mut secrets = load_app_secrets(&state, &app_id).await?;
    if secrets.iter().any(|secret| secret.name == name) {
        return Err(ErrorResponse::conflict(format!(
            "secret '{}' already exists for app '{}'",
            name, app_id
        )));
    }
    let now = now_iso();
    let entry = AppSecretEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description: req.description,
        secret_type: req.secret_type,
        encrypted_value: crypto::encrypt_secret(&req.value),
        created_at: now.clone(),
        updated_at: now,
        last_used_at: None,
    };
    let metadata = secret_metadata(&entry);
    secrets.push(entry);
    save_app_secrets(&state, &app_id, &secrets).await?;
    record_audit(&app_id, "secret.create", "succeeded", Some(&metadata.name), None);
    Ok(Json(json!({ "success": true, "secret": metadata })))
}

pub async fn update_secret(
    State(state): State<AppState>,
    Path((app_id, secret_id)): Path<(String, String)>,
    Json(req): Json<AppSecretUpdateRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "AppSecretsWrite").await?;
    let mut secrets = load_app_secrets(&state, &app_id).await?;
    if let Some(new_name) = &req.name {
        let normalized = normalize_secret_name(new_name)?;
        if secrets
            .iter()
            .any(|secret| secret.id != secret_id && secret.name == normalized)
        {
            return Err(ErrorResponse::conflict(format!(
                "secret '{}' already exists for app '{}'",
                normalized, app_id
            )));
        }
    }
    let entry = secrets
        .iter_mut()
        .find(|secret| secret.id == secret_id || secret.name == secret_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("secret '{}' not found", secret_id)))?;
    if let Some(name) = req.name {
        entry.name = normalize_secret_name(&name)?;
    }
    if let Some(value) = req.value {
        if value.is_empty() {
            return Err(ErrorResponse::bad_request("secret value cannot be empty"));
        }
        entry.encrypted_value = crypto::encrypt_secret(&value);
    }
    if req.description.is_some() {
        entry.description = req.description;
    }
    if let Some(secret_type) = req.secret_type {
        entry.secret_type = secret_type;
    }
    entry.updated_at = now_iso();
    let metadata = secret_metadata(entry);
    save_app_secrets(&state, &app_id, &secrets).await?;
    record_audit(&app_id, "secret.update", "succeeded", Some(&metadata.name), None);
    Ok(Json(json!({ "success": true, "secret": metadata })))
}

pub async fn delete_secret(
    State(state): State<AppState>,
    Path((app_id, secret_id)): Path<(String, String)>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "AppSecretsManage").await?;
    let mut secrets = load_app_secrets(&state, &app_id).await?;
    let before = secrets.len();
    secrets.retain(|secret| secret.id != secret_id && secret.name != secret_id);
    if secrets.len() == before {
        return Err(ErrorResponse::not_found(format!("secret '{}' not found", secret_id)));
    }
    save_app_secrets(&state, &app_id, &secrets).await?;
    record_audit(&app_id, "secret.delete", "succeeded", Some(&secret_id), None);
    Ok(Json(json!({ "success": true })))
}

pub async fn reveal_secret(
    State(state): State<AppState>,
    Path((app_id, secret_id)): Path<(String, String)>,
) -> Result<Json<AppSecretRevealResponse>, ErrorResponse> {
    require_permission(&state, &app_id, "AppSecretsRead").await?;
    let mut secrets = load_app_secrets(&state, &app_id).await?;
    let entry = secrets
        .iter_mut()
        .find(|secret| secret.id == secret_id || secret.name == secret_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("secret '{}' not found", secret_id)))?;
    entry.last_used_at = Some(now_iso());
    let response = AppSecretRevealResponse {
        id: entry.id.clone(),
        name: entry.name.clone(),
        value: crypto::maybe_decrypt(&entry.encrypted_value),
        secret_type: entry.secret_type.clone(),
    };
    save_app_secrets(&state, &app_id, &secrets).await?;
    record_audit(&app_id, "secret.reveal", "succeeded", Some(&response.name), None);
    Ok(Json(response))
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
    record_audit(&app_id, "job.create", "succeeded", Some(&job.action), None);

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
        record_audit(&app_id, "job.cancel", "succeeded", Some(&job_id), None);
    } else {
        return Err(ErrorResponse::conflict(
            "only queued jobs can be canceled through the app runtime queue",
        ));
    }
    Ok(Json(json!({ "success": true, "job": job.clone() })))
}

pub async fn network_probe(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(req): Json<AppNetworkProbeRequest>,
) -> Result<Json<Value>, ErrorResponse> {
    require_permission(&state, &app_id, "NetworkScan").await?;
    if req.host.trim().is_empty() {
        return Err(ErrorResponse::bad_request("host is required"));
    }
    let app = find_app(&state, &app_id).await?;
    let host = normalize_probe_host(&req.host)?;
    let resolved = timeout(
        Duration::from_secs(req.timeout_secs.clamp(1, 30)),
        tokio::net::lookup_host((host.as_str(), req.port)),
    )
    .await
    .map_err(|_| ErrorResponse::bad_gateway("network probe DNS lookup timed out"))?
    .map_err(|e| ErrorResponse::bad_gateway(format!("network probe DNS lookup failed: {e}")))?;
    let addresses: Vec<_> = resolved.collect();
    if addresses.is_empty() {
        return Err(ErrorResponse::not_found("network probe found no addresses"));
    }
    let requires_local = addresses.iter().any(|addr| is_local_ip(addr.ip()));
    if requires_local {
        require_permission(&state, &app_id, "NetworkLocalAccess").await?;
        enforce_local_ip_policy(&app, &addresses.iter().map(|addr| addr.ip()).collect::<Vec<_>>())?;
    }

    let target = addresses[0];
    let started = std::time::Instant::now();
    let connect_result = timeout(
        Duration::from_secs(req.timeout_secs.clamp(1, 30)),
        TcpStream::connect(target),
    )
    .await;
    let latency_ms = started.elapsed().as_millis() as u64;
    let open = matches!(connect_result, Ok(Ok(_)));
    let status = if open { "succeeded" } else { "failed" };
    record_audit(
        &app_id,
        "network.probe",
        status,
        Some(&format!("{}:{}", host, req.port)),
        None,
    );
    Ok(Json(json!({
        "host": host,
        "port": req.port,
        "open": open,
        "latency_ms": latency_ms,
        "resolved": addresses.iter().map(|addr| addr.to_string()).collect::<Vec<_>>(),
    })))
}

pub async fn app_http_request(
    State(state): State<AppState>,
    Path(app_id): Path<String>,
    Json(req): Json<AppHttpRequest>,
) -> Response {
    if let Err(err) = require_permission(&state, &app_id, "ExternalHttpRequest").await {
        return err.into_response();
    }
    let app = match find_app(&state, &app_id).await {
        Ok(app) => app,
        Err(err) => return err.into_response(),
    };
    if let Err(err) = enforce_http_rate_limit(&app_id, app_http_limit_per_minute(&app)) {
        record_audit(&app_id, "http.request", "rate_limited", Some(&req.url), Some(&err.error));
        return err.into_response();
    }
    if let Err(err) = validate_external_url(&req.url).and_then(|_| enforce_http_policy(&app, &req.url)) {
        record_audit(&app_id, "http.request", "blocked", Some(&req.url), Some(&err.error));
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
    if !req.secret_headers.is_empty() || req.bearer_token_secret.is_some() {
        if let Err(err) = require_permission(&state, &app_id, "AppSecretsRead").await {
            return err.into_response();
        }
    }
    for (name, secret_id) in req.secret_headers {
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "content-length") {
            continue;
        }
        match resolve_app_secret(&state, &app_id, &secret_id).await {
            Ok(value) => request = request.header(name, value),
            Err(err) => return err.into_response(),
        }
    }
    if let Some(secret_id) = req.bearer_token_secret {
        match resolve_app_secret(&state, &app_id, &secret_id).await {
            Ok(value) => request = request.bearer_auth(value),
            Err(err) => return err.into_response(),
        }
    }
    if let Some(body) = req.body {
        request = request.json(&body);
    }

    match request.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let text = resp.text().await.unwrap_or_default();
            record_audit(
                &app_id,
                "http.request",
                if status.is_success() { "succeeded" } else { "failed" },
                Some(&req.url),
                Some(&format!("HTTP {}", status.as_u16())),
            );
            (status, Json(json!({ "status": status.as_u16(), "body": text }))).into_response()
        }
        Err(err) => {
            let message = format!("external request failed: {err}");
            record_audit(&app_id, "http.request", "failed", Some(&req.url), Some(&message));
            ErrorResponse::bad_gateway(message).into_response()
        }
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
            record_audit(&job.app_id, "job.finish", "succeeded", Some(&job.id), None);
        }
        Err(error) => {
            job.status = AppRuntimeStatus::Failed;
            job.error = Some(error.clone());
            job.logs.push(format!("Job failed: {error}"));
            record_audit(&job.app_id, "job.finish", "failed", Some(&job.id), Some(&error));
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

async fn resolve_app_secret(
    state: &AppState,
    app_id: &str,
    secret_id: &str,
) -> Result<String, ErrorResponse> {
    let mut secrets = load_app_secrets(state, app_id).await?;
    let entry = secrets
        .iter_mut()
        .find(|secret| secret.id == secret_id || secret.name == secret_id)
        .ok_or_else(|| ErrorResponse::not_found(format!("secret '{}' not found", secret_id)))?;
    entry.last_used_at = Some(now_iso());
    let value = crypto::maybe_decrypt(&entry.encrypted_value);
    save_app_secrets(state, app_id, &secrets).await?;
    Ok(value)
}

async fn load_app_secrets(
    state: &AppState,
    app_id: &str,
) -> Result<Vec<AppSecretEntry>, ErrorResponse> {
    ensure_app_exists(state, app_id).await?;
    let path = app_secrets_path(state, app_id)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to read app secrets: {e}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| ErrorResponse::internal(format!("failed to parse app secrets: {e}")))
}

async fn save_app_secrets(
    state: &AppState,
    app_id: &str,
    secrets: &[AppSecretEntry],
) -> Result<(), ErrorResponse> {
    let path = app_secrets_path(state, app_id)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ErrorResponse::internal(format!("failed to create app secrets dir: {e}")))?;
    }
    let body = serde_json::to_vec_pretty(secrets)
        .map_err(|e| ErrorResponse::internal(format!("failed to encode app secrets: {e}")))?;
    tokio::fs::write(path, body)
        .await
        .map_err(|e| ErrorResponse::internal(format!("failed to write app secrets: {e}")))
}

fn app_secrets_path(state: &AppState, app_id: &str) -> Result<PathBuf, ErrorResponse> {
    let safe_app_id = sanitize_path_segment(app_id)?;
    Ok(state
        .local_appstore
        .base_dir()
        .join(".app-secrets")
        .join(format!("{safe_app_id}.json")))
}

fn normalize_secret_name(name: &str) -> Result<String, ErrorResponse> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ErrorResponse::bad_request("secret name is required"));
    }
    sanitize_path_segment(trimmed)
}

fn sanitize_path_segment(value: &str) -> Result<String, ErrorResponse> {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        Ok(value.to_string())
    } else {
        Err(ErrorResponse::bad_request(
            "only letters, numbers, dash, underscore, and dot are allowed",
        ))
    }
}

fn secret_metadata(secret: &AppSecretEntry) -> AppSecretMetadata {
    AppSecretMetadata {
        id: secret.id.clone(),
        name: secret.name.clone(),
        description: secret.description.clone(),
        secret_type: secret.secret_type.clone(),
        created_at: secret.created_at.clone(),
        updated_at: secret.updated_at.clone(),
        last_used_at: secret.last_used_at.clone(),
    }
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

fn record_audit(
    app_id: &str,
    event_type: &str,
    status: &str,
    target: Option<&str>,
    message: Option<&str>,
) {
    let mut audit = RUNTIME.audit.lock().unwrap();
    audit.push_back(AppRuntimeAuditEntry {
        id: uuid::Uuid::new_v4().to_string(),
        app_id: app_id.to_string(),
        event_type: event_type.to_string(),
        status: status.to_string(),
        target: target.map(ToString::to_string),
        message: message.map(ToString::to_string),
        timestamp: now_iso(),
    });
    while audit.len() > 1000 {
        audit.pop_front();
    }
}

fn enforce_http_rate_limit(app_id: &str, limit_per_minute: u32) -> Result<(), ErrorResponse> {
    if limit_per_minute == 0 {
        return Ok(());
    }
    let minute = chrono::Utc::now().timestamp() / 60;
    let mut limits = RUNTIME.http_rate_limits.lock().unwrap();
    let window = limits.entry(app_id.to_string()).or_insert_with(|| AppRateLimitWindow {
        window_minute: minute,
        count: 0,
    });
    if window.window_minute != minute {
        window.window_minute = minute;
        window.count = 0;
    }
    if window.count >= limit_per_minute {
        return Err(ErrorResponse::conflict(format!(
            "app HTTP rate limit exceeded: {} requests per minute",
            limit_per_minute
        )));
    }
    window.count += 1;
    Ok(())
}

fn app_http_limit_per_minute(app: &crate::local_appstore::InstalledApp) -> u32 {
    let runtime = app
        .manifest
        .extra
        .get("runtime")
        .or_else(|| app.manifest.extra.get("capabilities").and_then(|value| value.get("runtime")));
    runtime
        .and_then(|runtime| runtime.get("limits"))
        .and_then(|limits| limits.get("http_per_minute"))
        .and_then(|value| value.as_u64())
        .unwrap_or(60)
        .min(600) as u32
}

fn enforce_http_policy(
    app: &crate::local_appstore::InstalledApp,
    url: &str,
) -> Result<(), ErrorResponse> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| ErrorResponse::bad_request(format!("invalid url: {e}")))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| ErrorResponse::bad_request("url host is required"))?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_local_ip(ip) {
            if !app_has_permission(app, "NetworkLocalAccess") {
                return Err(ErrorResponse::forbidden(
                    "local network URLs require NetworkLocalAccess",
                ));
            }
            enforce_local_ip_policy(app, &[ip])?;
        }
    }

    let allowed_domains = allowed_http_domains(app);
    if !allowed_domains.is_empty()
        && !allowed_domains
            .iter()
            .any(|allowed| domain_matches(host, allowed))
    {
        return Err(ErrorResponse::forbidden(format!(
            "domain '{}' is not allowed by this app manifest",
            host
        )));
    }
    Ok(())
}

fn allowed_http_domains(app: &crate::local_appstore::InstalledApp) -> Vec<String> {
    let mut domains = Vec::new();
    if let Some(items) = app
        .manifest
        .extra
        .get("network_access")
        .and_then(|value| value.get("allowed_domains"))
        .and_then(|value| value.as_array())
    {
        domains.extend(items.iter().filter_map(|value| value.as_str()).map(str::to_string));
    }
    if let Some(items) = app
        .manifest
        .extra
        .get("external_apis")
        .and_then(|value| value.as_array())
    {
        domains.extend(items.iter().filter_map(|item| {
            item.get("base_url")
                .and_then(|value| value.as_str())
                .and_then(|base| reqwest::Url::parse(base).ok())
                .and_then(|url| url.host_str().map(str::to_string))
        }));
    }
    domains.sort_unstable();
    domains.dedup();
    domains
}

fn enforce_local_ip_policy(
    app: &crate::local_appstore::InstalledApp,
    ips: &[IpAddr],
) -> Result<(), ErrorResponse> {
    let allowed: Vec<IpAddr> = app
        .manifest
        .extra
        .get("network_access")
        .and_then(|value| value.get("allowed_local_ips"))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|value| value.as_str())
                .filter_map(|value| value.parse::<IpAddr>().ok())
                .collect()
        })
        .unwrap_or_default();
    if !allowed.is_empty() && ips.iter().any(|ip| !allowed.contains(ip)) {
        return Err(ErrorResponse::forbidden(
            "local IP is not allowed by this app manifest",
        ));
    }
    Ok(())
}

fn app_has_permission(app: &crate::local_appstore::InstalledApp, permission: &str) -> bool {
    app.permission_grants
        .iter()
        .any(|grant| grant.is_active && grant.permission == permission)
}

fn domain_matches(host: &str, allowed: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let allowed = allowed.trim().to_ascii_lowercase();
    if let Some(suffix) = allowed.strip_prefix("*.") {
        host == suffix || host.ends_with(&format!(".{suffix}"))
    } else {
        host == allowed
    }
}

fn normalize_probe_host(host: &str) -> Result<String, ErrorResponse> {
    let trimmed = host.trim().trim_matches('[').trim_matches(']');
    if trimmed.is_empty() || trimmed.len() > 253 {
        return Err(ErrorResponse::bad_request("invalid probe host"));
    }
    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        Ok(trimmed.to_string())
    } else {
        Err(ErrorResponse::bad_request("invalid probe host"))
    }
}

fn is_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.octets()[0] == 0
                || ip.octets()[0] == 169 && ip.octets()[1] == 254
        }
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
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
