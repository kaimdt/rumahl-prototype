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

    pub fn start(&mut self, mode: NetworkMode) -> Result<()> {
        if self.state.process_alive() {
            anyhow::bail!("VM is already running")
        }
        let cache = self.root.join(".cache");
        std::fs::create_dir_all(&cache)?;
        let disk = cache.join("iora-dev-vm.qcow2");
        if !disk.exists() {
            anyhow::bail!(
                "VM disk is missing at {}; import or create the development image before starting",
                disk.display()
            )
        }
        for socket in [cache.join("qga.sock"), cache.join("qmp.sock")] {
            if socket.exists() {
                std::fs::remove_file(socket)?;
            }
        }
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.root.join(".cache/dev-manager.log"))?;
        let architecture = std::env::consts::ARCH;
        let qemu = std::env::var("IORA_DEV_QEMU").unwrap_or_else(|_| {
            if architecture == "aarch64" {
                "qemu-system-aarch64".into()
            } else {
                "qemu-system-x86_64".into()
            }
        });
        let machine = if architecture == "aarch64" {
            "virt"
        } else {
            "q35"
        };
        let acceleration = std::env::var("IORA_DEV_ACCEL").unwrap_or_else(|_| {
            if cfg!(windows) {
                "whpx".into()
            } else if cfg!(target_os = "macos") {
                "hvf".into()
            } else if Path::new("/dev/kvm").exists() {
                "kvm".into()
            } else {
                "tcg".into()
            }
        });
        let memory = std::env::var("IORA_DEV_RAM").unwrap_or_else(|_| "8G".into());
        let cpus = std::env::var("IORA_DEV_CPUS").unwrap_or_else(|_| "4".into());
        let network = match mode {
            NetworkMode::Slirp => format!(
                "user,id=n0,hostfwd=tcp::{}-:22,hostfwd=tcp::{}-:8126",
                self.state.ssh_port, self.state.home_port
            ),
            NetworkMode::Bridge => format!(
                "tap,id=n0,ifname={},script=no,downscript=no",
                std::env::var("IORA_DEV_TAP").unwrap_or_else(|_| "iora-tap0".into())
            ),
        };
        let mut arguments = vec![
            "-name".into(),
            "IORA-Dev".into(),
            "-m".into(),
            memory,
            "-smp".into(),
            cpus,
            "-machine".into(),
            format!("{machine},accel={acceleration}"),
            "-cpu".into(),
            if acceleration == "tcg" {
                "max".into()
            } else {
                "host".into()
            },
            "-drive".into(),
            format!(
                "file={},format=qcow2,if=virtio,cache=writeback",
                disk.display()
            ),
            "-netdev".into(),
            network,
            "-device".into(),
            if architecture == "aarch64" {
                "virtio-net-device,netdev=n0".into()
            } else {
                "virtio-net-pci,netdev=n0".into()
            },
            "-device".into(),
            if architecture == "aarch64" {
                "virtio-serial-device".into()
            } else {
                "virtio-serial-pci".into()
            },
        ];
        let seed = cache.join("iora-dev-seed.iso");
        if seed.exists() {
            arguments.extend([
                "-drive".into(),
                format!("file={},format=raw,media=cdrom", seed.display()),
            ]);
        }
        if cfg!(windows) {
            arguments.extend([
                "-chardev".into(),
                format!(
                    "socket,id=qga0,host=127.0.0.1,port={},server=on,wait=off",
                    self.state.qga_port
                ),
                "-qmp".into(),
                format!("tcp:127.0.0.1:{},server=on,wait=off", self.state.qmp_port),
            ]);
        } else {
            arguments.extend([
                "-chardev".into(),
                format!(
                    "socket,id=qga0,path={},server=on,wait=off",
                    cache.join("qga.sock").display()
                ),
                "-qmp".into(),
                format!(
                    "unix:{},server=on,wait=off",
                    cache.join("qmp.sock").display()
                ),
            ]);
        }
        arguments.extend([
            "-device".into(),
            "virtserialport,chardev=qga0,id=qga0,name=org.qemu.guest_agent.0".into(),
            "-serial".into(),
            format!("file:{}", cache.join("qemu-serial.log").display()),
            "-display".into(),
            "none".into(),
        ]);
        let mut command = Command::new(&qemu);
        command
            .args(&arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log.try_clone()?))
            .stderr(Stdio::from(log));
        let child = command
            .spawn()
            .with_context(|| format!("failed to launch {qemu}"))?;
        self.state.pid = Some(child.id());
        self.state.lifecycle = "Starting".into();
        self.state.network_mode = mode;
        self.state.vm_host = if self.state.network_mode == NetworkMode::Slirp {
            "127.0.0.1".into()
        } else {
            String::new()
        };
        self.state.vm_disk = Some(disk);
        self.state.acceleration = Some(acceleration);
        self.state.save(&self.state_path)?;
        std::fs::write(cache.join("qemu.pid"), child.id().to_string())?;
        Ok(())
    }

    pub fn create_golden_snapshot(&mut self) -> Result<()> {
        if self.state.process_alive() {
            anyhow::bail!("stop the VM before creating a Golden Snapshot")
        }
        let disk = self.root.join(".cache/iora-dev-vm.qcow2");
        let golden = self.root.join(".cache/iora-dev-golden.qcow2");
        let temporary = golden.with_extension("qcow2.tmp");
        let status =
            Command::new(std::env::var("IORA_DEV_QEMU_IMG").unwrap_or_else(|_| "qemu-img".into()))
                .args(["convert", "-O", "qcow2", "-c"])
                .arg(&disk)
                .arg(&temporary)
                .status()?;
        if !status.success() {
            anyhow::bail!("qemu-img failed to create the Golden Snapshot")
        }
        std::fs::rename(temporary, &golden)?;
        self.state.golden_snapshot = Some(golden);
        self.state.save(&self.state_path)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_start_refuses_missing_disk_without_invoking_a_script() {
        let root = std::env::temp_dir().join(format!("iora-dev-manager-{}", std::process::id()));
        let mut manager = Manager {
            state_path: root.join(".cache/runtime-state.json"),
            root: root.clone(),
            state: RuntimeState::default(),
        };
        let error = manager.start(NetworkMode::Slirp).unwrap_err();
        assert!(error.to_string().contains("VM disk is missing"));
        let _ = std::fs::remove_dir_all(root);
    }
}
