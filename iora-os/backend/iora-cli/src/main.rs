use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use colored::Colorize;
use serde_json::Value;
use std::process::Command as StdCommand;
use tabled::{Table, Tabled};

/// ORA CLI - Command-line interface for controlling IORA OS and services
#[derive(Parser)]
#[command(name = "ora")]
#[command(about = "ORA - IORA Command-Line Interface (short form)", long_about = None)]
#[command(version)]
struct Cli {
    /// Base URL for IORA services
    #[arg(long, env = "IORA_URL", default_value = "http://localhost")]
    url: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// System management
    #[command(subcommand)]
    System(SystemCommands),

    /// Service management
    #[command(subcommand)]
    Service(ServiceCommands),

    /// App management (Docker containers)
    #[command(subcommand)]
    App(AppCommands),

    /// Plugin management (code extensions)
    #[command(subcommand)]
    Plugin(PluginCommands),

    /// View logs
    #[command(subcommand)]
    Logs(LogsCommands),

    /// Security and secrets
    #[command(subcommand)]
    Security(SecurityCommands),

    /// Show system status
    Status {
        /// Show detailed status
        #[arg(short, long)]
        verbose: bool,
    },

    /// Update IORA OS
    Update {
        /// Check for updates without installing
        #[arg(short, long)]
        check: bool,
    },
}

#[derive(Subcommand)]
enum SystemCommands {
    /// Show system information
    Info,
    /// Show system resources (CPU, RAM, disk)
    Resources,
    /// Reboot the system
    Reboot {
        /// Skip confirmation
        #[arg(short, long)]
        force: bool,
    },
    /// Shutdown the system
    Shutdown {
        /// Skip confirmation
        #[arg(short, long)]
        force: bool,
    },
    /// Show OS version
    Version,
}

#[derive(Subcommand)]
enum ServiceCommands {
    /// List all services
    List,
    /// Start a service
    Start { name: String },
    /// Stop a service
    Stop { name: String },
    /// Restart a service
    Restart { name: String },
    /// Show service status
    Status { name: String },
    /// Show service logs
    Logs {
        name: String,
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: usize,
    },
}

#[derive(Subcommand)]
enum AppCommands {
    /// List all apps (containers)
    List {
        /// Show all apps (including stopped)
        #[arg(short, long)]
        all: bool,
    },
    /// Start an app
    Start { name: String },
    /// Stop an app
    Stop { name: String },
    /// Restart an app
    Restart { name: String },
    /// Show app logs
    Logs {
        name: String,
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: usize,
        /// Follow log output
        #[arg(short, long)]
        follow: bool,
    },
    /// Show app stats
    Stats { name: Option<String> },
}

#[derive(Subcommand)]
enum PluginCommands {
    /// List installed plugins (code extensions)
    List,
    /// Install a plugin
    Install {
        /// Plugin name or URL
        plugin: String,
    },
    /// Remove a plugin
    Remove { name: String },
    /// Show plugin information
    Info { name: String },
    /// Enable a plugin
    Enable { name: String },
    /// Disable a plugin
    Disable { name: String },
}

#[derive(Subcommand)]
enum LogsCommands {
    /// Show system logs
    System {
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: usize,
        /// Follow log output
        #[arg(short, long)]
        follow: bool,
    },
    /// Show service logs
    Service {
        name: String,
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: usize,
        /// Follow log output
        #[arg(short, long)]
        follow: bool,
    },
}

#[derive(Subcommand)]
enum SecurityCommands {
    /// Show security status
    Status,
    /// List security alerts
    Alerts,
    /// List secrets
    Secrets,
    /// Add a secret
    AddSecret {
        name: String,
        /// Read value from stdin
        #[arg(short, long)]
        stdin: bool,
    },
}

#[derive(Tabled)]
struct ServiceRow {
    #[tabled(rename = "NAME")]
    name: String,
    #[tabled(rename = "STATUS")]
    status: String,
    #[tabled(rename = "PORT")]
    port: String,
    #[tabled(rename = "UPTIME")]
    uptime: String,
}

#[derive(Tabled)]
struct ContainerRow {
    #[tabled(rename = "NAME")]
    name: String,
    #[tabled(rename = "STATE")]
    state: String,
    #[tabled(rename = "STATUS")]
    status: String,
    #[tabled(rename = "IMAGE")]
    image: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::System(cmd) => handle_system(cmd).await,
        Commands::Service(cmd) => handle_service(&cli.url, cmd).await,
        Commands::App(cmd) => handle_app(&cli.url, cmd).await,
        Commands::Plugin(cmd) => handle_plugin(&cli.url, cmd).await,
        Commands::Logs(cmd) => handle_logs(&cli.url, cmd).await,
        Commands::Security(cmd) => handle_security(&cli.url, cmd).await,
        Commands::Status { verbose } => show_status(&cli.url, verbose).await,
        Commands::Update { check } => handle_update(check).await,
    }
}

async fn handle_system(cmd: SystemCommands) -> Result<()> {
    match cmd {
        SystemCommands::Info => {
            println!("{}", "System Information".bright_blue().bold());
            println!();

            let output = StdCommand::new("uname").arg("-a").output()?;
            println!("  Kernel: {}", String::from_utf8_lossy(&output.stdout).trim());

            if let Ok(output) = std::fs::read_to_string("/etc/iora-version") {
                println!("  IORA OS: {}", output.trim());
            }

            if let Ok(output) = std::fs::read_to_string("/proc/uptime") {
                let uptime_secs: f64 = output.split_whitespace().next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0);
                let days = (uptime_secs / 86400.0) as u64;
                let hours = ((uptime_secs % 86400.0) / 3600.0) as u64;
                println!("  Uptime: {} days, {} hours", days, hours);
            }
        }
        SystemCommands::Resources => {
            println!("{}", "System Resources".bright_blue().bold());
            println!();

            // CPU
            if let Ok(output) = StdCommand::new("nproc").output() {
                println!("  CPU Cores: {}", String::from_utf8_lossy(&output.stdout).trim());
            }

            // Memory
            if let Ok(output) = std::fs::read_to_string("/proc/meminfo") {
                for line in output.lines() {
                    if line.starts_with("MemTotal:") || line.starts_with("MemAvailable:") {
                        println!("  {}", line);
                    }
                }
            }

            // Disk
            let output = StdCommand::new("df").args(["-h", "/"]).output()?;
            println!("\n  Disk Usage:");
            println!("  {}", String::from_utf8_lossy(&output.stdout));
        }
        SystemCommands::Reboot { force } => {
            if !force {
                if !dialoguer::Confirm::new()
                    .with_prompt("Are you sure you want to reboot?")
                    .interact()? {
                    return Ok(());
                }
            }
            println!("{}", "Rebooting system...".bright_yellow());
            StdCommand::new("systemctl").arg("reboot").spawn()?;
        }
        SystemCommands::Shutdown { force } => {
            if !force {
                if !dialoguer::Confirm::new()
                    .with_prompt("Are you sure you want to shutdown?")
                    .interact()? {
                    return Ok(());
                }
            }
            println!("{}", "Shutting down system...".bright_yellow());
            StdCommand::new("systemctl").arg("poweroff").spawn()?;
        }
        SystemCommands::Version => {
            if let Ok(version) = std::fs::read_to_string("/etc/iora-version") {
                println!("IORA OS {}", version.trim());
            } else {
                println!("IORA OS version unknown");
            }
        }
    }
    Ok(())
}

async fn handle_service(base_url: &str, cmd: ServiceCommands) -> Result<()> {
    let client = reqwest::Client::new();

    match cmd {
        ServiceCommands::List => {
            let url = format!("{}:8090/api/core/services", base_url);
            let resp = client.get(&url).send().await?;
            let data: Value = resp.json().await?;

            if let Some(services) = data.get("services").and_then(|v| v.as_array()) {
                let mut rows = Vec::new();
                for svc in services {
                    rows.push(ServiceRow {
                        name: svc["name"].as_str().unwrap_or("unknown").to_string(),
                        status: svc["status"].as_str().unwrap_or("unknown").to_string(),
                        port: svc["port"].to_string(),
                        uptime: format_uptime(svc["uptime_seconds"].as_u64().unwrap_or(0)),
                    });
                }
                println!("{}", Table::new(rows));
            }
        }
        ServiceCommands::Start { name } => {
            println!("{} {}", "Starting service".bright_cyan(), name.bright_white());
            let url = format!("{}:8097/api/supervisor/containers/{}/start", base_url, name);
            client.post(&url).send().await?;
            println!("{}", "✓ Service started".green());
        }
        ServiceCommands::Stop { name } => {
            println!("{} {}", "Stopping service".bright_cyan(), name.bright_white());
            let url = format!("{}:8097/api/supervisor/containers/{}/stop", base_url, name);
            client.post(&url).send().await?;
            println!("{}", "✓ Service stopped".green());
        }
        ServiceCommands::Restart { name } => {
            println!("{} {}", "Restarting service".bright_cyan(), name.bright_white());
            let url = format!("{}:8097/api/supervisor/containers/{}/restart", base_url, name);
            client.post(&url).send().await?;
            println!("{}", "✓ Service restarted".green());
        }
        ServiceCommands::Status { name } => {
            let url = format!("{}:8097/api/supervisor/containers", base_url);
            let resp = client.get(&url).send().await?;
            let containers: Vec<Value> = resp.json().await?;

            for container in containers {
                if container["name"].as_str() == Some(&name) {
                    println!("{}", format!("Service: {}", name).bright_blue().bold());
                    println!("  State: {}", container["state"].as_str().unwrap_or("unknown"));
                    println!("  Status: {}", container["status"].as_str().unwrap_or("unknown"));
                    println!("  Image: {}", container["image"].as_str().unwrap_or("unknown"));
                    return Ok(());
                }
            }
            eprintln!("{}", format!("Service {} not found", name).red());
        }
        ServiceCommands::Logs { name, lines } => {
            let url = format!("{}:8097/api/supervisor/containers/{}/logs", base_url, name);
            let resp = client.get(&url).send().await?;
            let data: Value = resp.json().await?;

            if let Some(logs) = data.get("logs").and_then(|v| v.as_str()) {
                let lines_vec: Vec<&str> = logs.lines().collect();
                let start = lines_vec.len().saturating_sub(lines);
                for line in &lines_vec[start..] {
                    println!("{}", line);
                }
            }
        }
    }
    Ok(())
}

async fn handle_app(base_url: &str, cmd: AppCommands) -> Result<()> {
    let client = reqwest::Client::new();

    match cmd {
        AppCommands::List { all: _ } => {
            let url = format!("{}:8097/api/supervisor/containers", base_url);
            let resp = client.get(&url).send().await?;
            let containers: Vec<Value> = resp.json().await?;

            let mut rows = Vec::new();
            for container in containers {
                rows.push(ContainerRow {
                    name: container["name"].as_str().unwrap_or("unknown").to_string(),
                    state: container["state"].as_str().unwrap_or("unknown").to_string(),
                    status: container["status"].as_str().unwrap_or("unknown").to_string(),
                    image: container["image"].as_str().unwrap_or("unknown").to_string(),
                });
            }
            println!("{}", Table::new(rows));
        }
        AppCommands::Start { name } => {
            println!("{} {}", "Starting app".bright_cyan(), name.bright_white());
            let url = format!("{}:8097/api/supervisor/containers/{}/start", base_url, name);
            client.post(&url).send().await?;
            println!("{}", "✓ App started".green());
        }
        AppCommands::Stop { name } => {
            println!("{} {}", "Stopping app".bright_cyan(), name.bright_white());
            let url = format!("{}:8097/api/supervisor/containers/{}/stop", base_url, name);
            client.post(&url).send().await?;
            println!("{}", "✓ App stopped".green());
        }
        AppCommands::Restart { name } => {
            println!("{} {}", "Restarting app".bright_cyan(), name.bright_white());
            let url = format!("{}:8097/api/supervisor/containers/{}/restart", base_url, name);
            client.post(&url).send().await?;
            println!("{}", "✓ App restarted".green());
        }
        AppCommands::Logs { name, lines, follow } => {
            if follow {
                println!("{} (press Ctrl+C to stop)", "Following logs...".bright_cyan());
                // For follow, would need to implement streaming
                eprintln!("{}", "Follow mode not yet implemented".yellow());
            } else {
                let url = format!("{}:8097/api/supervisor/containers/{}/logs", base_url, name);
                let resp = client.get(&url).send().await?;
                let data: Value = resp.json().await?;

                if let Some(logs) = data.get("logs").and_then(|v| v.as_str()) {
                    let lines_vec: Vec<&str> = logs.lines().collect();
                    let start = lines_vec.len().saturating_sub(lines);
                    for line in &lines_vec[start..] {
                        println!("{}", line);
                    }
                }
            }
        }
        AppCommands::Stats { name: _ } => {
            println!("{}", "App stats not yet implemented".yellow());
        }
    }
    Ok(())
}

async fn handle_plugin(base_url: &str, cmd: PluginCommands) -> Result<()> {
    let client = reqwest::Client::new();

    match cmd {
        PluginCommands::List => {
            let url = format!("{}:8090/api/core/plugins", base_url);
            let resp = client.get(&url).send().await?;
            let data: Value = resp.json().await?;

            if let Some(plugins) = data.get("plugins").and_then(|v| v.as_array()) {
                println!("{}", "Installed Plugins (Code Extensions)".bright_blue().bold());
                println!();
                for plugin in plugins {
                    println!("  {} - {}",
                        plugin["name"].as_str().unwrap_or("unknown").bright_white(),
                        plugin["version"].as_str().unwrap_or("unknown"));
                }
            }
        }
        PluginCommands::Install { plugin } => {
            println!("{} {}", "Installing plugin".bright_cyan(), plugin.bright_white());
            println!("{}", "Plugin installation not yet fully implemented".yellow());
        }
        PluginCommands::Remove { name } => {
            println!("{} {}", "Removing plugin".bright_cyan(), name.bright_white());
            let url = format!("{}:8090/api/core/plugins/{}", base_url, name);
            client.delete(&url).send().await?;
            println!("{}", "✓ Plugin removed".green());
        }
        PluginCommands::Info { name } => {
            let url = format!("{}:8090/api/core/plugins/{}", base_url, name);
            let resp = client.get(&url).send().await?;
            let plugin: Value = resp.json().await?;

            println!("{}", format!("Plugin: {}", name).bright_blue().bold());
            println!("  Version: {}", plugin["version"].as_str().unwrap_or("unknown"));
            println!("  Type: {}", plugin["type"].as_str().unwrap_or("unknown"));
            println!("  Enabled: {}", plugin["enabled"].as_bool().unwrap_or(false));
        }
        PluginCommands::Enable { name } | PluginCommands::Disable { name } => {
            println!("{}", format!("Plugin enable/disable for {} not yet implemented", name).yellow());
        }
    }
    Ok(())
}

async fn handle_logs(_base_url: &str, cmd: LogsCommands) -> Result<()> {
    match cmd {
        LogsCommands::System { lines, follow } => {
            if follow {
                StdCommand::new("journalctl").args(["-f", "-n", &lines.to_string()]).spawn()?.wait()?;
            } else {
                let output = StdCommand::new("journalctl").args(["-n", &lines.to_string()]).output()?;
                println!("{}", String::from_utf8_lossy(&output.stdout));
            }
        }
        LogsCommands::Service { name, lines, follow } => {
            if follow {
                StdCommand::new("journalctl").args(["-u", &name, "-f", "-n", &lines.to_string()]).spawn()?.wait()?;
            } else {
                let output = StdCommand::new("journalctl").args(["-u", &name, "-n", &lines.to_string()]).output()?;
                println!("{}", String::from_utf8_lossy(&output.stdout));
            }
        }
    }
    Ok(())
}

async fn handle_security(base_url: &str, cmd: SecurityCommands) -> Result<()> {
    let client = reqwest::Client::new();

    match cmd {
        SecurityCommands::Status => {
            let url = format!("{}:8095/api/security/status", base_url);
            let resp = client.get(&url).send().await?;
            let status: Value = resp.json().await?;

            println!("{}", "Security Status".bright_blue().bold());
            println!();
            println!("  Lockdown Level: {}", status["lockdown_level"].as_u64().unwrap_or(0));
            println!("  Active Threats: {}", status["active_threats"].as_u64().unwrap_or(0));
        }
        SecurityCommands::Alerts => {
            let url = format!("{}:8095/api/security/alerts", base_url);
            let resp = client.get(&url).send().await?;
            let alerts: Vec<Value> = resp.json().await?;

            println!("{}", "Security Alerts".bright_blue().bold());
            println!();
            for alert in alerts {
                println!("  [{}] {}",
                    alert["severity"].as_str().unwrap_or("unknown"),
                    alert["message"].as_str().unwrap_or(""));
            }
        }
        SecurityCommands::Secrets => {
            let url = format!("{}:8093/api/secrets", base_url);
            let resp = client.get(&url).send().await?;
            let secrets: Vec<Value> = resp.json().await?;

            println!("{}", "Secrets".bright_blue().bold());
            println!();
            for secret in secrets {
                println!("  {} ({})",
                    secret["name"].as_str().unwrap_or("unknown"),
                    secret["created_at"].as_str().unwrap_or(""));
            }
        }
        SecurityCommands::AddSecret { name, stdin } => {
            let value = if stdin {
                use std::io::Read;
                let mut buffer = String::new();
                std::io::stdin().read_to_string(&mut buffer)?;
                buffer
            } else {
                dialoguer::Password::new()
                    .with_prompt(&format!("Enter value for secret '{}'", name))
                    .interact()?
            };

            let url = format!("{}:8093/api/secrets", base_url);
            client.post(&url)
                .json(&serde_json::json!({
                    "name": name,
                    "value": value,
                }))
                .send()
                .await?;

            println!("{}", "✓ Secret created".green());
        }
    }
    Ok(())
}

async fn show_status(base_url: &str, verbose: bool) -> Result<()> {
    let client = reqwest::Client::new();

    println!("{}", "IORA System Status".bright_blue().bold());
    println!();

    // System info
    if let Ok(version) = std::fs::read_to_string("/etc/iora-version") {
        println!("  IORA OS: {}", version.trim());
    }

    // Services
    let url = format!("{}:8090/api/core/services", base_url);
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(data) = resp.json::<Value>().await {
            if let Some(services) = data.get("services").and_then(|v| v.as_array()) {
                println!();
                println!("{}", "Services:".bright_cyan());
                for svc in services {
                    let name = svc["name"].as_str().unwrap_or("unknown");
                    let status = svc["status"].as_str().unwrap_or("unknown");
                    let status_color = if status == "healthy" { status.green() } else { status.red() };
                    println!("  {} - {}", name, status_color);

                    if verbose {
                        println!("    Port: {}", svc["port"]);
                        println!("    Uptime: {}", format_uptime(svc["uptime_seconds"].as_u64().unwrap_or(0)));
                    }
                }
            }
        }
    }

    // Apps (Containers)
    let url = format!("{}:8097/api/supervisor/containers", base_url);
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(containers) = resp.json::<Vec<Value>>().await {
            println!();
            println!("{}", "Apps (Containers):".bright_cyan());
            let running = containers.iter().filter(|c| c["state"].as_str() == Some("running")).count();
            println!("  Running: {}/{}", running, containers.len());

            if verbose {
                for container in containers {
                    println!("  {} - {}",
                        container["name"].as_str().unwrap_or("unknown"),
                        container["state"].as_str().unwrap_or("unknown"));
                }
            }
        }
    }

    Ok(())
}

async fn handle_update(check: bool) -> Result<()> {
    if check {
        println!("{}", "Checking for updates from update server...".bright_cyan());
        println!("{}", "Update server: https://github.com/kaimdt/update-server".bright_black());
        println!("{}", "Update check not yet implemented".yellow());
    } else {
        println!("{}", "Installing updates from update server...".bright_cyan());
        println!("{}", "Update server: https://github.com/kaimdt/update-server".bright_black());
        println!("{}", "Update installation not yet implemented".yellow());
    }
    Ok(())
}

fn format_uptime(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    let mins = (seconds % 3600) / 60;

    if days > 0 {
        format!("{}d {}h", days, hours)
    } else if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}
