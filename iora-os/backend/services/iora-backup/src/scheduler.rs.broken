use chrono::{DateTime, Utc};
use cron::Schedule;
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::backup_engine::{BackupEngine, BackupOptions};

pub struct BackupScheduler {
    db: PgPool,
    backup_engine: Arc<BackupEngine>,
    schedule: Option<Schedule>,
    running: bool,
}

impl BackupScheduler {
    pub fn new(db: PgPool, backup_engine: Arc<BackupEngine>) -> Self {
        Self {
            db,
            backup_engine,
            schedule: None,
            running: false,
        }
    }

    /// Update the backup schedule
    pub async fn update_schedule(&mut self, cron_expr: &str) -> Result<(), String> {
        match Schedule::from_str(cron_expr) {
            Ok(schedule) => {
                self.schedule = Some(schedule);
                info!("Backup schedule updated: {}", cron_expr);
                Ok(())
            }
            Err(e) => {
                error!("Invalid cron expression: {}", e);
                Err(format!("Invalid cron expression: {}", e))
            }
        }
    }

    /// Start the scheduler
    pub async fn start(&mut self) {
        if self.running {
            warn!("Scheduler is already running");
            return;
        }

        self.running = true;
        info!("Starting backup scheduler");

        loop {
            // Check if scheduled backups are enabled
            let config = match sqlx::query!(
                r#"
                SELECT schedule_enabled, schedule_cron, schedule_retention_days,
                       include_databases, include_docker_volumes, include_system_config,
                       include_user_data, include_apps
                FROM backup_config
                ORDER BY updated_at DESC
                LIMIT 1
                "#
            )
            .fetch_optional(&self.db)
            .await
            {
                Ok(Some(config)) => config,
                Ok(None) => {
                    // No configuration, wait and retry
                    sleep(Duration::from_secs(300)).await;
                    continue;
                }
                Err(e) => {
                    error!("Failed to get backup config: {}", e);
                    sleep(Duration::from_secs(60)).await;
                    continue;
                }
            };

            if !config.schedule_enabled {
                // Scheduled backups are disabled
                sleep(Duration::from_secs(300)).await;
                continue;
            }

            // Update schedule if cron expression changed
            if let Some(cron_expr) = config.schedule_cron {
                if let Ok(schedule) = Schedule::from_str(&cron_expr) {
                    self.schedule = Some(schedule);
                }
            }

            // Wait for next scheduled time
            if let Some(schedule) = &self.schedule {
                let now = Utc::now();
                let next = schedule.upcoming(Utc).next();

                if let Some(next_time) = next {
                    let wait_duration = (next_time - now).to_std().unwrap_or(Duration::from_secs(60));

                    info!("Next scheduled backup at: {}", next_time);
                    sleep(wait_duration).await;

                    // Create scheduled backup
                    info!("Starting scheduled backup");

                    let backup_options = BackupOptions {
                        include_databases: config.include_databases,
                        include_docker_volumes: config.include_docker_volumes,
                        include_system_config: config.include_system_config,
                        include_user_data: config.include_user_data,
                        include_apps: config.include_apps,
                    };

                    if let Err(e) = self.create_scheduled_backup(backup_options).await {
                        error!("Scheduled backup failed: {}", e);
                    }

                    // Cleanup old backups based on retention policy
                    if let Err(e) = self.cleanup_old_backups(config.schedule_retention_days).await {
                        error!("Failed to cleanup old backups: {}", e);
                    }
                } else {
                    // No upcoming time, wait and retry
                    sleep(Duration::from_secs(60)).await;
                }
            } else {
                // No schedule configured
                sleep(Duration::from_secs(300)).await;
            }
        }
    }

    /// Create a scheduled backup
    async fn create_scheduled_backup(&self, options: BackupOptions) -> Result<(), String> {
        let backup_id = Uuid::new_v4();
        let backup_name = format!("Scheduled Backup {}", Utc::now().format("%Y-%m-%d %H:%M:%S"));
        let backup_dir = std::path::PathBuf::from("/var/lib/iora/backups");
        let local_path = format!(
            "{}/backup_{}_{}.tar.gz",
            backup_dir.display(),
            backup_id,
            Utc::now().format("%Y%m%d_%H%M%S")
        );

        // Create backup record
        let content_manifest = serde_json::json!({
            "databases": options.include_databases,
            "docker_volumes": options.include_docker_volumes,
            "system_config": options.include_system_config,
            "user_data": options.include_user_data,
            "apps": options.include_apps,
        });

        let insert_result = sqlx::query!(
            r#"
            INSERT INTO backups (
                id, name, backup_type, created_at, size_bytes, local_path,
                remote_path, remote_backend, status, error_message,
                content_manifest, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            "#,
            backup_id,
            backup_name,
            "scheduled",
            Utc::now(),
            0i64,
            local_path,
            None::<String>,
            None::<String>,
            "creating",
            None::<String>,
            content_manifest,
            serde_json::json!({})
        )
        .execute(&self.db)
        .await;

        if let Err(e) = insert_result {
            error!("Failed to create backup record: {}", e);
            return Err(e.to_string());
        }

        // Create backup
        match self.backup_engine.create_backup(&backup_id, &local_path, options).await {
            Ok(size_bytes) => {
                info!("Scheduled backup {} completed: {} bytes", backup_id, size_bytes);

                // Update backup status
                let _ = sqlx::query!(
                    "UPDATE backups SET status = $1, size_bytes = $2 WHERE id = $3",
                    "completed",
                    size_bytes as i64,
                    backup_id
                )
                .execute(&self.db)
                .await;

                Ok(())
            }
            Err(e) => {
                error!("Scheduled backup {} failed: {}", backup_id, e);

                // Update backup status
                let _ = sqlx::query!(
                    "UPDATE backups SET status = $1, error_message = $2 WHERE id = $3",
                    "failed",
                    e.to_string(),
                    backup_id
                )
                .execute(&self.db)
                .await;

                Err(e.to_string())
            }
        }
    }

    /// Cleanup old backups based on retention policy
    async fn cleanup_old_backups(&self, retention_days: i32) -> Result<(), String> {
        info!("Cleaning up backups older than {} days", retention_days);

        // Calculate cutoff date
        let cutoff = Utc::now() - chrono::Duration::days(retention_days as i64);

        // Get old scheduled backups
        let old_backups = sqlx::query!(
            r#"
            SELECT id, local_path
            FROM backups
            WHERE backup_type = 'scheduled' AND created_at < $1
            "#,
            cutoff
        )
        .fetch_all(&self.db)
        .await
        .map_err(|e| e.to_string())?;

        for backup in old_backups {
            info!("Deleting old backup: {}", backup.id);

            // Delete local file
            if let Err(e) = tokio::fs::remove_file(&backup.local_path).await {
                warn!("Failed to delete backup file {}: {}", backup.local_path, e);
            }

            // Delete from database
            let _ = sqlx::query!("DELETE FROM backups WHERE id = $1", backup.id)
                .execute(&self.db)
                .await;
        }

        info!("Cleanup completed: {} backups removed", old_backups.len());
        Ok(())
    }

    /// Cleanup old pre-update backups based on retention count
    pub async fn cleanup_pre_update_backups(&self, retention_count: i32) -> Result<(), String> {
        info!("Cleaning up pre-update backups, keeping latest {}", retention_count);

        // Get pre-update backups, ordered by creation date (newest first)
        let backups = sqlx::query!(
            r#"
            SELECT id, local_path
            FROM backups
            WHERE backup_type = 'pre_update'
            ORDER BY created_at DESC
            "#
        )
        .fetch_all(&self.db)
        .await
        .map_err(|e| e.to_string())?;

        // Keep only the latest N backups
        for (index, backup) in backups.iter().enumerate() {
            if index >= retention_count as usize {
                info!("Deleting old pre-update backup: {}", backup.id);

                // Delete local file
                if let Err(e) = tokio::fs::remove_file(&backup.local_path).await {
                    warn!("Failed to delete backup file {}: {}", backup.local_path, e);
                }

                // Delete from database
                let _ = sqlx::query!("DELETE FROM backups WHERE id = $1", backup.id)
                    .execute(&self.db)
                    .await;
            }
        }

        Ok(())
    }
}
