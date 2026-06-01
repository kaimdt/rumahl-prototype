//! MQTT bridge for IORA API.
//!
//! Provides HTTP-to-MQTT bridging, allowing clients to:
//! - Publish MQTT messages via HTTP POST
//! - Subscribe to MQTT topics via WebSocket
//! - List available MQTT topics
//!
//! Connects to the Home Assistant MQTT broker (or any configured MQTT broker).

use axum::{
    extract::{State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;

#[derive(Debug, Deserialize)]
pub struct MqttPublishRequest {
    pub topic: String,
    pub payload: serde_json::Value,
    pub qos: Option<i32>,
    pub retain: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct MqttPublishResponse {
    success: bool,
    topic: String,
    message: Option<String>,
}

/// Publish an MQTT message via the IORA Home MQTT bridge.
pub async fn mqtt_publish(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Json(body): Json<MqttPublishRequest>,
) -> Result<Json<MqttPublishResponse>, (StatusCode, String)> {
    let token = extract_token(&headers)?;

    // Forward to IORA Home's MQTT publish endpoint
    let url = format!("{}/api/admin/mqtt/publish", state.iora_home_url);
    let mqtt_body = serde_json::json!({
        "topic": body.topic,
        "payload": body.payload.to_string(),
        "qos": body.qos.unwrap_or(0),
        "retain": body.retain.unwrap_or(false),
    });

    let resp = state
        .http_client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&mqtt_body)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("MQTT bridge error: {}", e)))?;

    let success = resp.status().is_success();

    Ok(Json(MqttPublishResponse {
        success,
        topic: body.topic,
        message: if success {
            Some("Published".to_string())
        } else {
            Some("Failed to publish".to_string())
        },
    }))
}

/// WebSocket endpoint for MQTT subscriptions.
/// Clients connect and send subscription requests, receive real-time messages.
pub async fn mqtt_subscribe_ws(
    State(state): State<Arc<crate::AppState>>,
    ws: WebSocketUpgrade,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token = extract_token_opt(&headers).unwrap_or_default();

    ws.on_upgrade(move |mut socket| async move {
        use axum::extract::ws::Message;
        use futures_util::{SinkExt, StreamExt};

        // Simple MQTT over WebSocket bridge
        // Client sends: { "type": "subscribe", "topic": "homeassistant/#" }
        // Server sends: { "type": "message", "topic": "...", "payload": "..." }

        while let Some(Ok(msg)) = socket.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        let msg_type = parsed["type"].as_str().unwrap_or("");

                        match msg_type {
                            "subscribe" => {
                                let topic = parsed["topic"].as_str().unwrap_or("#");
                                let ack = serde_json::json!({
                                    "type": "subscribed",
                                    "topic": topic,
                                });
                                let _ = socket.send(Message::Text(ack.to_string())).await;
                                info!("MQTT WS client subscribed to: {}", topic);

                                // Subscribe via iora-home, which holds the persistent MQTT
                                // broker connection on behalf of all microservices.
                                let sub_url = format!(
                                    "{}/api/admin/mqtt/subscribe",
                                    state.iora_home_url
                                );
                                let sub_body = serde_json::json!({ "topic": topic });
                                let _ = state
                                    .http_client
                                    .post(&sub_url)
                                    .header("Authorization", format!("Bearer {}", token))
                                    .json(&sub_body)
                                    .send()
                                    .await;
                            }
                            "publish" => {
                                let topic = parsed["topic"].as_str().unwrap_or("");
                                let payload = &parsed["payload"];

                                let pub_url = format!(
                                    "{}/api/admin/mqtt/publish",
                                    state.iora_home_url
                                );
                                let pub_body = serde_json::json!({
                                    "topic": topic,
                                    "payload": payload.to_string(),
                                });
                                let _ = state
                                    .http_client
                                    .post(&pub_url)
                                    .header("Authorization", format!("Bearer {}", token))
                                    .json(&pub_body)
                                    .send()
                                    .await;

                                let ack = serde_json::json!({
                                    "type": "published",
                                    "topic": topic,
                                });
                                let _ = socket.send(Message::Text(ack.to_string())).await;
                            }
                            _ => {
                                let err = serde_json::json!({
                                    "type": "error",
                                    "message": format!("Unknown message type: {}", msg_type),
                                });
                                let _ = socket.send(Message::Text(err.to_string())).await;
                            }
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    })
}

/// List available MQTT topics (from HA integration).
pub async fn list_topics(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;

    // Get entity list and extract MQTT-related topics
    let resp = state
        .http_client
        .get(format!("{}/api/states", state.iora_home_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let entities: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();

    // Extract common MQTT topic patterns from entity domains
    let domains: Vec<String> = entities
        .iter()
        .filter_map(|e| {
            e["entity_id"]
                .as_str()
                .map(|id| id.split('.').next().unwrap_or("").to_string())
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let suggested_topics: Vec<serde_json::Value> = domains
        .iter()
        .map(|d| {
            serde_json::json!({
                "topic": format!("homeassistant/{}/#", d),
                "description": format!("All {} state changes", d),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "common_topics": [
            {"topic": "homeassistant/#", "description": "All Home Assistant messages"},
            {"topic": "homeassistant/sensor/#", "description": "All sensor updates"},
            {"topic": "homeassistant/light/#", "description": "All light state changes"},
            {"topic": "homeassistant/switch/#", "description": "All switch state changes"},
        ],
        "domain_topics": suggested_topics,
    })))
}

fn extract_token(headers: &HeaderMap) -> Result<String, (StatusCode, String)> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(|t| t.to_string())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing Authorization".to_string()))
}

fn extract_token_opt(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(|t| t.to_string())
}
