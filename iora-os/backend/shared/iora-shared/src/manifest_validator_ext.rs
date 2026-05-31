//! Extended Manifest Validation
//!
//! Additional validation rules for enhanced security and robustness:
//! - Resource limit validation
//! - Dependency conflict detection
//! - Security policy enforcement
//! - Version compatibility checks

use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::manifest_validator::ValidationResult;

/// Extended validation context
pub struct ValidationContext {
    /// Installed apps for dependency checking
    pub installed_apps: HashMap<String, String>, // app_id -> version

    /// System capabilities
    pub system_capabilities: SystemCapabilities,

    /// Security policy
    pub security_policy: SecurityPolicy,
}

/// System capabilities
#[derive(Debug, Clone)]
pub struct SystemCapabilities {
    pub max_memory_mb: u64,
    pub max_cpu_cores: u32,
    pub available_storage_gb: u64,
    pub supports_docker: bool,
    pub supports_bundles: bool,
    pub min_iora_version: String,
}

impl Default for SystemCapabilities {
    fn default() -> Self {
        Self {
            max_memory_mb: 4096,
            max_cpu_cores: 4,
            available_storage_gb: 100,
            supports_docker: true,
            supports_bundles: true,
            min_iora_version: "2.0.0".to_string(),
        }
    }
}

/// Security policy configuration
#[derive(Debug, Clone)]
pub struct SecurityPolicy {
    pub allow_untrusted_apps: bool,
    pub require_code_signing: bool,
    pub max_permissions_per_app: usize,
    pub blocked_permissions: HashSet<String>,
    pub require_network_whitelist: bool,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            allow_untrusted_apps: false,
            require_code_signing: false,
            max_permissions_per_app: 20,
            blocked_permissions: HashSet::new(),
            require_network_whitelist: false,
        }
    }
}

/// Validate resource limits in manifest
pub fn validate_resource_limits(
    manifest: &Value,
    capabilities: &SystemCapabilities,
    result: &mut ValidationResult,
) {
    // Check Docker resource limits
    if let Some(docker) = manifest.get("docker") {
        if let Some(resources) = docker.get("resources") {
            // Memory limit
            if let Some(mem_str) = resources.get("memory").and_then(|v| v.as_str()) {
                if let Some(mem_mb) = parse_memory_limit(mem_str) {
                    if mem_mb > capabilities.max_memory_mb {
                        result.add_error(
                            "docker.resources.memory",
                            &format!(
                                "Speicherlimit {}MB überschreitet System-Maximum von {}MB.",
                                mem_mb, capabilities.max_memory_mb
                            ),
                            Some(&format!("Reduziere das Limit auf maximal \"{}M\".", capabilities.max_memory_mb))
                        );
                    }
                } else {
                    result.add_warning(
                        "docker.resources.memory",
                        &format!("Ungültiges Speicherlimit-Format: \"{}\". Erwarte Format wie \"512M\" oder \"1G\".", mem_str),
                        Some("Verwende ein gültiges Format wie \"512M\" oder \"1G\".")
                    );
                }
            }

            // CPU limit
            if let Some(cpu_str) = resources.get("cpu").and_then(|v| v.as_str()) {
                if let Some(cpu_cores) = parse_cpu_limit(cpu_str) {
                    if cpu_cores > capabilities.max_cpu_cores as f64 {
                        result.add_error(
                            "docker.resources.cpu",
                            &format!(
                                "CPU-Limit {} überschreitet System-Maximum von {} Kernen.",
                                cpu_cores, capabilities.max_cpu_cores
                            ),
                            Some(&format!("Reduziere das Limit auf maximal \"{}\".", capabilities.max_cpu_cores))
                        );
                    }
                } else {
                    result.add_warning(
                        "docker.resources.cpu",
                        &format!("Ungültiges CPU-Limit-Format: \"{}\". Erwarte Format wie \"0.5\" oder \"2\".", cpu_str),
                        Some("Verwende eine Dezimalzahl wie \"0.5\" für einen halben Kern.")
                    );
                }
            }
        }
    }

    // Check bundle service resource limits
    if let Some(bundle) = manifest.get("bundle") {
        if let Some(services) = bundle.get("services").and_then(|v| v.as_array()) {
            for (i, service) in services.iter().enumerate() {
                if let Some(resources) = service.get("resources") {
                    let service_name = service.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");

                    if let Some(mem_str) = resources.get("memory").and_then(|v| v.as_str()) {
                        if let Some(mem_mb) = parse_memory_limit(mem_str) {
                            if mem_mb > capabilities.max_memory_mb {
                                result.add_error(
                                    &format!("bundle.services[{}].resources.memory", i),
                                    &format!(
                                        "Service \"{}\" Speicherlimit {}MB überschreitet Maximum.",
                                        service_name, mem_mb
                                    ),
                                    Some(&format!("Reduziere auf maximal \"{}M\".", capabilities.max_memory_mb))
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // Check storage configuration limits
    if let Some(storage) = manifest.get("storage") {
        if let Some(max_size) = storage.get("max_total_size_bytes").and_then(|v| v.as_u64()) {
            let max_size_gb = max_size / (1024 * 1024 * 1024);
            if max_size_gb > capabilities.available_storage_gb {
                result.add_error(
                    "storage.max_total_size_bytes",
                    &format!(
                        "Speicherlimit von {}GB überschreitet verfügbaren Speicher von {}GB.",
                        max_size_gb, capabilities.available_storage_gb
                    ),
                    Some(&format!("Reduziere auf maximal {} Bytes.", capabilities.available_storage_gb * 1024 * 1024 * 1024))
                );
            }
        }
    }
}

/// Validate dependencies and conflicts
pub fn validate_dependencies(
    manifest: &Value,
    context: &ValidationContext,
    result: &mut ValidationResult,
) {
    // Check IORA version requirement
    if let Some(min_version) = manifest
        .get("store_metadata")
        .and_then(|m| m.get("min_iora_version"))
        .and_then(|v| v.as_str())
    {
        if !is_version_compatible(min_version, &context.system_capabilities.min_iora_version) {
            result.add_error(
                "store_metadata.min_iora_version",
                &format!(
                    "App benötigt IORA Version {} aber System hat Version {}.",
                    min_version, context.system_capabilities.min_iora_version
                ),
                Some("Aktualisiere IORA oder verwende eine kompatible App-Version.")
            );
        }
    }

    // Check Docker support
    let has_docker = manifest.get("docker").is_some();
    let has_bundle = manifest.get("bundle").is_some();

    if has_docker && !context.system_capabilities.supports_docker {
        result.add_error(
            "docker",
            "App benötigt Docker aber System unterstützt kein Docker.",
            Some("Installiere Docker oder verwende eine alternative App ohne Docker-Anforderung.")
        );
    }

    if has_bundle && !context.system_capabilities.supports_bundles {
        result.add_error(
            "bundle",
            "App verwendet Bundle-Format aber System unterstützt keine Bundles.",
            Some("Aktualisiere IORA auf eine Version mit Bundle-Unterstützung.")
        );
    }

    // Check for conflicting apps (if dependencies field exists)
    if let Some(deps) = manifest.get("dependencies") {
        if let Some(conflicts) = deps.get("conflicts").and_then(|v| v.as_array()) {
            for conflict in conflicts {
                if let Some(app_id) = conflict.as_str() {
                    if context.installed_apps.contains_key(app_id) {
                        result.add_error(
                            "dependencies.conflicts",
                            &format!(
                                "App ist nicht kompatibel mit bereits installierter App \"{}\".",
                                app_id
                            ),
                            Some(&format!("Deinstalliere \"{}\" vor der Installation dieser App.", app_id))
                        );
                    }
                }
            }
        }

        // Check required dependencies
        if let Some(requires) = deps.get("requires").and_then(|v| v.as_array()) {
            for require in requires {
                if let Some(app_id) = require.as_str() {
                    if !context.installed_apps.contains_key(app_id) {
                        result.add_error(
                            "dependencies.requires",
                            &format!("App benötigt \"{}\" aber diese ist nicht installiert.", app_id),
                            Some(&format!("Installiere \"{}\" zuerst.", app_id))
                        );
                    }
                }
            }
        }
    }
}

/// Validate against security policy
pub fn validate_security_policy(
    manifest: &Value,
    policy: &SecurityPolicy,
    result: &mut ValidationResult,
) {
    // Check permission count
    if let Some(perms) = manifest.get("permissions").and_then(|p| p.as_array()) {
        if perms.len() > policy.max_permissions_per_app {
            result.add_error(
                "permissions",
                &format!(
                    "App fordert {} Permissions an, aber System-Limit ist {}.",
                    perms.len(),
                    policy.max_permissions_per_app
                ),
                Some("Reduziere die Anzahl der angeforderten Permissions.")
            );
        }

        // Check for blocked permissions
        for (i, perm) in perms.iter().enumerate() {
            if let Some(perm_str) = perm.as_str() {
                if policy.blocked_permissions.contains(perm_str) {
                    result.add_error(
                        &format!("permissions[{}]", i),
                        &format!(
                            "Permission \"{}\" ist durch Security-Policy blockiert.",
                            perm_str
                        ),
                        Some("Entferne diese Permission oder kontaktiere den Administrator.")
                    );
                }
            }
        }
    }

    // Check network access requirements
    if policy.require_network_whitelist {
        if manifest.get("permissions").and_then(|p| p.as_array()).map(|perms| {
            perms.iter().any(|p| p.as_str() == Some("NetworkAccess"))
        }).unwrap_or(false) {
            // App has NetworkAccess permission, check for whitelist
            if let Some(network) = manifest.get("network_access") {
                let has_domains = network.get("allowed_domains")
                    .and_then(|d| d.as_array())
                    .map(|arr| !arr.is_empty())
                    .unwrap_or(false);

                if !has_domains {
                    result.add_error(
                        "network_access.allowed_domains",
                        "Security-Policy erfordert Domain-Whitelist für NetworkAccess.",
                        Some("Füge \"allowed_domains\": [\"example.com\"] hinzu.")
                    );
                }
            } else {
                result.add_error(
                    "network_access",
                    "Security-Policy erfordert network_access-Konfiguration mit allowed_domains.",
                    Some("Füge \"network_access\": { \"allowed_domains\": [\"example.com\"] } hinzu.")
                );
            }
        }
    }

    // Check for untrusted source
    if !policy.allow_untrusted_apps {
        let installation_source = manifest
            .get("installation_source")
            .and_then(|s| s.as_str())
            .unwrap_or("manual_upload");

        if installation_source == "manual_upload" {
            result.add_warning(
                "installation_source",
                "App ist von nicht-vertrauenswürdiger Quelle. System-Policy erlaubt nur App-Store Apps.",
                Some("Lade die App aus dem offiziellen IORA App Store herunter.")
            );
        }
    }
}

/// Validate plugin sandbox configuration
pub fn validate_plugin_sandbox(manifest: &Value, result: &mut ValidationResult) {
    if manifest.get("type").and_then(|t| t.as_str()) == Some("plugin") {
        if let Some(sandbox) = manifest.get("sandbox") {
            // Max execution time
            if let Some(max_time) = sandbox.get("max_execution_time_ms").and_then(|v| v.as_u64()) {
                if max_time > 300000 {
                    // 5 minutes
                    result.add_warning(
                        "sandbox.max_execution_time_ms",
                        &format!("Maximale Ausführungszeit von {}ms ist sehr hoch (>5 Minuten).", max_time),
                        Some("Erwäge eine kürzere Ausführungszeit für bessere Responsiveness.")
                    );
                }
                if max_time == 0 {
                    result.add_error(
                        "sandbox.max_execution_time_ms",
                        "Maximale Ausführungszeit kann nicht 0 sein.",
                        Some("Setze einen vernünftigen Wert wie 5000 (5 Sekunden).")
                    );
                }
            }

            // Max memory
            if let Some(max_mem) = sandbox.get("max_memory_mb").and_then(|v| v.as_u64()) {
                if max_mem > 2048 {
                    // 2GB
                    result.add_warning(
                        "sandbox.max_memory_mb",
                        &format!("Maximaler Speicher von {}MB ist sehr hoch (>2GB).", max_mem),
                        Some("Plugins sollten weniger Speicher verwenden.")
                    );
                }
                if max_mem < 32 {
                    result.add_warning(
                        "sandbox.max_memory_mb",
                        &format!("Maximaler Speicher von {}MB könnte zu wenig sein.", max_mem),
                        Some("Erwäge mindestens 64MB für stabile Plugin-Ausführung.")
                    );
                }
            }
        } else {
            result.add_warning(
                "sandbox",
                "Plugin hat keine Sandbox-Konfiguration. Standardwerte werden verwendet.",
                Some("Füge \"sandbox\": { \"max_execution_time_ms\": 5000, \"max_memory_mb\": 128, \"allow_network\": false, \"allow_file_system\": false } hinzu.")
            );
        }
    }
}

// ─── Helper Functions ─────────────────────────────────────────────────

/// Parse memory limit string like "512M" or "1G" to MB
fn parse_memory_limit(limit: &str) -> Option<u64> {
    let limit = limit.trim().to_uppercase();

    if limit.ends_with('G') {
        limit.trim_end_matches('G').parse::<u64>().ok().map(|v| v * 1024)
    } else if limit.ends_with('M') {
        limit.trim_end_matches('M').parse::<u64>().ok()
    } else {
        // Assume bytes, convert to MB
        limit.parse::<u64>().ok().map(|v| v / (1024 * 1024))
    }
}

/// Parse CPU limit string like "0.5" or "2" to cores
fn parse_cpu_limit(limit: &str) -> Option<f64> {
    limit.trim().parse::<f64>().ok()
}

/// Check if version requirement is satisfied
fn is_version_compatible(required: &str, available: &str) -> bool {
    // Simple version comparison (major.minor.patch)
    let req_parts: Vec<u32> = required.split('.').filter_map(|s| s.parse().ok()).collect();
    let avail_parts: Vec<u32> = available.split('.').filter_map(|s| s.parse().ok()).collect();

    if req_parts.is_empty() || avail_parts.is_empty() {
        return false;
    }

    // Compare major version
    if avail_parts[0] < req_parts[0] {
        return false;
    }
    if avail_parts[0] > req_parts[0] {
        return true;
    }

    // Major versions equal, compare minor
    if req_parts.len() > 1 && avail_parts.len() > 1 {
        if avail_parts[1] < req_parts[1] {
            return false;
        }
        if avail_parts[1] > req_parts[1] {
            return true;
        }

        // Minor versions equal, compare patch
        if req_parts.len() > 2 && avail_parts.len() > 2 {
            return avail_parts[2] >= req_parts[2];
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_memory_limit() {
        assert_eq!(parse_memory_limit("512M"), Some(512));
        assert_eq!(parse_memory_limit("1G"), Some(1024));
        assert_eq!(parse_memory_limit("2048m"), Some(2048));
        assert_eq!(parse_memory_limit("invalid"), None);
    }

    #[test]
    fn test_parse_cpu_limit() {
        assert_eq!(parse_cpu_limit("0.5"), Some(0.5));
        assert_eq!(parse_cpu_limit("2"), Some(2.0));
        assert_eq!(parse_cpu_limit("invalid"), None);
    }

    #[test]
    fn test_version_compatibility() {
        assert!(is_version_compatible("2.0.0", "2.0.0"));
        assert!(is_version_compatible("2.0.0", "2.1.0"));
        assert!(is_version_compatible("2.0.0", "3.0.0"));
        assert!(!is_version_compatible("2.1.0", "2.0.0"));
        assert!(!is_version_compatible("3.0.0", "2.9.9"));
    }
}
