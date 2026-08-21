// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod autostart;
mod commands;
mod config;
mod ha_commands;
mod ha_integration;
mod rumahl_notifications;
mod lm_studio;
mod network_commands;
mod network_detection;
mod ora_ai;
mod system_commands;
mod system_info;
mod window_controls;

use commands::AppState;
use ha_integration::{HaClient, HaConfig};
use lm_studio::LmStudioClient;
use std::sync::atomic::Ordering;
use system_info::collect_metrics;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_liquid_glass::LiquidGlassExt;
use tokio::time::{interval, Duration};

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rumahl_desktop=info".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+shift+space"])
                .unwrap()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed
                        && shortcut.matches(
                            tauri_plugin_global_shortcut::Modifiers::CONTROL
                                | tauri_plugin_global_shortcut::Modifiers::SHIFT,
                            tauri_plugin_global_shortcut::Code::Space,
                        )
                    {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<AppState>();
                            let _ = ora_ai::ora_toggle_overlay(app_handle.clone(), state).await;
                        });
                    }
                })
                .build(),
        )
        .manage(AppState::new())
        .setup(|app| {
            // ── Platform-specific window setup ───────────────────────────────
            // macOS: keep native decorations (traffic lights, titlebar)
            // Windows/Linux: hide decorations for custom titlebar
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("settings") {
                let _ = window.set_decorations(false);
            }

            // ── macOS Liquid Glass effect (native NSGlassEffectView) ─────────
            #[cfg(target_os = "macos")]
            {
                let lg = app.liquid_glass();
                if lg.is_supported() {
                    if let Some(window) = app.get_webview_window("settings") {
                        use tauri_plugin_liquid_glass::LiquidGlassConfig;
                        if let Err(e) = lg.set_effect(&window, LiquidGlassConfig::default()) {
                            tracing::warn!("Failed to apply Liquid Glass effect: {}", e);
                        } else {
                            tracing::info!("Liquid Glass effect applied to window");
                        }
                    }
                }
            }

            // ── Tray menu ────────────────────────────────────────────────────
            let show_item =
                MenuItem::with_id(app, "show", "Einstellungen öffnen", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("rumahl-tray")
                .menu(&menu)
                .tooltip("rumahl Desktop – prüfe Verbindung…")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("settings") {
                            // Restore saved window position on first show
                            let state = app.state::<AppState>();
                            let cfg = state.config.blocking_lock().clone();
                            if let (Some(x), Some(y)) = (cfg.window_x, cfg.window_y) {
                                let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                            }
                            if let (Some(w), Some(h)) = (cfg.window_width, cfg.window_height) {
                                let _ = window.set_size(tauri::LogicalSize::new(w, h));
                            }
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
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
                        TrayIconEvent::Click {
                            button: MouseButton::Right,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            // Right-click shows menu (handled automatically by Tauri)
                        }
                        _ => {}
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
                    if let Some(tray) = app_handle.tray_by_id("rumahl-tray") {
                        let tooltip = if online {
                            format!("rumahl Desktop [{}] – LM Studio verbunden", client_name)
                        } else {
                            format!(
                                "rumahl Desktop [{}] – LM Studio offline ({})",
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

            // ── Home Assistant metrics reporter ───────────────────────────────
            // Periodically sends system metrics to Home Assistant
            let app_handle_ha = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(5)).await;

                loop {
                    let (ha_url, ha_token, device_name, update_interval, enabled) = {
                        let state = app_handle_ha.state::<AppState>();
                        let cfg = state.config.lock().await.clone();
                        (
                            cfg.rumahl_home_url.clone(), // Use rumahl-home URL, not HA URL
                            cfg.ha_token.clone(),
                            cfg.client_name.clone(),
                            cfg.ha_update_interval_secs,
                            cfg.ha_enabled,
                        )
                    };

                    if enabled && !ha_token.is_empty() {
                        let ha_config = HaConfig {
                            url: ha_url,
                            token: ha_token,
                            device_name,
                            update_interval_secs: update_interval,
                            enabled: true,
                        };

                        if let Ok(metrics) = collect_metrics() {
                            let client = HaClient::new(ha_config);
                            if let Err(e) = client.send_metrics(&metrics).await {
                                tracing::warn!("Failed to send metrics to HA: {}", e);
                            } else {
                                tracing::debug!("Successfully sent metrics to Home Assistant");
                            }
                        }
                    }

                    let mut ticker = interval(Duration::from_secs(update_interval.max(30)));
                    ticker.tick().await;
                    ticker.tick().await;
                }
            });

            // ── rumahl Desktop Notification Listener ───────────────────────────
            // Connect to rumahl-home WebSocket and listen for desktop_notification events.
            let app_handle_notif = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Small startup delay so config is ready
                tokio::time::sleep(Duration::from_secs(3)).await;

                let (rumahl_home_url, auth_token, client_name) = {
                    let state = app_handle_notif.state::<AppState>();
                    let cfg = state.config.lock().await.clone();
                    (
                        cfg.rumahl_home_url.clone(),
                        cfg.auth_token.clone(),
                        cfg.client_name.clone(),
                    )
                };
                if !rumahl_home_url.is_empty() {
                    // start_notification_listener runs its own reconnect loop indefinitely
                    rumahl_notifications::start_notification_listener(
                        app_handle_notif,
                        rumahl_home_url,
                        auth_token,
                        client_name,
                    );
                }
            });

            // ── Network profile auto-switch monitor ────────────────
            let app_handle_network = app.handle().clone();
            network_commands::start_network_monitor(app_handle_network);

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
            commands::get_platform,
            commands::get_config,
            commands::save_config,
            commands::apply_window_settings,
            commands::test_connection,
            commands::list_models,
            commands::send_chat,
            commands::get_status,
            commands::get_client_info,
            auth::login,
            auth::logout,
            auth::get_current_user,
            ha_commands::test_ha_connection,
            ha_commands::get_system_metrics,
            ha_commands::send_metrics_to_ha,
            ha_commands::get_ha_entities,
            ha_commands::call_ha_service,
            ha_commands::execute_command,
            autostart::set_autostart,
            autostart::get_autostart_status,
            autostart::set_autostart_options,
            // rumahl AI commands
            ora_ai::ora_send_chat,
            ora_ai::ora_search_internet,
            ora_ai::ora_show_overlay,
            ora_ai::ora_hide_overlay,
            ora_ai::ora_toggle_overlay,
            ora_ai::ora_capture_screenshot,
            ora_ai::ora_highlight_screen,
            ora_ai::ora_execute_desktop_action,
            network_commands::get_network_status,
            network_commands::detect_current_network,
            network_commands::list_network_interfaces_cmd,
            network_commands::get_network_profiles,
            network_commands::save_network_profiles,
            network_commands::set_network_auto_switch,
            network_commands::switch_to_profile,
            window_controls::tile_window,
            window_controls::apply_window_shadow,
            window_controls::start_window_drag,
            window_controls::show_tile_menu,
            window_controls::save_window_state,
            window_controls::trigger_native_window_menu,
            window_controls::trigger_windows_snap,
        ])
        .run(tauri::generate_context!())
        .expect("error while running rumahl Desktop");
}
