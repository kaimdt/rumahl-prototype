use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod config;
mod manager;
mod rotation;
mod user_manager;

use manager::DatabaseManager;

#[derive(Parser)]
#[command(name = "iora-db-manager")]
#[command(about = "IORA PostgreSQL Database Manager - User creation, rotation, and security")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// PostgreSQL admin connection URL (default: from env POSTGRES_ADMIN_URL)
    #[arg(long, env = "POSTGRES_ADMIN_URL")]
    admin_url: Option<String>,

    /// Configuration file path
    #[arg(long, default_value = "/etc/iora/db-config.toml")]
    config: PathBuf,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize all service databases and users
    Init {
        /// Force re-creation even if databases exist
        #[arg(long)]
        force: bool,
    },

    /// Rotate passwords for all service users
    Rotate {
        /// Specific service to rotate (default: all)
        #[arg(long)]
        service: Option<String>,

        /// Notify services to reload configuration
        #[arg(long, default_value = "true")]
        notify: bool,
    },

    /// Show status of all databases and users
    Status,

    /// Create a new service database and user
    Create {
        /// Service name
        service: String,

        /// Database name (default: iora_{service})
        #[arg(long)]
        database: Option<String>,

        /// Connection limit for the user
        #[arg(long, default_value = "20")]
        conn_limit: i32,
    },

    /// Drop a service database and user
    Drop {
        /// Service name
        service: String,

        /// Skip confirmation
        #[arg(long)]
        yes: bool,
    },

    /// Export connection strings for all services
    Export {
        /// Output format (env, json, systemd)
        #[arg(long, default_value = "env")]
        format: String,

        /// Output file (default: stdout)
        #[arg(long)]
        output: Option<PathBuf>,
    },

    /// Backup all databases
    Backup {
        /// Backup directory
        #[arg(long, default_value = "/var/backups/iora-db")]
        dir: PathBuf,
    },

    /// Check password rotation schedule
    Check,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Setup logging
    let log_level = if cli.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt().with_env_filter(log_level).init();

    // Get admin URL
    let admin_url = cli
        .admin_url
        .or_else(|| std::env::var("POSTGRES_ADMIN_URL").ok())
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .unwrap_or_else(|| "postgres://postgres:postgres@localhost:5432/postgres".to_string());

    tracing::info!("Connecting to PostgreSQL as admin...");

    let manager = DatabaseManager::new(&admin_url, &cli.config)
        .await
        .context("Failed to initialize database manager")?;

    match cli.command {
        Commands::Init { force } => {
            manager.initialize_all(force).await?;
            println!("✓ All service databases and users initialized");
        }

        Commands::Rotate { service, notify } => {
            if let Some(svc) = service {
                manager.rotate_service_password(&svc, notify).await?;
                println!("✓ Password rotated for service: {}", svc);
            } else {
                let count = manager.rotate_all_passwords(notify).await?;
                println!("✓ Rotated passwords for {} services", count);
            }
        }

        Commands::Status => {
            manager.print_status().await?;
        }

        Commands::Create {
            service,
            database,
            conn_limit,
        } => {
            let db_name = database.unwrap_or_else(|| format!("iora_{}", service));
            manager
                .create_service(&service, &db_name, conn_limit)
                .await?;
            println!("✓ Created database '{}' for service '{}'", db_name, service);
        }

        Commands::Drop { service, yes } => {
            if !yes {
                print!(
                    "Are you sure you want to drop database and user for '{}'? [y/N]: ",
                    service
                );
                use std::io::{self, BufRead};
                let stdin = io::stdin();
                let line = stdin.lock().lines().next().unwrap_or(Ok(String::new()))?;
                if line.trim().to_lowercase() != "y" {
                    println!("Aborted.");
                    return Ok(());
                }
            }
            manager.drop_service(&service).await?;
            println!("✓ Dropped database and user for service '{}'", service);
        }

        Commands::Export { format, output } => {
            let content = manager.export_connection_strings(&format).await?;
            if let Some(path) = output {
                std::fs::write(&path, content).context("Failed to write output file")?;
                println!("✓ Exported to {}", path.display());
            } else {
                println!("{}", content);
            }
        }

        Commands::Backup { dir } => {
            std::fs::create_dir_all(&dir)?;
            let files = manager.backup_all_databases(&dir).await?;
            println!("✓ Backed up {} databases to {}", files.len(), dir.display());
            for file in files {
                println!("  - {}", file);
            }
        }

        Commands::Check => {
            manager.check_rotation_schedule().await?;
        }
    }

    Ok(())
}
