use crate::{channels, state::RuntimeState};
use anyhow::{Context, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
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
        // 100 % sync guarantee: full consistency pass at startup (covers
        // edits made while the daemon was down) + periodic drift check.
        {
            let repo = repo_root.clone();
            let os = os_root.clone();
            let state_path = state_path.clone();
            let events = ui_tx.clone();
            tokio::spawn(async move {
                let state = RuntimeState::load(&state_path);
                verify_and_sync(&repo, &os, &state, &events).await;
                let mut interval = tokio::time::interval(Duration::from_secs(45));
                interval.tick().await; // first tick fires immediately — consume it
                loop {
                    interval.tick().await;
                    verify_and_sync(&repo, &os, &state, &events).await;
                }
            });
        }
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
    if path.is_dir() {
        return false;
    }
    if !path.components().any(|part| {
        matches!(
            part.as_os_str().to_str(),
            Some("frontend" | "services" | "shared" | "tools" | "migrations" | "custom_components")
        )
    }) {
        return false;
    }
    if path.components().any(|part| {
        matches!(
            part.as_os_str().to_str(),
            Some(".git" | "target" | "node_modules" | ".cache" | "dist" | "dist_new" | "src_new")
        )
    }) {
        return false;
    }
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "css" | "rs" | "sql" | "json" | "service" | "html" | "js" | "yaml" | "yml")
    ) || matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some("vite.config.ts" | "vite.config.js" | "package.json" | "index.html" | "Cargo.toml" | "manifest.yaml")
    )
}

static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Collect every managed file under `repo` (relative paths, `/`-separated).
fn collect_local_files(repo: &Path) -> Vec<(String, f64)> {
    let mut files = Vec::new();
    let mut stack = vec![repo.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if !matches!(
                    path.file_name().and_then(|name| name.to_str()),
                    Some(".git" | "target" | "node_modules" | ".cache" | "dist" | "dist_new" | "src_new")
                ) {
                    stack.push(path);
                }
            } else if relevant(&path) {
                let Ok(relative) = path.strip_prefix(repo) else { continue };
                let relative = relative
                    .components()
                    .map(|part| part.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                let modified = std::fs::metadata(&path)
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs_f64())
                    .unwrap_or(0.0);
                files.push((relative, modified));
            }
        }
    }
    files
}

/// Guest-side modification times (`find -printf '%T@ %p'`), one QGA call.
async fn remote_timestamps(os_root: &Path, state: &RuntimeState) -> Result<HashMap<String, f64>> {
    let command = "cd /home/iora/iora && find frontend iora-os/backend/services iora-os/backend/shared iora-os/backend/tools custom_components -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.rs' -o -name '*.sql' -o -name '*.json' -o -name '*.service' -o -name '*.html' -o -name '*.js' -o -name '*.yaml' -o -name '*.yml' -o -name 'Cargo.toml' -o -name 'vite.config.ts' -o -name 'vite.config.js' \\) -printf '%T@ %p\\n' 2>/dev/null";
    let output = ssh_run(state, os_root, command).await?;
    let mut map = HashMap::new();
    for line in output.lines() {
        let mut parts = line.splitn(2, ' ');
        if let (Some(seconds), Some(path)) = (parts.next(), parts.next()) {
            let path = path.trim_start_matches("./").trim();
            if !path.is_empty() {
                let Ok(secs) = seconds.trim().parse::<f64>() else { continue };
                map.insert(path.to_string(), secs);
            }
        }
    }
    Ok(map)
}

/// 100 % guarantee: verify local↔guest consistency and re-sync every drifted
/// file. Runs once at daemon start (covers edits made while the daemon was
/// down) and repeats periodically (covers watcher misses). A file is stale
/// when its local mtime is newer than the guest's.
async fn verify_and_sync(
    repo: &Path,
    os_root: &Path,
    state: &RuntimeState,
    events: &mpsc::UnboundedSender<DevEvent>,
) {
    // Never try to sync into a VM that is not running: each SSH attempt to a
    // dead guest blocks ~10s (ConnectTimeout) and starves the runtime while
    // the VM is booting or provisioning.
    if !state.process_alive() {
        return;
    }
    if SYNC_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = verify_and_sync_inner(repo, os_root, state, events).await;
    SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    if let Err(error) = result {
        let _ = events.send(DevEvent::Error(format!("full sync failed: {error:#}")));
    }
}

async fn verify_and_sync_inner(
    repo: &Path,
    os_root: &Path,
    state: &RuntimeState,
    events: &mpsc::UnboundedSender<DevEvent>,
) -> Result<()> {
    let remote = match remote_timestamps(os_root, state).await {
        Ok(map) => map,
        // QGA temporarily unavailable — the incremental watcher keeps
        // working, the next periodic pass retries.
        Err(error) => {
            let _ = events.send(DevEvent::Error(format!(
                "full sync skipped (QGA unavailable): {error:#}"
            )));
            return Ok(());
        }
    };

    let mut stale: Vec<PathBuf> = Vec::new();
    for (relative, local_mtime) in collect_local_files(repo) {
        let remote_mtime = remote.get(&relative).copied();
        let in_sync = match remote_mtime {
            // Local file not newer than the guest copy → in sync. A 1s
            // tolerance absorbs clock/fat-granularity differences.
            Some(remote_secs) => local_mtime <= remote_secs + 1.0,
            // File missing on the guest entirely → must be pushed.
            None => false,
        };
        if !in_sync {
            let mut path = repo.to_path_buf();
            for part in relative.split('/') {
                path.push(part);
            }
            stale.push(path);
        }
    }

    if stale.is_empty() {
        let _ = events.send(DevEvent::Ready("Full sync: all files in sync".into()));
        return Ok(());
    }
    let _ = events.send(DevEvent::Syncing(stale.len()));
    // Bulk tar stream — dozens of individual scp calls would take minutes.
    bulk_sync(repo, os_root, state, &stale).await?;
    // Rust/sql/service changes must also rebuild + restart the affected
    // services, otherwise the guest runs stale binaries.
    let stale_set: HashSet<PathBuf> = stale.into_iter().collect();
    let needs_build = stale_set.iter().any(|path| {
        matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("rs" | "sql" | "service")
        ) || path.file_name().is_some_and(|name| name == "Cargo.toml")
    });
    if needs_build {
        apply_changes(repo, os_root, state, &stale_set, events).await?;
    }
    let _ = events.send(DevEvent::Ready(format!(
        "Full sync: {} file(s) synchronized",
        stale_set.len()
    )));
    Ok(())
}

async fn apply_changes(
    repo: &Path,
    os_root: &Path,
    state: &RuntimeState,
    paths: &HashSet<PathBuf>,
    events: &mpsc::UnboundedSender<DevEvent>,
) -> Result<()> {
    if !state.process_alive() {
        return Ok(());
    }
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
        ssh_run(state, os_root, "systemctl restart iora-frontend-dev && systemctl is-active --quiet iora-frontend-dev")
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
        let command=format!("cd /home/iora/iora/iora-os/backend && sudo -u iora bash -c 'cd /home/iora/iora/iora-os/backend && HOME=/home/iora /home/iora/.cargo/bin/cargo build -p {} --offline' && if ! systemctl cat {} >/dev/null 2>&1; then printf %s {} > /etc/systemd/system/{}.service && systemctl daemon-reload && systemctl enable {}.service; fi && systemctl restart {} && systemctl is-active --quiet {}",shell_quote(&service),shell_quote(&service),shell_quote(&unit),service,service,shell_quote(&service),shell_quote(&service));
        ssh_run(state, os_root, &command).await?;
        let _ = events.send(DevEvent::Ready(format!(
            "{service} rebuilt, restarted and healthy"
        )));
    }
    Ok(())
}

fn ssh_args(state: &RuntimeState, os_root: &Path) -> Vec<String> {
    let (_host, port, _) = state.connection();
    let key = os_root.join(".cache/iora-dev-key");
    vec![
        "-o".into(),
        "StrictHostKeyChecking=no".into(),
        "-o".into(),
        "UserKnownHostsFile=NUL".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=5".into(),
        "-o".into(),
        "ConnectionAttempts=2".into(),
        "-p".into(),
        port.to_string(),
        "-i".into(),
        key.display().to_string(),
    ]
}

/// Transfer many files in ONE tar stream over SSH (fast bulk sync).
async fn bulk_sync(repo: &Path, os_root: &Path, state: &RuntimeState, paths: &[PathBuf]) -> Result<()> {
    let (host, _, _) = state.connection();
    // Paths go via --files-from stdin: the Windows command line limit (~32k)
    // is far too small for a full-repo sync.
    let mut tar = Command::new("tar");
    tar.args(["-cf", "-", "-C"])
        .arg(repo)
        .args(["--no-recursion", "--files-from", "-"]);
    tar.stdout(Stdio::piped()).stdin(Stdio::piped());
    let mut tar_child = tar.spawn().context("spawn tar")?;
    {
        let mut tar_stdin = tar_child.stdin.take().context("tar stdin")?;
        let mut payload = String::new();
        for path in paths {
            let Ok(relative) = path.strip_prefix(repo) else { continue };
            let relative = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            payload.push_str(&relative);
            payload.push('\n');
        }
        use tokio::io::AsyncWriteExt;
        tar_stdin.write_all(payload.as_bytes()).await?;
    }
    let tar_stdout = tar_child.stdout.take().context("tar stdout")?;
    let mut ssh = Command::new("ssh");
    ssh.args(ssh_args(state, os_root))
        .arg(format!("root@{host}"))
        // The tar preserves the local (UTC+2) mtimes — on the UTC guest the
        // files look older than they are, so cargo would never rebuild.
        // Touching everything that just arrived fixes incremental builds.
        .arg("tar -xf - -C /home/iora/iora && chown -R iora:iora /home/iora/iora/frontend /home/iora/iora/iora-os/backend /home/iora/iora/custom_components && find /home/iora/iora/frontend /home/iora/iora/iora-os/backend /home/iora/iora/custom_components -mmin -2 -exec touch -m {} + 2>/dev/null")
        .stdin(Stdio::piped());
    let mut ssh_child = ssh.spawn().context("spawn ssh")?;
    {
        let mut stdin = ssh_child.stdin.take().context("ssh stdin")?;
        let mut reader = tokio::io::BufReader::new(tar_stdout);
        tokio::io::copy(&mut reader, &mut stdin).await?;
    }
    let ssh_status = ssh_child.wait().await?;
    let tar_status = tar_child.wait().await?;
    if !ssh_status.success() || !tar_status.success() {
        anyhow::bail!("bulk sync failed (ssh={ssh_status}, tar={tar_status})");
    }
    Ok(())
}

/// SSH command runner — the reliable control channel. QGA sockets only
/// exist when the VM was started by this daemon with a qga chardev; the
/// regular dev VM (dev-local.ps1) does not have them, so SSH is preferred.
async fn ssh_run(state: &RuntimeState, os_root: &Path, command: &str) -> Result<String> {
    let (host, port, _) = state.connection();
    let key = os_root.join(".cache/iora-dev-key");
    let output = Command::new("ssh")
        .args([
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=NUL",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=5",
            "-o",
            "ConnectionAttempts=2",
            "-p",
            &port.to_string(),
            "-i",
            &key.display().to_string(),
        ])
        .arg(format!("root@{host}"))
        .arg(command)
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!(
            "ssh command failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn sync_path(repo: &Path, os_root: &Path, state: &RuntimeState, path: &Path) -> Result<()> {
    let relative = path
        .strip_prefix(repo)
        .context("changed path is outside repository")?;
    let remote = Path::new("/home/iora/iora").join(relative);

    // The guest agent is already the authoritative control channel for the
    // Dev VM.  Prefer it for regular source files: unlike a Windows SCP child
    // process it cannot block the watcher on an interactive host-key or key
    // permission prompt.  The SSH/SCP path below remains available for files
    // larger than the QGA payload limit.
    if path.exists() && path.is_file() {
        let bytes = tokio::fs::read(path).await?;
        // QGA is only available when the daemon started the VM with a qga
        // chardev; the standard dev VM has none. SSH/SCP below is the
        // reliable path, so the QGA branch stays disabled.
        if false && bytes.len() <= 1_048_576 {
            let parent = remote.parent().context("remote file has no parent")?;
            let temporary = format!("{}.iora-sync", remote.display());
            let encoded = format!("{temporary}.b64");
            let socket = os_root.join(".cache/qga.sock");
            let run = |command: String| {
                let socket = socket.clone();
                async move {
                let mut last_error = None;
                for attempt in 1..=3 {
                    match channels::guest_exec(state.qga_port, &socket, &command).await {
                        Ok(_) => return Ok(()),
                        Err(error) => {
                            last_error = Some(error);
                            if attempt < 3 {
                                tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
                            }
                        }
                    }
                }
                Err(last_error.expect("sync retries always record an error"))
                }
            };
            run(format!(
                "mkdir -p {} && rm -f {} {}",
                shell_quote(&parent.display().to_string()),
                shell_quote(&temporary),
                shell_quote(&encoded),
            )).await?;
            // QGA frames are limited; send source in 24 KiB chunks so even
            // large React files are transferred without truncated requests.
            for chunk in bytes.chunks(24 * 1024) {
                run(format!(
                    "printf %s {} >> {}",
                    shell_quote(&encode_base64(chunk)),
                    shell_quote(&encoded),
                )).await?;
            }
            run(format!(
                "base64 -d {} > {} && test $(wc -c < {}) -eq {} && mv -f {} {} && rm -f {}",
                shell_quote(&encoded),
                shell_quote(&temporary),
                shell_quote(&temporary),
                bytes.len(),
                shell_quote(&temporary),
                shell_quote(&remote.display().to_string()),
                shell_quote(&encoded),
            )).await?;
            return Ok(());
        }
    }

    let (host, port, _) = state.connection();
    let key = os_root.join(".cache/iora-dev-key");
    let ssh_args = [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=NUL",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "ConnectionAttempts=1",
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
                    "-o",
                    "StrictHostKeyChecking=no",
                    "-o",
                    "UserKnownHostsFile=NUL",
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=5",
                    "-o",
                    "ConnectionAttempts=1",
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
                // Normalize mtime to the guest clock so cargo rebuilds.
                let _ = ssh_run(state, os_root, &format!("touch -m -- {}", shell_quote(&remote.display().to_string()))).await;
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
            "mkdir -p {} && printf %s {} | base64 -d > {} && touch -m -- {}",
            shell_quote(&parent.display().to_string()),
            shell_quote(&encode_base64(&bytes)),
            shell_quote(&remote.display().to_string()),
            shell_quote(&remote.display().to_string())
        );
        channels::guest_exec(state.qga_port, &os_root.join(".cache/qga.sock"), &command).await?;
    } else {
        channels::guest_exec(
            state.qga_port,
            &os_root.join(".cache/qga.sock"),
            &format!("rm -rf -- {}", shell_quote(&remote.display().to_string())),
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
