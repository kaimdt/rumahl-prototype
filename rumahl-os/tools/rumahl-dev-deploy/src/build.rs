use crate::catalog::Component;
use anyhow::{anyhow, bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

const DEVICE_BRIDGE_COMPONENT: &str = "rumahl-dev-bridge";

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

/// Check if Docker daemon is actually reachable (not just the CLI binary).
/// On Windows, docker CLI exists even when Docker Desktop isn't running.
fn docker_daemon_running() -> bool {
    std::process::Command::new("docker")
        .args(["info", "--format", "{{.ServerVersion}}"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Heuristic: can the host realistically cross-compile to `target` with
/// just `cargo build --target=...`? On Windows this practically requires
/// a cross-linker that almost nobody has installed; the result is the
/// classic `linker not found` error followed by a frustrating hour of
/// googling. We refuse to even try in that case so the user gets a
/// clear message and we go straight to docker (or device-build).
pub fn host_can_cross_compile(target: &str) -> bool {
    // Same-platform builds: always fine.
    let host_os = std::env::consts::OS;
    let host_arch = std::env::consts::ARCH;
    let target_lc = target.to_lowercase();
    let target_is_linux = target_lc.contains("linux");
    let target_is_windows = target_lc.contains("windows");
    let target_is_aarch64 = target_lc.starts_with("aarch64") || target_lc.starts_with("arm64");
    let target_is_x86_64  = target_lc.starts_with("x86_64");

    let host_is_linux  = host_os == "linux";
    let host_is_macos  = host_os == "macos";
    let host_is_windows= host_os == "windows";

    // Native build.
    if (host_is_linux && target_is_linux
        && ((host_arch == "aarch64" && target_is_aarch64) || (host_arch == "x86_64" && target_is_x86_64)))
        || (host_is_windows && target_is_windows)
        || (host_is_macos && target_lc.contains("apple-darwin"))
    {
        return true;
    }

    // Cross-compile from Windows to anything Linux: not worth attempting
    // without an explicit `RUMAHL_DEV_TRUST_HOST_CROSS=1` opt-in. The cargo
    // build will fail at link time in 99 % of setups.
    if host_is_windows && !target_is_windows {
        return std::env::var("RUMAHL_DEV_TRUST_HOST_CROSS").ok().as_deref() == Some("1");
    }

    // Cross-compile from macOS to Linux/aarch64: same story — needs a
    // cross-linker (e.g. `aarch64-unknown-linux-gnu-gcc` from
    // homebrew). We let the user opt in once they've installed it.
    if host_is_macos && target_is_linux {
        return command_exists("aarch64-unknown-linux-gnu-gcc")
            || command_exists("aarch64-linux-gnu-gcc")
            || std::env::var("RUMAHL_DEV_TRUST_HOST_CROSS").ok().as_deref() == Some("1");
    }

    // Cross-compile from Linux to non-native Linux arch: usually works
    // with the right gcc-aarch64-linux-gnu/gcc-x86-64-linux-gnu package
    // but we still verify a likely linker is present.
    if host_is_linux && target_is_linux {
        if target_is_aarch64 {
            return command_exists("aarch64-linux-gnu-gcc");
        }
        if target_is_x86_64 {
            return command_exists("x86_64-linux-gnu-gcc");
        }
    }

    false
}

/// Resolved build strategy for a single (component, target) pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildStrategy {
    /// `cargo build` directly on the developer workstation.
    Cargo,
    /// Containerised cargo using the rust:1.90 image.
    Docker,
    /// Push the workspace to the device and let the bridge build it.
    Device,
}

impl BuildStrategy {
    pub fn label(self) -> &'static str {
        match self {
            BuildStrategy::Cargo  => "cargo (native)",
            BuildStrategy::Docker => "docker (rust:1.90)",
            BuildStrategy::Device => "device build",
        }
    }
}

/// Pick the best available strategy given the user's preference, the
/// host capabilities and the component.
pub fn resolve_strategy(_component: &Component, target: &str, requested_mode: &str) -> BuildStrategy {
    let mode = requested_mode.to_lowercase();
    let mode = mode.as_str();
    match mode {
        "device" => BuildStrategy::Device,
        "host"   => {
            if host_can_cross_compile(target) { BuildStrategy::Cargo }
            // On non-Linux hosts, Docker cross-compile of ARM Linux binaries
            // is fragile; prefer keeping the real build on the device.
            else if !cfg!(target_os = "linux") { BuildStrategy::Device }
            else if command_exists("docker") && docker_daemon_running() { BuildStrategy::Docker }
            else { BuildStrategy::Device }
        }
        "cargo"  => BuildStrategy::Cargo,
        "docker" => {
            if docker_daemon_running() { BuildStrategy::Docker }
            else { BuildStrategy::Device }
        },
        // Default "auto": prefer native cargo when realistic, then device-build
        // (most reliable — the device does the build), falling back to docker.
        // On Windows and macOS, Docker cross-compilation of ARM Linux binaries
        // is fragile (OpenSSL multiarch, cross-linker, filesystem permission
        // issues). Device-build is the fastest and most reliable path for
        // non-Linux hosts because the bridge on the device has a persistent
        // incremental workspace at /var/lib/rumahl-dev/builds/<component>.
        _ => {
            if host_can_cross_compile(target) {
                BuildStrategy::Cargo
            } else if !cfg!(target_os = "linux") {
                // Non-Linux hosts: prefer device-build over Docker (Docker
                // cross-compile on Windows/macOS is unreliable for ARM targets).
                BuildStrategy::Device
            } else if command_exists("docker") && docker_daemon_running() {
                BuildStrategy::Docker
            } else {
                BuildStrategy::Device
            }
        }
    }
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
        if p.join("Cargo.toml").is_file() && p.join("rumahl-shared").is_dir() {
            // Already inside backend/.
            return Ok(p.parent().unwrap_or(p).to_path_buf());
        }
        match p.parent() {
            Some(parent) => p = parent,
            None => bail!(
                "could not locate rumahl workspace root from {} \
                 — run from inside the rumahl-os checkout",
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
    let _ = c;
    false
}

pub fn watch_dirs(c: &Component) -> Result<Vec<PathBuf>> {
    let root = workspace_root()?;
    if is_device_bridge(c) {
        return Ok(vec![component_build_root(&root, c).join("src")]);
    }
    let backend = root.join("backend");
    Ok(vec![
        backend.join(&c.name).join("src"),
        backend.join("rumahl-shared").join("src"),
    ])
}

pub fn existing_binary(c: &Component, target: &str) -> Result<PathBuf> {
    let root = workspace_root()?;
    let p = component_target_dir(&root, c)
        .join(target)
        .join("release")
        .join(&c.name);
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

    // First try pulling the image so the user sees progress
    eprintln!("docker: pulling rust:1.90...");
    let pull = Command::new("docker")
        .args(["pull", "rust:1.90"])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("spawning docker pull")?;
    if !pull.success() {
        bail!(
            "Docker: failed to pull rust:1.90 image — check internet or run 'docker pull rust:1.90' manually"
        );
    }

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
        .arg("bash")
        .arg("-lc")
        .arg(format!(
            "export DEBIAN_FRONTEND=noninteractive; set -e; \
             dpkg --add-architecture arm64 && \
             apt-get update -qq && \
             # Install cross-compile toolchain AND aarch64 OpenSSL via multiarch\n             # (much faster and more reliable than compiling OpenSSL from source)\n             apt-get install -y -qq --no-install-recommends \
               gcc-aarch64-linux-gnu g++-aarch64-linux-gnu \
               libc6-dev-arm64-cross linux-libc-dev-arm64-cross \
               libssl-dev:arm64 pkg-config \
               build-essential git curl ca-certificates perl make >/dev/null 2>&1 && \
             # Also try libpq for aarch64 if postgres feature is needed\n             apt-get install -y -qq libpq-dev:arm64 >/dev/null 2>&1 || true && \
             # Set env for cargo to find the cross-compiled OpenSSL from multiarch\n             export PKG_CONFIG_ALLOW_CROSS=1 && \
             export PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig && \
             export OPENSSL_DIR=/usr && \
             export OPENSSL_LIB_DIR=/usr/lib/aarch64-linux-gnu && \
             export OPENSSL_INCLUDE_DIR=/usr/include/aarch64-linux-gnu && \
             export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc && \
             export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc && \
             export CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ && \
             . /usr/local/cargo/env && \
             rustup target add {target_arg} && \
             rm -f Cargo.lock && cargo generate-lockfile && \
             cargo {build_cmd_text}",
        ))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = build_cmd
        .output()
        .await
        .context("spawning docker cross-compile container")?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Take last 30 lines from stderr for a useful diagnostic
        let tail: Vec<&str> = stderr.lines().rev().take(30).collect::<Vec<_>>().into_iter().rev().collect();
        let detail = tail.join("\n");
        bail!(
            "Docker cross-compile failed for {} (target {})\n\n--- last {} lines of stderr ---\n{}\n\n--- stdout ---\n{}",
            c.name, target, tail.len(), detail, stdout.chars().take(500).collect::<String>(),
        );
    }

    // Print build output for visibility in the daemon console
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.trim().is_empty() {
        eprintln!("--- docker build output ---\n{}", stdout);
    }

    existing_binary(c, target)
}

pub async fn cargo_release(c: &Component, target: &str) -> Result<PathBuf> {
    cargo_release_with_mode(c, target, "auto").await
}

/// Build the component using the requested mode (`auto` / `cargo` /
/// `docker` / `device` / `host`). `device` is rejected here — it must
/// be handled by the caller via the bridge's `/dev/build-replace`
/// endpoint, this function only produces a *local* binary.
pub async fn cargo_release_with_mode(c: &Component, target: &str, mode: &str) -> Result<PathBuf> {
    let strategy = resolve_strategy(c, target, mode);
    if strategy == BuildStrategy::Device && !must_build_on_host(c) {
        bail!(
            "build mode `device` requested but cargo_release_with_mode only \
             produces local binaries; the daemon should call the bridge's \
             /dev/build-replace endpoint instead"
        );
    }
    eprintln!("build strategy for {}: {}", c.name, strategy.label());
    match strategy {
        BuildStrategy::Cargo  => cargo_strategy(c, target).await,
        BuildStrategy::Docker => docker_release(c, target).await,
        BuildStrategy::Device => cargo_strategy(c, target).await, // fallback when nothing else available
    }
}

async fn cargo_strategy(c: &Component, target: &str) -> Result<PathBuf> {
    let root = workspace_root()?;
    let backend = component_build_root(&root, c);

    if cfg!(windows) && !host_can_cross_compile(target) {
        return Err(anyhow!(windows_cross_hint(c, target)));
    }

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

        if command_exists("docker") && docker_daemon_running() {
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

    if command_exists("docker") && docker_daemon_running() {
        eprintln!(
            "cargo build failed for {} (target {}) — falling back to Docker cross-compile...",
            c.name,
            target
        );
        return docker_release(c, target).await;
    }

    Err(anyhow!(
        "cargo build failed for {} (target {})\n{}\n\n{}",
        c.name,
        target,
        tail_lines(&output, 30),
        post_failure_hint(c, target)
    ))
}

fn windows_cross_hint(c: &Component, target: &str) -> String {
    format!(
        "refusing to run `cargo build --target {target}` for {} on a Windows host: \
         cross-compiling Linux/ARM binaries from Windows requires a cross-linker that is not installed.\n\n\
         Recommended fix: keep the IDE's build mode at `auto` (the default) or set it to `device`.\n\
         The rumahl OS Dev Bridge will build the component on the device itself, with a persistent \
         workspace at /var/lib/rumahl-dev/builds/{0} so subsequent rebuilds are incremental.\n\n\
         If you really know what you are doing and have a working cross toolchain, set the env var \
         RUMAHL_DEV_TRUST_HOST_CROSS=1 to opt back in.",
        c.name
    )
}

fn post_failure_hint(c: &Component, target: &str) -> String {
    if cfg!(windows) {
        format!(
            "hint: Windows hosts are not great at cross-compiling for {target}. \
             Switch the build mode to `device` (the rumahl OS Dev Bridge will build on \
             the device itself, incrementally) or install Docker Desktop and rerun."
        )
    } else if cfg!(target_os = "macos") {
        format!(
            "hint: install a cross-linker (`brew install aarch64-unknown-linux-gnu` \
             via `messense/macos-cross-toolchains`) or Docker Desktop, or switch the \
             build mode to `device` so the bridge builds {} on the device.",
            c.name
        )
    } else {
        format!("hint: install gcc-aarch64-linux-gnu (or the matching cross gcc for {target}), or use Docker, or switch to device build.")
    }
}
