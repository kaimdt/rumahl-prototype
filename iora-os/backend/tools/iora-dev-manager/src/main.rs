mod channels;
mod daemon;
mod devloop;
mod manager;
mod state;
mod web;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use manager::Manager;
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "iora-dev-manager",
    about = "Cross-platform IORA development VM control plane"
)]
struct Args {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the background daemon and its web dashboard
    Serve {
        /// Dashboard port
        #[arg(long, default_value_t = 8127)]
        port: u16,
        /// iora-os root (default: discovered from the working directory)
        #[arg(long)]
        root: Option<PathBuf>,
        /// Open the dashboard in the default browser
        #[arg(long)]
        open: bool,
    },
    /// Start the development VM (Slirp unless --bridge)
    Start {
        #[arg(long)]
        bridge: bool,
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Request a graceful guest shutdown
    Stop {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Force-kill the QEMU process
    Kill {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Print environment status as JSON
    Status {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Print recent QEMU and guest logs
    Logs {
        #[arg(long, default_value_t = 100)]
        tail: usize,
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Run environment diagnostics; exits 0 when Ready
    Doctor {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Exit 0 when the environment is Ready, 1 otherwise
    Health {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Create the Golden Snapshot of the VM disk
    Snapshot {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// List iora-* services in the guest via QGA
    Services {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Run a command in the guest via QGA
    Guest {
        command: String,
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Open an SSH session to the guest
    Ssh {
        #[arg(long)]
        root: Option<PathBuf>,
    },
    /// Open the IORA home website in the browser
    Website {
        #[arg(long)]
        root: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    match args.command {
        // Bare `cargo run` opens the dashboard, matching the old TUI flow.
        None => serve(8127, None, true).await,
        Some(Command::Serve { port, root, open }) => serve(port, root, open).await,
        Some(Command::Start { bridge, root }) => {
            let mode = if bridge { "bridge" } else { "slirp" };
            if let Some((_, port)) = daemon_info(root.clone()) {
                print_result(delegate(
                    port,
                    "POST",
                    "/api/start",
                    Some(json!({"mode": mode})),
                )
                .await?)?;
            } else {
                let mut manager = Manager::discover(root)?;
                let mode = if bridge {
                    state::NetworkMode::Bridge
                } else {
                    state::NetworkMode::Slirp
                };
                manager.start(mode, &[])?;
                println!("VM start requested (no daemon running; watchdog unavailable)");
            }
            Ok(())
        }
        Some(Command::Stop { root }) => {
            run_with_daemon(root.clone(), "POST", "/api/stop", Some(json!({})), |root| async {
                let manager = Manager::discover(root)?;
                manager.graceful_stop().await?;
                println!("Graceful shutdown requested");
                Ok(())
            })
            .await
        }
        Some(Command::Kill { root }) => {
            run_with_daemon(root.clone(), "POST", "/api/kill", None, |root| async {
                let manager = Manager::discover(root)?;
                manager.hard_stop()?;
                println!("VM process terminated");
                Ok(())
            })
            .await
        }
        Some(Command::Status { root }) => {
            if let Some((_, port)) = daemon_info(root.clone()) {
                let value = delegate(port, "GET", "/api/status", None).await?;
                println!("{}", serde_json::to_string_pretty(&value)?);
            } else {
                let mut manager = Manager::discover(root)?;
                let probe = manager.probe().await;
                let (host, ssh, home) = manager.state.connection();
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "state": manager.state,
                        "probe": probe,
                        "lifecycle": probe.lifecycle(),
                        "connection": { "host": host, "ssh": ssh, "home": home },
                    }))?
                );
            }
            Ok(())
        }
        Some(Command::Logs { tail, root }) => {
            if let Some((_, port)) = daemon_info(root.clone()) {
                let value =
                    delegate(port, "GET", &format!("/api/logs?tail={tail}"), None).await?;
                for line in value["lines"].as_array().into_iter().flatten() {
                    println!("{}", line.as_str().unwrap_or_default());
                }
            } else {
                let manager = Manager::discover(root)?;
                println!(
                    "{}",
                    manager::read_tail(&manager.root.join(".cache/qemu-serial.log"), tail)
                );
                println!(
                    "\n--- dev-manager.log ---\n{}",
                    manager::read_tail(&manager.root.join(".cache/dev-manager.log"), tail)
                );
            }
            Ok(())
        }
        Some(Command::Doctor { root }) => {
            let mut manager = Manager::discover(root)?;
            let probe = manager.probe().await;
            println!("IORA Dev Doctor\nStatus: {}\nQEMU: {}\nQMP: {}\nQGA: {}\nSSH: {}\nHome internal: {}\nHome external: {}",probe.lifecycle(),yes(probe.process),yes(probe.qmp),yes(probe.qga),yes(probe.ssh),yes(probe.internal_home),yes(probe.external_home));
            std::process::exit(if probe.lifecycle() == "Ready" { 0 } else { 1 });
        }
        Some(Command::Health { root }) => {
            let ready = if let Some((_, port)) = daemon_info(root.clone()) {
                let value = delegate(port, "GET", "/api/status", None).await?;
                value["lifecycle"].as_str() == Some("Ready")
            } else {
                let mut manager = Manager::discover(root)?;
                manager.probe().await.lifecycle() == "Ready"
            };
            println!("{}", if ready { "Ready" } else { "Not ready" });
            std::process::exit(if ready { 0 } else { 1 });
        }
        Some(Command::Snapshot { root }) => {
            run_with_daemon(root.clone(), "POST", "/api/snapshot", None, |root| async {
                let mut manager = Manager::discover(root)?;
                manager.create_golden_snapshot()?;
                println!("Golden Snapshot created");
                Ok(())
            })
            .await
        }
        Some(Command::Services { root }) => {
            if let Some((_, port)) = daemon_info(root.clone()) {
                let value = delegate(port, "GET", "/api/services", None).await?;
                if let Some(services) = value["services"].as_array() {
                    for service in services {
                        println!(
                            "{}  {}/{}",
                            service["unit"].as_str().unwrap_or_default(),
                            service["active"].as_str().unwrap_or_default(),
                            service["sub"].as_str().unwrap_or_default()
                        );
                    }
                } else {
                    print_result(value)?;
                }
            } else {
                let manager = Manager::discover(root)?;
                let output = manager
                    .guest("systemctl list-units --type=service --all --no-legend --no-pager --plain 'iora-*'")
                    .await?;
                print!("{output}");
            }
            Ok(())
        }
        Some(Command::Guest { command, root }) => {
            if let Some((_, port)) = daemon_info(root.clone()) {
                let value = delegate(port, "POST", "/api/guest", Some(json!({"command": command})))
                    .await?;
                if let Some(output) = value["output"].as_str() {
                    print!("{output}");
                } else {
                    print_result(value)?;
                }
            } else {
                let manager = Manager::discover(root)?;
                let output = manager.guest(&command).await?;
                print!("{output}");
            }
            Ok(())
        }
        Some(Command::Ssh { root }) => {
            let manager = Manager::discover(root)?;
            manager.open_ssh()?;
            println!("SSH session closed");
            Ok(())
        }
        Some(Command::Website { root }) => {
            let manager = Manager::discover(root)?;
            manager.open_url()?;
            println!("Website opened");
            Ok(())
        }
    }
}

async fn serve(port: u16, root: Option<PathBuf>, open: bool) -> Result<()> {
    let manager = Manager::discover(root)?;
    let cache = manager.root.join(".cache");
    std::fs::create_dir_all(&cache)?;
    let daemon_file = cache.join("daemon.json");
    if let Ok(existing) = std::fs::read_to_string(&daemon_file) {
        if let Ok(value) = serde_json::from_str::<Value>(&existing) {
            if let (Some(pid), Some(port)) = (value["pid"].as_u64(), value["port"].as_u64()) {
                if state::process_alive(pid as u32) {
                    anyhow::bail!(
                        "a daemon is already running on port {port}; stop it or use a different --port"
                    );
                }
            }
        }
    }
    let url = format!("http://127.0.0.1:{port}");
    if open {
        manager::open(&url)?;
    }
    std::fs::write(
        &daemon_file,
        serde_json::to_string_pretty(&json!({"pid": std::process::id(), "port": port}))?,
    )?;
    let daemon = daemon::Daemon::new(manager);
    daemon::spawn(daemon.clone());
    // SO_REUSEADDR lets the daemon rebind quickly after a forced kill,
    // where Windows can otherwise keep the listen socket lingering.
    let socket = tokio::net::TcpSocket::new_v4()?;
    socket.set_reuseaddr(true)?;
    socket.bind(std::net::SocketAddr::from(([127, 0, 0, 1], port)))?;
    let listener = socket
        .listen(1024)
        .with_context(|| format!("cannot bind dashboard port {port}"))?;
    println!("IORA Dev Manager dashboard: {url}   (Ctrl+C stops the daemon)");
    let result = axum::serve(listener, web::router(daemon)).await;
    let _ = std::fs::remove_file(&daemon_file);
    result?;
    Ok(())
}

/// Run an action through the daemon when one is alive, otherwise one-shot locally.
async fn run_with_daemon<F, Fut>(
    root: Option<PathBuf>,
    method: &str,
    path: &str,
    body: Option<Value>,
    local: F,
) -> Result<()>
where
    F: Fn(Option<PathBuf>) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    if let Some((_, port)) = daemon_info(root.clone()) {
        print_result(delegate(port, method, path, body).await?)?;
    } else {
        local(root).await?;
    }
    Ok(())
}

/// Locate a live daemon via .cache/daemon.json and return its (pid, port).
fn daemon_info(root: Option<PathBuf>) -> Option<(u32, u16)> {
    let manager = Manager::discover(root).ok()?;
    let path = manager.root.join(".cache/daemon.json");
    let value: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    let pid = value["pid"].as_u64()? as u32;
    let port = value["port"].as_u64()? as u16;
    state::process_alive(pid).then_some((pid, port))
}

async fn delegate(port: u16, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    let url = format!("http://127.0.0.1:{port}{path}");
    let client = reqwest::Client::new();
    let request = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        _ => anyhow::bail!("unsupported method {method}"),
    };
    let request = if let Some(body) = body {
        request
            .header("content-type", "application/json")
            .body(body.to_string())
    } else {
        request
    };
    let response = request.send().await?;
    let text = response.text().await?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

fn print_result(value: Value) -> Result<()> {
    let message = value["message"].as_str().unwrap_or("ok").to_string();
    if value["ok"].as_bool().unwrap_or(false) {
        println!("{message}");
        Ok(())
    } else {
        anyhow::bail!("{message}")
    }
}

fn yes(value: bool) -> &'static str {
    if value {
        "OK"
    } else {
        "Unavailable"
    }
}
