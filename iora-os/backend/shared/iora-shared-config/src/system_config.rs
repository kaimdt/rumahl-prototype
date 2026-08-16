//! IORA System Configuration — NO .env files in production.
//! This module is isolated so unrelated shared-code changes do not rebuild it.
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
    ("iora-home", 8126),
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
    ("iora-stt", 8110),
    ("iora-tts", 8111),
];

// ═══════════════════════════════════════════════════════════════════════
// Bootstrap env helpers — ONLY used when the settings DB isn't reachable
// ═══════════════════════════════════════════════════════════════════════

fn env_optional(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
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
/// Priority order:
/// 1. Service-specific credentials file (/etc/iora/db-credentials/{service}.env)
/// 2. Service-specific env var ({SERVICE}_DB_URL)
/// 3. Shared DATABASE_URL env var
/// 4. Default SQLite database
pub fn database_url_for(service: &str) -> String {
    // Try service-specific credentials file first (managed by iora-db-manager)
    let cred_file = format!("/etc/iora/db-credentials/{}.env", service);
    if let Ok(content) = std::fs::read_to_string(&cred_file) {
        for line in content.lines() {
            if let Some(url) = line.strip_prefix("DATABASE_URL=") {
                return url.trim().to_string();
            }
        }
    }

    // Fall back to env var
    let key = format!("{}_DB_URL", service.to_uppercase().replace('-', "_"));
    env_optional(&key).unwrap_or_else(database_url)
}

// ═══════════════════════════════════════════════════════════════════════
// JWT / Security Secrets
// ═══════════════════════════════════════════════════════════════════════

/// Auto-generated JWT secret cache (lazy init, used as fallback before DB is available).
static AUTO_JWT_SECRET: OnceLock<String> = OnceLock::new();

/// Normalize secrets crossing JSON, shell and systemd EnvironmentFile
/// boundaries. A JSON preference is commonly serialized as `"secret"`, while
/// hand-written env files may use `'secret'` or `"secret"`. JWT signing and
/// verification must use the raw bytes in every service.
fn normalize_jwt_secret(value: &str) -> String {
    let mut normalized = value.trim();
    while normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if matches!(
            (bytes[0], bytes[normalized.len() - 1]),
            (b'"', b'"') | (b'\'', b'\'')
        ) {
            normalized = normalized[1..normalized.len() - 1].trim();
        } else {
            break;
        }
    }
    normalized.to_string()
}

/// Returns the JWT secret. Priority:
/// 1. `IORA_JWT_SECRET` environment variable
/// 2. Settings cache key `jwt_secret` (populated from system_preferences table)
/// 3. Auto-generated random secret (set by `persist_jwt_secret` or UUID v4 fallback)
///
/// Shared JWT-secret file: iora-home persists the canonical secret here so
/// EVERY microservice on the host (iora-control, iora-files, iora-security,
/// ...) validates with the SAME secret. Without this, each process falls
/// back to a per-process random secret and cross-service JWT checks fail
/// with "InvalidSignature". Path is overridable for dev/tests.
///
/// `/etc/iora/jwt-secret` is the canonical host-level file provisioned by
/// `iora-config-sync`. `/var/lib/iora/jwt-secret` remains a writable fallback
/// for first boot, containers and development runs where the unprivileged
/// service cannot create files below `/etc` yet.
pub fn jwt_secret_file() -> std::path::PathBuf {
    std::env::var_os("IORA_JWT_SECRET_FILE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/etc/iora/jwt-secret"))
}

fn read_jwt_secret_file() -> Option<String> {
    let primary = jwt_secret_file();
    let mut paths = vec![primary.clone()];
    if std::env::var_os("IORA_JWT_SECRET_FILE").is_none() {
        paths.push(std::path::PathBuf::from("/var/lib/iora/jwt-secret"));
    }
    for path in paths {
        let Ok(value) = std::fs::read_to_string(path) else {
            continue;
        };
        let secret = normalize_jwt_secret(&value);
        if !secret.is_empty() && secret.len() >= 16 {
            return Some(secret);
        }
    }
    None
}

fn write_jwt_secret_file(secret: &str) {
    let primary = jwt_secret_file();
    let mut paths = vec![primary.clone()];
    if std::env::var_os("IORA_JWT_SECRET_FILE").is_none() {
        paths.push(std::path::PathBuf::from("/var/lib/iora/jwt-secret"));
    }
    let mut last_error = None;
    for path in paths {
        if let Some(parent) = path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                last_error = Some((path, error));
                continue;
            }
        }
        match std::fs::write(&path, secret.as_bytes()) {
            Ok(()) => return,
            Err(error) => last_error = Some((path, error)),
        }
    }
    if let Some((path, error)) = last_error {
        eprintln!(
            "[iora-shared-config] WARNING: could not persist shared JWT secret to {}: {error}",
            path.display()
        );
    }
}

pub fn jwt_secret() -> String {
    // 1. Env var (highest priority, for explicit override)
    if let Some(secret) = env_optional("IORA_JWT_SECRET") {
        return normalize_jwt_secret(&secret);
    }
    // 2. Settings cache (populated by iora-home from system_preferences table)
    if let Some(secret) = get_cached_setting("jwt_secret") {
        return normalize_jwt_secret(&secret);
    }
    // 3. Shared secret file — the cross-service source of truth. Checked
    // before the fallback so a late-appearing file always wins (services
    // that start before iora-home persists the secret pick it up on the
    // next call instead of being stuck with a per-process random value).
    if let Some(secret) = read_jwt_secret_file() {
        return secret;
    }
    // 4. Auto-generated fallback (UUID v4 is cryptographically random) —
    //    only used when no shared secret exists yet.
    AUTO_JWT_SECRET
        .get_or_init(|| uuid::Uuid::new_v4().to_string())
        .clone()
}

/// Persist a generated JWT secret — called by iora-home after writing to the DB.
/// Updates the settings cache, the auto-generated fallback AND the shared
/// secret file, so every service on the host uses the same secret.
pub fn persist_jwt_secret(secret: &str) {
    let secret = normalize_jwt_secret(secret);
    update_cached_setting("jwt_secret".to_string(), secret.clone());
    // Also update the auto-generated fallback to match the persisted value.
    // If the OnceLock is already initialized, force-set it (best-effort).
    let _ = AUTO_JWT_SECRET.set(secret.clone());
    // Share with all services on this host.
    write_jwt_secret_file(&secret);
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
    service_port_inner(service, default, true)
}

/// Like [`service_port`] but NEVER falls back to the generic `PORT` env var.
///
/// Used for cross-service discovery. `PORT` conventionally holds the
/// *caller's own* port (Docker containers, dev-VM systemd units), so using it
/// while resolving ANOTHER service resolves every service to the caller
/// itself — e.g. iora-home (PORT=8126) would proxy /api/files/* to
/// http://127.0.0.1:8126 (itself), causing recursive self-proxy loops (503
/// timeouts), 404s for /api/os/control/* and FD exhaustion. Only the
/// service-specific variable and the canonical port map are consulted here.
pub fn service_port_discovery(service: &str, default: u16) -> u16 {
    service_port_inner(service, default, false)
}

fn service_port_inner(service: &str, default: u16, allow_generic_port: bool) -> u16 {
    let specific_key = format!("{}_PORT", service.to_uppercase().replace('-', "_"));
    if let Ok(val) = std::env::var(&specific_key) {
        if let Ok(p) = val.parse() {
            return p;
        }
    }
    if allow_generic_port {
        if let Ok(val) = std::env::var("PORT") {
            if let Ok(p) = val.parse() {
                return p;
            }
        }
    }
    // Look up default from the port map
    for (name, port) in DEFAULT_PORTS {
        if *name == service {
            return *port;
        }
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
    if let Some(url) = env_optional(&url_key) {
        return url;
    }

    let port = service_port_discovery(service, default_port);
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
    service_url("iora-home", 8126)
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
        .parse()
        .unwrap_or(104_857_600)
}

pub fn files_default_quota() -> i64 {
    env_or("IORA_FILES_DEFAULT_QUOTA", "1073741824") // 1 GB
        .parse()
        .unwrap_or(1_073_741_824)
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
    env_optional("ORA_AI_API_KEY").or_else(|| env_optional("ASSIST_AI_API_KEY"))
}

pub fn ai_base_url() -> String {
    env_optional("ORA_AI_BASE_URL")
        .or_else(|| env_optional("ASSIST_AI_BACKEND_URL"))
        .unwrap_or_default()
}

pub fn ai_model() -> Option<String> {
    env_optional("ORA_AI_MODEL").or_else(|| env_optional("ASSIST_AI_MODEL"))
}

pub fn ai_api_version() -> Option<String> {
    env_optional("ORA_AI_API_VERSION").or_else(|| env_optional("ASSIST_AI_API_VERSION"))
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

pub fn smtp_server() -> Option<String> {
    env_optional("SMTP_SERVER")
}
pub fn smtp_username() -> Option<String> {
    env_optional("SMTP_USERNAME")
}
pub fn smtp_password() -> Option<String> {
    env_optional("SMTP_PASSWORD")
}

// ═══════════════════════════════════════════════════════════════════════
// Gateway
// ═══════════════════════════════════════════════════════════════════════

pub fn gateway_max_request_size() -> usize {
    env_or("MAX_REQUEST_SIZE", "10485760")
        .parse()
        .unwrap_or(10_485_760)
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
    env_or("IORA_RECOVERY_COOLDOWN_SECS", "300")
        .parse()
        .unwrap_or(300)
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
    env_or("IORA_HOME_DB_MAX_ATTEMPTS", "10")
        .parse()
        .unwrap_or(10)
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
    env_or("IORA_CONNECTOR_RELAY_PORT", "0")
        .parse()
        .unwrap_or(0)
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

/// STT (faster-whisper) service URL.
pub fn stt_service_url() -> String {
    env_or("IORA_STT_URL", "http://localhost:8110")
}

/// TTS (Kokoro) service URL.
pub fn tts_service_url() -> String {
    env_or("IORA_TTS_URL", "http://localhost:8111")
}

// ═══════════════════════════════════════════════════════════════════════
// Settings DB client — for runtime overrides from Global Config
// ═══════════════════════════════════════════════════════════════════════

/// Thread-safe cache of settings fetched from iora-home's settings API.
static SETTINGS_CACHE: OnceLock<std::sync::RwLock<std::collections::HashMap<String, String>>> =
    OnceLock::new();

/// Last update timestamp for cache invalidation
static CACHE_UPDATED_AT: OnceLock<std::sync::RwLock<std::time::SystemTime>> = OnceLock::new();

fn settings_cache() -> &'static std::sync::RwLock<std::collections::HashMap<String, String>> {
    SETTINGS_CACHE.get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()))
}

fn cache_updated_at() -> &'static std::sync::RwLock<std::time::SystemTime> {
    CACHE_UPDATED_AT.get_or_init(|| std::sync::RwLock::new(std::time::SystemTime::UNIX_EPOCH))
}

/// Called by iora-home after bootstrapping to populate the cache.
pub fn seed_settings_cache(entries: Vec<(String, String)>) {
    if let Ok(mut cache) = settings_cache().write() {
        for (k, v) in entries {
            cache.insert(k, v);
        }
        // Update timestamp
        if let Ok(mut ts) = cache_updated_at().write() {
            *ts = std::time::SystemTime::now();
        }
    }
}

/// Update a single setting in the cache (hot-reload).
/// This is called when a setting is changed via the API.
pub fn update_cached_setting(key: String, value: String) {
    if let Ok(mut cache) = settings_cache().write() {
        cache.insert(key, value);
        // Update timestamp
        if let Ok(mut ts) = cache_updated_at().write() {
            *ts = std::time::SystemTime::now();
        }
    }
}

/// Remove a setting from the cache (hot-reload).
pub fn remove_cached_setting(key: &str) {
    if let Ok(mut cache) = settings_cache().write() {
        cache.remove(key);
        // Update timestamp
        if let Ok(mut ts) = cache_updated_at().write() {
            *ts = std::time::SystemTime::now();
        }
    }
}

/// Clear the entire settings cache.
pub fn clear_settings_cache() {
    if let Ok(mut cache) = settings_cache().write() {
        cache.clear();
        // Update timestamp
        if let Ok(mut ts) = cache_updated_at().write() {
            *ts = std::time::SystemTime::now();
        }
    }
}

/// Try to read a setting from the runtime cache (Global Config).
/// Returns None if not cached — caller should fall back to env var.
pub fn get_cached_setting(key: &str) -> Option<String> {
    settings_cache().read().ok()?.get(key).cloned()
}

/// Get the timestamp when the cache was last updated.
/// Useful for services that want to detect config changes.
pub fn get_cache_updated_at() -> std::time::SystemTime {
    cache_updated_at()
        .read()
        .ok()
        .map(|ts| *ts)
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
}

#[cfg(test)]
mod jwt_secret_tests {
    use super::normalize_jwt_secret;

    #[test]
    fn removes_json_and_environment_file_quotes() {
        assert_eq!(
            normalize_jwt_secret(r#""shared-secret-value""#),
            "shared-secret-value"
        );
        assert_eq!(
            normalize_jwt_secret(r#"'shared-secret-value'"#),
            "shared-secret-value"
        );
        assert_eq!(
            normalize_jwt_secret("'shared-secret-value'"),
            "shared-secret-value"
        );
        assert_eq!(
            normalize_jwt_secret("  shared-secret-value\n"),
            "shared-secret-value"
        );
    }

    #[test]
    fn canonical_path_is_etc_iora() {
        if std::env::var_os("IORA_JWT_SECRET_FILE").is_none() {
            assert_eq!(
                super::jwt_secret_file(),
                std::path::PathBuf::from("/etc/iora/jwt-secret")
            );
        }
    }
}
