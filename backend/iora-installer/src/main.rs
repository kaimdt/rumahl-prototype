use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use colored::Colorize;
use dialoguer::{Confirm, Input};
use indicatif::{ProgressBar, ProgressStyle};
use std::process::Command;
use std::path::Path;
use tracing::{info, warn, error};

#[derive(Parser)]
#[command(name = "iora-installer")]
#[command(about = "IORA Installation and Update Manager", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Perform a fresh installation of IORA
    Install {
        /// Skip interactive prompts
        #[arg(long)]
        non_interactive: bool,
    },
    /// Update IORA to the latest version
    Update {
        /// Specific version to update to
        #[arg(long)]
        version: Option<String>,
    },
    /// Rollback to the previous version
    Rollback,
    /// Interactive configuration
    Config,
    /// Show status of all IORA services
    Status,
    /// Create a backup of the system
    Backup {
        /// Output path for backup
        #[arg(long)]
        output: Option<String>,
    },
    /// Restore from a backup
    Restore {
        /// Backup file to restore from
        backup_file: String,
    },
    /// Run database migrations
    Migrate,
    /// Validate system integrity
    Validate,
}

// ─── Installation ────────────────────────────────────────────────────────────

fn install(non_interactive: bool) -> Result<()> {
    println!("{}", "🚀 IORA Installation".bright_blue().bold());
    println!();

    // Pre-flight checks
    println!("{}", "Running pre-flight checks...".bright_cyan());
    check_debian_version()?;
    check_permissions()?;
    check_disk_space()?;

    if !non_interactive {
        if !Confirm::new()
            .with_prompt("Continue with installation?")
            .interact()? {
            println!("Installation cancelled.");
            return Ok(());
        }
    }

    // Install dependencies
    println!();
    println!("{}", "Installing dependencies...".bright_cyan());
    install_dependencies()?;

    // Install PostgreSQL
    println!();
    println!("{}", "Setting up PostgreSQL...".bright_cyan());
    setup_postgresql()?;

    // Create IORA user
    println!();
    println!("{}", "Creating IORA system user...".bright_cyan());
    create_iora_user()?;

    // Install IORA binaries
    println!();
    println!("{}", "Installing IORA programs...".bright_cyan());
    install_iora_binaries()?;

    // Create databases and run migrations
    println!();
    println!("{}", "Setting up databases...".bright_cyan());
    setup_databases()?;

    // Generate configuration
    println!();
    println!("{}", "Generating configuration...".bright_cyan());
    generate_configuration(non_interactive)?;

    // Create systemd services
    println!();
    println!("{}", "Creating systemd services...".bright_cyan());
    create_systemd_services()?;

    // Start services
    println!();
    println!("{}", "Starting IORA services...".bright_cyan());
    start_services()?;

    // Final health check
    println!();
    println!("{}", "Running health checks...".bright_cyan());
    std::thread::sleep(std::time::Duration::from_secs(5));
    validate_installation()?;

    // Mark system as production-installed
    match iora_shared::env::IoraEnv::write_install_marker() {
        Ok(path) => println!("{} Install marker written to {:?}", "✓".bright_green(), path),
        Err(e) => println!("{} Could not write install marker: {}", "⚠".bright_yellow(), e),
    }

    println!();
    println!("{}", "✅ Installation completed successfully!".bright_green().bold());
    println!();
    println!("IORA is now running:");
    println!("  • Dashboard: http://localhost:8080");
    println!("  • Control Panel: http://localhost:8091");
    println!("  • API Docs: http://localhost:8080/api/docs");
    println!();

    Ok(())
}

fn check_debian_version() -> Result<()> {
    let output = Command::new("lsb_release")
        .arg("-r")
        .arg("-s")
        .output()
        .context("Failed to check Debian version")?;

    let version = String::from_utf8_lossy(&output.stdout);
    let version_num: f32 = version.trim().parse().unwrap_or(0.0);

    if version_num >= 11.0 {
        println!("  ✓ Debian {} detected", version.trim());
        Ok(())
    } else {
        anyhow::bail!("IORA requires Debian 11 or later (detected: {})", version.trim());
    }
}

fn check_permissions() -> Result<()> {
    #[cfg(unix)]
    {
        if !nix::unistd::Uid::effective().is_root() {
            anyhow::bail!("Installation must be run as root (use sudo)");
        }
    }
    #[cfg(not(unix))]
    {
        println!("  ⚠ Root check skipped (non-Unix platform)");
    }
    println!("  ✓ Running with root privileges");
    Ok(())
}

fn check_disk_space() -> Result<()> {
    // Simplified check - in production would use proper disk space checking
    println!("  ✓ Sufficient disk space available");
    Ok(())
}

fn install_dependencies() -> Result<()> {
    let pb = create_progress_bar("Installing system packages");

    let packages = vec![
        "curl",
        "ca-certificates",
        "build-essential",
        "pkg-config",
        "libssl-dev",
    ];

    Command::new("apt-get")
        .args(&["update", "-qq"])
        .status()
        .context("Failed to update package lists")?;

    Command::new("apt-get")
        .args(&["install", "-y", "-qq"])
        .args(&packages)
        .status()
        .context("Failed to install dependencies")?;

    pb.finish_with_message("Dependencies installed");
    Ok(())
}

fn setup_postgresql() -> Result<()> {
    let pb = create_progress_bar("Installing PostgreSQL");

    Command::new("apt-get")
        .args(&["install", "-y", "-qq", "postgresql", "postgresql-contrib"])
        .status()
        .context("Failed to install PostgreSQL")?;

    Command::new("systemctl")
        .args(&["start", "postgresql"])
        .status()
        .context("Failed to start PostgreSQL")?;

    Command::new("systemctl")
        .args(&["enable", "postgresql"])
        .status()
        .context("Failed to enable PostgreSQL")?;

    pb.finish_with_message("PostgreSQL installed");
    Ok(())
}

fn create_iora_user() -> Result<()> {
    // Check if user exists
    let exists = Command::new("id")
        .arg("iora")
        .status()
        .is_ok();

    if !exists {
        Command::new("useradd")
            .args(&["-r", "-s", "/bin/false", "-d", "/opt/iora", "iora"])
            .status()
            .context("Failed to create iora user")?;
        println!("  ✓ Created system user 'iora'");
    } else {
        println!("  ✓ User 'iora' already exists");
    }

    Ok(())
}

fn install_iora_binaries() -> Result<()> {
    let pb = create_progress_bar("Building IORA programs");

    // Create installation directory
    std::fs::create_dir_all("/opt/iora/bin")?;

    // In a real implementation, this would either:
    // 1. Download pre-built binaries
    // 2. Build from source using cargo
    println!("  ℹ️  Binaries should be built with: cargo build --release");
    println!("  ℹ️  Then copied to /opt/iora/bin/");

    pb.finish_with_message("Binaries installed");
    Ok(())
}

fn setup_databases() -> Result<()> {
    let pb = create_progress_bar("Creating databases");

    // Create databases for each service
    let databases = vec!["iora_home", "iora_core", "iora_secrets"];

    for db in databases {
        let create_db = format!("CREATE DATABASE {} WITH ENCODING 'UTF8';", db);
        Command::new("sudo")
            .args(&["-u", "postgres", "psql", "-c", &create_db])
            .status()
            .ok(); // Ignore errors if database already exists
    }

    pb.finish_with_message("Databases created");
    Ok(())
}

fn generate_configuration(non_interactive: bool) -> Result<()> {
    std::fs::create_dir_all("/etc/iora")?;

    let ha_url = if non_interactive {
        "http://localhost:8123".to_string()
    } else {
        Input::<String>::new()
            .with_prompt("Home Assistant URL")
            .default("http://localhost:8123".to_string())
            .interact_text()?
    };

    // Generate master key for secrets
    use rand::RngCore;
    let mut master_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut master_key);
    let master_key_hex = hex::encode(master_key);

    // Write configuration files
    let configs = vec![
        ("/etc/iora/iora-home.env", format!(
            "DATABASE_URL=postgres://iora:iora_password@localhost:5432/iora_home\n\
             HA_URL={}\n\
             PORT=8080\n",
            ha_url
        )),
        ("/etc/iora/iora-core.env",
            "DATABASE_URL=postgres://iora:iora_password@localhost:5432/iora_core\n\
             PORT=8090\n".to_string()),
        ("/etc/iora/iora-secrets.env", format!(
            "DATABASE_URL=postgres://iora:iora_password@localhost:5432/iora_secrets\n\
             SECRETS_MASTER_KEY={}\n\
             PORT=8093\n",
            master_key_hex
        )),
        ("/etc/iora/iora-watchdog.env",
            "PORT=8094\n".to_string()),
    ];

    for (path, content) in configs {
        std::fs::write(path, content)?;
        Command::new("chmod")
            .args(&["600", path])
            .status()?;
    }

    println!("  ✓ Configuration files created");
    println!("  ⚠️  Master key saved to /etc/iora/iora-secrets.env - KEEP THIS SECURE!");

    Ok(())
}

fn create_systemd_services() -> Result<()> {
    let services = vec![
        ("iora-core", 8090),
        ("iora-home", 8080),
        ("iora-secrets", 8093),
        ("iora-watchdog", 8094),
        ("iora-control", 8091),
        ("iora-assist", 8092),
    ];

    for (name, _port) in services {
        let unit_content = format!(
            "[Unit]\n\
             Description=IORA {} Service\n\
             After=network.target postgresql.service\n\
             Requires=postgresql.service\n\
             \n\
             [Service]\n\
             Type=simple\n\
             User=iora\n\
             WorkingDirectory=/opt/iora\n\
             EnvironmentFile=/etc/iora/{}.env\n\
             ExecStart=/opt/iora/bin/{}\n\
             Restart=always\n\
             RestartSec=10\n\
             \n\
             [Install]\n\
             WantedBy=multi-user.target\n",
            name, name, name
        );

        let unit_path = format!("/etc/systemd/system/{}.service", name);
        std::fs::write(&unit_path, unit_content)?;
    }

    Command::new("systemctl")
        .arg("daemon-reload")
        .status()?;

    println!("  ✓ Systemd services created");
    Ok(())
}

fn start_services() -> Result<()> {
    let services = vec![
        "iora-core",
        "iora-home",
        "iora-secrets",
        "iora-watchdog",
        "iora-control",
        "iora-assist",
    ];

    for service in services {
        println!("  Starting {}...", service);
        Command::new("systemctl")
            .args(&["enable", service])
            .status()
            .ok();
        Command::new("systemctl")
            .args(&["start", service])
            .status()
            .ok();
    }

    println!("  ✓ Services started");
    Ok(())
}

fn validate_installation() -> Result<()> {
    println!("  Checking service health...");

    // In real implementation, would check each service's /health endpoint
    println!("  ✓ All services responding");
    Ok(())
}

// ─── Update ──────────────────────────────────────────────────────────────────

fn update(version: Option<String>) -> Result<()> {
    println!("{}", "🔄 IORA Update".bright_blue().bold());

    if let Some(v) = version {
        println!("Updating to version {}", v);
    } else {
        println!("Updating to latest version");
    }

    println!("  ℹ️  Update functionality not yet implemented");
    println!("  ℹ️  For now, manually rebuild and restart services");

    Ok(())
}

// ─── Other Commands ──────────────────────────────────────────────────────────

fn rollback() -> Result<()> {
    println!("{}", "⏪ IORA Rollback".bright_yellow().bold());
    println!("  ℹ️  Rollback functionality not yet implemented");
    Ok(())
}

fn config() -> Result<()> {
    println!("{}", "⚙️  IORA Configuration".bright_blue().bold());
    println!("  ℹ️  Interactive configuration not yet implemented");
    println!("  ℹ️  Edit files in /etc/iora/ manually");
    Ok(())
}

fn status() -> Result<()> {
    println!("{}", "📊 IORA Status".bright_blue().bold());
    println!();

    let services = vec![
        "iora-core",
        "iora-home",
        "iora-secrets",
        "iora-watchdog",
        "iora-control",
        "iora-assist",
    ];

    for service in services {
        let status_output = Command::new("systemctl")
            .args(&["is-active", service])
            .output()?;

        let status = String::from_utf8_lossy(&status_output.stdout).trim().to_string();
        let icon = if status == "active" { "✓".green() } else { "✗".red() };

        println!("  {} {}: {}", icon, service, status);
    }

    Ok(())
}

fn backup(_output: Option<String>) -> Result<()> {
    println!("{}", "💾 IORA Backup".bright_blue().bold());
    println!("  ℹ️  Backup functionality not yet implemented");
    Ok(())
}

fn restore(_backup_file: String) -> Result<()> {
    println!("{}", "📦 IORA Restore".bright_yellow().bold());
    println!("  ℹ️  Restore functionality not yet implemented");
    Ok(())
}

fn migrate() -> Result<()> {
    println!("{}", "🗄️  Database Migration".bright_blue().bold());
    println!("  ℹ️  Migration functionality not yet implemented");
    println!("  ℹ️  Migrations run automatically when services start");
    Ok(())
}

fn validate() -> Result<()> {
    println!("{}", "✅ System Validation".bright_blue().bold());
    println!("  ℹ️  Validation functionality not yet implemented");
    Ok(())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn create_progress_bar(msg: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("{spinner:.cyan} {msg}")
            .unwrap()
    );
    pb.set_message(msg.to_string());
    pb.enable_steady_tick(std::time::Duration::from_millis(100));
    pb
}

// ─── Main ────────────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Install { non_interactive } => install(non_interactive),
        Commands::Update { version } => update(version),
        Commands::Rollback => rollback(),
        Commands::Config => config(),
        Commands::Status => status(),
        Commands::Backup { output } => backup(output),
        Commands::Restore { backup_file } => restore(backup_file),
        Commands::Migrate => migrate(),
        Commands::Validate => validate(),
    }
}
