//! IORA System Configuration — NO .env files in production.
//!
//! In IORA OS, ALL configuration lives in the Global Config system
//! (settings DB table). This module provides:
//!
//! 1. A **bootstrap layer** (env vars / CLI flags) for DB URL, JWT secret,
//!    ports — just enough to start the service and reach the settings DB.
//! 2. A **runtime layer** (settings DB) for everything else.
//! 3. **Auto-detection** of system URLs, ports, and paths where possible.
//!
//! # Usage
//!
//! ```ignore
//! use iora_shared::system_config;
//!
//! let db_url = system_config::database_url();
//! let port = system_config::service_port("iora-home", 3001);
//! let jwt = system_config::jwt_secret();
//! ```
//!
//! Services NEVER call `std::env::var()` directly. All config flows
//! through this module, which provides sensible defaults and auto-fills
//! values into the Global Config DB.

use std::sync::OnceLock;

// ═══════════════════════════════════════════════════════════════════════
// Default port map — IORA OS standard ports
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_PORTS: &[(&str, u16)] = &[
    ("iora-home", 3001),
    ("iora-core", 8090),
    ("iora-control", 8091),
    ("iora-assist", 8092),
    ("iora-secrets", 8093),
    ("iora-watchdog", 8094),
    ("iora-security", 8095),
    ("iora-gateway", 8096),
    ("iora-supervisor", 8097),
    ("iora-appstore", 8098),
    ("iora-intelligence", 8099),
    ("iora-files", 8100),
    ("iora-api", 8101),
    ("iora-connector", 8102),
    ("iora-network-monitor", 8103),
    ("iora-domain-validator", 8104),
    ("iora-resource-manager", 8105),
    ("iora-updater", 8106),
    ("iora-backup", 8107),
    ("iora-nginx", 8108),
];

// ═══════════════════════════════════════════════════════════════════════
// Bootstrap env helpers — ONLY used when the settings DB isn't reachable
// ═══════════════════════════════════════════════════════════════════════

fn env_optional(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Database
// ═══════════════════════════════════════════════════════════════════════

/// Returns the primary database URL.
/// Bootstrap: DATABASE_URL env var.
/// Runtime: `database.url` from Global Config.
pub fn database_url() -> String {
    env_or("DATABASE_URL", "sqlite:./data/iora.db?mode=rwc")
}

/// Returns a service-specific database URL if set, otherwise the shared one.
pub fn database_url_for(service: &str) -> String {
    let key = format!("{}_DB_URL", service.to_uppercase().replace('-', "_"));
    env_optional(&key).unwrap_or_else(|| database_url())
}

// ═══════════════════════════════════════════════════════════════════════
// JWT / Security Secrets
// ═══════════════════════════════════════════════════════════════════════

/// Returns the JWT secret. Auto-generated on first boot if not set.
pub fn jwt_secret() -> String {
    env_or("IORA_JWT_SECRET", "iora-dev-jwt-change-in-production")
}

/// Master encryption key for the secrets service.
pub fn secrets_master_key() -> Option<String> {
    env_optional("SECRETS_MASTER_KEY")
}

/// Encryption key for the security database.
pub fn security_db_key() -> String {
    env_or("SECURITY_DB_KEY", "")
}

// ═══════════════════════════════════════════════════════════════════════
// Service Ports
// ═══════════════════════════════════════════════════════════════════════

/// Returns the port for a given IORA service. Checks:
/// 1. `{SERVICE}_PORT` env var (e.g. `IORA_HOME_PORT`, `CORE_PORT`)
/// 2. `PORT` env var (generic fallback)
/// 3. Default port from the IORA OS port map
pub fn service_port(service: &str, default: u16) -> u16 {
    let specific_key = format!("{}_PORT", service.to_uppercase().replace('-', "_"));
    if let Ok(val) = std::env::var(&specific_key) {
        if let Ok(p) = val.parse() { return p }
    }
    if let Ok(val) = std::env::var("PORT") {
        if let Ok(p) = val.parse() { return p }
    }
    // Look up default from the port map
    for (name, port) in DEFAULT_PORTS {
        if *name == service { return *port }
    }
    default
}

// ═══════════════════════════════════════════════════════════════════════
// Service URLs (auto-detected)
// ═══════════════════════════════════════════════════════════════════════

/// Builds the URL for another IORA service.
/// Native IORA OS services run as systemd units on the same device, so the
/// safe default is device-local loopback. Container/service-DNS mode is opt-in.
pub fn service_url(service: &str, default_port: u16) -> String {
    let url_key = format!("{}_URL", service.to_uppercase().replace('-', "_"));
    if let Some(url) = env_optional(&url_key) { return url }

    let port = service_port(service, default_port);
    if std::env::var("IORA_SERVICE_DNS").ok().as_deref() == Some("1")
        || std::env::var("IORA_CONTAINER_MODE").ok().as_deref() == Some("1")
        || std::path::Path::new("/.dockerenv").exists()
    {
        format!("http://{service}:{port}")
    } else {
        format!("http://127.0.0.1:{port}")
    }
}

/// Backend API base URL (iora-home or the main API gateway).
pub fn backend_url() -> String {
    service_url("iora-home", 3001)
}

/// ORA Assist / AI service URL.
pub fn assist_url() -> String {
    service_url("iora-assist", 8092)
}

/// Supervisor URL.
pub fn supervisor_url() -> String {
    service_url("iora-supervisor", 8097)
}

// ═══════════════════════════════════════════════════════════════════════
// File Storage
// ═══════════════════════════════════════════════════════════════════════

pub fn files_storage_dir() -> String {
    env_or("IORA_FILES_STORAGE", "./data/file_storage")
}

pub fn files_max_size_bytes() -> usize {
    env_or("IORA_FILES_MAX_SIZE", "104857600") // 100 MB
        .parse().unwrap_or(104_857_600)
}

pub fn files_default_quota() -> i64 {
    env_or("IORA_FILES_DEFAULT_QUOTA", "1073741824") // 1 GB
        .parse().unwrap_or(1_073_741_824)
}

pub fn files_base_url(port: u16) -> String {
    env_or("IORA_FILES_BASE_URL", &format!("http://localhost:{port}"))
}

// ═══════════════════════════════════════════════════════════════════════
// Local App Store / Dev paths
// ═══════════════════════════════════════════════════════════════════════

pub fn local_apps_dir() -> String {
    env_or("IORA_LOCAL_APPS_DIR", "./data/apps")
}

pub fn dist_dir() -> String {
    env_or("DIST_DIR", "../dist")
}

pub fn sandbox_dir() -> String {
    env_or("ORA_SANDBOX_DIR", "./data/sandbox")
}

// ═══════════════════════════════════════════════════════════════════════
// Home Assistant
// ═══════════════════════════════════════════════════════════════════════

pub fn ha_url() -> String {
    env_optional("HA_URL").unwrap_or_default()
}

pub fn ha_token() -> String {
    env_optional("HA_TOKEN").unwrap_or_default()
}

// ═══════════════════════════════════════════════════════════════════════
// AI Providers (flexible, multiple providers)
// ═══════════════════════════════════════════════════════════════════════

pub fn ai_provider() -> String {
    env_optional("ORA_AI_PROVIDER")
        .or_else(|| env_optional("ASSIST_AI_PROVIDER"))
        .unwrap_or_else(|| "ollama".to_string())
}

pub fn ai_api_key() -> Option<String> {
    env_optional("ORA_AI_API_KEY")
        .or_else(|| env_optional("ASSIST_AI_API_KEY"))
}

pub fn ai_base_url() -> String {
    env_optional("ORA_AI_BASE_URL")
        .or_else(|| env_optional("ASSIST_AI_BACKEND_URL"))
        .unwrap_or_default()
}

pub fn ai_model() -> Option<String> {
    env_optional("ORA_AI_MODEL")
        .or_else(|| env_optional("ASSIST_AI_MODEL"))
}

pub fn ai_api_version() -> Option<String> {
    env_optional("ORA_AI_API_VERSION")
        .or_else(|| env_optional("ASSIST_AI_API_VERSION"))
}

// ═══════════════════════════════════════════════════════════════════════
// GitHub Integration
// ═══════════════════════════════════════════════════════════════════════

pub fn github_token() -> Option<String> {
    env_optional("GITHUB_TOKEN")
}

pub fn github_app_id() -> Option<String> {
    env_optional("GITHUB_APP_ID")
}

pub fn github_installation_id() -> Option<String> {
    env_optional("GITHUB_INSTALLATION_ID")
}

pub fn github_private_key() -> Option<String> {
    env_optional("GITHUB_PRIVATE_KEY")
}

// ═══════════════════════════════════════════════════════════════════════
// SMTP / Email
// ═══════════════════════════════════════════════════════════════════════

pub fn smtp_server() -> Option<String> { env_optional("SMTP_SERVER") }
pub fn smtp_username() -> Option<String> { env_optional("SMTP_USERNAME") }
pub fn smtp_password() -> Option<String> { env_optional("SMTP_PASSWORD") }

// ═══════════════════════════════════════════════════════════════════════
// Gateway
// ═══════════════════════════════════════════════════════════════════════

pub fn gateway_max_request_size() -> usize {
    env_or("MAX_REQUEST_SIZE", "10485760").parse().unwrap_or(10_485_760)
}

pub fn gateway_request_timeout_secs() -> u64 {
    env_or("REQUEST_TIMEOUT_SECS", "30").parse().unwrap_or(30)
}

pub fn gateway_enable_sandboxing() -> bool {
    env_or("ENABLE_SANDBOXING", "true").parse().unwrap_or(true)
}

pub fn gateway_allowed_domains() -> Vec<String> {
    env_optional("ALLOWED_DOMAINS")
        .map(|s| s.split(',').map(|d| d.trim().to_string()).collect())
        .unwrap_or_default()
}

pub fn gateway_db_path() -> String {
    env_or("GATEWAY_DB_PATH", "./data/gateway.db")
}

// ═══════════════════════════════════════════════════════════════════════
// Bootstrap admin
// ═══════════════════════════════════════════════════════════════════════

pub fn bootstrap_admin_user() -> Option<String> {
    env_optional("IORA_BOOTSTRAP_ADMIN_USER")
}

pub fn bootstrap_admin_password() -> Option<String> {
    env_optional("IORA_BOOTSTRAP_ADMIN_PASSWORD")
}

pub fn bootstrap_admin_display_name() -> Option<String> {
    env_optional("IORA_BOOTSTRAP_ADMIN_DISPLAY_NAME")
}

// ═══════════════════════════════════════════════════════════════════════
// Watchdog / Recovery
// ═══════════════════════════════════════════════════════════════════════

pub fn recovery_mode() -> Option<String> {
    env_optional("IORA_RECOVERY_MODE")
}

pub fn recovery_threshold() -> u32 {
    env_or("IORA_RECOVERY_THRESHOLD", "3").parse().unwrap_or(3)
}

pub fn recovery_cooldown_secs() -> u64 {
    env_or("IORA_RECOVERY_COOLDOWN_SECS", "300").parse().unwrap_or(300)
}

// ═══════════════════════════════════════════════════════════════════════
// Misc
// ═══════════════════════════════════════════════════════════════════════

pub fn rust_log() -> String {
    env_or("RUST_LOG", "info")
}

pub fn environment() -> String {
    env_or("ENV", "production")
}

pub fn db_max_attempts() -> u32 {
    env_or("IORA_HOME_DB_MAX_ATTEMPTS", "10").parse().unwrap_or(10)
}

pub fn download_host_allowlist() -> Vec<String> {
    env_optional("IORA_DOWNLOAD_HOST_ALLOWLIST")
        .map(|s| s.split(',').map(|d| d.trim().to_string()).collect())
        .unwrap_or_default()
}

pub fn connector_domain() -> String {
    env_or("IORA_CONNECTOR_DOMAIN", "localhost")
}

pub fn connector_relay_port() -> u16 {
    env_or("IORA_CONNECTOR_RELAY_PORT", "0").parse().unwrap_or(0)
}

// ═══════════════════════════════════════════════════════════════════════
// Security
// ═══════════════════════════════════════════════════════════════════════

pub fn security_db_path() -> String {
    env_or("SECURITY_DB_PATH", "./data/security.db")
}

pub fn postgres_admin_url() -> Option<String> {
    env_optional("POSTGRES_ADMIN_URL")
}

// ═══════════════════════════════════════════════════════════════════════
// Backup / Updater
// ═══════════════════════════════════════════════════════════════════════

pub fn backup_service_url() -> String {
    env_or("BACKUP_SERVICE_URL", "http://localhost:8107")
}

// ═══════════════════════════════════════════════════════════════════════
// Settings DB client — for runtime overrides from Global Config
// ═══════════════════════════════════════════════════════════════════════

/// Thread-safe cache of settings fetched from iora-home's settings API.
static SETTINGS_CACHE: OnceLock<std::sync::RwLock<std::collections::HashMap<String, String>>> = OnceLock::new();

fn settings_cache() -> &'static std::sync::RwLock<std::collections::HashMap<String, String>> {
    SETTINGS_CACHE.get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()))
}

/// Called by iora-home after bootstrapping to populate the cache.
pub fn seed_settings_cache(entries: Vec<(String, String)>) {
    if let Ok(mut cache) = settings_cache().write() {
        for (k, v) in entries { cache.insert(k, v); }
    }
}

/// Try to read a setting from the runtime cache (Global Config).
/// Returns None if not cached — caller should fall back to env var.
pub fn get_cached_setting(key: &str) -> Option<String> {
    settings_cache().read().ok()?.get(key).cloned()
}
