//! Cron-based backup scheduler.
//!
//! Reads the `backup_config` row, parses the cron expression, and runs the
//! `BackupEngine` whenever the schedule fires. Also enforces retention
//! (delete old backups older than `schedule_retention_days`).

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use cron::Schedule;
use sqlx::PgPool;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::backup_engine::{BackupEngine, BackupOptions};
use crate::db;

#[derive(Clone)]
pub struct BackupScheduler {
    pub db: PgPool,
    pub engine: Arc<BackupEngine>,
    /// Last time a scheduled backup ran, exposed via /api/backup/scheduler/status.
    pub last_run: Arc<RwLock<Option<chrono::DateTime<Utc>>>>,
    pub last_error: Arc<RwLock<Option<String>>>,
}

impl BackupScheduler {
    pub fn new(db: PgPool, engine: Arc<BackupEngine>) -> Self {
        Self {
            db,
            engine,
            last_run: Arc::new(RwLock::new(None)),
            last_error: Arc::new(RwLock::new(None)),
        }
    }

    /// Spawn the scheduler loop. Polls the config table every minute,
    /// and runs the backup when the next cron tick has been reached.
    pub fn spawn(self) {
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                if let Err(e) = self.tick_once().await {
                    warn!("scheduler tick failed: {e}");
                    *self.last_error.write().await = Some(e.to_string());
                }
            }
        });
    }

    async fn tick_once(&self) -> anyhow::Result<()> {
        let cfg = match db::load_config(&self.db).await? {
            Some(c) => c,
            None => return Ok(()),
        };
        if !cfg.enabled || !cfg.schedule_enabled {
            return Ok(());
        }
        let cron_expr = match cfg.schedule_cron.as_deref() {
            Some(s) if !s.is_empty() => s,
            _ => return Ok(()),
        };
        let schedule = Schedule::from_str(cron_expr)
            .map_err(|e| anyhow::anyhow!("invalid cron '{cron_expr}': {e}"))?;

        // Determine if we need to run: find the most recent past tick that
        // is more recent than `last_run`.
        let now = Utc::now();
        let last_run = *self.last_run.read().await;
        let mut should_run = false;
        for event in schedule.upcoming(Utc).take(0).chain(
            schedule
                .after(&(now - chrono::Duration::minutes(2)))
                .take(1),
        ) {
            if event <= now && Some(event) > last_run {
                should_run = true;
                break;
            }
        }
        if !should_run {
            return Ok(());
        }

        let options = BackupOptions {
            include_databases: cfg.include_databases,
            include_docker_volumes: cfg.include_docker_volumes,
            include_system_config: cfg.include_system_config,
            include_user_data: cfg.include_user_data,
            include_apps: cfg.include_apps,
            backup_dir: None,
        };
        let engine = self.engine.clone();
        let name = format!("scheduled-{}", now.format("%Y%m%d-%H%M%S"));
        let res =
            tokio::task::spawn_blocking(move || engine.create_backup(&name, &options)).await?;
        match res {
            Ok(b) => {
                info!("scheduled backup created: {}", b.name);
                db::insert_backup(&self.db, &b, "scheduled", "completed", None).await?;
                *self.last_run.write().await = Some(now);
                *self.last_error.write().await = None;
            }
            Err(e) => {
                error!("scheduled backup failed: {e}");
                *self.last_error.write().await = Some(e.to_string());
            }
        }

        // Retention: delete archives older than retention_days.
        let cutoff = now - chrono::Duration::days(cfg.schedule_retention_days as i64);
        if let Err(e) = db::prune_backups_older_than(&self.db, cutoff, &self.engine).await {
            warn!("retention pruning failed: {e}");
        }

        Ok(())
    }
}
