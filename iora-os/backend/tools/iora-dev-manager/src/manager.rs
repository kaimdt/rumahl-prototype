use crate::{
    channels,
    state::{NetworkMode, PortMapping, RuntimeState},
};
use anyhow::{Context, Result};
use serde_json::Value;
use std::{
    collections::HashSet,
    net::TcpListener,
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
        let mut root = find_iora_root(&start).context(
            "no iora-os root found; run from the repository root/iora-os or set IORA_OS_ROOT",
        )?;
        // Make paths absolute so derived paths (SSH key, state, logs) are
        // valid no matter where the daemon was launched from.
        if root.is_relative() {
            root = std::path::absolute(&root).unwrap_or(root);
        }
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

    fn refresh_state_from_disk(&mut self) {
        let disk_state = RuntimeState::load(&self.state_path);
        if disk_state.updated_at.is_some() || disk_state.pid.is_some() || disk_state.lifecycle != "Stopped" {
            self.state = disk_state;
        }
    }

    pub async fn probe(&mut self) -> Probe {
        self.refresh_state_from_disk();
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
        self.refresh_state_from_disk();
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
            self.spawn_dev_local_bootstrap(false)?;
            self.state.lifecycle = "Installing".into();
            self.state.vm_disk = Some(disk);
            self.state.last_error = None;
            self.state.save(&self.state_path)?;
            return Ok(());
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
        // Acceleration selection. On Windows try WHPX first (the fast path),
        // then fall back to TCG with clamped resources when Hyper-V/WHP is
        // unavailable or the process dies instantly — mirrors the proven
        // dev-local.ps1 fallback so a machine without WHPX still boots.
        let accel_override = std::env::var("IORA_DEV_ACCEL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let skip_whpx = std::env::var("IORA_DEV_SKIP_WHPX")
            .ok()
            .map(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(false);
        let default_accel = || -> String {
            if cfg!(windows) {
                if skip_whpx {
                    "tcg".to_string()
                } else {
                    "whpx".to_string()
                }
            } else if cfg!(target_os = "macos") {
                "hvf".to_string()
            } else if Path::new("/dev/kvm").exists() {
                "kvm".to_string()
            } else {
                "tcg".to_string()
            }
        };
        let memory = std::env::var("IORA_DEV_RAM").unwrap_or_else(|_| "8G".into());
        let cpus = std::env::var("IORA_DEV_CPUS").unwrap_or_else(|_| "4".into());
        let first_accel = accel_override.clone().unwrap_or_else(default_accel);
        // TCG has no hardware acceleration: clamp RAM to 4-8 GB and vCPUs
        // to 2-8 (dev-local.ps1 uses the same limits for its TCG fallback).
        let tcg_ram = format!(
            "{}G",
            clamp_ram_gb(&memory).clamp(4, 8)
        );
        let tcg_cpus = cpus
            .trim_end_matches(['C', 'c'])
            .parse::<u32>()
            .unwrap_or(4)
            .clamp(2, 8)
            .to_string();
        let candidates: Vec<(String, String, String)> =
            if cfg!(windows) && accel_override.is_none() {
                vec![
                    (first_accel.clone(), memory.clone(), cpus.clone()),
                    ("tcg".to_string(), tcg_ram, tcg_cpus),
                ]
            } else {
                vec![(first_accel.clone(), memory.clone(), cpus.clone())]
            };
        let network = match mode {
            NetworkMode::Slirp => {
                // Bind every rule to loopback: Windows Firewall silently drops
                // inbound connections on new ports, while loopback is never
                // filtered. This also keeps the VM ports off the LAN.
                let plan = forwarding_plan(
                    self.state.ssh_port,
                    self.state.home_port,
                    extra_ports(),
                    mappings,
                );
                for port in &plan.skipped {
                    eprintln!(
                        "[dev-manager] warning: host port {port} is busy or requested twice - not forwarding it (the service stays reachable inside the VM)"
                    );
                }
                self.state.forwarded_ports = plan
                    .forwarded
                    .iter()
                    .map(|(host, guest, label)| {
                        serde_json::json!({ "host": host, "guest": guest, "label": label })
                    })
                    .collect();
                self.state.skipped_ports =
                    plan.skipped.iter().map(|port| serde_json::json!(port)).collect();
                format!("user,id=n0,{}", plan.rules.join(","))
            }
            NetworkMode::Bridge => {
                // Bridge mode has no host forwarding at all - the VM is
                // reachable directly via its LAN IP.
                self.state.forwarded_ports = vec![];
                self.state.skipped_ports = vec![];
                format!(
                    "tap,id=n0,ifname={},script=no,downscript=no",
                    std::env::var("IORA_DEV_TAP").unwrap_or_else(|_| "iora-tap0".into())
                )
            }
        };
        // AArch64 firmware is resolved once; the argument builder reuses it.
        let firmware = if architecture == "aarch64" {
            let firmware = find_aarch64_firmware().context(
                "AArch64 QEMU firmware was not found; set IORA_DEV_FIRMWARE to its path",
            )?;
            self.state.firmware = Some(firmware.display().to_string());
            Some(firmware)
        } else {
            None
        };
        let seed = cache.join("iora-dev-seed.iso");
        let build_args = |accel: &str, mem: &str, cpu: &str| -> Vec<String> {
            let mut arguments = vec![
                "-name".into(),
                "IORA-Dev".into(),
                "-m".into(),
                mem.to_string(),
                "-smp".into(),
                cpu.to_string(),
                "-machine".into(),
                format!("{machine},accel={accel}"),
                "-cpu".into(),
                cpu_model(accel),
                "-drive".into(),
                format!(
                    "file={},format=qcow2,if=virtio,cache=writeback",
                    disk.display()
                ),
                "-netdev".into(),
                network.clone(),
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
            if let Some(firmware) = &firmware {
                arguments.extend(["-bios".into(), firmware.display().to_string()]);
            }
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
            arguments
        };

        // Spawn with fallback: when a candidate dies within the grace window
        // (e.g. WHPX unavailable), try the next one (TCG) before giving up.
        let mut spawned_child: Option<std::process::Child> = None;
        let mut spawn_error = String::new();
        for (index, (accel, mem, cpu)) in candidates.iter().enumerate() {
            let arguments = build_args(accel, mem, cpu);
            let mut command = Command::new(&qemu);
            command
                .args(&arguments)
                .stdin(Stdio::null())
                .stdout(Stdio::from(log.try_clone()?))
                .stderr(Stdio::from(log.try_clone()?));
            let mut child = match command.spawn() {
                Ok(child) => child,
                Err(error) => {
                    spawn_error = format!("failed to launch {qemu}: {error:#}");
                    continue;
                }
            };
            let has_fallback = index + 1 < candidates.len();
            if has_fallback {
                // Give the first candidate a short grace period: WHPX fails
                // within milliseconds when Hyper-V/WHP is not available.
                std::thread::sleep(Duration::from_secs(4));
                if let Ok(Some(status)) = child.try_wait() {
                    spawn_error = format!(
                        "{accel} exited immediately ({status}); tail of dev-manager.log:\n{}",
                        read_tail(&cache.join("dev-manager.log"), 12)
                    );
                    eprintln!("[dev-manager] {spawn_error}");
                    continue;
                }
            }
            spawned_child = Some(child);
            self.state.acceleration = Some(accel.clone());
            break;
        }
        let child = spawned_child.ok_or_else(|| anyhow::anyhow!(spawn_error))?;
        self.state.pid = Some(child.id());
        self.state.lifecycle = "Starting".into();
        self.state.network_mode = mode;
        self.state.vm_host = if self.state.network_mode == NetworkMode::Slirp {
            "127.0.0.1".into()
        } else {
            String::new()
        };
        self.state.vm_disk = Some(disk);
        self.state.vnc_port = Some(5900 + display_number());
        self.state.vnc_ws_port = Some(5700 + display_number());
        // forwarded_ports / skipped_ports were already recorded by the Slirp
        // branch above; in bridge mode there is no host forwarding at all.
        self.state.save(&self.state_path)?;
        std::fs::write(cache.join("qemu.pid"), child.id().to_string())?;
        Ok(())
    }

    fn spawn_dev_local_bootstrap(&self, rebuild: bool) -> Result<()> {
        let script = self.root.join("dev-local.ps1");
        if !script.exists() {
            anyhow::bail!(
                "VM disk is missing at {} and dev-local.ps1 was not found to create it",
                self.root.join(".cache/iora-dev-vm.qcow2").display()
            );
        }
        // Remove the Mark-of-the-Web from every script under iora-os so
        // PowerShell does not ask "Do you want to run this script?" for each
        // module import (non-interactive bootstraps would silently decline
        // and break the provision). This is the same as `Unblock-File`.
        if cfg!(windows) {
            let _ = std::process::Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-Command",
                    "Get-ChildItem -Path . -Recurse -Include *.ps1,*.psm1 -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue",
                ])
                .current_dir(&self.root)
                .status();
        }
        // Prefer PowerShell 7 (correct UTF-8 parsing of the .ps1 files);
        // Windows PowerShell 5.1 misreads UTF-8 and can break parsing.
        let shell = if cfg!(windows) {
            let pwsh_available = std::process::Command::new("pwsh")
                .args(["-NoProfile", "-Command", "exit 0"])
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            if pwsh_available {
                "pwsh"
            } else {
                "powershell.exe"
            }
        } else {
            "pwsh"
        };
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.root.join(".cache/dev-manager.log"))?;
        let child = Command::new(shell)
            .current_dir(&self.root)
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script)
            .args(if rebuild { vec!["-Rebuild", "-NoWatch"] } else { vec!["-NoWatch"] })
            .stdin(Stdio::null())
            .stdout(Stdio::from(log.try_clone()?))
            .stderr(Stdio::from(log))
            .spawn()
            .with_context(|| format!("failed to launch {} for VM bootstrap", script.display()))?;
        std::fs::write(self.root.join(".cache/dev-local-bootstrap.pid"), child.id().to_string())?;
        Ok(())
    }

    pub fn reinstall(&mut self) -> Result<()> {
        self.refresh_state_from_disk();
        if self.state.process_alive() {
            self.hard_stop()?;
        }
        self.spawn_dev_local_bootstrap(true)?;
        self.state.lifecycle = "Reinstalling".into();
        self.state.pid = None;
        self.state.provisioned = false;
        self.state.last_error = None;
        self.state.save(&self.state_path)?;
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
    pub fn hard_stop(&mut self) -> Result<()> {
        self.refresh_state_from_disk();
        let mut killed_any = false;
        if let Some(pid) = self.state.pid {
            if kill_process(pid).is_ok() {
                killed_any = true;
            }
        }
        for pid_file in ["qemu.pid", "dev-local-bootstrap.pid"] {
            let path = self.root.join(".cache").join(pid_file);
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(pid) = raw.trim().parse::<u32>() {
                    if kill_process(pid).is_ok() {
                        killed_any = true;
                    }
                }
            }
            let _ = std::fs::remove_file(path);
        }
        self.state.pid = None;
        self.state.lifecycle = "Stopped".into();
        self.state.save(&self.state_path)?;
        if killed_any || !self.state.process_alive() {
            Ok(())
        } else {
            anyhow::bail!("No QEMU or bootstrap process could be terminated")
        }
    }
    /// Adopt a running foreign QEMU process (e.g. one started by
    /// dev-local.ps1) as the managed VM: takes over its PID, ports and
    /// network mode so the watchdog, probes and self-healing apply to it.
    pub fn adopt(&mut self, info: &QemuProcessInfo) -> Result<()> {
        self.refresh_state_from_disk();
        if let Some(managed) = self.state.pid {
            if managed != info.pid && self.state.process_alive() {
                anyhow::bail!(
                    "already managing QEMU PID {managed}; stop it before attaching to PID {}",
                    info.pid
                );
            }
        }
        self.state.pid = Some(info.pid);
        self.state.lifecycle = "Booting".into();
        self.state.last_error = None;
        if let Some(mode) = info.network_mode.clone() {
            self.state.network_mode = mode;
        }
        self.state.vm_host = if self.state.network_mode == NetworkMode::Slirp {
            "127.0.0.1".into()
        } else {
            String::new()
        };
        if let Some(port) = info.qmp_port {
            self.state.qmp_port = port;
        }
        if let Some(port) = info.qga_port {
            self.state.qga_port = port;
        }
        if let Some(port) = info.ssh_port {
            self.state.ssh_port = port;
        }
        if let Some(port) = info.home_port {
            self.state.home_port = port;
        }
        if let Some(display) = info.vnc_display {
            self.state.vnc_port = Some(5900 + display);
            self.state.vnc_ws_port = Some(5700 + display);
        }
        if let Some(disk) = &info.disk {
            self.state.vm_disk = Some(PathBuf::from(disk));
        }
        self.state.forwarded_ports = info
            .forwarded
            .iter()
            .map(|(host, guest)| serde_json::json!({ "host": host, "guest": guest }))
            .collect();
        self.state.skipped_ports = vec![];
        self.state.save(&self.state_path)?;
        Ok(())
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

/// A running QEMU process found on the host, with everything the dev
/// manager needs to attach to it or shut it down cleanly.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuProcessInfo {
    pub pid: u32,
    pub is_iora_dev: bool,
    pub disk: Option<String>,
    pub network_mode: Option<NetworkMode>,
    pub qmp_port: Option<u16>,
    pub qga_port: Option<u16>,
    pub ssh_port: Option<u16>,
    pub home_port: Option<u16>,
    pub forwarded: Vec<(u16, u16)>,
    pub vnc_display: Option<u16>,
    pub command_line: String,
}

/// Scan the host for running QEMU processes (any architecture) and parse
/// their command lines. Used to find IORA Dev VMs started outside this
/// daemon (e.g. by dev-local.ps1) so they can be adopted or stopped.
pub fn discover_qemu_processes() -> Vec<QemuProcessInfo> {
    qemu_process_entries()
        .into_iter()
        .filter_map(|(pid, command_line)| parse_qemu_process(pid, command_line))
        .collect()
}

/// Parse one (pid, command line) pair into process info.
fn parse_qemu_process(pid: u32, command_line: String) -> Option<QemuProcessInfo> {
    let command_line = command_line.trim().to_string();
    if command_line.is_empty() {
        return None;
    }
    let is_iora_dev = command_line.contains("iora-dev-vm")
        || command_line.contains("-name IORA-Dev")
        || command_line.contains("iora-dev");
    let forwarded = scan_hostfwd(&command_line);
    let network_mode = if command_line.contains("netdev tap,") {
        Some(NetworkMode::Bridge)
    } else if command_line.contains("netdev user,") {
        Some(NetworkMode::Slirp)
    } else {
        None
    };
    let disk = disk_after(&command_line).map(|value| value.replace('\\', "/"));
    Some(QemuProcessInfo {
        pid,
        is_iora_dev,
        disk,
        network_mode,
        qmp_port: scan_numbers(&command_line, "-qmp tcp:127.0.0.1:")
            .first()
            .map(|value| *value as u16),
        qga_port: scan_numbers(&command_line, "id=qga0,host=127.0.0.1,port=")
            .first()
            .map(|value| *value as u16),
        ssh_port: forwarded
            .iter()
            .find(|(_, guest)| *guest == 22)
            .map(|(host, _)| *host),
        home_port: forwarded
            .iter()
            .find(|(_, guest)| *guest == 8126)
            .map(|(host, _)| *host),
        forwarded,
        vnc_display: scan_numbers(&command_line, "-vnc 127.0.0.1:")
            .first()
            .map(|value| *value as u16),
        command_line,
    })
}

/// Raw (pid, command line) pairs of running qemu-system-* processes.
#[cfg(windows)]
fn qemu_process_entries() -> Vec<(u32, String)> {
    // WMIC is deprecated/optional on recent Windows builds; PowerShell CIM
    // is always present. CommandLine can be huge - CIM returns it whole.
    let script = "Get-CimInstance Win32_Process -Filter \"Name like 'qemu-system%'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    let value: Value = serde_json::from_str(output.trim()).unwrap_or(Value::Null);
    let entries = match value {
        Value::Array(items) => items,
        Value::Object(_) => vec![value],
        _ => return Vec::new(),
    };
    entries
        .into_iter()
        .filter_map(|item| {
            let pid = item.get("ProcessId")?.as_u64()? as u32;
            let command_line = item.get("CommandLine")?.as_str()?.to_string();
            Some((pid, command_line))
        })
        .collect()
}

/// Raw (pid, command line) pairs of running qemu-system-* processes.
#[cfg(not(windows))]
fn qemu_process_entries() -> Vec<(u32, String)> {
    let output = Command::new("pgrep")
        .args(["-af", "qemu-system"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    output
        .lines()
        .filter_map(|line| {
            let (pid, rest) = line.split_once(' ')?;
            let pid = pid.parse::<u32>().ok()?;
            Some((pid, rest.to_string()))
        })
        .collect()
}

/// Whether a dev-local bootstrap/reinstall process is currently running
/// (started by the daemon via `dev-local.ps1 -Rebuild -NoWatch`).
pub fn bootstrap_alive(root: &Path) -> bool {
    let pid = std::fs::read_to_string(root.join(".cache/dev-local-bootstrap.pid"))
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok());
    pid.is_some_and(crate::state::process_alive)
}

/// Environment self-diagnosis shown at daemon startup and by `doctor`.
/// Returns human-readable notes; the caller decides how to present them.
pub fn environment_notes(root: &Path) -> Vec<String> {
    let mut notes: Vec<String> = Vec::new();

    // QEMU binary present?
    let qemu = resolve_qemu();
    let qemu_ok = if cfg!(windows) {
        windows_qemu_dir("qemu-system-x86_64.exe").is_some()
            || std::env::var("IORA_DEV_QEMU").is_ok_and(|p| Path::new(&p).exists())
    } else {
        Path::new("/dev/kvm").exists() || {
            std::process::Command::new(&qemu)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    };
    if !qemu_ok {
        notes.push(format!(
            "QEMU not found ({qemu}). Install it (winget install SoftwareFreedomConservancy.QEMU) or set IORA_DEV_QEMU."
        ));
    }

    // WSL2 (needed on Windows for ISO/tar creation).
    if cfg!(windows) {
        let wsl_ok = std::process::Command::new("wsl.exe")
            .args(["--status"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !wsl_ok {
            notes.push(
                "WSL2 not available (wsl --status failed). The bootstrap needs WSL for ISO/tar creation: run `wsl --install`."
                    .to_string(),
            );
        }
    }

    // VM disk present? If not, the daemon provisions on first start.
    let disk = root.join(".cache/iora-dev-vm.qcow2");
    if !disk.exists() {
        notes.push(format!(
            "VM disk missing ({}): first start will download the Debian cloud image and provision (~400MB, one-time).",
            disk.display()
        ));
    }

    // Windows execution policy: unsigned .psm1 imports may be blocked.
    if cfg!(windows) {
        if let Some(policy) = execution_policy_name() {
            let blocking = matches!(policy.as_str(), "Restricted" | "AllSigned" | "RemoteSigned");
            if blocking {
                notes.push(format!(
                    "Windows PowerShell execution policy is '{policy}': unsigned module imports may be blocked. The daemon launches scripts with -ExecutionPolicy Bypass and dev-local.ps1 self-heals for its own session - no action needed."
                ));
            }
        }
    }

    notes
}

/// Current Windows PowerShell execution policy (first defined scope).
fn execution_policy_name() -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-ExecutionPolicy -List | Where-Object { $_.ExecutionPolicy -ne 'Undefined' } | Select-Object -First 1).ExecutionPolicy",
        ])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

/// Find the VM disk path: start at the first `iora-dev-vm` occurrence and
/// expand to the whole token (bounded by space/quote/comma).
fn disk_after(input: &str) -> Option<String> {
    let relative = input.find("iora-dev-vm")?;
    let start = input[..relative]
        .rfind(|c| c == ' ' || c == '"' || c == '=')
        .map(|position| position + 1)
        .unwrap_or(0);
    let rest = &input[start..];
    let end = rest
        .find(|c| c == ',' || c == '"' || c == ' ')
        .unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

/// All decimal numbers directly following `needle` in `input`.
fn scan_numbers(input: &str, needle: &str) -> Vec<u64> {
    let mut out = Vec::new();
    let mut search = 0;
    while let Some(relative) = input[search..].find(needle) {
        let pos = search + relative + needle.len();
        let rest = &input[pos..];
        let mut end = 0;
        while end < rest.len() && rest.as_bytes()[end].is_ascii_digit() {
            end += 1;
        }
        if end > 0 {
            if let Ok(value) = rest[..end].parse::<u64>() {
                out.push(value);
            }
            search = pos + end;
        } else {
            search = pos + 1;
        }
    }
    out
}

/// All `hostfwd=tcp:[127.0.0.1:]HOST-:GUEST` rules as (host, guest) pairs.
fn scan_hostfwd(input: &str) -> Vec<(u16, u16)> {
    let mut out = Vec::new();
    let mut search = 0;
    while let Some(relative) = input[search..].find("hostfwd=tcp:") {
        let mut pos = search + relative + "hostfwd=tcp:".len();
        if input[pos..].starts_with("127.0.0.1:") {
            pos += "127.0.0.1:".len();
        } else if input[pos..].starts_with(':') {
            // dev-local style: `hostfwd=tcp::2222-:22` (empty host = all
            // interfaces) - skip the empty host part before the port.
            pos += 1;
        }
        let rest = &input[pos..];
        let mut end = 0;
        while end < rest.len() && rest.as_bytes()[end].is_ascii_digit() {
            end += 1;
        }
        if end == 0 {
            search = pos + 1;
            continue;
        }
        let host = rest[..end].parse::<u16>().ok();
        let after = pos + end;
        if !input[after..].starts_with("-:") {
            search = after;
            continue;
        }
        let rest = &input[after + 2..];
        let mut end2 = 0;
        while end2 < rest.len() && rest.as_bytes()[end2].is_ascii_digit() {
            end2 += 1;
        }
        if end2 == 0 {
            search = after + 2;
            continue;
        }
        if let (Some(host), Ok(guest)) = (host, rest[..end2].parse::<u16>()) {
            out.push((host, guest));
        }
        search = after + 2 + end2;
    }
    out
}

/// One Slirp `hostfwd` rule set: the rules string for QEMU plus the host
/// ports actually forwarded / skipped.
struct ForwardingPlan {
    rules: Vec<String>,
    forwarded: Vec<(u16, u16, Option<String>)>,
    skipped: Vec<u16>,
}

/// Build the Slirp `hostfwd` rule set for the QEMU user-net backend.
///
/// QEMU fails the *whole* netdev when a single forwarding rule cannot be set
/// up (busy host port or a duplicate rule) - the VM would then boot with NO
/// network at all, which shows up as a cloud-init / "never became ready"
/// timeout. The extra-port list (default 5173) and the persisted custom
/// mappings are independent sources and frequently overlap, so rules are
/// deduplicated by host port and busy host ports are skipped with a warning,
/// exactly like dev-local.ps1's Add-PortIfFree does.
fn forwarding_plan(
    ssh_port: u16,
    home_port: u16,
    extra: Vec<u16>,
    mappings: &[PortMapping],
) -> ForwardingPlan {
    forwarding_plan_with(ssh_port, home_port, extra, mappings, host_port_in_use)
}

/// Testable core of `forwarding_plan` with an injectable busy-port probe.
fn forwarding_plan_with(
    ssh_port: u16,
    home_port: u16,
    extra: Vec<u16>,
    mappings: &[PortMapping],
    port_in_use: impl Fn(u16) -> bool,
) -> ForwardingPlan {
    let mut candidates: Vec<(u16, u16, Option<String>)> = vec![(ssh_port, 22, None)];
    candidates.extend(extra.into_iter().map(|port| (port, port, None)));
    candidates.extend(
        mappings
            .iter()
            .map(|mapping| (mapping.host, mapping.guest, mapping.label.clone())),
    );
    candidates.push((home_port, 8126, None));
    let mut plan = ForwardingPlan {
        rules: Vec::new(),
        forwarded: Vec::new(),
        skipped: Vec::new(),
    };
    let mut seen = HashSet::new();
    for (host, guest, label) in candidates {
        if !seen.insert(host) {
            // A second rule for the same host port (e.g. 5173 from both the
            // default forward list and a custom mapping) would make QEMU
            // reject the whole user-net - keep the first, drop the rest.
            plan.skipped.push(host);
            continue;
        }
        if port_in_use(host) {
            plan.skipped.push(host);
            continue;
        }
        plan.rules
            .push(format!("hostfwd=tcp:127.0.0.1:{host}-:{guest}"));
        plan.forwarded.push((host, guest, label));
    }
    // WebRTC (ORA Browser): the browser receives the GStreamer media over
    // UDP. It connects to 127.0.0.1:40000 on the host; inside the guest
    // iora-browserd runs a socat hop from :40000 to the session port.
    if !port_in_use(40000) {
        plan.rules.push("hostfwd=udp:127.0.0.1:40000-:40000".to_string());
        plan.forwarded
            .push((40000, 40000, Some("WebRTC (UDP)".to_string())));
    } else {
        plan.skipped.push(40000);
    }
    plan
}

/// Probe whether a host port is already bound by binding it ourselves - the
/// same check QEMU's user-net performs when it sets up the forwarding rule.
pub(crate) fn host_port_in_use(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
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
/// Parse the RAM value ("8G", "8192M") into GB for TCG clamping.
fn clamp_ram_gb(memory: &str) -> u32 {
    let digits: String = memory
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        8
    } else if memory.contains(['M', 'm']) {
        digits.parse::<u32>().unwrap_or(8) / 1024
    } else {
        digits.parse::<u32>().unwrap_or(8)
    }
}

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
pub(crate) fn kill_process(pid: u32) -> Result<()> {
    if !crate::state::process_alive(pid) {
        return Ok(()); // already gone - not an error
    }
    Command::new("kill")
        .args(["-9", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?
        .success()
        .then_some(())
        .context("kill failed")
}
#[cfg(windows)]
pub(crate) fn kill_process(pid: u32) -> Result<()> {
    if !crate::state::process_alive(pid) {
        return Ok(()); // already gone - not an error
    }
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
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
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = std::fs::File::open(path) else {
        return "No log available".into();
    };
    // Seek near the end instead of reading the whole (possibly multi-MB)
    // log - keeps `doctor`, `logs` and the activity parser cheap.
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let window: u64 = 64 * 1024;
    let start = size.saturating_sub(window);
    let _ = file.seek(SeekFrom::Start(start));
    let mut buf = String::new();
    let _ = file.read_to_string(&mut buf);
    let all: Vec<&str> = buf.lines().collect();
    let slice = if all.len() > lines {
        &all[all.len() - lines..]
    } else {
        &all[..]
    };
    if slice.is_empty() {
        return "No log available".into();
    }
    slice.join("\n")
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

    #[test]
    fn forwarding_plan_deduplicates_overlapping_host_ports() {
        // 5173 comes from both the default extra-port list AND a custom
        // mapping - exactly the duplicate that killed the user-net in the
        // field. The first rule wins, the duplicate is reported as skipped.
        let plan = forwarding_plan_with(
            2222,
            8126,
            vec![5173, 5432],
            &[PortMapping {
                host: 5173,
                guest: 5174,
                label: Some("duplicate".into()),
            }],
            |_| false, // deterministic: nothing is busy on the host
        );
        assert_eq!(
            plan.rules,
            vec![
                "hostfwd=tcp:127.0.0.1:2222-:22",
                "hostfwd=tcp:127.0.0.1:5173-:5173",
                "hostfwd=tcp:127.0.0.1:5432-:5432",
                "hostfwd=tcp:127.0.0.1:8126-:8126",
            ]
        );
        assert_eq!(plan.skipped, vec![5173]);
        assert_eq!(plan.forwarded.len(), 4);
    }

    #[test]
    fn forwarding_plan_skips_busy_host_ports() {
        // Occupy a port, then make sure the plan skips it instead of letting
        // QEMU fail the whole user-net.
        let busy = 5173;
        let plan = forwarding_plan_with(2222, 8126, vec![busy], &[], |port| port == busy);
        assert!(plan.rules.iter().all(|rule| !rule.contains(&busy.to_string())));
        assert_eq!(plan.skipped, vec![busy]);
        assert!(!plan.forwarded.iter().any(|(host, _, _)| *host == busy));
    }

    #[test]
    fn qemu_cmdline_parsing_finds_iora_dev_vm() {
        // A real dev-local.ps1 command line (as seen in the field).
        let command_line = r#"C:\Program Files\qemu\qemu-system-x86_64.exe -name IORA-Dev -m 16G -smp 16 -machine q35,accel=whpx -drive file=C:\tmp\home-assistant-dashb\iora-os\.cache\iora-dev-vm.qcow2,format=qcow2,if=none,id=iora-disk -device virtio-blk-pci,drive=iora-disk,bootindex=1 -drive file=C:\tmp\home-assistant-dashb\iora-os\.cache\iora-dev-seed.iso,format=raw,media=cdrom,if=none,id=iora-seed -device ide-cd,drive=iora-seed,bootindex=2 -netdev user,id=n0,hostfwd=tcp::2222-:22,hostfwd=tcp::8126-:8126,hostfwd=tcp::5173-:5173 -device virtio-net-pci,netdev=n0 -chardev socket,id=qga0,host=127.0.0.1,port=8109,server=on,wait=off -device virtserialport,chardev=qga0,id=qga0,name=org.qemu.guest_agent.0 -qmp tcp:127.0.0.1:8130,server=on,wait=off -vnc 127.0.0.1:1"#;
        let info = parse_qemu_process(4242, command_line.into()).unwrap();
        assert!(info.is_iora_dev);
        assert_eq!(info.network_mode, Some(NetworkMode::Slirp));
        assert_eq!(info.qmp_port, Some(8130));
        assert_eq!(info.qga_port, Some(8109));
        assert_eq!(info.ssh_port, Some(2222));
        assert_eq!(info.home_port, Some(8126));
        assert_eq!(info.vnc_display, Some(1));
        assert_eq!(info.forwarded, vec![(2222, 22), (8126, 8126), (5173, 5173)]);
        assert!(info
            .disk
            .as_deref()
            .unwrap()
            .contains("iora-dev-vm.qcow2"));
    }

    #[test]
    fn qemu_cmdline_parsing_marks_foreign_vms() {
        let info = parse_qemu_process(
            7,
            "/usr/bin/qemu-system-x86_64 -m 2G -netdev user,id=n0 -vnc 127.0.0.1:4".into(),
        )
        .unwrap();
        assert!(!info.is_iora_dev);
        assert_eq!(info.qmp_port, None);
        assert_eq!(info.vnc_display, Some(4));
    }
}
