use anyhow::{Context, Result};
use regex::Regex;
use sqlx::PgPool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::WalkDir;

use crate::tracker::{calculate_checksum, MigrationTracker};

pub struct MigrationRunner {
    pool: PgPool,
    tracker: MigrationTracker,
    migrations_dir: PathBuf,
    dry_run: bool,
}

#[derive(Debug, Clone)]
struct Migration {
    service: String,
    name: String,
    path: PathBuf,
    sql: String,
    checksum: String,
    number: u32,
}

impl MigrationRunner {
    pub async fn new(database_url: &str, migrations_dir: &Path, dry_run: bool) -> Result<Self> {
        let pool = PgPool::connect(database_url)
            .await
            .context("Failed to connect to database")?;

        let tracker = MigrationTracker::new(pool.clone()).await?;

        Ok(Self {
            pool,
            tracker,
            migrations_dir: migrations_dir.to_path_buf(),
            dry_run,
        })
    }

    pub async fn migrate_all(&self, target: Option<u32>) -> Result<()> {
        let migrations = self.discover_migrations()?;
        let mut services: Vec<String> = migrations.keys().cloned().collect();
        services.sort();

        for service in services {
            if let Err(e) = self.migrate_service(&service, target).await {
                tracing::error!("Failed to migrate {}: {}", service, e);
            }
        }

        Ok(())
    }

    pub async fn migrate_service(&self, service: &str, target: Option<u32>) -> Result<()> {
        tracing::info!("Migrating service: {}", service);

        let migrations = self.discover_migrations()?;
        let service_migrations = migrations
            .get(service)
            .context(format!("No migrations found for service: {}", service))?;

        let applied = self.tracker.get_applied_migrations(service).await?;
        let applied_names: Vec<String> = applied.iter().map(|m| m.migration.clone()).collect();

        let mut pending: Vec<&Migration> = service_migrations
            .iter()
            .filter(|m| !applied_names.contains(&m.name))
            .filter(|m| target.map_or(true, |t| m.number <= t))
            .collect();

        pending.sort_by_key(|m| m.number);

        if pending.is_empty() {
            println!("✓ {} - No pending migrations", service);
            return Ok(());
        }

        println!("\n{} - {} pending migration(s):", service, pending.len());

        for migration in pending {
            let start = Instant::now();

            if self.dry_run {
                println!("  [DRY RUN] {} - {}", migration.number, migration.name);
                continue;
            }

            print!("  Applying {} - {}... ", migration.number, migration.name);

            // Execute the migration
            match sqlx::query(&migration.sql).execute(&self.pool).await {
                Ok(_) => {
                    let elapsed = start.elapsed().as_millis() as i32;

                    // Extract rollback SQL if present
                    let rollback_sql = self.extract_rollback_sql(&migration.sql);

                    // Track the migration
                    self.tracker
                        .mark_applied(
                            service,
                            &migration.name,
                            &migration.checksum,
                            elapsed,
                            rollback_sql.as_deref(),
                        )
                        .await?;

                    println!("✓ ({}ms)", elapsed);
                }
                Err(e) => {
                    println!("✗");
                    tracing::error!("Migration failed: {}", e);
                    return Err(e.into());
                }
            }
        }

        println!();
        Ok(())
    }

    pub async fn rollback_service(&self, service: &str, steps: u32) -> Result<()> {
        tracing::info!("Rolling back {} migration(s) for: {}", steps, service);

        let applied = self.tracker.get_applied_migrations(service).await?;

        if applied.is_empty() {
            println!("No migrations to rollback for {}", service);
            return Ok(());
        }

        let to_rollback = applied
            .iter()
            .rev()
            .take(steps as usize)
            .collect::<Vec<_>>();

        println!("\n{} - Rolling back {} migration(s):", service, to_rollback.len());

        for migration in to_rollback {
            print!("  Rolling back {}... ", migration.migration);

            if self.dry_run {
                println!("[DRY RUN]");
                continue;
            }

            // Get rollback SQL
            let rollback_sql = self.tracker
                .get_rollback_sql(service, &migration.migration)
                .await?;

            match rollback_sql {
                Some(sql) => {
                    // Execute rollback
                    sqlx::query(&sql).execute(&self.pool).await?;

                    // Remove from tracker
                    self.tracker
                        .remove_migration(service, &migration.migration)
                        .await?;

                    println!("✓");
                }
                None => {
                    println!("✗ (no rollback SQL available)");
                    tracing::warn!("Migration {} has no rollback SQL", migration.migration);
                }
            }
        }

        println!();
        Ok(())
    }

    pub async fn print_status(&self, service: Option<&str>) -> Result<()> {
        let migrations = self.discover_migrations()?;

        if let Some(svc) = service {
            self.print_service_status(svc, &migrations).await?;
        } else {
            let mut services: Vec<String> = migrations.keys().cloned().collect();
            services.sort();

            println!("\n{:─<100}", "");
            println!("{:<20} {:<10} {:<10} {:<50}", "Service", "Applied", "Pending", "Latest Migration");
            println!("{:─<100}", "");

            for svc in services {
                let applied = self.tracker.get_applied_migrations(&svc).await?;
                let total = migrations.get(&svc).map(|m| m.len()).unwrap_or(0);
                let pending = total - applied.len();

                let latest = applied.last().map(|m| m.migration.clone()).unwrap_or_else(|| "-".to_string());

                println!(
                    "{:<20} {:<10} {:<10} {:<50}",
                    svc,
                    applied.len(),
                    pending,
                    if latest.len() > 50 {
                        format!("{}...", &latest[..47])
                    } else {
                        latest
                    }
                );
            }

            println!("{:─<100}\n", "");
        }

        Ok(())
    }

    async fn print_service_status(&self, service: &str, migrations: &HashMap<String, Vec<Migration>>) -> Result<()> {
        let applied = self.tracker.get_applied_migrations(service).await?;
        let all = migrations
            .get(service)
            .context(format!("No migrations found for service: {}", service))?;

        println!("\n{} - Migration Status:", service);
        println!("{:─<80}", "");

        for migration in all {
            let is_applied = applied.iter().any(|a| a.migration == migration.name);

            let status = if is_applied { "✓ Applied" } else { "  Pending" };

            println!(
                "{} {} - {}",
                status,
                migration.number,
                migration.name
            );
        }

        println!("{:─<80}\n", "");
        Ok(())
    }

    pub async fn mark_as_applied(&self, service: &str, migration: &str) -> Result<()> {
        let migrations = self.discover_migrations()?;
        let service_migrations = migrations
            .get(service)
            .context(format!("No migrations found for service: {}", service))?;

        let mig = service_migrations
            .iter()
            .find(|m| m.name == migration)
            .context(format!("Migration not found: {}", migration))?;

        self.tracker
            .mark_applied(service, &mig.name, &mig.checksum, 0, None)
            .await?;

        Ok(())
    }

    pub fn create_migration(&self, service: &str, name: &str) -> Result<PathBuf> {
        let service_dir = self.migrations_dir.join(service);
        std::fs::create_dir_all(&service_dir)?;

        // Find next migration number
        let existing = self.discover_migrations()?;
        let next_number = existing
            .get(service)
            .and_then(|migrations| migrations.iter().map(|m| m.number).max())
            .map(|n| n + 1)
            .unwrap_or(1);

        let filename = format!("{:03}_{}.sql", next_number, name);
        let filepath = service_dir.join(&filename);

        let template = format!(
            r#"-- Migration: {}
-- Service: {}
-- Created: {}

-- UP Migration
-- Add your SQL statements here


-- DOWN Migration (Rollback)
-- -- DOWN --
-- Add rollback SQL statements after this marker
-- Example:
-- DROP TABLE IF EXISTS example;
"#,
            name,
            service,
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
        );

        std::fs::write(&filepath, template)?;

        Ok(filepath)
    }

    pub async fn validate_all(&self) -> Result<()> {
        let migrations = self.discover_migrations()?;

        println!("\nValidating migrations...\n");

        let mut errors = Vec::new();

        for (service, service_migrations) in &migrations {
            let applied = self.tracker.get_applied_migrations(service).await?;

            for migration in service_migrations {
                if let Some(applied_mig) = applied.iter().find(|a| a.migration == migration.name) {
                    if applied_mig.checksum != migration.checksum {
                        errors.push(format!(
                            "{} / {} - Checksum mismatch! Applied: {}, Current: {}",
                            service, migration.name, applied_mig.checksum, migration.checksum
                        ));
                    }
                }
            }
        }

        if errors.is_empty() {
            println!("✓ All migrations validated successfully");
        } else {
            println!("✗ Validation errors:\n");
            for error in errors {
                println!("  {}", error);
            }
            anyhow::bail!("Migration validation failed");
        }

        Ok(())
    }

    pub async fn repair_checksums(&self) -> Result<()> {
        let migrations = self.discover_migrations()?;

        println!("\nRepairing migration checksums...\n");

        for (service, service_migrations) in &migrations {
            let applied = self.tracker.get_applied_migrations(service).await?;

            for migration in service_migrations {
                if let Some(applied_mig) = applied.iter().find(|a| a.migration == migration.name) {
                    if applied_mig.checksum != migration.checksum {
                        println!(
                            "  Updating {} / {} checksum",
                            service, migration.name
                        );

                        self.tracker
                            .update_checksum(service, &migration.name, &migration.checksum)
                            .await?;
                    }
                }
            }
        }

        println!("\n✓ Checksums repaired");
        Ok(())
    }

    fn discover_migrations(&self) -> Result<HashMap<String, Vec<Migration>>> {
        let mut migrations: HashMap<String, Vec<Migration>> = HashMap::new();

        let re_number = Regex::new(r"^(\d{3,})_").unwrap();

        for entry in WalkDir::new(&self.migrations_dir)
            .min_depth(2)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) != Some("sql") {
                continue;
            }

            let filename = path.file_name().unwrap().to_string_lossy();

            // Extract migration number
            let number = re_number
                .captures(&filename)
                .and_then(|caps| caps.get(1))
                .and_then(|m| m.as_str().parse::<u32>().ok())
                .unwrap_or(0);

            let service = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let name = filename.trim_end_matches(".sql").to_string();

            let sql = std::fs::read_to_string(path)
                .context(format!("Failed to read {}", path.display()))?;

            let checksum = calculate_checksum(&sql);

            migrations.entry(service.clone()).or_default().push(Migration {
                service,
                name,
                path: path.to_path_buf(),
                sql,
                checksum,
                number,
            });
        }

        // Sort migrations by number within each service
        for migrations in migrations.values_mut() {
            migrations.sort_by_key(|m| m.number);
        }

        Ok(migrations)
    }

    fn extract_rollback_sql(&self, sql: &str) -> Option<String> {
        // Look for -- DOWN -- marker
        if let Some(pos) = sql.find("-- -- DOWN --") {
            let rollback = &sql[pos + 13..];
            let rollback = rollback
                .lines()
                .filter(|line| !line.trim().starts_with("--") || line.trim() == "--")
                .collect::<Vec<_>>()
                .join("\n");

            if rollback.trim().is_empty() {
                None
            } else {
                Some(rollback)
            }
        } else {
            None
        }
    }
}
