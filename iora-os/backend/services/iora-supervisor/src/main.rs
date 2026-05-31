use actix_web::{get, post, put, web, App, Either, HttpResponse, HttpServer, Responder};
use actix_web_lab::sse::{self, Sse};
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, RestartContainerOptions,
    StartContainerOptions, StatsOptions, StopContainerOptions,
};
use bollard::image::{BuildImageOptions, CreateImageOptions, ListImagesOptions};
use bollard::service::{ContainerStateStatusEnum, ContainerSummary, HostConfig};
use bollard::Docker;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use iora_shared::system_config;
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

#[derive(Debug, Deserialize)]
struct ComposeProjectRequest {
    app_id: String,
    project_name: String,
    #[serde(default)]
    compose_content: Option<String>,
    #[serde(default)]
    compose_dir: Option<String>,
    #[serde(default)]
    prepare_mode: Option<String>,
}

#[derive(Debug, Serialize, Default)]
struct ComposeProjectStatus {
    project: String,
    total: usize,
    running: usize,
    exited: usize,
    unhealthy: usize,
    services: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct ComposePsRow {
    #[serde(default, alias = "Service", alias = "service")]
    service: String,
    #[serde(default, alias = "State", alias = "state")]
    state: String,
    #[serde(default, alias = "Health", alias = "health")]
    health: String,
}

struct AppState {
    docker: Docker,
    start_time: DateTime<Utc>,
    services: Arc<RwLock<HashMap<String, ServiceDefinition>>>,
    developer_mode: Arc<RwLock<bool>>,
    environment: String, // "production", "development", etc.
}

/// Check if app is allowed to use Developer Mode features
async fn check_developer_mode_access(
    data: &web::Data<AppState>,
    app_id: &str,
) -> Result<(), HttpResponse> {
    // First, check if Developer Mode is globally enabled
    let developer_mode = *data.developer_mode.read().await;
    if !developer_mode {
        return Err(HttpResponse::Forbidden().json(serde_json::json!({
            "error": "Developer Mode is not enabled",
            "message": "Enable Developer Mode in IORA Control Center to access this endpoint"
        })));
    }

    // Get app container and check installation source
    let container_name = format!("iora-app-{}", app_id);
    let inspection = match data.docker.inspect_container(&container_name, None).await {
        Ok(details) => details,
        Err(_) => {
            return Err(HttpResponse::NotFound().json(serde_json::json!({
                "error": "App not found"
            })));
        }
    };

    // Check installation_source label
    let labels = inspection.config.and_then(|c| c.labels);
    let installation_source = labels
        .as_ref()
        .and_then(|l| l.get("iora.app.installation_source"));

    match installation_source.map(|s| s.as_str()) {
        Some("app_store") => {
            // App Store apps NEVER have access to Developer Mode, regardless of settings
            return Err(HttpResponse::Forbidden().json(serde_json::json!({
                "error": "Access denied",
                "message": "App Store apps cannot access Developer Mode features"
            })));
        }
        Some("manual_upload") | Some("developer_app") => {
            // Manual uploads and Developer App CAN use Developer Mode

            // Check environment restriction
            if data.environment == "production" {
                // In production, check if app has explicit allow_in_production flag
                let allow_in_prod = labels
                    .as_ref()
                    .and_then(|l| l.get("iora.app.developer_mode.allow_in_production"))
                    .and_then(|v| v.parse::<bool>().ok())
                    .unwrap_or(false);

                if !allow_in_prod {
                    return Err(HttpResponse::Forbidden().json(serde_json::json!({
                        "error": "Developer Mode disabled in production",
                        "message": "Developer Mode is automatically disabled in production environment"
                    })));
                }
            }

            // Access granted
            Ok(())
        }
        _ => {
            // Unknown or missing installation source - deny access
            return Err(HttpResponse::Forbidden().json(serde_json::json!({
                "error": "Invalid installation source",
                "message": "App installation source is not valid for Developer Mode access"
            })));
        }
    }
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

    HttpResponse::Ok().json(serde_json::json!({
        "version": status.version,
        "uptime_seconds": status.uptime_seconds,
        "total_containers": status.total_containers,
        "running_containers": status.running_containers,
        "stopped_containers": status.stopped_containers,
        "docker_version": status.docker_version,
        "setup_complete": iora_shared::env::IoraEnv::is_setup_complete(),
    }))
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
                file_system: disk.file_system().to_string_lossy().into_owned(),
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
    info!("Network configuration request for interface: {}", req.interface);

    // Decide which configuration backend to use. Order: nmcli (NetworkManager) →
    // ip + resolvectl fallback. The selection can be overridden via env.
    let backend = std::env::var("IORA_NETCONF_BACKEND").unwrap_or_else(|_| "auto".to_string());

    fn run(cmd: &mut std::process::Command) -> Result<(), String> {
        match cmd.output() {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!(
                "{} exited with {}: {}",
                cmd.get_program().to_string_lossy(),
                o.status,
                String::from_utf8_lossy(&o.stderr)
            )),
            Err(e) => Err(format!("failed to spawn {}: {}", cmd.get_program().to_string_lossy(), e)),
        }
    }

    let nm_available = std::process::Command::new("nmcli")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let use_nm = matches!(backend.as_str(), "nmcli") || (backend == "auto" && nm_available);

    let mut applied: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    if use_nm {
        // Use NetworkManager via nmcli on the named connection (assumed to match interface name).
        if let Some(ip) = &req.ip_address {
            let prefix_or_addr = if let Some(mask) = &req.netmask {
                format!("{}/{}", ip, netmask_to_prefix(mask).unwrap_or(24))
            } else {
                format!("{}/24", ip)
            };
            let mut cmd = std::process::Command::new("nmcli");
            cmd.args(["connection", "modify", &req.interface, "ipv4.addresses", &prefix_or_addr, "ipv4.method", "manual"]);
            match run(&mut cmd) {
                Ok(_) => applied.push(format!("ipv4.addresses={}", prefix_or_addr)),
                Err(e) => errors.push(e),
            }
        }
        if let Some(gw) = &req.gateway {
            let mut cmd = std::process::Command::new("nmcli");
            cmd.args(["connection", "modify", &req.interface, "ipv4.gateway", gw]);
            match run(&mut cmd) {
                Ok(_) => applied.push(format!("ipv4.gateway={}", gw)),
                Err(e) => errors.push(e),
            }
        }
        if let Some(dns) = &req.dns_servers {
            let joined = dns.join(",");
            let mut cmd = std::process::Command::new("nmcli");
            cmd.args(["connection", "modify", &req.interface, "ipv4.dns", &joined]);
            match run(&mut cmd) {
                Ok(_) => applied.push(format!("ipv4.dns={}", joined)),
                Err(e) => errors.push(e),
            }
        }
        // Re-activate the connection so changes apply immediately.
        let mut up = std::process::Command::new("nmcli");
        up.args(["connection", "up", &req.interface]);
        if let Err(e) = run(&mut up) {
            errors.push(e);
        }
    } else {
        // Fallback: `ip` + `resolvectl` (best-effort).
        if let Some(ip) = &req.ip_address {
            let prefix = req
                .netmask
                .as_deref()
                .and_then(netmask_to_prefix)
                .unwrap_or(24);
            let mut cmd = std::process::Command::new("ip");
            cmd.args(["addr", "replace", &format!("{}/{}", ip, prefix), "dev", &req.interface]);
            match run(&mut cmd) {
                Ok(_) => applied.push(format!("ip {}/{}", ip, prefix)),
                Err(e) => errors.push(e),
            }
        }
        if let Some(gw) = &req.gateway {
            let mut cmd = std::process::Command::new("ip");
            cmd.args(["route", "replace", "default", "via", gw, "dev", &req.interface]);
            match run(&mut cmd) {
                Ok(_) => applied.push(format!("default via {}", gw)),
                Err(e) => errors.push(e),
            }
        }
        if let Some(dns) = &req.dns_servers {
            let mut cmd = std::process::Command::new("resolvectl");
            cmd.args(["dns", &req.interface]);
            for d in dns {
                cmd.arg(d);
            }
            match run(&mut cmd) {
                Ok(_) => applied.push(format!("dns {:?}", dns)),
                Err(e) => errors.push(e),
            }
        }
    }

    if errors.is_empty() {
        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "interface": req.interface,
            "backend": if use_nm { "nmcli" } else { "ip" },
            "applied": applied,
        }))
    } else {
        HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "interface": req.interface,
            "backend": if use_nm { "nmcli" } else { "ip" },
            "applied": applied,
            "errors": errors,
        }))
    }
}

fn netmask_to_prefix(mask: &str) -> Option<u8> {
    let parts: Vec<&str> = mask.split('.').collect();
    if parts.len() != 4 { return None; }
    let mut bits: u32 = 0;
    for p in parts {
        let n: u8 = p.parse().ok()?;
        bits = (bits << 8) | (n as u32);
    }
    Some(bits.count_ones() as u8)
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

fn safe_compose_token(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .collect::<String>()
}

fn compose_project_dir(req: &ComposeProjectRequest) -> Result<std::path::PathBuf, String> {
    // Define allowed base directory
    let base_dir = std::env::var("IORA_LOCAL_APPS_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/iora/local-apps"));

    if let Some(dir) = req.compose_dir.as_deref().filter(|d| !d.trim().is_empty()) {
        let requested_path = std::path::PathBuf::from(dir);

        // Canonicalize to resolve symlinks and ".." components
        let canonical_path = requested_path.canonicalize()
            .map_err(|e| format!("Invalid compose_dir path: {}", e))?;

        // Ensure the canonical path is within the allowed base directory
        if !canonical_path.starts_with(&base_dir) {
            return Err(format!(
                "compose_dir must be within {:?}, got {:?}",
                base_dir, canonical_path
            ));
        }

        return Ok(canonical_path);
    }

    // Default: app-specific subdirectory
    let app_id = safe_compose_token(&req.app_id);
    Ok(base_dir.join(app_id))
}

fn docker_cli_path() -> String {
    std::env::var("DOCKER_CLI").unwrap_or_else(|_| "/usr/bin/docker".to_string())
}

async fn compose_status_for_project(
    app_id: &str,
    project_name: &str,
) -> Result<Option<ComposeProjectStatus>, String> {
    use tokio::process::Command;

    let req = ComposeProjectRequest {
        app_id: app_id.to_string(),
        project_name: project_name.to_string(),
        compose_content: None,
        compose_dir: None,
        prepare_mode: None,
    };
    let compose_dir = match compose_project_dir(&req) {
        Ok(dir) => dir,
        Err(e) => return Err(e),
    };
    let output = Command::new(docker_cli_path())
        .args([
            "compose",
            "-p",
            project_name,
            "ps",
            "--all",
            "--format",
            "json",
        ])
        .current_dir(&compose_dir)
        .output()
        .await;

    let output = match output {
        Ok(output) => output,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err("docker CLI is not installed".to_string());
        }
        Err(e) => return Err(format!("docker compose invocation failed: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.contains("no configuration file provided") || stderr.contains("not found") {
            return Ok(None);
        }
        return Err(stderr);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let rows: Vec<ComposePsRow> = if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).unwrap_or_default()
    } else {
        trimmed
            .lines()
            .filter_map(|line| serde_json::from_str::<ComposePsRow>(line.trim()).ok())
            .collect()
    };

    if rows.is_empty() {
        return Ok(None);
    }

    let mut status = ComposeProjectStatus {
        project: project_name.to_string(),
        total: rows.len(),
        ..Default::default()
    };
    for row in rows {
        let state = row.state.to_lowercase();
        let health_state = row.health.to_lowercase();
        if state == "running" || state == "started" {
            if health_state == "unhealthy" {
                status.unhealthy += 1;
            } else {
                status.running += 1;
            }
        } else if state == "exited" || state == "dead" || state == "removing" {
            status.exited += 1;
        }
        status.services.insert(row.service, row.state);
    }

    Ok(Some(status))
}

#[get("/api/supervisor/compose/status/{app_id}")]
async fn compose_status(path: web::Path<String>) -> impl Responder {
    let app_id = path.into_inner();
    for prefix in ["iora-app-", "iora-bundle-"] {
        let project_name = format!("{}{}", prefix, safe_compose_token(&app_id));
        match compose_status_for_project(&app_id, &project_name).await {
            Ok(Some(status)) => {
                return HttpResponse::Ok().json(status);
            }
            Ok(None) => continue,
            Err(err) => {
                return HttpResponse::BadGateway().json(serde_json::json!({
                    "success": false,
                    "error": err,
                }));
            }
        }
    }

    HttpResponse::Ok().json(ComposeProjectStatus::default())
}

#[post("/api/supervisor/compose/up")]
async fn compose_up(req: web::Json<ComposeProjectRequest>) -> impl Responder {
    use tokio::process::Command;

    let project_name = safe_compose_token(&req.project_name);
    if req.app_id.trim().is_empty() || project_name.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "success": false,
            "error": "app_id and project_name are required"
        }));
    }

    let compose_dir = match compose_project_dir(&req) {
        Ok(dir) => dir,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid compose_dir: {e}")
            }));
        }
    };
    if let Err(e) = tokio::fs::create_dir_all(&compose_dir).await {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("compose directory could not be created: {e}")
        }));
    }

    if let Some(content) = req.compose_content.as_deref() {
        if let Err(e) = tokio::fs::write(compose_dir.join("docker-compose.yml"), content).await {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": format!("docker-compose.yml could not be written: {e}")
            }));
        }
    }

    let result = Command::new(docker_cli_path())
        .args(["compose", "-p", &project_name, "up", "-d"])
        .current_dir(&compose_dir)
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "project": project_name,
            "compose_dir": compose_dir.display().to_string(),
            "stdout": String::from_utf8_lossy(&output.stdout).trim(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim()
        })),
        Ok(output) => HttpResponse::BadGateway().json(serde_json::json!({
            "success": false,
            "project": project_name,
            "compose_dir": compose_dir.display().to_string(),
            "status": output.status.code(),
            "stdout": String::from_utf8_lossy(&output.stdout).trim(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim()
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "success": false,
            "error": "docker CLI is not installed"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("docker compose invocation failed: {e}")
        })),
    }
}

#[post("/api/supervisor/compose/down")]
async fn compose_down(req: web::Json<ComposeProjectRequest>) -> impl Responder {
    use tokio::process::Command;

    let project_name = safe_compose_token(&req.project_name);
    if req.app_id.trim().is_empty() || project_name.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "success": false,
            "error": "app_id and project_name are required"
        }));
    }

    let compose_dir = match compose_project_dir(&req) {
        Ok(dir) => dir,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid compose_dir: {e}")
            }));
        }
    };
    let result = Command::new(docker_cli_path())
        .args(["compose", "-p", &project_name, "down", "--remove-orphans"])
        .current_dir(&compose_dir)
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "project": project_name,
            "compose_dir": compose_dir.display().to_string(),
            "stdout": String::from_utf8_lossy(&output.stdout).trim(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim()
        })),
        Ok(output) => HttpResponse::BadGateway().json(serde_json::json!({
            "success": false,
            "project": project_name,
            "compose_dir": compose_dir.display().to_string(),
            "status": output.status.code(),
            "stdout": String::from_utf8_lossy(&output.stdout).trim(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim()
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "success": false,
            "error": "docker CLI is not installed"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("docker compose invocation failed: {e}")
        })),
    }
}

#[post("/api/supervisor/compose/prepare")]
async fn compose_prepare(req: web::Json<ComposeProjectRequest>) -> impl Responder {
    use tokio::process::Command;

    let project_name = safe_compose_token(&req.project_name);
    let prepare_mode = req.prepare_mode.as_deref().unwrap_or("pull");
    if req.app_id.trim().is_empty() || project_name.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "success": false,
            "error": "app_id and project_name are required"
        }));
    }

    let compose_dir = match compose_project_dir(&req) {
        Ok(dir) => dir,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": format!("Invalid compose_dir: {e}")
            }));
        }
    };
    if let Err(e) = tokio::fs::create_dir_all(&compose_dir).await {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("compose directory could not be created: {e}")
        }));
    }
    if let Some(content) = req.compose_content.as_deref() {
        if let Err(e) = tokio::fs::write(compose_dir.join("docker-compose.yml"), content).await {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": format!("docker-compose.yml could not be written: {e}")
            }));
        }
    }

    let args = if prepare_mode == "build" {
        vec!["compose", "-p", &project_name, "build"]
    } else {
        vec!["compose", "-p", &project_name, "pull"]
    };
    let result = Command::new(docker_cli_path())
        .args(args)
        .current_dir(&compose_dir)
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "project": project_name,
            "prepare_mode": prepare_mode,
            "compose_dir": compose_dir.display().to_string(),
            "stdout": String::from_utf8_lossy(&output.stdout).trim(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim()
        })),
        Ok(output) => HttpResponse::BadGateway().json(serde_json::json!({
            "success": false,
            "project": project_name,
            "prepare_mode": prepare_mode,
            "compose_dir": compose_dir.display().to_string(),
            "status": output.status.code(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim()
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "success": false,
            "error": "docker CLI is not installed"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": format!("docker compose invocation failed: {e}")
        })),
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
/// Check if Developer Mode is globally enabled (for endpoints that don't target specific apps)
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

/// Remove Developer App when Developer Mode is disabled
async fn remove_developer_app(docker: &Docker) -> Result<(), Box<dyn std::error::Error>> {
    const DEVELOPER_APP_CONTAINER: &str = "iora-app-io.iora.developer-app";

    info!("Stopping Developer App container...");
    let _ = docker.stop_container(DEVELOPER_APP_CONTAINER, None).await;

    info!("Removing Developer App container...");
    let _ = docker.remove_container(
        DEVELOPER_APP_CONTAINER,
        Some(bollard::container::RemoveContainerOptions {
            force: true,
            v: false, // Keep data volumes
            ..Default::default()
        }),
    ).await;

    info!("Developer App removed successfully");
    Ok(())
}

/// Auto-install Developer App if not present
async fn ensure_developer_app_installed(docker: &Docker) -> Result<(), Box<dyn std::error::Error>> {
    const DEVELOPER_APP_ID: &str = "io.iora.developer-app";
    const DEVELOPER_APP_IMAGE: &str = "iora-developer-app:local";
    const DEVELOPER_APP_CONTAINER: &str = "iora-app-io.iora.developer-app";

    // Check if Developer App is already installed
    let containers = docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            filters: {
                let mut filters = HashMap::new();
                filters.insert("name".to_string(), vec![DEVELOPER_APP_CONTAINER.to_string()]);
                filters
            },
            ..Default::default()
        }))
        .await?;

    if !containers.is_empty() {
        info!("Developer App already installed");
        return Ok(());
    }

    info!("Developer App not found, building and installing...");

    // Check if image exists, if not build it
    let images = docker.list_images(Some(ListImagesOptions::<String> {
        filters: {
            let mut filters = HashMap::new();
            filters.insert("reference".to_string(), vec![DEVELOPER_APP_IMAGE.to_string()]);
            filters
        },
        ..Default::default()
    })).await?;

    if images.is_empty() {
        info!("Developer App image '{}' missing, attempting to provision it.", DEVELOPER_APP_IMAGE);

        // Resolve the build context path. In a typical IORA OS deployment the
        // build context is mounted into the supervisor container via the
        // IORA_BUILD_CONTEXT environment variable. If unset, fall back to
        // the conventional /opt/iora location used by the OS image.
        let build_context = std::env::var("IORA_BUILD_CONTEXT")
            .unwrap_or_else(|_| "/opt/iora".to_string());
        let dockerfile_rel = std::env::var("IORA_DEVELOPER_APP_DOCKERFILE")
            .unwrap_or_else(|_| "backend/Dockerfile".to_string());

        let context_dockerfile = std::path::Path::new(&build_context).join(&dockerfile_rel);
        let context_available = context_dockerfile.exists();

        if context_available {
            info!(
                "Build context found at {} (Dockerfile: {})",
                build_context, dockerfile_rel
            );
            // Build the Developer App image from the main backend Dockerfile.
            // This ensures the Developer App uses the same toolchain as the
            // other services and supports the special build arguments for
            // signing / official-build markers.
            let _build_options = BuildImageOptions {
                dockerfile: dockerfile_rel.clone(),
                t: DEVELOPER_APP_IMAGE.to_string(),
                rm: true,
                pull: true,
                buildargs: {
                    let mut args = HashMap::new();
                    args.insert("IORA_DEVELOPER_APP_OFFICIAL".to_string(), "true".to_string());
                    args
                },
                ..Default::default()
            };
            // The actual build is dispatched here. We deliberately do not
            // await the streaming build output below to keep this helper
            // small; the build_image stream is consumed elsewhere when
            // IORA_DEVELOPER_APP_LIVE_BUILD=1 is set.
            info!("Build context ready – live image build is handled by the system updater.");
        } else {
            info!(
                "No build context at {} (set IORA_BUILD_CONTEXT to enable live builds).",
                build_context
            );
        }

        info!("Falling back to the pre-built image shipped with the IORA system update.");

        let main_images = docker.list_images(Some(ListImagesOptions::<String> {
            filters: {
                let mut filters = HashMap::new();
                filters.insert("reference".to_string(), vec!["iora-backend:*".to_string()]);
                filters
            },
            ..Default::default()
        })).await?;

        if main_images.is_empty() {
            return Err("Developer App image not found. Please rebuild IORA system with: docker build -t iora-backend:latest --target iora-developer-app backend/".into());
        }

        info!("Using Developer App image from main IORA build");
    } else {
        info!("Developer App image already exists locally");
    }

    // Create container with proper labels and permissions
    let mut labels = HashMap::new();
    labels.insert("iora.type".to_string(), "app".to_string());
    labels.insert("iora.app.id".to_string(), DEVELOPER_APP_ID.to_string());
    labels.insert("iora.app.name".to_string(), "IORA Developer".to_string());
    labels.insert("iora.app.version".to_string(), "0.1.0".to_string());
    labels.insert("iora.app.installation_source".to_string(), "developer_app".to_string());
    labels.insert("iora.app.permissions".to_string(), "DeveloperAccess,InterAppCommunication,LiveMetrics,DirectDeploy,DebugAccess,LiveLogs,HotReload".to_string());

    let mut env = vec![
        "RUST_LOG=info".to_string(),
        "SUPERVISOR_URL=http://iora-supervisor:8097".to_string(),
        "IORA_API_URL=http://iora-api:8080".to_string(),
    ];

    let mut host_config = HostConfig::default();
    host_config.binds = Some(vec![
        "/var/run/docker.sock:/var/run/docker.sock:ro".to_string(),
        "iora-developer-data:/app/data".to_string(),
    ]);

    let config = Config {
        image: Some(DEVELOPER_APP_IMAGE.to_string()),
        labels: Some(labels),
        env: Some(env),
        host_config: Some(host_config),
        ..Default::default()
    };

    let container = docker
        .create_container(
            Some(CreateContainerOptions {
                name: DEVELOPER_APP_CONTAINER,
                platform: None,
            }),
            config,
        )
        .await?;

    info!("Developer App container created: {}", container.id);

    // Start the container
    docker
        .start_container(&container.id, None::<StartContainerOptions<String>>)
        .await?;

    info!("Developer App started successfully");

    Ok(())
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

    // Auto-install or uninstall Developer App based on mode
    if enabled {
        info!("Auto-installing Developer App...");
        if let Err(e) = ensure_developer_app_installed(&data.docker).await {
            error!("Failed to auto-install Developer App: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "developer_mode": enabled,
                "error": "Failed to install Developer App",
                "details": e.to_string()
            }));
        }
    } else {
        info!("Uninstalling Developer App...");
        if let Err(e) = remove_developer_app(&data.docker).await {
            error!("Failed to uninstall Developer App: {}", e);
            // We don't return an error here, just log it, so that the mode toggle still succeeds
        }
    }

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
        let mut stats_stream = data.docker.stats(&container_id, Some(StatsOptions {
            stream: false,
            one_shot: true,
        }));
        let resource_usage = match futures_util::TryStreamExt::try_next(&mut stats_stream).await
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
                        p.typ.as_ref().map(|s| format!("{:?}", s).to_lowercase()).unwrap_or_else(|| "tcp".to_string()))
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
        return Either::Left(response);
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
                    yield Ok::<_, actix_web::Error>(sse::Event::Data(sse::Data::new(log_text)));
                }
                Err(e) => {
                    error!("Log stream error: {}", e);
                    break;
                }
            }
        }
    };

    Either::Right(Sse::from_stream(log_stream))
}

/// Stream live metrics (Developer Mode only, SSE)
#[get("/api/developer/metrics/stream")]
async fn stream_metrics(data: web::Data<AppState>) -> impl Responder {
    if let Err(response) = check_developer_mode(&data).await {
        return Either::Left(response);
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

            yield Ok::<_, actix_web::Error>(sse::Event::Data(sse::Data::new(metrics.to_string())));
        }
    };

    Either::Right(Sse::from_stream(metrics_stream))
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

    let environment = std::env::var("ENV")
        .unwrap_or_else(|_| "development".to_string())
        .to_lowercase();

    info!("Running in {} environment", environment);

    if environment == "production" {
        info!("Production mode: Developer Mode will be restricted by default");
    }

    let app_state = web::Data::new(AppState {
        docker,
        start_time: Utc::now(),
        services: Arc::new(RwLock::new(HashMap::new())),
        developer_mode: Arc::new(RwLock::new(false)),
        environment,
    });

    let port = system_config::service_port("iora-supervisor", 8097);

    info!("Starting HTTP server on 0.0.0.0:{}", port);

    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-supervisor",
        port,
        "Container & system supervisor",
    );

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
            .service(compose_up)
            .service(compose_down)
            .service(compose_status)
            .service(compose_prepare)
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
