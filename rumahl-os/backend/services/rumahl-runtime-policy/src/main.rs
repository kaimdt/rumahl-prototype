mod detection;
mod profile;
use anyhow::Result;
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    routing::{get, post},
    Json, Router,
};
use detection::{evaluate, DetectionResult, EvaluationRequest};
use profile::{Observation, ObservationStore, ProfileSnapshot, ProfileStore};
use serde_json::json;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use tokio::sync::RwLock;
use tracing::info;

#[derive(Clone)]
struct AppState {
    profiles: Arc<RwLock<ProfileStore>>,
    observations: Arc<RwLock<ObservationStore>>,
    evaluations: Arc<AtomicU64>,
    started_at: Instant,
}
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let profiles = load_profiles("/etc/ora/security-profiles")?;
    let state = AppState {
        profiles: Arc::new(RwLock::new(profiles)),
        observations: Arc::new(RwLock::new(ObservationStore::default())),
        evaluations: Arc::new(AtomicU64::new(0)),
        started_at: Instant::now(),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/runtime/profiles/:subject/snapshot", get(snapshot))
        .route("/api/runtime/profiles/observations", post(observe))
        .route("/api/runtime/detections/evaluate", post(evaluate_handler))
        .route("/api/runtime/policy/metrics", get(metrics))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .with_state(state);
    let port = rumahl_shared_config::system_config::service_port("rumahl-runtime-policy", 8108);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let _heartbeat = rumahl_shared_heartbeat::spawn_default(
        "rumahl-runtime-policy",
        port,
        "Read-only profiles and runtime detection",
    );
    info!(port, "rumahl runtime policy engine started");
    axum::serve(listener, app).await?;
    Ok(())
}
fn load_profiles(path: &str) -> Result<ProfileStore> {
    let mut store = ProfileStore::default();
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(store),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let profile = serde_json::from_slice(&std::fs::read(entry.path())?)?;
        store.insert(profile).map_err(anyhow::Error::msg)?;
    }
    Ok(store)
}
async fn snapshot(
    State(state): State<AppState>,
    Path(subject): Path<String>,
) -> Result<Json<ProfileSnapshot>, axum::http::StatusCode> {
    state
        .profiles
        .read()
        .await
        .snapshot(&subject)
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}
async fn observe(
    State(state): State<AppState>,
    Json(observation): Json<Observation>,
) -> axum::http::StatusCode {
    state.observations.write().await.record(observation);
    axum::http::StatusCode::ACCEPTED
}
async fn evaluate_handler(
    State(state): State<AppState>,
    Json(request): Json<EvaluationRequest>,
) -> Result<Json<DetectionResult>, axum::http::StatusCode> {
    if request.identity.identity_id.as_deref() != Some(request.subject_id.as_str()) {
        return Err(axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }
    let profile = state
        .profiles
        .read()
        .await
        .snapshot(&request.subject_id)
        .ok_or(axum::http::StatusCode::NOT_FOUND)?;
    state.evaluations.fetch_add(1, Ordering::Relaxed);
    Ok(Json(evaluate(&request, &profile)))
}
async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(
        json!({"status":"healthy","profile_schema":profile::PROFILE_SCHEMA,"detection_schema":detection::DETECTION_SCHEMA,"enforcement":false,"uptime_seconds":state.started_at.elapsed().as_secs()}),
    )
}
async fn metrics(State(state): State<AppState>) -> Json<serde_json::Value> {
    let observations = state.observations.read().await;
    Json(
        json!({"profile_capacity":profile::PROFILE_STORE_CAPACITY,"observation_capacity":profile::OBSERVATION_CAPACITY,"observations":observations.values.len(),"dropped_observations":observations.dropped,"evaluations":state.evaluations.load(Ordering::Relaxed)}),
    )
}
