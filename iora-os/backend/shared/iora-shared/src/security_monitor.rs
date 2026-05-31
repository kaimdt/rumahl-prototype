//! Security Monitor for Apps, Plugins, and System
//!
//! Monitors resource usage, detects anomalies, and alerts on security events.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub provider_id: String,
    pub provider_type: ProviderType,
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub network_bytes_sent: u64,
    pub network_bytes_received: u64,
    pub disk_bytes_read: u64,
    pub disk_bytes_written: u64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    App,
    Plugin,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityEvent {
    pub id: String,
    pub provider_id: String,
    pub event_type: SecurityEventType,
    pub severity: Severity,
    pub description: String,
    pub details: serde_json::Value,
    pub timestamp: String,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecurityEventType {
    HighCpuUsage,
    HighMemoryUsage,
    ExcessiveNetworkActivity,
    UnauthorizedApiAccess,
    PermissionViolation,
    SuspiciousBehavior,
    CrashDetected,
    ResourceLimitExceeded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub max_cpu_percent: f32,
    pub max_memory_mb: u64,
    pub max_network_mbps: f32,
    pub max_disk_iops: u64,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_cpu_percent: 50.0,
            max_memory_mb: 512,
            max_network_mbps: 10.0,
            max_disk_iops: 1000,
        }
    }
}

/// Security Monitor tracks resource usage and security events
#[derive(Default)]
pub struct SecurityMonitor {
    resource_usage: RwLock<HashMap<String, Vec<ResourceUsage>>>,
    security_events: RwLock<HashMap<String, SecurityEvent>>,
    resource_limits: RwLock<HashMap<String, ResourceLimits>>,
}

impl SecurityMonitor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record resource usage
    pub async fn record_usage(&self, usage: ResourceUsage) {
        let mut map = self.resource_usage.write().await;
        map.entry(usage.provider_id.clone())
            .or_insert_with(Vec::new)
            .push(usage.clone());

        // Keep only last 1000 entries per provider
        if let Some(vec) = map.get_mut(&usage.provider_id) {
            if vec.len() > 1000 {
                vec.drain(0..vec.len() - 1000);
            }
        }

        // Check for anomalies
        drop(map);
        self.check_anomalies(&usage).await;
    }

    /// Check for resource usage anomalies
    async fn check_anomalies(&self, usage: &ResourceUsage) {
        let limits = self.resource_limits.read().await;
        let default_limits = ResourceLimits::default();
        let limit = limits.get(&usage.provider_id).unwrap_or(&default_limits);

        // Check CPU
        if usage.cpu_percent > limit.max_cpu_percent {
            self.create_event(
                usage.provider_id.clone(),
                SecurityEventType::HighCpuUsage,
                Severity::Medium,
                format!("CPU usage {}% exceeds limit {}%", usage.cpu_percent, limit.max_cpu_percent),
                serde_json::json!({ "cpu_percent": usage.cpu_percent, "limit": limit.max_cpu_percent }),
            ).await;
        }

        // Check memory
        if usage.memory_mb > limit.max_memory_mb {
            self.create_event(
                usage.provider_id.clone(),
                SecurityEventType::HighMemoryUsage,
                Severity::Medium,
                format!(
                    "Memory usage {} MB exceeds limit {} MB",
                    usage.memory_mb, limit.max_memory_mb
                ),
                serde_json::json!({ "memory_mb": usage.memory_mb, "limit": limit.max_memory_mb }),
            )
            .await;
        }
    }

    /// Create a security event
    pub async fn create_event(
        &self,
        provider_id: String,
        event_type: SecurityEventType,
        severity: Severity,
        description: String,
        details: serde_json::Value,
    ) {
        let event = SecurityEvent {
            id: format!("sec_{}", uuid::Uuid::new_v4()),
            provider_id,
            event_type,
            severity,
            description,
            details,
            timestamp: chrono::Utc::now().to_rfc3339(),
            resolved: false,
        };

        let mut events = self.security_events.write().await;
        events.insert(event.id.clone(), event);
    }

    /// Get resource usage history
    pub async fn get_usage_history(&self, provider_id: &str, limit: usize) -> Vec<ResourceUsage> {
        self.resource_usage
            .read()
            .await
            .get(provider_id)
            .map(|vec| vec.iter().rev().take(limit).cloned().collect())
            .unwrap_or_default()
    }

    /// Get security events
    pub async fn get_events(
        &self,
        provider_id: Option<&str>,
        severity: Option<Severity>,
    ) -> Vec<SecurityEvent> {
        let events = self.security_events.read().await;
        events
            .values()
            .filter(|e| {
                let provider_match = provider_id.is_none_or(|pid| e.provider_id == pid);
                let severity_match = severity.as_ref().is_none_or(|sev| &e.severity == sev);
                provider_match && severity_match
            })
            .cloned()
            .collect()
    }

    /// Resolve a security event
    pub async fn resolve_event(&self, event_id: &str) -> anyhow::Result<()> {
        let mut events = self.security_events.write().await;
        if let Some(event) = events.get_mut(event_id) {
            event.resolved = true;
            Ok(())
        } else {
            anyhow::bail!("Security event '{}' not found", event_id)
        }
    }

    /// Set resource limits for a provider
    pub async fn set_limits(&self, provider_id: String, limits: ResourceLimits) {
        let mut map = self.resource_limits.write().await;
        map.insert(provider_id, limits);
    }

    /// Get resource limits for a provider
    pub async fn get_limits(&self, provider_id: &str) -> ResourceLimits {
        self.resource_limits
            .read()
            .await
            .get(provider_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Get current resource usage for a provider
    pub async fn get_current_usage(&self, provider_id: &str) -> Option<ResourceUsage> {
        self.resource_usage
            .read()
            .await
            .get(provider_id)
            .and_then(|vec| vec.last().cloned())
    }

    /// Get aggregated statistics
    pub async fn get_statistics(&self, provider_id: &str) -> Option<UsageStatistics> {
        let usage = self.resource_usage.read().await;
        let provider_usage = usage.get(provider_id)?;

        if provider_usage.is_empty() {
            return None;
        }

        let total_entries = provider_usage.len() as f32;
        let avg_cpu = provider_usage.iter().map(|u| u.cpu_percent).sum::<f32>() / total_entries;
        let avg_memory =
            provider_usage.iter().map(|u| u.memory_mb).sum::<u64>() / total_entries as u64;
        let max_cpu = provider_usage
            .iter()
            .map(|u| u.cpu_percent)
            .fold(0.0, f32::max);
        let max_memory = provider_usage
            .iter()
            .map(|u| u.memory_mb)
            .max()
            .unwrap_or(0);

        Some(UsageStatistics {
            provider_id: provider_id.to_string(),
            average_cpu_percent: avg_cpu,
            average_memory_mb: avg_memory,
            max_cpu_percent: max_cpu,
            max_memory_mb: max_memory,
            sample_count: provider_usage.len(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStatistics {
    pub provider_id: String,
    pub average_cpu_percent: f32,
    pub average_memory_mb: u64,
    pub max_cpu_percent: f32,
    pub max_memory_mb: u64,
    pub sample_count: usize,
}
