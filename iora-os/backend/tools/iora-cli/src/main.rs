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

    /// Install an app or plugin (convenience alias)
    ///
    /// Examples:
    ///   ora install weather-app
    ///   ora install plugin:notification-plugin
    ///   ora install app:energy-optimizer-plugin
    Install {
        /// Name of the app or plugin. Prefix with `app:` or `plugin:` to force a kind.
        target: String,
        /// Assume yes to prompts
        #[arg(short, long)]
        yes: bool,
    },

    /// Remove an app or plugin (convenience alias)
    Remove {
        /// Name of the app or plugin
        target: String,
        /// Also delete app data volumes
        #[arg(long)]
        purge: bool,
    },

    /// Update IORA OS (shortcut for `ora system update`)
    Update {
        /// Only check for updates without installing
        #[arg(short, long)]
        check: bool,
        /// Skip the confirmation prompt
        #[arg(short, long)]
        yes: bool,
    },

    /// Developer mode (only works on images built with `build.sh --dev`)
    #[command(subcommand)]
    Dev(DevCommands),
}

#[derive(Subcommand)]
enum DevCommands {
    /// Report whether this image is a dev build and what the bridge exposes
    Status,
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
    /// Detect and print hardware platform (x86_64 / rpi3 / rpi4 / rpi5 / ...)
    Hardware,
    /// Check for and optionally install system updates
    Update {
        /// Only check, do not prompt for install
        #[arg(short, long)]
        check: bool,
        /// Skip confirmation prompt and install immediately
        #[arg(short, long)]
        yes: bool,
        /// Release channel (stable | beta | alpha)
        #[arg(long, default_value = "stable")]
        channel: String,
    },
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
        Commands::Install { target, yes } => handle_install(&cli.url, &target, yes).await,
        Commands::Remove { target, purge } => handle_remove(&cli.url, &target, purge).await,
        Commands::Update { check, yes } => {
            // Top-level shortcut for `ora system update`.
            handle_system(SystemCommands::Update {
                check,
                yes,
                channel: "stable".to_string(),
            })
            .await
        }
        Commands::Dev(cmd) => handle_dev(cmd).await,
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
            if !force
                && !dialoguer::Confirm::new()
                    .with_prompt("Are you sure you want to reboot?")
                    .interact()? {
                    return Ok(());
                }
            println!("{}", "Rebooting system...".bright_yellow());
            StdCommand::new("systemctl").arg("reboot").spawn()?;
        }
        SystemCommands::Shutdown { force } => {
            if !force
                && !dialoguer::Confirm::new()
                    .with_prompt("Are you sure you want to shutdown?")
                    .interact()? {
                    return Ok(());
                }
            println!("{}", "Shutting down system...".bright_yellow());
            StdCommand::new("systemctl").arg("poweroff").spawn()?;
        }
        SystemCommands::Version => {
            print_version_overview().await;
        }
        SystemCommands::Hardware => {
            let hw = detect_hardware();
            println!("{}", "Hardware".bright_blue().bold());
            println!();
            println!("  Arch:     {}", hw.arch);
            println!("  Platform: {}", hw.platform);
            println!("  Model:    {}", hw.model);
            println!("  Is RPi:   {}", hw.is_raspberry_pi);
            println!("  Is WSL:   {}", hw.is_wsl);
        }
        SystemCommands::Update { check, yes, channel } => {
            handle_system_update(check, yes, &channel).await?;
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
                // Poll for new log lines every second.
                let url = format!("{}:8097/api/supervisor/containers/{}/logs", base_url, name);
                let mut last_seen: Option<String> = None;
                loop {
                    let resp = client.get(&url).send().await?;
                    let data: Value = resp.json().await?;
                    if let Some(logs) = data.get("logs").and_then(|v| v.as_str()) {
                        let lines_vec: Vec<&str> = logs.lines().collect();
                        let new_lines: Vec<&str> = if let Some(last) = &last_seen {
                            if let Some(idx) = lines_vec.iter().rposition(|l| *l == last.as_str()) {
                                lines_vec[idx + 1..].to_vec()
                            } else {
                                let start = lines_vec.len().saturating_sub(lines);
                                lines_vec[start..].to_vec()
                            }
                        } else {
                            let start = lines_vec.len().saturating_sub(lines);
                            lines_vec[start..].to_vec()
                        };
                        for line in &new_lines {
                            println!("{}", line);
                        }
                        if let Some(last) = lines_vec.last() {
                            last_seen = Some((*last).to_string());
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
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
        AppCommands::Stats { name } => {
            let target = match name {
                Some(n) => n,
                None => {
                    eprintln!("{}", "Container name required (e.g. `ora app stats <name>`)".yellow());
                    return Ok(());
                }
            };
            let url = format!("{}:8097/api/supervisor/containers/{}/stats", base_url, target);
            let resp = client.get(&url).send().await?;
            if !resp.status().is_success() {
                eprintln!("{} status {}", "Stats request failed".red(), resp.status());
            } else {
                let data: Value = resp.json().await?;
                println!("{}", format!("Stats: {}", target).bright_blue().bold());
                if let Some(cpu) = data.get("cpu_percent").and_then(|v| v.as_f64()) {
                    println!("  CPU:    {:.2}%", cpu);
                }
                if let Some(mem) = data.get("memory_usage").and_then(|v| v.as_u64()) {
                    println!("  Memory: {} bytes", mem);
                }
                if let Some(mem_pct) = data.get("memory_percent").and_then(|v| v.as_f64()) {
                    println!("  Memory: {:.2}%", mem_pct);
                }
                if let Some(net_rx) = data.get("network_rx").and_then(|v| v.as_u64()) {
                    println!("  Net RX: {} bytes", net_rx);
                }
                if let Some(net_tx) = data.get("network_tx").and_then(|v| v.as_u64()) {
                    println!("  Net TX: {} bytes", net_tx);
                }
                println!("  Raw:    {}", data);
            }
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
            let url = format!("{}:8090/api/core/plugins", base_url);
            let resp = client
                .post(&url)
                .json(&serde_json::json!({ "source": plugin }))
                .send()
                .await?;
            if resp.status().is_success() {
                println!("{}", "\u{2713} Plugin installed".green());
            } else {
                eprintln!("{} status {}", "Plugin install failed".red(), resp.status());
            }
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
        PluginCommands::Enable { name } => {
            let url = format!("{}:8090/api/core/plugins/{}/enable", base_url, name);
            let resp = client.post(&url).send().await?;
            if resp.status().is_success() {
                println!("{} {}", "\u{2713} Plugin enabled:".green(), name);
            } else {
                eprintln!("{} status {}", "Plugin enable failed".red(), resp.status());
            }
        }
        PluginCommands::Disable { name } => {
            let url = format!("{}:8090/api/core/plugins/{}/disable", base_url, name);
            let resp = client.post(&url).send().await?;
            if resp.status().is_success() {
                println!("{} {}", "\u{2713} Plugin disabled:".green(), name);
            } else {
                eprintln!("{} status {}", "Plugin disable failed".red(), resp.status());
            }
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
                    .with_prompt(format!("Enter value for secret '{}'", name))
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
    // Backwards-compat wrapper kept in case external scripts still call it.
    handle_system_update(check, false, "stable").await
}

// ─── Hardware detection ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct HardwareInfo {
    arch: String,
    model: String,
    platform: String,      // "pc" | "rpi3" | "rpi4" | "rpi5" | "generic-arm64" | "unknown"
    is_raspberry_pi: bool,
    is_wsl: bool,
}

fn detect_hardware() -> HardwareInfo {
    let arch = std::env::consts::ARCH.to_string();
    let model = std::fs::read_to_string("/proc/device-tree/model")
        .ok()
        .map(|s| s.trim_end_matches('\0').trim().to_string())
        .unwrap_or_default();
    let is_wsl = std::fs::read_to_string("/proc/version")
        .map(|s| {
            let s = s.to_ascii_lowercase();
            s.contains("microsoft") || s.contains("wsl")
        })
        .unwrap_or(false);
    let is_raspberry_pi = model.contains("Raspberry Pi");
    let platform = if is_raspberry_pi {
        // Match model strings like "Raspberry Pi 4 Model B Rev 1.4".
        let m = model.to_ascii_lowercase();
        if m.contains("pi 5") { "rpi5".into() }
        else if m.contains("pi 4") || m.contains("pi 400") || m.contains("compute module 4") { "rpi4".into() }
        else if m.contains("pi 3") || m.contains("zero 2") { "rpi3".into() }
        else { "generic-arm64".into() }
    } else if arch == "aarch64" {
        "generic-arm64".into()
    } else if arch == "x86_64" {
        "pc".into()
    } else {
        "unknown".into()
    };
    HardwareInfo {
        arch,
        model: if model.is_empty() { "unknown".into() } else { model },
        platform,
        is_raspberry_pi,
        is_wsl,
    }
}

// ─── System update (ora system update / ora update) ────────────────────────

async fn handle_system_update(check_only: bool, assume_yes: bool, channel: &str) -> Result<()> {
    let update_server = std::env::var("IORA_UPDATE_SERVER")
        .unwrap_or_else(|_| "https://update.kaimdt.com".to_string());

    let hw = detect_hardware();
    let current_version = std::fs::read_to_string("/etc/iora-version")
        .ok()
        .map(|s| s.split_whitespace().last().unwrap_or("unknown").to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let device_id = std::fs::read_to_string("/etc/machine-id")
        .ok()
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let arch_for_server = match hw.arch.as_str() {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        "armv7l"  => "armhf",
        other => other,
    };

    let url = format!(
        "{}/v1/iora/os/check?version={}&channel={}&arch={}&device_id={}&platform={}",
        update_server, current_version, channel, arch_for_server, device_id, hw.platform
    );

    println!("{}", "Checking for IORA OS updates...".bright_cyan());
    println!("  Current: {}", current_version);
    println!("  Channel: {}", channel);
    println!("  Platform: {}  ({})", hw.platform, hw.arch);
    println!();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{} {}", "Update server unreachable:".red(), e);
            return Ok(());
        }
    };
    if !resp.status().is_success() {
        eprintln!("{} HTTP {}", "Update server error:".red(), resp.status());
        return Ok(());
    }
    let data: Value = resp.json().await.context("invalid JSON from update server")?;

    let available = data.get("update_available").and_then(|v| v.as_bool()).unwrap_or(false);
    if !available {
        println!("{}", "System is up to date.".green());
        return Ok(());
    }

    let latest = data.get("latest_version").and_then(|v| v.as_str()).unwrap_or("?");
    let notes = data.get("release_notes").and_then(|v| v.as_str()).unwrap_or("");
    let size = data
        .get("release")
        .and_then(|r| r.get("size"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    println!("{} {}", "Update available:".yellow().bold(), latest.bright_white());
    if size > 0 {
        println!("  Size: {:.1} MiB", size as f64 / 1024.0 / 1024.0);
    }
    if !notes.is_empty() {
        println!();
        println!("{}", "Release notes:".bright_cyan());
        for line in notes.lines().take(15) {
            println!("  {line}");
        }
    }

    if check_only {
        println!();
        println!("Run `ora system update` without --check to install.");
        return Ok(());
    }

    println!();
    let proceed = if assume_yes {
        true
    } else {
        dialoguer::Confirm::new()
            .with_prompt(format!("Install update {latest} now?"))
            .default(false)
            .interact()
            .unwrap_or(false)
    };
    if !proceed {
        println!("Update cancelled.");
        return Ok(());
    }

    // Delegate the actual RAUC install to the OS helper script that ships
    // with iora-os/post-build.sh so we reuse the signature/checksum logic.
    let helper = "/opt/iora/update/check-update.sh";
    if std::path::Path::new(helper).exists() {
        println!("{}", "Handing over to /opt/iora/update/check-update.sh...".bright_cyan());
        let status = StdCommand::new("sudo")
            .arg(helper)
            .status()
            .context("failed to invoke update helper")?;
        if status.success() {
            println!();
            println!("{}", "✓ Update installed. Reboot with `ora system reboot` to activate.".green());
        } else {
            eprintln!("{}", "Update helper exited with an error.".red());
        }
    } else {
        eprintln!(
            "{}",
            "Update helper /opt/iora/update/check-update.sh not found \
             (this system may not be IORA OS)."
                .yellow()
        );
        eprintln!("  Download URL: {}", data.get("release").and_then(|r| r.get("download_url")).and_then(|v| v.as_str()).unwrap_or(""));
    }
    Ok(())
}

// ─── Install / Remove (top-level aliases) ───────────────────────────────────

async fn handle_install(base_url: &str, target: &str, yes: bool) -> Result<()> {
    let (kind, name) = split_target(target);
    match kind {
        "plugin" => {
            println!("{} {}", "Installing plugin".bright_cyan(), name.bright_white());
            handle_plugin(base_url, PluginCommands::Install { plugin: name.to_string() }).await
        }
        "app" | "" => {
            // Default to app installation through the supervisor.
            println!("{} {}", "Installing app".bright_cyan(), name.bright_white());
            if !yes {
                let confirmed = dialoguer::Confirm::new()
                    .with_prompt(format!("Install app `{name}` from the IORA app store?"))
                    .default(true)
                    .interact()
                    .unwrap_or(false);
                if !confirmed {
                    println!("Aborted.");
                    return Ok(());
                }
            }
            let client = reqwest::Client::new();
            let url = format!("{}:8097/api/supervisor/apps/install", base_url);
            let body = serde_json::json!({
                "metadata": {
                    "id": name,
                    "name": name,
                    "version": "latest",
                    "description": format!("Installed via ora install {name}"),
                    "author": "app-store",
                    "icon": null,
                    "image": format!("iora-apps/{name}:latest"),
                    "ports": [],
                    "environment": {},
                    "volumes": [],
                    "permissions": [],
                    "enabled": true,
                    "installed_at": chrono::Utc::now().to_rfc3339(),
                }
            });
            match client.post(&url).json(&body).send().await {
                Ok(r) if r.status().is_success() => println!("{}", "✓ App installed".green()),
                Ok(r) => eprintln!("{} HTTP {}", "Install failed:".red(), r.status()),
                Err(e) => eprintln!("{} {}", "Install failed:".red(), e),
            }
            Ok(())
        }
        other => {
            eprintln!("{} unknown target kind `{other}` (use app: or plugin:)", "Error:".red());
            Ok(())
        }
    }
}

async fn handle_remove(base_url: &str, target: &str, purge: bool) -> Result<()> {
    let (kind, name) = split_target(target);
    match kind {
        "plugin" => handle_plugin(base_url, PluginCommands::Remove { name: name.to_string() }).await,
        "app" | "" => {
            let client = reqwest::Client::new();
            let url = format!(
                "{}:8097/api/supervisor/apps/{}?purge={}",
                base_url, name, purge
            );
            match client.delete(&url).send().await {
                Ok(r) if r.status().is_success() => println!("{}", "✓ App removed".green()),
                Ok(r) => eprintln!("{} HTTP {}", "Remove failed:".red(), r.status()),
                Err(e) => eprintln!("{} {}", "Remove failed:".red(), e),
            }
            Ok(())
        }
        other => {
            eprintln!("{} unknown target kind `{other}` (use app: or plugin:)", "Error:".red());
            Ok(())
        }
    }
}

/// Split `target` into a `(kind, name)` pair.  Supports both `plugin:foo`
/// and plain `foo` (defaulting to an app).  An explicit `app:foo` is also
/// accepted for symmetry with `plugin:foo`.
fn split_target(target: &str) -> (&str, &str) {
    if let Some(rest) = target.strip_prefix("plugin:") {
        ("plugin", rest)
    } else if let Some(rest) = target.strip_prefix("app:") {
        ("app", rest)
    } else {
        ("", target)
    }
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

// ─── Developer mode ─────────────────────────────────────────────────────────

async fn handle_dev(cmd: DevCommands) -> Result<()> {
    match cmd {
        DevCommands::Status => {
            let is_dev = std::path::Path::new("/etc/iora/os-dev-mode").exists();
            let bridge = std::path::Path::new("/usr/bin/iora-dev-bridge").exists();
            println!("{}", "Developer mode".bright_blue().bold());
            println!();
            println!("  Two independent dev modes exist:");
            println!("    • Public app/plugin developer mode  — runtime toggle in");
            println!("      the IORA Developer App.  Does NOT touch the OS.");
            println!("    • IORA OS Dev mode                  — baked into the");
            println!("      image at build time via  build.sh --dev  only.");
            println!();
            println!("  OS-dev marker (/etc/iora/os-dev-mode): {}", yesno(is_dev));
            println!("  OS-dev bridge binary present:          {}", yesno(bridge));
            if !is_dev {
                println!();
                println!(
                    "  {}",
                    "This is a production image. Dev mode can only be enabled at build time"
                        .yellow()
                );
                println!(
                    "  {}",
                    "via `iora-os/build.sh --dev`.".yellow()
                );
                return Ok(());
            }
            // Try the bridge's own status endpoint.
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .build()?;
            match client.get("http://127.0.0.1:8099/dev/status").send().await {
                Ok(r) if r.status().is_success() => {
                    let body: serde_json::Value = r.json().await.unwrap_or_default();
                    println!();
                    println!("  Bridge: {}", "reachable on 127.0.0.1:8099".green());
                    if let Some(caps) = body.get("capabilities").and_then(|v| v.as_array()) {
                        println!("  Capabilities:");
                        for c in caps {
                            if let Some(s) = c.as_str() {
                                println!("    • {s}");
                            }
                        }
                    }
                }
                Ok(r) => {
                    println!();
                    println!("  Bridge responded with HTTP {}", r.status());
                }
                Err(_) => {
                    println!();
                    println!(
                        "  {}",
                        "Bridge not reachable — is iora-dev-bridge.service running?".yellow()
                    );
                }
            }
            Ok(())
        }
    }
}

fn yesno(b: bool) -> colored::ColoredString {
    if b { "yes".green() } else { "no".red() }
}

// ─── Version overview ───────────────────────────────────────────────────────

async fn print_version_overview() {
    println!("{}", "IORA OS".bright_blue().bold());
    println!();

    // --- OS / build metadata -------------------------------------------------
    match std::fs::read_to_string("/etc/iora/build-info.json") {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(info) => {
                let get = |k: &str| -> String {
                    info.get(k)
                        .and_then(|v| v.as_str())
                        .unwrap_or("?")
                        .to_string()
                };
                println!("  Version:  {}", get("version").bright_white());
                println!("  Variant:  {}", get("variant"));
                println!("  Channel:  {}", get("channel"));
                println!("  Target:   {}  ({})", get("target"), get("arch"));
                println!("  Git:      {}", get("git_sha"));
                println!("  Built:    {}", get("built_at"));
                let updates = info
                    .get("updates_enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                println!(
                    "  Updates:  {}",
                    if updates {
                        "enabled".green()
                    } else {
                        "disabled (IORA OS Dev build)".yellow()
                    }
                );
            }
            Err(e) => println!("  build-info.json unreadable: {e}"),
        },
        Err(_) => {
            match std::fs::read_to_string("/etc/iora-version") {
                Ok(v) => println!("  Version:  {}", v.trim()),
                Err(_) => println!("  Version:  unknown"),
            }
            println!(
                "  {}",
                "(no build-info.json — running outside IORA OS?)".bright_black()
            );
        }
    }

    println!();
    println!("{}", "Components".bright_blue().bold());
    println!();

    let base = std::env::var("IORA_URL").unwrap_or_else(|_| "http://localhost".into());
    let base = base.trim_end_matches('/').to_string();
    let services: &[(&str, u16)] = &[
        ("iora-home",         8080),
        ("iora-core",         8090),
        ("iora-api",          8091),
        ("iora-control",      8092),
        ("iora-assist",       8093),
        ("iora-secrets",      8094),
        ("iora-security",     8095),
        ("iora-gateway",      8096),
        ("iora-supervisor",   8097),
        ("iora-files",        8098),
        ("iora-appstore",     8100),
        ("iora-developer-app",8101),
    ];
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(500))
        .build()
        .unwrap();
    let tasks: Vec<_> = services
        .iter()
        .map(|(name, port)| {
            let url = format!("{base}:{port}/health");
            let c = client.clone();
            let name = *name;
            tokio::spawn(async move {
                let v = c
                    .get(&url)
                    .send()
                    .await
                    .ok()?
                    .json::<Value>()
                    .await
                    .ok()?;
                v.get("version")
                    .and_then(|x| x.as_str())
                    .map(|s| (name, s.to_string()))
            })
        })
        .collect();
    for (i, t) in tasks.into_iter().enumerate() {
        let name = services[i].0;
        match t.await.ok().flatten() {
            Some((_, v)) => println!("  {:<22} {}", name, v.green()),
            None => println!("  {:<22} {}", name, "offline".bright_black()),
        }
    }
}
