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
    debounce_ms: u64,
) -> Result<()> {
    if components.is_empty() {
        bail!("no components given — pick from `iora-dev-deploy list`");
    }
    let entries: Vec<_> = components
        .iter()
        .map(|n| {
            catalog::lookup(n)
                .with_context(|| format!("unknown component `{n}`"))
        })
        .collect::<Result<Vec<_>>>()?;

    let root = build::workspace_root()?;
    let backend = root.join("backend");

    // Watch each crate's directory plus the shared crate (which most depend on).
    let mut watch_dirs: Vec<PathBuf> = Vec::new();
    for e in &entries {
        watch_dirs.push(backend.join(e.name).join("src"));
    }
    watch_dirs.push(backend.join("iora-shared").join("src"));

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
        "{} press Ctrl-C to stop. Saving any source file triggers a rebuild + deploy.",
        "▶".bold()
    );

    loop {
        match rx.recv_timeout(Duration::from_secs(86400)) {
            Ok(Ok(events)) => {
                let touched: HashSet<PathBuf> = events.into_iter().map(|e| e.path).collect();
                if touched.is_empty() {
                    continue;
                }
                // Only rebuild components whose tree was actually touched (or always if shared).
                let shared_changed = touched.iter().any(|p| p.starts_with(backend.join("iora-shared")));
                for e in &entries {
                    let crate_dir = backend.join(e.name);
                    if shared_changed || touched.iter().any(|p| p.starts_with(&crate_dir)) {
                        println!();
                        println!("{} {}", "▶ rebuild".bold(), e.name.cyan());
                        match build::cargo_release(e, &target).await {
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
            Ok(Err(e)) => eprintln!("{} watcher: {e:?}", "✗".red()),
            Err(_) => continue,
        }
    }
}
