use crate::{channels, state::RuntimeState};
use anyhow::{Context, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{process::Command, sync::mpsc};

#[derive(Debug, Clone)]
pub enum DevEvent {
    Watching,
    Syncing(usize),
    Building(String),
    Ready(String),
    Error(String),
}

pub fn spawn(
    repo_root: PathBuf,
    os_root: PathBuf,
    state_path: PathBuf,
) -> mpsc::UnboundedReceiver<DevEvent> {
    let (ui_tx, ui_rx) = mpsc::unbounded_channel();
    let (file_tx, mut file_rx) = mpsc::channel(512);
    tokio::spawn(async move {
        let callback_tx = file_tx.clone();
        let mut watcher: RecommendedWatcher =
            match notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    if matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    ) {
                        for path in event.paths {
                            let _ = callback_tx.blocking_send(path);
                        }
                    }
                }
            }) {
                Ok(value) => value,
                Err(error) => {
                    let _ = ui_tx.send(DevEvent::Error(format!(
                        "watcher initialization failed: {error}"
                    )));
                    return;
                }
            };
        if let Err(error) = watcher.watch(&repo_root, RecursiveMode::Recursive) {
            let _ = ui_tx.send(DevEvent::Error(format!("cannot watch repository: {error}")));
            return;
        }
        let _ = ui_tx.send(DevEvent::Watching);
        while let Some(first) = file_rx.recv().await {
            let mut paths = HashSet::from([first]);
            tokio::time::sleep(Duration::from_millis(350)).await;
            while let Ok(path) = file_rx.try_recv() {
                paths.insert(path);
            }
            paths.retain(|path| relevant(path));
            if paths.is_empty() {
                continue;
            }
            let _ = ui_tx.send(DevEvent::Syncing(paths.len()));
            let state = RuntimeState::load(&state_path);
            if let Err(error) = apply_changes(&repo_root, &os_root, &state, &paths, &ui_tx).await {
                let _ = ui_tx.send(DevEvent::Error(format!("live update failed: {error:#}")));
            }
        }
    });
    ui_rx
}

fn relevant(path: &Path) -> bool {
    !path.components().any(|part| {
        matches!(
            part.as_os_str().to_str(),
            Some(".git" | "target" | "node_modules" | ".cache")
        )
    })
}

async fn apply_changes(
    repo: &Path,
    os_root: &Path,
    state: &RuntimeState,
    paths: &HashSet<PathBuf>,
    events: &mpsc::UnboundedSender<DevEvent>,
) -> Result<()> {
    for path in paths {
        sync_path(repo, os_root, state, path).await?;
    }
    let frontend_restart = paths.iter().any(|path| {
        matches!(
            path.file_name().and_then(|name| name.to_str()),
            Some(
                "vite.config.ts"
                    | "vite.config.js"
                    | "package.json"
                    | "tsconfig.json"
                    | "postcss.config.js"
                    | "tailwind.config.js"
            )
        ) && path.components().any(|part| part.as_os_str() == "frontend")
    });
    if frontend_restart {
        channels::guest_exec(
            state.qga_port,
            &os_root.join(".cache/qga.sock"),
            "systemctl restart iora-frontend-dev && systemctl is-active --quiet iora-frontend-dev",
        )
        .await?;
    }
    let rust_paths = paths
        .iter()
        .filter(|path| {
            matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("rs" | "sql" | "service")
            ) || path.file_name().is_some_and(|name| name == "Cargo.toml")
        })
        .cloned()
        .collect::<Vec<_>>();
    if rust_paths.is_empty() {
        let _ = events.send(DevEvent::Ready("Frontend HMR sources synchronized".into()));
        return Ok(());
    }
    let services = affected_services(&os_root.join("backend"), &rust_paths).await?;
    for service in services {
        let _ = events.send(DevEvent::Building(service.clone()));
        let unit = native_unit(&service);
        let command=format!("cd /home/iora/iora/iora-os/backend && cargo build -p {} && if ! systemctl cat {} >/dev/null 2>&1; then printf %s {} > /etc/systemd/system/{}.service && systemctl daemon-reload && systemctl enable {}.service; fi && systemctl restart {} && systemctl is-active --quiet {}",shell_quote(&service),shell_quote(&service),shell_quote(&unit),service,service,shell_quote(&service),shell_quote(&service));
        channels::guest_exec(state.qga_port, &os_root.join(".cache/qga.sock"), &command).await?;
        let _ = events.send(DevEvent::Ready(format!(
            "{service} rebuilt, restarted and healthy"
        )));
    }
    Ok(())
}

async fn sync_path(repo: &Path, os_root: &Path, state: &RuntimeState, path: &Path) -> Result<()> {
    let relative = path
        .strip_prefix(repo)
        .context("changed path is outside repository")?;
    let remote = Path::new("/home/iora/iora").join(relative);
    let (host, port, _) = state.connection();
    let key = os_root.join(".cache/iora-dev-key");
    let ssh_args = [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "BatchMode=yes",
        "-p",
        &port.to_string(),
        "-i",
        &key.display().to_string(),
    ];
    if path.exists() && path.is_file() {
        let parent = remote.parent().context("remote file has no parent")?;
        let status = Command::new("ssh")
            .args(ssh_args)
            .arg(format!("root@{host}"))
            .arg(format!(
                "mkdir -p {}",
                shell_quote(&parent.display().to_string())
            ))
            .status()
            .await;
        if status.is_ok_and(|value| value.success()) {
            let copied = Command::new("scp")
                .args([
                    "-q",
                    "-P",
                    &port.to_string(),
                    "-i",
                    &key.display().to_string(),
                ])
                .arg(path)
                .arg(format!("root@{host}:{}", remote.display()))
                .status()
                .await?;
            if copied.success() {
                return Ok(());
            }
        }
        let bytes = tokio::fs::read(path).await?;
        if bytes.len() > 1_048_576 {
            anyhow::bail!(
                "{} exceeds the 1 MiB QGA fallback limit",
                relative.display()
            )
        }
        let command = format!(
            "mkdir -p {} && printf %s {} | base64 -d > {}",
            shell_quote(&parent.display().to_string()),
            shell_quote(&encode_base64(&bytes)),
            shell_quote(&remote.display().to_string())
        );
        channels::guest_exec(state.qga_port, &os_root.join(".cache/qga.sock"), &command).await?;
    } else {
        channels::guest_exec(
            state.qga_port,
            &os_root.join(".cache/qga.sock"),
            &format!("rm -f {}", shell_quote(&remote.display().to_string())),
        )
        .await?;
    }
    Ok(())
}

async fn affected_services(backend: &Path, changed: &[PathBuf]) -> Result<Vec<String>> {
    let output = Command::new("cargo")
        .args(["metadata", "--format-version", "1"])
        .current_dir(backend)
        .stdout(Stdio::piped())
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!("cargo metadata failed")
    }
    let metadata: Value = serde_json::from_slice(&output.stdout)?;
    let packages = metadata["packages"]
        .as_array()
        .context("metadata has no packages")?;
    let mut manifests = HashMap::new();
    let mut reverse: HashMap<String, HashSet<String>> = HashMap::new();
    let mut services = HashSet::new();
    for package in packages {
        let name = package["name"].as_str().unwrap_or_default().to_owned();
        let manifest = PathBuf::from(package["manifest_path"].as_str().unwrap_or_default());
        manifests.insert(
            name.clone(),
            manifest.parent().unwrap_or(backend).to_path_buf(),
        );
        if manifest.to_string_lossy().contains("/services/")
            || manifest.to_string_lossy().contains("/apps/system/")
        {
            services.insert(name.clone());
        }
        for dep in package["dependencies"].as_array().into_iter().flatten() {
            if let Some(dep) = dep["name"].as_str() {
                reverse
                    .entry(dep.to_owned())
                    .or_default()
                    .insert(name.clone());
            }
        }
    }
    let mut impacted = HashSet::new();
    for path in changed {
        for (name, root) in &manifests {
            if path.starts_with(root) {
                impacted.insert(name.clone());
            }
        }
    }
    let mut queue = impacted.iter().cloned().collect::<Vec<_>>();
    while let Some(name) = queue.pop() {
        for dependent in reverse.get(&name).into_iter().flatten() {
            if impacted.insert(dependent.clone()) {
                queue.push(dependent.clone());
            }
        }
    }
    let mut result = impacted
        .into_iter()
        .filter(|name| services.contains(name))
        .collect::<Vec<_>>();
    result.sort();
    Ok(result)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn native_unit(service: &str) -> String {
    format!("[Unit]\nDescription=IORA development service {service}\nAfter=network-online.target postgresql.service\nWants=network-online.target\n\n[Service]\nType=simple\nUser=iora\nWorkingDirectory=/home/iora/iora/iora-os/backend\nEnvironment=IORA_ENV=development\nExecStart=/home/iora/iora/iora-os/backend/target/debug/{service}\nRestart=on-failure\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n")
}
fn encode_base64(bytes: &[u8]) -> String {
    const MAP: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = ((chunk[0] as u32) << 16)
            | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8)
            | (chunk.get(2).copied().unwrap_or(0) as u32);
        out.push(MAP[((n >> 18) & 63) as usize] as char);
        out.push(MAP[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            MAP[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            MAP[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64_matches_qga_payload() {
        assert_eq!(encode_base64(b"IORA"), "SU9SQQ==");
    }
    #[test]
    fn ignores_build_outputs() {
        assert!(!relevant(Path::new("frontend/node_modules/a.js")));
        assert!(relevant(Path::new("frontend/src/App.tsx")));
    }
    #[test]
    fn generated_service_unit_runs_like_iora_os_under_systemd() {
        let unit = native_unit("iora-example");
        assert!(unit.contains("User=iora"));
        assert!(unit.contains("After=network-online.target postgresql.service"));
        assert!(unit.contains("target/debug/iora-example"));
    }
}
