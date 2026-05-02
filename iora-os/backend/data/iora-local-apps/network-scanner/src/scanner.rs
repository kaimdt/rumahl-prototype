use anyhow::{anyhow, Result};
use ipnetwork::IpNetwork;
use pnet::datalink;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use std::process::Command;
use std::time::Duration;
use tokio::time::timeout;
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedDevice {
    pub ip: IpAddr,
    pub mac: Option<String>,
    pub hostname: Option<String>,
    pub manufacturer: Option<String>,
    pub open_ports: Vec<u16>,
}

pub struct NetworkScanner {
    network: IpNetwork,
    timeout: Duration,
}

impl NetworkScanner {
    pub fn new(network_cidr: &str, timeout_secs: u64) -> Result<Self> {
        let network: IpNetwork = network_cidr.parse()
            .map_err(|e| anyhow!("Invalid CIDR notation: {}", e))?;

        Ok(Self {
            network,
            timeout: Duration::from_secs(timeout_secs),
        })
    }

    /// Scan the network for devices
    pub async fn scan(&self) -> Result<Vec<ScannedDevice>> {
        let mut devices = Vec::new();

        debug!("Scanning network: {}", self.network);

        // Get all IPs in the network
        for ip in self.network.iter() {
            if let IpAddr::V4(ipv4) = ip {
                if let Some(device) = self.scan_host(ipv4).await {
                    devices.push(device);
                }
            }
        }

        debug!("Scan complete: found {} devices", devices.len());
        Ok(devices)
    }

    /// Scan a single host
    async fn scan_host(&self, ip: Ipv4Addr) -> Option<ScannedDevice> {
        // Try to ping the host
        if !self.ping_host(ip).await {
            return None;
        }

        debug!("Host {} is alive", ip);

        // Get MAC address
        let mac = self.get_mac_address(ip).await;

        // Get hostname
        let hostname = self.get_hostname(ip).await;

        // Scan common ports
        let open_ports = self.scan_ports(ip, &[80, 443, 22, 21, 25, 3389, 8080, 8443]).await;

        Some(ScannedDevice {
            ip: IpAddr::V4(ip),
            mac,
            hostname,
            manufacturer: None, // Could be looked up via MAC OUI database
            open_ports,
        })
    }

    /// Ping a host to check if it's alive
    async fn ping_host(&self, ip: Ipv4Addr) -> bool {
        let result = timeout(
            self.timeout,
            tokio::task::spawn_blocking(move || {
                Command::new("ping")
                    .arg("-c")
                    .arg("1")
                    .arg("-W")
                    .arg("1")
                    .arg(ip.to_string())
                    .output()
                    .ok()
                    .map(|output| output.status.success())
                    .unwrap_or(false)
            }),
        )
        .await;

        match result {
            Ok(Ok(success)) => success,
            _ => false,
        }
    }

    /// Get MAC address for an IP
    async fn get_mac_address(&self, ip: Ipv4Addr) -> Option<String> {
        // Try to get MAC from ARP table
        let output = Command::new("arp")
            .arg("-n")
            .arg(ip.to_string())
            .output()
            .ok()?;

        let output_str = String::from_utf8(output.stdout).ok()?;

        // Parse ARP output to extract MAC address
        for line in output_str.lines() {
            if line.contains(&ip.to_string()) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(mac) = parts.get(2) {
                    if mac.contains(':') {
                        return Some(mac.to_string());
                    }
                }
            }
        }

        None
    }

    /// Get hostname for an IP
    async fn get_hostname(&self, ip: Ipv4Addr) -> Option<String> {
        let result = timeout(
            self.timeout,
            tokio::task::spawn_blocking(move || {
                Command::new("nslookup")
                    .arg(ip.to_string())
                    .output()
                    .ok()
                    .and_then(|output| String::from_utf8(output.stdout).ok())
            }),
        )
        .await;

        match result {
            Ok(Ok(Some(output))) => {
                // Parse nslookup output
                for line in output.lines() {
                    if line.contains("name =") {
                        if let Some(name) = line.split("name =").nth(1) {
                            return Some(name.trim().trim_end_matches('.').to_string());
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }

    /// Scan specific ports on a host
    async fn scan_ports(&self, ip: Ipv4Addr, ports: &[u16]) -> Vec<u16> {
        let mut open_ports = Vec::new();

        for &port in ports {
            if self.check_port(ip, port).await {
                open_ports.push(port);
            }
        }

        open_ports
    }

    /// Check if a specific port is open
    async fn check_port(&self, ip: Ipv4Addr, port: u16) -> bool {
        let addr = format!("{}:{}", ip, port);

        timeout(
            Duration::from_secs(1),
            tokio::net::TcpStream::connect(&addr),
        )
        .await
        .is_ok()
    }
}
