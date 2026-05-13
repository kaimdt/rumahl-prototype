//! Window control commands for IORA Desktop.
//!
//! Provides:
//!   - Window tiling (left/right/top/bottom half, maximize, center)
//!   - Shadow & rounded corners via `set_shadow`
//!   - Cross-platform tile menu via context menu API
//!   - Window dragging support

use serde::{Deserialize, Serialize};
use tauri::{menu::MenuBuilder, menu::MenuItemBuilder, AppHandle, Manager, State};

use crate::commands::AppState;
use crate::config;

// ─── Tile direction ────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TileDirection {
    Left,
    Right,
    Top,
    Bottom,
    Maximize,
    Center,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl TileDirection {
    pub fn label(&self) -> &'static str {
        match self {
            TileDirection::Left => "⬅ Linke Hälfte",
            TileDirection::Right => "Rechte Hälfte ➡",
            TileDirection::Top => "⬆ Obere Hälfte",
            TileDirection::Bottom => "⬇ Untere Hälfte",
            TileDirection::Maximize => "⬜ Maximieren",
            TileDirection::Center => "⊙ Zentrieren",
            TileDirection::TopLeft => "↖ Oben links",
            TileDirection::TopRight => "↗ Oben rechts",
            TileDirection::BottomLeft => "↙ Unten links",
            TileDirection::BottomRight => "↘ Unten rechts",
        }
    }
}

// ─── Tauri commands ────────────────────────────────────────────────────

/// Tile the window to a specific screen region.
#[tauri::command]
pub async fn tile_window(app: AppHandle, direction: TileDirection) -> Result<(), String> {
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| "Fenster nicht gefunden".to_string())?;

    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Kein Monitor gefunden".to_string())?;

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let scale = monitor.scale_factor();

    let mw = monitor_size.width as f64 / scale;
    let mh = monitor_size.height as f64 / scale;
    let mx = monitor_pos.x as f64 / scale;
    let my = monitor_pos.y as f64 / scale;

    match direction {
        TileDirection::Maximize => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|e| e.to_string())?;
            } else {
                window.maximize().map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        TileDirection::Center => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|e| e.to_string())?;
            }
            let current = window.inner_size().map_err(|e| e.to_string())?;
            let cw = current.width as f64 / scale;
            let ch = current.height as f64 / scale;
            let cx = mx + (mw - cw) / 2.0;
            let cy = my + (mh - ch) / 2.0;
            window
                .set_position(tauri::LogicalPosition::new(cx, cy))
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        _ => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|e| e.to_string())?;
            }
        }
    }

    let (x, y, w, h) = match direction {
        TileDirection::Left => (mx, my, mw / 2.0, mh),
        TileDirection::Right => (mx + mw / 2.0, my, mw / 2.0, mh),
        TileDirection::Top => (mx, my, mw, mh / 2.0),
        TileDirection::Bottom => (mx, my + mh / 2.0, mw, mh / 2.0),
        TileDirection::TopLeft => (mx, my, mw / 2.0, mh / 2.0),
        TileDirection::TopRight => (mx + mw / 2.0, my, mw / 2.0, mh / 2.0),
        TileDirection::BottomLeft => (mx, my + mh / 2.0, mw / 2.0, mh / 2.0),
        TileDirection::BottomRight => (mx + mw / 2.0, my + mh / 2.0, mw / 2.0, mh / 2.0),
        _ => return Ok(()),
    };

    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;

    tracing::info!("Window tiled to {:?}", direction);
    Ok(())
}

/// Enable window shadow (also enables rounded corners on Windows 11).
#[tauri::command]
pub async fn apply_window_shadow(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.set_shadow(true).map_err(|e| e.to_string())?;
        tracing::info!("Window shadow enabled");
    }
    Ok(())
}

/// Start window dragging (call on mousedown in the titlebar).
#[tauri::command]
pub async fn start_window_drag(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show the window snap/tile context menu at a given position.
/// On Windows 11, this appears as a popup; on macOS, it mimics the
/// green button's tile menu.
#[tauri::command]
pub async fn show_tile_menu(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| "Fenster nicht gefunden".to_string())?;

    let directions = vec![
        TileDirection::Left,
        TileDirection::Right,
        TileDirection::Top,
        TileDirection::Bottom,
        TileDirection::TopLeft,
        TileDirection::TopRight,
        TileDirection::BottomLeft,
        TileDirection::BottomRight,
        TileDirection::Maximize,
        TileDirection::Center,
    ];

    // Build a native context menu
    let mut menu_builder = MenuBuilder::new(&app);
    for dir in &directions {
        let item = MenuItemBuilder::with_id(dir.label(), dir.label())
            .build(&app)
            .map_err(|e| e.to_string())?;
        menu_builder = menu_builder.item(&item);
    }
    let menu = menu_builder.build().map_err(|e| e.to_string())?;

    // Store a reference to the app handle for the callback
    let app_clone = app.clone();

    window.on_menu_event(move |_win, event| {
        let id = event.id().0.as_str();
        for dir in &directions {
            if dir.label() == id {
                let app = app_clone.clone();
                let d = *dir;
                tauri::async_runtime::spawn(async move {
                    let _ = tile_window(app, d).await;
                });
                break;
            }
        }
    });

    // Show as popup at the given position
    window
        .popup_menu_at(&menu, tauri::PhysicalPosition::new(x as i32, y as i32))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Save window position and size to config (debounced, called by frontend).
#[tauri::command]
pub async fn save_window_state(
    app: AppHandle,
    state: State<'_, AppState>,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    let mut cfg = state.config.lock().await.clone();

    // Only save if window is not maximized or minimized
    if let Some(window) = app.get_webview_window("settings") {
        if window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
            return Ok(());
        }
    }

    cfg.window_x = x;
    cfg.window_y = y;
    cfg.window_width = width;
    cfg.window_height = height;
    config::save(&cfg).map_err(|e| e.to_string())?;
    *state.config.lock().await = cfg;
    Ok(())
}

// ─── Windows 11 native snap layout trigger ────────────────────────────

/// Trigger the Windows 11 snap layout by simulating a click
/// on the maximize button at window-relative position (x, y).
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn trigger_windows_snap(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, HTMAXBUTTON, WM_NCLBUTTONDOWN};

    if let Some(window) = app.get_webview_window("settings") {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;

        let px = (x * scale) as i32;
        let py = (y * scale) as i32;

        unsafe {
            let lparam = LPARAM(((py as u32) << 16) | (px as u32 & 0xFFFF));
            let _ = PostMessageW(hwnd, WM_NCLBUTTONDOWN, WPARAM(HTMAXBUTTON as usize), lparam);
        }
        tracing::info!("Windows snap triggered at ({}, {})", px, py);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn trigger_windows_snap(_app: AppHandle, _x: f64, _y: f64) -> Result<(), String> {
    Ok(())
}

// ─── macOS native window constraints menu ──────────────────────────────

/// Trigger the native macOS window tiling/constraints popover.
/// This shows the system window management menu that appears
/// when hovering the green traffic light button on macOS 15+ (Sequoia).
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn trigger_native_window_menu(app: AppHandle) -> Result<(), String> {
    use objc::{class, msg_send, sel, sel_impl};

    if let Some(window) = app.get_webview_window("settings") {
        let ns_window = window.ns_window().map_err(|e| e.to_string())?;

        unsafe {
            // Try the macOS 15+ window management API first
            // [NSWindow performWindowAction:] with action type 0 (show menu)
            let ns_window: *mut objc::runtime::Object = ns_window as *mut _;

            // Check if the window responds to performWindowAction:
            let responds: bool = msg_send![ns_window, respondsToSelector: sel!(performWindowAction:)];
            if responds {
                // Call performWindowAction: with action = 0 (show constraints menu)
                // The action parameter 0 corresponds to showing the window menu
                let _: () = msg_send![ns_window, performWindowAction: 0usize];
                tracing::info!("Native macOS window menu triggered");
            } else {
                // Fallback for older macOS: toggle zoom
                let _: () = msg_send![ns_window, performZoom: std::ptr::null::<objc::runtime::Object>()];
                tracing::info!("Fallback: performZoom triggered");
            }
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn trigger_native_window_menu(_app: AppHandle) -> Result<(), String> {
    Ok(())
}
