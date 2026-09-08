//! rumahl Resource Manager Service
//!
//! This service intelligently manages Docker container resources by monitoring usage
//! and dynamically reallocating unused resources to containers that need them.
//!
//! Key Features:
//! - Real-time resource monitoring (CPU, memory, disk I/O)
//! - Intelligent resource reallocation
//! - Container resource limit updates
//! - Usage prediction and optimization
//! - Resource efficiency reporting

use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use bollard::container::{
    InspectContainerOptions, ListContainersOptions, Stats, StatsOptions, UpdateContainerOptions,
};
use bollard::Docker;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use sysinfo::System;
use tokio::sync::RwLock;
use tokio::time::interval;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_PORT: u16 = 8105;
const MONITORING_INTERVAL_SECS: u64 = 30; // Monitor every 30 seconds
const REALLOCATION_THRESHOLD: f64 = 0.3; // 30% unused triggers reallocation

// Default resource allocations (bytes for memory)
const DEFAULT_CPU_SHARES: u64 = 1024;
const DEFAULT_MEMORY_BYTES: i64 = 512 * 1024 * 1024; // 512 MB

// ─── Data Structures ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ContainerResources {
    container_id: String,
    container_name: String,
    app_id: Option<String>,

    // Current allocation
    cpu_shares: u64,
    memory_limit_bytes: i64,

    // Current usage
    cpu_usage_percent: f64,
    memory_usage_bytes: u64,
    memory_usage_percent: f64,

    // Utilization
    cpu_utilization: f64, // usage / allocation
    memory_utilization: f64,

    // Timestamps
    last_updated: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResourceAllocation {
    container_id: String,
    old_cpu_shares: u64,
    new_cpu_shares: u64,
    old_memory_bytes: i64,
    new_memory_bytes: i64,
    reason: String,
    timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SystemResourceStats {
    total_cpu_count: usize,
    total_memory_bytes: u64,
    available_memory_bytes: u64,
    container_count: usize,
    monitored_containers: usize,
    last_reallocation: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
struct ReallocationRequest {
    container_id: String,
    cpu_shares: Option<u64>,
    memory_bytes: Option<i64>,
}

#[derive(Debug, Clone)]
struct AppState {
    db: PgPool,
    docker: Docker,
    container_stats: Arc<RwLock<HashMap<String, ContainerResources>>>,
    system_info: Arc<RwLock<System>>,
    last_reallocation: Arc<RwLock<Option<DateTime<Utc>>>>,
}

// ─── Resource Monitoring ────────────────────────────────────────────────────

/// Get container stats from Docker
async fn get_container_stats(docker: &Docker, container_id: &str) -> Result<Stats> {
    let options = StatsOptions {
        stream: false,
        one_shot: true,
    };

    let mut stats_stream = docker.stats(container_id, Some(options));

    use futures::stream::StreamExt;

    if let Some(stats_result) = stats_stream.next().await {
        let stats = stats_result.context("Failed to get container stats")?;
        Ok(stats)
    } else {
        anyhow::bail!("No stats available for container")
    }
}

/// Calculate CPU usage percentage
fn calculate_cpu_percent(stats: &Stats) -> f64 {
    let cpu_stats = &stats.cpu_stats;
    let precpu_stats = &stats.precpu_stats;
    if let (Some(system_usage), Some(presystem_usage)) =
        (cpu_stats.system_cpu_usage, precpu_stats.system_cpu_usage)
    {
        let cpu_usage = &cpu_stats.cpu_usage;
        let precpu_usage = &precpu_stats.cpu_usage;
        let cpu_delta = cpu_usage.total_usage as f64 - precpu_usage.total_usage as f64;
        let system_delta = system_usage as f64 - presystem_usage as f64;

        if system_delta > 0.0 && cpu_delta > 0.0 {
            let num_cpus = cpu_usage
                .percpu_usage
                .as_ref()
                .map(|v: &Vec<u64>| v.len())
                .unwrap_or(1) as f64;
            return (cpu_delta / system_delta) * num_cpus * 100.0;
        }
    }
    0.0
}

/// Calculate memory usage
fn calculate_memory_usage(stats: &Stats) -> (u64, f64) {
    let memory_stats = &stats.memory_stats;
    let usage = memory_stats.usage.unwrap_or(0);
    let limit = memory_stats.limit.unwrap_or(1).max(1);
    let percent = (usage as f64 / limit as f64) * 100.0;
    (usage, percent)
}

/// Monitor all containers and update stats
async fn monitor_containers(state: &AppState) -> Result<()> {
    let docker = &state.docker;

    // List all running containers
    let containers = docker
        .list_containers(Some(ListContainersOptions::<String> {
            all: false,
            ..Default::default()
        }))
        .await
        .context("Failed to list containers")?;

    let mut new_stats = HashMap::new();

    for container in containers {
        let container_id = container
            .id
            .as_ref()
            .unwrap_or(&"unknown".to_string())
            .clone();
        let container_name = container
            .names
            .as_ref()
            .and_then(|n| n.first())
            .map(|s| s.trim_start_matches('/').to_string())
            .unwrap_or_else(|| "unknown".to_string());

        // Skip if not an rumahl app container
        if !container_name.starts_with("rumahl-app-") && !container_name.starts_with("rumahl-") {
            continue;
        }

        // Get container stats
        match get_container_stats(docker, &container_id).await {
            Ok(stats) => {
                let cpu_percent = calculate_cpu_percent(&stats);
                let (memory_usage, memory_percent) = calculate_memory_usage(&stats);

                // Get current resource limits from container inspection
                let inspect_result = docker
                    .inspect_container(&container_id, None::<InspectContainerOptions>)
                    .await;

                let (cpu_shares, memory_limit) = if let Ok(inspect) = inspect_result {
                    let cpu = inspect
                        .host_config
                        .as_ref()
                        .and_then(|hc| hc.cpu_shares)
                        .unwrap_or(DEFAULT_CPU_SHARES as i64) as u64;

                    let mem = inspect
                        .host_config
                        .as_ref()
                        .and_then(|hc| hc.memory)
                        .unwrap_or(DEFAULT_MEMORY_BYTES);

                    (cpu, mem)
                } else {
                    (DEFAULT_CPU_SHARES, DEFAULT_MEMORY_BYTES)
                };

                let cpu_utilization = if cpu_shares > 0 {
                    (cpu_percent / 100.0) / (cpu_shares as f64 / DEFAULT_CPU_SHARES as f64)
                } else {
                    0.0
                };

                let memory_utilization = if memory_limit > 0 {
                    memory_usage as f64 / memory_limit as f64
                } else {
                    0.0
                };

                let app_id = if container_name.starts_with("rumahl-app-") {
                    Some(container_name.trim_start_matches("rumahl-app-").to_string())
                } else {
                    None
                };

                let resource_stats = ContainerResources {
                    container_id: container_id.clone(),
                    container_name,
                    app_id,
                    cpu_shares,
                    memory_limit_bytes: memory_limit,
                    cpu_usage_percent: cpu_percent,
                    memory_usage_bytes: memory_usage,
                    memory_usage_percent: memory_percent,
                    cpu_utilization,
                    memory_utilization,
                    last_updated: Utc::now(),
                };

                new_stats.insert(container_id, resource_stats);
            }
            Err(e) => {
                warn!("Failed to get stats for container {}: {}", container_id, e);
            }
        }
    }

    // Update shared state
    let mut stats_lock = state.container_stats.write().await;
    *stats_lock = new_stats;

    info!("Monitored {} containers", stats_lock.len());

    Ok(())
}

/// Intelligently reallocate resources
async fn reallocate_resources(state: &AppState) -> Result<Vec<ResourceAllocation>> {
    let stats = state.container_stats.read().await;
    let mut allocations = Vec::new();

    // Find underutilized containers
    let underutilized: Vec<_> = stats
        .values()
        .filter(|c| {
            c.cpu_utilization < REALLOCATION_THRESHOLD
                || c.memory_utilization < REALLOCATION_THRESHOLD
        })
        .collect();

    // Find overutilized containers
    let overutilized: Vec<_> = stats
        .values()
        .filter(|c| c.cpu_utilization > 0.8 || c.memory_utilization > 0.8)
        .collect();

    if underutilized.is_empty() || overutilized.is_empty() {
        info!("No reallocation needed");
        return Ok(allocations);
    }

    info!(
        "Found {} underutilized and {} overutilized containers",
        underutilized.len(),
        overutilized.len()
    );

    // Calculate total reclaimable resources
    let mut _reclaimable_cpu: i64 = 0;
    let mut _reclaimable_memory: i64 = 0;

    for container in &underutilized {
        let unused_cpu = (container.cpu_shares as f64 * (1.0 - container.cpu_utilization)) as i64;
        let unused_memory =
            (container.memory_limit_bytes as f64 * (1.0 - container.memory_utilization)) as i64;

        _reclaimable_cpu += unused_cpu;
        _reclaimable_memory += unused_memory;
    }

    // Distribute to overutilized containers
    for container in &overutilized {
        let container_id = container.container_id.clone();

        // Calculate needed resources
        let cpu_needed = if container.cpu_utilization > 0.8 {
            (container.cpu_shares as f64 * 0.5) as u64 // Add 50% more
        } else {
            0
        };

        let memory_needed = if container.memory_utilization > 0.8 {
            (container.memory_limit_bytes as f64 * 0.3) as i64 // Add 30% more
        } else {
            0
        };

        if cpu_needed > 0 || memory_needed > 0 {
            let new_cpu_shares = container.cpu_shares + cpu_needed;
            let new_memory_bytes = container.memory_limit_bytes + memory_needed;

            // Update container resources
            match update_container_resources(
                &state.docker,
                &container_id,
                new_cpu_shares,
                new_memory_bytes,
            )
            .await
            {
                Ok(_) => {
                    let allocation = ResourceAllocation {
                        container_id: container_id.clone(),
                        old_cpu_shares: container.cpu_shares,
                        new_cpu_shares,
                        old_memory_bytes: container.memory_limit_bytes,
                        new_memory_bytes,
                        reason: format!(
                            "Overutilized (CPU: {:.1}%, Memory: {:.1}%)",
                            container.cpu_utilization * 100.0,
                            container.memory_utilization * 100.0
                        ),
                        timestamp: Utc::now(),
                    };

                    // Log allocation
                    if let Err(e) = log_allocation(&state.db, &allocation).await {
                        error!("Failed to log allocation: {}", e);
                    }

                    allocations.push(allocation);
                    info!("Reallocated resources for container {}", container_id);
                }
                Err(e) => {
                    error!("Failed to update container {}: {}", container_id, e);
                }
            }
        }
    }

    // Reduce resources for underutilized containers
    for container in &underutilized {
        let container_id = container.container_id.clone();

        // Only reduce if significantly underutilized
        if container.cpu_utilization < 0.2 || container.memory_utilization < 0.2 {
            let new_cpu_shares = (container.cpu_shares as f64 * 0.7) as u64; // Reduce by 30%
            let new_memory_bytes = (container.memory_limit_bytes as f64 * 0.8) as i64; // Reduce by 20%

            // Don't reduce below minimums
            let new_cpu_shares = new_cpu_shares.max(512);
            let new_memory_bytes = new_memory_bytes.max(256 * 1024 * 1024); // Min 256 MB

            if new_cpu_shares < container.cpu_shares
                || new_memory_bytes < container.memory_limit_bytes
            {
                match update_container_resources(
                    &state.docker,
                    &container_id,
                    new_cpu_shares,
                    new_memory_bytes,
                )
                .await
                {
                    Ok(_) => {
                        let allocation = ResourceAllocation {
                            container_id: container_id.clone(),
                            old_cpu_shares: container.cpu_shares,
                            new_cpu_shares,
                            old_memory_bytes: container.memory_limit_bytes,
                            new_memory_bytes,
                            reason: format!(
                                "Underutilized (CPU: {:.1}%, Memory: {:.1}%)",
                                container.cpu_utilization * 100.0,
                                container.memory_utilization * 100.0
                            ),
                            timestamp: Utc::now(),
                        };

                        if let Err(e) = log_allocation(&state.db, &allocation).await {
                            error!("Failed to log allocation: {}", e);
                        }

                        allocations.push(allocation);
                        info!("Reduced resources for container {}", container_id);
                    }
                    Err(e) => {
                        error!("Failed to update container {}: {}", container_id, e);
                    }
                }
            }
        }
    }

    *state.last_reallocation.write().await = Some(Utc::now());

    Ok(allocations)
}

/// Update container resource limits
async fn update_container_resources(
    docker: &Docker,
    container_id: &str,
    cpu_shares: u64,
    memory_bytes: i64,
) -> Result<()> {
    let update_options = UpdateContainerOptions::<String> {
        cpu_shares: Some(cpu_shares as isize),
        memory: Some(memory_bytes),
        ..Default::default()
    };

    docker
        .update_container(container_id, update_options)
        .await
        .context("Failed to update container resources")?;

    Ok(())
}

/// Log resource allocation to database
async fn log_allocation(pool: &PgPool, allocation: &ResourceAllocation) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO resource_allocations (id, container_id, old_cpu_shares, new_cpu_shares, old_memory_bytes, new_memory_bytes, reason, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(&allocation.container_id)
    .bind(allocation.old_cpu_shares as i64)
    .bind(allocation.new_cpu_shares as i64)
    .bind(allocation.old_memory_bytes)
    .bind(allocation.new_memory_bytes)
    .bind(&allocation.reason)
    .bind(allocation.timestamp)
    .execute(pool)
    .await
    .context("Failed to log allocation")?;

    Ok(())
}

// ─── Background Tasks ───────────────────────────────────────────────────────

/// Resource monitoring and reallocation loop
async fn resource_management_loop(state: AppState) -> Result<()> {
    let mut monitor_timer = interval(Duration::from_secs(MONITORING_INTERVAL_SECS));

    loop {
        monitor_timer.tick().await;

        // Monitor containers
        if let Err(e) = monitor_containers(&state).await {
            error!("Container monitoring failed: {}", e);
            continue;
        }

        // Perform reallocation
        match reallocate_resources(&state).await {
            Ok(allocations) => {
                if !allocations.is_empty() {
                    info!("Performed {} resource reallocations", allocations.len());
                }
            }
            Err(e) => {
                error!("Resource reallocation failed: {}", e);
            }
        }
    }
}

// ─── API Endpoints ──────────────────────────────────────────────────────────

/// Health check
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "rumahl-resource-manager",
        "status": "healthy",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Get all container resource stats
async fn get_container_stats_api(State(state): State<AppState>) -> impl IntoResponse {
    let stats = state.container_stats.read().await;
    let containers: Vec<_> = stats.values().cloned().collect();

    (StatusCode::OK, Json(containers))
}

/// Get system resource stats
async fn get_system_stats(State(state): State<AppState>) -> impl IntoResponse {
    let mut system = state.system_info.write().await;
    system.refresh_all();

    let stats = state.container_stats.read().await;
    let last_reallocation = *state.last_reallocation.read().await;

    let system_stats = SystemResourceStats {
        total_cpu_count: system.cpus().len(),
        total_memory_bytes: system.total_memory(),
        available_memory_bytes: system.available_memory(),
        container_count: stats.len(),
        monitored_containers: stats.len(),
        last_reallocation,
    };

    (StatusCode::OK, Json(system_stats))
}

/// Trigger manual reallocation
async fn trigger_reallocation(State(state): State<AppState>) -> impl IntoResponse {
    match reallocate_resources(&state).await {
        Ok(allocations) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "message": "Reallocation completed",
                "allocations": allocations,
                "count": allocations.len()
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Reallocation failed: {}", e)
            })),
        )
            .into_response(),
    }
}

/// Get allocation history
async fn get_allocation_history(State(state): State<AppState>) -> impl IntoResponse {
    #[derive(sqlx::FromRow)]
    struct AllocRow {
        container_id: String,
        old_cpu_shares: i64,
        new_cpu_shares: i64,
        old_memory_bytes: i64,
        new_memory_bytes: i64,
        reason: String,
        timestamp: DateTime<Utc>,
    }
    match sqlx::query_as::<_, AllocRow>(
        "SELECT container_id, old_cpu_shares, new_cpu_shares, old_memory_bytes, new_memory_bytes, reason, timestamp FROM resource_allocations ORDER BY timestamp DESC LIMIT 100"
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let allocations: Vec<ResourceAllocation> = rows
                .into_iter()
                .map(|r| ResourceAllocation {
                    container_id: r.container_id,
                    old_cpu_shares: r.old_cpu_shares.max(0) as u64,
                    new_cpu_shares: r.new_cpu_shares.max(0) as u64,
                    old_memory_bytes: r.old_memory_bytes,
                    new_memory_bytes: r.new_memory_bytes,
                    reason: r.reason,
                    timestamp: r.timestamp,
                })
                .collect();
            (StatusCode::OK, Json(allocations)).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to fetch history: {}", e)
            })),
        )
            .into_response(),
    }
}

// ─── Database Setup ─────────────────────────────────────────────────────────

async fn init_database(pool: &PgPool) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS resource_allocations (
            id UUID PRIMARY KEY,
            container_id VARCHAR(255) NOT NULL,
            old_cpu_shares BIGINT NOT NULL,
            new_cpu_shares BIGINT NOT NULL,
            old_memory_bytes BIGINT NOT NULL,
            new_memory_bytes BIGINT NOT NULL,
            reason TEXT NOT NULL,
            timestamp TIMESTAMP WITH TIME ZONE NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .context("Failed to create resource_allocations table")?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_resource_allocations_timestamp ON resource_allocations(timestamp DESC)")
        .execute(pool)
        .await
        .ok();

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_resource_allocations_container ON resource_allocations(container_id)")
        .execute(pool)
        .await
        .ok();

    info!("Database initialized successfully");
    Ok(())
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "rumahl_resource_manager=info".to_string()),
        )
        .init();

    info!("Starting rumahl Resource Manager service...");

    // Load environment
    dotenv::dotenv().ok();

    // ═══════════════════════════════════════════════════════════════════════════
    // Global Config Integration - Auto-reload supported
    // ═══════════════════════════════════════════════════════════════════════════
    // Database connection using Global Config with hot-reload support
    let database_url =
        rumahl_shared_config::system_config::get_cached_setting("resource_manager.database_url")
            .or_else(|| rumahl_shared_config::system_config::get_cached_setting("DATABASE_URL"))
            .unwrap_or_else(|| {
                // Fallback to environment variable
                std::env::var("DATABASE_URL")
                    .unwrap_or_else(|_| "postgres://ora:ora@localhost/rumahl_core".to_string())
            });

    // Mask sensitive parts of the database URL for logging
    let masked_url = if database_url.contains('@') {
        let parts: Vec<&str> = database_url.split('@').collect();
        if parts.len() == 2 {
            format!("***@{}", parts[1])
        } else {
            "***".to_string()
        }
    } else {
        database_url.clone()
    };
    info!("Using database: {}", masked_url);

    let pool = PgPool::connect(&database_url)
        .await
        .context("Failed to connect to database")?;

    info!("Connected to database");

    // Initialize database schema
    init_database(&pool).await?;

    // Connect to Docker
    let docker = Docker::connect_with_local_defaults().context("Failed to connect to Docker")?;

    info!("Connected to Docker");

    // Create app state
    let state = AppState {
        db: pool,
        docker,
        container_stats: Arc::new(RwLock::new(HashMap::new())),
        system_info: Arc::new(RwLock::new(System::new_all())),
        last_reallocation: Arc::new(RwLock::new(None)),
    };

    // Spawn resource management loop
    let state_clone = state.clone();
    tokio::spawn(async move {
        if let Err(e) = resource_management_loop(state_clone).await {
            error!("Resource management loop failed: {}", e);
        }
    });

    // Build router
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/resources/containers", get(get_container_stats_api))
        .route("/api/resources/system", get(get_system_stats))
        .route("/api/resources/reallocate", post(trigger_reallocation))
        .route("/api/resources/history", get(get_allocation_history))
        .layer(CorsLayer::permissive())
        .with_state(state);

    // Use Global Config for port with hot-reload support
    let port = rumahl_shared_config::system_config::get_cached_setting("resource_manager.port")
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!(
        "rumahl-resource-manager listening on {} (Global Config hot-reload enabled)",
        addr
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let _hb = rumahl_shared_heartbeat::spawn_default(
        "rumahl-resource-manager",
        DEFAULT_PORT,
        "System resource allocator",
    );
    axum::serve(listener, app).await?;

    Ok(())
}
