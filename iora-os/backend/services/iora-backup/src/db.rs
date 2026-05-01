//! Database access layer for iora-backup.
//!
//! Uses runtime sqlx (no compile-time macro / `sqlx prepare` requirement).
//! Schema is created on startup via [`init_schema`].

use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::backup_engine::{BackupEngine, BackupResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    pub id: Uuid,
    pub enabled: bool,
    pub include_databases: bool,
    pub include_docker_volumes: bool,
    pub include_system_config: bool,
    pub include_user_data: bool,
    pub include_apps: bool,
    pub schedule_enabled: bool,
    pub schedule_cron: Option<String>,
    pub schedule_retention_days: i32,
    pub pre_update_enabled: bool,
    pub pre_update_retention_count: i32,
    pub remote_storage_enabled: bool,
    pub remote_storage_backend: Option<String>,
    pub remote_storage_config: Option<serde_json::Value>,
    pub updated_at: DateTime<Utc>,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4(),
            enabled: true,
            include_databases: true,
            include_docker_volumes: true,
            include_system_config: true,
            include_user_data: true,
            include_apps: true,
            schedule_enabled: false,
            schedule_cron: None,
            schedule_retention_days: 14,
            pre_update_enabled: true,
            pre_update_retention_count: 3,
            remote_storage_enabled: false,
            remote_storage_backend: None,
            remote_storage_config: None,
            updated_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRow {
    pub id: Uuid,
    pub name: String,
    pub backup_type: String,
    pub created_at: DateTime<Utc>,
    pub size_bytes: i64,
    pub local_path: String,
    pub remote_path: Option<String>,
    pub remote_backend: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub content_manifest: serde_json::Value,
}

pub async fn init_schema(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS backups (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL,
            backup_type TEXT NOT NULL DEFAULT 'manual',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            size_bytes BIGINT NOT NULL DEFAULT 0,
            local_path TEXT NOT NULL,
            remote_path TEXT,
            remote_backend TEXT,
            status TEXT NOT NULL DEFAULT 'completed',
            error_message TEXT,
            content_manifest JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC)")
        .execute(pool)
        .await
        .ok();

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS backup_config (
            id UUID PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            include_databases BOOLEAN NOT NULL DEFAULT TRUE,
            include_docker_volumes BOOLEAN NOT NULL DEFAULT TRUE,
            include_system_config BOOLEAN NOT NULL DEFAULT TRUE,
            include_user_data BOOLEAN NOT NULL DEFAULT TRUE,
            include_apps BOOLEAN NOT NULL DEFAULT TRUE,
            schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            schedule_cron TEXT,
            schedule_retention_days INTEGER NOT NULL DEFAULT 14,
            pre_update_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            pre_update_retention_count INTEGER NOT NULL DEFAULT 3,
            remote_storage_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            remote_storage_backend TEXT,
            remote_storage_config JSONB,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Ensure exactly one config row exists (singleton).
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*)::BIGINT FROM backup_config")
        .fetch_one(pool)
        .await?;
    if count.0 == 0 {
        let cfg = BackupConfig::default();
        sqlx::query(
            r#"
            INSERT INTO backup_config (
                id, enabled, include_databases, include_docker_volumes,
                include_system_config, include_user_data, include_apps,
                schedule_enabled, schedule_cron, schedule_retention_days,
                pre_update_enabled, pre_update_retention_count,
                remote_storage_enabled, remote_storage_backend, remote_storage_config,
                updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            "#,
        )
        .bind(cfg.id)
        .bind(cfg.enabled)
        .bind(cfg.include_databases)
        .bind(cfg.include_docker_volumes)
        .bind(cfg.include_system_config)
        .bind(cfg.include_user_data)
        .bind(cfg.include_apps)
        .bind(cfg.schedule_enabled)
        .bind(&cfg.schedule_cron)
        .bind(cfg.schedule_retention_days)
        .bind(cfg.pre_update_enabled)
        .bind(cfg.pre_update_retention_count)
        .bind(cfg.remote_storage_enabled)
        .bind(&cfg.remote_storage_backend)
        .bind(&cfg.remote_storage_config)
        .bind(cfg.updated_at)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn load_config(pool: &PgPool) -> anyhow::Result<Option<BackupConfig>> {
    let row = sqlx::query(
        r#"SELECT id, enabled, include_databases, include_docker_volumes,
                  include_system_config, include_user_data, include_apps,
                  schedule_enabled, schedule_cron, schedule_retention_days,
                  pre_update_enabled, pre_update_retention_count,
                  remote_storage_enabled, remote_storage_backend, remote_storage_config,
                  updated_at
           FROM backup_config LIMIT 1"#,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| BackupConfig {
        id: r.get("id"),
        enabled: r.get("enabled"),
        include_databases: r.get("include_databases"),
        include_docker_volumes: r.get("include_docker_volumes"),
        include_system_config: r.get("include_system_config"),
        include_user_data: r.get("include_user_data"),
        include_apps: r.get("include_apps"),
        schedule_enabled: r.get("schedule_enabled"),
        schedule_cron: r.get("schedule_cron"),
        schedule_retention_days: r.get("schedule_retention_days"),
        pre_update_enabled: r.get("pre_update_enabled"),
        pre_update_retention_count: r.get("pre_update_retention_count"),
        remote_storage_enabled: r.get("remote_storage_enabled"),
        remote_storage_backend: r.get("remote_storage_backend"),
        remote_storage_config: r.get("remote_storage_config"),
        updated_at: r.get("updated_at"),
    }))
}

#[allow(clippy::too_many_arguments)]
pub async fn update_config(
    pool: &PgPool,
    patch: &serde_json::Value,
) -> anyhow::Result<BackupConfig> {
    let mut cfg = load_config(pool).await?.unwrap_or_default();
    if let Some(v) = patch.get("enabled").and_then(|v| v.as_bool()) { cfg.enabled = v; }
    if let Some(v) = patch.get("include_databases").and_then(|v| v.as_bool()) { cfg.include_databases = v; }
    if let Some(v) = patch.get("include_docker_volumes").and_then(|v| v.as_bool()) { cfg.include_docker_volumes = v; }
    if let Some(v) = patch.get("include_system_config").and_then(|v| v.as_bool()) { cfg.include_system_config = v; }
    if let Some(v) = patch.get("include_user_data").and_then(|v| v.as_bool()) { cfg.include_user_data = v; }
    if let Some(v) = patch.get("include_apps").and_then(|v| v.as_bool()) { cfg.include_apps = v; }
    if let Some(v) = patch.get("schedule_enabled").and_then(|v| v.as_bool()) { cfg.schedule_enabled = v; }
    if let Some(v) = patch.get("schedule_cron").and_then(|v| v.as_str()) { cfg.schedule_cron = Some(v.to_string()); }
    if let Some(v) = patch.get("schedule_retention_days").and_then(|v| v.as_i64()) { cfg.schedule_retention_days = v as i32; }
    if let Some(v) = patch.get("pre_update_enabled").and_then(|v| v.as_bool()) { cfg.pre_update_enabled = v; }
    if let Some(v) = patch.get("pre_update_retention_count").and_then(|v| v.as_i64()) { cfg.pre_update_retention_count = v as i32; }
    if let Some(v) = patch.get("remote_storage_enabled").and_then(|v| v.as_bool()) { cfg.remote_storage_enabled = v; }
    if let Some(v) = patch.get("remote_storage_backend").and_then(|v| v.as_str()) { cfg.remote_storage_backend = Some(v.to_string()); }
    if let Some(v) = patch.get("remote_storage_config") { cfg.remote_storage_config = Some(v.clone()); }
    cfg.updated_at = Utc::now();

    sqlx::query(
        r#"UPDATE backup_config SET
              enabled=$1, include_databases=$2, include_docker_volumes=$3,
              include_system_config=$4, include_user_data=$5, include_apps=$6,
              schedule_enabled=$7, schedule_cron=$8, schedule_retention_days=$9,
              pre_update_enabled=$10, pre_update_retention_count=$11,
              remote_storage_enabled=$12, remote_storage_backend=$13,
              remote_storage_config=$14, updated_at=$15
           WHERE id=$16"#,
    )
    .bind(cfg.enabled)
    .bind(cfg.include_databases)
    .bind(cfg.include_docker_volumes)
    .bind(cfg.include_system_config)
    .bind(cfg.include_user_data)
    .bind(cfg.include_apps)
    .bind(cfg.schedule_enabled)
    .bind(&cfg.schedule_cron)
    .bind(cfg.schedule_retention_days)
    .bind(cfg.pre_update_enabled)
    .bind(cfg.pre_update_retention_count)
    .bind(cfg.remote_storage_enabled)
    .bind(&cfg.remote_storage_backend)
    .bind(&cfg.remote_storage_config)
    .bind(cfg.updated_at)
    .bind(cfg.id)
    .execute(pool)
    .await?;
    Ok(cfg)
}

pub async fn insert_backup(
    pool: &PgPool,
    b: &BackupResult,
    backup_type: &str,
    status: &str,
    error_message: Option<String>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"INSERT INTO backups (id, name, backup_type, created_at, size_bytes,
                                  local_path, status, error_message, content_manifest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"#,
    )
    .bind(b.id)
    .bind(&b.name)
    .bind(backup_type)
    .bind(b.created_at)
    .bind(b.size_bytes as i64)
    .bind(b.local_path.to_string_lossy().to_string())
    .bind(status)
    .bind(error_message)
    .bind(&b.manifest)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_backups(pool: &PgPool) -> anyhow::Result<Vec<BackupRow>> {
    let rows = sqlx::query(
        r#"SELECT id, name, backup_type, created_at, size_bytes, local_path,
                  remote_path, remote_backend, status, error_message, content_manifest
           FROM backups ORDER BY created_at DESC LIMIT 200"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| BackupRow {
            id: r.get("id"),
            name: r.get("name"),
            backup_type: r.get("backup_type"),
            created_at: r.get("created_at"),
            size_bytes: r.get("size_bytes"),
            local_path: r.get("local_path"),
            remote_path: r.get("remote_path"),
            remote_backend: r.get("remote_backend"),
            status: r.get("status"),
            error_message: r.get("error_message"),
            content_manifest: r.get("content_manifest"),
        })
        .collect())
}

pub async fn find_backup(pool: &PgPool, id: Uuid) -> anyhow::Result<Option<BackupRow>> {
    let row = sqlx::query(
        r#"SELECT id, name, backup_type, created_at, size_bytes, local_path,
                  remote_path, remote_backend, status, error_message, content_manifest
           FROM backups WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| BackupRow {
        id: r.get("id"),
        name: r.get("name"),
        backup_type: r.get("backup_type"),
        created_at: r.get("created_at"),
        size_bytes: r.get("size_bytes"),
        local_path: r.get("local_path"),
        remote_path: r.get("remote_path"),
        remote_backend: r.get("remote_backend"),
        status: r.get("status"),
        error_message: r.get("error_message"),
        content_manifest: r.get("content_manifest"),
    }))
}

pub async fn prune_backups_older_than(
    pool: &PgPool,
    cutoff: DateTime<Utc>,
    engine: &Arc<BackupEngine>,
) -> anyhow::Result<()> {
    let rows = sqlx::query("SELECT id, local_path FROM backups WHERE created_at < $1")
        .bind(cutoff)
        .fetch_all(pool)
        .await?;
    for r in rows {
        let id: Uuid = r.get("id");
        let path: String = r.get("local_path");
        let _ = std::fs::remove_file(Path::new(&path));
        let _ = engine; // engine not needed beyond signature
        sqlx::query("DELETE FROM backups WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await
            .ok();
    }
    Ok(())
}
