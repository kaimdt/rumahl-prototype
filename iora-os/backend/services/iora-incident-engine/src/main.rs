mod correlator;
mod model;
use anyhow::Result;
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use correlator::{IncidentStore, INCIDENT_CAPACITY, REVISION_CAPACITY, TIMELINE_CAPACITY};
use model::{
    CorrelationInput, IncidentRecord, LifecycleRequest, CORRELATOR_VERSION, INCIDENT_SCHEMA,
};
use serde_json::json;
use std::{sync::Arc, time::Instant};
use tokio::sync::RwLock;
use tracing::info;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    incidents: Arc<RwLock<IncidentStore>>,
    started_at: Instant,
}
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let journal = std::env::var("IORA_INCIDENT_JOURNAL")
        .unwrap_or_else(|_| "/var/lib/iora-incidents/incidents.jsonl".into());
    let state = AppState {
        incidents: Arc::new(RwLock::new(
            IncidentStore::load_journal(journal).map_err(anyhow::Error::msg)?,
        )),
        started_at: Instant::now(),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/runtime/incidents", get(list))
        .route("/api/runtime/incidents/correlate", post(correlate))
        .route("/api/runtime/incidents/:id", get(get_incident))
        .route("/api/runtime/incidents/:id/state", post(transition))
        .route("/api/runtime/incidents/metrics", get(metrics))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .with_state(state);
    let port = iora_shared_config::system_config::service_port("iora-incident-engine", 8109);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let _heartbeat = iora_shared_heartbeat::spawn_default(
        "iora-incident-engine",
        port,
        "Read-only runtime incident correlation",
    );
    info!(port, "IORA incident engine started");
    axum::serve(listener, app).await?;
    Ok(())
}
async fn correlate(
    State(state): State<AppState>,
    Json(input): Json<CorrelationInput>,
) -> Result<Json<IncidentRecord>, (StatusCode, String)> {
    state
        .incidents
        .write()
        .await
        .ingest(input)
        .map(Json)
        .map_err(|error| (StatusCode::UNPROCESSABLE_ENTITY, error))
}
async fn list(State(state): State<AppState>) -> Json<Vec<IncidentRecord>> {
    Json(state.incidents.read().await.list())
}
async fn get_incident(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<IncidentRecord>, StatusCode> {
    state
        .incidents
        .read()
        .await
        .get(&id)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}
async fn transition(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<LifecycleRequest>,
) -> Result<Json<IncidentRecord>, (StatusCode, String)> {
    state
        .incidents
        .write()
        .await
        .transition(id, request)
        .map(Json)
        .map_err(|error| (StatusCode::UNPROCESSABLE_ENTITY, error))
}
async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(
        json!({"status":"healthy","incident_schema":INCIDENT_SCHEMA,"correlator_version":CORRELATOR_VERSION,"enforcement":false,"uptime_seconds":state.started_at.elapsed().as_secs()}),
    )
}
async fn metrics(State(state): State<AppState>) -> Json<serde_json::Value> {
    let store = state.incidents.read().await;
    let m = &store.metrics;
    Json(
        json!({"incident_capacity":INCIDENT_CAPACITY,"revision_capacity":REVISION_CAPACITY,"timeline_capacity":TIMELINE_CAPACITY,"created":m.created,"correlated":m.correlated,"deduplicated":m.deduplicated,"evicted":m.evicted,"timeline_dropped":m.timeline_dropped,"lifecycle_updates":m.lifecycle_updates}),
    )
}
