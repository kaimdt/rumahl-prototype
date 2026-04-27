use crate::catalog::Component;
use anyhow::{anyhow, bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

const DEVICE_BRIDGE_COMPONENT: &str = "iora-dev-bridge";

const MISSING_TARGET_MARKERS: &[&str] = &[
    "target may not be installed",
    "can't find crate for `core`",
    "can't find crate for `std`",
];

fn command_exists(cmd: &str) -> bool {
    std::process::Command::new(cmd)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn docker_mount_path(path: &Path) -> String {
    let path_str = path.display().to_string();
    if cfg!(windows) {
        let mut normalized = path_str.replace('\\', "/");
        if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
            let drive = normalized.chars().next().unwrap().to_ascii_uppercase();
            normalized = normalized[2..].trim_start_matches('/').to_string();
            if normalized.is_empty() {
                return format!("{}:/", drive);
            }
            return format!("{}:/{}", drive, normalized);
        }
        return normalized;
    }
    path_str
}

/// Locate the workspace root (the dir holding `backend/Cargo.toml`).
pub fn workspace_root() -> Result<PathBuf> {
    let cwd = std::env::current_dir().context("cwd")?;
    let mut p: &std::path::Path = &cwd;
    loop {
        if p.join("backend").join("Cargo.toml").is_file() {
            return Ok(p.to_path_buf());
        }
        if p.join("Cargo.toml").is_file() && p.join("iora-shared").is_dir() {
            // Already inside backend/.
            return Ok(p.parent().unwrap_or(p).to_path_buf());
        }
        match p.parent() {
            Some(parent) => p = parent,
            None => bail!(
                "could not locate IORA workspace root from {} \
                 — run from inside the iora-os checkout",
                cwd.display()
            ),
        }
    }
}

fn target_dir(root: &std::path::Path) -> PathBuf {
    root.join("backend").join("target")
}

fn is_device_bridge(c: &Component) -> bool {
    c.name == DEVICE_BRIDGE_COMPONENT
}

fn component_build_root(root: &Path, c: &Component) -> PathBuf {
    if is_device_bridge(c) {
        root.join("backend").join("dev").join(DEVICE_BRIDGE_COMPONENT)
    } else {
        root.join("backend")
    }
}

fn component_target_dir(root: &Path, c: &Component) -> PathBuf {
    if is_device_bridge(c) {
        component_build_root(root, c).join("target")
    } else {
        target_dir(root)
    }
}

fn cargo_build_command(c: &Component, target: &str) -> Vec<String> {
    let mut args = vec!["build".to_string(), "--release".to_string()];
    if is_device_bridge(c) {
        args.push("--bin".to_string());
        args.push(c.name.to_string());
    } else {
        args.push("-p".to_string());
        args.push(c.name.to_string());
    }
    args.push("--target".to_string());
    args.push(target.to_string());
    args
}

pub fn must_build_on_host(c: &Component) -> bool {
    is_device_bridge(c)
}

pub fn watch_dirs(c: &Component) -> Result<Vec<PathBuf>> {
    let root = workspace_root()?;
    if is_device_bridge(c) {
        return Ok(vec![component_build_root(&root, c).join("src")]);
    }
    let backend = root.join("backend");
    Ok(vec![
        backend.join(c.name).join("src"),
        backend.join("iora-shared").join("src"),
    ])
}

pub fn existing_binary(c: &Component, target: &str) -> Result<PathBuf> {
    let root = workspace_root()?;
    let p = component_target_dir(&root, c)
        .join(target)
        .join("release")
        .join(c.name);
    if !p.is_file() {
        bail!(
            "no built binary at {} — run without --no-build, or `cargo build --release -p {} --target {target}`",
            p.display(),
            c.name
        );
    }
    Ok(p)
}

async fn rustup_target_add(target: &str) -> Result<()> {
    if !command_exists("rustup") {
        return Ok(());
    }

    let status = Command::new("rustup")
        .arg("target")
        .arg("add")
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .context("running rustup target add")?;

    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("rustup target add {target} failed"))
    }
}

fn output_text(stdout: &[u8], stderr: &[u8]) -> String {
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(stdout));
    text.push_str(&String::from_utf8_lossy(stderr));
    text
}

fn missing_target_error(output: &str) -> bool {
    MISSING_TARGET_MARKERS.iter().any(|marker| output.contains(marker))
}

fn tail_lines(output: &str, count: usize) -> String {
    let lines: Vec<&str> = output.lines().collect();
    let start = lines.len().saturating_sub(count);
    lines[start..].join("\n")
}

async fn cargo_build_once(c: &Component, target: &str, backend: &Path) -> Result<(bool, String)> {
    let mut cmd = Command::new("cargo");
    cmd.args(cargo_build_command(c, target))
        .current_dir(backend)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await
        .with_context(|| format!("spawn cargo (cwd={})", backend.display()))?;

    let text = output_text(&output.stdout, &output.stderr);
    print!("{}", text);

    Ok((output.status.success(), text))
}

async fn docker_release(c: &Component, target: &str) -> Result<PathBuf> {
    if !command_exists("docker") {
        bail!("docker is not installed or not available on PATH")
    }

    let root = workspace_root()?;
    let build_root = component_build_root(&root, c);
    let build_root_mount = docker_mount_path(&build_root);
    let target_arg = target.to_string();
    let build_cmd_text = cargo_build_command(c, target).join(" ");

    let mut build_cmd = Command::new("docker");
    build_cmd
        .arg("run")
        .arg("--rm")
        .arg("--platform")
        .arg("linux/amd64")
        .arg("-v")
        .arg(format!("{}:/app/build", build_root_mount))
        .arg("-w")
        .arg("/app/build")
        .arg("rust:1.90")
        .arg("sh")
        .arg("-lc")
        .arg(format!(
            "apt-get update >/dev/null 2>&1 && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu build-essential pkg-config libssl-dev git curl ca-certificates >/dev/null 2>&1 && rustup target add {target_arg} >/dev/null 2>&1 && cargo {build_cmd_text}",
        ))
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let status = build_cmd
        .status()
        .await
        .context("spawning docker cross-compile container")?;

    if !status.success() {
        bail!("Docker cross-compile failed for {} (target {})", c.name, target);
    }

    existing_binary(c, target)
}

pub async fn cargo_release(c: &Component, target: &str) -> Result<PathBuf> {
    let root = workspace_root()?;
    let backend = component_build_root(&root, c);

    let mut attempted_rustup = false;
    if command_exists("rustup") && rustup_target_add(target).await.is_ok() {
        attempted_rustup = true;
    }

    let (status_ok, output) = cargo_build_once(c, target, &backend).await?;
    if status_ok {
        return existing_binary(c, target);
    }

    if !attempted_rustup && command_exists("rustup") && missing_target_error(&output) {
        eprintln!(
            "cargo build for {} reported a missing Rust target; attempting `rustup target add {}` and retrying...",
            c.name,
            target
        );
        rustup_target_add(target).await?;

        let (retry_ok, retry_output) = cargo_build_once(c, target, &backend).await?;
        if retry_ok {
            return existing_binary(c, target);
        }

        if command_exists("docker") {
            eprintln!(
                "cargo retry still failed for {} (target {}) — falling back to Docker cross-compile...",
                c.name,
                target
            );
            return docker_release(c, target).await;
        }

        return Err(anyhow!(
            "cargo build failed for {} (target {}) after installing the Rust target\n{}",
            c.name,
            target,
            tail_lines(&retry_output, 30)
        ));
    }

    if command_exists("docker") {
        eprintln!(
            "cargo build failed for {} (target {}) — falling back to Docker cross-compile...",
            c.name,
            target
        );
        return docker_release(c, target).await;
    }

    Err(anyhow!(
        "cargo build failed for {} (target {})\n{}",
        c.name,
        target,
        tail_lines(&output, 30)
    ))
}
