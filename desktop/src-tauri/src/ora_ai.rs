// ORA AI Integration Module
// Provides commands for AI overlay, voice activation, and tool execution

use crate::commands::AppState;
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIChatMessage {
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIChatRequest {
    pub message: String,
    pub context: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIChatResponse {
    pub message: String,
    pub provider: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotData {
    pub image_base64: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub color: String, // hex color like "#ff0000"
    pub duration_ms: u64,
}

/// Get the ORA AI assist URL from environment or use default
fn get_assist_url() -> String {
    std::env::var("IORA_ASSIST_URL").unwrap_or_else(|_| "http://localhost:8092".to_string())
}

/// Send a chat message to ORA AI
#[tauri::command]
pub async fn ora_send_chat(
    message: String,
    context: Option<serde_json::Value>,
    video_data: Option<String>,
    state: State<'_, AppState>,
) -> Result<AIChatResponse, String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    let assist_url = get_assist_url();

    let client = reqwest::Client::new();
    let request = AIChatRequest {
        message,
        context,
        video_data,
    };

    match client
        .post(format!("{}/api/assist/chat", assist_url))
        .json(&request)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(data) => Ok(AIChatResponse {
                        message: data["message"].as_str().unwrap_or("").to_string(),
                        provider: data["provider"].as_str().unwrap_or("unknown").to_string(),
                        message_id: data["message_id"].as_str().unwrap_or("").to_string(),
                    }),
                    Err(e) => Err(format!("Failed to parse response: {}", e)),
                }
            } else {
                Err(format!("Request failed with status: {}", response.status()))
            }
        }
        Err(e) => Err(format!("Failed to send request: {}", e)),
    }
}

/// Search the internet using ORA AI tools
#[tauri::command]
pub async fn ora_search_internet(
    query: String,
    max_results: Option<usize>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    let assist_url = get_assist_url();

    let client = reqwest::Client::new();
    let request = SearchRequest { query, max_results };

    match client
        .post(format!("{}/api/assist/tools/search", assist_url))
        .json(&request)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(data) => Ok(data),
                    Err(e) => Err(format!("Failed to parse response: {}", e)),
                }
            } else {
                Err(format!("Search failed with status: {}", response.status()))
            }
        }
        Err(e) => Err(format!("Failed to send search request: {}", e)),
    }
}

/// Show the AI overlay window
#[tauri::command]
pub async fn ora_show_overlay(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    if let Some(window) = app.get_webview_window("ora-overlay") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Create overlay window if it doesn't exist
        let window = tauri::WebviewWindowBuilder::new(
            &app,
            "ora-overlay",
            tauri::WebviewUrl::App("/ora-overlay".into()),
        )
        .title("ORA AI")
        .inner_size(400.0, 600.0)
        .position(0.0, 0.0) // Will be positioned by JS
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

        // Position at bottom right of screen
        if let Ok(monitor) = window.current_monitor() {
            if let Some(monitor) = monitor {
                let size = monitor.size();
                let window_size = window.outer_size().map_err(|e| e.to_string())?;
                let padding = 20;
                let x = size.width as i32 - window_size.width as i32 - padding;
                let y = size.height as i32 - window_size.height as i32 - padding;
                window
                    .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Hide the AI overlay window
#[tauri::command]
pub async fn ora_hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("ora-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Toggle the AI overlay window
#[tauri::command]
pub async fn ora_toggle_overlay(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    if let Some(window) = app.get_webview_window("ora-overlay") {
        if window.is_visible().map_err(|e| e.to_string())? {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    } else {
        ora_show_overlay(app, state).await?;
    }
    Ok(())
}

/// Capture a screenshot of the current screen
#[tauri::command]
pub async fn ora_capture_screenshot(state: State<'_, AppState>) -> Result<ScreenshotData, String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    // Get all available screens
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

    // Use the primary screen (first one)
    let screen = screens
        .first()
        .ok_or_else(|| "No screens available".to_string())?;

    // Capture the screenshot
    let image = screen
        .capture()
        .map_err(|e| format!("Failed to capture screenshot: {}", e))?;

    // Convert to PNG and encode as base64
    let png_data = image
        .to_png(None)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    use base64::prelude::*;
    let image_base64 = BASE64_STANDARD.encode(&png_data);

    Ok(ScreenshotData {
        image_base64,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

/// Show screen highlights
#[tauri::command]
pub async fn ora_highlight_screen(
    regions: Vec<HighlightRegion>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    // In a real implementation we would open a transparent window that draws these highlights.
    // For now we'll just log them to demonstrate the API exists and is wired up.
    for region in regions {
        tracing::info!(
            "ORA Highlight: x={} y={} w={} h={} color={} duration={}ms",
            region.x,
            region.y,
            region.width,
            region.height,
            region.color,
            region.duration_ms
        );
    }

    app.emit("ora-highlights", ()).map_err(|e| e.to_string())?;

    Ok(())
}

/// Execute a desktop action (open app, run command, etc.)
#[tauri::command]
pub async fn ora_execute_desktop_action(
    action_type: String,
    params: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    match action_type.as_str() {
        "open_url" => {
            if let Some(url) = params.get("url").and_then(|u| u.as_str()) {
                #[cfg(target_os = "windows")]
                {
                    std::process::Command::new("cmd")
                        .args(&["/C", "start", url])
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(target_os = "macos")]
                {
                    std::process::Command::new("open")
                        .arg(url)
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(target_os = "linux")]
                {
                    std::process::Command::new("xdg-open")
                        .arg(url)
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
                Ok(format!("Opened URL: {}", url))
            } else {
                Err("Missing url parameter".to_string())
            }
        }
        "open_app" => {
            if let Some(app_name) = params.get("app").and_then(|a| a.as_str()) {
                #[cfg(target_os = "windows")]
                {
                    std::process::Command::new("cmd")
                        .args(&["/C", "start", app_name])
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(target_os = "macos")]
                {
                    std::process::Command::new("open")
                        .args(&["-a", app_name])
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(target_os = "linux")]
                {
                    std::process::Command::new(app_name)
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
                Ok(format!("Opened app: {}", app_name))
            } else {
                Err("Missing app parameter".to_string())
            }
        }
        _ => Err(format!("Unknown action type: {}", action_type)),
    }
}
