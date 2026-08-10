use crate::{
    channels,
    devloop::{self, DevEvent},
    manager::{self, Manager, Probe},
    state::{self, NetworkMode, PortMapping},
};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    net::TcpStream,
    sync::{broadcast, Mutex as AsyncMutex},
    time::{interval, timeout},
};

pub const LOG_CAPACITY: usize = 2000;
const WATCHDOG_SECS: u64 = 3;
const MAX_RESTART_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Serialize)]
pub struct EventMsg {
    pub kind: String,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Desired {
    pub running: bool,
    pub retries: u32,
    pub mode: NetworkMode,
    pub message: String,
    pub ever_ready: bool,
}

/// Bounded retry state for the guest network remediation.
struct NetRepairState {
    attempts: u32,
    last_attempt: Option<Instant>,
}

/// Cached "installation finished" marker of the guest. `None` means
/// unknown / not yet determined (re-checked every 60s).
struct MarkerState {
    value: Option<bool>,
    checked_at: Option<Instant>,
}

/// Progress state for the cargo registry seeding phase (host -> guest).
struct SeedProgress {
    total_mb: Option<u64>,
    last_mb: Option<u64>,
    last_at: Option<Instant>,
    rate_mb_per_s: f64,
}

/// Live progress of the Debian cloud-image download, parsed from the
/// dev-local transcript (`[DLP] <received> <total>` lines emitted by the
/// provisioning script). Used for the "Preparing" phase with percent + ETA.
#[derive(Default)]
struct DownloadProgress {
    received: u64,
    total: u64,
    last_bytes: Option<u64>,
    last_at: Option<Instant>,
    rate_bps: f64,
    percent: u8,
}

pub struct Daemon {
    pub manager: AsyncMutex<Manager>,
    pub logs: Mutex<VecDeque<String>>,
    pub events: broadcast::Sender<EventMsg>,
    pub desired: Mutex<Desired>,
    pub last_probe: Mutex<Probe>,
    pub last_message: Mutex<String>,
    pub log_offsets: Mutex<HashMap<PathBuf, u64>>,
    pub status_cache: Mutex<Value>,
    pub stats_cache: Mutex<Value>,
    pub ports_opened: Mutex<bool>,
    pub mappings: Mutex<Vec<PortMapping>>,
    pub live_added: Mutex<HashSet<u16>>,
    /// Host port -> SSH tunnel child PID (std::process::Child can't be stored
    /// in a Mutex across awaits, so we keep the PID and re-attach by port).
    pub tunnels: Mutex<HashMap<u16, u32>>,
    pub mappings_path: PathBuf,
    net_repair: Mutex<NetRepairState>,
    install_marker: Mutex<MarkerState>,
    seed_progress: Mutex<SeedProgress>,
    last_build_check: Mutex<Option<Instant>>,
    last_provision_note: Mutex<Option<Instant>>,
    download_progress: Mutex<DownloadProgress>,
    vms_cache: Mutex<Value>,
}

impl Daemon {
    pub fn new(manager: Manager) -> Arc<Self> {
        let (events, _) = broadcast::channel(512);
        let mappings_path = manager.root.join(".cache/port-mappings.json");
        let mappings = fs::read_to_string(&mappings_path)
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default();
        Arc::new(Self {
            tunnels: Mutex::new(HashMap::new()),
            manager: AsyncMutex::new(manager),
            logs: Mutex::new(VecDeque::new()),
            events,
            desired: Mutex::new(Desired {
                running: false,
                retries: 0,
                mode: NetworkMode::Slirp,
                message: String::new(),
                ever_ready: false,
            }),
            last_probe: Mutex::new(Probe::default()),
            last_message: Mutex::new("Daemon started".into()),
            log_offsets: Mutex::new(HashMap::new()),
            status_cache: Mutex::new(json!({"lifecycle": "Starting"})),
            stats_cache: Mutex::new(json!({})),
            ports_opened: Mutex::new(false),
            mappings: Mutex::new(mappings),
            live_added: Mutex::new(HashSet::new()),
            mappings_path,
            net_repair: Mutex::new(NetRepairState {
                attempts: 0,
                last_attempt: None,
            }),
            install_marker: Mutex::new(MarkerState {
                value: None,
                checked_at: None,
            }),
            seed_progress: Mutex::new(SeedProgress {
                total_mb: None,
                last_mb: None,
                last_at: None,
                rate_mb_per_s: 0.0,
            }),
            last_build_check: Mutex::new(None),
            last_provision_note: Mutex::new(None),
            download_progress: Mutex::new(DownloadProgress::default()),
            vms_cache: Mutex::new(json!({"vms": []})),
        })
    }

    pub fn emit(&self, kind: &str, message: impl Into<String>) {
        let message = message.into();
        *self.last_message.lock().unwrap() = message.clone();
        let mut logs = self.logs.lock().unwrap();
        if logs.len() >= LOG_CAPACITY {
            logs.pop_front();
        }
        logs.push_back(message.clone());
        drop(logs);
        let _ = self.events.send(EventMsg {
            kind: kind.into(),
            message,
            timestamp: now_secs(),
        });
    }

    pub fn logs_snapshot(&self, tail: usize) -> Vec<String> {
        let logs = self.logs.lock().unwrap();
        logs.iter()
            .rev()
            .take(tail)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    pub async fn status_json(&self) -> Value {
        // Serve the watchdog's latest snapshot; the probe can be slow while
        // the guest shuts down, and status must never block on it.
        self.status_cache.lock().unwrap().clone()
    }

    pub fn refresh_status_cache(&self) {
        let Ok(manager) = self.manager.try_lock() else {
            return;
        };
        let state = manager.state.clone();
        let root = manager.root.clone();
        let (host, ssh, home) = state.connection();
        drop(manager);
        let probe = self.last_probe.lock().unwrap().clone();
        let desired = self.desired.lock().unwrap().clone();
        let bootstrap_alive = manager::bootstrap_alive(&root);
        // While the bootstrap runs (first install or -Rebuild) there is no
        // QEMU process yet, so the probe would say "Stopped" - surface the
        // real activity instead.
        let lifecycle = if bootstrap_alive {
            if state.lifecycle == "Reinstalling" {
                "Reinstalling"
            } else {
                "Provisioning"
            }
        } else {
            probe.lifecycle()
        };
        let stats = self.stats_cache.lock().unwrap().clone();
        let download = if bootstrap_alive || lifecycle == "Provisioning" {
            self.download_progress_json(&root)
        } else {
            Value::Null
        };
        *self.status_cache.lock().unwrap() = json!({
            "state": state,
            "probe": probe,
            "lifecycle": lifecycle,
            "desired": desired,
            "connection": { "host": host, "ssh": ssh, "home": home },
            "message": self.last_message.lock().unwrap().clone(),
            "logLines": self.logs.lock().unwrap().len(),
            "bootstrap": json!({ "alive": bootstrap_alive }),
            "download": download,
            "activity": stats.get("activity").cloned().unwrap_or(Value::Null),
            "access": json!({
                // Dev-VM defaults (same as the dev-local banner); SSH uses the
                // actual key path and port from the current state.
                "ssh": format!("ssh -i {} -p {ssh} root@{host}", root.join(".cache/iora-dev-key").display()),
                "keyPath": root.join(".cache/iora-dev-key").display().to_string(),
                "webUrl": format!("http://{host}:{home}"),
                "webUser": "admin",
                "webPassword": "admin1234",
                "webPin": "0000",
            }),
        })
    }

    pub async fn start(&self, mode: NetworkMode) -> Result<()> {
        {
            let mut desired = self.desired.lock().unwrap();
            desired.running = true;
            desired.retries = 0;
            desired.mode = mode.clone();
            desired.message = "Starting".into();
            desired.ever_ready = false;
        }
        let result = {
            let mappings = self.mappings.lock().unwrap().clone();
            self.manager.lock().await.start(mode, &mappings)
        };
        // A fresh VM starts with an empty firewall; the ports must be
        // reopened once it becomes ready again.
        if result.is_ok() {
            *self.ports_opened.lock().unwrap() = false;
            // The idempotent guest fixes (guard patch, SSH hardening, net
            // watchdog) must be re-applied for this VM start.
            let mut manager = self.manager.lock().await;
            manager.state.guest_fixes_applied = false;
            let _ = manager.state.save(&manager.state_path);
            drop(manager);
            *self.install_marker.lock().unwrap() = MarkerState {
                value: None,
                checked_at: None,
            };
        }
        match result {
            Ok(()) => {
                self.emit("status", "VM start requested");
                self.refresh_status_cache();
                Ok(())
            }
            Err(error) => {
                self.desired.lock().unwrap().running = false;
                let message = format!("VM start failed: {error:#}");
                self.record_error(&message).await;
                self.emit("error", message.clone());
                self.refresh_status_cache();
                Err(anyhow::anyhow!("{message}"))
            }
        }
    }

    async fn record_error(&self, message: &str) {
        let mut manager = self.manager.lock().await;
        manager.state.last_error = Some(message.into());
        let _ = manager.state.save(&manager.state_path);
    }

    pub async fn stop(&self, hard: bool) -> Result<()> {
        self.desired.lock().unwrap().running = false;
        let mut manager = self.manager.lock().await;
        if hard {
            manager.hard_stop()?;
            self.emit("status", "VM process terminated");
        } else {
            manager.graceful_stop().await?;
            self.emit("status", "Graceful shutdown requested");
        }
        drop(manager);
        self.refresh_status_cache();
        Ok(())
    }

    pub async fn qmp(&self, action: &str, label: &str) -> Result<()> {
        let manager = self.manager.lock().await;
        let result = manager.qmp_action(action).await;
        drop(manager);
        result?;
        self.emit("status", label);
        self.refresh_status_cache();
        Ok(())
    }

    pub async fn snapshot(&self) -> Result<()> {
        let mut manager = self.manager.lock().await;
        let result = manager.create_golden_snapshot();
        drop(manager);
        result?;
        self.emit("status", "Golden Snapshot created");
        self.refresh_status_cache();
        Ok(())
    }

    pub async fn reinstall(&self) -> Result<()> {
        self.desired.lock().unwrap().running = true;
        let mut manager = self.manager.lock().await;
        manager.reinstall()?;
        drop(manager);
        *self.ports_opened.lock().unwrap() = false;
        *self.install_marker.lock().unwrap() = MarkerState {
            value: None,
            checked_at: None,
        };
        self.emit("status", "VM reinstall requested");
        self.refresh_status_cache();
        Ok(())
    }

    pub async fn services(&self) -> Result<Vec<Value>> {
        let manager = self.manager.lock().await;
        let output = manager
            .guest("systemctl list-units --type=service --all --no-legend --no-pager --plain 'iora-*'")
            .await?;
        Ok(parse_services(&output))
    }

    pub async fn service_action(&self, unit: String, action: String) -> Result<String> {
        let manager = self.manager.lock().await;
        manager
            .guest(&format!(
                "systemctl {} {} && systemctl is-active {}",
                shell_quote(&action),
                shell_quote(&unit),
                shell_quote(&unit)
            ))
            .await
    }

    pub async fn service_logs(&self, unit: String, tail: usize) -> Result<String> {
        let manager = self.manager.lock().await;
        manager
            .guest(&format!(
                "journalctl -u {} -n {} --no-pager --output=short",
                shell_quote(&unit),
                tail
            ))
            .await
    }

    pub async fn guest(&self, command: String) -> Result<String> {
        let manager = self.manager.lock().await;
        manager.guest(&command).await
    }

    /// All running QEMU processes with their parsed details; `isManaged`
    /// marks the VM this daemon currently controls.
    ///
    /// Serves a cached scan: the underlying discovery runs a synchronous
    /// PowerShell CIM query on Windows which blocks a worker thread and made
    /// the dashboard unresponsive during provisioning. The cache is refreshed
    /// by a background task (see `spawn`) and on demand when stale.
    pub async fn qemu_vms(&self) -> Value {
        self.vms_cache.lock().unwrap().clone()
    }

    /// Refresh the QEMU-process scan cache (background task). The underlying
    /// discovery runs a slow, SYNCHRONOUS PowerShell CIM query on Windows -
    /// it runs here via spawn_blocking so it never occupies an async worker
    /// (which used to freeze the dashboard during provisioning).
    pub async fn refresh_vms_cache(&self) {
        let managed = self.manager.lock().await.state.pid;
        let processes = tokio::task::spawn_blocking(manager::discover_qemu_processes)
            .await
            .unwrap_or_default();
        let vms = processes
            .into_iter()
            .map(|process| {
                let mut value = serde_json::to_value(&process).unwrap_or(Value::Null);
                if let Some(object) = value.as_object_mut() {
                    object.insert("isManaged".into(), json!(managed == Some(process.pid)));
                }
                value
            })
            .collect::<Vec<_>>();
        *self.vms_cache.lock().unwrap() = json!({"vms": vms});
    }

    /// Adopt a running foreign QEMU process as the managed VM.
    pub async fn adopt_foreign(&self, pid: u32) -> Result<()> {
        let processes = manager::discover_qemu_processes();
        let info = processes
            .iter()
            .find(|process| process.pid == pid)
            .context("no running QEMU process with that PID")?;
        if !info.is_iora_dev {
            anyhow::bail!("PID {pid} does not look like an IORA Dev VM (no iora-dev-vm disk)");
        }
        {
            let mut manager = self.manager.lock().await;
            manager.adopt(info)?;
        }
        {
            let mut desired = self.desired.lock().unwrap();
            desired.running = true;
            desired.retries = 0;
            desired.ever_ready = false;
            desired.message = "Attached to running VM".into();
        }
        *self.ports_opened.lock().unwrap() = false;
        *self.net_repair.lock().unwrap() = NetRepairState {
            attempts: 0,
            last_attempt: None,
        };
        *self.install_marker.lock().unwrap() = MarkerState {
            value: None,
            checked_at: None,
        };
        self.emit("status", format!("Attached to running QEMU PID {pid}"));
        self.ensure_default_mappings().await;
        self.refresh_status_cache();
        Ok(())
    }

    /// Stop a foreign (non-managed) QEMU process as cleanly as possible:
    /// guest shutdown via QGA, then ACPI powerdown via QMP, then force-kill.
    /// Rebuild the slirp user-net backend (netdev_del + netdev_add). This is
    /// the "NIC reset" for stuck QEMU slirp sessions (SYN_SENT leaks, stale
    /// hostfwd rules) WITHOUT a VM restart: the whole user-net stack
    /// including the session table is recreated. All forwarding rules are
    /// restored from the running QEMU command line plus the persisted
    /// mappings, so nothing is lost.
    pub async fn reset_network(&self) -> Result<String> {
        let (qmp_port, socket) = {
            let manager = self.manager.lock().await;
            (manager.state.qmp_port, manager.root.join(".cache/qmp.sock"))
        };
        // Rule set: what the running QEMU was started with, plus any custom
        // mappings added at runtime (deduplicated by host port).
        let processes = manager::discover_qemu_processes();
        let info = processes
            .iter()
            .find(|process| process.is_iora_dev)
            .context("no IORA Dev VM found - is the VM running?")?;
        let mut rules: Vec<String> = info
            .forwarded
            .iter()
            .map(|(host, guest)| format!("hostfwd=tcp:127.0.0.1:{host}-:{guest}"))
            .collect();
        let mappings = self.mappings.lock().unwrap().clone();
        for mapping in &mappings {
            let host = mapping.host;
            if !rules
                .iter()
                .any(|rule| rule.contains(&format!("127.0.0.1:{host}-")))
            {
                rules.push(format!(
                    "hostfwd=tcp:127.0.0.1:{}-:{}",
                    mapping.host, mapping.guest
                ));
            }
        }
        // Tear the old backend down (drops every slirp session), then
        // rebuild it. Rules whose host port cannot be bound (e.g. stuck in
        // TIME_WAIT/CLOSE_WAIT by a browser) make the whole netdev_add fail
        // - retry without them and add them back individually afterwards.
        let _ = channels::qmp_command(
            qmp_port,
            &socket,
            "human-monitor-command",
            json!({"command-line": "netdev_del n0"}),
        )
        .await;
        tokio::time::sleep(Duration::from_millis(800)).await;
        let mut deferred: Vec<(u16, u16)> = Vec::new();
        let mut pending = rules.clone();
        let mut added = false;
        for _attempt in 0..5 {
            if pending.is_empty() {
                added = true;
                break;
            }
            let backend = format!("user,id=n0,{}", pending.join(","));
            let response = channels::qmp_command(
                qmp_port,
                &socket,
                "human-monitor-command",
                json!({"command-line": format!("netdev_add {backend}")}),
            )
            .await;
            let success = response
                .as_ref()
                .is_ok_and(|r| r.get("error").is_none());
            if success {
                added = true;
                break;
            }
            // Find the offending rule from the error text and defer it.
            let message = response
                .as_ref()
                .ok()
                .map(|r| {
                    r["error"]["desc"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string()
                })
                .unwrap_or_default();
            let deferred_rule = pending
                .iter()
                .position(|rule| {
                    rule.contains("127.0.0.1:")
                        && message.contains(&rule.split(',').next().unwrap_or("").to_string())
                })
                .or_else(|| {
                    // Fallback: defer a rule whose port appears in the error.
                    let port = message
                        .split(|c: char| !c.is_ascii_digit())
                        .filter(|part| !part.is_empty())
                        .next_back()
                        .and_then(|part| part.parse::<u16>().ok());
                    port.and_then(|port| {
                        pending
                            .iter()
                            .position(|rule| rule.contains(&format!(":{port}-")))
                    })
                });
            match deferred_rule {
                Some(index) => {
                    let rule = pending.remove(index);
                    // hostfwd=tcp:127.0.0.1:HOST-GUEST  ->  (host, guest)
                    let fields = rule.split(":127.0.0.1:").nth(1).unwrap_or("");
                    let (host, guest) = fields.split_once('-').unwrap_or(("", ""));
                    let host: u16 = host.trim_start_matches(':').parse().unwrap_or(0);
                    let guest: u16 = guest.trim_start_matches(':').parse().unwrap_or(0);
                    if host > 0 && guest > 0 {
                        deferred.push((host, guest));
                    }
                    self.emit(
                        "status",
                        format!("port forwarding rule deferred (busy host port): {rule}"),
                    );
                }
                None => {
                    anyhow::bail!(
                        "netdev_add failed and the offending rule could not be identified: {message} - the VM may need a restart"
                    );
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        if !added {
            anyhow::bail!("netdev_add failed after 5 attempts - the VM may need a restart");
        }
        // The NIC device does not re-attach automatically after netdev_del -
        // bounce the link so the guest gets carrier again (set_link takes
        // the DEVICE name, not the netdev id).
        let device_name = {
            let output = channels::qmp_command(
                qmp_port,
                &socket,
                "human-monitor-command",
                json!({"command-line": "info network"}),
            )
            .await
            .ok()
            .and_then(|r| r["return"].as_str().map(str::to_string))
            .unwrap_or_default();
            output
                .lines()
                .find(|line| line.contains("netdev=n0"))
                .or_else(|| output.lines().next())
                .and_then(|line| line.split(':').next())
                .map(|name| name.trim().to_string())
                .unwrap_or_else(|| "virtio-net-pci.0".into())
        };
        let _ = channels::qmp_command(
            qmp_port,
            &socket,
            "human-monitor-command",
            json!({"command-line": format!("set_link {device_name} off")}),
        )
        .await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let _ = channels::qmp_command(
            qmp_port,
            &socket,
            "human-monitor-command",
            json!({"command-line": format!("set_link {device_name} on")}),
        )
        .await;
        // Restore the guest lease (the link bounce can drop the IP) and
        // re-add deferred rules once the guest is reachable again.
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let (qga_port, qga_socket) = {
            let manager = self.manager.lock().await;
            (manager.state.qga_port, manager.root.join(".cache/qga.sock"))
        };
        let _ = channels::guest_exec(
            qga_port,
            &qga_socket,
            "for i in 1 2 3 4 5; do ip -4 addr show enp0s3 2>/dev/null | grep -q ' inet ' && break; dhclient -1 enp0s3 >/dev/null 2>&1 || networkctl reconfigure enp0s3 >/dev/null 2>&1 || true; sleep 2; done; ip -4 route get 1.1.1.1 >/dev/null 2>&1 && echo NET_OK || echo NET_STILL_DOWN",
        )
        .await;
        for (host, guest) in &deferred {
            let ok = channels::qmp_command(
                qmp_port,
                &socket,
                "human-monitor-command",
                json!({"command-line": format!("hostfwd_add tcp:127.0.0.1:{host}-:{guest}")}),
            )
            .await
            .is_ok_and(|r| r.get("error").is_none());
            self.emit(
                "status",
                if ok {
                    format!("deferred port {host} added back")
                } else {
                    format!("port {host} still busy - will retry later")
                },
            );
        }
        self.emit("status", format!("Slirp network rebuilt ({} rules)", rules.len()));
        Ok(format!(
            "Slirp network rebuilt with {} rules ({} deferred)",
            rules.len(),
            deferred.len()
        ))
    }

    pub async fn stop_foreign(&self, pid: u32) -> Result<String> {
        {
            let manager = self.manager.lock().await;
            if manager.state.pid == Some(pid) {
                anyhow::bail!("PID {pid} is the managed VM - use the normal stop/kill actions");
            }
        }
        let processes = manager::discover_qemu_processes();
        let info = processes
            .iter()
            .find(|process| process.pid == pid)
            .context("no running QEMU process with that PID")?;
        let socket = self.manager.lock().await.root.join(".cache/qga.sock");
        let mut steps: Vec<String> = Vec::new();
        // 1) graceful guest shutdown through the guest agent
        if let Some(qga_port) = info.qga_port {
            if channels::qga(
                qga_port,
                &socket,
                json!({"execute": "guest-shutdown"}),
            )
            .await
            .is_ok()
            {
                steps.push("guest shutdown requested".into());
                self.emit("status", format!("Foreign VM PID {pid}: guest shutdown requested"));
                for _ in 0..10 {
                    if !state::process_alive(pid) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
        if !state::process_alive(pid) {
            self.emit("status", format!("Foreign VM PID {pid} shut down gracefully"));
            return Ok("VM shut down gracefully via guest agent".into());
        }
        // 2) ACPI powerdown through QMP
        if let Some(qmp_port) = info.qmp_port {
            if channels::qmp(qmp_port, &socket, "system_powerdown")
                .await
                .is_ok()
            {
                steps.push("ACPI powerdown sent".into());
                for _ in 0..10 {
                    if !state::process_alive(pid) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
        if !state::process_alive(pid) {
            self.emit("status", format!("Foreign VM PID {pid} powered down"));
            return Ok("VM powered down via ACPI".into());
        }
        // 3) last resort: force-kill
        if manager::kill_process(pid).is_ok() {
            steps.push("force-killed".into());
        }
        self.emit("status", format!("Foreign VM PID {pid} stopped ({})", steps.join(", ")));
        Ok(format!("VM stopped: {}", steps.join(", ")))
    }

    pub async fn stats(&self) -> Value {
        self.stats_cache.lock().unwrap().clone()
    }

    async fn refresh_stats(&self) {
        let manager = self.manager.lock().await;
        if !manager.state.process_alive() {
            drop(manager);
            *self.stats_cache.lock().unwrap() = json!({});
            return;
        }
        let disk_size = std::fs::metadata(manager.root.join(".cache/iora-dev-vm.qcow2"))
            .map(|meta| meta.len())
            .unwrap_or(0);
        let vnc = manager.state.vnc_port;
        let vnc_ws = manager.state.vnc_ws_port;
        // Guest metrics come from a single QGA round trip.
        let guest = manager
            .guest(r#"echo "UPTIME $(uptime -p)"; uptime | sed 's/.*load average: */LOAD /'; free -m | awk '/Mem:/{print "MEM "$2" "$3}'; df -h / | awk 'NR==2{print "DISK "$2" "$3" "$5}'"#)
            .await
            .unwrap_or_default();
        let mut cpu = String::new();
        let mut mem_total = String::new();
        let mut mem_used = String::new();
        let mut disk = String::new();
        let mut uptime = String::new();
        for line in guest.lines() {
            if let Some(rest) = line.strip_prefix("UPTIME ") {
                uptime = rest.trim().into();
            } else if let Some(rest) = line.strip_prefix("LOAD ") {
                cpu = rest.trim().into();
            } else if let Some(rest) = line.strip_prefix("MEM ") {
                let mut parts = rest.split_whitespace();
                mem_total = parts.next().unwrap_or_default().into();
                mem_used = parts.next().unwrap_or_default().into();
            } else if let Some(rest) = line.strip_prefix("DISK ") {
                disk = rest.trim().into();
            }
        }
        drop(manager);
        *self.stats_cache.lock().unwrap() = json!({
            "host": { "diskSize": disk_size },
            "guest": { "uptime": uptime, "load": cpu, "memTotalMb": mem_total, "memUsedMb": mem_used, "disk": disk },
            "vncPort": vnc,
            "vncWsPort": vnc_ws,
            "activity": self.compute_activity().await,
        });
    }

    async fn watchdog_tick(&self, last_lifecycle: &mut String) {
        let root = self.manager.lock().await.root.clone();
        self.append_serial_log(&root.join(".cache/qemu-serial.log"));
        self.append_named_log("dev-local", &root.join(".cache/dev-local.log"));
        self.append_named_log("dev-manager", &root.join(".cache/dev-manager.log"));

        let probe = {
            let mut manager = self.manager.lock().await;
            manager.probe().await
        };
        *self.last_probe.lock().unwrap() = probe.clone();
        let lifecycle = probe.lifecycle().to_string();

        // While the bootstrap provisions (first install / -Rebuild) there is
        // no QEMU process, so the probe stays "Stopped". Emit a throttled
        // progress note so the console + dashboard explain what is happening
        // instead of appearing stuck.
        if lifecycle == "Stopped" && manager::bootstrap_alive(&root) {
            let note_due = self
                .last_provision_note
                .lock()
                .unwrap()
                .map_or(true, |last| last.elapsed() >= Duration::from_secs(20));
            if note_due {
                *self.last_provision_note.lock().unwrap() = Some(Instant::now());
                let download = self.download_progress_json(&root);
                let message = if let Some(percent) = download["percent"].as_u64() {
                    format!(
                        "Vorbereitung: Debian cloud image wird heruntergeladen - {percent}% ({} / {} MB, {} MB/s, ~{} min verbleibend)",
                        download["receivedMb"].as_u64().unwrap_or(0),
                        download["totalMb"].as_u64().unwrap_or(0),
                        download["rateMbPerS"].as_f64().unwrap_or(0.0),
                        download["etaSecs"].as_u64().unwrap_or(0) / 60,
                    )
                } else {
                    "Vorbereitung: der erste Start lädt das Debian Cloud-Image (~400MB) herunter und installiert die IORA-Runtime (5-15 min). Das Dashboard bleibt erreichbar; die IORA-Web-UI erscheint, sobald die VM bereit ist."
                        .to_string()
                };
                self.emit("status", message);
            }
        } else if lifecycle != "Stopped" {
            *self.last_provision_note.lock().unwrap() = None;
        }

        // Open forwarded ports only once the guest is fully up: the IORA
        // firewall service rebuilds the chains during boot and would flush
        // rules inserted too early.
        if probe.qga && lifecycle == "Ready" && !*self.ports_opened.lock().unwrap() {
            self.open_guest_ports().await;
            self.sync_live_forwarding().await;
            *self.ports_opened.lock().unwrap() = true;
        }
        // Self-healing (only when the guest agent is reachable):
        // 1) apply the idempotent guest fixes once per VM start
        // 2) restore the guest network when the probe cannot see an IP
        //    (e.g. the DHCP conflict guard flushed the only address).
        if probe.qga {
            self.apply_guest_fixes().await;
            // Build-deadlock autofix: if the iora-* cargo services stall on
            // the shared build lock (no rustc compiling), the self-heal
            // script kills the oldest waiter so the chain continues. Run
            // every 60s while the environment is still coming up.
            let build_check_due = self
                .last_build_check
                .lock()
                .unwrap()
                .map_or(true, |last| last.elapsed() >= Duration::from_secs(60));
            if build_check_due {
                *self.last_build_check.lock().unwrap() = Some(Instant::now());
                let (qga_port, socket) = {
                    let manager = self.manager.lock().await;
                    (manager.state.qga_port, manager.root.join(".cache/qga.sock"))
                };
                let _ = channels::guest_exec(
                    qga_port,
                    &socket,
                    "[ -f /tmp/iora-dev-selfheal.sh ] && bash /tmp/iora-dev-selfheal.sh --build || true",
                )
                .await;
            }
            if lifecycle == "Waiting for network" {
                self.network_remediation().await;
            }
        }
        if lifecycle != *last_lifecycle {
            self.emit(
                "lifecycle",
                format!("Lifecycle: {last_lifecycle} -> {lifecycle}"),
            );
            *last_lifecycle = lifecycle.clone();
        }

        enum RestartAction {
            None,
            GiveUp,
            Restart(NetworkMode),
            Reinstall,
        }
        // Computed before taking the desired lock: installation_marker() is
        // async and must not be awaited while holding a std MutexGuard.
        let marker = if lifecycle == "Degraded" && probe.qga && !probe.internal_home {
            self.installation_marker().await
        } else {
            None
        };
        let reinstalling = {
            let manager = self.manager.lock().await;
            manager.state.lifecycle == "Reinstalling"
        };
        let bootstrap_alive = manager::bootstrap_alive(&root);
        // adopt_reinstalled_vm is async - resolve it before taking the
        // std MutexGuard so the watchdog future stays Send.
        let reinstall_handoff = if reinstalling && !bootstrap_alive {
            Some(self.adopt_reinstalled_vm().await)
        } else {
            None
        };
        let restart = {
            let mut desired = self.desired.lock().unwrap();
            if !desired.running {
                RestartAction::None
            } else if reinstalling {
                if bootstrap_alive {
                    // dev-local -Rebuild is still running - wait for it.
                    desired.message = "Reinstalling VM (dev-local -Rebuild running)...".into();
                    RestartAction::None
                } else if reinstall_handoff == Some(true) {
                    // dev-local finished and started a fresh QEMU - take it
                    // over so the watchdog resumes normal monitoring.
                    desired.message = "Reinstall finished; resuming watch".into();
                    RestartAction::None
                } else {
                    desired.running = false;
                    desired.message =
                        "Reinstall finished but no QEMU process was found".into();
                    RestartAction::GiveUp
                }
            } else if lifecycle == "Ready" {
                if desired.retries > 0 {
                    self.emit("status", "Environment ready after restart");
                }
                desired.ever_ready = true;
                desired.retries = 0;
                desired.message = "Ready".into();
                RestartAction::None
            } else if lifecycle == "Degraded" && probe.qga && !probe.internal_home && !desired.ever_ready {
                // A freshly installed VM (dev-local first provision, or a
                // source-mode first boot where iora-home still compiles)
                // must never be torn down by the watchdog: only reinstall
                // when the guest finished installing AND stayed unhealthy
                // for a long time. The provisioned marker is checked in the
                // guest and cached (re-checked every 60s).
                if marker != Some(true) {
                    desired.message =
                        "Waiting for the guest installation to complete...".into();
                    RestartAction::None
                } else {
                    desired.retries += 1;
                    if desired.retries >= 240 {
                        desired.message =
                            "Installation did not become healthy; reinstalling VM".into();
                        RestartAction::Reinstall
                    } else {
                        RestartAction::None
                    }
                }
            } else if lifecycle != "Stopped" {
                RestartAction::None
            } else if !desired.ever_ready && bootstrap_alive {
                // A dev-local bootstrap is still provisioning (first install
                // or rebuild): no QEMU process exists yet, so keep waiting
                // instead of treating the missing process as a failed start.
                desired.message = "Waiting for the VM bootstrap (provisioning)...".into();
                RestartAction::None
            } else if !desired.ever_ready {
                // The VM never became ready after a user start; retrying
                // would only repeat the same configuration failure. Attach
                // the last QEMU output so the reason is visible in the
                // dashboard instead of a bare "never became ready".
                desired.running = false;
                desired.message =
                    "VM failed to start and never became ready; no auto-restart".into();
                RestartAction::GiveUp
            } else {
                desired.retries += 1;
                if desired.retries > MAX_RESTART_ATTEMPTS {
                    desired.running = false;
                    desired.message = "VM stayed down after 3 auto-restart attempts".into();
                    RestartAction::GiveUp
                } else {
                    let attempt = desired.retries;
                    desired.message = format!(
                        "VM stopped unexpectedly; restarting ({attempt}/{MAX_RESTART_ATTEMPTS})"
                    );
                    RestartAction::Restart(desired.mode.clone())
                }
            }
        };
        match restart {
            RestartAction::None => {}
            RestartAction::GiveUp => {
                let message = self.desired.lock().unwrap().message.clone();
                let tail = manager::read_tail(&root.join(".cache/dev-manager.log"), 12);
                let full = if tail.is_empty() || tail == "No log available" {
                    message
                } else {
                    format!("{message}\nLast QEMU output:\n{tail}")
                };
                self.record_error(&full).await;
                self.emit("error", full);
            }
            RestartAction::Reinstall => {
                self.emit("status", "Installation health check failed; reinstalling VM");
                if let Err(error) = self.reinstall().await {
                    let message = format!("auto-reinstall failed: {error:#}");
                    self.desired.lock().unwrap().message = message.clone();
                    self.record_error(&message).await;
                    self.emit("error", message);
                }
            }
            RestartAction::Restart(mode) => {
                self.emit("status", "VM stopped unexpectedly; restarting");
                let result = {
                    let mappings = self.mappings.lock().unwrap().clone();
                    self.manager.lock().await.start(mode, &mappings)
                };
                if let Err(error) = result {
                    let message = format!("auto-restart failed: {error:#}");
                    self.desired.lock().unwrap().message = message.clone();
                    self.record_error(&message).await;
                    self.emit("error", message);
                }
            }
        }
        self.refresh_status_cache();
    }

    /// The IORA guest firewall (iptables INPUT policy DROP) only allows a
    /// fixed set of ports from the Slirp subnet. Open every configured
    /// forward port in the guest so host access actually reaches the service.
    async fn open_guest_ports(&self) {
        let manager = self.manager.lock().await;
        for guest in self.guest_ports() {
            let _ = manager
                .guest(&format!(
                    "iptables -C INPUT -p tcp --dport {guest} -s 10.0.2.0/24 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport {guest} -s 10.0.2.0/24 -j ACCEPT"
                ))
                .await;
        }
    }

    /// All guest ports that should be reachable: env forward ports plus
    /// the persistent custom mappings.
    fn guest_ports(&self) -> Vec<u16> {
        let mut ports: Vec<u16> = manager::extra_ports();
        ports.extend(self.mappings.lock().unwrap().iter().map(|mapping| mapping.guest));
        ports.sort_unstable();
        ports.dedup();
        ports
    }

    /// Add Slirp forwarding rules at runtime via QMP for every mapping that
    /// is not yet covered by the QEMU start arguments. This makes new
    /// mappings effective immediately without a VM restart.
    async fn sync_live_forwarding(&self) {
        let (forwarded, skipped, qmp_port, root) = {
            let manager = self.manager.lock().await;
            if !manager.state.process_alive() {
                return;
            }
            let forwarded = manager
                .state
                .forwarded_ports
                .iter()
                .filter_map(|value| value["host"].as_u64().map(|host| host as u16))
                .collect::<HashSet<_>>();
            // Ports skipped at QEMU start (busy / duplicate) can never be
            // added at runtime either - don't retry them via hostfwd_add.
            let skipped = manager
                .state
                .skipped_ports
                .iter()
                .filter_map(|value| value.as_u64().map(|host| host as u16))
                .collect::<HashSet<_>>();
            (forwarded, skipped, manager.state.qmp_port, manager.root.clone())
        };
        let mappings = self.mappings.lock().unwrap().clone();
        let mut live = self.live_added.lock().unwrap().clone();
        // Remove rules whose mapping no longer exists.
        for host in live.iter().copied().collect::<Vec<_>>() {
            if !mappings.iter().any(|mapping| mapping.host == host) {
                let _ = channels::qmp_command(
                    qmp_port,
                    &root.join(".cache/qmp.sock"),
                    "human-monitor-command",
                    json!({"command-line": format!("hostfwd_remove tcp:127.0.0.1:{host}")}),
                )
                .await;
                live.remove(&host);
            }
        }
        // Add rules for mappings not covered by the start arguments.
        for mapping in mappings {
            if forwarded.contains(&mapping.host)
                || live.contains(&mapping.host)
                || skipped.contains(&mapping.host)
            {
                continue;
            }
            let ok = channels::qmp_command(
                qmp_port,
                &root.join(".cache/qmp.sock"),
                "human-monitor-command",
                json!({
                    "command-line": format!(
                        "hostfwd_add tcp:127.0.0.1:{}-:{}",
                        mapping.host, mapping.guest
                    )
                }),
            )
            .await
            .is_ok_and(|response| response.get("error").is_none());
            if ok {
                live.insert(mapping.host);
                self.emit(
                    "status",
                    format!(
                        "Port mapping 127.0.0.1:{} -> guest:{} active via QMP",
                        mapping.host, mapping.guest
                    ),
                );
            }
        }
        *self.live_added.lock().unwrap() = live;
    }

    /// Scan the guest for listening TCP ports and map them to known labels.
    async fn scan_guest_ports(&self) -> Vec<Value> {
        let manager = self.manager.lock().await;
        let output = manager.guest("ss -tln").await.unwrap_or_default();
        let mut ports = Vec::new();
        let mut seen = HashSet::new();
        for line in output.lines() {
            let mut columns = line.split_whitespace();
            if columns.next() != Some("LISTEN") {
                continue;
            }
            let local = columns.nth(2).unwrap_or_default();
            let Some(port) = local.rsplit(':').next().and_then(|port| port.parse::<u16>().ok()) else {
                continue;
            };
            if !seen.insert(port) {
                continue;
            }
            ports.push(json!({
                "port": port,
                "label": port_label(port),
                "mapped": false,
            }));
        }
        ports.sort_by(|a, b| a["port"].as_u64().cmp(&b["port"].as_u64()));
        ports
    }

    /// Status view for every custom mapping.
    pub async fn mappings_status(&self) -> Value {
        let (forwarded, guest_ports) = {
            let manager = self.manager.lock().await;
            let forwarded = manager
                .state
                .forwarded_ports
                .iter()
                .filter_map(|value| value["host"].as_u64().map(|host| host as u16))
                .collect::<HashSet<_>>();
            drop(manager);
            (forwarded, self.scan_guest_ports().await)
        };
        let listening = guest_ports
            .iter()
            .filter_map(|value| value["port"].as_u64().map(|port| port as u16))
            .collect::<HashSet<_>>();
        let mappings = self.mappings.lock().unwrap().clone();
        let tunnel_alive = self.live_added.lock().unwrap().clone();
        // The honest source of truth for a mapping is the host port itself:
        // hostfwd_add rules live in QEMU and survive daemon restarts, so the
        // in-memory `live_added` set alone would wrongly report "pending".
        // Probe the host port; "down" means the forward exists but the guest
        // service is not answering.
        let mut reachable: HashSet<u16> = HashSet::new();
        for mapping in &mappings {
            if host_port_reachable(mapping.host).await {
                reachable.insert(mapping.host);
            }
        }
        let entries = mappings
            .iter()
            .map(|mapping| {
                let active = reachable.contains(&mapping.host);
                let forwarded_ok = forwarded.contains(&mapping.host)
                    || tunnel_alive.contains(&mapping.host);
                let status = if active {
                    "active"
                } else if forwarded_ok {
                    "down"
                } else {
                    "pending"
                };
                let listening_guest = listening.contains(&mapping.guest);
                json!({
                    "host": mapping.host,
                    "guest": mapping.guest,
                    "label": mapping.label,
                    "status": status,
                    "guestListening": listening_guest,
                    "active": active,
                })
            })
            .collect::<Vec<_>>();
        let scanned = guest_ports
            .into_iter()
            .map(|mut value| {
                let port = value["port"].as_u64().unwrap_or(0) as u16;
                value["mapped"] = json!(mappings.iter().any(|mapping| mapping.guest == port));
                value
            })
            .collect::<Vec<_>>();
        json!({
            "mappings": entries,
            "guestPorts": scanned,
            "activeHostPorts": forwarded.iter().copied().collect::<Vec<_>>(),
        })
    }

    /// Add a custom mapping (persisted) and apply it live.
    pub async fn add_mapping(&self, host: u16, guest: u16, label: Option<String>) -> Result<()> {
        if host == 0 || guest == 0 {
            anyhow::bail!("ports must be between 1 and 65535");
        }
        if matches!(host, 2222 | 8126) {
            anyhow::bail!("host port {host} is reserved for SSH / iora-home");
        }
        {
            let mut mappings = self.mappings.lock().unwrap();
            if mappings.iter().any(|mapping| mapping.host == host) {
                anyhow::bail!("host port {host} is already mapped");
            }
            mappings.push(PortMapping {
                host,
                guest,
                label: label.filter(|label| !label.trim().is_empty()),
            });
            self.save_mappings(&mappings);
        }
        self.apply_mapping_change().await;
        self.emit("status", format!("Mapping 127.0.0.1:{host} -> guest:{guest} added"));
        Ok(())
    }

    pub async fn remove_mapping(&self, host: u16) -> Result<()> {
        {
            let mut mappings = self.mappings.lock().unwrap();
            let before = mappings.len();
            mappings.retain(|mapping| mapping.host != host);
            if mappings.len() == before {
                anyhow::bail!("no mapping for host port {host}");
            }
            self.save_mappings(&mappings);
        }
        self.apply_mapping_change().await;
        self.emit("status", format!("Mapping for host port {host} removed"));
        Ok(())
    }

    fn save_mappings(&self, mappings: &[PortMapping]) {
        if let Some(parent) = self.mappings_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(
            &self.mappings_path,
            serde_json::to_string_pretty(mappings).unwrap_or_default(),
        );
    }

    /// After a mapping change: refresh firewall rules and SSH tunnels if the
    /// VM is running.
    /// Default port mappings every dev environment needs. Added automatically
    /// when missing; host ports already in use are replaced by the next free
    /// port (with a clear warning) and the effective backend URL is then
    /// propagated into the frontend config so all URLs stay correct.
    const DEFAULT_MAPPINGS: &[(u16, u16, &str)] = &[
        (3001, 3001, "iora-home (nginx)"),
        (5432, 5432, "postgres"),
        (8101, 8101, "dev bridge"),
    ];

    async fn ensure_default_mappings(&self) {
        let mut changed = false;
        let mut warnings: Vec<String> = Vec::new();
        let mut backend_port: Option<u16> = None;
        {
            let mut mappings = self.mappings.lock().unwrap();
            for (host, guest, label) in Self::DEFAULT_MAPPINGS {
                if mappings.iter().any(|mapping| mapping.host == *host) {
                    continue;
                }
                let mut chosen = *host;
                while manager::host_port_in_use(chosen) && chosen < *host + 20 {
                    chosen += 1;
                }
                if chosen != *host {
                    warnings.push(format!(
                        "host port {host} is already in use - using {chosen} instead; the frontend URL is updated automatically"
                    ));
                }
                if *guest == 3001 {
                    backend_port = Some(chosen);
                }
                mappings.push(PortMapping {
                    host: chosen,
                    guest: *guest,
                    label: Some((*label).into()),
                });
                changed = true;
            }
        }
        if !changed {
            return;
        }
        self.save_mappings(&self.mappings.lock().unwrap());
        self.emit(
            "status",
            "Default port mappings ensured (3001 nginx, 5432 postgres, 8101 bridge)",
        );
        for warning in &warnings {
            self.record_error(warning).await;
            self.emit("error", warning.clone());
        }
        if let Some(port) = backend_port {
            if port != 3001 {
                self.propagate_backend_url(port).await;
            }
        }
        self.apply_mapping_change().await;
    }

    /// When the default backend port (3001) was occupied, point the frontend
    /// at the alternative port: update frontend/.env.development (host copy
    /// for the 1:1 sync, guest copy directly) and restart Vite in the guest.
    async fn propagate_backend_url(&self, port: u16) {
        let (repository, qga_port, socket) = {
            let manager = self.manager.lock().await;
            (
                manager.root.parent().unwrap_or(&manager.root).to_path_buf(),
                manager.state.qga_port,
                manager.root.join(".cache/qga.sock"),
            )
        };
        let env_path = repository.join("frontend").join(".env.development");
        let Ok(content) = std::fs::read_to_string(&env_path) else {
            self.emit("error", "frontend/.env.development not found - cannot update backend URL");
            return;
        };
        let updated = content
            .lines()
            .map(|line| {
                if line.starts_with("VITE_BACKEND_URL=") || line.starts_with("VITE_IORA_ASSIST_URL=") {
                    let key = line.split('=').next().unwrap_or("");
                    format!("{key}=http://localhost:{port}")
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("
");
        if updated == content {
            self.emit("error", "frontend URL update skipped (no VITE_* lines found)");
            return;
        }
        let _ = std::fs::write(&env_path, &updated);
        self.emit("status", format!("frontend/.env.development -> http://localhost:{port} (host copy)"));
        // Guest copy + Vite restart so the running dev server picks it up.
        let encoded = channels::base64_encode(updated.as_bytes());
        let command = format!(
            "echo {} | base64 -d > /home/iora/iora/frontend/.env.development && chown iora:iora /home/iora/iora/frontend/.env.development && systemctl restart iora-frontend-dev.service",
            encoded
        );
        match channels::guest_exec(qga_port, &socket, &command).await {
            Ok(_) => self.emit("status", "Vite restarted with the updated backend URL"),
            Err(error) => self.emit("error", format!("frontend URL update in guest failed: {error:#}")),
        }
    }

    /// SSH arguments for guest commands (the reliable channel; QGA sockets
    /// are only present on daemon-started VMs).
    fn ssh_args(&self, manager: &Manager) -> Vec<String> {
        let key = manager.root.join(".cache/iora-dev-key");
        vec![
            "-o".into(),
            "StrictHostKeyChecking=no".into(),
            "-o".into(),
            "UserKnownHostsFile=NUL".into(),
            "-o".into(),
            "BatchMode=yes".into(),
            "-o".into(),
            "ConnectTimeout=5".into(),
            "-p".into(),
            manager.state.ssh_port.to_string(),
            "-i".into(),
            key.display().to_string(),
        ]
    }

    /// Run a command on the guest over SSH (fallback to QGA when the VM was
    /// started by this daemon with a guest-agent chardev).
    async fn guest_ssh(&self, command: &str) -> Result<String> {
        let manager = self.manager.lock().await;
        if manager.state.process_alive() {
            let host = manager.state.vm_host.clone();
            let args = self.ssh_args(&manager);
            drop(manager);
            let output = std::process::Command::new("ssh")
                .args(&args)
                .arg(format!("root@{host}"))
                .arg(command)
                .output()?;
            if !output.status.success() {
                anyhow::bail!(
                    "ssh failed ({}): {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }
        // VM not running — reuse the QGA path so the error message is clear.
        let manager = self.manager.lock().await;
        manager
            .guest(command)
            .await
            .map_err(|error| anyhow::anyhow!("guest unavailable: {error}"))
    }

    /// Ensure every mapping has a live SSH tunnel from the host to the guest
    /// (works without QMP hostfwd — the standard dev VM has none).
    async fn sync_tunnels(&self) {
        // No tunnels while the VM is down (SSH to a dead guest fails fast
        // but pointless to re-spawn on every cycle).
        if !self.manager.lock().await.state.process_alive() {
            return;
        }
        // Collect everything before locking the tunnel registry so no
        // non-Send guard is held across an await (breaks the axum handlers).
        let (mappings, host, key, ssh_port) = {
            let manager = self.manager.lock().await;
            (
                self.mappings.lock().unwrap().clone(),
                manager.state.vm_host.clone(),
                manager.root.join(".cache/iora-dev-key"),
                manager.state.ssh_port,
            )
        };
        let mut tunnels = self.tunnels.lock().unwrap();
        for mapping in &mappings {
            // Skip when the host port is already served (tunnel running).
            if std::net::TcpListener::bind(("127.0.0.1", mapping.host)).is_err() {
                continue;
            }
            let args = [
                "-N",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "UserKnownHostsFile=NUL",
                "-o",
                "BatchMode=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-L",
                &format!("{}:127.0.0.1:{}", mapping.host, mapping.guest),
                "-p",
                &ssh_port.to_string(),
                "-i",
                &key.display().to_string(),
                &format!("root@{host}"),
            ];
            let child = match std::process::Command::new("ssh")
                .args(&args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                Ok(child) => child,
                Err(_) => continue,
            };
            // The child handle is dropped on purpose: the ssh process keeps
            // running detached; we remember its PID for later cleanup.
            tunnels.insert(mapping.host, child.id());
        }
    }

    /// Auto-map the exposed ports of running Docker apps (the "automatic
    /// port mapping"): every app port becomes reachable on the host.
    async fn auto_map_app_ports(&self) {
        // Nothing to map while the VM is down; the SSH probes below are
        // synchronous and would block a worker for nothing.
        if !self.manager.lock().await.state.process_alive() {
            return;
        }
        // Docker socket permissions drift after daemon restarts — heal them
        // so the guest-side port lookups keep working.
        let _ = self
            .guest_ssh("chgrp docker /var/run/docker.sock 2>/dev/null; chmod 660 /var/run/docker.sock 2>/dev/null; true")
            .await;
        let Ok(login) = self
            .guest_ssh(
                "curl -s -m 6 -X POST http://localhost:8126/api/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"admin1234\"}'",
            )
            .await
        else {
            return;
        };
        let Ok(token) = serde_json::from_str::<serde_json::Value>(&login)
            .map(|value| value["token"].as_str().unwrap_or_default().to_string())
        else {
            return;
        };
        if token.is_empty() {
            return;
        }
        let Ok(apps_json) = self
            .guest_ssh(&format!(
                "curl -s -m 8 -H 'Authorization: Bearer {token}' http://localhost:8126/api/supervisor/apps"
            ))
            .await
        else {
            return;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&apps_json) else {
            return;
        };
        let Some(apps) = value["apps"].as_array() else { return };
        for app in apps {
            let Some(app_id) = app["id"].as_str() else { continue };
            let Some(ports) = app["ports"].as_array() else { continue };
            for port in ports {
                let external = port
                    .as_str()
                    .and_then(|text| text.split(':').next())
                    .and_then(|text| text.parse::<u16>().ok())
                    .or_else(|| port["external"].as_u64().map(|value| value as u16));
                let Some(external) = external else { continue };
                if matches!(external, 2222 | 8126 | 3001 | 5173) {
                    continue; // reserved host ports
                }
                let exists = self
                    .mappings
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|mapping| mapping.guest == external || mapping.host == external);
                if !exists {
                    let _ = self
                        .add_mapping(external, external, Some(format!("app:{app_id}")))
                        .await;
                }
            }
        }
    }

    async fn apply_mapping_change(&self) {
        let manager = self.manager.lock().await;
        let alive = manager.state.process_alive();
        drop(manager);
        if !alive {
            return;
        }
        self.open_guest_ports().await;
        self.sync_live_forwarding().await;
        // SSH tunnels are the reliable channel on dev-local VMs (no QMP).
        self.sync_tunnels().await;
    }

    fn append_named_log(&self, label: &str, path: &Path) {
        self.append_log_with_prefix(label, path);
    }

    /// Whether the guest installation finished (`/etc/iora/dev-vm-provisioned`
    /// exists). Cached; re-checked every 60s while unknown, so a
    /// provisioning that is still running (dev-local) is never mistaken for
    /// a broken installation. Returns `None` while unknown.
    async fn installation_marker(&self) -> Option<bool> {
        {
            let state = self.install_marker.lock().unwrap();
            if let Some(value) = state.value {
                return Some(value);
            }
            if let Some(checked) = state.checked_at {
                if checked.elapsed() < Duration::from_secs(60) {
                    return None;
                }
            }
        }
        let (qga_port, socket) = {
            let manager = self.manager.lock().await;
            (manager.state.qga_port, manager.root.join(".cache/qga.sock"))
        };
        let result = channels::guest_exec(
            qga_port,
            &socket,
            "test -f /etc/iora/dev-vm-provisioned && echo YES || echo NO",
        )
        .await;
        let mut state = self.install_marker.lock().unwrap();
        state.checked_at = Some(Instant::now());
        match result {
            Ok(output) if output.contains("YES") => {
                state.value = Some(true);
            }
            Ok(_) => {
                state.value = Some(false);
            }
            Err(_) => {
                // Guest agent hiccup - stay unknown, re-check later.
            }
        }
        state.value
    }

    /// After a reinstall finished (dev-local bootstrap exited), adopt the
    /// fresh QEMU process it started so the watchdog resumes monitoring.
    async fn adopt_reinstalled_vm(&self) -> bool {
        let mut manager = self.manager.lock().await;
        if manager.state.process_alive() {
            return true; // already tracked
        }
        let info = manager::discover_qemu_processes()
            .into_iter()
            .find(|process| process.is_iora_dev);
        match info {
            Some(info) => manager.adopt(&info).is_ok(),
            None => false,
        }
    }

    /// What the environment is currently doing: the latest provisioning
    /// phase from the dev-local transcript, plus live progress for the
    /// cargo registry seeding (the long silent step).
    async fn compute_activity(&self) -> Value {
        let root = self.manager.lock().await.root.clone();
        let tail = manager::read_tail(&root.join(".cache/dev-local.log"), 80);
        let phase = tail
            .lines()
            .filter(|line| line.contains("[*") || line.contains("[+") || line.contains("[!"))
            .next_back()
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        if phase.is_empty() {
            return json!({ "phase": Value::Null });
        }
        let mut activity = json!({ "phase": phase });
        if phase.contains("Seeding cargo registry") {
            if let Some(seed) = self.seed_progress().await {
                activity["seed"] = seed;
            }
        }
        activity
    }

    /// Live progress of the cargo registry seed: guest size via QGA (every
    /// 20s) vs. host registry size (measured once), with transfer rate and
    /// remaining-time estimate.
    async fn seed_progress(&self) -> Option<Value> {
        // Short locks only - the MutexGuard must not live across the awaits
        // below (the refresh future has to stay Send).
        let (total_mb, due) = {
            let mut seed = self.seed_progress.lock().unwrap();
            if seed.total_mb.is_none() {
                seed.total_mb = host_registry_mb();
            }
            let now = Instant::now();
            let due = seed
                .last_at
                .map_or(true, |last| now.duration_since(last) >= Duration::from_secs(20));
            (seed.total_mb, due)
        };
        let total_mb = total_mb?;
        if due {
            let (qga_port, socket) = {
                let manager = self.manager.lock().await;
                (manager.state.qga_port, manager.root.join(".cache/qga.sock"))
            };
            if let Ok(output) = channels::guest_exec(
                qga_port,
                &socket,
                "du -sm /home/iora/.cargo/registry 2>/dev/null | cut -f1",
            )
            .await
            {
                if let Ok(mb) = output.trim().parse::<u64>() {
                    let mut seed = self.seed_progress.lock().unwrap();
                    if let (Some(last_mb), Some(last_at)) = (seed.last_mb, seed.last_at) {
                        let elapsed = Instant::now().duration_since(last_at).as_secs_f64();
                        if elapsed > 0.0 && mb > last_mb {
                            seed.rate_mb_per_s = (mb - last_mb) as f64 / elapsed;
                        }
                    }
                    seed.last_mb = Some(mb);
                    seed.last_at = Some(Instant::now());
                }
            }
        }
        let (current_mb, rate) = {
            let seed = self.seed_progress.lock().unwrap();
            (seed.last_mb, seed.rate_mb_per_s)
        };
        let current_mb = current_mb?;
        // The guest registry can exceed the host one while cargo downloads
        // extra crates during the prebuild - that means the seed itself is
        // done, so report 100% instead of a capped 99% with no ETA.
        let done = current_mb >= total_mb;
        let percent = if done {
            100.0
        } else if total_mb > 0 {
            ((current_mb as f64 / total_mb as f64) * 100.0).min(99.0).round()
        } else {
            0.0
        };
        let eta_secs = if done {
            Some(0)
        } else if rate > 0.05 {
            Some(((total_mb.saturating_sub(current_mb)) as f64 / rate) as u64)
        } else {
            None
        };
        Some(json!({
            "currentMb": current_mb,
            "totalMb": total_mb,
            "percent": percent,
            "rateMbPerS": (rate * 10.0).round() / 10.0,
            "etaSecs": eta_secs,
        }))
    }

    /// Upload and run the idempotent guest self-heal script (DHCP guard
    /// patch, SSH hardening, net watchdog install) once per VM start.
    /// Repeated calls are no-ops; the script itself is idempotent too.
    async fn apply_guest_fixes(&self) {
        {
            let manager = self.manager.lock().await;
            if manager.state.guest_fixes_applied {
                return;
            }
        }
        let (root, qga_port, socket) = {
            let manager = self.manager.lock().await;
            (
                manager.root.clone(),
                manager.state.qga_port,
                manager.root.join(".cache/qga.sock"),
            )
        };
        let script = root.join("iora-dev-selfheal.sh");
        let Ok(content) = std::fs::read_to_string(&script) else {
            self.emit(
                "error",
                "self-heal script missing: iora-os/iora-dev-selfheal.sh",
            );
            return;
        };
        let command = format!(
            "echo {} | base64 -d > /tmp/iora-dev-selfheal.sh && chmod 755 /tmp/iora-dev-selfheal.sh && bash /tmp/iora-dev-selfheal.sh --apply",
            channels::base64_encode(content.as_bytes())
        );
        match channels::guest_exec(qga_port, &socket, &command).await {
            Ok(_) => {
                self.emit("status", "Guest self-heal fixes applied");
                let mut manager = self.manager.lock().await;
                manager.state.guest_fixes_applied = true;
                let _ = manager.state.save(&manager.state_path);
            }
            Err(error) => self.emit("error", format!("self-heal failed: {error:#}")),
        }
    }

    /// Restore the guest network when the VM has no reachable IP - bounded
    /// to 3 attempts with a 30s cooldown so a broken guest is not hammered.
    async fn network_remediation(&self) {
        // Decision under a short lock - the guard must not be held across
        // the await below (the watchdog future has to stay Send).
        let due = {
            let repair = self.net_repair.lock().unwrap();
            if repair.attempts >= 3 {
                false
            } else if let Some(last) = repair.last_attempt {
                last.elapsed() >= Duration::from_secs(30)
            } else {
                true
            }
        };
        if !due {
            return;
        }
        self.net_repair.lock().unwrap().last_attempt = Some(Instant::now());
        // Escalation decision: after the second failed round (attempts == 2
        // once this round is counted) rebuild the slirp user-net backend.
        let will_escalate = self.net_repair.lock().unwrap().attempts == 1;
        let (qga_port, socket) = {
            let manager = self.manager.lock().await;
            (manager.state.qga_port, manager.root.join(".cache/qga.sock"))
        };
        let command = "if [ -f /tmp/iora-dev-selfheal.sh ]; then bash /tmp/iora-dev-selfheal.sh --net; else for n in $(ls /sys/class/net | grep -vE '^(lo|docker|br-|veth|vnet|virbr|tun|tap|bond|sit)'); do [ -d /sys/class/net/$n/device ] || continue; grep -q 'state UP' /sys/class/net/$n/operstate 2>/dev/null || continue; ip -4 addr show dev $n 2>/dev/null | grep -q ' inet ' || dhclient -1 $n >/dev/null 2>&1 || true; done; fi; ip -4 route get 1.1.1.1 >/dev/null 2>&1 && echo NET_OK || echo NET_STILL_DOWN";
        let result = channels::guest_exec(qga_port, &socket, command).await;
        {
            // Bounded scope: the MutexGuard must not live across the await
            // in the escalation below (the watchdog future stays Send).
            let mut repair = self.net_repair.lock().unwrap();
            match result {
                Ok(output) => {
                    if output.contains("NET_OK") {
                        repair.attempts = 0;
                        self.emit("status", "Network self-healed in the guest");
                    } else {
                        repair.attempts += 1;
                        self.emit("status", "Network still down after remediation");
                    }
                }
                Err(error) => {
                    repair.attempts += 1;
                    self.emit("error", format!("network remediation failed: {error:#}"));
                }
            }
        }
        // Escalation: the guest may be fine while the QEMU slirp stack is
        // stuck (SYN_SENT leaks) - rebuild the user-net backend after two
        // failed remediation rounds. Bounded by `attempts`.
        if will_escalate {
            match self.reset_network().await {
                Ok(message) => {
                    self.emit("status", format!("{message} (escalated network remediation)"));
                    self.net_repair.lock().unwrap().attempts = 0;
                }
                Err(error) => self.emit("error", format!("slirp rebuild failed: {error:#}")),
            }
        }
    }
}

/// Is the host side of a forwarded port answering right now? The honest
/// source of truth for mapping status - it survives daemon restarts (the
/// hostfwd_add rules live inside QEMU) and reveals when the guest service
/// is down.
async fn host_port_reachable(port: u16) -> bool {
    timeout(
        Duration::from_millis(500),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .is_ok_and(|result| result.is_ok())
}

/// Size of the host cargo registry in MB (the source of the seed).
/// Measured once per daemon run - it is a few gigabytes of small files,
/// so scanning it repeatedly would be wasteful.
fn host_registry_mb() -> Option<u64> {
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").ok()?
    } else {
        std::env::var("HOME").ok()?
    };
    let registry = Path::new(&home).join(".cargo").join("registry");
    if !registry.exists() {
        return Some(0); // no host registry - nothing to seed
    }
    #[cfg(windows)]
    {
        let script = format!(
            "$s = (Get-ChildItem -Path '{}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; [math]::Round($s / 1MB)",
            registry.display()
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout).trim().parse::<u64>().ok()
    }
    #[cfg(not(windows))]
    {
        let output = std::process::Command::new("du")
            .args(["-sm", registry.to_str()?])
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .next()?
            .parse::<u64>()
            .ok()
    }
}

impl Daemon {
    fn append_serial_log(&self, path: &Path) {
        self.append_log_with_prefix("serial", path);
    }

    /// Read only the bytes appended to `path` since the last call (tracked
    /// per file). Never reads the whole log, so a fast-growing transcript
    /// (download progress, provisioning) cannot slow the daemon down.
    fn read_tail_incremental(&self, path: &Path) -> String {
        use std::io::{Read, Seek, SeekFrom};
        let Ok(mut file) = std::fs::File::open(path) else {
            return String::new();
        };
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut offsets = self.log_offsets.lock().unwrap();
        let offset = offsets.entry(path.to_path_buf()).or_insert(0);
        if size < *offset {
            *offset = 0; // the log was truncated; start over
        }
        if size == *offset {
            return String::new();
        }
        let _ = file.seek(SeekFrom::Start(*offset));
        let mut buf = Vec::with_capacity((size - *offset) as usize);
        let _ = file.read_to_end(&mut buf);
        *offset = size;
        String::from_utf8_lossy(&buf).into_owned()
    }

    /// Parse the cloud-image download progress from the dev-local transcript.
    /// The provisioning script emits `[DLP] <received> <total>` lines. Returns
    /// None when no download is active.
    fn parse_download_progress(&self, tail: &str) -> Option<(u64, u64)> {
        parse_download_progress(tail)
    }

    /// Live download progress (percent, rate, ETA) for the "Preparing" phase.
    fn download_progress_json(&self, root: &Path) -> Value {
        // Bounded tail read (64KB window from the end): the incremental
        // offset tracker is shared with the watchdog's log-event feed, which
        // consumes the new bytes first. The progress lines always sit at the
        // end of the transcript while a download is active.
        let tail = manager::read_tail(&root.join(".cache/dev-local.log"), 400);
        let Some((received, total)) = self.parse_download_progress(&tail) else {
            self.download_progress.lock().unwrap().last_bytes = None;
            return Value::Null;
        };
        let mut progress = self.download_progress.lock().unwrap();
        let now = Instant::now();
        if let (Some(last_bytes), Some(last_at)) = (progress.last_bytes, progress.last_at) {
            let elapsed = now.duration_since(last_at).as_secs_f64();
            if elapsed > 0.0 && received > last_bytes {
                progress.rate_bps = (received - last_bytes) as f64 / elapsed;
            }
        }
        progress.received = received;
        progress.total = total;
        progress.last_bytes = Some(received);
        progress.last_at = Some(now);
        progress.percent = if total > 0 {
            ((received as f64 / total as f64) * 100.0).min(99.0) as u8
        } else {
            0
        };
        let rate_bps = progress.rate_bps;
        let percent = progress.percent;
        let remaining_secs = if rate_bps > 0.0 && received < total {
            ((total - received) as f64 / rate_bps).ceil() as u64
        } else {
            0
        };
        json!({
            "receivedMb": received / 1024 / 1024,
            "totalMb": total / 1024 / 1024,
            "percent": percent,
            "rateMbPerS": (rate_bps / 1024.0 / 1024.0 * 10.0).round() / 10.0,
            "etaSecs": remaining_secs,
        })
    }

    fn append_log_with_prefix(&self, label: &str, path: &Path) {
        let added = self.read_tail_incremental(path);
        if added.is_empty() {
            return;
        }
        for line in added.lines().filter(|line| !line.trim().is_empty()) {
            // Serial console lines end with \r on Windows; SSE
            // payloads must not contain carriage returns or newlines.
            self.emit("log", format!("[{label}] {}", line.trim_end_matches('\r')));
        }
    }
}

pub fn spawn(daemon: Arc<Daemon>) {
    let stats_daemon = daemon.clone();
    let port_daemon = daemon.clone();
    tokio::spawn(async move {
        let (repository, os_root, state_path) = {
            let manager = daemon.manager.lock().await;
            let repository = manager.root.parent().unwrap_or(&manager.root).to_path_buf();
            (repository, manager.root.clone(), manager.state_path.clone())
        };

        // Consume live development watcher events and mirror them into state and the UI.
        let mut dev_events = devloop::spawn(repository, os_root, state_path);
        let dev_daemon = daemon.clone();
        tokio::spawn(async move {
            while let Some(event) = dev_events.recv().await {
                let (kind, message, watcher, sync) = match event {
                    DevEvent::Watching => {
                        ("status", "Live development watcher active".to_string(), Some("Running"), None)
                    }
                    DevEvent::Syncing(count) => (
                        "status",
                        format!("Synchronizing {count} changed files"),
                        None,
                        Some("Syncing"),
                    ),
                    DevEvent::Building(service) => {
                        ("status", format!("Building {service}"), Some("Building"), None)
                    }
                    DevEvent::Ready(detail) => {
                        ("status", detail, Some("Running"), Some("Watching"))
                    }
                    DevEvent::Error(error) => ("error", error, Some("Running"), Some("Degraded")),
                };
                {
                    let mut manager = dev_daemon.manager.lock().await;
                    if let Some(watcher) = watcher {
                        manager.state.watcher_status = watcher.into();
                    }
                    if let Some(sync) = sync {
                        manager.state.sync_status = sync.into();
                    }
                    let _ = manager.state.save(&manager.state_path);
                }
                dev_daemon.emit(kind, message);
            }
        });

        // Background refresh of the QEMU-process scan (the synchronous
        // PowerShell CIM query must never run in the web request path).
        {
            let vms_daemon = daemon.clone();
            tokio::spawn(async move {
                let mut tick = interval(Duration::from_secs(10));
                loop {
                    tick.tick().await;
                    vms_daemon.refresh_vms_cache().await;
                }
            });
        }

        // Initial probe so the first status response is already accurate.
        let mut last_lifecycle = {
            let mut manager = daemon.manager.lock().await;
            let probe = manager.probe().await;
            *daemon.last_probe.lock().unwrap() = probe.clone();
            probe.lifecycle().to_string()
        };
        daemon.emit("status", format!("Environment: {last_lifecycle}"));
        daemon.refresh_status_cache();

        // Make sure the standard ports are mapped (3001 nginx, 5432 postgres,
        // 8101 bridge) - with conflict handling and frontend URL propagation.
        daemon.ensure_default_mappings().await;

        // Auto-start: the dev manager is the entry point - when the daemon
        // comes up and no VM is running, boot it (provisioning first if the
        // disk is missing). Disable with IORA_DEV_NO_AUTOSTART=1.
        let autostart_enabled = std::env::var("IORA_DEV_NO_AUTOSTART")
            .ok()
            .map(|value| {
                !matches!(
                    value.to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(true);
        if autostart_enabled && last_lifecycle == "Stopped" {
            let mut desired = daemon.desired.lock().unwrap();
            if !desired.running {
                desired.running = true;
                desired.retries = 0;
                desired.mode = crate::state::NetworkMode::Slirp;
                desired.message = "Auto-start on daemon boot".into();
                desired.ever_ready = false;
                daemon.emit("status", "Auto-starting the VM (daemon boot)");
            }
        }

        // Watchdog: health probe, lifecycle transitions, auto-restart on crash.
        let mut tick = interval(Duration::from_secs(WATCHDOG_SECS));
        loop {
            tick.tick().await;
            daemon.watchdog_tick(&mut last_lifecycle).await;
        }
    });

    // Guest metrics refresh.
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(10));
        loop {
            tick.tick().await;
            stats_daemon.refresh_stats().await;
        }
    });

    // Automatic app-port mapping + SSH tunnel upkeep.
    tokio::spawn(async move {
        // Restore tunnels for persisted mappings on startup.
        port_daemon.sync_tunnels().await;
        let mut tick = interval(Duration::from_secs(30));
        loop {
            tick.tick().await;
            port_daemon.auto_map_app_ports().await;
            port_daemon.sync_tunnels().await;
        }
    });
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Friendly names for well-known guest ports, used by the port scanner.
fn port_label(port: u16) -> Option<&'static str> {
    match port {
        22 => Some("SSH"),
        80 => Some("HTTP"),
        443 => Some("HTTPS"),
        3001 => Some("nginx frontend"),
        5173 => Some("Vite dev server"),
        5432 => Some("PostgreSQL"),
        8080 => Some("HTTP alt"),
        8126 => Some("iora-home API"),
        8090..=8098 => Some("IORA service"),
        _ => None,
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Parse `systemctl list-units --plain` output into structured entries.
/// The first four columns (UNIT LOAD ACTIVE SUB) never contain spaces,
/// so the description is everything after the fourth token.
fn parse_services(output: &str) -> Vec<Value> {
    output
        .lines()
        .filter_map(|line| {
            let mut tokens = line.split_whitespace();
            let unit = tokens.next()?;
            let load = tokens.next().unwrap_or_default();
            let active = tokens.next().unwrap_or_default();
            let sub = tokens.next().unwrap_or_default();
            let description = tokens.collect::<Vec<_>>().join(" ");
            if unit.is_empty() || load.is_empty() {
                return None;
            }
            Some(json!({
                "unit": unit,
                "load": load,
                "active": active,
                "sub": sub,
                "description": description,
                "failed": active == "failed",
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_systemctl_lines() {
        let output = "iora-api.service loaded active running IORA API\n\niora-home.service loaded failed failed IORA Home\n";
        let services = parse_services(output);
        assert_eq!(services.len(), 2);
        assert_eq!(services[0]["unit"], "iora-api.service");
        assert_eq!(services[0]["description"], "IORA API");
        assert!(services[1]["failed"].as_bool().unwrap());
    }
}

/// Parse the cloud-image download progress from the dev-local transcript.
/// The provisioning script emits `[DLP] <received> <total>` lines.
fn parse_download_progress(tail: &str) -> Option<(u64, u64)> {
    tail.lines().rev().find_map(|line| {
        let line = line.trim();
        let rest = line.strip_prefix("[DLP]")?;
        let mut parts = rest.split_whitespace();
        let received = parts.next()?.parse::<u64>().ok()?;
        let total = parts.next()?.parse::<u64>().ok()?;
        if total == 0 {
            None
        } else {
            Some((received, total))
        }
    })
}

#[cfg(test)]
mod download_progress_tests {
    use super::parse_download_progress;

    #[test]
    fn parses_latest_progress_line() {
        let tail = "[*] Downloading Debian cloud image (~400MB, one-time)...\n[DLP] 104857600 419430400\n[DLP] 209715200 419430400\n";
        assert_eq!(parse_download_progress(tail), Some((209_715_200, 419_430_400)));
    }

    #[test]
    fn ignores_lines_without_progress() {
        assert_eq!(parse_download_progress("[*] Downloading..."), None);
        assert_eq!(parse_download_progress(""), None);
    }

    #[test]
    fn rejects_zero_total() {
        assert_eq!(parse_download_progress("[DLP] 10 0"), None);
    }
}
