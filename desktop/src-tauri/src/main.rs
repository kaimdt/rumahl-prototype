// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod lm_studio;

use commands::AppState;
use lm_studio::LmStudioClient;
use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tokio::time::{interval, Duration};

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "iora_desktop=info".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .setup(|app| {
            // ── Tray menu ────────────────────────────────────────────────────
            let show_item =
                MenuItem::with_id(app, "show", "Einstellungen öffnen", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("iora-tray")
                .menu(&menu)
                .tooltip("IORA Desktop – prüfe Verbindung…")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("settings") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("settings") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // ── Background health monitor ─────────────────────────────────────
            // Runs independently of whether the settings window is open.
            // Polls LM Studio periodically and updates:
            //   • the shared lm_online flag (used by send_chat to reject calls when offline)
            //   • the tray tooltip with human-readable status
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Give the app a moment to finish initialising before the first poll
                tokio::time::sleep(Duration::from_secs(2)).await;

                loop {
                    let (url, api_key, poll_secs, client_name) = {
                        let state = app_handle.state::<AppState>();
                        let cfg = state.config.lock().await.clone();
                        (
                            cfg.lm_studio_url.clone(),
                            cfg.lm_studio_api_key.clone(),
                            cfg.health_poll_interval_secs,
                            cfg.client_name.clone(),
                        )
                    };

                    let client = LmStudioClient::new(&url, &api_key);
                    let online = client.ping().await;

                    // Update shared flag
                    let state = app_handle.state::<AppState>();
                    let was_online = state.lm_online.swap(online, Ordering::Relaxed);

                    // Update tray tooltip on every poll (or on transition)
                    if let Some(tray) = app_handle.tray_by_id("iora-tray") {
                        let tooltip = if online {
                            format!("IORA Desktop [{}] – LM Studio verbunden", client_name)
                        } else {
                            format!(
                                "IORA Desktop [{}] – LM Studio offline ({})",
                                client_name, url
                            )
                        };
                        let _ = tray.set_tooltip(Some(&tooltip));
                    }

                    // Log transitions
                    if online && !was_online {
                        tracing::info!("LM Studio is back online at {}", url);
                    } else if !online && was_online {
                        tracing::warn!("LM Studio went offline at {}", url);
                    }

                    let mut ticker = interval(Duration::from_secs(poll_secs.max(5)));
                    ticker.tick().await; // immediate tick
                    ticker.tick().await; // wait one interval
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide to tray instead of quitting when the user closes the settings window
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "settings" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::test_connection,
            commands::list_models,
            commands::send_chat,
            commands::get_status,
            commands::get_client_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IORA Desktop");
}
