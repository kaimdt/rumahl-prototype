//! Runtime Integrity Monitoring System
//!
//! Detects and prevents tampering with running Apps and Plugins

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;
use anyhow::{Result, bail};

/// Integrity status of an app/plugin
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntegrityStatus {
    /// No issues detected
    Intact,
    /// Suspicious activity detected
    Suspicious(String),
    /// Confirmed compromise
    Compromised(String),
}

/// Types of integrity violations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrityViolation {
    /// Runtime code modification detected
    CodeInjection {
        app_id: String,
        details: String,
    },
    /// Loaded library doesn't match manifest
    LibraryTampering {
        app_id: String,
        library: String,
        expected_hash: String,
        actual_hash: String,
    },
    /// Suspicious memory access pattern
    MemoryManipulation {
        app_id: String,
        details: String,
    },
    /// File access outside granted permissions
    UnauthorizedFileAccess {
        app_id: String,
        file_path: String,
        attempted_operation: String,
    },
    /// Network connection not declared in manifest
    UnauthorizedNetwork {
        app_id: String,
        destination: String,
        port: u16,
    },
    /// Attempt to load external code
    ExternalCodeLoad {
        app_id: String,
        source: String,
    },
    /// Attempt to create/modify tokens
    TokenForgeryAttempt {
        app_id: String,
        details: String,
    },
}

/// Checksum information for integrity verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumInfo {
    pub file_path: String,
    pub algorithm: String,
    pub checksum: String,
    pub verified_at: i64,
}

/// Runtime monitoring data for an app/plugin
#[allow(dead_code)]
#[derive(Debug, Clone)]
struct MonitoringData {
    app_id: String,
    checksums: HashMap<String, String>,
    network_connections: Vec<NetworkConnection>,
    file_accesses: Vec<FileAccess>,
    loaded_modules: Vec<String>,
    last_check: i64,
    /// Hosts the manifest explicitly allows. Wildcards `*.example.com` are
    /// supported. An empty list means "no external network access permitted".
    allowed_hosts: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct NetworkConnection {
    destination: String,
    port: u16,
    timestamp: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct FileAccess {
    path: String,
    operation: String,
    timestamp: i64,
}

/// Integrity monitoring system
pub struct IntegrityMonitor {
    /// Monitored apps/plugins
    monitored: RwLock<HashMap<String, MonitoringData>>,
    /// Violation history
    violations: RwLock<HashMap<String, Vec<IntegrityViolation>>>,
    /// Developer mode status
    developer_mode: RwLock<bool>,
    /// Whitelisted external sources (only in developer mode)
    external_code_whitelist: RwLock<HashMap<String, Vec<String>>>,
}

impl IntegrityMonitor {
    pub fn new() -> Self {
        Self {
            monitored: RwLock::new(HashMap::new()),
            violations: RwLock::new(HashMap::new()),
            developer_mode: RwLock::new(false),
            external_code_whitelist: RwLock::new(HashMap::new()),
        }
    }

    /// Register an app/plugin for monitoring
    pub async fn register_app(&self, app_id: String, checksums: HashMap<String, String>) -> Result<()> {
        let mut monitored = self.monitored.write().await;

        let data = MonitoringData {
            app_id: app_id.clone(),
            checksums,
            network_connections: Vec::new(),
            file_accesses: Vec::new(),
            loaded_modules: Vec::new(),
            last_check: chrono::Utc::now().timestamp(),
            allowed_hosts: Vec::new(),
        };

        monitored.insert(app_id, data);
        Ok(())
    }

    /// Configure the manifest-declared allowed network hosts for an app.
    /// Should be called immediately after `register_app` if the manifest
    /// declares external endpoints.
    pub async fn set_allowed_hosts(&self, app_id: &str, hosts: Vec<String>) -> Result<()> {
        let mut monitored = self.monitored.write().await;
        if let Some(data) = monitored.get_mut(app_id) {
            data.allowed_hosts = hosts;
        }
        Ok(())
    }

    /// Unregister an app/plugin
    pub async fn unregister_app(&self, app_id: &str) -> Result<()> {
        let mut monitored = self.monitored.write().await;
        monitored.remove(app_id);
        Ok(())
    }

    /// Check integrity of an app/plugin
    pub async fn check_integrity(&self, app_id: &str) -> Result<IntegrityStatus> {
        let monitored = self.monitored.read().await;

        let _data = monitored.get(app_id)
            .ok_or_else(|| anyhow::anyhow!("App '{}' not registered for monitoring", app_id))?;

        // Check for violations
        let violations = self.violations.read().await;
        if let Some(app_violations) = violations.get(app_id) {
            if !app_violations.is_empty() {
                // Check if any are critical
                for violation in app_violations {
                    if self.is_critical_violation(violation) {
                        return Ok(IntegrityStatus::Compromised(format!("{:?}", violation)));
                    }
                }
                // Non-critical violations
                return Ok(IntegrityStatus::Suspicious(format!("{} violations detected", app_violations.len())));
            }
        }

        Ok(IntegrityStatus::Intact)
    }

    /// Record a network connection
    pub async fn record_network_connection(&self, app_id: &str, destination: &str, port: u16) -> Result<()> {
        let mut monitored = self.monitored.write().await;

        let mut violation_to_record: Option<IntegrityViolation> = None;
        if let Some(data) = monitored.get_mut(app_id) {
            data.network_connections.push(NetworkConnection {
                destination: destination.to_string(),
                port,
                timestamp: chrono::Utc::now().timestamp(),
            });

            // Validate the connection against the manifest-declared hosts.
            // Internal/loopback addresses are always permitted.
            let host = extract_host(destination);
            let is_internal = is_internal_host(&host);

            if !is_internal {
                let allowed = data
                    .allowed_hosts
                    .iter()
                    .any(|pattern| host_matches(pattern, &host));
                if !allowed {
                    tracing::warn!(
                        app = %app_id,
                        host = %host,
                        port = port,
                        "Blocked network connection: host not declared in manifest"
                    );
                    violation_to_record = Some(IntegrityViolation::UnauthorizedNetwork {
                        app_id: app_id.to_string(),
                        destination: destination.to_string(),
                        port,
                    });
                }
            }
        }

        // Persist the violation outside the monitored lock to avoid deadlocks
        // when the violations writer is held in the same critical section
        // elsewhere.
        drop(monitored);
        if let Some(v) = violation_to_record {
            let mut violations = self.violations.write().await;
            violations
                .entry(app_id.to_string())
                .or_insert_with(Vec::new)
                .push(v);
        }

        Ok(())
    }

    /// Record a file access
    pub async fn record_file_access(&self, app_id: &str, file_path: &str, operation: &str) -> Result<()> {
        let mut monitored = self.monitored.write().await;

        if let Some(data) = monitored.get_mut(app_id) {
            data.file_accesses.push(FileAccess {
                path: file_path.to_string(),
                operation: operation.to_string(),
                timestamp: chrono::Utc::now().timestamp(),
            });
        }

        Ok(())
    }

    /// Check if external code loading is allowed
    pub async fn check_external_code_load(&self, app_id: &str, source: &str) -> Result<()> {
        let developer_mode = *self.developer_mode.read().await;

        // Block external code by default
        if source.starts_with("http://") || source.starts_with("https://") {
            if !developer_mode {
                // Record violation
                self.record_violation(IntegrityViolation::ExternalCodeLoad {
                    app_id: app_id.to_string(),
                    source: source.to_string(),
                }).await;

                bail!("External code loading is blocked. Enable Developer Mode in IORA Control Center to allow.");
            }

            // Developer mode is enabled - check whitelist
            let whitelist = self.external_code_whitelist.read().await;
            if let Some(allowed_sources) = whitelist.get(app_id) {
                let is_whitelisted = allowed_sources.iter().any(|pattern| {
                    // Simple pattern matching - in production use proper glob/regex
                    if pattern.ends_with("/*") {
                        let prefix = &pattern[..pattern.len() - 2];
                        source.starts_with(prefix)
                    } else {
                        source == pattern
                    }
                });

                if !is_whitelisted {
                    self.record_violation(IntegrityViolation::ExternalCodeLoad {
                        app_id: app_id.to_string(),
                        source: source.to_string(),
                    }).await;

                    bail!("External source '{}' not whitelisted for app '{}'", source, app_id);
                }
            } else {
                // No whitelist defined for this app
                self.record_violation(IntegrityViolation::ExternalCodeLoad {
                    app_id: app_id.to_string(),
                    source: source.to_string(),
                }).await;

                bail!("App '{}' not configured for external code loading", app_id);
            }
        }

        Ok(())
    }

    /// Enable/disable developer mode
    pub async fn set_developer_mode(&self, enabled: bool) -> Result<()> {
        let mut mode = self.developer_mode.write().await;
        *mode = enabled;

        if enabled {
            tracing::warn!("Developer Mode ENABLED - External code loading is now allowed for configured apps");
        } else {
            tracing::info!("Developer Mode DISABLED - External code loading is blocked");
        }

        Ok(())
    }

    /// Add external code source to whitelist
    pub async fn add_external_source(&self, app_id: String, source: String) -> Result<()> {
        let mut whitelist = self.external_code_whitelist.write().await;
        let sources = whitelist.entry(app_id).or_insert_with(Vec::new);

        if !sources.contains(&source) {
            sources.push(source);
        }

        Ok(())
    }

    /// Record an integrity violation
    async fn record_violation(&self, violation: IntegrityViolation) {
        let app_id = match &violation {
            IntegrityViolation::CodeInjection { app_id, .. } => app_id,
            IntegrityViolation::LibraryTampering { app_id, .. } => app_id,
            IntegrityViolation::MemoryManipulation { app_id, .. } => app_id,
            IntegrityViolation::UnauthorizedFileAccess { app_id, .. } => app_id,
            IntegrityViolation::UnauthorizedNetwork { app_id, .. } => app_id,
            IntegrityViolation::ExternalCodeLoad { app_id, .. } => app_id,
            IntegrityViolation::TokenForgeryAttempt { app_id, .. } => app_id,
        }.clone();

        let mut violations = self.violations.write().await;
        let app_violations = violations.entry(app_id.clone()).or_insert_with(Vec::new);
        app_violations.push(violation.clone());

        // Log the violation
        tracing::error!("Integrity violation for app '{}': {:?}", app_id, violation);
    }

    /// Get violations for an app
    pub async fn get_violations(&self, app_id: &str) -> Vec<IntegrityViolation> {
        let violations = self.violations.read().await;
        violations.get(app_id).cloned().unwrap_or_default()
    }

    /// Clear violations for an app (after remediation)
    pub async fn clear_violations(&self, app_id: &str) -> Result<()> {
        let mut violations = self.violations.write().await;
        violations.remove(app_id);
        Ok(())
    }

    /// Check if a violation is critical
    fn is_critical_violation(&self, violation: &IntegrityViolation) -> bool {
        matches!(violation,
            IntegrityViolation::CodeInjection { .. } |
            IntegrityViolation::LibraryTampering { .. } |
            IntegrityViolation::TokenForgeryAttempt { .. }
        )
    }

    /// Get current developer mode status
    pub async fn is_developer_mode_enabled(&self) -> bool {
        *self.developer_mode.read().await
    }
}

impl Default for IntegrityMonitor {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract the host portion of a destination string. Accepts URLs
/// (`https://example.com:8080/foo`), `host:port` pairs and bare hosts.
fn extract_host(destination: &str) -> String {
    let s = destination
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("ws://")
        .trim_start_matches("wss://");
    let s = s.split('/').next().unwrap_or(s);
    let s = s.split('?').next().unwrap_or(s);
    // Strip port if present (but preserve IPv6 brackets).
    if let Some(stripped) = s.strip_prefix('[') {
        if let Some(end) = stripped.find(']') {
            return stripped[..end].to_string();
        }
    }
    if let Some(idx) = s.rfind(':') {
        // If it parses as a port, treat the part before `:` as the host.
        if s[idx + 1..].chars().all(|c| c.is_ascii_digit()) {
            return s[..idx].to_string();
        }
    }
    s.to_string()
}

fn is_internal_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("172.16.")
        || host.starts_with("172.17.")
        || host.starts_with("172.18.")
        || host.starts_with("172.19.")
        || host.starts_with("172.20.")
        || host.starts_with("172.21.")
        || host.starts_with("172.22.")
        || host.starts_with("172.23.")
        || host.starts_with("172.24.")
        || host.starts_with("172.25.")
        || host.starts_with("172.26.")
        || host.starts_with("172.27.")
        || host.starts_with("172.28.")
        || host.starts_with("172.29.")
        || host.starts_with("172.30.")
        || host.starts_with("172.31.")
        || host.ends_with(".local")
        || host.ends_with(".internal")
}

/// Match a host against a manifest pattern. Supports a leading `*.` wildcard
/// (`*.example.com` matches any subdomain) and exact matches.
fn host_matches(pattern: &str, host: &str) -> bool {
    let pattern = pattern.trim().to_ascii_lowercase();
    let host = host.trim().to_ascii_lowercase();
    if pattern == host { return true; }
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return host == suffix || host.ends_with(&format!(".{}", suffix));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_external_code_blocked_by_default() {
        let monitor = IntegrityMonitor::new();

        monitor.register_app("test.app".to_string(), HashMap::new()).await.unwrap();

        let result = monitor.check_external_code_load("test.app", "https://evil.com/code.js").await;
        assert!(result.is_err());

        let violations = monitor.get_violations("test.app").await;
        assert_eq!(violations.len(), 1);
    }

    #[tokio::test]
    async fn test_external_code_allowed_with_developer_mode() {
        let monitor = IntegrityMonitor::new();

        monitor.register_app("test.app".to_string(), HashMap::new()).await.unwrap();
        monitor.set_developer_mode(true).await.unwrap();
        monitor.add_external_source("test.app".to_string(), "https://cdn.example.com/*".to_string()).await.unwrap();

        let result = monitor.check_external_code_load("test.app", "https://cdn.example.com/code.js").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_integrity_status() {
        let monitor = IntegrityMonitor::new();

        monitor.register_app("test.app".to_string(), HashMap::new()).await.unwrap();

        let status = monitor.check_integrity("test.app").await.unwrap();
        assert_eq!(status, IntegrityStatus::Intact);

        // Add a violation
        monitor.record_violation(IntegrityViolation::ExternalCodeLoad {
            app_id: "test.app".to_string(),
            source: "https://evil.com/code.js".to_string(),
        }).await;

        let status = monitor.check_integrity("test.app").await.unwrap();
        assert!(matches!(status, IntegrityStatus::Suspicious(_)));
    }
}
