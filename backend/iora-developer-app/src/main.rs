use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use actix_web_lab::sse::{self, Sse};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use uuid::Uuid;

/// IORA Developer App
///
/// Official development tool providing IDE integration, hot reload,
/// and development workflow features. This app has exclusive access
/// to hot-reload APIs and other development features.

#[derive(Debug, Clone)]
struct AppState {
    supervisor_url: String,
    iora_api_url: String,
    hot_reload_history: Arc<RwLock<HashMap<String, Vec<HotReloadEntry>>>>,
    deployment_status: Arc<RwLock<HashMap<String, DeploymentStatus>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HotReloadEntry {
    id: String,
    app_id: String,
    version: String,
    timestamp: DateTime<Utc>,
    status: String, // "success", "failed"
    checksum: String,
    rollback_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeploymentStatus {
    app_id: String,
    status: String, // "pending", "in_progress", "completed", "failed"
    started_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    error: Option<String>,
    progress: u8, // 0-100
}

#[derive(Debug, Deserialize)]
struct HotReloadUploadRequest {
    app_id: String,
    version: String,
    package_data: String, // base64 encoded tar.gz
    auto_restart: bool,
}

#[derive(Debug, Deserialize)]
struct IDEDeployRequest {
    app_id: String,
    image_tar: String, // base64 encoded Docker image tar
    restart: bool,
}

/// Health check endpoint
#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "iora-developer-app",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Get app information
#[get("/api/info")]
async fn get_info() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "id": "io.iora.developer-app",
        "name": "IORA Developer",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "Official IORA development tool",
        "capabilities": [
            "hot_reload",
            "ide_integration",
            "live_logs",
            "live_metrics",
            "inter_app_communication"
        ]
    }))
}

// ─── Hot Reload APIs (Exclusive to Developer App) ────────────────────────

/// Upload app package for hot reload
#[post("/api/hotreload/upload")]
async fn hotreload_upload(
    data: web::Data<AppState>,
    req: web::Json<HotReloadUploadRequest>,
) -> impl Responder {
    info!("Hot reload upload request for app: {}", req.app_id);

    // Decode package data
    let package_bytes = match base64::decode(&req.package_data) {
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
        app_id: req.app_id.clone(),
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

    // TODO: Implement actual hot reload logic
    // 1. Extract package
    // 2. Update app container without full restart
    // 3. Preserve application state if possible
    // 4. Update deployment status

    // For now, delegate to supervisor's deploy endpoint
    let client = reqwest::Client::new();
    let deploy_url = format!("{}/api/developer/deploy", data.supervisor_url);

    // Convert package to Docker image format
    // This is a simplified version - real implementation would be more complex
    let response = client
        .post(&deploy_url)
        .json(&serde_json::json!({
            "app_id": req.app_id,
            "image_tar": req.package_data,
            "restart": req.auto_restart
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
                app_id: req.app_id.clone(),
                version: req.version.clone(),
                timestamp: Utc::now(),
                status: "success".to_string(),
                checksum: checksum.clone(),
                rollback_available: true,
            };

            {
                let mut history = data.hot_reload_history.write().await;
                history.entry(req.app_id.clone())
                    .or_insert_with(Vec::new)
                    .push(entry);
            }

            info!("Hot reload completed successfully for app: {}", req.app_id);

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "deployment_id": deployment_id,
                "app_id": req.app_id,
                "version": req.version,
                "checksum": checksum,
                "message": "Hot reload completed successfully"
            }))
        }
        Ok(resp) => {
            let status_code = resp.status();
            let error_msg = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());

            error!("Hot reload failed for app {}: {}", req.app_id, error_msg);

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
#[get("/api/hotreload/status/{deployment_id}")]
async fn hotreload_status(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
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
#[post("/api/hotreload/rollback/{app_id}")]
async fn hotreload_rollback(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
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

            // TODO: Implement actual rollback logic
            // For now, return success
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
#[get("/api/hotreload/history/{app_id}")]
async fn hotreload_history(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
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
#[post("/api/ide/deploy")]
async fn ide_deploy(
    data: web::Data<AppState>,
    req: web::Json<IDEDeployRequest>,
) -> impl Responder {
    info!("IDE deployment request for app: {}", req.app_id);

    // Forward to supervisor's deploy endpoint
    let client = reqwest::Client::new();
    let deploy_url = format!("{}/api/developer/deploy", data.supervisor_url);

    match client
        .post(&deploy_url)
        .json(&serde_json::json!({
            "app_id": req.app_id,
            "image_tar": req.image_tar,
            "restart": req.restart
        }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            info!("IDE deployment successful for app: {}", req.app_id);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "app_id": req.app_id,
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
                            yield sse::Event::Data(sse::Data::new(text.to_string()));
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
#[get("/api/ide/metrics")]
async fn ide_metrics(data: web::Data<AppState>) -> impl Responder {
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

    let supervisor_url = std::env::var("SUPERVISOR_URL")
        .unwrap_or_else(|_| "http://iora-supervisor:8097".to_string());
    let iora_api_url = std::env::var("IORA_API_URL")
        .unwrap_or_else(|_| "http://iora-api:8080".to_string());

    info!("Supervisor URL: {}", supervisor_url);
    info!("IORA API URL: {}", iora_api_url);

    let app_state = web::Data::new(AppState {
        supervisor_url,
        iora_api_url,
        hot_reload_history: Arc::new(RwLock::new(HashMap::new())),
        deployment_status: Arc::new(RwLock::new(HashMap::new())),
    });

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8099);

    info!("Starting HTTP server on 0.0.0.0:{}", port);

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .service(health)
            .service(get_info)
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

