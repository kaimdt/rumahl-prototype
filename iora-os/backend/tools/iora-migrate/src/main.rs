use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod runner;
mod tracker;

use runner::MigrationRunner;

#[derive(Parser)]
#[command(name = "iora-migrate")]
#[command(about = "IORA Database Migration Tool - Run and track migrations across all services")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Migrations directory (default: /opt/iora/migrations or ./migrations)
    #[arg(long)]
    migrations_dir: Option<PathBuf>,

    /// Database connection URL
    #[arg(long, env = "DATABASE_URL")]
    database_url: Option<String>,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    /// Dry run - show what would be executed without applying
    #[arg(long)]
    dry_run: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Run all pending migrations
    Up {
        /// Specific service to migrate (default: all)
        #[arg(long)]
        service: Option<String>,

        /// Target migration number (default: latest)
        #[arg(long)]
        target: Option<u32>,
    },

    /// Rollback last migration
    Down {
        /// Service to rollback
        service: String,

        /// Number of migrations to rollback
        #[arg(long, default_value = "1")]
        steps: u32,
    },

    /// Show migration status
    Status {
        /// Specific service (default: all)
        service: Option<String>,
    },

    /// Mark a migration as applied without running it
    Mark {
        /// Service name
        service: String,

        /// Migration name
        migration: String,
    },

    /// Create a new migration file
    Create {
        /// Service name
        service: String,

        /// Migration name (e.g., "add_user_table")
        name: String,
    },

    /// Validate all migrations (checksum verification)
    Validate,

    /// Repair migration tracking (force checksums to match)
    Repair {
        /// Skip confirmation
        #[arg(long)]
        yes: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Setup logging
    let log_level = if cli.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(log_level)
        .init();

    // Determine migrations directory
    let migrations_dir = cli.migrations_dir
        .or_else(|| std::env::var("IORA_MIGRATIONS_DIR").ok().map(PathBuf::from))
        .unwrap_or_else(|| {
            if std::path::Path::new("/opt/iora/migrations").exists() {
                PathBuf::from("/opt/iora/migrations")
            } else {
                PathBuf::from("./migrations")
            }
        });

    if !migrations_dir.exists() {
        anyhow::bail!("Migrations directory not found: {}", migrations_dir.display());
    }

    tracing::info!("Migrations directory: {}", migrations_dir.display());

    // Get database URL - try service-specific credentials first
    let database_url = cli.database_url
        .or_else(|| load_service_db_url())
        .or_else(|| std::env::var("POSTGRES_ADMIN_URL").ok())
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .context("No database URL provided. Set DATABASE_URL or POSTGRES_ADMIN_URL")?;

    let runner = MigrationRunner::new(&database_url, &migrations_dir, cli.dry_run).await?;

    match cli.command {
        Commands::Up { service, target } => {
            if let Some(svc) = service {
                runner.migrate_service(&svc, target).await?;
            } else {
                runner.migrate_all(target).await?;
            }
        }

        Commands::Down { service, steps } => {
            runner.rollback_service(&service, steps).await?;
        }

        Commands::Status { service } => {
            runner.print_status(service.as_deref()).await?;
        }

        Commands::Mark { service, migration } => {
            runner.mark_as_applied(&service, &migration).await?;
            println!("✓ Marked {} / {} as applied", service, migration);
        }

        Commands::Create { service, name } => {
            let file = runner.create_migration(&service, &name)?;
            println!("✓ Created migration: {}", file.display());
        }

        Commands::Validate => {
            runner.validate_all().await?;
            println!("✓ All migrations validated successfully");
        }

        Commands::Repair { yes } => {
            if !yes {
                print!("Are you sure you want to repair migration checksums? [y/N]: ");
                use std::io::{self, BufRead};
                let stdin = io::stdin();
                let line = stdin.lock().lines().next().unwrap_or(Ok(String::new()))?;
                if line.trim().to_lowercase() != "y" {
                    println!("Aborted.");
                    return Ok(());
                }
            }
            runner.repair_checksums().await?;
            println!("✓ Migration checksums repaired");
        }
    }

    Ok(())
}

fn load_service_db_url() -> Option<String> {
    // Try to load from /etc/iora/db-credentials/{current-service}.env
    if let Ok(exe) = std::env::current_exe() {
        if let Some(name) = exe.file_stem() {
            let service_name = name.to_string_lossy();
            if let Some(service) = service_name.strip_prefix("iora-") {
                let cred_file = format!("/etc/iora/db-credentials/iora-{}.env", service);
                if let Ok(content) = std::fs::read_to_string(&cred_file) {
                    for line in content.lines() {
                        if let Some(url) = line.strip_prefix("DATABASE_URL=") {
                            return Some(url.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}
