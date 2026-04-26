use anyhow::{anyhow, bail, Context, Result};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::collections::HashMap;
use std::time::{Duration, Instant};

const SERVICE: &str = "_iora-dev._tcp.local.";

#[derive(Debug)]
pub struct Found {
    pub instance: String,
    pub host: String,
    pub port: u16,
    pub addrs: Vec<String>,
    pub txt: HashMap<String, String>,
}

pub async fn run(timeout_secs: u64) -> Result<()> {
    let daemon = ServiceDaemon::new().context("starting mdns daemon")?;
    let receiver = daemon.browse(SERVICE).context("browsing")?;
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let mut found: HashMap<String, Found> = HashMap::new();

    println!(
        "Scanning for IORA OS Dev devices ({SERVICE}) for {timeout_secs}s …"
    );

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::task::spawn_blocking({
            let receiver = receiver.clone();
            move || receiver.recv_timeout(remaining)
        })
        .await
        .map_err(|e| anyhow!("join: {e}"))?
        {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let txt: HashMap<String, String> = info
                    .get_properties()
                    .iter()
                    .map(|p| (p.key().to_string(), p.val_str().to_string()))
                    .collect();
                let addrs: Vec<String> = info.get_addresses().iter().map(|a| a.to_string()).collect();
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
            Err(_) => break, // timeout / channel closed
        }
    }
    let _ = daemon.shutdown();

    if found.is_empty() {
        bail!("no IORA OS Dev devices found on the LAN");
    }
    println!();
    println!("{:<32} {:<16} {:<22} {}", "INSTANCE", "PORT", "ADDRESS", "BUILD");
    for (_, f) in &found {
        let inst = f.instance.trim_end_matches(SERVICE).trim_end_matches('.');
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
