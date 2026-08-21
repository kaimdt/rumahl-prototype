//! Network detection & profile switching for rumahl Desktop.
//!
//! Detects the current network type (Ethernet, WiFi, Mobile, VPN, Unknown)
//! and the local IP so the app can auto-select the correct rumahl Home URL
//! for each network environment.
//!
//! Cross-platform: works on Windows, Linux, and macOS.

use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use sysinfo::Networks;

// ─── Network type detection ──────────────────────────────────────────────

/// Represents the kind of network the machine is currently connected to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum NetworkType {
    /// Wired Ethernet connection (LAN)
    Ethernet,
    /// Wireless LAN (WiFi)
    WiFi,
    /// Cellular / Mobile broadband (LTE, 5G, etc.)
    Mobile,
    /// VPN tunnel interface
    Vpn,
    /// Unknown or other interface type
    Unknown,
}

impl NetworkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            NetworkType::Ethernet => "ethernet",
            NetworkType::WiFi => "wifi",
            NetworkType::Mobile => "mobile",
            NetworkType::Vpn => "vpn",
            NetworkType::Unknown => "unknown",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            NetworkType::Ethernet => "LAN (Ethernet)",
            NetworkType::WiFi => "WLAN (WiFi)",
            NetworkType::Mobile => "Mobilfunk",
            NetworkType::Vpn => "VPN",
            NetworkType::Unknown => "Unbekannt",
        }
    }
}

/// Information about a detected network interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInfo {
    /// Interface name (e.g. "en0", "eth0", "Wi-Fi")
    pub interface_name: String,
    /// Detected network type
    pub network_type: NetworkType,
    /// Local IPv4 address on this interface (if available)
    pub local_ip: Option<String>,
    /// Whether this interface is currently the default/active route
    pub is_active: bool,
}

// ─── Interface name classification ──────────────────────────────────────

/// Classify a network interface name by looking at OS-specific naming patterns.
fn classify_interface(name: &str) -> NetworkType {
    let lower = name.to_lowercase();

    // Windows patterns
    if lower.contains("ethernet") || lower.contains("local area connection") {
        return NetworkType::Ethernet;
    }
    if lower.contains("wi-fi") || lower.contains("wlan") || lower.contains("wireless") {
        return NetworkType::WiFi;
    }
    if lower.contains("cellular") || lower.contains("mobile") || lower.contains("wwan") {
        return NetworkType::Mobile;
    }
    if lower.contains("vpn") || lower.contains("tunnel") || lower.contains("tailscale")
        || lower.contains("wireguard") || lower.contains("openvpn") || lower.contains("zerotier")
    {
        return NetworkType::Vpn;
    }

    // Linux patterns
    if lower.starts_with("eth") || lower.starts_with("enp") || lower.starts_with("ens") {
        return NetworkType::Ethernet;
    }
    if lower.starts_with("wlan") || lower.starts_with("wlp") || lower.starts_with("wlx") {
        return NetworkType::WiFi;
    }
    if lower.starts_with("wwan") || lower.starts_with("wwp") {
        return NetworkType::Mobile;
    }
    if lower.starts_with("tun") || lower.starts_with("tap") || lower.starts_with("wg") {
        return NetworkType::Vpn;
    }

    // macOS patterns
    if lower.starts_with("en") && !lower.contains("bridge") {
        return classify_macos_interface(name);
    }
    if lower.starts_with("bridge") || lower.starts_with("awdl") {
        return NetworkType::Unknown;
    }
    if lower.starts_with("utun") || lower.starts_with("llw") {
        return NetworkType::Vpn;
    }

    // Docker / virtual
    if lower.starts_with("docker") || lower.starts_with("veth") || lower.starts_with("br-") {
        return NetworkType::Unknown;
    }

    // Loopback
    if lower == "lo" || lower.starts_with("lo0") {
        return NetworkType::Unknown;
    }

    NetworkType::Unknown
}

/// On macOS, "en" interfaces can be either Ethernet or WiFi.
/// Use `networksetup` to get the mapping.
#[cfg(target_os = "macos")]
fn classify_macos_interface(name: &str) -> NetworkType {
    if let Ok(output) = std::process::Command::new("networksetup")
        .args(["-listallhardwareports"])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        let mut current_port: Option<&str> = None;
        for line in text.lines() {
            if line.starts_with("Hardware Port:") {
                current_port = Some(line.trim_start_matches("Hardware Port:").trim());
            } else if line.starts_with("Device:") {
                let device = line.trim_start_matches("Device:").trim();
                if device == name {
                    return match current_port {
                        Some(p) if p.to_lowercase().contains("wi-fi") => NetworkType::WiFi,
                        Some(p) if p.to_lowercase().contains("ethernet") => NetworkType::Ethernet,
                        Some(p) if p.to_lowercase().contains("bluetooth") => NetworkType::Unknown,
                        Some(p) if p.to_lowercase().contains("thunderbolt") => NetworkType::Ethernet,
                        Some(p) if p.to_lowercase().contains("usb") => NetworkType::Ethernet,
                        _ => NetworkType::Ethernet,
                    };
                }
            }
        }
    }

    // Fallback heuristic: en0-en2 likely WiFi, higher indices likely Ethernet adapters
    if let Some(num_str) = name.strip_prefix("en") {
        if let Ok(num) = num_str.parse::<u32>() {
            return if num <= 2 { NetworkType::WiFi } else { NetworkType::Ethernet };
        }
    }

    NetworkType::Unknown
}

#[cfg(not(target_os = "macos"))]
fn classify_macos_interface(_name: &str) -> NetworkType {
    NetworkType::Unknown
}

// ─── Active network detection ───────────────────────────────────────────

/// Detect the currently active network type and local IP.
///
/// Uses `local-ip-address` to find the local IP, then cross-references with
/// sysinfo interface names to classify the network type.
pub fn detect_active_network() -> NetworkInfo {
    // Get the local IP that would be used to reach the internet
    let local_ip = local_ip_address::local_ip().ok().map(|ip| ip.to_string());

    // Get all network interfaces to find the matching one
    let networks = Networks::new_with_refreshed_list();

    let mut candidates: Vec<NetworkInfo> = Vec::new();

    for (iface_name, _iface_data) in networks.iter() {
        // Skip loopback
        if iface_name == "lo" || iface_name.starts_with("lo") {
            continue;
        }

        let network_type = classify_interface(iface_name);

        candidates.push(NetworkInfo {
            interface_name: iface_name.clone(),
            network_type,
            local_ip: local_ip.clone(),
            is_active: false,
        });
    }

    if candidates.is_empty() {
        return NetworkInfo {
            interface_name: "unknown".to_string(),
            network_type: NetworkType::Unknown,
            local_ip,
            is_active: true,
        };
    }

    // Priority order: Ethernet > WiFi > Mobile > VPN > Unknown
    let priority = |nt: NetworkType| -> u8 {
        match nt {
            NetworkType::Ethernet => 0,
            NetworkType::WiFi => 1,
            NetworkType::Mobile => 2,
            NetworkType::Vpn => 3,
            NetworkType::Unknown => 4,
        }
    };

    candidates.sort_by_key(|c| priority(c.network_type));

    // The highest-priority non-unknown interface is the active one
    if let Some(first) = candidates.first_mut() {
        first.is_active = true;
    }

    candidates.remove(0)
}

/// Get all detected network interfaces with their types.
pub fn list_network_interfaces() -> Vec<NetworkInfo> {
    let networks = Networks::new_with_refreshed_list();
    let local_ip = local_ip_address::local_ip().ok().map(|ip| ip.to_string());

    let mut interfaces: Vec<NetworkInfo> = Vec::new();

    for (iface_name, _iface_data) in networks.iter() {
        if iface_name == "lo" || iface_name.starts_with("lo") {
            continue;
        }

        let network_type = classify_interface(iface_name);

        interfaces.push(NetworkInfo {
            interface_name: iface_name.clone(),
            network_type,
            local_ip: local_ip.clone(),
            is_active: false,
        });
    }

    // Mark the highest-priority interface as active
    if !interfaces.is_empty() {
        let priority = |nt: NetworkType| -> u8 {
            match nt {
                NetworkType::Ethernet => 0,
                NetworkType::WiFi => 1,
                NetworkType::Mobile => 2,
                NetworkType::Vpn => 3,
                NetworkType::Unknown => 4,
            }
        };
        interfaces.sort_by_key(|i| priority(i.network_type));
        if let Some(first) = interfaces.first_mut() {
            first.is_active = true;
        }
    }

    interfaces
}

// ─── Network Fingerprint ────────────────────────────────────────────────

/// Get a simplified fingerprint of the current network: network type + local IP prefix.
/// This uniquely identifies a network without storing the full IP.
pub fn network_fingerprint() -> Option<String> {
    let info = detect_active_network();
    if let Some(ip_str) = &info.local_ip {
        if let Ok(ip) = ip_str.parse::<Ipv4Addr>() {
            let octets = ip.octets();
            return Some(format!(
                "{}-{}.{}.{}",
                info.network_type.as_str(),
                octets[0],
                octets[1],
                octets[2]
            ));
        }
    }
    None
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_linux_ethernet() {
        assert_eq!(classify_interface("eth0"), NetworkType::Ethernet);
        assert_eq!(classify_interface("enp3s0"), NetworkType::Ethernet);
    }

    #[test]
    fn test_classify_linux_wifi() {
        assert_eq!(classify_interface("wlan0"), NetworkType::WiFi);
        assert_eq!(classify_interface("wlp2s0"), NetworkType::WiFi);
    }

    #[test]
    fn test_classify_windows() {
        assert_eq!(classify_interface("Ethernet"), NetworkType::Ethernet);
        assert_eq!(classify_interface("Wi-Fi"), NetworkType::WiFi);
        assert_eq!(classify_interface("Cellular"), NetworkType::Mobile);
    }

    #[test]
    fn test_classify_vpn() {
        assert_eq!(classify_interface("tun0"), NetworkType::Vpn);
        assert_eq!(classify_interface("tailscale0"), NetworkType::Vpn);
        assert_eq!(classify_interface("wg0"), NetworkType::Vpn);
    }

    #[test]
    fn test_classify_unknown() {
        assert_eq!(classify_interface("lo"), NetworkType::Unknown);
        assert_eq!(classify_interface("docker0"), NetworkType::Unknown);
    }

    #[test]
    fn test_detect_active_network() {
        let info = detect_active_network();
        println!("Active network: {:?}", info);
        assert!(!info.interface_name.is_empty());
    }

    #[test]
    fn test_list_interfaces() {
        let interfaces = list_network_interfaces();
        println!("Found {} interfaces:", interfaces.len());
        for iface in &interfaces {
            println!(
                "  {} ({:?}) -> {:?}",
                iface.interface_name, iface.network_type, iface.local_ip
            );
        }
    }
}
