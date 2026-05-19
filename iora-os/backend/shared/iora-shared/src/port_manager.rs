//! Port Manager - Dynamic port allocation for IORA apps
//!
//! This module provides dynamic port allocation to ensure apps don't conflict.
//! Ports are assigned from a reserved pool and tracked in the database.
//!
//! Port Allocation Strategy:
//! - Apps/Plugins: 10000-20000 (higher range as requested)
//! - IORA Services: 8080-8099
//! - Well-known ports: Auto-reserved (80, 443, 22, etc.)
//!
//! Port Assignment Modes:
//! - Random: New port assigned on each restart (default)
//! - Fixed: Persistent port assignment (opt-in via manifest)

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Port allocation range for user apps and plugins (higher range as requested)
pub const APP_PORT_RANGE_START: u16 = 10000;
pub const APP_PORT_RANGE_END: u16 = 20000;

/// IORA system services port range
pub const IORA_SERVICES_RANGE_START: u16 = 8080;
pub const IORA_SERVICES_RANGE_END: u16 = 8099;

/// Well-known ports that should be automatically reserved
/// These are standard ports for common services
const WELL_KNOWN_PORTS: &[u16] = &[
    20, 21,   // FTP
    22,       // SSH
    23,       // Telnet
    25,       // SMTP
    53,       // DNS
    67, 68,   // DHCP
    80,       // HTTP
    110,      // POP3
    123,      // NTP
    143,      // IMAP
    161, 162, // SNMP
    389,      // LDAP
    443,      // HTTPS
    445,      // SMB
    465,      // SMTPS
    514,      // Syslog
    587,      // SMTP (submission)
    636,      // LDAPS
    993,      // IMAPS
    995,      // POP3S
    1433,     // MSSQL
    1521,     // Oracle
    3306,     // MySQL
    5432,     // PostgreSQL
    5672,     // AMQP
    6379,     // Redis
    8080,     // HTTP Alt
    8443,     // HTTPS Alt
    9000,     // SonarQube
    27017,    // MongoDB
];

/// IORA reserved ports for system services
const IORA_RESERVED_PORTS: &[u16] = &[
    80,   // iora-nginx (HTTP)
    443,  // iora-nginx (HTTPS)
    8080, // iora-home
    8090, // iora-core
    8091, // iora-control
    8092, // iora-assist
    8093, // iora-secrets
    8094, // iora-watchdog
    8095, // iora-security
    8096, // iora-gateway
    8097, // iora-supervisor
    8098, // iora-appstore
    8099, // Reserved for future IORA services
];

/// Port assignment mode
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum PortAssignmentMode {
    /// Random port assigned on each restart (default)
    #[default]
    Random,
    /// Fixed port, persists across restarts
    Fixed,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortAssignment {
    pub app_id: String,
    pub internal_port: u16,
    pub external_port: u16,
    pub protocol: PortProtocol,
    pub assignment_mode: PortAssignmentMode,
    pub assigned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PortProtocol {
    Tcp,
    Udp,
}

impl std::fmt::Display for PortProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PortProtocol::Tcp => write!(f, "tcp"),
            PortProtocol::Udp => write!(f, "udp"),
        }
    }
}

/// Port Manager handles dynamic port allocation
pub struct PortManager {
    /// Currently allocated ports (external ports)
    allocated: Arc<RwLock<HashSet<u16>>>,
    /// Port assignments by app_id
    assignments: Arc<RwLock<Vec<PortAssignment>>>,
}

impl PortManager {
    pub fn new() -> Self {
        // Combine all reserved ports
        let mut reserved = HashSet::new();
        reserved.extend(WELL_KNOWN_PORTS.iter().copied());
        reserved.extend(IORA_RESERVED_PORTS.iter().copied());

        Self {
            allocated: Arc::new(RwLock::new(reserved)),
            assignments: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Initialize from existing assignments (e.g., from database)
    pub async fn init_from_assignments(&self, existing: Vec<PortAssignment>) {
        let mut allocated = self.allocated.write().await;
        let mut assignments = self.assignments.write().await;

        for assignment in &existing {
            allocated.insert(assignment.external_port);
        }

        *assignments = existing;
    }

    /// Allocate a new port for an app
    pub async fn allocate_port(
        &self,
        app_id: &str,
        internal_port: u16,
        protocol: PortProtocol,
        mode: PortAssignmentMode,
    ) -> Result<PortAssignment, PortAllocationError> {
        let mut allocated = self.allocated.write().await;
        let mut assignments = self.assignments.write().await;

        // Check if app already has this port assigned (for fixed mode)
        if mode == PortAssignmentMode::Fixed {
            if let Some(existing) = assignments
                .iter()
                .find(|a| a.app_id == app_id && a.internal_port == internal_port && a.protocol == protocol)
            {
                return Ok(existing.clone());
            }
        }

        // For random mode, always allocate a new port (remove old assignment if exists)
        if mode == PortAssignmentMode::Random {
            if let Some(pos) = assignments
                .iter()
                .position(|a| a.app_id == app_id && a.internal_port == internal_port && a.protocol == protocol)
            {
                let old = assignments.remove(pos);
                allocated.remove(&old.external_port);
            }
        }

        // Find next available port
        let external_port = (APP_PORT_RANGE_START..=APP_PORT_RANGE_END)
            .find(|port| !allocated.contains(port))
            .ok_or(PortAllocationError::NoPortsAvailable)?;

        // Mark as allocated
        allocated.insert(external_port);

        // Create assignment
        let assignment = PortAssignment {
            app_id: app_id.to_string(),
            internal_port,
            external_port,
            protocol,
            assignment_mode: mode,
            assigned_at: chrono::Utc::now().to_rfc3339(),
        };

        assignments.push(assignment.clone());

        Ok(assignment)
    }

    /// Release all ports for an app
    pub async fn release_ports(&self, app_id: &str) -> Result<(), PortAllocationError> {
        let mut allocated = self.allocated.write().await;
        let mut assignments = self.assignments.write().await;

        // Find all assignments for this app
        let app_assignments: Vec<_> = assignments
            .iter()
            .filter(|a| a.app_id == app_id)
            .cloned()
            .collect();

        // Release the ports
        for assignment in app_assignments {
            allocated.remove(&assignment.external_port);
        }

        // Remove assignments
        assignments.retain(|a| a.app_id != app_id);

        Ok(())
    }

    /// Get all port assignments for an app
    pub async fn get_app_ports(&self, app_id: &str) -> Vec<PortAssignment> {
        let assignments = self.assignments.read().await;
        assignments
            .iter()
            .filter(|a| a.app_id == app_id)
            .cloned()
            .collect()
    }

    /// Get all current assignments
    pub async fn get_all_assignments(&self) -> Vec<PortAssignment> {
        let assignments = self.assignments.read().await;
        assignments.clone()
    }

    /// Check if a specific port is available
    pub async fn is_port_available(&self, port: u16) -> bool {
        let allocated = self.allocated.read().await;
        !allocated.contains(&port) && (APP_PORT_RANGE_START..=APP_PORT_RANGE_END).contains(&port)
    }

    /// Get port allocation statistics
    pub async fn get_stats(&self) -> PortStats {
        let allocated = self.allocated.read().await;
        let total_ports = (APP_PORT_RANGE_END - APP_PORT_RANGE_START + 1) as usize;

        // Count all reserved ports (well-known + IORA)
        let mut reserved_set = HashSet::new();
        reserved_set.extend(WELL_KNOWN_PORTS.iter().copied());
        reserved_set.extend(IORA_RESERVED_PORTS.iter().copied());
        let reserved_count = reserved_set.len();

        let allocated_count = allocated.len() - reserved_count;

        PortStats {
            total_available: total_ports,
            allocated: allocated_count,
            free: total_ports - allocated_count,
            reserved: reserved_count,
        }
    }
}

impl Default for PortManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PortStats {
    pub total_available: usize,
    pub allocated: usize,
    pub free: usize,
    pub reserved: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum PortAllocationError {
    #[error("No ports available in the allocated range")]
    NoPortsAvailable,
    #[error("Port {0} is already allocated")]
    PortAlreadyAllocated(u16),
    #[error("Invalid port range")]
    InvalidPortRange,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_port_allocation() {
        let manager = PortManager::new();

        let assignment = manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp, PortAssignmentMode::Random)
            .await
            .unwrap();

        assert_eq!(assignment.app_id, "test-app");
        assert_eq!(assignment.internal_port, 8080);
        assert!(assignment.external_port >= APP_PORT_RANGE_START);
        assert!(assignment.external_port <= APP_PORT_RANGE_END);
    }

    #[tokio::test]
    async fn test_fixed_port_assignment() {
        let manager = PortManager::new();

        let first = manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp, PortAssignmentMode::Fixed)
            .await
            .unwrap();

        let second = manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp, PortAssignmentMode::Fixed)
            .await
            .unwrap();

        assert_eq!(first.external_port, second.external_port);
    }

    #[tokio::test]
    async fn test_random_port_assignment() {
        let manager = PortManager::new();

        let first = manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp, PortAssignmentMode::Random)
            .await
            .unwrap();

        let second = manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp, PortAssignmentMode::Random)
            .await
            .unwrap();

        // Random mode should allocate different ports
        assert_ne!(first.external_port, second.external_port);
    }

    #[tokio::test]
    async fn test_port_release() {
        let manager = PortManager::new();

        manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp, PortAssignmentMode::Random)
            .await
            .unwrap();

        let ports_before = manager.get_app_ports("test-app").await;
        assert_eq!(ports_before.len(), 1);

        manager.release_ports("test-app").await.unwrap();

        let ports_after = manager.get_app_ports("test-app").await;
        assert_eq!(ports_after.len(), 0);
    }

    #[tokio::test]
    async fn test_stats() {
        let manager = PortManager::new();

        let stats_before = manager.get_stats().await;
        assert_eq!(stats_before.allocated, 0);

        manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp, PortAssignmentMode::Random)
            .await
            .unwrap();

        let stats_after = manager.get_stats().await;
        assert_eq!(stats_after.allocated, 1);
        assert_eq!(stats_after.free, stats_before.free - 1);
    }

    #[tokio::test]
    async fn test_well_known_ports_reserved() {
        let manager = PortManager::new();

        // Port 80 should be reserved
        assert!(!manager.is_port_available(80).await);
        // Port 443 should be reserved
        assert!(!manager.is_port_available(443).await);
        // Ports in app range should be available
        assert!(manager.is_port_available(10000).await);
    }
}
