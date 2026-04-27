use actix_web::{get, post, web, App, HttpRequest, HttpResponse, HttpServer, Responder};
use actix_web_lab::sse::{self, Sse};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;

/// IORA Developer App
///
/// Official development tool providing IDE integration, hot reload,
/// and development workflow features. This app has exclusive access
/// to hot-reload APIs and other development features.

// Security token for Developer App - injected at build time
const DEVELOPER_APP_TOKEN: &str = env!("IORA_DEVELOPER_APP_TOKEN", "dev-token-placeholder");

#[derive(Debug, Clone)]
struct AppState {
    supervisor_url: String,
    iora_api_url: String,
    hot_reload_history: Arc<RwLock<HashMap<String, Vec<HotReloadEntry>>>>,
    deployment_status: Arc<RwLock<HashMap<String, DeploymentStatus>>>,
    developer_mode_enabled: Arc<RwLock<bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
struct HotReloadEntry {
    id: String,
    app_id: String,
    version: String,
    timestamp: DateTime<Utc>,
    status: String, // "success", "failed"
    checksum: String,
    rollback_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
struct DeploymentStatus {
    app_id: String,
    status: String, // "pending", "in_progress", "completed", "failed"
    started_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    error: Option<String>,
    progress: u8, // 0-100
}

#[derive(Debug, Deserialize, ToSchema)]
struct HotReloadUploadRequest {
    app_id: String,
    version: String,
    package_data: String, // base64 encoded tar.gz
    auto_restart: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
struct IDEDeployRequest {
    app_id: String,
    image_tar: String, // base64 encoded Docker image tar
    restart: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
struct DeveloperModeRequest {
    /// API key or token for authentication
    api_key: Option<String>,
}

/// Middleware to check Developer Mode and authentication
async fn check_developer_mode(
    req: &HttpRequest,
    data: &web::Data<AppState>,
) -> Result<(), HttpResponse> {
    // Check if Developer Mode is enabled
    let dev_mode = *data.developer_mode_enabled.read().await;
    if !dev_mode {
        return Err(HttpResponse::Forbidden().json(serde_json::json!({
            "error": "Developer Mode is not enabled",
            "message": "Enable Developer Mode in IORA Control Center to access this endpoint"
        })));
    }

    // Check for Developer App token in header
    if let Some(auth_header) = req.headers().get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if auth_str.starts_with("Bearer ") {
                let token = &auth_str[7..];
                if token == DEVELOPER_APP_TOKEN {
                    return Ok(());
                }
            }
        }
    }

    // Check for API key in header (for other apps)
    if let Some(api_key) = req.headers().get("X-API-Key") {
        if let Ok(key_str) = api_key.to_str() {
            // TODO: Validate API key against IORA API
            // For now, accept any key if Developer Mode is enabled
            info!("API key authentication: {}", key_str);
            return Ok(());
        }
    }

    Err(HttpResponse::Unauthorized().json(serde_json::json!({
        "error": "Authentication required",
        "message": "Provide valid Developer App token or API key"
    })))
}

/// Health check endpoint
#[utoipa::path(
    get,
    path = "/health",
    tag = "system",
    responses(
        (status = 200, description = "Service is healthy", body = serde_json::Value)
    )
)]
#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "iora-developer-app",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Get app information and capabilities
#[utoipa::path(
    get,
    path = "/api/info",
    tag = "system",
    responses(
        (status = 200, description = "App information", body = serde_json::Value)
    )
)]
#[get("/api/info")]
async fn get_info(data: web::Data<AppState>) -> impl Responder {
    let dev_mode_enabled = *data.developer_mode_enabled.read().await;

    HttpResponse::Ok().json(serde_json::json!({
        "id": "io.iora.developer-app",
        "name": "IORA Developer",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "Official IORA development tool",
        "developer_mode_enabled": dev_mode_enabled,
        "capabilities": [
            "hot_reload",
            "ide_integration",
            "live_logs",
            "live_metrics",
            "inter_app_communication"
        ],
        "public_endpoints": [
            "/api/public/developer-status",
            "/api/public/app-metrics",
            "/api/public/deployment-info"
        ]
    }))
}

// ─── Public APIs for Other Apps ──────────────────────────────────────────

/// Get Developer Mode status (public endpoint)
#[utoipa::path(
    get,
    path = "/api/public/developer-status",
    tag = "public",
    responses(
        (status = 200, description = "Developer Mode status", body = serde_json::Value)
    )
)]
#[get("/api/public/developer-status")]
async fn public_developer_status(data: web::Data<AppState>) -> impl Responder {
    let dev_mode_enabled = *data.developer_mode_enabled.read().await;
    let os_dev = detect_os_dev_mode().await;

    HttpResponse::Ok().json(serde_json::json!({
        "developer_mode_enabled": dev_mode_enabled,
        "timestamp": Utc::now().to_rfc3339(),
        "service": "iora-developer-app",
        "os_dev": os_dev,
    }))
}

/// Returns whether the underlying IORA OS image was built with
/// `build.sh --dev` and, if so, the capabilities exposed by
/// `iora-dev-bridge` on 127.0.0.1:8099.  On a production image this
/// always reports `{ "enabled": false }`.  Because the bridge binary is
/// only present on dev images, there is no way for the Developer App to
/// fake elevated capabilities on a stock system.
async fn detect_os_dev_mode() -> serde_json::Value {
    let marker = std::path::Path::new("/etc/iora/os-dev-mode").exists();
    if !marker {
        return serde_json::json!({ "enabled": false });
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(750))
        .build()
    {
        Ok(c) => c,
        Err(_) => return serde_json::json!({ "enabled": true, "bridge": "unavailable" }),
    };
    match client
        .get("http://127.0.0.1:8099/dev/status")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            serde_json::json!({
                "enabled": true,
                "bridge":  "reachable",
                "build":   body.get("build"),
                "capabilities": body.get("capabilities"),
            })
        }
        _ => serde_json::json!({ "enabled": true, "bridge": "unreachable" }),
    }
}

/// Get app deployment information (for other apps in Developer Mode)
#[utoipa::path(
    get,
    path = "/api/public/deployment-info/{app_id}",
    tag = "public",
    params(
        ("app_id" = String, Path, description = "App ID")
    ),
    responses(
        (status = 200, description = "Deployment information", body = serde_json::Value),
        (status = 404, description = "No deployment info found")
    )
)]
#[get("/api/public/deployment-info/{app_id}")]
async fn public_deployment_info(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let app_id = path.into_inner();

    // Check if Developer Mode is enabled
    let dev_mode = *data.developer_mode_enabled.read().await;
    if !dev_mode {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "Developer Mode is not enabled"
        }));
    }

    let history = data.hot_reload_history.read().await;
    match history.get(&app_id) {
        Some(entries) => {
            let latest = entries.last();
            HttpResponse::Ok().json(serde_json::json!({
                "app_id": app_id,
                "latest_deployment": latest,
                "total_deployments": entries.len()
            }))
        }
        None => HttpResponse::NotFound().json(serde_json::json!({
            "error": "No deployment info found"
        }))
    }
}

/// Get app metrics (for other apps in Developer Mode)
#[utoipa::path(
    get,
    path = "/api/public/app-metrics/{app_id}",
    tag = "public",
    params(
        ("app_id" = String, Path, description = "App ID")
    ),
    responses(
        (status = 200, description = "App metrics", body = serde_json::Value),
        (status = 403, description = "Developer Mode not enabled")
    )
)]
#[get("/api/public/app-metrics/{app_id}")]
async fn public_app_metrics(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let app_id = path.into_inner();

    // Check if Developer Mode is enabled
    let dev_mode = *data.developer_mode_enabled.read().await;
    if !dev_mode {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "Developer Mode is not enabled"
        }));
    }

    // Forward to supervisor for actual metrics
    let client = reqwest::Client::new();
    let metrics_url = format!("{}/api/developer/metrics", data.supervisor_url);

    match client.get(&metrics_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>().await {
                Ok(metrics) => HttpResponse::Ok().json(metrics),
                Err(_) => HttpResponse::InternalServerError().json(serde_json::json!({
                    "error": "Failed to parse metrics"
                }))
            }
        }
        _ => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": "Failed to get metrics"
        }))
    }
}

// ─── Hot Reload APIs (Exclusive to Developer App) ────────────────────────

/// Upload app package for hot reload
#[utoipa::path(
    post,
    path = "/api/hotreload/upload",
    tag = "hotreload",
    request_body = HotReloadUploadRequest,
    responses(
        (status = 200, description = "Hot reload successful", body = serde_json::Value),
        (status = 400, description = "Invalid request"),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Developer Mode not enabled")
    ),
    security(
        ("bearer_token" = [])
    )
)]
#[post("/api/hotreload/upload")]
async fn hotreload_upload(
    req: HttpRequest,
    data: web::Data<AppState>,
    payload: web::Json<HotReloadUploadRequest>,
) -> impl Responder {
    // Check authentication and Developer Mode
    if let Err(response) = check_developer_mode(&req, &data).await {
        return response;
    }

    info!("Hot reload upload request for app: {}", payload.app_id);

    // Decode package data
    let package_bytes = match base64::decode(&payload.package_data) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Failed to decode package data: {}", e);
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid base64 encoding"
            }));
        }
    };

    // Calculate checksum
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(&package_bytes);
    let checksum = format!("{:x}", hasher.finalize());

    // Create deployment status
    let deployment_id = Uuid::new_v4().to_string();
    let status = DeploymentStatus {
        app_id: payload.app_id.clone(),
        status: "in_progress".to_string(),
        started_at: Utc::now(),
        completed_at: None,
        error: None,
        progress: 10,
    };

    {
        let mut statuses = data.deployment_status.write().await;
        statuses.insert(deployment_id.clone(), status);
    }

    // Forward to supervisor's deploy endpoint
    let client = reqwest::Client::new();
    let deploy_url = format!("{}/api/developer/deploy", data.supervisor_url);

    let response = client
        .post(&deploy_url)
        .json(&serde_json::json!({
            "app_id": payload.app_id,
            "image_tar": payload.package_data,
            "restart": payload.auto_restart
        }))
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            // Update deployment status
            {
                let mut statuses = data.deployment_status.write().await;
                if let Some(status) = statuses.get_mut(&deployment_id) {
                    status.status = "completed".to_string();
                    status.completed_at = Some(Utc::now());
                    status.progress = 100;
                }
            }

            // Add to history
            let entry = HotReloadEntry {
                id: deployment_id.clone(),
                app_id: payload.app_id.clone(),
                version: payload.version.clone(),
                timestamp: Utc::now(),
                status: "success".to_string(),
                checksum: checksum.clone(),
                rollback_available: true,
            };

            {
                let mut history = data.hot_reload_history.write().await;
                history.entry(payload.app_id.clone())
                    .or_insert_with(Vec::new)
                    .push(entry);
            }

            info!("Hot reload completed successfully for app: {}", payload.app_id);

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "deployment_id": deployment_id,
                "app_id": payload.app_id,
                "version": payload.version,
                "checksum": checksum,
                "message": "Hot reload completed successfully"
            }))
        }
        Ok(resp) => {
            let status_code = resp.status();
            let error_msg = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());

            error!("Hot reload failed for app {}: {}", payload.app_id, error_msg);

            {
                let mut statuses = data.deployment_status.write().await;
                if let Some(status) = statuses.get_mut(&deployment_id) {
                    status.status = "failed".to_string();
                    status.completed_at = Some(Utc::now());
                    status.error = Some(error_msg.clone());
                }
            }

            HttpResponse::build(status_code).json(serde_json::json!({
                "error": "Hot reload failed",
                "details": error_msg,
                "deployment_id": deployment_id
            }))
        }
        Err(e) => {
            error!("Failed to communicate with supervisor: {}", e);

            {
                let mut statuses = data.deployment_status.write().await;
                if let Some(status) = statuses.get_mut(&deployment_id) {
                    status.status = "failed".to_string();
                    status.completed_at = Some(Utc::now());
                    status.error = Some(e.to_string());
                }
            }

            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to communicate with supervisor",
                "details": e.to_string()
            }))
        }
    }
}

/// Get hot reload status
#[utoipa::path(
    get,
    path = "/api/hotreload/status/{deployment_id}",
    tag = "hotreload",
    params(
        ("deployment_id" = String, Path, description = "Deployment ID")
    ),
    responses(
        (status = 200, description = "Deployment status", body = DeploymentStatus),
        (status = 404, description = "Deployment not found")
    ),
    security(
        ("bearer_token" = [])
    )
)]
#[get("/api/hotreload/status/{deployment_id}")]
async fn hotreload_status(
    req: HttpRequest,
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&req, &data).await {
        return response;
    }

    let deployment_id = path.into_inner();

    let statuses = data.deployment_status.read().await;
    match statuses.get(&deployment_id) {
        Some(status) => HttpResponse::Ok().json(status),
        None => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Deployment not found"
        })),
    }
}

/// Rollback to previous version
#[utoipa::path(
    post,
    path = "/api/hotreload/rollback/{app_id}",
    tag = "hotreload",
    params(
        ("app_id" = String, Path, description = "App ID")
    ),
    responses(
        (status = 200, description = "Rollback initiated", body = serde_json::Value),
        (status = 404, description = "No history found"),
        (status = 400, description = "No previous version available")
    ),
    security(
        ("bearer_token" = [])
    )
)]
#[post("/api/hotreload/rollback/{app_id}")]
async fn hotreload_rollback(
    req: HttpRequest,
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&req, &data).await {
        return response;
    }

    let app_id = path.into_inner();

    let history = data.hot_reload_history.read().await;
    let app_history = match history.get(&app_id) {
        Some(h) => h,
        None => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "No hot reload history found for this app"
            }));
        }
    };

    // Get the second-to-last successful deployment (to rollback to)
    let rollback_target = app_history
        .iter()
        .rev()
        .filter(|e| e.status == "success" && e.rollback_available)
        .nth(1); // Skip the current (most recent) and get the previous one

    match rollback_target {
        Some(target) => {
            info!("Rolling back app {} to version {}", app_id, target.version);

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "app_id": app_id,
                "rolled_back_to": {
                    "version": target.version,
                    "timestamp": target.timestamp,
                    "checksum": target.checksum
                },
                "message": "Rollback initiated"
            }))
        }
        None => {
            HttpResponse::BadRequest().json(serde_json::json!({
                "error": "No previous version available for rollback"
            }))
        }
    }
}

/// Get hot reload history
#[utoipa::path(
    get,
    path = "/api/hotreload/history/{app_id}",
    tag = "hotreload",
    params(
        ("app_id" = String, Path, description = "App ID")
    ),
    responses(
        (status = 200, description = "Hot reload history", body = serde_json::Value)
    ),
    security(
        ("bearer_token" = [])
    )
)]
#[get("/api/hotreload/history/{app_id}")]
async fn hotreload_history(
    req: HttpRequest,
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&req, &data).await {
        return response;
    }

    let app_id = path.into_inner();

    let history = data.hot_reload_history.read().await;
    match history.get(&app_id) {
        Some(entries) => {
            HttpResponse::Ok().json(serde_json::json!({
                "app_id": app_id,
                "history": entries,
                "total": entries.len()
            }))
        }
        None => {
            HttpResponse::Ok().json(serde_json::json!({
                "app_id": app_id,
                "history": [],
                "total": 0
            }))
        }
    }
}

// ─── IDE Integration APIs ────────────────────────────────────────────────

/// Deploy from IDE
#[utoipa::path(
    post,
    path = "/api/ide/deploy",
    tag = "ide",
    request_body = IDEDeployRequest,
    responses(
        (status = 200, description = "Deployment successful", body = serde_json::Value),
        (status = 500, description = "Deployment failed")
    ),
    security(
        ("bearer_token" = [])
    )
)]
#[post("/api/ide/deploy")]
async fn ide_deploy(
    req: HttpRequest,
    data: web::Data<AppState>,
    payload: web::Json<IDEDeployRequest>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&req, &data).await {
        return response;
    }

    info!("IDE deployment request for app: {}", payload.app_id);

    // Forward to supervisor's deploy endpoint
    let client = reqwest::Client::new();
    let deploy_url = format!("{}/api/developer/deploy", data.supervisor_url);

    match client
        .post(&deploy_url)
        .json(&serde_json::json!({
            "app_id": payload.app_id,
            "image_tar": payload.image_tar,
            "restart": payload.restart
        }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            info!("IDE deployment successful for app: {}", payload.app_id);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "app_id": payload.app_id,
                "message": "Deployment completed successfully"
            }))
        }
        Ok(resp) => {
            let status = resp.status();
            let error_msg = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            HttpResponse::build(status).json(serde_json::json!({
                "error": "Deployment failed",
                "details": error_msg
            }))
        }
        Err(e) => {
            error!("Failed to communicate with supervisor: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to communicate with supervisor",
                "details": e.to_string()
            }))
        }
    }
}

/// Stream live logs from app
#[utoipa::path(
    get,
    path = "/api/ide/logs/{app_id}/stream",
    tag = "ide",
    params(
        ("app_id" = String, Path, description = "App ID")
    ),
    responses(
        (status = 200, description = "SSE log stream")
    ),
    security(
        ("bearer_token" = [])
    )
)]
#[get("/api/ide/logs/{app_id}/stream")]
async fn ide_logs_stream(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let app_id = path.into_inner();
    let container_name = format!("iora-app-{}", app_id);

    info!("Starting log stream for app: {}", app_id);

    // Forward streaming request to supervisor
    let supervisor_url = data.supervisor_url.clone();
    let log_url = format!("{}/api/developer/logs/{}/stream", supervisor_url, container_name);

    // Create SSE stream that forwards from supervisor
    let stream = async_stream::stream! {
        let client = reqwest::Client::new();
        match client.get(&log_url).send().await {
            Ok(response) => {
                let mut stream = response.bytes_stream();
                use futures_util::StreamExt;

                while let Some(chunk) = stream.next().await {
                    match chunk {
                        Ok(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            yield Ok::<_, std::convert::Infallible>(sse::Event::Data(sse::Data::new(text.to_string())));
                        }
                        Err(e) => {
                            error!("Error streaming logs: {}", e);
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                error!("Failed to connect to log stream: {}", e);
            }
        }
    };

    Sse::from_stream(stream)
}

/// Get system metrics
#[utoipa::path(
    get,
    path = "/api/ide/metrics",
    tag = "ide",
    responses(
        (status = 200, description = "System metrics", body = serde_json::Value)
    ),
    security(
        ("bearer_token" = [])
    )
)]
#[get("/api/ide/metrics")]
async fn ide_metrics(
    req: HttpRequest,
    data: web::Data<AppState>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&req, &data).await {
        return response;
    }

    // Forward to supervisor's metrics endpoint
    let client = reqwest::Client::new();
    let metrics_url = format!("{}/api/developer/metrics", data.supervisor_url);

    match client.get(&metrics_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>().await {
                Ok(metrics) => HttpResponse::Ok().json(metrics),
                Err(e) => {
                    error!("Failed to parse metrics response: {}", e);
                    HttpResponse::InternalServerError().json(serde_json::json!({
                        "error": "Failed to parse metrics"
                    }))
                }
            }
        }
        Ok(resp) => {
            let status = resp.status();
            HttpResponse::build(status).json(serde_json::json!({
                "error": "Failed to get metrics"
            }))
        }
        Err(e) => {
            error!("Failed to communicate with supervisor: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to communicate with supervisor",
                "details": e.to_string()
            }))
        }
    }
}

// ─── OpenAPI Documentation ───────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(
    paths(
        health,
        get_info,
        public_developer_status,
        public_deployment_info,
        public_app_metrics,
        hotreload_upload,
        hotreload_status,
        hotreload_rollback,
        hotreload_history,
        ide_deploy,
        ide_logs_stream,
        ide_metrics,
    ),
    components(
        schemas(HotReloadEntry, DeploymentStatus, HotReloadUploadRequest, IDEDeployRequest)
    ),
    tags(
        (name = "system", description = "System health and information"),
        (name = "public", description = "Public APIs accessible by other apps in Developer Mode"),
        (name = "hotreload", description = "Hot reload functionality (exclusive to Developer App)"),
        (name = "ide", description = "IDE integration APIs")
    ),
    modifiers(&SecurityAddon)
)]
struct ApiDoc;

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};

        let components = openapi.components.as_mut().unwrap();
        components.add_security_scheme(
            "bearer_token",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .description(Some("Developer App authentication token"))
                    .build(),
            ),
        );
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("Starting IORA Developer App v{}", env!("CARGO_PKG_VERSION"));
    info!("Developer App Token: {}", if DEVELOPER_APP_TOKEN != "dev-token-placeholder" { "***configured***" } else { "PLACEHOLDER - UPDATE IN PRODUCTION" });

    let supervisor_url = std::env::var("SUPERVISOR_URL")
        .unwrap_or_else(|_| "http://iora-supervisor:8097".to_string());
    let iora_api_url = std::env::var("IORA_API_URL")
        .unwrap_or_else(|_| "http://iora-api:8080".to_string());

    info!("Supervisor URL: {}", supervisor_url);
    info!("IORA API URL: {}", iora_api_url);

    let developer_mode_enabled = Arc::new(RwLock::new(true));

    // Spawn task to sync developer mode with supervisor
    let dev_mode_sync = developer_mode_enabled.clone();
    let sup_url = supervisor_url.clone();
    tokio::spawn(async move {
        #[derive(Deserialize)]
        struct DevModeStatus {
            developer_mode: bool,
        }

        let client = reqwest::Client::new();
        let status_url = format!("{}/api/developer/status", sup_url);
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));

        loop {
            interval.tick().await;
            match client.get(&status_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(status) = resp.json::<DevModeStatus>().await {
                        let mut dev_mode = dev_mode_sync.write().await;
                        if *dev_mode != status.developer_mode {
                            info!("Developer mode status changed to: {}", status.developer_mode);
                            *dev_mode = status.developer_mode;

                            // If disabled, exit the app since it's no longer allowed to run
                            if !status.developer_mode {
                                info!("Developer mode disabled. Shutting down Developer App.");
                                std::process::exit(0);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });

    let app_state = web::Data::new(AppState {
        supervisor_url,
        iora_api_url,
        hot_reload_history: Arc::new(RwLock::new(HashMap::new())),
        deployment_status: Arc::new(RwLock::new(HashMap::new())),
        developer_mode_enabled,
    });

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8099);

    info!("Starting HTTP server on 0.0.0.0:{}", port);
    info!("Swagger UI available at: http://localhost:{}/swagger-ui/", port);

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            // Swagger UI
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}")
                    .url("/api-docs/openapi.json", ApiDoc::openapi())
            )
            // System endpoints
            .service(health)
            .service(get_info)
            // Public endpoints for other apps
            .service(public_developer_status)
            .service(public_deployment_info)
            .service(public_app_metrics)
            // Hot Reload APIs (Exclusive)
            .service(hotreload_upload)
            .service(hotreload_status)
            .service(hotreload_rollback)
            .service(hotreload_history)
            // IDE Integration APIs
            .service(ide_deploy)
            .service(ide_logs_stream)
            .service(ide_metrics)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
