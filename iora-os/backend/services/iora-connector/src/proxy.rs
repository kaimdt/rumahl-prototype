//! Reverse proxy logic for IORA Connector.
//!
//! Handles routing external HTTP(S) traffic through the VPN tunnel
//! to the appropriate local IORA service.

// Proxy logic is implemented directly in main.rs::proxy_request
// This module provides helper utilities for the proxy layer.

use std::net::IpAddr;

/// Check if an IP address matches any of the allowed CIDR ranges.
#[allow(dead_code)]
pub fn ip_matches_allowlist(ip: &str, allowed_cidrs: &[String]) -> bool {
    if allowed_cidrs.is_empty() {
        return true; // empty allowlist = allow all
    }

    let parsed_ip: IpAddr = match ip.parse() {
        Ok(ip) => ip,
        Err(_) => return false,
    };

    for cidr in allowed_cidrs {
        if cidr.contains('/') {
            // CIDR notation
            if match_cidr(&parsed_ip, cidr) {
                return true;
            }
        } else {
            // Exact IP match
            if let Ok(allowed) = cidr.parse::<IpAddr>() {
                if parsed_ip == allowed {
                    return true;
                }
            }
        }
    }

    false
}

#[allow(dead_code)]
fn match_cidr(ip: &IpAddr, cidr: &str) -> bool {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return false;
    }

    let network: IpAddr = match parts[0].parse() {
        Ok(n) => n,
        Err(_) => return false,
    };

    let prefix_len: u32 = match parts[1].parse() {
        Ok(p) => p,
        Err(_) => return false,
    };

    match (ip, &network) {
        (IpAddr::V4(ip4), IpAddr::V4(net4)) => {
            if prefix_len > 32 {
                return false;
            }
            let mask = if prefix_len == 0 { 0u32 } else { !0u32 << (32 - prefix_len) };
            u32::from(*ip4) & mask == u32::from(*net4) & mask
        }
        (IpAddr::V6(ip6), IpAddr::V6(net6)) => {
            if prefix_len > 128 {
                return false;
            }
            let ip_bits = u128::from(*ip6);
            let net_bits = u128::from(*net6);
            let mask = if prefix_len == 0 { 0u128 } else { !0u128 << (128 - prefix_len) };
            ip_bits & mask == net_bits & mask
        }
        _ => false, // v4 vs v6 mismatch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cidr_matching() {
        assert!(ip_matches_allowlist("192.168.1.5", &["192.168.1.0/24".to_string()]));
        assert!(!ip_matches_allowlist("192.168.2.5", &["192.168.1.0/24".to_string()]));
        assert!(ip_matches_allowlist("10.0.0.1", &["10.0.0.1".to_string()]));
        assert!(!ip_matches_allowlist("10.0.0.2", &["10.0.0.1".to_string()]));
        assert!(ip_matches_allowlist("1.2.3.4", &[])); // empty = allow all
    }
}
