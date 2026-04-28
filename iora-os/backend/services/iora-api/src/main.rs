//! IORA API – Extended interface layer providing multiple protocol access
//! to the IORA ecosystem:
//!
//! - **GraphQL** – Full query/mutation/subscription API for entities, config, automations
//! - **WebDAV** – File access compatible with desktop/mobile file managers
//! - **MQTT API** – Bridge MQTT topics to Home Assistant MQTT broker
//! - **CalDAV** – Calendar access for HA calendar entities via standard CalDAV clients
//! - **REST v2** – Extended REST API with pagination, filtering, field selection
//!
//! All interfaces share the same JWT authentication from IORA Home.

use anyhow::Result;
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    middleware,
    response::{IntoResponse, Json},
    routing::{any, get, post},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use uuid::Uuid;

mod auth;
mod graphql;
mod webdav;
mod mqtt_bridge;
mod caldav;

// ─── Configuration ──────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub jwt_secret: String,
    /// Base URL of the local iora-home instance
    pub iora_home_url: String,
    /// Base URL of the local iora-files instance
    pub iora_files_url: String,
    /// Home Assistant URL (for MQTT and calendar)
    pub ha_url: String,
    pub ha_token: String,
    pub http_client: reqwest::Client,
    pub graphql_schema: graphql::IoraSchema,
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_api=info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("IORA_API_DB_URL")
        .unwrap_or_else(|_| "sqlite:/var/lib/iora-api/api.db?mode=rwc".into());

    // Ensure parent directory of the SQLite file exists. SQLx's
    // `mode=rwc` will create the file but not the directory tree, so on
    // a fresh install opening the connection fails with
    // "(code: 14) unable to open database file" and systemd loops the
    // service. Parse the path out of the URL and mkdir -p it.
    if let Some(rest) = database_url.strip_prefix("sqlite:") {
        let path_part = rest.split('?').next().unwrap_or("");
        if !path_part.is_empty() && path_part != ":memory:" {
            if let Some(parent) = std::path::Path::new(path_part).parent() {
                if !parent.as_os_str().is_empty() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        tracing::warn!(
                            "Could not create SQLite parent directory {}: {}",
                            parent.display(),
                            e
                        );
                    }
                }
            }
        }
    }
    let jwt_secret = std::env::var("IORA_JWT_SECRET")
        .unwrap_or_else(|_| "iora-api-dev-secret-change-me".into());
    let port: u16 = std::env::var("IORA_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8099);
    let iora_home_url = std::env::var("IORA_HOME_URL")
        .unwrap_or_else(|_| "http://localhost:8080".into());
    let iora_files_url = std::env::var("IORA_FILES_URL")
        .unwrap_or_else(|_| "http://localhost:8097".into());
    let ha_url = std::env::var("HA_URL")
        .unwrap_or_else(|_| "http://localhost:8123".into());
    let ha_token = std::env::var("HA_TOKEN")
        .unwrap_or_default();

    let db = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    let migration_sql = include_str!("../migrations/001_initial_schema.sql");
    match sqlx::raw_sql(migration_sql).execute(&db).await {
        Ok(_) => info!("Database migrations applied"),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("already exists") {
                info!("Database schema already up to date");
            } else {
                return Err(e.into());
            }
        }
    }

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let graphql_schema = graphql::build_schema(
        iora_home_url.clone(),
        ha_url.clone(),
        ha_token.clone(),
        http_client.clone(),
    );

    let state = Arc::new(AppState {
        db,
        jwt_secret,
        iora_home_url,
        iora_files_url,
        ha_url,
        ha_token,
        http_client,
        graphql_schema,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Health
        .route("/health", get(health_check))
        // GraphQL (public playground + authenticated queries)
        .route("/graphql", get(graphql::graphql_playground).post(graphql::graphql_handler))
        .route("/graphql/ws", get(graphql::graphql_ws_handler))
        // WebDAV (file access via standard WebDAV protocol)
        .route("/webdav/*path", any(webdav::webdav_handler))
        .route("/webdav", any(webdav::webdav_handler_root))
        // CalDAV (calendar access)
        .route("/caldav/*path", any(caldav::caldav_handler))
        .route("/caldav", any(caldav::caldav_handler_root))
        .route("/.well-known/caldav", get(caldav::well_known_redirect))
        // MQTT bridge
        .route("/api/mqtt/publish", post(mqtt_bridge::mqtt_publish))
        .route("/api/mqtt/subscribe", get(mqtt_bridge::mqtt_subscribe_ws))
        .route("/api/mqtt/topics", get(mqtt_bridge::list_topics))
        // REST v2 – Extended API with pagination, filtering, field selection
        .nest("/api/v2", rest_v2_routes())
        // Interface metrics
        .route("/api/metrics", get(get_metrics))
        .route("/api/interfaces", get(list_interfaces))
        .layer(cors)
        .with_state(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("IORA API gateway listening on {}", addr);
    let _hb = iora_shared::heartbeat::spawn_default(
        "iora-api",
        addr.port(),
        "REST v2 API surface",
    );
    info!("  GraphQL:   http://{}:{}/graphql", "0.0.0.0", port);
    info!("  WebDAV:    http://{}:{}/webdav/", "0.0.0.0", port);
    info!("  CalDAV:    http://{}:{}/caldav/", "0.0.0.0", port);
    info!("  MQTT API:  http://{}:{}/api/mqtt/", "0.0.0.0", port);
    info!("  REST v2:   http://{}:{}/api/v2/", "0.0.0.0", port);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// ─── REST v2 Routes ─────────────────────────────────────────────────────────

fn rest_v2_routes() -> Router<Arc<AppState>> {
    Router::new()
        // Entities with advanced filtering
        .route("/entities", get(v2_list_entities))
        .route("/entities/:entity_id", get(v2_get_entity))
        .route("/entities/:entity_id/history", get(v2_entity_history))
        // Services
        .route("/services", get(v2_list_services))
        .route("/services/:domain/:service", post(v2_call_service))
        // Automations
        .route("/automations", get(v2_list_automations))
        .route("/automations/:id/trigger", post(v2_trigger_automation))
        // Areas & Devices
        .route("/areas", get(v2_list_areas))
        .route("/devices", get(v2_list_devices))
        // Users
        .route("/users", get(v2_list_users))
        // Batch operations
        .route("/batch", post(v2_batch_request))
}

// ─── Health ─────────────────────────────────────────────────────────────────

async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "iora-api",
        "interfaces": ["graphql", "webdav", "caldav", "mqtt", "rest-v2"],
        "iora_home": state.iora_home_url,
    }))
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

async fn list_interfaces(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({
        "interfaces": [
            {
                "name": "GraphQL",
                "type": "graphql",
                "endpoint": "/graphql",
                "playground": "/graphql",
                "websocket": "/graphql/ws",
                "description": "Full GraphQL API with queries, mutations, and subscriptions for entity state, configuration, automations, and more."
            },
            {
                "name": "WebDAV",
                "type": "webdav",
                "endpoint": "/webdav/",
                "description": "Standard WebDAV protocol for file access. Compatible with Windows Explorer, macOS Finder, and mobile file managers."
            },
            {
                "name": "CalDAV",
                "type": "caldav",
                "endpoint": "/caldav/",
                "well_known": "/.well-known/caldav",
                "description": "CalDAV protocol for calendar access. Maps Home Assistant calendar entities to standard CalDAV calendars."
            },
            {
                "name": "MQTT API",
                "type": "mqtt",
                "publish": "/api/mqtt/publish",
                "subscribe_ws": "/api/mqtt/subscribe",
                "topics": "/api/mqtt/topics",
                "description": "HTTP-to-MQTT bridge. Publish messages and subscribe to topics via HTTP/WebSocket."
            },
            {
                "name": "REST v2",
                "type": "rest",
                "base_path": "/api/v2",
                "description": "Extended REST API with pagination, field selection, filtering, and batch operations."
            }
        ]
    }))
}

// ─── Metrics ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct MetricsQuery {
    interface_type: Option<String>,
    since: Option<String>,
    limit: Option<i32>,
}

async fn get_metrics(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MetricsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(100).min(1000);

    // Summary counts per interface
    let summary: Vec<(String, i64, f64)> = sqlx::query_as(
        "SELECT interface_type, COUNT(*) as count, AVG(duration_ms) as avg_ms FROM api_metrics WHERE created_at > datetime('now', '-24 hours') GROUP BY interface_type"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let summary_json: Vec<serde_json::Value> = summary
        .into_iter()
        .map(|(iface, count, avg)| {
            serde_json::json!({
                "interface": iface,
                "requests_24h": count,
                "avg_response_ms": avg,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "summary": summary_json,
    })))
}

// ─── REST v2 Handlers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct V2ListQuery {
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    search: Option<String>,
    #[serde(default)]
    fields: Option<String>, // comma-separated fields
    #[serde(default = "default_page")]
    page: i32,
    #[serde(default = "default_per_page")]
    per_page: i32,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    state: Option<String>, // filter by state value
}

fn default_page() -> i32 { 1 }
fn default_per_page() -> i32 { 50 }

async fn v2_list_entities(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<V2ListQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let mut url = format!("{}/api/states", state.iora_home_url);
    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let entities: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    // Apply filters
    let mut filtered: Vec<&serde_json::Value> = entities.iter().collect();

    if let Some(ref domain) = query.domain {
        filtered.retain(|e| {
            e.get("entity_id")
                .and_then(|id| id.as_str())
                .map(|id| id.starts_with(&format!("{}.", domain)))
                .unwrap_or(false)
        });
    }

    if let Some(ref search) = query.search {
        let search_lower = search.to_lowercase();
        filtered.retain(|e| {
            let id_match = e
                .get("entity_id")
                .and_then(|id| id.as_str())
                .map(|id| id.to_lowercase().contains(&search_lower))
                .unwrap_or(false);
            let name_match = e
                .get("attributes")
                .and_then(|a| a.get("friendly_name"))
                .and_then(|n| n.as_str())
                .map(|n| n.to_lowercase().contains(&search_lower))
                .unwrap_or(false);
            id_match || name_match
        });
    }

    if let Some(ref state_filter) = query.state {
        filtered.retain(|e| {
            e.get("state")
                .and_then(|s| s.as_str())
                .map(|s| s == state_filter)
                .unwrap_or(false)
        });
    }

    let total = filtered.len() as i32;
    let per_page = query.per_page.min(200).max(1);
    let page = query.page.max(1);
    let offset = (page - 1) * per_page;
    let total_pages = (total as f64 / per_page as f64).ceil() as i32;

    let page_items: Vec<serde_json::Value> = filtered
        .into_iter()
        .skip(offset as usize)
        .take(per_page as usize)
        .cloned()
        .map(|mut e| {
            // Apply field selection
            if let Some(ref fields) = query.fields {
                let field_list: Vec<&str> = fields.split(',').collect();
                if let Some(obj) = e.as_object() {
                    let filtered_obj: serde_json::Map<String, serde_json::Value> = obj
                        .iter()
                        .filter(|(k, _)| field_list.contains(&k.as_str()))
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    e = serde_json::Value::Object(filtered_obj);
                }
            }
            e
        })
        .collect();

    Ok(Json(serde_json::json!({
        "data": page_items,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
        }
    })))
}

async fn v2_get_entity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(entity_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let url = format!("{}/api/states/{}", state.iora_home_url, entity_id);
    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    if !resp.status().is_success() {
        return Err((StatusCode::NOT_FOUND, "Entity not found".to_string()));
    }

    let entity: serde_json::Value = resp.json().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    Ok(Json(entity))
}

async fn v2_entity_history(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(entity_id): Path<String>,
    Query(query): Query<V2ListQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let start = chrono::Utc::now() - chrono::Duration::hours(24);
    let url = format!(
        "{}/api/history/period/{}?filter_entity_id={}",
        state.iora_home_url,
        start.to_rfc3339(),
        entity_id,
    );

    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let history: serde_json::Value = resp.json().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    Ok(Json(serde_json::json!({
        "entity_id": entity_id,
        "history": history,
    })))
}

async fn v2_list_services(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let resp = state
        .http_client
        .get(&format!("{}/api/admin/ha/services", state.iora_home_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let services: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!([]));

    Ok(Json(serde_json::json!({ "data": services })))
}

async fn v2_call_service(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((domain, service)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let url = format!("{}/api/services/{}/{}", state.iora_home_url, domain, service);
    let resp = state
        .http_client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let result: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({"ok": true}));

    Ok(Json(result))
}

async fn v2_list_automations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let resp = state
        .http_client
        .get(&format!("{}/api/admin/ha/automations", state.iora_home_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let automations: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!([]));

    Ok(Json(serde_json::json!({ "data": automations })))
}

async fn v2_trigger_automation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(automation_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let url = format!(
        "{}/api/services/automation/trigger",
        state.iora_home_url
    );
    let body = serde_json::json!({ "entity_id": format!("automation.{}", automation_id) });

    let resp = state
        .http_client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let result: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({"triggered": true}));
    Ok(Json(result))
}

async fn v2_list_areas(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let resp = state.http_client
        .get(&format!("{}/api/admin/ha/areas", state.iora_home_url))
        .header("Authorization", format!("Bearer {}", token))
        .send().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let areas: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!([]));
    Ok(Json(serde_json::json!({ "data": areas })))
}

async fn v2_list_devices(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let resp = state.http_client
        .get(&format!("{}/api/admin/ha/devices", state.iora_home_url))
        .header("Authorization", format!("Bearer {}", token))
        .send().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let devices: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!([]));
    Ok(Json(serde_json::json!({ "data": devices })))
}

async fn v2_list_users(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    let resp = state.http_client
        .get(&format!("{}/api/auth/users", state.iora_home_url))
        .header("Authorization", format!("Bearer {}", token))
        .send().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let users: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!([]));
    Ok(Json(serde_json::json!({ "data": users })))
}

async fn v2_batch_request(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Vec<serde_json::Value>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_bearer(&headers)?;

    if body.len() > 20 {
        return Err((StatusCode::BAD_REQUEST, "Maximum 20 batch operations".to_string()));
    }

    let mut results = Vec::new();

    for (idx, request) in body.iter().enumerate() {
        let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("GET");
        let path = request.get("path").and_then(|p| p.as_str()).unwrap_or("");
        let req_body = request.get("body").cloned();

        let url = format!("{}{}", state.iora_home_url, path);

        let mut req = match method.to_uppercase().as_str() {
            "POST" => state.http_client.post(&url),
            "PUT" => state.http_client.put(&url),
            "DELETE" => state.http_client.delete(&url),
            _ => state.http_client.get(&url),
        };

        req = req.header("Authorization", format!("Bearer {}", token));

        if let Some(b) = req_body {
            req = req.json(&b);
        }

        let result = match req.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!(null));
                serde_json::json!({
                    "index": idx,
                    "status": status,
                    "body": body,
                })
            }
            Err(e) => {
                serde_json::json!({
                    "index": idx,
                    "status": 502,
                    "error": e.to_string(),
                })
            }
        };

        results.push(result);
    }

    Ok(Json(serde_json::json!({ "results": results })))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn extract_bearer(headers: &HeaderMap) -> Result<String, (StatusCode, String)> {
    let auth = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing Authorization header".to_string()))?;

    let token = auth
        .strip_prefix("Bearer ")
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Invalid Authorization format".to_string()))?;

    Ok(token.to_string())
}
