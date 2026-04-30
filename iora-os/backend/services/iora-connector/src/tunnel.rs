//! Cloud relay tunnel management — WebSocket-based (no WireGuard).
//!
//! This module is kept as a placeholder. The actual tunnel is managed
//! directly in main.rs via the WebSocket handler and active_tunnels map.
//! No WireGuard configuration, no VPN, no kernel modules needed.

use crate::AppState;
use std::sync::Arc;

/// Stub — no WireGuard keypair needed.
pub async fn get_or_generate_server_keypair(_state: &AppState) -> anyhow::Result<String> {
    Ok("cloud-relay-no-wireguard".to_string())
}

/// Stub — no WireGuard peers to manage.
pub async fn add_wireguard_peer(_state: &AppState, _peer_pubkey: &str, _allowed_ip: &str) -> anyhow::Result<()> {
    tracing::debug!("WireGuard peer add skipped (cloud relay mode)");
    Ok(())
}

/// Stub — no WireGuard peers to remove.
pub async fn remove_wireguard_peer(_state: &AppState, _peer_pubkey: &str) -> anyhow::Result<()> {
    tracing::debug!("WireGuard peer remove skipped (cloud relay mode)");
    Ok(())
}

/// Stub — no WireGuard status to poll.
pub async fn wireguard_status_poller(_state: Arc<AppState>) {
    tracing::info!("WireGuard status poller disabled (cloud relay mode — using WebSocket)");
    // Sleep forever — this task is spawned but does nothing
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    }
}
