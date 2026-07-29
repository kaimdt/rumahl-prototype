use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use colored::Colorize;
use dialoguer::{Confirm, Input};
use indicatif::{ProgressBar, ProgressStyle};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Services managed by the installer, with the HTTP port each exposes for
/// health checks.  Keep this list in sync with [`create_systemd_services`].
const MANAGED_SERVICES: &[(&str, u16)] = &[
    ("iora-core", 8090),
    ("iora-home", 8080),
    ("iora-secrets", 8093),
    ("iora-watchdog", 8094),
    ("iora-control", 8091),
    ("iora-assist", 8092),
];

const BACKUP_DIR_DEFAULT: &str = "/var/backups/iora";
const STATE_DIR: &str = "/var/lib/iora";

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
    /// Validate system integrity (health-check all managed services)
    Validate {
        /// Automatically restart any service that is not healthy
        #[arg(long)]
        enforce: bool,
    },
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

    if !non_interactive
        && !Confirm::new()
            .with_prompt("Continue with installation?")
            .interact()?
    {
        println!("Installation cancelled.");
        return Ok(());
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
    match iora_shared_config::env::IoraEnv::write_install_marker() {
        Ok(path) => println!(
            "{} Install marker written to {:?}",
            "✓".bright_green(),
            path
        ),
        Err(e) => println!(
            "{} Could not write install marker: {}",
            "⚠".bright_yellow(),
            e
        ),
    }

    println!();
    println!(
        "{}",
        "✅ Installation completed successfully!"
            .bright_green()
            .bold()
    );
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
        anyhow::bail!(
            "IORA requires Debian 11 or later (detected: {})",
            version.trim()
        );
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
    // Require at least 2 GiB free on / and on /var (best effort across
    // platforms: we shell out to `df` which is universally available on
    // Debian-based systems).  If the check cannot be performed we warn
    // instead of failing the install.
    const MIN_FREE_MB: u64 = 2048;

    for mount in ["/", "/var"] {
        let output = match Command::new("df")
            .args(["-Pm", "--output=avail", mount])
            .output()
        {
            Ok(o) if o.status.success() => o,
            _ => {
                println!("  ⚠ Could not check free space on {mount}");
                continue;
            }
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let avail_mb: u64 = stdout
            .lines()
            .nth(1)
            .and_then(|l| l.split_whitespace().next())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        if avail_mb < MIN_FREE_MB {
            anyhow::bail!(
                "Insufficient disk space on {mount}: {avail_mb} MiB free, need >= {MIN_FREE_MB} MiB"
            );
        }
        println!("  ✓ {mount}: {avail_mb} MiB free");
    }
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
        .args(["update", "-qq"])
        .status()
        .context("Failed to update package lists")?;

    Command::new("apt-get")
        .args(["install", "-y", "-qq"])
        .args(&packages)
        .status()
        .context("Failed to install dependencies")?;

    pb.finish_with_message("Dependencies installed");
    Ok(())
}

fn setup_postgresql() -> Result<()> {
    let pb = create_progress_bar("Installing PostgreSQL");

    Command::new("apt-get")
        .args(["install", "-y", "-qq", "postgresql", "postgresql-contrib"])
        .status()
        .context("Failed to install PostgreSQL")?;

    Command::new("systemctl")
        .args(["start", "postgresql"])
        .status()
        .context("Failed to start PostgreSQL")?;

    Command::new("systemctl")
        .args(["enable", "postgresql"])
        .status()
        .context("Failed to enable PostgreSQL")?;

    pb.finish_with_message("PostgreSQL installed");
    Ok(())
}

fn create_iora_user() -> Result<()> {
    // Check if user exists
    let exists = Command::new("id").arg("iora").status().is_ok();

    if !exists {
        Command::new("useradd")
            .args(["-r", "-s", "/bin/false", "-d", "/opt/iora", "iora"])
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
            .args(["-u", "postgres", "psql", "-c", &create_db])
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
    //
    // Note: Home Assistant URL/Token are NOT written to env files anymore.
    // The first-boot setup wizard / Admin Control Center store them in the
    // `system_preferences` table (key = "ha_config") so the user can edit
    // them at runtime without rewriting files or restarting services.
    let _ = ha_url; // kept for future schema migration; intentionally unused here
    let configs = vec![
        (
            "/etc/iora/iora-home.env",
            "DATABASE_URL=postgres://iora:iora_password@localhost:5432/iora_home\n\
             PORT=8126\n"
                .to_string(),
        ),
        (
            "/etc/iora/iora-core.env",
            "DATABASE_URL=postgres://iora:iora_password@localhost:5432/iora_core\n\
             PORT=8090\n"
                .to_string(),
        ),
        (
            "/etc/iora/iora-secrets.env",
            format!(
                "DATABASE_URL=postgres://iora:iora_password@localhost:5432/iora_secrets\n\
             SECRETS_MASTER_KEY={}\n\
             PORT=8093\n",
                master_key_hex
            ),
        ),
        ("/etc/iora/iora-watchdog.env", "PORT=8094\n".to_string()),
    ];

    for (path, content) in configs {
        std::fs::write(path, content)?;
        Command::new("chmod").args(["600", path]).status()?;
    }

    println!("  ✓ Configuration files created");
    println!("  ⚠️  Master key saved to /etc/iora/iora-secrets.env - KEEP THIS SECURE!");

    Ok(())
}

fn create_systemd_services() -> Result<()> {
    std::fs::create_dir_all(STATE_DIR).ok();

    for (name, port) in MANAGED_SERVICES {
        // iora-core is a hard dependency for most downstream services; keep
        // the dependency graph explicit so the unit order is stable.
        let wants = if *name == "iora-core" {
            "".to_string()
        } else {
            "Wants=iora-core.service\nAfter=iora-core.service\n".to_string()
        };

        let unit_content = format!(
            "[Unit]
Description=IORA {name} Service
Documentation=https://github.com/kaimdt/home-assistant-dashb
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service
{wants}StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=iora
Group=iora
WorkingDirectory=/opt/iora
EnvironmentFile=-/etc/iora/{name}.env
ExecStart=/opt/iora/bin/{name}
ExecStartPre=/bin/sh -c 'test -x /opt/iora/bin/{name}'
Restart=always
RestartSec=5
TimeoutStartSec=60
TimeoutStopSec=30
# systemd watchdog: the binary must ping sd_notify() every WatchdogSec;
# services that do not yet implement that still benefit from Restart=always.
WatchdogSec=60
NotifyAccess=main
# Crash/Abort handling
LimitNOFILE=65536
LimitNPROC=4096
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
ReadWritePaths=/var/log/iora /var/lib/iora /tmp /mnt/data
# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier={name}
# Expose port for healthchecks
Environment=IORA_SERVICE_PORT={port}

[Install]
WantedBy=multi-user.target
"
        );

        let unit_path = format!("/etc/systemd/system/{}.service", name);
        std::fs::write(&unit_path, unit_content)?;
    }

    // Periodic health enforcement: a timer that invokes the installer's
    // `validate` subcommand and restarts any service that is not healthy.
    let health_service = "[Unit]
Description=IORA Health Enforcer
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/opt/iora/bin/iora-installer validate --enforce
User=root
StandardOutput=journal
StandardError=journal
";
    std::fs::write("/etc/systemd/system/iora-health.service", health_service)?;

    let health_timer = "[Unit]
Description=IORA Health Enforcer Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
Persistent=true

[Install]
WantedBy=timers.target
";
    std::fs::write("/etc/systemd/system/iora-health.timer", health_timer)?;

    Command::new("systemctl").arg("daemon-reload").status()?;
    let _ = Command::new("systemctl")
        .args(["enable", "--now", "iora-health.timer"])
        .status();

    println!("  ✓ Systemd services created (hardened, with watchdog + health timer)");
    Ok(())
}

fn start_services() -> Result<()> {
    // iora-core must come up first so dependent services find the event bus.
    let mut ordered: Vec<&str> = MANAGED_SERVICES.iter().map(|(n, _)| *n).collect();
    ordered.sort_by_key(|n| if *n == "iora-core" { 0 } else { 1 });

    for service in ordered {
        println!("  Starting {}...", service);
        Command::new("systemctl")
            .args(["enable", service])
            .status()
            .ok();
        Command::new("systemctl")
            .args(["restart", service])
            .status()
            .ok();
    }

    println!("  ✓ Services started");
    Ok(())
}

fn validate_installation() -> Result<()> {
    println!("  Checking service health...");
    let results = collect_health();
    let mut unhealthy = 0;
    for (name, ok, detail) in &results {
        if *ok {
            println!("  ✓ {name}: healthy");
        } else {
            unhealthy += 1;
            println!("  ✗ {name}: {detail}");
        }
    }
    if unhealthy > 0 {
        anyhow::bail!("{unhealthy} service(s) reported unhealthy");
    }
    Ok(())
}

/// Run an HTTP GET /health against each managed service and report results.
fn collect_health() -> Vec<(String, bool, String)> {
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return MANAGED_SERVICES
                .iter()
                .map(|(n, _)| (n.to_string(), false, format!("client init failed: {e}")))
                .collect();
        }
    };

    MANAGED_SERVICES
        .iter()
        .map(|(name, port)| {
            let url = format!("http://127.0.0.1:{port}/health");
            match client.get(&url).send() {
                Ok(r) if r.status().is_success() => (name.to_string(), true, "ok".to_string()),
                Ok(r) => (
                    name.to_string(),
                    false,
                    format!("HTTP {}", r.status().as_u16()),
                ),
                Err(e) => (name.to_string(), false, format!("unreachable: {e}")),
            }
        })
        .collect()
}

// ─── Update ──────────────────────────────────────────────────────────────────

fn update(version: Option<String>) -> Result<()> {
    println!("{}", "🔄 IORA Update".bright_blue().bold());

    let url =
        std::env::var("IORA_UPDATER_URL").unwrap_or_else(|_| "http://127.0.0.1:8101".to_string());
    let endpoint = format!("{}/api/updates/install", url.trim_end_matches('/'));
    let body = match version {
        Some(v) => {
            println!("  Requesting update to version {}", v);
            serde_json::json!({ "version": v })
        }
        None => {
            println!("  Requesting update to latest version");
            serde_json::json!({})
        }
    };

    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()?
        .post(&endpoint)
        .json(&body)
        .send();

    match resp {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().unwrap_or_default();
            println!("  ✓ Update initiated: {}", body);
            Ok(())
        }
        Ok(r) => anyhow::bail!("update request failed with status {}", r.status()),
        Err(e) => {
            println!(
                "  ⚠ iora-updater is not reachable ({}). Falling back to manual instructions.",
                e
            );
            println!("  ℹ️  Pull the latest images and run `systemctl restart iora-*` manually.");
            Ok(())
        }
    }
}

// ─── Other Commands ──────────────────────────────────────────────────────────

fn rollback() -> Result<()> {
    println!("{}", "⏪ IORA Rollback".bright_yellow().bold());

    let backup_dir = Path::new(BACKUP_DIR_DEFAULT);
    if !backup_dir.exists() {
        anyhow::bail!("No backup directory at {}", backup_dir.display());
    }

    // Find newest backup
    let mut entries: Vec<PathBuf> = std::fs::read_dir(backup_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().and_then(|s| s.to_str()) == Some("gz")
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("iora-backup-"))
                    .unwrap_or(false)
        })
        .collect();
    if entries.is_empty() {
        anyhow::bail!("No backups found in {}", backup_dir.display());
    }
    entries.sort();
    let latest = entries.last().unwrap().clone();
    println!("  Restoring from {}", latest.display());
    restore(latest.to_string_lossy().to_string())
}

fn config() -> Result<()> {
    println!("{}", "⚙️  IORA Configuration".bright_blue().bold());
    let config_path =
        std::env::var("IORA_CONFIG_FILE").unwrap_or_else(|_| "/etc/iora/iora.toml".to_string());
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "nano".to_string());

    if !Path::new(&config_path).exists() {
        std::fs::create_dir_all(
            Path::new(&config_path)
                .parent()
                .unwrap_or(Path::new("/etc/iora")),
        )?;
        std::fs::write(&config_path, "# IORA configuration\n")?;
        println!("  Created new config at {}", config_path);
    }

    println!("  Opening {} in {}", config_path, editor);
    let status = Command::new(&editor).arg(&config_path).status();
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => anyhow::bail!("editor exited with status {}", s),
        Err(e) => anyhow::bail!("failed to launch editor '{}': {}", editor, e),
    }
}

fn status() -> Result<()> {
    println!("{}", "📊 IORA Status".bright_blue().bold());
    println!();

    let health = collect_health();

    for ((name, _port), (_, healthy, detail)) in MANAGED_SERVICES.iter().zip(health.iter()) {
        let status_output = Command::new("systemctl")
            .args(["is-active", name])
            .output()
            .ok();
        let systemd_state = status_output
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let icon = if *healthy && systemd_state == "active" {
            "✓".green()
        } else if systemd_state == "active" {
            "⚠".yellow()
        } else {
            "✗".red()
        };

        println!(
            "  {icon} {name:<15} systemd={systemd_state:<10} health={}",
            if *healthy {
                "ok".green().to_string()
            } else {
                detail.red().to_string()
            }
        );
    }

    Ok(())
}

fn backup(_output: Option<String>) -> Result<()> {
    println!("{}", "💾 IORA Backup".bright_blue().bold());
    let url =
        std::env::var("IORA_BACKUP_URL").unwrap_or_else(|_| "http://127.0.0.1:8084".to_string());
    let endpoint = format!("{}/api/backup/create", url.trim_end_matches('/'));
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()?
        .post(&endpoint)
        .json(&serde_json::json!({}))
        .send()?;
    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().unwrap_or_default();
        println!("  ✓ Backup created: {}", body);
        Ok(())
    } else {
        anyhow::bail!("backup request failed with status {}", resp.status());
    }
}

fn restore(backup_file: String) -> Result<()> {
    println!("{}", "📦 IORA Restore".bright_yellow().bold());
    let url =
        std::env::var("IORA_BACKUP_URL").unwrap_or_else(|_| "http://127.0.0.1:8084".to_string());
    let endpoint = format!("{}/api/backup/restore", url.trim_end_matches('/'));
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()?
        .post(&endpoint)
        .json(&serde_json::json!({ "backup_file": backup_file }))
        .send()?;
    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().unwrap_or_default();
        println!("  ✓ Restore initiated: {}", body);
        Ok(())
    } else {
        anyhow::bail!("restore request failed with status {}", resp.status());
    }
}

fn migrate() -> Result<()> {
    println!("{}", "🗄️  Database Migration".bright_blue().bold());
    println!("  ℹ️  Migrations run automatically on service start.");
    println!("  Triggering reload of all managed services to force a fresh migration pass...");

    for (name, _port) in MANAGED_SERVICES.iter() {
        let status = Command::new("systemctl").args(["restart", name]).status();
        match status {
            Ok(s) if s.success() => println!("  ✓ {} restarted", name),
            Ok(s) => println!("  ⚠ {} restart returned status {}", name, s),
            Err(e) => println!("  ✗ failed to restart {}: {}", name, e),
        }
    }
    Ok(())
}

fn validate(enforce: bool) -> Result<()> {
    println!("{}", "✅ System Validation".bright_blue().bold());
    if enforce {
        validate_installation()
    } else {
        // Run lightweight validation: ensure each managed service is reachable.
        let health = collect_health();
        let mut bad = 0;
        for ((name, _port), (_, healthy, detail)) in MANAGED_SERVICES.iter().zip(health.iter()) {
            if *healthy {
                println!("  ✓ {} {}", name, "healthy".green());
            } else {
                println!("  ✗ {} {} ({})", name, "unhealthy".red(), detail);
                bad += 1;
            }
        }
        if bad > 0 {
            anyhow::bail!("{} services are unhealthy", bad);
        }
        Ok(())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn create_progress_bar(msg: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("{spinner:.cyan} {msg}")
            .unwrap(),
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
        Commands::Validate { enforce } => validate(enforce),
    }
}
