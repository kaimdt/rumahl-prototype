//! App Database – SQLite database provisioning for IORA apps.
//!
//! Apps can optionally request their own SQLite database instead of
//! using the shared PostgreSQL database. This is useful for apps that:
//!
//! - Need to store large amounts of relational data
//! - Want to use SQLite-specific features (FTS, JSON1, etc.)
//! - Don't want to depend on the shared PostgreSQL connection pool
//! - Need offline-capable local storage
//!
//! The database is provisioned as a file in the app's isolated storage
//! directory. Each app gets at most one SQLite database. The system
//! manages backups and migrations.

use serde::{Deserialize, Serialize};

/// Database backend type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum DatabaseBackend {
    /// Shared PostgreSQL (default, connection pool managed by IORA)
    #[default]
    Postgres,
    /// Per-app SQLite database file
    Sqlite,
}


/// Database configuration in the app manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppDatabaseConfig {
    /// Which database backend to use
    #[serde(default)]
    pub backend: DatabaseBackend,

    /// SQLite-specific settings (only used when backend = Sqlite)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sqlite: Option<SqliteConfig>,

    /// PostgreSQL-specific settings (only used when backend = Postgres)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub postgres: Option<PostgresConfig>,
}

impl Default for AppDatabaseConfig {
    fn default() -> Self {
        Self {
            backend: DatabaseBackend::Postgres,
            sqlite: None,
            postgres: None,
        }
    }
}

/// SQLite database configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqliteConfig {
    /// Automatically run these SQL statements after database creation
    #[serde(default)]
    pub init_sql: Vec<String>,

    /// Enable WAL mode for better concurrent read performance
    #[serde(default = "default_true")]
    pub wal_mode: bool,

    /// Maximum database size in bytes (default: 100 MB)
    #[serde(default = "default_max_db_size")]
    pub max_size_bytes: u64,

    /// Enable auto-backup (default: true)
    #[serde(default = "default_true")]
    pub auto_backup: bool,

    /// Backup interval in minutes (default: 1440 = daily)
    #[serde(default = "default_backup_interval")]
    pub backup_interval_minutes: u32,
}

fn default_true() -> bool { true }
fn default_max_db_size() -> u64 { 100 * 1024 * 1024 }
fn default_backup_interval() -> u32 { 1440 }

impl Default for SqliteConfig {
    fn default() -> Self {
        Self {
            init_sql: Vec::new(),
            wal_mode: true,
            max_size_bytes: default_max_db_size(),
            auto_backup: true,
            backup_interval_minutes: default_backup_interval(),
        }
    }
}

/// PostgreSQL connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostgresConfig {
    /// Database schema name (auto-created if it doesn't exist)
    #[serde(default = "default_schema")]
    pub schema: String,

    /// Maximum connections in the pool
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
}

fn default_schema() -> String { "public".to_string() }
fn default_max_connections() -> u32 { 5 }

/// Database status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseStatus {
    /// Database backend
    pub backend: DatabaseBackend,

    /// Connection state
    pub connected: bool,

    /// Database file size (SQLite only)
    pub size_bytes: Option<u64>,

    /// Number of tables
    pub table_count: Option<u32>,

    /// Last backup timestamp
    pub last_backup: Option<String>,

    /// Error message if any
    pub error: Option<String>,
}

/// Database migration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseMigration {
    /// Migration version (sequential)
    pub version: u32,

    /// Migration name
    pub name: String,

    /// SQL to apply
    pub sql: String,

    /// Whether this is a breaking change
    #[serde(default)]
    pub breaking: bool,
}

/// Request to execute raw SQL on the app's database
#[derive(Debug, Deserialize)]
pub struct ExecuteSqlRequest {
    /// SQL statement(s) to execute
    pub sql: String,

    /// Parameters (optional, for prepared statements)
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
}

/// Result of a SQL execution
#[derive(Debug, Serialize)]
pub struct ExecuteSqlResult {
    pub success: bool,
    pub rows_affected: Option<u64>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub error: Option<String>,
    pub duration_ms: u64,
}
