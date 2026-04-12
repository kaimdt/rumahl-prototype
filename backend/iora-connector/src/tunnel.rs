//! WireGuard tunnel management for IORA Connector.
//!
//! Handles WireGuard configuration generation, peer management,
//! and status polling via `wg show` command output parsing.

use crate::AppState;
use anyhow::Result;
use std::sync::Arc;
use tokio::process::Command;
use tracing::{info, warn};

/// Get or generate the server's WireGuard public key.
/// In production, keys are managed by the WireGuard interface.
/// Returns the public key as base64.
pub async fn get_or_generate_server_keypair(state: &AppState) -> Result<String> {
    // Check if we have a stored server public key
    let stored: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM connector_config WHERE key = 'server_wg_public_key'"
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some((pubkey,)) = stored {
        if !pubkey.is_empty() {
            return Ok(pubkey);
        }
    }

    // Try to read from wg interface
    let output = Command::new("wg")
        .args(["show", "wg-iora", "public-key"])
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let pubkey = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !pubkey.is_empty() {
                // Store for future use
                sqlx::query(
                    "INSERT INTO connector_config (key, value, updated_at) VALUES ('server_wg_public_key', ?, datetime('now'))
                     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
                )
                .bind(&pubkey)
                .bind(&pubkey)
                .execute(&state.db)
                .await?;
                return Ok(pubkey);
            }
        }
        _ => {
            info!("WireGuard interface not available, generating placeholder keypair");
        }
    }

    // Generate a new keypair for configuration purposes
    let genkey_output = Command::new("wg").arg("genkey").output().await;

    match genkey_output {
        Ok(out) if out.status.success() => {
            let privkey = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let mut pubkey_cmd = Command::new("wg");
            pubkey_cmd.arg("pubkey");

            let pubkey_output = pubkey_cmd
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn();

            match pubkey_output {
                Ok(mut child) => {
                    use tokio::io::AsyncWriteExt;
                    if let Some(ref mut stdin) = child.stdin {
                        let _ = stdin.write_all(privkey.as_bytes()).await;
                        let _ = stdin.shutdown().await;
                    }
                    let output = child.wait_with_output().await?;
                    let pubkey = String::from_utf8_lossy(&output.stdout).trim().to_string();

                    // Store keys
                    sqlx::query(
                        "INSERT INTO connector_config (key, value, updated_at) VALUES ('server_wg_public_key', ?, datetime('now'))
                         ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
                    )
                    .bind(&pubkey)
                    .bind(&pubkey)
                    .execute(&state.db)
                    .await?;

                    sqlx::query(
                        "INSERT INTO connector_config (key, value, updated_at) VALUES ('server_wg_private_key', ?, datetime('now'))
                         ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
                    )
                    .bind(&privkey)
                    .bind(&privkey)
                    .execute(&state.db)
                    .await?;

                    return Ok(pubkey);
                }
                Err(e) => {
                    warn!("Failed to derive public key: {}", e);
                }
            }
        }
        _ => {
            warn!("wg command not available; returning placeholder key");
        }
    }

    // Fallback: return a placeholder (user must configure manually)
    Ok("<server-public-key-not-configured>".to_string())
}

/// Add a WireGuard peer to the running interface.
pub async fn add_wireguard_peer(state: &AppState, peer_pubkey: &str, allowed_ip: &str) -> Result<()> {
    let output = Command::new("wg")
        .args([
            "set", "wg-iora",
            "peer", peer_pubkey,
            "allowed-ips", &format!("{}/32", allowed_ip),
            "persistent-keepalive", "25",
        ])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("wg set failed: {}", stderr);
    }

    info!("Added WireGuard peer: {} -> {}", peer_pubkey, allowed_ip);

    // Save config persistently
    save_wireguard_config(state).await?;

    Ok(())
}

/// Remove a WireGuard peer from the running interface.
pub async fn remove_wireguard_peer(state: &AppState, peer_pubkey: &str) -> Result<()> {
    let output = Command::new("wg")
        .args(["set", "wg-iora", "peer", peer_pubkey, "remove"])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("wg peer remove failed: {}", stderr);
    }

    info!("Removed WireGuard peer: {}", peer_pubkey);
    save_wireguard_config(state).await?;

    Ok(())
}

/// Save the current WireGuard config to disk.
async fn save_wireguard_config(_state: &AppState) -> Result<()> {
    let output = Command::new("wg-quick")
        .args(["save", "wg-iora"])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("wg-quick save failed (may need manual save): {}", stderr);
    }

    Ok(())
}

/// Periodically poll WireGuard for peer status and update DB.
pub async fn wireguard_status_poller(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;

        match poll_wireguard_status(&state).await {
            Ok(statuses) => {
                let mut live = state.tunnel_status.write().await;
                for (pubkey, status) in statuses {
                    // Find tunnel by public key
                    if let Ok(Some(tunnel)) = sqlx::query_as::<_, crate::Tunnel>(
                        "SELECT * FROM tunnels WHERE peer_public_key = ?"
                    )
                    .bind(&pubkey)
                    .fetch_optional(&state.db)
                    .await
                    {
                        let was_connected = live.get(&tunnel.id).map(|s| s.connected).unwrap_or(false);
                        let is_connected = status.connected;

                        live.insert(tunnel.id.clone(), status.clone());

                        // Update DB status
                        let db_status = if is_connected { "connected" } else { "disconnected" };
                        let _ = sqlx::query(
                            "UPDATE tunnels SET status = ?, last_handshake = ?, bytes_sent = ?, bytes_received = ?, updated_at = datetime('now') WHERE id = ?"
                        )
                        .bind(db_status)
                        .bind(&status.last_handshake)
                        .bind(status.bytes_sent as i64)
                        .bind(status.bytes_received as i64)
                        .bind(&tunnel.id)
                        .execute(&state.db)
                        .await;

                        if !was_connected && is_connected {
                            info!("Tunnel connected: {} ({})", tunnel.name, tunnel.id);
                        } else if was_connected && !is_connected {
                            warn!("Tunnel disconnected: {} ({})", tunnel.name, tunnel.id);
                        }
                    }
                }
            }
            Err(e) => {
                // WireGuard not available, mark all as unknown
                if e.to_string().contains("not found") || e.to_string().contains("No such") {
                    // WireGuard not installed, skip silently
                } else {
                    warn!("WireGuard status poll failed: {}", e);
                }
            }
        }
    }
}

/// Parse output of `wg show wg-iora` to extract peer status.
async fn poll_wireguard_status(_state: &AppState) -> Result<Vec<(String, crate::TunnelLiveStatus)>> {
    let output = Command::new("wg")
        .args(["show", "wg-iora", "dump"])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!("wg show failed");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = vec![];

    // wg show dump format: public_key\tpreshared_key\tendpoint\tallowed_ips\tlatest_handshake\ttx\trx\tpersistent_keepalive
    for line in stdout.lines().skip(1) {
        // Skip header line
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() >= 7 {
            let pubkey = fields[0].to_string();
            let latest_handshake: u64 = fields[4].parse().unwrap_or(0);
            let tx: u64 = fields[5].parse().unwrap_or(0);
            let rx: u64 = fields[6].parse().unwrap_or(0);

            // Consider "connected" if handshake was within last 3 minutes
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let connected = latest_handshake > 0 && (now - latest_handshake) < 180;

            let handshake_str = if latest_handshake > 0 {
                Some(chrono::DateTime::from_timestamp(latest_handshake as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default())
            } else {
                None
            };

            results.push((pubkey, crate::TunnelLiveStatus {
                connected,
                last_handshake: handshake_str,
                bytes_sent: tx,
                bytes_received: rx,
                latency_ms: None,
            }));
        }
    }

    Ok(results)
}
