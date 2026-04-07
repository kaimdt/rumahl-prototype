use std::{collections::HashMap, sync::Arc, time::Instant};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::{delete, get, post},
    Json, Router,
};
use chrono::Utc;
use iora_shared::{
    plugin::{PluginMetadata, PluginRegistry},
    types::{HealthStatus, IoraEvent, ServiceHealth},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt as _;
use tower_http::cors::CorsLayer;
use tracing::info;

// ─── State ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    services: Arc<RwLock<HashMap<String, ServiceEntry>>>,
    plugins: Arc<PluginRegistry>,
    events_tx: broadcast::Sender<IoraEvent>,
    started_at: Arc<Instant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceEntry {
    name: String,
    url: String,
    description: String,
    registered_at: String,
    last_health: Option<HealthStatus>,
    last_checked: Option<String>,
}

// ─── Request / Response bodies ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RegisterServiceRequest {
    name: String,
    url: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InstallPluginRequest {
    metadata: PluginMetadata,
}

#[derive(Debug, Serialize)]
struct ServiceListResponse {
    services: Vec<ServiceEntry>,
    total: usize,
}

#[derive(Debug, Serialize)]
struct PluginListResponse {
    plugins: Vec<PluginMetadata>,
    total: usize,
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let uptime = state.started_at.elapsed().as_secs();
    Json(serde_json::json!({
        "service": "iora-core",
        "status": "healthy",
        "uptime_seconds": uptime,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

async fn list_services(State(state): State<AppState>) -> Json<ServiceListResponse> {
    let map = state.services.read().await;
    let services: Vec<ServiceEntry> = map.values().cloned().collect();
    let total = services.len();
    Json(ServiceListResponse { services, total })
}

async fn register_service(
    State(state): State<AppState>,
    Json(req): Json<RegisterServiceRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), Response> {
    let entry = ServiceEntry {
        name: req.name.clone(),
        url: req.url.clone(),
        description: req.description.unwrap_or_default(),
        registered_at: Utc::now().to_rfc3339(),
        last_health: None,
        last_checked: None,
    };
    state.services.write().await.insert(req.name.clone(), entry);

    let event = IoraEvent {
        event_type: "service.registered".to_string(),
        source: "iora-core".to_string(),
        payload: serde_json::json!({ "name": req.name, "url": req.url }),
        timestamp: Utc::now().to_rfc3339(),
    };
    let _ = state.events_tx.send(event);

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "message": "Service registered", "name": req.name })),
    ))
}

async fn service_health(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<ServiceHealth>, Response> {
    let map = state.services.read().await;
    let entry = map.get(&name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": format!("Service '{}' not found", name) })),
        )
            .into_response()
    })?;

    let health_url = format!("{}/health", entry.url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    let (status, message) = match client.get(&health_url).send().await {
        Ok(resp) if resp.status().is_success() => (HealthStatus::Healthy, None),
        Ok(resp) => (
            HealthStatus::Degraded,
            Some(format!("HTTP {}", resp.status())),
        ),
        Err(e) => (HealthStatus::Unhealthy, Some(e.to_string())),
    };

    Ok(Json(ServiceHealth {
        service: name,
        status,
        message,
        uptime_seconds: 0,
    }))
}

async fn list_plugins(State(state): State<AppState>) -> Json<PluginListResponse> {
    let plugins = state.plugins.list().await;
    let total = plugins.len();
    Json(PluginListResponse { plugins, total })
}

async fn install_plugin(
    State(state): State<AppState>,
    Json(req): Json<InstallPluginRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), Response> {
    let id = req.metadata.id.clone();

    struct StubPlugin(iora_shared::plugin::PluginMetadata);
    impl iora_shared::plugin::IPlugin for StubPlugin {
        fn metadata(&self) -> &iora_shared::plugin::PluginMetadata {
            &self.0
        }
    }

    let plugin = Arc::new(StubPlugin(req.metadata)) as Arc<dyn iora_shared::plugin::IPlugin>;
    state.plugins.register(plugin).await.map_err(|e| {
        (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response()
    })?;

    let event = IoraEvent {
        event_type: "plugin.installed".to_string(),
        source: "iora-core".to_string(),
        payload: serde_json::json!({ "id": id }),
        timestamp: Utc::now().to_rfc3339(),
    };
    let _ = state.events_tx.send(event);

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "message": "Plugin installed", "id": id })),
    ))
}

async fn uninstall_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, Response> {
    state.plugins.unregister(&id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response()
    })?;

    let event = IoraEvent {
        event_type: "plugin.uninstalled".to_string(),
        source: "iora-core".to_string(),
        payload: serde_json::json!({ "id": id }),
        timestamp: Utc::now().to_rfc3339(),
    };
    let _ = state.events_tx.send(event);

    Ok(Json(serde_json::json!({ "message": "Plugin uninstalled", "id": id })))
}

async fn events_sse(
    State(state): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.events_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(event) => {
            let data = serde_json::to_string(&event).unwrap_or_default();
            Some(Ok(Event::default().data(data)))
        }
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

async fn broadcast_event(
    State(state): State<AppState>,
    Json(event): Json<IoraEvent>,
) -> Json<serde_json::Value> {
    let _ = state.events_tx.send(event.clone());
    Json(serde_json::json!({ "message": "Event broadcast", "type": event.event_type }))
}

// ─── Background health poller ─────────────────────────────────────────────────

async fn poll_service_health(state: AppState) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let entries: Vec<(String, String)> = {
            let map = state.services.read().await;
            map.values().map(|e| (e.name.clone(), e.url.clone())).collect()
        };

        for (name, url) in entries {
            let health_url = format!("{}/health", url.trim_end_matches('/'));
            let status = match client.get(&health_url).send().await {
                Ok(r) if r.status().is_success() => HealthStatus::Healthy,
                Ok(_) => HealthStatus::Degraded,
                Err(_) => HealthStatus::Unhealthy,
            };

            let mut map = state.services.write().await;
            if let Some(entry) = map.get_mut(&name) {
                entry.last_health = Some(status);
                entry.last_checked = Some(Utc::now().to_rfc3339());
            }
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_core=debug,info".parse().unwrap()),
        )
        .init();

    let (events_tx, _) = broadcast::channel(256);

    let state = AppState {
        services: Arc::new(RwLock::new(HashMap::new())),
        plugins: Arc::new(PluginRegistry::new()),
        events_tx,
        started_at: Arc::new(Instant::now()),
    };

    tokio::spawn(poll_service_health(state.clone()));

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/core/services", get(list_services))
        .route("/api/core/services/register", post(register_service))
        .route("/api/core/services/:name/health", get(service_health))
        .route("/api/core/plugins", get(list_plugins).post(install_plugin))
        .route("/api/core/plugins/:id", delete(uninstall_plugin))
        .route("/api/core/events", get(events_sse).post(broadcast_event))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8090));
    info!("iora-core listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
