// IORA Resource Manager - minimal compiling stub.
// Original implementation preserved as src/main.rs.broken.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde_json::json;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::info;

#[derive(Clone)]
struct AppState {
    started_at: chrono::DateTime<chrono::Utc>,
}

async fn health() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "service": "iora-resource-manager",
            "status": "healthy",
            "implementation": "stub",
            "timestamp": Utc::now().to_rfc3339(),
        })),
    )
}

async fn list_containers(State(_s): State<Arc<AppState>>) -> impl IntoResponse {
    (StatusCode::OK, Json(json!([])))
}

async fn system_stats(State(s): State<Arc<AppState>>) -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "implementation": "stub",
            "started_at": s.started_at.to_rfc3339(),
            "container_count": 0,
            "monitored_containers": 0,
            "last_reallocation": serde_json::Value::Null,
        })),
    )
}

async fn trigger_reallocation() -> impl IntoResponse {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "error": "not_implemented",
            "message": "iora-resource-manager is currently a stub. Reallocation is disabled.",
        })),
    )
}

async fn allocation_history() -> impl IntoResponse {
    (StatusCode::OK, Json(json!([])))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8101);

    let state = Arc::new(AppState {
        started_at: Utc::now(),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/resources/containers", get(list_containers))
        .route("/api/resources/system", get(system_stats))
        .route("/api/resources/reallocate", post(trigger_reallocation))
        .route("/api/resources/history", get(allocation_history))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!("Starting IORA Resource Manager (stub) on {}", addr);

    let listener = TcpListener::bind(&addr).await?;
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-resource-manager",
        port,
        "System resource allocator",
    );
    axum::serve(listener, app).await?;

    Ok(())
}
