//! Autostart management for desktop client

use anyhow::Result;
use auto_launch::AutoLaunch;
use tauri::State;

use crate::commands::AppState;

/// Set up or remove autostart functionality
pub fn configure_autostart(app_name: &str, app_path: &str, enabled: bool) -> Result<()> {
    #[cfg(target_os = "macos")]
    let auto = AutoLaunch::new(app_name, app_path, true, &[] as &[&str]);
    #[cfg(not(target_os = "macos"))]
    let auto = AutoLaunch::new(app_name, app_path, &[] as &[&str]);

    if enabled {
        auto.enable()?;
        tracing::info!("Autostart enabled for {}", app_name);
    } else {
        auto.disable()?;
        tracing::info!("Autostart disabled for {}", app_name);
    }

    Ok(())
}

/// Check if autostart is currently enabled
pub fn is_autostart_enabled(app_name: &str, app_path: &str) -> Result<bool> {
    #[cfg(target_os = "macos")]
    let auto = AutoLaunch::new(app_name, app_path, true, &[] as &[&str]);
    #[cfg(not(target_os = "macos"))]
    let auto = AutoLaunch::new(app_name, app_path, &[] as &[&str]);
    Ok(auto.is_enabled()?)
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_autostart(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut cfg = state.config.lock().await.clone();

    // Get current executable path
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_path_str = exe_path.to_string_lossy().to_string();

    configure_autostart("IORA Desktop", &exe_path_str, enabled)
        .map_err(|e| format!("Failed to configure autostart: {}", e))?;

    cfg.autostart_enabled = enabled;
    crate::config::save(&cfg).map_err(|e| e.to_string())?;
    *state.config.lock().await = cfg;

    Ok(())
}

#[tauri::command]
pub async fn get_autostart_status() -> Result<bool, String> {
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_path_str = exe_path.to_string_lossy().to_string();

    is_autostart_enabled("IORA Desktop", &exe_path_str)
        .map_err(|e| format!("Failed to check autostart status: {}", e))
}

#[tauri::command]
pub async fn set_autostart_options(
    state: State<'_, AppState>,
    minimized: bool,
    hidden: bool,
) -> Result<(), String> {
    let mut cfg = state.config.lock().await.clone();
    cfg.autostart_minimized = minimized;
    cfg.autostart_hidden = hidden;
    crate::config::save(&cfg).map_err(|e| e.to_string())?;
    *state.config.lock().await = cfg;
    Ok(())
}
