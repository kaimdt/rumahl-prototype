// ORA AI Integration Module
// Provides commands for AI overlay, voice activation, and tool execution

use crate::commands::AppState;
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use enigo::{Enigo, Keyboard, Mouse, Coordinate, Button, Key, Direction};

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
        // .transparent(true) // Removed: not available in Tauri v2, use CSS instead
        .always_on_top(true)
        .resizable(false)
        .shadow(false)
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

/// Capture a "video" (represented by a series of frames or a keyframe) of the current screen
#[tauri::command]
pub async fn ora_capture_video(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let is_privacy_mode = state.config.lock().await.ora_privacy_mode;
    if is_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    // Capture the primary screen (using the same logic as screenshot but representing video keyframe)
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;
    let screen = screens.first().ok_or("No screen found")?;

    let image = screen.capture().map_err(|e| format!("Failed to capture screen: {}", e))?;

    let png_data = image
        .to_png(None)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    use base64::prelude::*;
    let image_base64 = BASE64_STANDARD.encode(&png_data);
    
    // Simulate a short recording time to represent video
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    let timestamp = chrono::Local::now().to_rfc3339();

    Ok(serde_json::json!({
        "video_base64": image_base64,
        "timestamp": timestamp
    }))
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
    let config = state.config.lock().await.clone();

    if config.ora_privacy_mode {
        return Err("ORA AI is disabled (Privacy Mode active)".to_string());
    }

    // Unless it's a completely harmless read-only action, check permissions.
    // For powerful system actions, require allow_control or autopilot.
    let requires_control = match action_type.as_str() {
        "open_url" => false, // Decided safe enough
        _ => true,
    };

    if requires_control && !config.ora_allow_control && !config.ora_autopilot {
        return Err("ORA AI does not have permission to control the system. Enable 'Allow Control' or 'Autopilot'.".to_string());
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
        "run_shell" => {
            if let Some(command) = params.get("command").and_then(|c| c.as_str()) {
                #[cfg(target_os = "windows")]
                {
                    let output = std::process::Command::new("cmd")
                        .args(&["/C", command])
                        .output()
                        .map_err(|e| e.to_string())?;
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Ok(format!("stdout: {}\nstderr: {}", stdout, stderr))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let output = std::process::Command::new("sh")
                        .arg("-c")
                        .arg(command)
                        .output()
                        .map_err(|e| e.to_string())?;
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Ok(format!("stdout: {}\nstderr: {}", stdout, stderr))
                }
            } else {
                Err("Missing command parameter".to_string())
            }
        }
        "type_text" => {
            if let Some(text) = params.get("text").and_then(|t| t.as_str()) {
                let mut enigo = Enigo::new(&enigo::Settings::default()).map_err(|e| e.to_string())?;
                enigo.text(text).map_err(|e| e.to_string())?;
                Ok(format!("Typed text: {}", text))
            } else {
                Err("Missing text parameter".to_string())
            }
        }
        "press_key" => {
            if let Some(key_str) = params.get("key").and_then(|k| k.as_str()) {
                let mut enigo = Enigo::new(&enigo::Settings::default()).map_err(|e| e.to_string())?;

                // Parse key
                let key = match key_str.to_lowercase().as_str() {
                    "enter" | "return" => Key::Return,
                    "tab" => Key::Tab,
                    "space" => Key::Space,
                    "backspace" => Key::Backspace,
                    "escape" | "esc" => Key::Escape,
                    "super" | "win" | "cmd" | "command" => Key::Meta,
                    "shift" => Key::Shift,
                    "control" | "ctrl" => Key::Control,
                    "alt" => Key::Alt,
                    "up" => Key::UpArrow,
                    "down" => Key::DownArrow,
                    "left" => Key::LeftArrow,
                    "right" => Key::RightArrow,
                    // Simple fallback for single chars if not matched
                    other => {
                        let mut chars = other.chars();
                        if let Some(c) = chars.next() {
                            if chars.next().is_none() {
                                Key::Unicode(c)
                            } else {
                                return Err(format!("Unknown key: {}", key_str));
                            }
                        } else {
                            return Err("Empty key parameter".to_string());
                        }
                    }
                };

                enigo.key(key, Direction::Click).map_err(|e| e.to_string())?;
                Ok(format!("Pressed key: {}", key_str))
            } else {
                Err("Missing key parameter".to_string())
            }
        }
        "mouse_click" => {
            let mut enigo = Enigo::new(&enigo::Settings::default()).map_err(|e| e.to_string())?;
            enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
            Ok("Clicked left mouse button".to_string())
        }
        "mouse_move" => {
            if let (Some(x), Some(y)) = (
                params.get("x").and_then(|v| v.as_i64()),
                params.get("y").and_then(|v| v.as_i64()),
            ) {
                let mut enigo = Enigo::new(&enigo::Settings::default()).map_err(|e| e.to_string())?;
                enigo.move_mouse(x as i32, y as i32, Coordinate::Abs).map_err(|e| e.to_string())?;
                Ok(format!("Moved mouse to ({}, {})", x, y))
            } else {
                Err("Missing x or y parameter".to_string())
            }
        }
        _ => Err(format!("Unknown action type: {}", action_type)),
    }
}
