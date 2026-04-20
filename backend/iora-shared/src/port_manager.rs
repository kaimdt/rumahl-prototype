//! Port Manager - Dynamic port allocation for IORA apps
//!
//! This module provides dynamic port allocation to ensure apps don't conflict.
//! Ports are assigned from a reserved pool and tracked in the database.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Port allocation range for user apps
pub const APP_PORT_RANGE_START: u16 = 3000;
pub const APP_PORT_RANGE_END: u16 = 4000;

/// Reserved system ports that apps cannot use
const RESERVED_PORTS: &[u16] = &[
    8080, // iora-home
    8090, // iora-core
    8091, // iora-control
    8092, // iora-assist
    8093, // iora-secrets
    8094, // iora-watchdog
    8095, // iora-security
    8096, // iora-gateway
    8097, // iora-supervisor
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortAssignment {
    pub app_id: String,
    pub internal_port: u16,
    pub external_port: u16,
    pub protocol: PortProtocol,
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
        Self {
            allocated: Arc::new(RwLock::new(RESERVED_PORTS.iter().copied().collect())),
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
    ) -> Result<PortAssignment, PortAllocationError> {
        let mut allocated = self.allocated.write().await;
        let mut assignments = self.assignments.write().await;

        // Check if app already has this port assigned
        if let Some(existing) = assignments
            .iter()
            .find(|a| a.app_id == app_id && a.internal_port == internal_port && a.protocol == protocol)
        {
            return Ok(existing.clone());
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
        !allocated.contains(&port) && port >= APP_PORT_RANGE_START && port <= APP_PORT_RANGE_END
    }

    /// Get port allocation statistics
    pub async fn get_stats(&self) -> PortStats {
        let allocated = self.allocated.read().await;
        let total_ports = (APP_PORT_RANGE_END - APP_PORT_RANGE_START + 1) as usize;
        let reserved_count = RESERVED_PORTS.len();
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
            .allocate_port("test-app", 8080, PortProtocol::Tcp)
            .await
            .unwrap();

        assert_eq!(assignment.app_id, "test-app");
        assert_eq!(assignment.internal_port, 8080);
        assert!(assignment.external_port >= APP_PORT_RANGE_START);
        assert!(assignment.external_port <= APP_PORT_RANGE_END);
    }

    #[tokio::test]
    async fn test_port_release() {
        let manager = PortManager::new();

        manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp)
            .await
            .unwrap();

        let ports_before = manager.get_app_ports("test-app").await;
        assert_eq!(ports_before.len(), 1);

        manager.release_ports("test-app").await.unwrap();

        let ports_after = manager.get_app_ports("test-app").await;
        assert_eq!(ports_after.len(), 0);
    }

    #[tokio::test]
    async fn test_port_reuse_same_app() {
        let manager = PortManager::new();

        let first = manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp)
            .await
            .unwrap();

        let second = manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp)
            .await
            .unwrap();

        assert_eq!(first.external_port, second.external_port);
    }

    #[tokio::test]
    async fn test_stats() {
        let manager = PortManager::new();

        let stats_before = manager.get_stats().await;
        assert_eq!(stats_before.allocated, 0);

        manager
            .allocate_port("test-app", 8080, PortProtocol::Tcp)
            .await
            .unwrap();

        let stats_after = manager.get_stats().await;
        assert_eq!(stats_after.allocated, 1);
        assert_eq!(stats_after.free, stats_before.free - 1);
    }
}
