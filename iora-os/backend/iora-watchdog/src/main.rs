use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}};

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sysinfo::System;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt as _;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};

// ─── State ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    services: Arc<RwLock<HashMap<String, ServiceStatus>>>,
    events_tx: broadcast::Sender<WatchdogEvent>,
    started_at: Arc<Instant>,
    core_is_down: Arc<RwLock<bool>>,
    system: Arc<RwLock<System>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceStatus {
    name: String,
    url: String,
    status: String,  // healthy, degraded, unhealthy, unreachable
    response_time_ms: Option<u64>,
    last_check: String,
    last_success: Option<String>,
    consecutive_failures: u32,
    uptime_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WatchdogEvent {
    event_type: String,
    service_name: Option<String>,
    severity: String,  // info, warning, critical
    message: String,
    timestamp: String,
}

#[derive(Debug, Deserialize)]
struct RegisterServiceRequest {
    name: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct HeartbeatRequest {
    service_name: String,
    status: Option<String>,
}

#[derive(Debug, Serialize)]
struct SystemMetrics {
    cpu_usage_percent: f32,
    memory_used_mb: u64,
    memory_total_mb: u64,
    memory_percent: f32,
    timestamp: String,
}

// ─── Health Checking ─────────────────────────────────────────────────────────

async fn check_service_health(url: &str) -> (String, Option<u64>) {
    let start = Instant::now();
    let health_url = format!("{}/health", url.trim_end_matches('/'));

    match tokio::time::timeout(
        Duration::from_secs(5),
        reqwest::get(&health_url)
    ).await {
        Ok(Ok(response)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            if response.status().is_success() {
                ("healthy".to_string(), Some(elapsed))
            } else {
                ("unhealthy".to_string(), Some(elapsed))
            }
        }
        Ok(Err(_)) => ("unreachable".to_string(), None),
        Err(_) => ("unreachable".to_string(), None),
    }
}

async fn health_check_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(10));

    loop {
        interval.tick().await;

        let services = state.services.read().await.clone();

        for (name, mut service) in services {
            let (new_status, response_time) = check_service_health(&service.url).await;

            let now = Utc::now().to_rfc3339();
            let was_healthy = service.status == "healthy";
            let is_healthy = new_status == "healthy";

            service.status = new_status.clone();
            service.response_time_ms = response_time;
            service.last_check = now.clone();

            if is_healthy {
                service.last_success = Some(now.clone());
                if service.consecutive_failures > 0 {
                    // Service recovered
                    warn!("Service {} recovered", name);
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "service_recovered".to_string(),
                        service_name: Some(name.clone()),
                        severity: "info".to_string(),
                        message: format!("Service {} is now healthy", name),
                        timestamp: now.clone(),
                    });
                }
                service.consecutive_failures = 0;
            } else {
                service.consecutive_failures += 1;

                if was_healthy && !is_healthy {
                    // Service just went down
                    error!("Service {} is now {}", name, new_status);
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "service_down".to_string(),
                        service_name: Some(name.clone()),
                        severity: "critical".to_string(),
                        message: format!("Service {} is {}", name, new_status),
                        timestamp: now.clone(),
                    });
                }
            }

            // Check for iora-core specifically
            if name == "iora-core" {
                let mut core_down = state.core_is_down.write().await;
                let was_core_down = *core_down;
                *core_down = !is_healthy;

                if !was_core_down && *core_down {
                    error!("CRITICAL: iora-core is down! Watchdog taking over event bus");
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "core_down".to_string(),
                        service_name: Some("iora-core".to_string()),
                        severity: "critical".to_string(),
                        message: "Core orchestrator is down - watchdog is now handling events".to_string(),
                        timestamp: now.clone(),
                    });
                } else if was_core_down && !*core_down {
                    info!("iora-core recovered - returning event bus control");
                    let _ = state.events_tx.send(WatchdogEvent {
                        event_type: "core_recovered".to_string(),
                        service_name: Some("iora-core".to_string()),
                        severity: "info".to_string(),
                        message: "Core orchestrator has recovered".to_string(),
                        timestamp: now,
                    });
                }
            }

            state.services.write().await.insert(name, service);
        }
    }
}

async fn system_metrics_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));

    loop {
        interval.tick().await;

        let mut sys = state.system.write().await;
        sys.refresh_cpu();
        sys.refresh_memory();
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services = state.services.read().await;
    let healthy_count = services.values().filter(|s| s.status == "healthy").count();
    let total_count = services.len();

    Json(serde_json::json!({
        "service": "iora-watchdog",
        "status": "healthy",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
        "monitored_services": total_count,
        "healthy_services": healthy_count,
        "core_is_down": *state.core_is_down.read().await,
    }))
}

async fn health_text(State(state): State<AppState>) -> impl IntoResponse {
    let services = state.services.read().await;
    let healthy_count = services.values().filter(|s| s.status == "healthy").count();
    let total_count = services.len();
    let core_is_down = *state.core_is_down.read().await;
    let status_text = if healthy_count == total_count && !core_is_down {
        "healthy"
    } else if healthy_count > 0 {
        "degraded"
    } else {
        "unhealthy"
    };

    let body = format!(
        "service: iora-watchdog\nstatus: {}\nuptime_seconds: {}\nmonitored_services: {}\nhealthy_services: {}\ncore_is_down: {}\ntimestamp: {}\n",
        status_text,
        state.started_at.elapsed().as_secs(),
        total_count,
        healthy_count,
        core_is_down,
        Utc::now().to_rfc3339(),
    );

    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        body,
    )
}

async fn get_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services: Vec<ServiceStatus> = state.services.read().await.values().cloned().collect();

    Json(serde_json::json!({
        "services": services,
        "total": services.len(),
        "core_is_down": *state.core_is_down.read().await,
    }))
}

async fn list_services(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services: Vec<ServiceStatus> = state.services.read().await.values().cloned().collect();

    Json(serde_json::json!({
        "services": services,
        "total": services.len(),
    }))
}

async fn register_service(
    State(state): State<AppState>,
    Json(req): Json<RegisterServiceRequest>,
) -> impl IntoResponse {
    let service_status = ServiceStatus {
        name: req.name.clone(),
        url: req.url.clone(),
        status: "unknown".to_string(),
        response_time_ms: None,
        last_check: Utc::now().to_rfc3339(),
        last_success: None,
        consecutive_failures: 0,
        uptime_percent: 100.0,
    };

    state.services.write().await.insert(req.name.clone(), service_status);

    info!("Registered service: {} at {}", req.name, req.url);

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "message": "Service registered with watchdog",
            "name": req.name,
        })),
    )
}

async fn receive_heartbeat(
    State(state): State<AppState>,
    Json(req): Json<HeartbeatRequest>,
) -> impl IntoResponse {
    let mut services = state.services.write().await;

    if let Some(service) = services.get_mut(&req.service_name) {
        service.last_check = Utc::now().to_rfc3339();
        if let Some(status) = req.status {
            service.status = status;
        }
        if service.status == "healthy" {
            service.last_success = Some(Utc::now().to_rfc3339());
            service.consecutive_failures = 0;
        }

        Json(serde_json::json!({
            "message": "Heartbeat received",
            "service": req.service_name,
        }))
    } else {
        Json(serde_json::json!({
            "error": "Service not registered",
            "service": req.service_name,
        }))
    }
}

async fn get_metrics(State(state): State<AppState>) -> Json<SystemMetrics> {
    let sys = state.system.read().await;

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let memory_used = sys.used_memory() / 1024 / 1024;  // Convert to MB
    let memory_total = sys.total_memory() / 1024 / 1024;
    let memory_percent = if memory_total > 0 {
        (memory_used as f32 / memory_total as f32) * 100.0
    } else {
        0.0
    };

    Json(SystemMetrics {
        cpu_usage_percent: cpu_usage,
        memory_used_mb: memory_used,
        memory_total_mb: memory_total,
        memory_percent,
        timestamp: Utc::now().to_rfc3339(),
    })
}

async fn events_stream(
    State(state): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.events_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| match result {
        Ok(event) => {
            let json = serde_json::to_string(&event).ok()?;
            Some(Ok(Event::default().data(json)))
        }
        Err(_) => None,
    });

    Sse::new(stream)
}

async fn broadcast_event(
    State(state): State<AppState>,
    Json(event): Json<WatchdogEvent>,
) -> impl IntoResponse {
    let _ = state.events_tx.send(event);

    Json(serde_json::json!({
        "message": "Event broadcasted"
    }))
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    let (events_tx, _) = broadcast::channel(1000);

    let state = AppState {
        services: Arc::new(RwLock::new(HashMap::new())),
        events_tx,
        started_at: Arc::new(Instant::now()),
        core_is_down: Arc::new(RwLock::new(false)),
        system: Arc::new(RwLock::new(System::new())),
    };

    // Start background health checking
    tokio::spawn(health_check_loop(state.clone()));
    tokio::spawn(system_metrics_loop(state.clone()));

    let app = Router::new()
        .route("/health", get(health))
        .route("/health/text", get(health_text))
        .route("/api/watchdog/health", get(health))
        .route("/api/watchdog/health/text", get(health_text))
        .route("/api/watchdog/status", get(get_status))
        .route("/api/watchdog/services", get(list_services).post(register_service))
        .route("/api/watchdog/heartbeat", post(receive_heartbeat))
        .route("/api/watchdog/metrics", get(get_metrics))
        .route("/api/watchdog/events", get(events_stream).post(broadcast_event))
        .layer(CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("WATCHDOG_PORT").unwrap_or_else(|_| "8094".to_string());
    let addr = format!("0.0.0.0:{}", port);

    info!("👁️  iora-watchdog starting on {}", addr);
    info!("Monitoring services every 10 seconds");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
