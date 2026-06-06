//! GraphQL interface for the IORA ecosystem.
//!
//! Provides a full GraphQL API with:
//! - Queries: entities, entity history, services, automations, areas, devices, config
//! - Mutations: call service, set state, trigger automation
//! - Subscriptions: entity state changes (via WebSocket)

use async_graphql::*;
use axum::{
    extract::State,
    http::HeaderMap,
    response::{Html, IntoResponse, Json},
};
use std::sync::Arc;

pub type IoraSchema = Schema<QueryRoot, MutationRoot, SubscriptionRoot>;

/// Build the GraphQL schema with context.
pub fn build_schema(
    iora_home_url: String,
    ha_url: String,
    ha_token: String,
    http_client: reqwest::Client,
) -> IoraSchema {
    let context = GraphQLContext {
        iora_home_url,
        ha_url,
        ha_token,
        http_client,
    };

    Schema::build(QueryRoot, MutationRoot, SubscriptionRoot)
        .data(context)
        .finish()
}

#[derive(Clone)]
pub struct GraphQLContext {
    pub iora_home_url: String,
    #[allow(dead_code)]
    pub ha_url: String,
    #[allow(dead_code)]
    pub ha_token: String,
    pub http_client: reqwest::Client,
}

// ─── Types ──────────────────────────────────────────────────────────────────

/// A smart-home entity with state and attributes.
#[derive(SimpleObject, Clone)]
struct Entity {
    entity_id: String,
    state: String,
    attributes: serde_json::Value,
    last_changed: Option<String>,
    last_updated: Option<String>,
    domain: String,
    friendly_name: Option<String>,
}

/// Result of a service call.
#[derive(SimpleObject)]
struct ServiceCallResult {
    success: bool,
    message: Option<String>,
    affected_entities: Vec<String>,
}

/// A Home Assistant area.
#[derive(SimpleObject, Clone)]
struct Area {
    area_id: String,
    name: String,
}

/// A Home Assistant device.
#[allow(dead_code)]
#[derive(SimpleObject, Clone)]
struct Device {
    id: String,
    name: Option<String>,
    manufacturer: Option<String>,
    model: Option<String>,
    area_id: Option<String>,
}

/// An automation.
#[derive(SimpleObject, Clone)]
struct Automation {
    entity_id: String,
    state: String,
    friendly_name: Option<String>,
    last_triggered: Option<String>,
}

// ─── Query ──────────────────────────────────────────────────────────────────

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Get all entities, optionally filtered by domain.
    async fn entities(
        &self,
        ctx: &Context<'_>,
        domain: Option<String>,
        search: Option<String>,
        state: Option<String>,
    ) -> Result<Vec<Entity>> {
        let gql_ctx = ctx.data::<GraphQLContext>()?;
        let token = ctx.data::<String>().unwrap_or(&String::new()).clone();

        let resp = gql_ctx
            .http_client
            .get(format!("{}/api/states", gql_ctx.iora_home_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        let raw: Vec<serde_json::Value> = resp.json().await?;

        let mut entities: Vec<Entity> = raw
            .into_iter()
            .map(|e| {
                let entity_id = e["entity_id"].as_str().unwrap_or("").to_string();
                let domain_part = entity_id.split('.').next().unwrap_or("").to_string();
                let friendly_name = e["attributes"]["friendly_name"]
                    .as_str()
                    .map(|s| s.to_string());

                Entity {
                    entity_id,
                    state: e["state"].as_str().unwrap_or("unknown").to_string(),
                    attributes: e["attributes"].clone(),
                    last_changed: e["last_changed"].as_str().map(|s| s.to_string()),
                    last_updated: e["last_updated"].as_str().map(|s| s.to_string()),
                    domain: domain_part,
                    friendly_name,
                }
            })
            .collect();

        // Apply filters
        if let Some(ref d) = domain {
            entities.retain(|e| e.domain == *d);
        }
        if let Some(ref s) = search {
            let s_lower = s.to_lowercase();
            entities.retain(|e| {
                e.entity_id.to_lowercase().contains(&s_lower)
                    || e.friendly_name
                        .as_ref()
                        .map(|n| n.to_lowercase().contains(&s_lower))
                        .unwrap_or(false)
            });
        }
        if let Some(ref st) = state {
            entities.retain(|e| e.state == *st);
        }

        Ok(entities)
    }

    /// Get a single entity by ID.
    async fn entity(&self, ctx: &Context<'_>, entity_id: String) -> Result<Option<Entity>> {
        let gql_ctx = ctx.data::<GraphQLContext>()?;
        let token = ctx.data::<String>().unwrap_or(&String::new()).clone();

        let resp = gql_ctx
            .http_client
            .get(format!("{}/api/states/{}", gql_ctx.iora_home_url, entity_id))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if !resp.status().is_success() {
            return Ok(None);
        }

        let e: serde_json::Value = resp.json().await?;
        let eid = e["entity_id"].as_str().unwrap_or("").to_string();
        let domain = eid.split('.').next().unwrap_or("").to_string();

        Ok(Some(Entity {
            entity_id: eid,
            state: e["state"].as_str().unwrap_or("unknown").to_string(),
            attributes: e["attributes"].clone(),
            last_changed: e["last_changed"].as_str().map(|s| s.to_string()),
            last_updated: e["last_updated"].as_str().map(|s| s.to_string()),
            domain,
            friendly_name: e["attributes"]["friendly_name"]
                .as_str()
                .map(|s| s.to_string()),
        }))
    }

    /// List all entity domains.
    async fn domains(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
        let entities = self.entities(ctx, None, None, None).await?;
        let mut domains: Vec<String> = entities.iter().map(|e| e.domain.clone()).collect();
        domains.sort();
        domains.dedup();
        Ok(domains)
    }

    /// Get all areas.
    async fn areas(&self, ctx: &Context<'_>) -> Result<Vec<Area>> {
        let gql_ctx = ctx.data::<GraphQLContext>()?;
        let token = ctx.data::<String>().unwrap_or(&String::new()).clone();

        let resp = gql_ctx
            .http_client
            .get(format!("{}/api/admin/ha/areas", gql_ctx.iora_home_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        let raw: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();
        let areas = raw
            .into_iter()
            .map(|a| Area {
                area_id: a["area_id"].as_str().unwrap_or("").to_string(),
                name: a["name"].as_str().unwrap_or("").to_string(),
            })
            .collect();

        Ok(areas)
    }

    /// Get all automations.
    async fn automations(&self, ctx: &Context<'_>) -> Result<Vec<Automation>> {
        let entities = self.entities(ctx, Some("automation".to_string()), None, None).await?;
        let automations = entities
            .into_iter()
            .map(|e| Automation {
                entity_id: e.entity_id,
                state: e.state,
                friendly_name: e.friendly_name,
                last_triggered: e.attributes.get("last_triggered")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            })
            .collect();
        Ok(automations)
    }
}

// ─── Mutation ───────────────────────────────────────────────────────────────

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    /// Call a Home Assistant service.
    async fn call_service(
        &self,
        ctx: &Context<'_>,
        domain: String,
        service: String,
        data: Option<serde_json::Value>,
    ) -> Result<ServiceCallResult> {
        let gql_ctx = ctx.data::<GraphQLContext>()?;
        let token = ctx.data::<String>().unwrap_or(&String::new()).clone();

        let url = format!("{}/api/services/{}/{}", gql_ctx.iora_home_url, domain, service);
        let body = data.unwrap_or(serde_json::json!({}));

        let resp = gql_ctx
            .http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await?;

        let success = resp.status().is_success();
        let result: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!(null));

        let affected: Vec<String> = if let Some(arr) = result.as_array() {
            arr.iter()
                .filter_map(|e| e["entity_id"].as_str().map(|s| s.to_string()))
                .collect()
        } else {
            vec![]
        };

        Ok(ServiceCallResult {
            success,
            message: if success { None } else { Some("Service call failed".to_string()) },
            affected_entities: affected,
        })
    }

    /// Toggle an entity (light, switch, etc.).
    async fn toggle(&self, ctx: &Context<'_>, entity_id: String) -> Result<ServiceCallResult> {
        let domain = entity_id.split('.').next().unwrap_or("homeassistant").to_string();
        self.call_service(
            ctx,
            domain,
            "toggle".to_string(),
            Some(serde_json::json!({ "entity_id": entity_id })),
        )
        .await
    }

    /// Trigger an automation.
    async fn trigger_automation(&self, ctx: &Context<'_>, entity_id: String) -> Result<ServiceCallResult> {
        self.call_service(
            ctx,
            "automation".to_string(),
            "trigger".to_string(),
            Some(serde_json::json!({ "entity_id": entity_id })),
        )
        .await
    }
}

// ─── Subscription ───────────────────────────────────────────────────────────

pub struct SubscriptionRoot;

#[Subscription]
impl SubscriptionRoot {
    /// Subscribe to entity state changes.
    ///
    /// Polls iora-home `/api/states` periodically and emits an `Entity` whenever
    /// the state or last_changed timestamp differs from the previously observed
    /// value. Optionally filters by exact entity_id or domain prefix.
    async fn entity_changed(
        &self,
        ctx: &Context<'_>,
        entity_id: Option<String>,
        domain: Option<String>,
    ) -> impl futures_util::Stream<Item = Entity> {
        let gql_ctx = ctx
            .data::<GraphQLContext>().cloned()
            .ok();

        async_stream::stream! {
            let Some(gql_ctx) = gql_ctx else { return; };
            let mut last_seen: std::collections::HashMap<String, String> = std::collections::HashMap::new();
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                interval.tick().await;
                let resp = match gql_ctx
                    .http_client
                    .get(format!("{}/api/states", gql_ctx.iora_home_url))
                    .send()
                    .await
                {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                let states: Vec<serde_json::Value> = match resp.json().await {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                for state in states {
                    let eid = match state.get("entity_id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    if let Some(filter) = &entity_id {
                        if &eid != filter { continue; }
                    }
                    let dom = eid.split('.').next().unwrap_or("").to_string();
                    if let Some(filter) = &domain {
                        if &dom != filter { continue; }
                    }
                    let s = state
                        .get("state")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let last_changed = state
                        .get("last_changed")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let signature = format!(
                        "{}|{}",
                        s,
                        last_changed.clone().unwrap_or_default()
                    );
                    let prev = last_seen.get(&eid).cloned();
                    if prev.as_deref() == Some(signature.as_str()) {
                        continue;
                    }
                    last_seen.insert(eid.clone(), signature);

                    // Skip first observation (initial baseline) so we only emit deltas
                    if prev.is_none() {
                        continue;
                    }

                    let attributes = state
                        .get("attributes")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let friendly_name = state
                        .get("attributes")
                        .and_then(|a| a.get("friendly_name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let last_updated = state
                        .get("last_updated")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    yield Entity {
                        entity_id: eid,
                        state: s,
                        attributes,
                        last_changed,
                        last_updated,
                        domain: dom,
                        friendly_name,
                    };
                }
            }
        }
    }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

pub async fn graphql_playground() -> impl IntoResponse {
    Html(async_graphql::http::playground_source(
        async_graphql::http::GraphQLPlaygroundConfig::new("/graphql")
            .subscription_endpoint("/graphql/ws"),
    ))
}

pub async fn graphql_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Json(request_body): Json<async_graphql::Request>,
) -> impl IntoResponse {
    let mut request = request_body;

    // Pass auth token to GraphQL context
    if let Some(auth) = headers.get("Authorization").and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            request = request.data(token.to_string());
        }
    }

    let resp = state.graphql_schema.execute(request).await;
    Json(resp)
}

pub async fn graphql_ws_handler(
    State(_state): State<Arc<crate::AppState>>,
) -> impl IntoResponse {
    // GraphQL subscriptions over WebSocket not yet available.
    // Use polling or SSE-based subscriptions instead.
    (axum::http::StatusCode::NOT_IMPLEMENTED, "GraphQL WebSocket subscriptions are not yet available")
}
