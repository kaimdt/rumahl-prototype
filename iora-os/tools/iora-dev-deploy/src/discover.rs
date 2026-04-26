use anyhow::{anyhow, bail, Context, Result};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const SERVICE: &str = "_iora-dev._tcp.local.";

#[derive(Debug, Clone, Serialize)]
pub struct Found {
    pub instance: String,
    pub host: String,
    pub port: u16,
    pub addrs: Vec<String>,
    pub txt: HashMap<String, String>,
}

impl Found {
    /// Best-effort `host:port` string usable with the rest of the CLI.
    pub fn endpoint(&self) -> String {
        let addr = self
            .addrs
            .first()
            .cloned()
            .unwrap_or_else(|| self.host.clone());
        format!("{addr}:{}", self.port)
    }
}

/// Browse the LAN for `_iora-dev._tcp.local.` and collect every device that
/// resolves before the timeout. Used by both the CLI subcommand and the
/// daemon HTTP endpoint.
pub async fn discover(timeout_secs: u64) -> Result<Vec<Found>> {
    let daemon = ServiceDaemon::new().context("starting mdns daemon")?;
    let receiver = daemon.browse(SERVICE).context("browsing")?;
    let deadline = Instant::now() + Duration::from_secs(timeout_secs.max(1));
    let mut found: HashMap<String, Found> = HashMap::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let recv = receiver.clone();
        match tokio::task::spawn_blocking(move || recv.recv_timeout(remaining))
            .await
            .map_err(|e| anyhow!("join: {e}"))?
        {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let txt: HashMap<String, String> = info
                    .get_properties()
                    .iter()
                    .map(|p| (p.key().to_string(), p.val_str().to_string()))
                    .collect();
                let addrs: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .map(|a| a.to_string())
                    .collect();
                let entry = Found {
                    instance: info.get_fullname().to_string(),
                    host: info.get_hostname().to_string(),
                    port: info.get_port(),
                    addrs,
                    txt,
                };
                found.insert(entry.instance.clone(), entry);
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.shutdown();
    Ok(found.into_values().collect())
}

pub async fn run(timeout_secs: u64) -> Result<()> {
    println!("Scanning for IORA OS Dev devices ({SERVICE}) for {timeout_secs}s …");
    let devices = discover(timeout_secs).await?;
    if devices.is_empty() {
        bail!("no IORA OS Dev devices found on the LAN");
    }
    println!();
    println!("{:<32} {:<16} {:<22} {}", "INSTANCE", "PORT", "ADDRESS", "BUILD");
    for f in &devices {
        let inst = f
            .instance
            .trim_end_matches(SERVICE)
            .trim_end_matches('.');
        let addr = f.addrs.first().cloned().unwrap_or_else(|| f.host.clone());
        let build = f.txt.get("build").cloned().unwrap_or_else(|| "?".into());
        println!("{:<32} {:<16} {:<22} {}", inst, f.port, addr, build);
    }
    println!();
    println!(
        "Connect with:  iora-dev-deploy connect <ADDRESS>:<PORT> --token <hex from /etc/iora/dev-token>"
    );
    Ok(())
}
