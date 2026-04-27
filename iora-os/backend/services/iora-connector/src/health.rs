//! Health check loop for exposed services in IORA Connector.

use crate::AppState;
use std::sync::Arc;
use tracing::warn;

/// Periodically check health of all active exposed services.
pub async fn health_check_loop(state: Arc<AppState>) {
    // Wait for startup
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;

    loop {
        check_all_services(&state).await;
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
    }
}

async fn check_all_services(state: &AppState) {
    let services: Vec<crate::ExposedService> = match sqlx::query_as(
        "SELECT * FROM exposed_services WHERE is_active = 1"
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to fetch services for health check: {}", e);
            return;
        }
    };

    for service in services {
        let tunnel: Option<crate::Tunnel> = sqlx::query_as(
            "SELECT * FROM tunnels WHERE id = ?"
        )
        .bind(&service.tunnel_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let tunnel = match tunnel {
            Some(t) => t,
            None => {
                update_service_health(state, &service.id, "unhealthy").await;
                continue;
            }
        };

        if tunnel.status != "connected" {
            update_service_health(state, &service.id, "unhealthy").await;
            continue;
        }

        // Attempt health check request
        let url = format!(
            "{}://{}:{}/health",
            service.local_protocol, tunnel.assigned_ip, service.local_port
        );

        let result = state
            .http_client
            .get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;

        let status = match result {
            Ok(resp) if resp.status().is_success() => "healthy",
            Ok(resp) if resp.status().is_server_error() => "unhealthy",
            Ok(_) => "degraded",
            Err(_) => "unhealthy",
        };

        update_service_health(state, &service.id, status).await;
    }
}

async fn update_service_health(state: &AppState, service_id: &str, status: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "UPDATE exposed_services SET health_status = ?, last_health_check = ?, updated_at = ? WHERE id = ?"
    )
    .bind(status)
    .bind(&now)
    .bind(&now)
    .bind(service_id)
    .execute(&state.db)
    .await;
}
