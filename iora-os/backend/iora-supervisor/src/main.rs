use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, RestartContainerOptions,
    StartContainerOptions, StatsOptions, StopContainerOptions,
};
use bollard::image::{CreateImageOptions, ListImagesOptions};
use bollard::service::{ContainerStateStatusEnum, ContainerSummary, HostConfig};
use bollard::Docker;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::default::Default;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use futures_util::stream::TryStreamExt;

/// IORA Supervisor - Docker orchestration for IORA OS
///
/// This service runs as a privileged container with access to the Docker socket.
/// It manages all IORA service containers, handles health checks, restarts,
/// updates, and coordinates the entire IORA ecosystem.

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceDefinition {
    name: String,
    image: String,
    container_name: String,
    ports: Vec<String>,
    environment: HashMap<String, String>,
    volumes: Vec<String>,
    depends_on: Vec<String>,
    restart_policy: String,
    #[serde(default)]
    privileged: bool,
    #[serde(default)]
    cap_add: Vec<String>,
    #[serde(default)]
    security_opt: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ContainerStatus {
    name: String,
    state: String,
    status: String,
    image: String,
    created: i64,
    ports: Vec<String>,
    health: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SupervisorStatus {
    version: String,
    uptime_seconds: u64,
    total_containers: usize,
    running_containers: usize,
    stopped_containers: usize,
    docker_version: String,
}

#[derive(Debug, Deserialize)]
struct RestartRequest {
    container_name: String,
}

#[derive(Debug, Deserialize)]
struct UpdateRequest {
    service_name: String,
    image_tag: String,
}

struct AppState {
    docker: Docker,
    start_time: DateTime<Utc>,
    services: Arc<RwLock<HashMap<String, ServiceDefinition>>>,
}

/// Health check endpoint
#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "iora-supervisor",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Get supervisor status
#[get("/api/supervisor/status")]
async fn get_status(data: web::Data<AppState>) -> impl Responder {
    let docker_version = match data.docker.version().await {
        Ok(ver) => ver.version.unwrap_or_else(|| "unknown".to_string()),
        Err(_) => "error".to_string(),
    };

    let containers = match data
        .docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            filters: {
                let mut filters = HashMap::new();
                filters.insert("label".to_string(), vec!["iora.managed=true".to_string()]);
                filters
            },
            ..Default::default()
        }))
        .await
    {
        Ok(containers) => containers,
        Err(e) => {
            error!("Failed to list containers: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to list containers"
            }));
        }
    };

    let running = containers
        .iter()
        .filter(|c| c.state == Some("running".to_string()))
        .count();
    let stopped = containers.len() - running;

    let uptime = (Utc::now() - data.start_time).num_seconds() as u64;

    let status = SupervisorStatus {
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: uptime,
        total_containers: containers.len(),
        running_containers: running,
        stopped_containers: stopped,
        docker_version,
    };

    HttpResponse::Ok().json(status)
}

/// List all IORA containers
#[get("/api/supervisor/containers")]
async fn list_containers(data: web::Data<AppState>) -> impl Responder {
    let containers = match data
        .docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            filters: {
                let mut filters = HashMap::new();
                filters.insert("label".to_string(), vec!["iora.managed=true".to_string()]);
                filters
            },
            ..Default::default()
        }))
        .await
    {
        Ok(containers) => containers,
        Err(e) => {
            error!("Failed to list containers: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to list containers"
            }));
        }
    };

    let statuses: Vec<ContainerStatus> = containers
        .iter()
        .map(|c| ContainerStatus {
            name: c
                .names
                .as_ref()
                .and_then(|n| n.first())
                .map(|s| s.trim_start_matches('/').to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            state: c.state.clone().unwrap_or_else(|| "unknown".to_string()),
            status: c.status.clone().unwrap_or_else(|| "unknown".to_string()),
            image: c.image.clone().unwrap_or_else(|| "unknown".to_string()),
            created: c.created.unwrap_or(0),
            ports: c
                .ports
                .as_ref()
                .map(|ports| {
                    ports
                        .iter()
                        .map(|p| {
                            format!(
                                "{}:{}/{}",
                                p.public_port.unwrap_or(0),
                                p.private_port,
                                p.typ.as_ref().map(|s| format!("{:?}", s).to_lowercase()).unwrap_or_else(|| "tcp".to_string())
                            )
                        })
                        .collect()
                })
                .unwrap_or_default(),
            health: None, // Can be extended with actual health checks
        })
        .collect();

    HttpResponse::Ok().json(statuses)
}

/// Start a container
#[post("/api/supervisor/containers/{name}/start")]
async fn start_container(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let container_name = path.into_inner();

    match data
        .docker
        .start_container(&container_name, None::<StartContainerOptions<String>>)
        .await
    {
        Ok(_) => {
            info!("Started container: {}", container_name);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": format!("Container {} started", container_name)
            }))
        }
        Err(e) => {
            error!("Failed to start container {}: {}", container_name, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to start container: {}", e)
            }))
        }
    }
}

/// Stop a container
#[post("/api/supervisor/containers/{name}/stop")]
async fn stop_container(data: web::Data<AppState>, path: web::Path<String>) -> impl Responder {
    let container_name = path.into_inner();

    match data
        .docker
        .stop_container(&container_name, None::<StopContainerOptions>)
        .await
    {
        Ok(_) => {
            info!("Stopped container: {}", container_name);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": format!("Container {} stopped", container_name)
            }))
        }
        Err(e) => {
            error!("Failed to stop container {}: {}", container_name, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to stop container: {}", e)
            }))
        }
    }
}

/// Restart a container
#[post("/api/supervisor/containers/{name}/restart")]
async fn restart_container(data: web::Data<AppState>, path: web::Path<String>) -> impl Responder {
    let container_name = path.into_inner();

    match data
        .docker
        .restart_container(&container_name, None::<RestartContainerOptions>)
        .await
    {
        Ok(_) => {
            info!("Restarted container: {}", container_name);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": format!("Container {} restarted", container_name)
            }))
        }
        Err(e) => {
            error!("Failed to restart container {}: {}", container_name, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to restart container: {}", e)
            }))
        }
    }
}

/// Update a service (pull new image and recreate container)
#[post("/api/supervisor/services/update")]
async fn update_service(
    data: web::Data<AppState>,
    req: web::Json<UpdateRequest>,
) -> impl Responder {
    let image_name = format!("{}:{}", req.service_name, req.image_tag);

    info!("Pulling image: {}", image_name);

    // Pull new image
    let create_image_options = CreateImageOptions {
        from_image: image_name.clone(),
        ..Default::default()
    };

    match data
        .docker
        .create_image(Some(create_image_options), None, None)
        .try_collect::<Vec<_>>()
        .await
    {
        Ok(_) => {
            info!("Successfully pulled image: {}", image_name);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": format!("Image {} pulled. Manual container recreation required.", image_name)
            }))
        }
        Err(e) => {
            error!("Failed to pull image {}: {}", image_name, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to pull image: {}", e)
            }))
        }
    }
}

/// Get container logs
#[get("/api/supervisor/containers/{name}/logs")]
async fn get_logs(data: web::Data<AppState>, path: web::Path<String>) -> impl Responder {
    let container_name = path.into_inner();

    match data
        .docker
        .logs(
            &container_name,
            Some(bollard::container::LogsOptions::<String> {
                stdout: true,
                stderr: true,
                tail: "100".to_string(),
                ..Default::default()
            }),
        )
        .try_collect::<Vec<_>>()
        .await
    {
        Ok(logs) => {
            let log_text: String = logs
                .iter()
                .map(|log| log.to_string())
                .collect::<Vec<_>>()
                .join("\n");

            HttpResponse::Ok().json(serde_json::json!({
                "container": container_name,
                "logs": log_text
            }))
        }
        Err(e) => {
            error!("Failed to get logs for {}: {}", container_name, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to get logs: {}", e)
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

    info!("Starting IORA Supervisor v{}", env!("CARGO_PKG_VERSION"));

    // Connect to Docker
    let docker = match Docker::connect_with_socket_defaults() {
        Ok(docker) => docker,
        Err(e) => {
            error!("Failed to connect to Docker: {}", e);
            std::process::exit(1);
        }
    };

    info!("Connected to Docker successfully");

    // Verify Docker connection
    match docker.ping().await {
        Ok(_) => info!("Docker daemon is responsive"),
        Err(e) => {
            error!("Docker daemon not responding: {}", e);
            std::process::exit(1);
        }
    }

    let app_state = web::Data::new(AppState {
        docker,
        start_time: Utc::now(),
        services: Arc::new(RwLock::new(HashMap::new())),
    });

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8097);

    info!("Starting HTTP server on 0.0.0.0:{}", port);

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .service(health)
            .service(get_status)
            .service(list_containers)
            .service(start_container)
            .service(stop_container)
            .service(restart_container)
            .service(update_service)
            .service(get_logs)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
