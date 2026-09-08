// rumahl-dev-deploy
//
// A developer-machine companion CLI for the **internal, non-public**
// rumahl OS Dev variant.  It performs four jobs:
//
//   1. `discover`  Browse the LAN over mDNS (`_rumahl-dev._tcp.local.`) to
//                  find rumahl OS Dev devices.  Production OS images do not
//                  ship `rumahl-dev-bridge`, so they never appear.
//   2. `connect`   Save a target device + token in
//                  `~/.config/rumahl-dev-deploy/config.toml`.  The CLI then
//                  defaults to that device for subsequent commands.
//   3. `deploy`    `cargo build --release -p <crate>`, then upload the
//                  binary via `POST /dev/replace-binary` and restart the
//                  systemd unit.  The catalog maps crate → unit + target.
//   4. `watch`     File-watch a crate; deploy automatically on every save.
//
// Hard safety property: every connection first calls `GET /dev/status`
// and refuses to proceed unless the response says `variant == "dev"`.
//
// This binary is meant to live in the rumahl workspace and run on the
// developer's laptop; it does NOT ship on any rumahl OS image.

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use colored::Colorize;

mod build;
mod catalog;
mod client;
mod config;
mod daemon;
mod discover;
mod watch;
mod web_ui;

#[derive(Parser, Debug)]
#[command(
    name = "rumahl-dev-deploy",
    version,
    about = "Discover rumahl OS Dev devices and hot-deploy rumahl components"
)]
struct Cli {
    /// Override target device address (e.g. 192.168.1.42 or my-dev.local).
    /// Default port 8101 (rumahl-dev-bridge) is used if no port is specified.
    #[arg(long, env = "RUMAHL_DEV_HOST", global = true)]
    host: Option<String>,

    /// Override dev token (otherwise read from ~/.config/rumahl-dev-deploy/config.toml).
    #[arg(long, env = "RUMAHL_DEV_TOKEN", global = true)]
    token: Option<String>,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Browse the local network for rumahl OS Dev devices.
    Discover {
        /// Seconds to scan before printing results.
        #[arg(long, default_value_t = 4)]
        timeout: u64,
    },

    /// Save a target device + dev token as the default.
    /// The dev bridge port (8101) is used automatically if no port is given.
    Connect {
        /// `host[:port]`, IP, or mDNS instance from `discover`.
        /// Port defaults to 8101 (rumahl-dev-bridge) if omitted.
        host: String,
        /// Hex token printed by the device builder (or read from /etc/ora/dev-token).
        #[arg(long)]
        token: String,
    },

    /// Show `/dev/status` for the configured (or --host) device.
    Status,

    /// List the components the CLI knows how to build & deploy.
    List,

    /// Build and hot-deploy one or more components.
    Deploy {
        /// Component names from `list` (e.g. `rumahl-control rumahl-home`).
        components: Vec<String>,
        /// Skip the build step (use the existing target/release/<bin>).
        #[arg(long)]
        no_build: bool,
        /// Don't restart the systemd unit on the device after upload.
        #[arg(long)]
        no_restart: bool,
        /// Cross-compile target triple (default: aarch64-unknown-linux-gnu).
        #[arg(long, default_value = "aarch64-unknown-linux-gnu")]
        target: String,
        /// Build mode: `device` builds on the rumahl system via dev-bridge, `host` builds locally.
        #[arg(long, default_value = "device")]
        build_mode: String,
    },

    /// Watch one or more crates and auto-deploy on file changes.
    Watch {
        components: Vec<String>,
        #[arg(long, default_value = "aarch64-unknown-linux-gnu")]
        target: String,
        #[arg(long, default_value = "device")]
        build_mode: String,
        #[arg(long, default_value_t = false)]
        automatic: bool,
        /// Debounce window for file changes (milliseconds).
        #[arg(long, default_value_t = 800)]
        debounce_ms: u64,
    },

    /// Restart a systemd unit on the device.
    Restart {
        /// e.g. `rumahl-control` (`.service` is appended automatically).
        unit: String,
    },

    /// Tail compose logs of a service.
    Logs {
        /// docker-compose service name.
        service: String,
        #[arg(long, default_value_t = 200)]
        tail: u32,
    },

    /// systemctl try-reload-or-restart on the device.
    Reload {
        /// systemd unit (e.g. rumahl-control).
        unit: String,
    },

    /// `docker compose up -d --force-recreate <svc>` on the device.
    ComposeReload {
        /// docker-compose service name.
        service: String,
    },

    /// Run as a long-lived HTTP/WS API daemon for the VS Code extension.
    Daemon {
        /// Listen address (default 127.0.0.1:8765).
        #[arg(long, default_value = "127.0.0.1:8765")]
        bind: std::net::SocketAddr,
        /// Override the auth token (otherwise read/created in
        /// ~/.config/rumahl-dev-deploy/daemon.token).
        #[arg(long, env = "RUMAHL_DEV_DAEMON_TOKEN")]
        token: Option<String>,
        /// Print the full token to stdout instead of just a fingerprint.
        #[arg(long)]
        show_token: bool,
        /// Don't open the browser on startup.
        #[arg(long)]
        no_browser: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rumahl_dev_deploy=info,mdns_sd=off,warn".into()),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Discover { timeout } => discover::run(timeout).await,
        Cmd::Connect { host, token } => {
            let cfg = config::Config { host: host.clone(), token: token.clone() };
            let path = config::save(&cfg)?;
            // Verify immediately.
            let c = client::Client::new(&cfg.host, &cfg.token)?;
            let s = c.status().await.context("verifying device")?;
            if s.variant != "dev" {
                bail!(
                    "{} device variant is `{}`, not `dev` — refusing to save",
                    "ABORT:".red().bold(),
                    s.variant
                );
            }
            println!(
                "{} saved {} (build {}, host {}) to {}",
                "✓".green(),
                cfg.host,
                s.build,
                s.hostname,
                path.display()
            );
            Ok(())
        }
        Cmd::Status => {
            let (host, token) = resolve_target(&cli.host, &cli.token)?;
            let c = client::Client::new(&host, &token)?;
            let s = c.status().await?;
            println!("{}", serde_json::to_string_pretty(&s)?);
            Ok(())
        }
        Cmd::List => {
            for comp in catalog::all() {
                println!(
                    "{:<28} unit={:<32} target={}",
                    comp.name.cyan(),
                    comp.unit,
                    comp.target_path
                );
            }
            Ok(())
        }
        Cmd::Deploy { components, no_build, no_restart, target, build_mode } => {
            let (host, token) = resolve_target(&cli.host, &cli.token)?;
            let client = client::Client::new(&host, &token)?;
            ensure_dev(&client).await?;
            for name in components {
                deploy_one(&client, &name, no_build, no_restart, &target, &build_mode).await?;
            }
            Ok(())
        }
        Cmd::Watch { components, target, build_mode, automatic, debounce_ms } => {
            let (host, token) = resolve_target(&cli.host, &cli.token)?;
            let client = client::Client::new(&host, &token)?;
            ensure_dev(&client).await?;
            watch::run(client, components, target, build_mode, automatic, debounce_ms).await
        }
        Cmd::Restart { unit } => {
            let (host, token) = resolve_target(&cli.host, &cli.token)?;
            let c = client::Client::new(&host, &token)?;
            ensure_dev(&c).await?;
            let unit = if unit.contains('.') { unit } else { format!("{unit}.service") };
            let r = c.restart_unit(&unit).await?;
            println!("{}", serde_json::to_string_pretty(&r)?);
            Ok(())
        }
        Cmd::Logs { service, tail } => {
            let (host, token) = resolve_target(&cli.host, &cli.token)?;
            let c = client::Client::new(&host, &token)?;
            ensure_dev(&c).await?;
            let r = c.compose_logs(&service, tail).await?;
            println!("{}", r.stdout);
            if !r.stderr.is_empty() {
                eprintln!("{}", r.stderr);
            }
            Ok(())
        }
        Cmd::Reload { unit } => {
            let (host, token) = resolve_target(&cli.host, &cli.token)?;
            let c = client::Client::new(&host, &token)?;
            ensure_dev(&c).await?;
            let unit = if unit.contains('.') { unit } else { format!("{unit}.service") };
            let r = c.reload_unit(&unit).await?;
            println!("{}", serde_json::to_string_pretty(&r)?);
            Ok(())
        }
        Cmd::ComposeReload { service } => {
            let (host, token) = resolve_target(&cli.host, &cli.token)?;
            let c = client::Client::new(&host, &token)?;
            ensure_dev(&c).await?;
            let r = c.reload_compose(&service).await?;
            println!("{}", serde_json::to_string_pretty(&r)?);
            Ok(())
        }
        Cmd::Daemon { bind, token, show_token, no_browser } => {
            daemon::run(bind, token, show_token, no_browser).await
        }
    }
}

fn resolve_target(host_arg: &Option<String>, token_arg: &Option<String>) -> Result<(String, String)> {
    if let (Some(h), Some(t)) = (host_arg, token_arg) {
        return Ok((h.clone(), t.clone()));
    }
    let saved = config::load().context(
        "no saved device — run `rumahl-dev-deploy connect <host> --token <hex>` first",
    )?;
    let host = host_arg.clone().unwrap_or(saved.host);
    let token = token_arg.clone().unwrap_or(saved.token);
    Ok((host, token))
}

async fn ensure_dev(c: &client::Client) -> Result<()> {
    let s = c.status().await.context("contacting device /dev/status")?;
    if s.variant != "dev" {
        bail!(
            "{} target reports variant `{}`, not `dev` — refusing to deploy",
            "ABORT:".red().bold(),
            s.variant
        );
    }
    Ok(())
}

async fn deploy_one(
    client: &client::Client,
    name: &str,
    no_build: bool,
    no_restart: bool,
    target: &str,
    build_mode: &str,
) -> Result<()> {
    let entry = catalog::lookup(name)
        .with_context(|| format!("unknown component `{name}` — see `rumahl-dev-deploy list`"))?;
    let effective_build_mode = build_mode;

    let bin_path = if no_build {
        build::existing_binary(&entry, target)?
    } else if effective_build_mode == "device" {
        println!("{} {} on device", "▶ build".bold(), entry.name.cyan());
        let resp = client
            .build_replace_remote(&entry.name, &entry.target_path, if no_restart { None } else { Some(entry.unit.as_str()) })
            .await?;
        println!(
            "{} {} bytes, sha256={}",
            "✓ deployed".green(),
            resp["bytes"],
            resp["sha256"].as_str().unwrap_or("?")
        );
        if !no_restart {
            let r = &resp["restart"];
            if r["ok"].as_bool().unwrap_or(false) {
                println!("{} {} restarted", "✓".green(), entry.unit);
            } else {
                eprintln!(
                    "{} restart of {} failed (code {}): {}",
                    "✗".red(),
                    entry.unit,
                    r["code"],
                    r["stderr"].as_str().unwrap_or("")
                );
            }
        }
        return Ok(());
    } else {
        println!("{} {} ({})", "▶ build".bold(), entry.name.cyan(), target);
        build::cargo_release(&entry, target).await?
    };

    println!(
        "{} {} → {} on device",
        "▶ upload".bold(),
        bin_path.display(),
        entry.target_path.cyan()
    );
    let unit_for_restart = if no_restart { None } else { Some(entry.unit.as_str()) };
    let resp = client
        .replace_binary(&bin_path, &entry.target_path, unit_for_restart)
        .await?;
    println!(
        "{} {} bytes, sha256={}",
        "✓ deployed".green(),
        resp["bytes"],
        resp["sha256"].as_str().unwrap_or("?")
    );
    if !no_restart {
        let r = &resp["restart"];
        if r["ok"].as_bool().unwrap_or(false) {
            println!("{} {} restarted", "✓".green(), entry.unit);
        } else {
            eprintln!(
                "{} restart of {} failed (code {}): {}",
                "✗".red(),
                entry.unit,
                r["code"],
                r["stderr"].as_str().unwrap_or("")
            );
        }
    }
    Ok(())
}
