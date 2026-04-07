use std::{sync::Arc, time::Instant};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get},
    Json, Router,
};
use chrono::Utc;
use sysinfo::System;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::info;

const IORA_CORE_URL: &str = "http://localhost:8090";
const IORA_HOME_URL: &str = "http://localhost:8080";

#[derive(Clone)]
struct AppState {
    http: reqwest::Client,
    config: Arc<RwLock<serde_json::Value>>,
    started_at: Arc<Instant>,
}

impl AppState {
    fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap(),
            config: Arc::new(RwLock::new(serde_json::json!({
                "theme": "dark",
                "language": "en",
                "notifications_enabled": true,
                "log_level": "info",
            }))),
            started_at: Arc::new(Instant::now()),
        }
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "iora-control",
        "status": "healthy",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn dashboard_overview(State(state): State<AppState>) -> Json<serde_json::Value> {
    let services = async {
        state
            .http
            .get(format!("{}/api/core/services", IORA_CORE_URL))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()
    }
    .await
    .unwrap_or_else(|| serde_json::json!({ "services": [], "total": 0 }));

    let plugins = async {
        state
            .http
            .get(format!("{}/api/core/plugins", IORA_CORE_URL))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()
    }
    .await
    .unwrap_or_else(|| serde_json::json!({ "plugins": [], "total": 0 }));

    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "services": services,
        "plugins": plugins,
        "control_uptime_seconds": state.started_at.elapsed().as_secs(),
    }))
}

async fn system_stats() -> Json<serde_json::Value> {
    let mut sys = System::new_all();
    sys.refresh_all();

    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "cpu_count": sys.cpus().len(),
        "cpu_usage_percent": if sys.cpus().is_empty() {
            0.0_f32
        } else {
            sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32
        },
        "memory_total_bytes": sys.total_memory(),
        "memory_used_bytes": sys.used_memory(),
        "memory_available_bytes": sys.available_memory(),
        "swap_total_bytes": sys.total_swap(),
        "swap_used_bytes": sys.used_swap(),
        "uptime_seconds": System::uptime(),
        "os_name": System::name().unwrap_or_default(),
        "os_version": System::os_version().unwrap_or_default(),
        "kernel_version": System::kernel_version().unwrap_or_default(),
        "hostname": System::host_name().unwrap_or_default(),
    }))
}

async fn list_services(State(state): State<AppState>) -> impl IntoResponse {
    match state
        .http
        .get(format!("{}/api/core/services", IORA_CORE_URL))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(body) => Json(body).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn aggregate_logs() -> Json<serde_json::Value> {
    // Placeholder – in production this would collect logs from all services
    Json(serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "message": "Log aggregation not yet implemented. Configure a log forwarder to aggregate logs from all IORA services.",
        "services": ["iora-home", "iora-core", "iora-control", "iora-assist"],
        "hint": "Set LOG_AGGREGATOR_URL in your environment to enable log forwarding.",
    }))
}

async fn list_plugins(State(state): State<AppState>) -> impl IntoResponse {
    match state
        .http
        .get(format!("{}/api/core/plugins", IORA_CORE_URL))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(body) => Json(body).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn install_plugin(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    match state
        .http
        .post(format!("{}/api/core/plugins", IORA_CORE_URL))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.json::<serde_json::Value>().await {
                Ok(b) => (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                    Json(b),
                )
                    .into_response(),
                Err(e) => (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": e.to_string() })),
                )
                    .into_response(),
            }
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn remove_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state
        .http
        .delete(format!("{}/api/core/plugins/{}", IORA_CORE_URL, id))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.json::<serde_json::Value>().await {
                Ok(b) => (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                    Json(b),
                )
                    .into_response(),
                Err(e) => (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": e.to_string() })),
                )
                    .into_response(),
            }
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-core unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn list_users(State(state): State<AppState>) -> impl IntoResponse {
    match state
        .http
        .get(format!("{}/api/users", IORA_HOME_URL))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(body) => Json(body).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("iora-home unreachable: {}", e) })),
        )
            .into_response(),
    }
}

async fn get_config(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config.read().await.clone();
    Json(cfg)
}

async fn update_config(
    State(state): State<AppState>,
    Json(updates): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let mut cfg = state.config.write().await;
    if let (Some(obj), Some(upd)) = (cfg.as_object_mut(), updates.as_object()) {
        for (k, v) in upd {
            obj.insert(k.clone(), v.clone());
        }
    }
    Json(cfg.clone())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_control=debug,info".parse().unwrap()),
        )
        .init();

    let state = AppState::new();

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/control/dashboard", get(dashboard_overview))
        .route("/api/control/system", get(system_stats))
        .route("/api/control/services", get(list_services))
        .route("/api/control/logs", get(aggregate_logs))
        .route("/api/control/plugins", get(list_plugins).post(install_plugin))
        .route("/api/control/plugins/:id", delete(remove_plugin))
        .route("/api/control/users", get(list_users))
        .route("/api/control/config", get(get_config).put(update_config))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8091));
    info!("iora-control listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
