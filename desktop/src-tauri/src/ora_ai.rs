// ORA AI Integration Module
// Provides commands for AI overlay, voice activation, and tool execution

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use crate::commands::AppState;
use screenshots::Screen;
use image::ImageFormat;
use std::io::Cursor;

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

/// Get the ORA AI assist URL from environment or use default
fn get_assist_url() -> String {
    std::env::var("IORA_ASSIST_URL")
        .unwrap_or_else(|_| "http://localhost:8092".to_string())
}

/// Send a chat message to ORA AI
#[tauri::command]
pub async fn ora_send_chat(
    message: String,
    context: Option<serde_json::Value>,
    _state: State<'_, AppState>,
) -> Result<AIChatResponse, String> {
    let assist_url = get_assist_url();

    let client = reqwest::Client::new();
    let request = AIChatRequest { message, context };

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
    _state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
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
pub async fn ora_show_overlay(app: AppHandle) -> Result<(), String> {
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

        // Position at top center of screen
        if let Ok(monitor) = window.current_monitor() {
            if let Some(monitor) = monitor {
                let size = monitor.size();
                let window_size = window.outer_size().map_err(|e| e.to_string())?;
                let x = (size.width as i32 - window_size.width as i32) / 2;
                window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x,
                    y: 0,
                })).map_err(|e| e.to_string())?;
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
pub async fn ora_toggle_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("ora-overlay") {
        if window.is_visible().map_err(|e| e.to_string())? {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    } else {
        ora_show_overlay(app).await?;
    }
    Ok(())
}

/// Capture a screenshot of the current screen
#[tauri::command]
pub async fn ora_capture_screenshot() -> Result<ScreenshotData, String> {
    // Get all available screens
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

    // Use the primary screen (first one)
    let screen = screens.first()
        .ok_or_else(|| "No screens available".to_string())?;

    // Capture the screenshot
    let image = screen.capture()
        .map_err(|e| format!("Failed to capture screenshot: {}", e))?;

    // Convert to PNG and encode as base64
    let mut png_data = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_data);
        image.save(&mut cursor, ImageFormat::Png)
            .map_err(|e| format!("Failed to encode PNG: {}", e))?;
    }

    let image_base64 = base64::encode(&png_data);

    Ok(ScreenshotData {
        image_base64,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

/// Execute a desktop action (open app, run command, etc.)
#[tauri::command]
pub async fn ora_execute_desktop_action(
    action_type: String,
    params: serde_json::Value,
) -> Result<String, String> {
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
