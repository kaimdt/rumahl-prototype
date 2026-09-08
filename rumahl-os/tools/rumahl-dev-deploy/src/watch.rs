use crate::{build, catalog, client::Client};
use anyhow::{bail, Context, Result};
use colored::Colorize;
use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

pub async fn run(
    client: Client,
    components: Vec<String>,
    target: String,
    build_mode: String,
    automatic: bool,
    debounce_ms: u64,
) -> Result<()> {
    if components.is_empty() && !automatic {
        bail!("no components given — pick from `rumahl-dev-deploy list`");
    }
    let entries: Vec<_> = if automatic {
        catalog::all()
    } else {
        components
            .iter()
            .map(|n| {
                catalog::lookup(n)
                    .with_context(|| format!("unknown component `{n}`"))
            })
            .collect::<Result<Vec<_>>>()?
    };

    let mut watch_dirs: Vec<PathBuf> = Vec::new();
    for e in &entries {
        watch_dirs.extend(build::watch_dirs(e)?);
    }

    let (tx, rx) = mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(debounce_ms), tx)?;
    for d in &watch_dirs {
        if d.is_dir() {
            debouncer
                .watcher()
                .watch(d, RecursiveMode::Recursive)
                .with_context(|| format!("watch {}", d.display()))?;
            println!("{} {}", "watching".dimmed(), d.display());
        }
    }
    println!(
        "{} press Ctrl-C to stop. Saving any source file triggers a rebuild + deploy{}.",
        "▶".bold()
        , if automatic { " in automatic mode" } else { "" }
    );

    loop {
        match rx.recv_timeout(Duration::from_secs(86400)) {
            Ok(Ok(events)) => {
                let touched: HashSet<PathBuf> = events.into_iter().map(|e| e.path).collect();
                if touched.is_empty() {
                    continue;
                }
                // Only rebuild components whose tree was actually touched (or always if shared).
                for e in &entries {
                    let strategy = build::resolve_strategy(e, &target, &build_mode);
                    let effective_build_mode = if build::must_build_on_host(e) {
                        "host"
                    } else if strategy == build::BuildStrategy::Device {
                        "device"
                    } else {
                        "host"
                    };
                    let component_dirs = build::watch_dirs(e)?;
                    if touched.iter().any(|p| component_dirs.iter().any(|dir| p.starts_with(dir))) {
                        println!();
                        println!("{} {} ({})", "▶ rebuild".bold(), e.name.cyan(), strategy.label().dimmed());
                        if effective_build_mode == "device" {
                            match client.build_replace_remote(&e.name, &e.target_path, Some(e.unit.as_str())).await {
                                Ok(resp) => println!(
                                    "{} {} ({} bytes)",
                                    "✓ deployed".green(),
                                    e.name,
                                    resp["bytes"]
                                ),
                                Err(err) => eprintln!("{} device build: {err:#}", "✗".red()),
                            }
                        } else {
                            if build::must_build_on_host(e) {
                                println!("{} {} uses host bridge update path", "▶ info".bold(), e.name.cyan());
                            }
                            match build::cargo_release_with_mode(e, &target, &build_mode).await {
                                Ok(bin) => {
                                    let unit = e.unit.as_str();
                                    match client
                                        .replace_binary(&bin, &e.target_path, Some(unit))
                                        .await
                                    {
                                        Ok(resp) => println!(
                                            "{} {} ({} bytes)",
                                            "✓ deployed".green(),
                                            e.name,
                                            resp["bytes"]
                                        ),
                                        Err(err) => eprintln!("{} upload: {err:#}", "✗".red()),
                                    }
                                }
                                Err(err) => eprintln!("{} build: {err:#}", "✗".red()),
                            }
                        }
                    }
                }
            }
            Ok(Err(e)) => eprintln!("{} watcher: {e:?}", "✗".red()),
            Err(_) => continue,
        }
    }
}
