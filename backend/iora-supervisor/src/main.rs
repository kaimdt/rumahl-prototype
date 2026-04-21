use actix_web::{get, post, put, web, App, HttpResponse, HttpServer, Responder};
use actix_web_lab::sse::{self, Sse};
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
use sysinfo::{System, Disks, Networks};
use tokio::sync::RwLock;
use tokio_stream::StreamExt as _;
use tracing::{error, info, warn};
use futures_util::stream::{self, Stream, TryStreamExt};
use std::time::Duration;
use std::pin::Pin;

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
    developer_mode: Arc<RwLock<bool>>,
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
                                p.typ.as_ref().map(|s| s.as_str()).unwrap_or("tcp")
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

#[derive(Debug, Clone, Serialize)]
struct SystemInfo {
    hostname: String,
    os_name: String,
    os_version: String,
    kernel_version: String,
    cpu_count: usize,
    cpu_usage: f32,
    total_memory: u64,
    used_memory: u64,
    available_memory: u64,
    memory_usage_percent: f32,
    disks: Vec<DiskInfo>,
    network_interfaces: Vec<NetworkInterfaceInfo>,
    uptime: u64,
}

#[derive(Debug, Clone, Serialize)]
struct DiskInfo {
    name: String,
    mount_point: String,
    total_space: u64,
    available_space: u64,
    used_space: u64,
    usage_percent: f32,
    file_system: String,
}

#[derive(Debug, Clone, Serialize)]
struct NetworkInterfaceInfo {
    name: String,
    mac_address: String,
    ip_addresses: Vec<String>,
    received_bytes: u64,
    transmitted_bytes: u64,
    is_up: bool,
}

#[derive(Debug, Deserialize)]
struct NetworkConfigRequest {
    interface: String,
    ip_address: Option<String>,
    netmask: Option<String>,
    gateway: Option<String>,
    dns_servers: Option<Vec<String>>,
}

/// Get system information
#[get("/api/supervisor/system/info")]
async fn get_system_info() -> impl Responder {
    let mut sys = System::new_all();
    sys.refresh_all();

    let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());
    let os_name = System::name().unwrap_or_else(|| "unknown".to_string());
    let os_version = System::os_version().unwrap_or_else(|| "unknown".to_string());
    let kernel_version = System::kernel_version().unwrap_or_else(|| "unknown".to_string());

    let cpu_count = sys.cpus().len();
    let cpu_usage = sys.global_cpu_info().cpu_usage();

    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let available_memory = sys.available_memory();
    let memory_usage_percent = if total_memory > 0 {
        (used_memory as f32 / total_memory as f32) * 100.0
    } else {
        0.0
    };

    // Disk information
    let disks = Disks::new_with_refreshed_list();
    let disk_info: Vec<DiskInfo> = disks
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let available = disk.available_space();
            let used = total - available;
            let usage_percent = if total > 0 {
                (used as f32 / total as f32) * 100.0
            } else {
                0.0
            };

            DiskInfo {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total_space: total,
                available_space: available,
                used_space: used,
                usage_percent,
                file_system: String::from_utf8_lossy(disk.file_system()).to_string(),
            }
        })
        .collect();

    // Network information
    let networks = Networks::new_with_refreshed_list();
    let network_info: Vec<NetworkInterfaceInfo> = networks
        .iter()
        .map(|(interface_name, data)| {
            NetworkInterfaceInfo {
                name: interface_name.to_string(),
                mac_address: data.mac_address().to_string(),
                ip_addresses: vec![], // sysinfo doesn't provide IP addresses directly
                received_bytes: data.total_received(),
                transmitted_bytes: data.total_transmitted(),
                is_up: true, // sysinfo doesn't provide interface status directly
            }
        })
        .collect();

    let uptime = System::uptime();

    let system_info = SystemInfo {
        hostname,
        os_name,
        os_version,
        kernel_version,
        cpu_count,
        cpu_usage,
        total_memory,
        used_memory,
        available_memory,
        memory_usage_percent,
        disks: disk_info,
        network_interfaces: network_info,
        uptime,
    };

    HttpResponse::Ok().json(system_info)
}

/// Get network configuration
#[get("/api/supervisor/network/interfaces")]
async fn get_network_interfaces() -> impl Responder {
    let networks = Networks::new_with_refreshed_list();

    let interfaces: Vec<serde_json::Value> = networks
        .iter()
        .map(|(name, data)| {
            serde_json::json!({
                "name": name,
                "mac_address": data.mac_address().to_string(),
                "received_bytes": data.total_received(),
                "transmitted_bytes": data.total_transmitted(),
                "received_packets": data.packets_received(),
                "transmitted_packets": data.packets_transmitted(),
                "errors_received": data.errors_on_received(),
                "errors_transmitted": data.errors_on_transmitted(),
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "interfaces": interfaces
    }))
}

/// Configure network interface (requires elevated privileges)
#[put("/api/supervisor/network/configure")]
async fn configure_network(req: web::Json<NetworkConfigRequest>) -> impl Responder {
    // Note: Network configuration typically requires root/elevated privileges
    // This is a placeholder that would need to interact with system networking
    // through tools like nmcli, netplan, or network manager

    info!("Network configuration request for interface: {}", req.interface);

    if let Some(ref ip) = req.ip_address {
        info!("  IP Address: {}", ip);
    }
    if let Some(ref netmask) = req.netmask {
        info!("  Netmask: {}", netmask);
    }
    if let Some(ref gateway) = req.gateway {
        info!("  Gateway: {}", gateway);
    }
    if let Some(ref dns) = req.dns_servers {
        info!("  DNS Servers: {:?}", dns);
    }

    // In a production environment, this would execute network configuration commands
    // For now, we just acknowledge the request
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Network configuration request received. Implementation requires system privileges.",
        "interface": req.interface,
        "note": "This feature requires IORA OS with proper system access."
    }))
}

// ─── App Management System ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppMetadata {
    id: String,
    name: String,
    version: String,
    description: String,
    author: String,
    icon: Option<String>,
    image: String,  // Docker image
    ports: Vec<String>,
    environment: HashMap<String, String>,
    volumes: Vec<String>,
    permissions: Vec<String>,
    enabled: bool,
    installed_at: String,
}

#[derive(Debug, Deserialize)]
struct InstallAppRequest {
    metadata: AppMetadata,
}

#[derive(Debug, Deserialize)]
struct UninstallAppRequest {
    app_id: String,
    remove_data: bool,
}

/// List all installed apps
#[get("/api/supervisor/apps")]
async fn list_apps(data: web::Data<AppState>) -> impl Responder {
    let containers = match data
        .docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            filters: {
                let mut filters = HashMap::new();
                filters.insert("label".to_string(), vec!["iora.type=app".to_string()]);
                filters
            },
            ..Default::default()
        }))
        .await
    {
        Ok(containers) => containers,
        Err(e) => {
            error!("Failed to list app containers: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to list apps"
            }));
        }
    };

    let apps: Vec<serde_json::Value> = containers
        .iter()
        .map(|c| {
            let labels = c.labels.as_ref();
            serde_json::json!({
                "id": labels.and_then(|l| l.get("iora.app.id")).unwrap_or(&"unknown".to_string()),
                "name": labels.and_then(|l| l.get("iora.app.name")).unwrap_or(&"unknown".to_string()),
                "version": labels.and_then(|l| l.get("iora.app.version")).unwrap_or(&"unknown".to_string()),
                "description": labels.and_then(|l| l.get("iora.app.description")).unwrap_or(&"".to_string()),
                "state": c.state.clone().unwrap_or_else(|| "unknown".to_string()),
                "status": c.status.clone().unwrap_or_else(|| "unknown".to_string()),
                "image": c.image.clone().unwrap_or_else(|| "unknown".to_string()),
                "container_id": c.id.clone().unwrap_or_else(|| "unknown".to_string()),
                "created": c.created.unwrap_or(0),
            })
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "apps": apps,
        "total": apps.len()
    }))
}

/// Install a new app (create and start container)
#[post("/api/supervisor/apps/install")]
async fn install_app(
    data: web::Data<AppState>,
    req: web::Json<InstallAppRequest>,
) -> impl Responder {
    let app = &req.metadata;

    info!("Installing app: {} ({})", app.name, app.id);

    // Pull the image first
    let create_image_options = CreateImageOptions {
        from_image: app.image.clone(),
        ..Default::default()
    };

    match data
        .docker
        .create_image(Some(create_image_options), None, None)
        .try_collect::<Vec<_>>()
        .await
    {
        Ok(_) => info!("Successfully pulled image: {}", app.image),
        Err(e) => {
            error!("Failed to pull image {}: {}", app.image, e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to pull image: {}", e)
            }));
        }
    }

    // Create labels for the container
    let mut labels = HashMap::new();
    labels.insert("iora.managed".to_string(), "true".to_string());
    labels.insert("iora.type".to_string(), "app".to_string());
    labels.insert("iora.app.id".to_string(), app.id.clone());
    labels.insert("iora.app.name".to_string(), app.name.clone());
    labels.insert("iora.app.version".to_string(), app.version.clone());
    labels.insert("iora.app.description".to_string(), app.description.clone());
    labels.insert("iora.app.author".to_string(), app.author.clone());

    // Create container configuration
    let container_name = format!("iora-app-{}", app.id);
    let config = Config {
        image: Some(app.image.clone()),
        labels: Some(labels),
        env: Some(
            app.environment
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect(),
        ),
        host_config: Some(HostConfig {
            binds: Some(app.volumes.clone()),
            restart_policy: Some(bollard::service::RestartPolicy {
                name: Some(bollard::service::RestartPolicyNameEnum::UNLESS_STOPPED),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    };

    // Create the container
    match data
        .docker
        .create_container(
            Some(CreateContainerOptions {
                name: container_name.clone(),
                ..Default::default()
            }),
            config,
        )
        .await
    {
        Ok(_) => {
            info!("Container created: {}", container_name);

            // Start the container if enabled
            if app.enabled {
                match data
                    .docker
                    .start_container(&container_name, None::<StartContainerOptions<String>>)
                    .await
                {
                    Ok(_) => {
                        info!("App {} started successfully", app.name);
                        HttpResponse::Ok().json(serde_json::json!({
                            "success": true,
                            "message": format!("App {} installed and started", app.name),
                            "app_id": app.id,
                            "container_name": container_name
                        }))
                    }
                    Err(e) => {
                        error!("Failed to start app {}: {}", app.name, e);
                        HttpResponse::Ok().json(serde_json::json!({
                            "success": true,
                            "message": format!("App {} installed but failed to start", app.name),
                            "app_id": app.id,
                            "container_name": container_name,
                            "warning": format!("Start failed: {}", e)
                        }))
                    }
                }
            } else {
                HttpResponse::Ok().json(serde_json::json!({
                    "success": true,
                    "message": format!("App {} installed (disabled)", app.name),
                    "app_id": app.id,
                    "container_name": container_name
                }))
            }
        }
        Err(e) => {
            error!("Failed to create container for app {}: {}", app.name, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to create container: {}", e)
            }))
        }
    }
}

/// Uninstall an app (stop and remove container)
#[post("/api/supervisor/apps/uninstall")]
async fn uninstall_app(
    data: web::Data<AppState>,
    req: web::Json<UninstallAppRequest>,
) -> impl Responder {
    let container_name = format!("iora-app-{}", req.app_id);

    info!("Uninstalling app: {}", req.app_id);

    // Stop the container first
    let _ = data
        .docker
        .stop_container(&container_name, None::<StopContainerOptions>)
        .await;

    // Remove the container
    match data
        .docker
        .remove_container(
            &container_name,
            Some(bollard::container::RemoveContainerOptions {
                v: req.remove_data,  // Remove volumes if requested
                force: true,
                ..Default::default()
            }),
        )
        .await
    {
        Ok(_) => {
            info!("App {} uninstalled successfully", req.app_id);
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": format!("App {} uninstalled", req.app_id)
            }))
        }
        Err(e) => {
            error!("Failed to uninstall app {}: {}", req.app_id, e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to uninstall app: {}", e)
            }))
        }
    }
}

/// Get app details
#[get("/api/supervisor/apps/{app_id}")]
async fn get_app_details(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let app_id = path.into_inner();
    let container_name = format!("iora-app-{}", app_id);

    match data.docker.inspect_container(&container_name, None).await {
        Ok(details) => HttpResponse::Ok().json(serde_json::json!({
            "app_id": app_id,
            "container": details
        })),
        Err(e) => {
            error!("Failed to get app details for {}: {}", app_id, e);
            HttpResponse::NotFound().json(serde_json::json!({
                "error": format!("App not found: {}", e)
            }))
        }
    }
}

// ─── Developer Mode APIs ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
struct DetailedAppInfo {
    id: String,
    name: String,
    version: String,
    description: String,
    author: String,
    image: String,
    state: String,
    status: String,
    container_id: String,
    container_name: String,
    created: i64,
    ports: Vec<String>,
    environment: HashMap<String, String>,
    volumes: Vec<String>,
    permissions: Vec<String>,
    labels: HashMap<String, String>,
    resource_usage: Option<ResourceUsage>,
}

#[derive(Debug, Clone, Serialize)]
struct ResourceUsage {
    cpu_percent: f64,
    memory_usage: u64,
    memory_limit: u64,
    memory_percent: f64,
    network_rx_bytes: u64,
    network_tx_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct InterAppCallRequest {
    target_app_id: String,
    method: String,
    endpoint: String,
    body: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct DeployRequest {
    app_id: String,
    image_tar: String,  // Base64 encoded tar archive
    restart: bool,
}

/// Check if Developer Mode is enabled
async fn check_developer_mode(data: &web::Data<AppState>) -> Result<(), HttpResponse> {
    let developer_mode = *data.developer_mode.read().await;
    if !developer_mode {
        return Err(HttpResponse::Forbidden().json(serde_json::json!({
            "error": "Developer Mode is not enabled",
            "message": "Enable Developer Mode in IORA Control Center to access this endpoint"
        })));
    }
    Ok(())
}

/// Get developer mode status
#[get("/api/developer/status")]
async fn get_developer_mode_status(data: web::Data<AppState>) -> impl Responder {
    let enabled = *data.developer_mode.read().await;
    HttpResponse::Ok().json(serde_json::json!({
        "developer_mode": enabled,
        "timestamp": Utc::now().to_rfc3339()
    }))
}

/// Toggle developer mode
#[post("/api/developer/toggle")]
async fn toggle_developer_mode(
    data: web::Data<AppState>,
    req: web::Json<serde_json::Value>,
) -> impl Responder {
    let enabled = req["enabled"].as_bool().unwrap_or(false);

    let mut dev_mode = data.developer_mode.write().await;
    *dev_mode = enabled;

    info!("Developer Mode {}", if enabled { "enabled" } else { "disabled" });

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "developer_mode": enabled,
        "message": format!("Developer Mode {}", if enabled { "enabled" } else { "disabled" })
    }))
}

/// List all apps with detailed information (Developer Mode only)
#[get("/api/developer/apps")]
async fn list_apps_detailed(data: web::Data<AppState>) -> impl Responder {
    if let Err(response) = check_developer_mode(&data).await {
        return response;
    }

    let containers = match data
        .docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            filters: {
                let mut filters = HashMap::new();
                filters.insert("label".to_string(), vec!["iora.type=app".to_string()]);
                filters
            },
            ..Default::default()
        }))
        .await
    {
        Ok(containers) => containers,
        Err(e) => {
            error!("Failed to list app containers: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to list apps"
            }));
        }
    };

    let mut detailed_apps = Vec::new();

    for container in containers {
        let container_id = container.id.clone().unwrap_or_default();
        let labels = container.labels.as_ref();

        // Extract environment variables from inspection
        let inspection = data.docker.inspect_container(&container_id, None).await.ok();
        let env_vars = inspection
            .as_ref()
            .and_then(|i| i.config.as_ref())
            .and_then(|c| c.env.as_ref())
            .map(|env| {
                env.iter()
                    .filter_map(|e| {
                        let parts: Vec<&str> = e.splitn(2, '=').collect();
                        if parts.len() == 2 {
                            Some((parts[0].to_string(), parts[1].to_string()))
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        let volumes = inspection
            .as_ref()
            .and_then(|i| i.host_config.as_ref())
            .and_then(|h| h.binds.as_ref())
            .cloned()
            .unwrap_or_default();

        // Get resource usage stats
        let resource_usage = match data.docker.stats(&container_id, Some(StatsOptions {
            stream: false,
            one_shot: true,
        }))
        .try_next()
        .await
        {
            Ok(Some(stats)) => {
                let cpu_percent = calculate_cpu_percent(&stats);
                let memory_usage = stats.memory_stats.usage.unwrap_or(0);
                let memory_limit = stats.memory_stats.limit.unwrap_or(0);
                let memory_percent = if memory_limit > 0 {
                    (memory_usage as f64 / memory_limit as f64) * 100.0
                } else {
                    0.0
                };

                let (network_rx, network_tx) = stats.networks.as_ref().map(|networks| {
                    networks.values().fold((0u64, 0u64), |acc, net| {
                        (
                            acc.0 + net.rx_bytes,
                            acc.1 + net.tx_bytes,
                        )
                    })
                }).unwrap_or((0, 0));

                Some(ResourceUsage {
                    cpu_percent,
                    memory_usage,
                    memory_limit,
                    memory_percent,
                    network_rx_bytes: network_rx,
                    network_tx_bytes: network_tx,
                })
            }
            _ => None,
        };

        let app_info = DetailedAppInfo {
            id: labels.and_then(|l| l.get("iora.app.id")).cloned().unwrap_or_else(|| "unknown".to_string()),
            name: labels.and_then(|l| l.get("iora.app.name")).cloned().unwrap_or_else(|| "unknown".to_string()),
            version: labels.and_then(|l| l.get("iora.app.version")).cloned().unwrap_or_else(|| "unknown".to_string()),
            description: labels.and_then(|l| l.get("iora.app.description")).cloned().unwrap_or_default(),
            author: labels.and_then(|l| l.get("iora.app.author")).cloned().unwrap_or_default(),
            image: container.image.clone().unwrap_or_else(|| "unknown".to_string()),
            state: container.state.clone().unwrap_or_else(|| "unknown".to_string()),
            status: container.status.clone().unwrap_or_else(|| "unknown".to_string()),
            container_id: container_id.clone(),
            container_name: container.names.as_ref()
                .and_then(|n| n.first())
                .map(|s| s.trim_start_matches('/').to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            created: container.created.unwrap_or(0),
            ports: container.ports.as_ref().map(|ports| {
                ports.iter().map(|p| {
                    format!("{}:{}/{}",
                        p.public_port.unwrap_or(0),
                        p.private_port,
                        p.typ.as_ref().map(|s| s.as_str()).unwrap_or("tcp"))
                }).collect()
            }).unwrap_or_default(),
            environment: env_vars,
            volumes,
            permissions: labels.and_then(|l| l.get("iora.app.permissions"))
                .and_then(|p| serde_json::from_str::<Vec<String>>(p).ok())
                .unwrap_or_default(),
            labels: labels.cloned().unwrap_or_default(),
            resource_usage,
        };

        detailed_apps.push(app_info);
    }

    HttpResponse::Ok().json(serde_json::json!({
        "apps": detailed_apps,
        "total": detailed_apps.len(),
        "developer_mode": true
    }))
}

/// Calculate CPU percentage from stats
fn calculate_cpu_percent(stats: &bollard::container::Stats) -> f64 {
    let cpu_delta = stats.cpu_stats.cpu_usage.total_usage as f64
        - stats.precpu_stats.cpu_usage.total_usage as f64;
    let system_delta = stats.cpu_stats.system_cpu_usage.unwrap_or(0) as f64
        - stats.precpu_stats.system_cpu_usage.unwrap_or(0) as f64;
    let online_cpus = stats.cpu_stats.online_cpus.unwrap_or(1) as f64;

    if system_delta > 0.0 && cpu_delta > 0.0 {
        (cpu_delta / system_delta) * online_cpus * 100.0
    } else {
        0.0
    }
}

/// Inter-app communication endpoint (Developer Mode only)
#[post("/api/developer/apps/call")]
async fn inter_app_call(
    data: web::Data<AppState>,
    req: web::Json<InterAppCallRequest>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&data).await {
        return response;
    }

    info!("Inter-app call: {} -> {}{}",
        req.method, req.target_app_id, req.endpoint);

    // Find target app container
    let container_name = format!("iora-app-{}", req.target_app_id);

    let inspection = match data.docker.inspect_container(&container_name, None).await {
        Ok(details) => details,
        Err(e) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": format!("Target app not found: {}", e)
            }));
        }
    };

    // Get the app's internal IP and port
    let network_settings = inspection.network_settings;
    let ip_address = network_settings
        .as_ref()
        .and_then(|ns| ns.ip_address.as_ref())
        .cloned()
        .unwrap_or_else(|| "localhost".to_string());

    // Construct the URL (assuming the app exposes an HTTP API)
    let url = format!("http://{}{}", ip_address, req.endpoint);

    // Make the HTTP request to the target app
    let client = reqwest::Client::new();
    let response = match req.method.to_uppercase().as_str() {
        "GET" => client.get(&url).send().await,
        "POST" => client.post(&url).json(&req.body).send().await,
        "PUT" => client.put(&url).json(&req.body).send().await,
        "DELETE" => client.delete(&url).send().await,
        _ => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Unsupported HTTP method"
            }));
        }
    };

    match response {
        Ok(resp) => {
            let status = resp.status();
            match resp.json::<serde_json::Value>().await {
                Ok(body) => HttpResponse::Ok().json(serde_json::json!({
                    "success": true,
                    "status": status.as_u16(),
                    "data": body
                })),
                Err(_) => HttpResponse::Ok().json(serde_json::json!({
                    "success": true,
                    "status": status.as_u16(),
                    "data": null
                })),
            }
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Failed to call target app: {}", e)
        })),
    }
}

/// Get live system metrics (Developer Mode only)
#[get("/api/developer/metrics")]
async fn get_live_metrics(data: web::Data<AppState>) -> impl Responder {
    if let Err(response) = check_developer_mode(&data).await {
        return response;
    }

    let mut sys = System::new_all();
    sys.refresh_all();

    // Get Docker stats
    let containers = data
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
        .unwrap_or_default();

    let total_containers = containers.len();
    let running_containers = containers.iter()
        .filter(|c| c.state == Some("running".to_string()))
        .count();

    HttpResponse::Ok().json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "system": {
            "cpu_usage": sys.global_cpu_info().cpu_usage(),
            "cpu_count": sys.cpus().len(),
            "memory_total": sys.total_memory(),
            "memory_used": sys.used_memory(),
            "memory_available": sys.available_memory(),
            "uptime": System::uptime(),
        },
        "containers": {
            "total": total_containers,
            "running": running_containers,
            "stopped": total_containers - running_containers,
        },
        "developer_mode": true
    }))
}

/// Deploy/update app from IDE (Developer Mode only)
#[post("/api/developer/deploy")]
async fn deploy_from_ide(
    data: web::Data<AppState>,
    req: web::Json<DeployRequest>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&data).await {
        return response;
    }

    info!("IDE deployment request for app: {}", req.app_id);

    // Decode base64 tar archive
    let tar_bytes = match base64::decode(&req.image_tar) {
        Ok(bytes) => bytes,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("Invalid base64 encoding: {}", e)
            }));
        }
    };

    // Load image into Docker
    match data.docker.import_image(
        bollard::image::ImportImageOptions { ..Default::default() },
        tar_bytes.into(),
        None,
    ).try_collect::<Vec<_>>().await {
        Ok(_) => {
            info!("Successfully loaded image for app: {}", req.app_id);

            // Restart container if requested
            if req.restart {
                let container_name = format!("iora-app-{}", req.app_id);
                let _ = data.docker.restart_container(&container_name, None::<RestartContainerOptions>).await;
                info!("Restarted app container: {}", container_name);
            }

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": format!("App {} deployed successfully", req.app_id),
                "restarted": req.restart
            }))
        }
        Err(e) => {
            error!("Failed to load image: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to load image: {}", e)
            }))
        }
    }
}

/// Stream live logs from container (Developer Mode only, SSE)
#[get("/api/developer/logs/{container_name}/stream")]
async fn stream_logs(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    if let Err(response) = check_developer_mode(&data).await {
        return response;
    }

    let container_name = path.into_inner();
    info!("Starting log stream for container: {}", container_name);

    let docker = data.docker.clone();

    let log_stream = async_stream::stream! {
        let mut log_stream = docker.logs(
            &container_name,
            Some(bollard::container::LogsOptions::<String> {
                follow: true,
                stdout: true,
                stderr: true,
                tail: "50".to_string(),
                ..Default::default()
            }),
        );

        while let Some(log_result) = log_stream.next().await {
            match log_result {
                Ok(log) => {
                    let log_text = log.to_string();
                    yield sse::Event::Data(sse::Data::new(log_text));
                }
                Err(e) => {
                    error!("Log stream error: {}", e);
                    break;
                }
            }
        }
    };

    Sse::from_stream(log_stream)
}

/// Stream live metrics (Developer Mode only, SSE)
#[get("/api/developer/metrics/stream")]
async fn stream_metrics(data: web::Data<AppState>) -> impl Responder {
    if let Err(response) = check_developer_mode(&data).await {
        return response;
    }

    info!("Starting metrics stream");

    let metrics_stream = async_stream::stream! {
        let mut interval = tokio::time::interval(Duration::from_secs(2));

        loop {
            interval.tick().await;

            let mut sys = System::new_all();
            sys.refresh_all();

            let metrics = serde_json::json!({
                "timestamp": Utc::now().to_rfc3339(),
                "cpu_usage": sys.global_cpu_info().cpu_usage(),
                "memory_used": sys.used_memory(),
                "memory_total": sys.total_memory(),
            });

            yield sse::Event::Data(sse::Data::new(metrics.to_string()));
        }
    };

    Sse::from_stream(metrics_stream)
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
        developer_mode: Arc::new(RwLock::new(false)),
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
            .service(get_system_info)
            .service(get_network_interfaces)
            .service(configure_network)
            .service(list_apps)
            .service(install_app)
            .service(uninstall_app)
            .service(get_app_details)
            // Developer Mode endpoints
            .service(get_developer_mode_status)
            .service(toggle_developer_mode)
            .service(list_apps_detailed)
            .service(inter_app_call)
            .service(get_live_metrics)
            .service(deploy_from_ide)
            .service(stream_logs)
            .service(stream_metrics)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
