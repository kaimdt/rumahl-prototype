use crate::{
    channels,
    state::{NetworkMode, RuntimeState},
};
use anyhow::{Context, Result};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tokio::{
    net::TcpStream,
    time::{timeout, Duration},
};

#[derive(Debug, Clone, Default)]
pub struct Probe {
    pub process: bool,
    pub qmp: bool,
    pub qga: bool,
    pub ssh: bool,
    pub internal_home: bool,
    pub external_home: bool,
    pub systemd: String,
    pub guest_ip: Option<String>,
}

impl Probe {
    pub fn lifecycle(&self) -> &'static str {
        if !self.process {
            "Stopped"
        } else if !self.qmp {
            "Starting"
        } else if !self.qga {
            "Booting"
        } else if self.systemd != "running" && self.systemd != "degraded" {
            "Provisioning"
        } else if self.guest_ip.is_none() {
            "Waiting for network"
        } else if self.internal_home && self.external_home {
            "Ready"
        } else {
            "Degraded"
        }
    }
}

pub struct Manager {
    pub root: PathBuf,
    pub state_path: PathBuf,
    pub state: RuntimeState,
}

impl Manager {
    pub fn discover(explicit: Option<PathBuf>) -> Result<Self> {
        let root = explicit
            .or_else(|| std::env::var_os("IORA_OS_ROOT").map(PathBuf::from))
            .unwrap_or(std::env::current_dir()?);
        let root = if root.join("dev-local.sh").exists() || root.join("dev-local.ps1").exists() {
            root
        } else if root.join("iora-os/dev-local.sh").exists() {
            root.join("iora-os")
        } else {
            anyhow::bail!("run from the repository root/iora-os or set IORA_OS_ROOT")
        };
        let state_path = root.join(".cache/runtime-state.json");
        let mut state = RuntimeState::load(&state_path);
        if state.pid.is_none() {
            state.pid = std::fs::read_to_string(root.join(".cache/qemu.pid"))
                .ok()
                .and_then(|value| value.trim().parse().ok());
        }
        Ok(Self {
            root,
            state_path,
            state,
        })
    }

    pub async fn probe(&mut self) -> Probe {
        let mut probe = Probe {
            process: self.state.process_alive(),
            ..Default::default()
        };
        if !probe.process {
            self.state = RuntimeState::default();
            let _ = self.state.save(&self.state_path);
            return probe;
        }
        probe.qmp = channels::qmp(
            self.state.qmp_port,
            &self.root.join(".cache/qmp.sock"),
            "query-status",
        )
        .await
        .is_ok();
        probe.qga = channels::qga(
            self.state.qga_port,
            &self.root.join(".cache/qga.sock"),
            serde_json::json!({"execute":"guest-ping"}),
        )
        .await
        .is_ok();
        if probe.qga {
            probe.systemd = self
                .guest("systemctl is-system-running 2>/dev/null || true")
                .await
                .unwrap_or_default()
                .trim()
                .into();
            probe.guest_ip = self.guest("ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \\([0-9.]*\\).*/\\1/p' | head -1").await.ok().map(|s| s.trim().into()).filter(|s: &String| !s.is_empty());
            if self.state.network_mode == NetworkMode::Bridge {
                if let Some(ip) = &probe.guest_ip {
                    self.state.vm_host.clone_from(ip);
                }
            }
            probe.internal_home = self
                .guest("curl -fsS --max-time 3 http://127.0.0.1:8126/api/health >/dev/null")
                .await
                .is_ok();
        }
        let (host, ssh, home) = self.state.connection();
        probe.ssh = tcp(host, ssh).await;
        probe.external_home = reqwest::Client::new()
            .get(format!("http://{host}:{home}/api/health"))
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .is_ok_and(|response| response.status().is_success());
        self.state.lifecycle = probe.lifecycle().into();
        let _ = self.state.save(&self.state_path);
        probe
    }

    pub fn start(&self, mode: NetworkMode) -> Result<()> {
        if self.state.process_alive() {
            anyhow::bail!("VM is already running")
        }
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.root.join(".cache/dev-manager.log"))?;
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("powershell.exe");
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(self.root.join("dev-local.ps1"));
            if mode == NetworkMode::Bridge {
                c.arg("-Bridge");
            }
            c
        };
        #[cfg(not(windows))]
        let mut command = {
            if mode == NetworkMode::Bridge {
                anyhow::bail!("Bridge provisioning is currently available on Windows; manage an already bridged Unix VM through the TUI")
            }
            let mut c = Command::new("bash");
            c.arg(self.root.join("dev-local.sh"));
            c
        };
        command
            .arg(if cfg!(windows) {
                "-NoWatch"
            } else {
                "--no-watch"
            })
            .stdin(Stdio::null())
            .stdout(Stdio::from(log.try_clone()?))
            .stderr(Stdio::from(log))
            .spawn()
            .context("failed to launch VM provisioning backend")?;
        Ok(())
    }

    pub async fn qmp_action(&self, action: &str) -> Result<()> {
        channels::qmp(
            self.state.qmp_port,
            &self.root.join(".cache/qmp.sock"),
            action,
        )
        .await
        .map(|_| ())
    }
    pub async fn guest(&self, command: &str) -> Result<String> {
        channels::guest_exec(
            self.state.qga_port,
            &self.root.join(".cache/qga.sock"),
            command,
        )
        .await
    }
    pub async fn graceful_stop(&self) -> Result<()> {
        if channels::qga(
            self.state.qga_port,
            &self.root.join(".cache/qga.sock"),
            serde_json::json!({"execute":"guest-shutdown"}),
        )
        .await
        .is_ok()
        {
            return Ok(());
        }
        self.qmp_action("system_powerdown").await
    }
    pub fn hard_stop(&self) -> Result<()> {
        let pid = self.state.pid.context("VM PID is unknown")?;
        kill(pid)
    }
    pub fn open_ssh(&self) -> Result<()> {
        let (host, port, _) = self.state.connection();
        let mut command = Command::new("ssh");
        command.args(["-p", &port.to_string()]);
        let key = self.root.join(".cache/iora-dev-key");
        if key.exists() {
            command.arg("-i").arg(key);
        }
        command.arg(format!("root@{host}")).status()?;
        Ok(())
    }
    pub fn open_url(&self) -> Result<()> {
        let (host, _, port) = self.state.connection();
        open(&format!("http://{host}:{port}"))
    }
}

async fn tcp(host: &str, port: u16) -> bool {
    timeout(Duration::from_secs(2), TcpStream::connect((host, port)))
        .await
        .is_ok_and(|r| r.is_ok())
}
#[cfg(unix)]
fn kill(pid: u32) -> Result<()> {
    Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status()?
        .success()
        .then_some(())
        .context("kill failed")
}
#[cfg(windows)]
fn kill(pid: u32) -> Result<()> {
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status()?
        .success()
        .then_some(())
        .context("taskkill failed")
}
fn open(url: &str) -> Result<()> {
    let (program, args): (&str, Vec<&str>) = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C", "start", "", url])
    } else if cfg!(target_os = "macos") {
        ("open", vec![url])
    } else {
        ("xdg-open", vec![url])
    };
    Command::new(program).args(args).spawn()?;
    Ok(())
}

pub fn read_tail(path: &Path, lines: usize) -> String {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| {
            s.lines()
                .rev()
                .take(lines)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_else(|| "No log available".into())
}
