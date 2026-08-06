use crate::{
    channels,
    devloop::{self, DevEvent},
    manager::{self, Manager, Probe},
    state::{NetworkMode, PortMapping},
};
use anyhow::Result;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{broadcast, Mutex as AsyncMutex},
    time::interval,
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
    pub mappings_path: PathBuf,
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
        let (host, ssh, home) = state.connection();
        drop(manager);
        let probe = self.last_probe.lock().unwrap().clone();
        let desired = self.desired.lock().unwrap().clone();
        *self.status_cache.lock().unwrap() = json!({
            "state": state,
            "probe": probe,
            "lifecycle": probe.lifecycle(),
            "desired": desired,
            "connection": { "host": host, "ssh": ssh, "home": home },
            "message": self.last_message.lock().unwrap().clone(),
            "logLines": self.logs.lock().unwrap().len(),
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
        // Open forwarded ports only once the guest is fully up: the IORA
        // firewall service rebuilds the chains during boot and would flush
        // rules inserted too early.
        if probe.qga && lifecycle == "Ready" && !*self.ports_opened.lock().unwrap() {
            self.open_guest_ports().await;
            self.sync_live_forwarding().await;
            *self.ports_opened.lock().unwrap() = true;
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
        let restart = {
            let mut desired = self.desired.lock().unwrap();
            if !desired.running {
                RestartAction::None
            } else if lifecycle == "Ready" {
                if desired.retries > 0 {
                    self.emit("status", "Environment ready after restart");
                }
                desired.ever_ready = true;
                desired.retries = 0;
                desired.message = "Ready".into();
                RestartAction::None
            } else if lifecycle == "Degraded" && probe.qga && !probe.internal_home && !desired.ever_ready {
                desired.retries += 1;
                if desired.retries >= 20 {
                    desired.message = "Installation did not become healthy; reinstalling VM".into();
                    RestartAction::Reinstall
                } else {
                    RestartAction::None
                }
            } else if lifecycle != "Stopped" {
                RestartAction::None
            } else if !desired.ever_ready {
                // The VM never became ready after a user start; retrying
                // would only repeat the same configuration failure.
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
                self.record_error(&message).await;
                self.emit("error", message);
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
        let (forwarded, qmp_port, root) = {
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
            (forwarded, manager.state.qmp_port, manager.root.clone())
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
            if forwarded.contains(&mapping.host) || live.contains(&mapping.host) {
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
        let entries = mappings
            .iter()
            .map(|mapping| {
                let active = forwarded.contains(&mapping.host);
                let status = if active {
                    "active"
                } else if tunnel_alive.contains(&mapping.host) {
                    "live"
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
    async fn apply_mapping_change(&self) {
        let manager = self.manager.lock().await;
        let alive = manager.state.process_alive();
        drop(manager);
        if !alive {
            return;
        }
        self.open_guest_ports().await;
        self.sync_live_forwarding().await;
    }

    fn append_named_log(&self, label: &str, path: &Path) {
        self.append_log_with_prefix(label, path);
    }

    fn append_serial_log(&self, path: &Path) {
        self.append_log_with_prefix("serial", path);
    }

    fn append_log_with_prefix(&self, label: &str, path: &Path) {
        let Ok(text) = std::fs::read_to_string(path) else {
            return;
        };
        let bytes = text.len() as u64;
        let mut offsets = self.log_offsets.lock().unwrap();
        let offset = offsets.entry(path.to_path_buf()).or_insert(0);
        if bytes < *offset {
            *offset = 0; // the log was truncated; start over
        }
        if bytes > *offset {
            if let Some(added) = text.get(*offset as usize..) {
                for line in added.lines().filter(|line| !line.trim().is_empty()) {
                    // Serial console lines end with \r on Windows; SSE
                    // payloads must not contain carriage returns or newlines.
                    self.emit("log", format!("[{label}] {}", line.trim_end_matches('\r')));
                }
            }
            *offset = bytes;
        }
    }
}

pub fn spawn(daemon: Arc<Daemon>) {
    let stats_daemon = daemon.clone();
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

        // Initial probe so the first status response is already accurate.
        let mut last_lifecycle = {
            let mut manager = daemon.manager.lock().await;
            let probe = manager.probe().await;
            *daemon.last_probe.lock().unwrap() = probe.clone();
            probe.lifecycle().to_string()
        };
        daemon.emit("status", format!("Environment: {last_lifecycle}"));
        daemon.refresh_status_cache();

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
