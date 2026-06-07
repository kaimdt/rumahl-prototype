use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Database configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbConfig {
    /// Service definitions
    pub services: HashMap<String, ServiceConfig>,

    /// Password rotation settings
    pub rotation: RotationConfig,

    /// Global database settings
    pub global: GlobalConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    /// Database name (default: iora_{service})
    pub database: Option<String>,

    /// Connection limit
    #[serde(default = "default_conn_limit")]
    pub conn_limit: i32,

    /// Custom privileges (default: standard CRUD)
    pub privileges: Option<Vec<String>>,

    /// Whether this service can create temp tables
    #[serde(default)]
    pub allow_temp_tables: bool,

    /// Whether this service needs DDL rights (migrations)
    #[serde(default)]
    pub allow_ddl: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationConfig {
    /// How often to rotate passwords (in days)
    #[serde(default = "default_rotation_days")]
    pub interval_days: u32,

    /// Minimum password length
    #[serde(default = "default_min_password_length")]
    pub min_password_length: usize,

    /// Keep old passwords for rollback (in hours)
    #[serde(default = "default_grace_period_hours")]
    pub grace_period_hours: u32,

    /// Auto-rotate on schedule
    #[serde(default = "default_true")]
    pub auto_rotate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalConfig {
    /// Default connection limit
    #[serde(default = "default_conn_limit")]
    pub default_conn_limit: i32,

    /// Enable row level security
    #[serde(default = "default_true")]
    pub enable_rls: bool,

    /// Enable connection pooling recommendations
    #[serde(default = "default_true")]
    pub recommend_pooling: bool,

    /// Backup retention days
    #[serde(default = "default_backup_retention")]
    pub backup_retention_days: u32,
}

fn default_conn_limit() -> i32 {
    20
}
fn default_rotation_days() -> u32 {
    90
}
fn default_min_password_length() -> usize {
    32
}
fn default_grace_period_hours() -> u32 {
    24
}
fn default_true() -> bool {
    true
}
fn default_backup_retention() -> u32 {
    30
}

impl Default for DbConfig {
    fn default() -> Self {
        let mut services = HashMap::new();

        // Define all IORA services
        for service in &[
            "iora-home",
            "iora-core",
            "iora-secrets",
            "iora-security",
            "iora-watchdog",
            "iora-assist",
            "iora-appstore",
            "iora-supervisor",
            "iora-gateway",
            "iora-files",
            "iora-connector",
            "iora-backup",
            "iora-api",
        ] {
            services.insert(
                service.to_string(),
                ServiceConfig {
                    database: None,
                    conn_limit: 20,
                    privileges: None,
                    allow_temp_tables: true,
                    allow_ddl: service == &"iora-home" || service == &"iora-core", // Only main services do migrations
                },
            );
        }

        Self {
            services,
            rotation: RotationConfig {
                interval_days: 90,
                min_password_length: 32,
                grace_period_hours: 24,
                auto_rotate: true,
            },
            global: GlobalConfig {
                default_conn_limit: 20,
                enable_rls: true,
                recommend_pooling: true,
                backup_retention_days: 30,
            },
        }
    }
}

impl DbConfig {
    pub fn load_or_create(path: &Path) -> anyhow::Result<Self> {
        if path.exists() {
            let content = std::fs::read_to_string(path)?;
            Ok(toml::from_str(&content)?)
        } else {
            let config = Self::default();
            let content = toml::to_string_pretty(&config)?;
            std::fs::create_dir_all(path.parent().unwrap())?;
            std::fs::write(path, content)?;
            tracing::info!("Created default config at {}", path.display());
            Ok(config)
        }
    }

    pub fn get_database_name(&self, service: &str) -> String {
        self.services
            .get(service)
            .and_then(|s| s.database.clone())
            .unwrap_or_else(|| format!("iora_{}", service.trim_start_matches("iora-")))
    }

    pub fn get_user_name(&self, service: &str) -> String {
        format!("{}_user", service.replace('-', "_"))
    }
}
