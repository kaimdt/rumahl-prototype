//! IORA Desktop Notification Listener
//!
//! Connects to the iora-home WebSocket and listens for `desktop_notification` events.
//! Forwards them to the frontend via Tauri events, and emits a native OS notification.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::Message;
use futures_util::StreamExt;
use tracing::{info, warn, debug};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IoraNotification {
    pub id: String,
    pub title: String,
    pub message: String,
    pub level: String,
    pub source: String,
    pub icon: String,
    pub auto_dismiss_secs: u64,
}

/// Spawn a background task that keeps a WebSocket connection to iora-home open
/// and forwards `desktop_notification` events to the Tauri frontend.
///
/// The task reconnects automatically with exponential back-off (max 60 s).
pub fn start_notification_listener(
    app: AppHandle,
    iora_home_url: String,
    auth_token: String,
    client_id: String,
) {
    tauri::async_runtime::spawn(async move {
        let mut backoff_secs: u64 = 2;

        loop {
            let ws_url = build_ws_url(&iora_home_url);
            match tokio_tungstenite::connect_async(&ws_url).await {
                Ok((mut stream, _)) => {
                    info!("[notif] WebSocket connected to iora-home for notifications");
                    backoff_secs = 2; // reset on success

                    // Send registration message so iora-home knows which desktop client this is.
                    let reg = serde_json::json!({
                        "type": "desktop_register",
                        "client_id": client_id,
                    });
                    if let Err(e) = {
                        use futures_util::SinkExt;
                        stream.send(Message::Text(reg.to_string())).await
                    } {
                        warn!("[notif] Failed to send registration: {e}");
                    }

                    while let Some(msg) = stream.next().await {
                        match msg {
                            Ok(Message::Text(text)) => {
                                handle_message(&app, &text, &client_id);
                            }
                            Ok(Message::Close(_)) => {
                                info!("[notif] WebSocket closed by server");
                                break;
                            }
                            Err(e) => {
                                warn!("[notif] WebSocket error: {e}");
                                break;
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    debug!("[notif] WebSocket connect failed: {e} — retry in {backoff_secs}s");
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs)).await;
            backoff_secs = (backoff_secs * 2).min(60);
        }
    });
}

fn handle_message(app: &AppHandle, text: &str, client_id: &str) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    let Some(msg_type) = value.get("type").and_then(|v| v.as_str()) else {
        return;
    };

    if msg_type != "desktop_notification" {
        return;
    }

    // Filter by target: '*' means all, or must match our client_id.
    let target = value.get("target").and_then(|v| v.as_str()).unwrap_or("*");
    if target != "*" && target != client_id {
        return;
    }

    let Some(n) = value.get("notification") else { return };

    let notification = IoraNotification {
        id: n.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: n.get("title").and_then(|v| v.as_str()).unwrap_or("IORA").to_string(),
        message: n.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        level: n.get("level").and_then(|v| v.as_str()).unwrap_or("info").to_string(),
        source: n.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        icon: n.get("icon").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        auto_dismiss_secs: n.get("auto_dismiss_secs").and_then(|v| v.as_u64()).unwrap_or(0),
    };

    info!(
        "[notif] Desktop notification received: [{}] {}",
        notification.level, notification.title
    );

    // Emit to the Tauri frontend (settings window / any open window).
    let _ = app.emit("iora-notification", &notification);
}

/// Convert an http(s) URL to a ws(s) URL and append the WS endpoint.
fn build_ws_url(base: &str) -> String {
    let base = base.trim_end_matches('/');
    let ws_base = if base.starts_with("https://") {
        base.replacen("https://", "wss://", 1)
    } else {
        base.replacen("http://", "ws://", 1)
    };
    format!("{}/ws", ws_base)
}
