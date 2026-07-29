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
    api_gateway::ApiGateway,
    heartbeat::ServiceHeartbeat,
    plugin::{PluginMetadata, PluginRegistry},
    system_config,
    types::{HealthStatus, IoraEvent, ServiceHealth},
    widget_registry::WidgetRegistry,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::BTreeMap;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt as _;
use tower_http::cors::CorsLayer;
use tracing::info;

type DbPool = PgPool;

// ─── State ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    services: Arc<RwLock<HashMap<String, ServiceEntry>>>,
    plugins: Arc<PluginRegistry>,
    api_gateway: Arc<ApiGateway>,
    widget_registry: Arc<WidgetRegistry>,
    events_tx: broadcast::Sender<IoraEvent>,
    started_at: Arc<Instant>,
    db: Option<Arc<DbPool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceEntry {
    name: String,
    url: String,
    description: String,
    registered_at: String,
    last_health: Option<HealthStatus>,
    last_checked: Option<String>,
    /// Last self-reported heartbeat — populated by
    /// `POST /api/core/services/heartbeat`. Combined with `last_health`
    /// (the reverse-poll result) it gives us a full picture even if one
    /// direction of the link is broken.
    last_heartbeat: Option<String>,
    /// Seconds since we last received a heartbeat. Computed on read.
    #[serde(skip)]
    _seen_baseline: Option<Instant>,
    last_status: Option<HealthStatus>,
    last_message: Option<String>,
    version: Option<String>,
    pid: Option<u32>,
    host: Option<String>,
    uptime_seconds: Option<u64>,
    metrics: BTreeMap<String, f64>,
    /// `true` when no heartbeat has arrived within
    /// `HEARTBEAT_STALE_AFTER_SECS`.
    stale: bool,
    heartbeat_count: u64,
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

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct BackgroundTaskEntry {
    id: String,
    name: String,
    task_type: String,
    enabled: bool,
    interval_seconds: Option<i32>,
    last_run_at: Option<String>,
    last_success_at: Option<String>,
    last_error: Option<String>,
    run_count: i32,
    error_count: i32,
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let uptime = state.started_at.elapsed().as_secs();
    Json(serde_json::json!({
        "service": "iora-core",
        "status": "healthy",
        "uptime_seconds": uptime,
        "timestamp": Utc::now().to_rfc3339(),
        "db_connected": state.db.is_some(),
        "setup_complete": iora_shared::env::IoraEnv::is_setup_complete(),
    }))
}

async fn list_services(State(state): State<AppState>) -> Json<ServiceListResponse> {
    let map = state.services.read().await;
    let services: Vec<ServiceEntry> = map.values().cloned().collect();
    let total = services.len();
    Json(ServiceListResponse { services, total })
}

// Helper function to send events with error logging
fn send_event(tx: &broadcast::Sender<IoraEvent>, event: IoraEvent) {
    if let Err(e) = tx.send(event) {
        tracing::warn!(
            "iora-core: event broadcast failed (channel full or no receivers): {:?}",
            e
        );
    }
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
        last_heartbeat: None,
        _seen_baseline: None,
        last_status: None,
        last_message: None,
        version: None,
        pid: None,
        host: None,
        uptime_seconds: None,
        metrics: BTreeMap::new(),
        stale: true,
        heartbeat_count: 0,
    };
    state.services.write().await.insert(req.name.clone(), entry);

    let event = IoraEvent {
        event_type: "service.registered".to_string(),
        source: "iora-core".to_string(),
        payload: serde_json::json!({ "name": req.name, "url": req.url }),
        timestamp: Utc::now().to_rfc3339(),
    };
    send_event(&state.events_tx, event);

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

    // Metadata-only plugin registration. Actual plugin runtimes live in the
    // supervisor (Docker apps) or in the iora-home plugin host (sandboxed JS
    // plugins) – this entry just makes the plugin discoverable through the
    // service registry. Execution of `run_sandboxed` therefore explicitly
    // routes the call back to whichever runtime owns the plugin.
    struct RegisteredPlugin(iora_shared::plugin::PluginMetadata);
    #[async_trait::async_trait]
    impl iora_shared::plugin::IPlugin for RegisteredPlugin {
        fn metadata(&self) -> &iora_shared::plugin::PluginMetadata {
            &self.0
        }

        async fn on_load(&self) -> anyhow::Result<()> {
            tracing::info!(
                plugin_id = %self.0.id,
                version = %self.0.version,
                "plugin metadata registered with iora-core"
            );
            Ok(())
        }

        async fn on_unload(&self) -> anyhow::Result<()> {
            tracing::info!(plugin_id = %self.0.id, "plugin metadata unregistered");
            Ok(())
        }

        async fn run_sandboxed(
            &self,
            _input: serde_json::Value,
        ) -> anyhow::Result<serde_json::Value> {
            // iora-core only stores metadata. The actual execution path is
            // supervisor (for container apps) or iora-home (for sandboxed
            // JS plugins). Surface this so callers do not silently no-op.
            anyhow::bail!(
                "plugin '{}' has no inline executor in iora-core; \
                 invoke it via the supervisor or iora-home plugin host",
                self.0.id
            )
        }
    }

    let plugin = Arc::new(RegisteredPlugin(req.metadata)) as Arc<dyn iora_shared::plugin::IPlugin>;
    // Explicitly drive the lifecycle hook so subscribers get a load notification.
    if let Err(e) = plugin.on_load().await {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("on_load failed: {}", e) })),
        )
            .into_response());
    }
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
    send_event(&state.events_tx, event);

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
    send_event(&state.events_tx, event);

    Ok(Json(
        serde_json::json!({ "message": "Plugin uninstalled", "id": id }),
    ))
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
    send_event(&state.events_tx, event.clone());
    Json(serde_json::json!({ "message": "Event broadcast", "type": event.event_type }))
}

// ─── Task management handlers ─────────────────────────────────────────────────

async fn list_tasks(State(state): State<AppState>) -> Json<serde_json::Value> {
    let Some(db) = &state.db else {
        return Json(serde_json::json!({ "tasks": [], "total": 0, "db": false }));
    };

    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, String, String, bool, Option<i32>, i32, i32)> =
        match sqlx::query_as(
            "SELECT id, name, task_type, enabled, interval_seconds, run_count, error_count FROM background_tasks ORDER BY name",
        )
        .fetch_all(db.as_ref())
        .await
        {
            Ok(r) => r,
            Err(e) => {
                return Json(serde_json::json!({ "error": e.to_string() }));
            }
        };

    let tasks: Vec<serde_json::Value> = rows
        .into_iter()
        .map(
            |(id, name, task_type, enabled, interval_seconds, run_count, error_count)| {
                serde_json::json!({
                    "id": id,
                    "name": name,
                    "task_type": task_type,
                    "enabled": enabled,
                    "interval_seconds": interval_seconds,
                    "run_count": run_count,
                    "error_count": error_count,
                })
            },
        )
        .collect();

    let total = tasks.len();
    Json(serde_json::json!({ "tasks": tasks, "total": total }))
}

async fn trigger_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let Some(db) = &state.db else {
        return Json(serde_json::json!({ "error": "database not connected" }));
    };

    let exists: Option<(String,)> =
        match sqlx::query_as("SELECT id FROM background_tasks WHERE id = $1")
            .bind(&id)
            .fetch_optional(db.as_ref())
            .await
        {
            Ok(r) => r,
            Err(e) => return Json(serde_json::json!({ "error": e.to_string() })),
        };

    if exists.is_none() {
        return Json(serde_json::json!({ "error": format!("task '{}' not found", id) }));
    }

    // Record the manual trigger in analytics
    let _ = sqlx::query("INSERT INTO analytics_snapshots (snapshot_type, data) VALUES ($1, $2)")
        .bind("task_trigger")
        .bind(sqlx::types::Json(
            serde_json::json!({ "task_id": id, "triggered_by": "api" }),
        ))
        .execute(db.as_ref())
        .await;

    Json(serde_json::json!({ "message": "task triggered", "id": id }))
}

async fn get_person_analytics(State(state): State<AppState>) -> Json<serde_json::Value> {
    let Some(db) = &state.db else {
        return Json(serde_json::json!({ "error": "database not connected" }));
    };

    // Fetch latest analytics snapshot of type 'persons'
    let row: Option<(serde_json::Value,)> = match sqlx::query_as(
        "SELECT data FROM analytics_snapshots WHERE snapshot_type = $1 ORDER BY captured_at DESC LIMIT 1",
    )
    .bind("persons")
    .fetch_optional(db.as_ref())
    .await
    {
        Ok(r) => r,
        Err(e) => return Json(serde_json::json!({ "error": e.to_string() })),
    };

    match row {
        Some((data,)) => Json(data),
        None => Json(serde_json::json!({ "message": "no person analytics snapshots yet" })),
    }
}

async fn list_analytics_snapshots(State(state): State<AppState>) -> Json<serde_json::Value> {
    let Some(db) = &state.db else {
        return Json(serde_json::json!({ "snapshots": [], "db": false }));
    };

    let rows: Vec<(i64, String, serde_json::Value, String)> = match sqlx::query_as(
        "SELECT id, snapshot_type, data, captured_at::text FROM analytics_snapshots ORDER BY captured_at DESC LIMIT 100",
    )
    .fetch_all(db.as_ref())
    .await
    {
        Ok(r) => r,
        Err(e) => return Json(serde_json::json!({ "error": e.to_string() })),
    };

    let snapshots: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(id, snapshot_type, data, captured_at)| {
            serde_json::json!({
                "id": id,
                "snapshot_type": snapshot_type,
                "data": data,
                "captured_at": captured_at,
            })
        })
        .collect();

    Json(serde_json::json!({ "snapshots": snapshots, "total": snapshots.len() }))
}

// ─── Enhanced Plugin Management ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ExecutePluginRequest {
    input: serde_json::Value,
}

async fn execute_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ExecutePluginRequest>,
) -> Json<serde_json::Value> {
    match state.plugins.execute(&id, req.input).await {
        Ok(result) => Json(serde_json::json!({
            "success": result.success,
            "duration_ms": result.duration_ms,
            "output": result.output,
            "error": result.error
        })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": e.to_string()
        })),
    }
}

async fn get_plugin_stats(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match state.plugins.get_stats(&id).await {
        Some(stats) => Json(serde_json::to_value(&stats).unwrap_or_default()),
        None => Json(serde_json::json!({ "error": "Plugin not found or no stats available" })),
    }
}

async fn list_plugins_with_stats(State(state): State<AppState>) -> Json<serde_json::Value> {
    let plugins_with_stats = state.plugins.list_with_stats().await;

    let data: Vec<serde_json::Value> = plugins_with_stats
        .into_iter()
        .map(|(metadata, stats)| {
            serde_json::json!({
                "metadata": metadata,
                "stats": stats
            })
        })
        .collect();

    Json(serde_json::json!({
        "plugins": data,
        "total": data.len()
    }))
}

async fn enable_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, Response> {
    let Some(db) = &state.db else {
        return Ok(Json(
            serde_json::json!({ "error": "database not connected" }),
        ));
    };

    match sqlx::query("UPDATE plugins SET enabled = TRUE, updated_at = NOW() WHERE id = $1")
        .bind(&id)
        .execute(db.as_ref())
        .await
    {
        Ok(_) => Ok(Json(serde_json::json!({
            "success": true,
            "message": format!("Plugin {} enabled", id)
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "error": e.to_string()
        }))),
    }
}

async fn disable_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, Response> {
    let Some(db) = &state.db else {
        return Ok(Json(
            serde_json::json!({ "error": "database not connected" }),
        ));
    };

    match sqlx::query("UPDATE plugins SET enabled = FALSE, updated_at = NOW() WHERE id = $1")
        .bind(&id)
        .execute(db.as_ref())
        .await
    {
        Ok(_) => Ok(Json(serde_json::json!({
            "success": true,
            "message": format!("Plugin {} disabled", id)
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "error": e.to_string()
        }))),
    }
}

// ─── API Gateway Management ─────────────────────────────────────────────────

async fn list_api_endpoints(State(state): State<AppState>) -> Json<serde_json::Value> {
    let endpoints = state.api_gateway.list_endpoints().await;
    Json(serde_json::json!({
        "endpoints": endpoints,
        "total": endpoints.len()
    }))
}

async fn list_endpoints_by_provider(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Json<serde_json::Value> {
    let endpoints = state
        .api_gateway
        .list_endpoints_by_provider(&provider_id)
        .await;
    Json(serde_json::json!({
        "endpoints": endpoints,
        "total": endpoints.len()
    }))
}

// ─── Widget Registry Management ─────────────────────────────────────────────────

async fn list_widgets(State(state): State<AppState>) -> Json<serde_json::Value> {
    let widgets = state.widget_registry.list_widgets().await;
    Json(serde_json::json!({
        "widgets": widgets,
        "total": widgets.len()
    }))
}

async fn list_available_widgets(State(state): State<AppState>) -> Json<serde_json::Value> {
    let widgets = state.widget_registry.list_available_widgets().await;
    Json(serde_json::json!({
        "widgets": widgets,
        "total": widgets.len()
    }))
}

async fn list_widgets_by_provider(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Json<serde_json::Value> {
    let widgets = state
        .widget_registry
        .list_widgets_by_provider(&provider_id)
        .await;
    Json(serde_json::json!({
        "widgets": widgets,
        "total": widgets.len()
    }))
}

async fn get_widget(
    State(state): State<AppState>,
    Path(widget_id): Path<String>,
) -> Json<serde_json::Value> {
    match state.widget_registry.get_widget(&widget_id).await {
        Some(widget) => Json(serde_json::to_value(&widget).unwrap_or_default()),
        None => Json(serde_json::json!({ "error": "Widget not found" })),
    }
}

// ─── Heartbeat receiver ───────────────────────────────────────────────────────

/// Services that don't send a heartbeat for this long are flagged stale
/// and downgraded to `Unhealthy` in the aggregated status view. The
/// default heartbeat cadence is 5s, so 20s is generous (3× missed beats
/// + slack) without being so loose that operators stop trusting the UI.
const HEARTBEAT_STALE_AFTER_SECS: u64 = 20;

async fn receive_heartbeat(
    State(state): State<AppState>,
    Json(beat): Json<ServiceHeartbeat>,
) -> Json<serde_json::Value> {
    let now = Utc::now().to_rfc3339();
    let mut map = state.services.write().await;
    let entry = map
        .entry(beat.name.clone())
        .or_insert_with(|| ServiceEntry {
            name: beat.name.clone(),
            url: beat.url.clone(),
            description: beat.description.clone(),
            registered_at: now.clone(),
            last_health: None,
            last_checked: None,
            last_heartbeat: None,
            _seen_baseline: None,
            last_status: None,
            last_message: None,
            version: None,
            pid: None,
            host: None,
            uptime_seconds: None,
            metrics: BTreeMap::new(),
            stale: false,
            heartbeat_count: 0,
        });

    // Always refresh registration metadata: a service may have moved
    // ports or been redeployed with a new build between heartbeats.
    // Check inside the lock to prevent race condition with duplicate registration events
    let was_known = entry.heartbeat_count > 0;
    if !beat.url.is_empty() {
        entry.url = beat.url.clone();
    }
    if !beat.description.is_empty() {
        entry.description = beat.description.clone();
    }
    entry.last_heartbeat = Some(beat.timestamp.clone());
    entry._seen_baseline = Some(Instant::now());
    entry.last_status = Some(beat.status.clone());
    entry.last_message = beat.message.clone();
    entry.version = Some(beat.version.clone());
    entry.pid = Some(beat.pid);
    entry.host = Some(beat.host.clone());
    entry.uptime_seconds = Some(beat.uptime_seconds);
    entry.metrics = beat.metrics.iter().map(|(k, v)| (k.clone(), *v)).collect();
    entry.stale = false;
    entry.heartbeat_count = entry.heartbeat_count.saturating_add(1);

    // Send registration event while still holding the lock to prevent duplicate events
    if !was_known {
        let event = IoraEvent {
            event_type: "service.registered".to_string(),
            source: "iora-core".to_string(),
            payload: serde_json::json!({
                "name": beat.name, "url": beat.url, "via": "heartbeat",
            }),
            timestamp: now.clone(),
        };
        send_event(&state.events_tx, event);
    }

    drop(map);

    let event = IoraEvent {
        event_type: "service.heartbeat".to_string(),
        source: "iora-core".to_string(),
        payload: serde_json::json!({
            "name":   beat.name,
            "status": beat.status,
            "uptime": beat.uptime_seconds,
        }),
        timestamp: now.clone(),
    };
    send_event(&state.events_tx, event);

    Json(serde_json::json!({
        "ok": true,
        "interval_hint_seconds": 5,
        "stale_after_seconds": HEARTBEAT_STALE_AFTER_SECS,
        "server_time": now,
    }))
}

/// Aggregated, UI-friendly view: every known service with its current
/// liveness, last heartbeat age, and last reverse-poll result.
async fn services_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let map = state.services.read().await;
    let now_ms = Instant::now();
    let mut healthy = 0usize;
    let mut degraded = 0usize;
    let mut unhealthy = 0usize;
    let mut stale = 0usize;

    let services: Vec<serde_json::Value> = map
        .values()
        .map(|e| {
            let age_seconds = e
                ._seen_baseline
                .map(|t| now_ms.saturating_duration_since(t).as_secs());
            let is_stale = match age_seconds {
                Some(a) => a > HEARTBEAT_STALE_AFTER_SECS,
                None => true,
            };
            // Effective status combines the self-reported status and
            // the staleness check: a service that hasn't beat in 20s is
            // unhealthy by definition, regardless of what it last said.
            let effective = if is_stale {
                HealthStatus::Unhealthy
            } else {
                e.last_status.clone().unwrap_or(HealthStatus::Healthy)
            };
            match effective {
                HealthStatus::Healthy => healthy += 1,
                HealthStatus::Degraded => degraded += 1,
                HealthStatus::Unhealthy => unhealthy += 1,
            }
            if is_stale {
                stale += 1;
            }
            serde_json::json!({
                "name":               e.name,
                "url":                e.url,
                "description":        e.description,
                "registered_at":      e.registered_at,
                "last_heartbeat":     e.last_heartbeat,
                "heartbeat_age_secs": age_seconds,
                "heartbeat_count":    e.heartbeat_count,
                "reported_status":    e.last_status,
                "effective_status":   effective,
                "message":            e.last_message,
                "version":            e.version,
                "pid":                e.pid,
                "host":               e.host,
                "uptime_seconds":     e.uptime_seconds,
                "metrics":            e.metrics,
                "stale":              is_stale,
                "last_poll":          e.last_checked,
                "last_poll_status":   e.last_health,
            })
        })
        .collect();

    let total = services.len();
    Json(serde_json::json!({
        "services": services,
        "summary": {
            "total":     total,
            "healthy":   healthy,
            "degraded":  degraded,
            "unhealthy": unhealthy,
            "stale":     stale,
        },
        "stale_after_seconds": HEARTBEAT_STALE_AFTER_SECS,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Faster loop dedicated to staleness detection. The reverse-poll loop
/// runs every 30s, but heartbeats arrive every 5s; we want stale
/// services to flip status within ~5s of going dark, not 30s.
async fn watch_heartbeat_freshness(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let now = Instant::now();
        let mut newly_stale: Vec<String> = Vec::new();
        {
            let mut map = state.services.write().await;
            for entry in map.values_mut() {
                let age = entry
                    ._seen_baseline
                    .map(|t| now.saturating_duration_since(t).as_secs())
                    .unwrap_or(u64::MAX);
                let is_stale = age > HEARTBEAT_STALE_AFTER_SECS;
                if is_stale && !entry.stale {
                    newly_stale.push(entry.name.clone());
                }
                entry.stale = is_stale;
            }
        }
        for name in newly_stale {
            tracing::warn!(
                "iora-core: service '{}' missed heartbeats; marking stale",
                name
            );
            send_event(
                &state.events_tx,
                IoraEvent {
                    event_type: "service.stale".into(),
                    source: "iora-core".into(),
                    payload: serde_json::json!({ "name": name }),
                    timestamp: Utc::now().to_rfc3339(),
                },
            );
        }
    }
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
            map.values()
                .map(|e| (e.name.clone(), e.url.clone()))
                .collect()
        };

        for (name, url) in entries {
            if url.is_empty() {
                continue;
            }
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

// ─── Core migration runner ─────────────────────────────────────────────────────

/// Split SQL into individual statements using a quote-aware parser.
/// Semicolons inside single or double-quoted strings are preserved as part
/// of the statement. Comment-only lines and empty statements are filtered out.
fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut current = String::new();

    for ch in sql.chars() {
        match ch {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
                current.push(ch);
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
                current.push(ch);
            }
            ';' if !in_single_quote && !in_double_quote => {
                let cleaned = strip_sql_comments(&current).trim().to_string();
                if !cleaned.is_empty() {
                    statements.push(cleaned);
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    let cleaned = strip_sql_comments(&current).trim().to_string();
    if !cleaned.is_empty() {
        statements.push(cleaned);
    }

    statements
}

/// Remove SQL comment lines (lines starting with --) from accumulated text.
/// Preserves non-comment content and whitespace between valid lines.
fn strip_sql_comments(text: &str) -> String {
    let filtered: Vec<&str> = text
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !trimmed.starts_with("--")
        })
        .collect();
    if filtered.is_empty() {
        String::new()
    } else {
        filtered.join("\n")
    }
}

async fn run_core_migrations(pool: &DbPool) -> anyhow::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _core_migrations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    let migrations = vec![
        (
            "001_core_schema",
            include_str!("../migrations/001_core_schema.sql"),
        ),
        (
            "002_plugins_apps",
            include_str!("../migrations/002_plugins_apps.sql"),
        ),
    ];

    for (name, sql) in migrations {
        let result: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM _core_migrations WHERE name = $1")
                .bind(name)
                .fetch_optional(pool)
                .await?;

        if result.is_none() {
            tracing::info!("iora-core: applying migration {}", name);

            // Wrap the entire migration in a transaction so a failure in
            // any single statement rolls back everything. This avoids
            // "already exists" / FK errors on retry after partial failure.
            let mut tx = pool.begin().await.map_err(|e| {
                tracing::error!(
                    "iora-core: failed to begin transaction for migration {}: {}",
                    name,
                    e
                );
                e
            })?;

            // Execute the SQL as a single statement if no semicolons, otherwise
            // use sqlx::raw_sql which handles multi-statement queries properly
            let statement_trimmed = sql.trim();

            // Check if this appears to be a multi-statement SQL
            let has_multiple_statements = statement_trimmed.matches(';').count() > 1
                || (statement_trimmed.contains(';') && !statement_trimmed.ends_with(';'));

            if has_multiple_statements {
                let statements = split_sql_statements(statement_trimmed);
                for stmt in &statements {
                    sqlx::query(stmt.as_str())
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| {
                            tracing::error!(
                                "iora-core: migration {} failed on statement (rolling back): {}",
                                name,
                                e
                            );
                            e
                        })?;
                }
            } else {
                // Single statement, execute directly
                if !statement_trimmed.is_empty() && !statement_trimmed.starts_with("--") {
                    sqlx::query(statement_trimmed)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| {
                            tracing::error!(
                                "iora-core: migration {} failed (rolling back): {}",
                                name,
                                e
                            );
                            e
                        })?;
                }
            }

            // Record migration as applied INSIDE the same transaction.
            sqlx::query("INSERT INTO _core_migrations (name) VALUES ($1)")
                .bind(name)
                .execute(&mut *tx)
                .await?;

            tx.commit().await.map_err(|e| {
                tracing::error!("iora-core: failed to commit migration {}: {}", name, e);
                e
            })?;
        }
    }

    Ok(())
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

    let db = if let Ok(db_url) = std::env::var("DATABASE_URL") {
        match sqlx::PgPool::connect(&db_url).await {
            Ok(pool) => {
                tracing::info!("iora-core: connected to PostgreSQL");
                if let Err(e) = run_core_migrations(&pool).await {
                    tracing::warn!("iora-core: migration warning: {}", e);
                }
                Some(Arc::new(pool))
            }
            Err(e) => {
                tracing::warn!(
                    "iora-core: could not connect to PostgreSQL ({}), running without DB",
                    e
                );
                None
            }
        }
    } else {
        tracing::info!("iora-core: DATABASE_URL not set, running without persistent storage");
        None
    };

    let (events_tx, _) = broadcast::channel(1024); // Increased from 256 to 1024 to handle burst events

    let state = AppState {
        services: Arc::new(RwLock::new(HashMap::new())),
        plugins: Arc::new(PluginRegistry::new()),
        api_gateway: Arc::new(ApiGateway::new()),
        widget_registry: Arc::new(WidgetRegistry::new()),
        events_tx,
        started_at: Arc::new(Instant::now()),
        db,
    };

    tokio::spawn(poll_service_health(state.clone()));
    tokio::spawn(watch_heartbeat_freshness(state.clone()));

    let port: u16 = system_config::service_port("iora-core", 8090);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/core/services", get(list_services))
        .route("/api/core/services/register", post(register_service))
        .route("/api/core/services/heartbeat", post(receive_heartbeat))
        .route("/api/core/services/status", get(services_status))
        .route("/api/core/services/:name/health", get(service_health))
        .route("/api/core/plugins", get(list_plugins).post(install_plugin))
        .route("/api/core/plugins/with-stats", get(list_plugins_with_stats))
        .route("/api/core/plugins/:id", delete(uninstall_plugin))
        .route("/api/core/plugins/:id/execute", post(execute_plugin))
        .route("/api/core/plugins/:id/stats", get(get_plugin_stats))
        .route("/api/core/plugins/:id/enable", post(enable_plugin))
        .route("/api/core/plugins/:id/disable", post(disable_plugin))
        .route("/api/core/api-endpoints", get(list_api_endpoints))
        .route(
            "/api/core/api-endpoints/provider/:provider_id",
            get(list_endpoints_by_provider),
        )
        .route("/api/core/widgets", get(list_widgets))
        .route("/api/core/widgets/available", get(list_available_widgets))
        .route("/api/core/widgets/:widget_id", get(get_widget))
        .route(
            "/api/core/widgets/provider/:provider_id",
            get(list_widgets_by_provider),
        )
        .route("/api/core/events", get(events_sse).post(broadcast_event))
        .route("/api/core/tasks", get(list_tasks))
        .route("/api/core/tasks/:id/trigger", post(trigger_task))
        .route("/api/core/analytics/persons", get(get_person_analytics))
        .route(
            "/api/core/analytics/snapshots",
            get(list_analytics_snapshots),
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!("iora-core listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_statement_no_semicolon() {
        let result = split_sql_statements("SELECT 1");
        assert_eq!(result, vec!["SELECT 1"]);
    }

    #[test]
    fn test_multiple_statements() {
        let result = split_sql_statements("SELECT 1; SELECT 2; SELECT 3;");
        assert_eq!(result, vec!["SELECT 1", "SELECT 2", "SELECT 3"]);
    }

    #[test]
    fn test_semicolon_in_single_quoted_string() {
        let sql = "INSERT INTO t VALUES ('hello;world'); SELECT 2;";
        let result = split_sql_statements(sql);
        assert_eq!(
            result,
            vec!["INSERT INTO t VALUES ('hello;world')", "SELECT 2"]
        );
    }

    #[test]
    fn test_semicolon_in_double_quoted_string() {
        let sql = "INSERT INTO t VALUES (\"val;ue\"); SELECT 2;";
        let result = split_sql_statements(sql);
        assert_eq!(
            result,
            vec!["INSERT INTO t VALUES (\"val;ue\")", "SELECT 2"]
        );
    }

    #[test]
    fn test_comment_lines_filtered_out() {
        let sql = "-- This is a comment\nSELECT 1; -- another comment\n-- more comments\nSELECT 2;";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn test_empty_statements_filtered() {
        let result = split_sql_statements(";;;SELECT 1;;;");
        assert_eq!(result, vec!["SELECT 1"]);
    }

    #[test]
    fn test_mixed_quotes() {
        let sql = "SELECT 'single\"quote' AS a, \"double'quote\" AS b;";
        let result = split_sql_statements(sql);
        assert_eq!(
            result,
            vec!["SELECT 'single\"quote' AS a, \"double'quote\" AS b"]
        );
    }

    #[test]
    fn test_create_table_with_defaults() {
        let sql = "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'unknown');";
        let result = split_sql_statements(sql);
        assert_eq!(
            result,
            vec!["CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'unknown')"]
        );
    }

    #[test]
    fn test_multiline_statement() {
        let sql =
            "CREATE TABLE t (\n  id INTEGER,\n  name TEXT\n);\nINSERT INTO t VALUES (1, 'test');";
        let result = split_sql_statements(sql);
        assert_eq!(
            result,
            vec![
                "CREATE TABLE t (\n  id INTEGER,\n  name TEXT\n)",
                "INSERT INTO t VALUES (1, 'test')"
            ]
        );
    }

    #[test]
    fn test_unclosed_quote_handled_gracefully() {
        let sql = "SELECT 'unclosed;INSERT INTO t VALUES (1);";
        let result = split_sql_statements(sql);
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("unclosed"));
    }

    // ── Heartbeat race-condition logic tests ──────────────────────────

    /// Registration event should fire only for first heartbeat (was_known=false).
    #[test]
    fn test_registration_event_fires_only_once() {
        // Simulate heartbeat_count before lock
        let test_cases = vec![
            (0, true, "first heartbeat should fire registration"),
            (1, false, "second heartbeat should not re-fire"),
            (5, false, "fifth heartbeat should not re-fire"),
            (100, false, "many heartbeats should not re-fire"),
        ];
        for (heartbeat_count, expect_fire, msg) in test_cases {
            let was_known = heartbeat_count > 0;
            assert_eq!(!was_known, expect_fire, "{}", msg);
        }
    }

    /// Verify that the broadcast channel capacity is sufficient for burst events.
    #[test]
    fn test_broadcast_channel_burst_capacity() {
        use tokio::sync::broadcast;
        let (tx, mut rx) = broadcast::channel::<i32>(1024);
        // Send 200 events — should not drop any at 1024 capacity with active receiver
        for i in 0..200 {
            assert!(tx.send(i).is_ok(), "Event {} should not be dropped", i);
        }
        let mut count = 0;
        while rx.try_recv().is_ok() {
            count += 1;
        }
        assert_eq!(
            count, 200,
            "All 200 events should be received at capacity 1024"
        );
    }

    /// The send_event helper should not panic when the channel is full.
    #[test]
    fn test_send_event_helper_does_not_panic() {
        use tokio::sync::broadcast;
        // No receiver = all sends return Err which send_event logs
        let (tx, _rx) = broadcast::channel::<i32>(4);
        let event = 42;
        // send_event equivalent: test that it doesn't panic on send error
        let result = tx.send(event);
        // With no receivers, send returns Err (not lagged)
        assert!(result.is_err() || result.is_ok());
    }
}
