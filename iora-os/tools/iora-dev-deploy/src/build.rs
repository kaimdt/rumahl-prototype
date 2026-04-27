use crate::catalog::Component;
use anyhow::{anyhow, bail, Context, Result};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

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

pub fn existing_binary(c: &Component, target: &str) -> Result<PathBuf> {
    let root = workspace_root()?;
    let p = target_dir(&root)
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

pub async fn cargo_release(c: &Component, target: &str) -> Result<PathBuf> {
    let root = workspace_root()?;
    let backend = root.join("backend");

    let status = Command::new("cargo")
        .arg("build")
        .arg("--release")
        .arg("-p")
        .arg(c.name)
        .arg("--target")
        .arg(target)
        .current_dir(&backend)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .with_context(|| format!("spawn cargo (cwd={})", backend.display()))?;

    if !status.success() {
        return Err(anyhow!(
            "cargo build failed for {} (target {target}) with status {status}",
            c.name
        ));
    }
    existing_binary(c, target)
}
