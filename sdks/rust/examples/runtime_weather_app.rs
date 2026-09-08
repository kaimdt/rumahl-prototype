//! Example app demonstrating the enhanced runtime features
//!
//! This example shows how to use the new rumahl SDK runtime manager:
//! - Automatic heartbeat
//! - Status reporting
//! - Centralized logging
//! - Dynamic permission requests
//! - Bidirectional communication with rumahl

use rumahl_sdk::prelude::*;
use std::time::Duration;
use tokio::time;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    env_logger::init();

    // Initialize runtime manager from environment variables
    // rumahl sets these when starting the app:
    // - RUMAHL_APP_ID
    // - RUMAHL_ENDPOINT
    // - RUMAHL_HEARTBEAT_INTERVAL
    let runtime = RuntimeManager::from_env().await?;

    // Start the runtime (begins heartbeat, message processing, etc.)
    runtime.start().await?;

    // Log that app started
    runtime
        .log(
            LogLevel::Info,
            "Weather app started successfully",
            Some(json!({"version": "1.0.0"})),
        )
        .await?;

    // Simulate app lifecycle
    run_weather_app(runtime).await?;

    Ok(())
}

async fn run_weather_app(runtime: RuntimeManager) -> Result<()> {
    // Register custom query handler
    runtime
        .register_query_handler("get_weather", |params| {
            Ok(json!({
                "temperature": 25.0,
                "condition": "Sunny",
                "humidity": 60
            }))
        })
        .await;

    loop {
        // Update status to processing
        runtime
            .set_status(AppStatus::Processing, Some("Fetching weather data".to_string()))
            .await?;

        // Request permission to access network
        match runtime
            .request_permission(
                Permission::NetworkOutbound,
                "Fetch weather data from api.weather.com",
                300, // 5 minutes
            )
            .await
        {
            Ok(token) => {
                runtime
                    .log(
                        LogLevel::Debug,
                        "Permission granted for network access",
                        Some(json!({"token_expires": token.expires_at})),
                    )
                    .await?;

                // Simulate fetching weather data
                time::sleep(Duration::from_secs(2)).await;

                runtime
                    .log(
                        LogLevel::Info,
                        "Weather data updated successfully",
                        Some(json!({"temperature": 25.0, "condition": "Sunny"})),
                    )
                    .await?;
            }
            Err(e) => {
                runtime
                    .log(
                        LogLevel::Error,
                        format!("Failed to get network permission: {}", e),
                        None,
                    )
                    .await?;
            }
        }

        // Update status to idle
        runtime
            .set_status(AppStatus::Idle, None)
            .await?;

        // Wait before next update
        time::sleep(Duration::from_secs(60)).await;
    }
}
