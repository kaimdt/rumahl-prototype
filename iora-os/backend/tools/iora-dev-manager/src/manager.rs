use crate::{
    channels,
    state::{NetworkMode, PortMapping, RuntimeState},
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

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Probe {
    pub process: bool,
    pub qmp: bool,
    pub qga: bool,
    pub ssh: bool,
    pub internal_home: bool,
    pub external_home: bool,
    pub systemd: String,
    pub guest_ip: Option<String>,
    pub dev_watcher: bool,
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
        } else if self.internal_home && self.external_home && self.dev_watcher {
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
        let start = explicit
            .or_else(|| std::env::var_os("IORA_OS_ROOT").map(PathBuf::from))
            .unwrap_or(std::env::current_dir()?);
        let root = find_iora_root(&start).context(
            "no iora-os root found; run from the repository root/iora-os or set IORA_OS_ROOT",
        )?;
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
            dev_watcher: self.state.watcher_status == "Running",
            ..Default::default()
        };
        if !probe.process {
            let watcher_status = self.state.watcher_status.clone();
            let sync_status = self.state.sync_status.clone();
            self.state = RuntimeState::default();
            self.state.watcher_status = watcher_status;
            self.state.sync_status = sync_status;
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
                .guest("curl -fsS --max-time 3 http://127.0.0.1:8126/health >/dev/null || curl -fsS --max-time 3 http://127.0.0.1:8126/api/health >/dev/null")
                .await
                .is_ok();
        }
        let (host, ssh, home) = self.state.connection();
        probe.ssh = tcp(host, ssh).await;
        let client = reqwest::Client::new();
        let mut external_home = false;
        for path in ["/health", "/api/health"] {
            if client
                .get(format!("http://{host}:{home}{path}"))
                .timeout(Duration::from_secs(3))
                .send()
                .await
                .is_ok_and(|response| response.status().is_success())
            {
                external_home = true;
                break;
            }
        }
        probe.external_home = external_home;
        self.state.lifecycle = probe.lifecycle().into();
        let _ = self.state.save(&self.state_path);
        probe
    }

    pub fn start(&mut self, mode: NetworkMode, mappings: &[PortMapping]) -> Result<()> {
        if self.state.process_alive() {
            anyhow::bail!("VM is already running")
        }
        if mode == NetworkMode::Bridge {
            let tap = std::env::var("IORA_DEV_TAP").unwrap_or_else(|_| "iora-tap0".into());
            if !tap_available(&tap) {
                anyhow::bail!(
                    "bridge mode requires a pre-created TAP adapter named '{tap}' (create it with the dev-local scripts); use slirp mode instead"
                );
            }
        }
        let cache = self.root.join(".cache");
        std::fs::create_dir_all(&cache)?;
        let disk = cache.join("iora-dev-vm.qcow2");
        if !disk.exists() {
            self.bootstrap_with_dev_local()?;
            self.state = RuntimeState::load(&self.state_path);
            if self.state.process_alive() || disk.exists() {
                return Ok(());
            }
            anyhow::bail!(
                "dev-local.ps1 completed but VM disk is still missing at {}",
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
        let qemu = resolve_qemu();
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
            NetworkMode::Slirp => {
                // Bind every rule to loopback: Windows Firewall silently drops
                // inbound connections on new ports, while loopback is never
                // filtered. This also keeps the VM ports off the LAN.
                let mut rules = vec![format!("hostfwd=tcp:127.0.0.1:{}-:22", self.state.ssh_port)];
                for port in extra_ports() {
                    rules.push(format!("hostfwd=tcp:127.0.0.1:{port}-:{port}"));
                }
                for mapping in mappings {
                    rules.push(format!(
                        "hostfwd=tcp:127.0.0.1:{}-:{}",
                        mapping.host, mapping.guest
                    ));
                }
                rules.push(format!("hostfwd=tcp:127.0.0.1:{}-:8126", self.state.home_port));
                format!("user,id=n0,{}", rules.join(","))
            }
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
            cpu_model(&acceleration),
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
        if architecture == "aarch64" {
            let firmware = find_aarch64_firmware().context(
                "AArch64 QEMU firmware was not found; set IORA_DEV_FIRMWARE to its path",
            )?;
            arguments.extend(["-bios".into(), firmware.display().to_string()]);
            self.state.firmware = Some(firmware.display().to_string());
        }
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
            "-vnc".into(),
            format!(
                "127.0.0.1:{},websocket={}",
                display_number(),
                5700 + display_number()
            ),
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
        self.state.vnc_port = Some(5900 + display_number());
        self.state.vnc_ws_port = Some(5700 + display_number());
        self.state.forwarded_ports = extra_ports()
            .into_iter()
            .map(|port| serde_json::json!({ "host": port, "guest": port }))
            .chain(
                mappings
                    .iter()
                    .map(|mapping| {
                        serde_json::json!({
                            "host": mapping.host,
                            "guest": mapping.guest,
                            "label": mapping.label,
                        })
                    }),
            )
            .collect();
        self.state.save(&self.state_path)?;
        std::fs::write(cache.join("qemu.pid"), child.id().to_string())?;
        Ok(())
    }

    fn bootstrap_with_dev_local(&self) -> Result<()> {
        let script = self.root.join("dev-local.ps1");
        if !script.exists() {
            anyhow::bail!(
                "VM disk is missing at {} and dev-local.ps1 was not found to create it",
                self.root.join(".cache/iora-dev-vm.qcow2").display()
            );
        }
        let shell = if cfg!(windows) { "powershell.exe" } else { "pwsh" };
        let status = Command::new(shell)
            .current_dir(&self.root)
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script)
            .arg("-NoWatch")
            .status()
            .with_context(|| format!("failed to launch {} for VM bootstrap", script.display()))?;
        if !status.success() {
            anyhow::bail!("dev-local.ps1 failed while creating or starting the development VM")
        }
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
            Command::new(resolve_qemu_img())
                .args(["convert", "-O", "qcow2", "-c"])
                .arg(&disk)
                .arg(&temporary)
                .status()?;
        if !status.success() {
            anyhow::bail!("qemu-img failed to create the Golden Snapshot")
        }
        let previous = golden.with_extension("qcow2.previous");
        if golden.exists() {
            if previous.exists() {
                std::fs::remove_file(&previous)?;
            }
            std::fs::rename(&golden, &previous)?;
        }
        if let Err(error) = std::fs::rename(&temporary, &golden) {
            if previous.exists() {
                let _ = std::fs::rename(&previous, &golden);
            }
            return Err(error.into());
        }
        if previous.exists() {
            std::fs::remove_file(previous)?;
        }
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

fn display_number() -> u16 {
    std::env::var("IORA_DEV_VNC")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1)
}

/// Additional Slirp host ports forwarded to the same guest port.
/// Defaults to 5173 so the Vite dev server is reachable from the host.
pub fn extra_ports() -> Vec<u16> {
    std::env::var("IORA_DEV_FORWARD")
        .unwrap_or_else(|_| "5173".into())
        .split(',')
        .filter_map(|value| value.trim().parse().ok())
        .collect()
}

fn find_iora_root(start: &Path) -> Option<PathBuf> {
    let mut candidates = vec![start.to_path_buf(), start.join("iora-os")];
    let mut current = start.parent();
    for _ in 0..8 {
        if let Some(parent) = current {
            candidates.push(parent.to_path_buf());
            candidates.push(parent.join("iora-os"));
            current = parent.parent();
        } else {
            break;
        }
    }
    candidates.into_iter().find(|candidate| {
        candidate.join("dev-local.sh").exists() || candidate.join("dev-local.ps1").exists()
    })
}

fn resolve_qemu() -> String {
    if let Ok(explicit) = std::env::var("IORA_DEV_QEMU") {
        return explicit;
    }
    let name = if std::env::consts::ARCH == "aarch64" {
        "qemu-system-aarch64"
    } else {
        "qemu-system-x86_64"
    };
    let executable = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    windows_qemu_dir(&executable).unwrap_or(executable)
}

fn resolve_qemu_img() -> String {
    if let Ok(explicit) = std::env::var("IORA_DEV_QEMU_IMG") {
        return explicit;
    }
    let executable = if cfg!(windows) {
        "qemu-img.exe".to_owned()
    } else {
        "qemu-img".to_owned()
    };
    windows_qemu_dir(&executable).unwrap_or(executable)
}

/// Windows QEMU installers place the binaries in Program Files without
/// registering them on PATH; fall back to those locations.
fn windows_qemu_dir(executable: &str) -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    ["C:\\Program Files\\qemu", "C:\\Program Files (x86)\\qemu"]
        .into_iter()
        .map(PathBuf::from)
        .map(|dir| dir.join(executable))
        .find(|path| path.exists())
        .map(|path| path.display().to_string())
}

#[cfg(windows)]
fn tap_available(tap: &str) -> bool {
    // netsh exits 0 even when the interface is missing; the name only
    // appears in the output when the adapter exists.
    Command::new("netsh")
        .args(["interface", "show", "interface", tap])
        .output()
        .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains(tap))
}
#[cfg(all(unix, not(target_os = "macos")))]
fn tap_available(tap: &str) -> bool {
    Command::new("ip")
        .args(["link", "show", tap])
        .output()
        .is_ok_and(|output| output.status.success())
}
#[cfg(target_os = "macos")]
fn tap_available(_tap: &str) -> bool {
    true // macOS: QEMU manages the network backend itself
}

/// WHPX rejects `host`/`max` CPU models on some QEMU builds
/// ("WHPX: Unexpected VP exit code 4"); qemu64 is the reliable default there.
fn cpu_model(acceleration: &str) -> String {
    std::env::var("IORA_DEV_CPU").unwrap_or_else(|_| {
        if acceleration == "tcg" {
            "max".into()
        } else if acceleration == "whpx" {
            "qemu64".into()
        } else {
            "host".into()
        }
    })
}

fn find_aarch64_firmware() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("IORA_DEV_FIRMWARE").map(PathBuf::from) {
        return path.exists().then_some(path);
    }
    [
        "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
        "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
        "/usr/share/qemu/edk2-aarch64-code.fd",
        "/usr/share/AAVMF/AAVMF_CODE.fd",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.exists())
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
pub fn open(url: &str) -> Result<()> {
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
    fn readiness_requires_the_live_development_watcher() {
        let mut probe = Probe {
            process: true,
            qmp: true,
            qga: true,
            internal_home: true,
            external_home: true,
            systemd: "running".into(),
            guest_ip: Some("192.0.2.10".into()),
            ..Default::default()
        };
        assert_eq!(probe.lifecycle(), "Degraded");
        probe.dev_watcher = true;
        assert_eq!(probe.lifecycle(), "Ready");
    }

    #[test]
    fn native_start_reports_missing_disk_when_bootstrap_script_is_unavailable() {
        let root = std::env::temp_dir().join(format!("iora-dev-manager-{}", std::process::id()));
        let mut manager = Manager {
            state_path: root.join(".cache/runtime-state.json"),
            root: root.clone(),
            state: RuntimeState::default(),
        };
        let error = manager.start(NetworkMode::Slirp, &[]).unwrap_err();
        assert!(error.to_string().contains("dev-local.ps1 was not found"));
        let _ = std::fs::remove_dir_all(root);
    }
}
