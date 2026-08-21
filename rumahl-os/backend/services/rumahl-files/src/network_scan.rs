//! Network share discovery (Windows-style): scan the local subnet for hosts
//! with SMB port 445 open and list their shares via smbclient.

use serde::Serialize;
use std::process::Stdio;

#[derive(Serialize, Clone)]
pub struct ShareInfo {
    pub name: String,
    pub comment: String,
}

#[derive(Serialize)]
pub struct NetworkHost {
    pub ip: String,
    pub shares: Vec<ShareInfo>,
}

/// Get the first non-loopback IPv4 address of this host.
pub async fn local_ipv4() -> Option<String> {
    let out = tokio::process::Command::new("hostname")
        .arg("-I")
        .output()
        .await
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .split_whitespace()
        .find(|ip| ip.contains('.') && !ip.starts_with("127."))
        .map(|ip| ip.to_string())
}

/// Scan the /24 subnet for open SMB ports, then query shares of each host.
pub async fn scan_network_shares() -> Vec<NetworkHost> {
    let Some(base) = local_ipv4().await else {
        return Vec::new();
    };
    let Some((prefix, _last)) = base.rsplit_once('.') else {
        return Vec::new();
    };

    // 1) Parallel TCP probe of port 445 (skip .1 gateway + own IP).
    let mut tasks = Vec::new();
    for i in 2..=254u16 {
        if format!("{prefix}.{i}") == base {
            continue;
        }
        let ip = format!("{prefix}.{i}");
        tasks.push(tokio::spawn(async move {
            let open = tokio::time::timeout(
                std::time::Duration::from_millis(350),
                tokio::net::TcpStream::connect((ip.as_str(), 445)),
            )
            .await
            .map(|r| r.is_ok())
            .unwrap_or(false);
            if open {
                Some(ip)
            } else {
                None
            }
        }));
    }
    let mut hosts = Vec::new();
    for task in tasks {
        if let Ok(Some(ip)) = task.await {
            hosts.push(ip);
        }
    }

    // 2) List shares of every reachable host (bounded concurrency).
    let mut results = Vec::new();
    for ip in hosts {
        let shares = list_shares(&ip).await;
        if !shares.is_empty() {
            results.push(NetworkHost { ip, shares });
        }
    }
    results
}

async fn list_shares(ip: &str) -> Vec<ShareInfo> {
    let output = tokio::process::Command::new("smbclient")
        .args(["-L", &format!("//{ip}"), "-N", "--timeout=2"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut shares = Vec::new();
    let mut in_table = false;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Sharename") || trimmed.starts_with("--------") {
            in_table = true;
            continue;
        }
        if in_table && !trimmed.is_empty() {
            let mut parts = trimmed.splitn(2, char::is_whitespace);
            let name = parts.next().unwrap_or("").to_string();
            let comment = parts.next().unwrap_or("").trim().to_string();
            if !name.is_empty() && !name.starts_with("$") && name != "IPC$" && name != "ADMIN$" {
                shares.push(ShareInfo { name, comment });
            }
        }
    }
    shares
}
