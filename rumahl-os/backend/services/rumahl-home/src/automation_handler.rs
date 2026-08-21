//! Package 4 visual automation engine HTTP API.
//!
//! The engine persists graph-shaped flows in the existing automation tables.
//! Execution currently provides the core Home Assistant action adapter; other
//! Package 4 event sources can submit trigger context through the run endpoint.

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use rumahl_shared::automation::{
    AutomationEdge, AutomationExecution, AutomationFlow, AutomationNode, AutomationNodeKind,
    RunAutomationRequest, SaveAutomationFlowRequest,
};
use serde_json::{json, Value};
use sqlx::Row;
use tracing::info;

use crate::{notification_dispatcher::DispatchRequest, AppState};

type ApiError = (StatusCode, String);

fn validate_flow(request: &SaveAutomationFlowRequest) -> Result<(), ApiError> {
    if request.name.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Automation name is required".into(),
        ));
    }
    if request.cooldown_seconds < 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Cooldown cannot be negative".into(),
        ));
    }
    if !request
        .nodes
        .iter()
        .any(|node| node.kind == AutomationNodeKind::Trigger)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Automation requires at least one trigger".into(),
        ));
    }
    if !request
        .nodes
        .iter()
        .any(|node| node.kind == AutomationNodeKind::Action)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Automation requires at least one action".into(),
        ));
    }

    let ids: HashSet<&str> = request.nodes.iter().map(|node| node.id.as_str()).collect();
    if ids.len() != request.nodes.len() || ids.contains("") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Automation node IDs must be unique and non-empty".into(),
        ));
    }
    if request
        .edges
        .iter()
        .any(|edge| !ids.contains(edge.source.as_str()) || !ids.contains(edge.target.as_str()))
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Automation edges must reference existing nodes".into(),
        ));
    }
    if has_cycle(&request.nodes, &request.edges) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Automation flow cannot contain a cycle".into(),
        ));
    }
    let reachable = reachable_from_triggers(&request.nodes, &request.edges);
    if request.nodes.iter().any(|node| {
        node.kind != AutomationNodeKind::Trigger && !reachable.contains(node.id.as_str())
    }) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Every condition and action must be connected to a trigger".into(),
        ));
    }
    Ok(())
}

fn has_cycle(nodes: &[AutomationNode], edges: &[AutomationEdge]) -> bool {
    let mut indegree: HashMap<&str, usize> =
        nodes.iter().map(|node| (node.id.as_str(), 0)).collect();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        *indegree.entry(edge.target.as_str()).or_default() += 1;
        outgoing
            .entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }
    let mut ready: Vec<&str> = indegree
        .iter()
        .filter_map(|(id, degree)| (*degree == 0).then_some(*id))
        .collect();
    let mut visited = 0;
    while let Some(id) = ready.pop() {
        visited += 1;
        for target in outgoing.get(id).into_iter().flatten() {
            if let Some(degree) = indegree.get_mut(target) {
                *degree -= 1;
                if *degree == 0 {
                    ready.push(target);
                }
            }
        }
    }
    visited != nodes.len()
}

fn reachable_from_triggers<'a>(
    nodes: &'a [AutomationNode],
    edges: &'a [AutomationEdge],
) -> HashSet<&'a str> {
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        outgoing
            .entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }
    let mut reachable: HashSet<&str> = nodes
        .iter()
        .filter(|node| node.kind == AutomationNodeKind::Trigger)
        .map(|node| node.id.as_str())
        .collect();
    let mut pending: Vec<&str> = reachable.iter().copied().collect();
    while let Some(id) = pending.pop() {
        for target in outgoing.get(id).into_iter().flatten() {
            if reachable.insert(target) {
                pending.push(target);
            }
        }
    }
    reachable
}

fn topological_nodes<'a>(
    nodes: &'a [AutomationNode],
    edges: &[AutomationEdge],
) -> Result<Vec<&'a AutomationNode>, String> {
    let node_by_id: HashMap<&str, &AutomationNode> =
        nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let mut indegree: HashMap<&str, usize> =
        nodes.iter().map(|node| (node.id.as_str(), 0)).collect();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        *indegree.entry(edge.target.as_str()).or_default() += 1;
        outgoing
            .entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }
    let mut ready: Vec<&str> = nodes
        .iter()
        .filter_map(|node| (indegree[node.id.as_str()] == 0).then_some(node.id.as_str()))
        .collect();
    ready.reverse();
    let mut ordered = Vec::with_capacity(nodes.len());
    while let Some(id) = ready.pop() {
        ordered.push(node_by_id[id]);
        for target in outgoing.get(id).into_iter().flatten() {
            let degree = indegree
                .get_mut(target)
                .ok_or_else(|| format!("Unknown automation node '{target}'"))?;
            *degree -= 1;
            if *degree == 0 {
                ready.push(target);
            }
        }
    }
    if ordered.len() != nodes.len() {
        return Err("Automation flow contains a cycle".into());
    }
    Ok(ordered)
}

fn row_to_flow(row: &sqlx::postgres::PgRow) -> Result<AutomationFlow, ApiError> {
    let triggers: Value = row.try_get("trigger_config").map_err(internal)?;
    let conditions: Value = row.try_get("condition_config").map_err(internal)?;
    let actions: Value = row.try_get("action_config").map_err(internal)?;
    let stored_edges: Value = row.try_get("flow_edges").map_err(internal)?;
    let mut nodes = Vec::new();
    append_nodes(&mut nodes, triggers, AutomationNodeKind::Trigger, "manual");
    append_nodes(
        &mut nodes,
        conditions,
        AutomationNodeKind::Condition,
        "compare",
    );
    append_nodes(
        &mut nodes,
        actions,
        AutomationNodeKind::Action,
        "home_assistant_service",
    );
    let edges = serde_json::from_value::<Vec<AutomationEdge>>(stored_edges)
        .ok()
        .filter(|edges| !edges.is_empty())
        .unwrap_or_else(|| {
            nodes
                .windows(2)
                .enumerate()
                .map(|(index, pair)| AutomationEdge {
                    id: format!("edge-{index}"),
                    source: pair[0].id.clone(),
                    target: pair[1].id.clone(),
                })
                .collect()
        });
    Ok(AutomationFlow {
        id: row.try_get("id").map_err(internal)?,
        name: row.try_get("name").map_err(internal)?,
        description: row
            .try_get::<Option<String>, _>("description")
            .map_err(internal)?
            .unwrap_or_default(),
        enabled: row.try_get("enabled").map_err(internal)?,
        nodes,
        edges,
        cooldown_seconds: row.try_get("cooldown_seconds").map_err(internal)?,
        last_triggered_at: row.try_get("last_triggered_at").map_err(internal)?,
        trigger_count: row.try_get::<i32, _>("trigger_count").map_err(internal)? as i64,
        created_at: row.try_get("created_at").map_err(internal)?,
        updated_at: row.try_get("updated_at").map_err(internal)?,
    })
}

fn append_nodes(
    target: &mut Vec<AutomationNode>,
    value: Value,
    kind: AutomationNodeKind,
    legacy_adapter: &str,
) {
    if let Ok(items) = serde_json::from_value::<Vec<AutomationNode>>(value.clone()) {
        target.extend(items);
    } else if value.as_object().is_some_and(|object| !object.is_empty()) {
        target.push(AutomationNode {
            id: format!("legacy-{}-{}", legacy_adapter, target.len()),
            kind,
            adapter: legacy_adapter.into(),
            config: value,
            position: Default::default(),
        });
    }
}

fn split_nodes(nodes: &[AutomationNode]) -> (Value, Value, Value) {
    let by_kind = |kind| {
        Value::Array(
            nodes
                .iter()
                .filter(|node| node.kind == kind)
                .map(|node| serde_json::to_value(node).expect("serializable automation node"))
                .collect(),
        )
    };
    (
        by_kind(AutomationNodeKind::Trigger),
        by_kind(AutomationNodeKind::Condition),
        by_kind(AutomationNodeKind::Action),
    )
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

pub async fn list_automations(
    State(state): State<AppState>,
) -> Result<Json<Vec<AutomationFlow>>, ApiError> {
    let rows = sqlx::query("SELECT id, name, description, enabled, trigger_config, condition_config, action_config, cooldown_seconds, last_triggered_at, trigger_count, created_at, updated_at, flow_edges FROM automation_rules ORDER BY updated_at DESC")
        .fetch_all(&state.db_pool).await.map_err(internal)?;
    Ok(Json(
        rows.iter().map(row_to_flow).collect::<Result<_, _>>()?,
    ))
}

pub async fn get_automation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AutomationFlow>, ApiError> {
    let row = sqlx::query("SELECT id, name, description, enabled, trigger_config, condition_config, action_config, cooldown_seconds, last_triggered_at, trigger_count, created_at, updated_at, flow_edges FROM automation_rules WHERE id = $1")
        .bind(&id).fetch_optional(&state.db_pool).await.map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, format!("Automation '{id}' not found")))?;
    Ok(Json(row_to_flow(&row)?))
}

pub async fn create_automation(
    State(state): State<AppState>,
    Json(request): Json<SaveAutomationFlowRequest>,
) -> Result<(StatusCode, Json<AutomationFlow>), ApiError> {
    validate_flow(&request)?;
    let id = uuid::Uuid::new_v4().to_string();
    save_flow(&state, &id, &request, true).await?;
    let Json(flow) = get_automation(State(state), Path(id)).await?;
    Ok((StatusCode::CREATED, Json(flow)))
}

pub async fn update_automation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<SaveAutomationFlowRequest>,
) -> Result<Json<AutomationFlow>, ApiError> {
    validate_flow(&request)?;
    save_flow(&state, &id, &request, false).await?;
    get_automation(State(state), Path(id)).await
}

async fn save_flow(
    state: &AppState,
    id: &str,
    request: &SaveAutomationFlowRequest,
    create: bool,
) -> Result<(), ApiError> {
    let (triggers, conditions, actions) = split_nodes(&request.nodes);
    let edges = serde_json::to_value(&request.edges).map_err(internal)?;
    let result = if create {
        sqlx::query("INSERT INTO automation_rules (id, name, description, rule_type, enabled, trigger_config, condition_config, action_config, cooldown_seconds, flow_version, flow_edges) VALUES ($1, $2, $3, 'flow', $4, $5, $6, $7, $8, 1, $9)")
            .bind(id).bind(request.name.trim()).bind(request.description.trim()).bind(request.enabled).bind(triggers).bind(conditions).bind(actions).bind(request.cooldown_seconds).bind(&edges).execute(&state.db_pool).await
    } else {
        sqlx::query("UPDATE automation_rules SET name=$2, description=$3, enabled=$4, trigger_config=$5, condition_config=$6, action_config=$7, cooldown_seconds=$8, flow_version=1, flow_edges=$9, updated_at=NOW() WHERE id=$1")
            .bind(id).bind(request.name.trim()).bind(request.description.trim()).bind(request.enabled).bind(triggers).bind(conditions).bind(actions).bind(request.cooldown_seconds).bind(&edges).execute(&state.db_pool).await
    }.map_err(internal)?;
    if !create && result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Automation '{id}' not found"),
        ));
    }
    Ok(())
}

pub async fn delete_automation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM automation_rules WHERE id=$1")
        .bind(&id)
        .execute(&state.db_pool)
        .await
        .map_err(internal)?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Automation '{id}' not found"),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn run_automation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<RunAutomationRequest>,
) -> Result<Json<AutomationExecution>, ApiError> {
    let Json(flow) = get_automation(State(state.clone()), Path(id.clone())).await?;
    if !flow.enabled {
        return Err((StatusCode::CONFLICT, "Automation is disabled".into()));
    }
    if let Some(last) = flow.last_triggered_at {
        if (Utc::now() - last).num_seconds() < flow.cooldown_seconds {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                "Automation cooldown is active".into(),
            ));
        }
    }

    let result = execute_flow(&state, &flow, &request.trigger_data).await;
    let (success, output, error) = match result {
        Ok(output) => (true, Some(output), None),
        Err(error) => (false, None, Some(error)),
    };
    let row = sqlx::query("INSERT INTO automation_executions (rule_id, triggered_by, trigger_data, success, result, error) VALUES ($1, 'api', $2, $3, $4, $5) RETURNING id, executed_at")
        .bind(&id).bind(&request.trigger_data).bind(success).bind(&output).bind(&error).fetch_one(&state.db_pool).await.map_err(internal)?;
    if success {
        sqlx::query("UPDATE automation_rules SET last_triggered_at=NOW(), trigger_count=trigger_count+1, updated_at=NOW() WHERE id=$1").bind(&id).execute(&state.db_pool).await.map_err(internal)?;
    }
    let execution = AutomationExecution {
        id: row.try_get("id").map_err(internal)?,
        rule_id: id,
        triggered_by: "api".into(),
        trigger_data: request.trigger_data,
        success,
        result: output,
        error,
        executed_at: row
            .try_get::<DateTime<Utc>, _>("executed_at")
            .map_err(internal)?,
    };
    if execution.success {
        info!(automation_id=%execution.rule_id, "Automation flow executed");
        Ok(Json(execution))
    } else {
        Err((
            StatusCode::BAD_GATEWAY,
            execution
                .error
                .unwrap_or_else(|| "Automation failed".into()),
        ))
    }
}

async fn execute_flow(
    state: &AppState,
    flow: &AutomationFlow,
    trigger_data: &Value,
) -> Result<Value, String> {
    let ordered = topological_nodes(&flow.nodes, &flow.edges)?;
    let mut outputs = Vec::new();
    for node in ordered {
        match (&node.kind, node.adapter.as_str()) {
            (AutomationNodeKind::Trigger, _) => {}
            (AutomationNodeKind::Condition, "compare") => {
                if !evaluate_condition(&node.config, trigger_data) {
                    return Ok(
                        json!({"skipped": true, "reason": "condition_not_met", "node_id": node.id}),
                    );
                }
            }
            (AutomationNodeKind::Condition, adapter) => {
                return Err(format!("Unsupported condition adapter '{adapter}'"))
            }
            (AutomationNodeKind::Action, "home_assistant_service") => {
                let service = node
                    .config
                    .get("service")
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("Action '{}' requires service", node.id))?;
                let (domain, service_name) = service
                    .split_once('/')
                    .ok_or_else(|| format!("Action '{}' service must use domain/name", node.id))?;
                let mut data = node
                    .config
                    .get("data")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                if let (Some(entity), Some(object)) = (
                    node.config.get("entity_id").and_then(Value::as_str),
                    data.as_object_mut(),
                ) {
                    object.insert("entity_id".into(), Value::String(entity.into()));
                }
                let response = state
                    .ha_client
                    .call_service(domain, service_name, data, "")
                    .await
                    .map_err(|error| error.to_string())?;
                outputs.push(
                    json!({"node_id": node.id, "adapter": node.adapter, "response": response}),
                );
            }
            (AutomationNodeKind::Action, "notification") => {
                let message = node
                    .config
                    .get("message")
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("Action '{}' requires message", node.id))?;
                let title = node
                    .config
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Automation");
                let level = node
                    .config
                    .get("level")
                    .and_then(Value::as_str)
                    .unwrap_or("info");
                let (notification_id, channels) = state
                    .notification_dispatcher
                    .dispatch(DispatchRequest {
                        title: title.into(),
                        message: message.into(),
                        level: level.into(),
                        source: format!("automation:{}", flow.id),
                        ..Default::default()
                    })
                    .await;
                outputs.push(json!({"node_id": node.id, "adapter": node.adapter, "notification_id": notification_id, "channels": channels}));
            }
            (AutomationNodeKind::Action, adapter) => {
                return Err(format!("Unsupported action adapter '{adapter}'"))
            }
        }
    }
    Ok(json!({"actions": outputs}))
}

fn evaluate_condition(config: &Value, context: &Value) -> bool {
    let path = config.get("path").and_then(Value::as_str).unwrap_or("");
    let actual = path
        .split('.')
        .filter(|part| !part.is_empty())
        .try_fold(context, |value, part| value.get(part));
    match config
        .get("operator")
        .and_then(Value::as_str)
        .unwrap_or("equals")
    {
        "truthy" => actual.is_some_and(|value| value.as_bool().unwrap_or(!value.is_null())),
        "not_equals" => actual != config.get("value"),
        _ => actual == config.get("value"),
    }
}

pub async fn list_executions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AutomationExecution>>, ApiError> {
    let rows = sqlx::query("SELECT id, rule_id, triggered_by, COALESCE(trigger_data, '{}'::jsonb) trigger_data, success, result, error, executed_at FROM automation_executions WHERE rule_id=$1 ORDER BY executed_at DESC LIMIT 100")
        .bind(id).fetch_all(&state.db_pool).await.map_err(internal)?;
    let executions = rows
        .into_iter()
        .map(|row| {
            Ok(AutomationExecution {
                id: row.try_get("id").map_err(internal)?,
                rule_id: row.try_get("rule_id").map_err(internal)?,
                triggered_by: row.try_get("triggered_by").map_err(internal)?,
                trigger_data: row.try_get("trigger_data").map_err(internal)?,
                success: row.try_get("success").map_err(internal)?,
                result: row.try_get("result").map_err(internal)?,
                error: row.try_get("error").map_err(internal)?,
                executed_at: row.try_get("executed_at").map_err(internal)?,
            })
        })
        .collect::<Result<_, ApiError>>()?;
    Ok(Json(executions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rumahl_shared::automation::AutomationNodePosition;

    fn node(id: &str, kind: AutomationNodeKind) -> AutomationNode {
        AutomationNode {
            id: id.into(),
            kind,
            adapter: "manual".into(),
            config: json!({}),
            position: AutomationNodePosition::default(),
        }
    }

    #[test]
    fn rejects_cycles() {
        let nodes = vec![
            node("trigger", AutomationNodeKind::Trigger),
            node("action", AutomationNodeKind::Action),
        ];
        let edges = vec![
            AutomationEdge {
                id: "one".into(),
                source: "trigger".into(),
                target: "action".into(),
            },
            AutomationEdge {
                id: "two".into(),
                source: "action".into(),
                target: "trigger".into(),
            },
        ];
        assert!(has_cycle(&nodes, &edges));
    }

    #[test]
    fn evaluates_nested_condition_context() {
        assert!(evaluate_condition(
            &json!({"path":"device.online", "operator":"equals", "value":true}),
            &json!({"device":{"online":true}})
        ));
    }

    #[test]
    fn orders_nodes_from_authored_edges() {
        let nodes = vec![
            node("action", AutomationNodeKind::Action),
            node("trigger", AutomationNodeKind::Trigger),
            node("condition", AutomationNodeKind::Condition),
        ];
        let edges = vec![
            AutomationEdge {
                id: "first".into(),
                source: "trigger".into(),
                target: "condition".into(),
            },
            AutomationEdge {
                id: "second".into(),
                source: "condition".into(),
                target: "action".into(),
            },
        ];

        let ordered = topological_nodes(&nodes, &edges).expect("valid graph");
        assert_eq!(
            ordered
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec!["trigger", "condition", "action"]
        );
    }

    #[test]
    fn rejects_actions_disconnected_from_triggers() {
        let request = SaveAutomationFlowRequest {
            name: "Disconnected".into(),
            description: String::new(),
            enabled: true,
            nodes: vec![
                node("trigger", AutomationNodeKind::Trigger),
                node("action", AutomationNodeKind::Action),
            ],
            edges: Vec::new(),
            cooldown_seconds: 0,
        };

        assert_eq!(
            validate_flow(&request).unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
    }
}
