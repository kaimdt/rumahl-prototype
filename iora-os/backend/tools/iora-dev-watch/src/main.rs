//! IORA Dev Watch — Build, deploy & monitor the Dev VM.
//!
//! Rewrite (2026-05-31): responsiveness-first architecture.
//!
//!   * Rendering via ratatui (double-buffered, diff-only paint → no flicker,
//!     constant low CPU regardless of how much log output is produced).
//!   * Single async event loop driven by `tokio::select!`. No `std::thread::sleep`,
//!     no busy polling. Input, app events, connection events and the render tick
//!     are all peers; whichever fires first is handled.
//!   * Render coalescing: at most one redraw per 33 ms (~30 FPS). A burst of
//!     thousands of cargo output lines is still rendered exactly once.
//!   * Bounded log ring buffer (VecDeque). O(1) append, no reallocations.
//!   * Background work (build / deploy / restart / health probes) runs in
//!     tokio tasks that share an immutable `Backend` snapshot (cheap `Arc`-style
//!     clone of configuration). The old `App::dummy` clone-of-everything is gone.

mod connection;
mod resources;

use anyhow::{Context, Result};
use clap::Parser;
use connection::{BridgeConnection, ConnEvent, SshSession};
use crossterm::{
    event::{Event as CtEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use notify::{Config as NotifyConfig, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Gauge, List, ListItem, Paragraph, Tabs, Wrap},
    Terminal,
};
use resources::{ResourceData, ResourceHistory};
use std::{
    collections::{HashSet, VecDeque},
    io::stdout,
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Arc},
    time::{Duration, Instant},
};
use tokio::{process::Command as TokioCommand, sync::mpsc, time::interval};

/// Spawn a TokioCommand configured for headless background use:
/// stdin pinned to NUL so the child never competes with our input thread for
/// the console stdin handle (Windows console is single-consumer; a child
/// holding stdin would starve TUI key reads for seconds), and on Windows the
/// CREATE_NO_WINDOW flag so the child neither pops a console window nor can
/// write directly to ConOut$ and corrupt our ratatui buffer.
fn bg_cmd(program: &str) -> TokioCommand {
    let mut cmd = TokioCommand::new(program);
    cmd.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

// ═══ Constants ═══════════════════════════════════════════════════════════

const RENDER_INTERVAL_MS: u64 = 33; // ~30 FPS
const VM_HEALTH_INTERVAL_S: u64 = 30;
const LOG_BUFFER_CAP: usize = 5000;
const CMD_LOG_CAP: usize = 200;
const RESOURCE_INTERVAL_S: u64 = 3;
const SELF_HEAL_INTERVAL_S: u64 = 45;
const STATUS_REFRESH_INTERVAL_S: u64 = 8;

// ═══ CLI ═════════════════════════════════════════════════════════════════

#[derive(Parser, Debug)]
#[command(name = "iora-dev-watch")]
struct Args {
    #[arg(long)] no_watch: bool,
    #[arg(long, default_value = "127.0.0.1")] vm_host: String,
    #[arg(long, default_value = "2222")] vm_port: u16,
    #[arg(long)] ssh_key: Option<String>,
    #[arg(long)] no_deploy: bool,
    #[arg(long)] no_initial_build: bool,
    /// Bridge port (iora-dev-bridge). Set to 0 to disable bridge mode.
    #[arg(long, default_value = "8101")] vm_bridge_port: u16,
}

// ═══ Backend: cheap shared snapshot for background tasks ═════════════════

/// Immutable configuration handed to spawned async tasks.
/// Cloning is cheap (`Arc<...>` clones internally where useful, all PathBufs/Strings).
#[derive(Clone)]
struct Backend {
    vm_host: String,
    vm_port: u16,
    ssh_key: PathBuf,
    repo_root: PathBuf,
    vm_workspace: String,
    frontend_dir: Option<PathBuf>,
    services: Arc<Vec<String>>,
}

impl Backend {
    fn ssh_args(&self) -> Vec<String> {
        let mut args = vec![
            "-o".into(), "StrictHostKeyChecking=no".into(),
            "-o".into(), "IdentitiesOnly=yes".into(),
            "-o".into(), "BatchMode=yes".into(),
            "-o".into(), "LogLevel=ERROR".into(),
            "-o".into(), "ConnectTimeout=10".into(),
            "-o".into(), "ServerAliveInterval=60".into(),
            "-o".into(), "ServerAliveCountMax=60".into(),
            "-o".into(), "TCPKeepAlive=yes".into(),
            "-o".into(), "AddressFamily=inet".into(),
        ];
        #[cfg(unix)]
        { args.push("-o".into()); args.push("UserKnownHostsFile=/dev/null".into()); }
        #[cfg(windows)]
        { args.push("-o".into()); args.push("UserKnownHostsFile=NUL".into()); }
        args.push("-i".into()); args.push(self.ssh_key.to_string_lossy().into());
        args.push("-p".into()); args.push(self.vm_port.to_string());
        args.push(format!("root@{}", self.vm_host));
        args
    }

    async fn ssh_exec(&self, cmd: &str) -> Result<String> {
        let mut args = self.ssh_args();
        args.push(cmd.into());
        let out = tokio::time::timeout(
            Duration::from_secs(60),
            bg_cmd("ssh")
                .args(&args)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output(),
        ).await.context("ssh timeout")??;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    async fn check_vm(&self) -> bool {
        matches!(self.ssh_exec("echo OK").await, Ok(ref s) if s.contains("OK"))
    }

    async fn refresh_services(&self) -> usize {
        if self.services.is_empty() { return 0; }
        let cmd = format!(
            "for s in {}; do systemctl is-active $s 2>/dev/null || echo unknown; done",
            self.services.join(" ")
        );
        match self.ssh_exec(&cmd).await {
            Ok(out) => out.lines().filter(|l| *l == "active").count(),
            Err(_) => 0,
        }
    }

    async fn fetch_service_status(&self) -> Vec<(String, bool)> {
        let mut result = Vec::with_capacity(self.services.len());
        if self.services.is_empty() { return result; }
        let script = format!(
            "for s in {}; do printf '%s|%s\\n' \"$(systemctl is-active $s 2>/dev/null || echo unknown)\" \"$(test -f /usr/bin/$s && echo yes || echo no)\"; done",
            self.services.join(" ")
        );
        if let Ok(output) = self.ssh_exec(&script).await {
            let mut lines = output.lines();
            for _ in self.services.iter() {
                if let Some(line) = lines.next() {
                    let mut parts = line.splitn(2, '|');
                    let status = parts.next().unwrap_or("?").trim().to_string();
                    let has_bin = parts.next().unwrap_or("no").trim() == "yes";
                    result.push((status, has_bin));
                } else {
                    result.push(("?".into(), false));
                }
            }
        } else {
            for _ in self.services.iter() { result.push(("?".into(), false)); }
        }
        result
    }

    fn build_rust_cmd(&self, only: Option<&HashSet<String>>) -> String {
        let mut cmd = format!(
            "cd {} && CARGO_BUILD_JOBS=$(nproc) /home/iora/.cargo/bin/cargo build",
            self.vm_workspace
        );
        if let Some(crates) = only {
            for c in crates { cmd.push_str(&format!(" -p {}", c)); }
        } else {
            cmd.push_str(" --workspace");
        }
        cmd
    }

    async fn sync_sources(&self, tx: &mpsc::UnboundedSender<AppEvent>) {
        let _ = tx.send(AppEvent::Log("[RUST] Syncing sources...".into()));
        let mut ssh_opts: Vec<String> = self.ssh_args();
        ssh_opts.pop(); // drop user@host
        let mut args = vec![
            "-a".into(), "--delete".into(),
            "--exclude=.git".into(), "--exclude=target".into(), "--exclude=node_modules".into(),
            "--exclude=.cache".into(), "--exclude=buildroot-*".into(), "--exclude=releases".into(),
            "--exclude=*.img".into(), "--exclude=*.qcow2".into(), "--exclude=*.iso".into(),
            "--exclude=.iora-dev".into(), "--exclude=dist".into(), "--exclude=__pycache__".into(),
        ];
        args.push("-e".into());
        args.push(format!("ssh {}", ssh_opts.join(" ")));
        args.push(format!("{}/", self.repo_root.display()));
        args.push(format!("root@{}:/home/iora/iora/", self.vm_host));
        let _ = bg_cmd("rsync")
            .args(&args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().await;
        let _ = self.ssh_exec("chown -R iora:iora /home/iora/iora 2>/dev/null").await;
    }

    async fn build_rust(&self, only: Option<HashSet<String>>, tx: mpsc::UnboundedSender<AppEvent>) {
        let label = if let Some(ref c) = only { format!("{} crates", c.len()) } else { "all".into() };
        let _ = tx.send(AppEvent::Log(format!("──[Rust — {}]──", label)));
        let _ = self.ssh_exec("su - iora -c 'test -f /home/iora/.cargo/bin/cargo || curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal' 2>&1").await;
        self.sync_sources(&tx).await;
        let cmd = self.build_rust_cmd(only.as_ref());
        let full = format!("su - iora -c '{}' 2>&1", cmd);
        let _ = tx.send(AppEvent::Log(format!("[RUST] {}", cmd)));

        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut args = self.ssh_args();
        args.push(full);
        let spawn = bg_cmd("ssh").args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();
        let mut child = match spawn {
            Ok(c) => c,
            Err(e) => { let _ = tx.send(AppEvent::Log(format!("[RUST] spawn failed: {e}"))); return; }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let tx_out = tx.clone();
        let tx_err = tx.clone();
        let t1 = tokio::spawn(async move {
            if let Some(s) = stdout {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx_out.send(AppEvent::Log(format!("[RUST] {}", line)));
                }
            }
        });
        let t2 = tokio::spawn(async move {
            if let Some(s) = stderr {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx_err.send(AppEvent::Log(format!("[RUST] {}", line)));
                }
            }
        });
        let _ = t1.await;
        let _ = t2.await;
        let status = child.wait().await;
        let ok = matches!(status, Ok(s) if s.success());
        let _ = tx.send(AppEvent::Log(
            if ok { "[RUST] ✓ Build OK".into() } else { "[RUST] ✗ Build FAILED".into() }
        ));
    }

    async fn deploy_binaries(&self, tx: mpsc::UnboundedSender<AppEvent>) {
        let _ = tx.send(AppEvent::Log("[DEPLOY] Deploying...".into()));
        let script = self.deploy_script();
        let cmd = format!(
            "cat > /tmp/iora-deploy.sh << 'DEPLOYEOF'\n{}\nDEPLOYEOF\nbash /tmp/iora-deploy.sh && rm -f /tmp/iora-deploy.sh",
            script
        );
        match self.ssh_exec(&cmd).await {
            Ok(out) => {
                for line in out.lines() {
                    if !line.trim().is_empty() { let _ = tx.send(AppEvent::Log(format!("[DEPLOY] {}", line))); }
                }
            }
            Err(e) => { let _ = tx.send(AppEvent::Log(format!("[DEPLOY] ✗ {e}"))); }
        }
        let active = self.refresh_services().await;
        let _ = tx.send(AppEvent::ServiceCount(active));
    }

    fn deploy_script(&self) -> String {
        let ws = &self.vm_workspace;
        let svc_list = self.services.join(" ");
        format!(r#"#!/bin/bash
set +e
mkdir -p /var/lib/iora/.bin-hashes
deployed=0
skipped=0
restart_list=""
home_changed=0
for svc in {svc_list}; do
    bin="{ws}/target/debug/$svc"
    [ -f "$bin" ] || {{ echo "skip $svc (not built)"; continue; }}
    short="${{svc#iora-}}"
    cur=$(sha256sum "$bin" | awk '{{print $1}}')
    prev=$(cat "/var/lib/iora/.bin-hashes/$svc" 2>/dev/null)
    if [ "$cur" = "$prev" ] && [ -f "/usr/bin/$svc" ]; then
        skipped=$((skipped+1))
        continue
    fi
    install -m 0755 "$bin" "/usr/bin/$svc" || {{ echo "install FAILED $svc"; continue; }}
    mkdir -p "/etc/iora/db-credentials" "/opt/iora/build/$svc/data" "/etc/systemd/system/$svc.service.d"
    [ -f "/etc/iora/db-credentials/$svc.env" ] || echo "DATABASE_URL=postgres://root:iora@localhost/iora_$short" > "/etc/iora/db-credentials/$svc.env"
    if [ ! -f "/etc/iora/$svc.env" ]; then
        if [ "$svc" = "iora-home" ]; then
            printf 'DATABASE_URL=postgres://root:iora@localhost:5432/iora_%s\nRUST_LOG=%s=debug\nIORA_BOOTSTRAP_ADMIN_USER=admin\nIORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234\n' "$short" "$svc" > "/etc/iora/$svc.env"
        else
            printf 'DATABASE_URL=postgres://root:iora@localhost:5432/iora_%s\nRUST_LOG=%s=debug\n' "$short" "$svc" > "/etc/iora/$svc.env"
        fi
    fi
    echo "$cur" > "/var/lib/iora/.bin-hashes/$svc"
    restart_list="$restart_list $svc"
    [ "$svc" = "iora-home" ] && home_changed=1
    deployed=$((deployed+1))
    echo "✓ $svc"
done
for svc in $restart_list; do
    (systemctl reset-failed "$svc" 2>/dev/null; systemctl restart "$svc" 2>/dev/null || systemctl start "$svc" 2>/dev/null) &
done
wait
if [ "$home_changed" = "1" ] && [ ! -f /var/lib/iora/.admin-role-fixed ]; then
    for i in 1 2 3 4 5 6 7 8; do
        if su - postgres -c "psql -tAc 'SELECT 1 FROM users LIMIT 1' iora_home" 2>/dev/null | grep -q 1; then break; fi
        sleep 1
    done
    su - postgres -c "psql iora_home -c \"UPDATE users SET role='admin' WHERE username='admin' AND role!='admin'\"" >/dev/null 2>&1
    touch /var/lib/iora/.admin-role-fixed
fi
echo "result: deployed=$deployed skipped=$skipped"
"#)
    }

    async fn build_frontend(&self, tx: mpsc::UnboundedSender<AppEvent>, auto_deploy: bool) {
        let fe = match &self.frontend_dir { Some(d) => d.clone(), None => return };
        let _ = tx.send(AppEvent::Log("──[Frontend]──".into()));
        if !fe.join("node_modules").is_dir() {
            let _ = tx.send(AppEvent::Log("[FE] npm install...".into()));
            let st = bg_cmd("npm")
                .args(["install", "--no-audit", "--no-fund"])
                .current_dir(&fe)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status().await;
            if !matches!(st, Ok(s) if s.success()) {
                let _ = tx.send(AppEvent::Log("[FE] ✗ npm install FAILED".into()));
                return;
            }
        }
        let _ = tx.send(AppEvent::Log("[FE] npm run build...".into()));
        let out = match bg_cmd("npm").args(["run", "build"])
            .current_dir(&fe)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output().await
        {
            Ok(o) => o,
            Err(e) => { let _ = tx.send(AppEvent::Log(format!("[FE] ✗ {e}"))); return; }
        };
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if !line.trim().is_empty() { let _ = tx.send(AppEvent::Log(format!("[FE] {}", line))); }
        }
        if out.status.success() {
            let _ = tx.send(AppEvent::Log("[FE] ✓ Build OK".into()));
            if auto_deploy { self.deploy_frontend(tx).await; }
        } else {
            let _ = tx.send(AppEvent::Log("[FE] ✗ Build FAILED".into()));
        }
    }

    async fn deploy_frontend(&self, tx: mpsc::UnboundedSender<AppEvent>) {
        let fe = match &self.frontend_dir { Some(d) => d.clone(), None => return };
        let dist = fe.join("dist");
        if !dist.is_dir() { return; }
        let remote = "set -e; mkdir -p /opt/iora/build; \
            tmp=$(mktemp -d /opt/iora/build/.dist-XXXXXX); \
            tar xzf - -C \"$tmp\"; \
            rm -rf /opt/iora/build/dist; \
            mv \"$tmp\" /opt/iora/build/dist; \
            systemctl reload nginx 2>/dev/null || true";
        let mut ssh_args = self.ssh_args();
        ssh_args.push(remote.into());

        let mut tar_child = match bg_cmd("tar")
            .args(["-czf", "-", "-C", dist.to_str().unwrap_or("."), "."])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => { let _ = tx.send(AppEvent::Log(format!("[FE] tar spawn: {e}"))); return; }
        };
        let Some(tar_out) = tar_child.stdout.take() else { return; };
        #[cfg(unix)]
        let stdin = match tar_out.into_owned_fd() {
            Ok(fd) => std::process::Stdio::from(fd),
            Err(_) => { let _ = tx.send(AppEvent::Log("[FE] tar stdout fd error".into())); return; }
        };
        #[cfg(windows)]
        let stdin = match tar_out.into_owned_handle() {
            Ok(h) => std::process::Stdio::from(h),
            Err(_) => { let _ = tx.send(AppEvent::Log("[FE] tar stdout handle error".into())); return; }
        };
        let status = bg_cmd("ssh")
            .args(&ssh_args)
            .stdin(stdin)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status().await;
        let _ = tar_child.wait().await;
        let _ = tx.send(AppEvent::Log(
            if matches!(status, Ok(s) if s.success()) { "[FE] ✓ Deployed".into() } else { "[FE] ✗ Deploy FAILED".into() }
        ));
    }

    async fn restart_service(&self, svc: String, tx: mpsc::UnboundedSender<AppEvent>) {
        let cmd = format!(
            "systemctl reset-failed {svc} 2>/dev/null; systemctl restart {svc} 2>/dev/null || systemctl start {svc} 2>/dev/null || true; sleep 1; systemctl is-active {svc} 2>/dev/null | tr -d '\\n'"
        );
        let st = self.ssh_exec(&cmd).await.unwrap_or_else(|_| "?".into());
        let _ = tx.send(AppEvent::Log(format!("[RESTART] {svc} → {st}")));
    }

    /// Run autonomous self-healing checks on the VM over SSH.
    ///
    /// Currently handles:
    ///   1. `iora-dev-bridge` is started if its unit exists but is not active.
    ///   2. Any failed `iora-*` systemd unit is reset and restarted.
    ///   3. Root filesystem >= 90 % full produces a warning.
    ///
    /// All actions are reported back via `[HEAL]` log lines so the user can
    /// see what the watcher did. Quiet (no log spam) when nothing needed fixing.
    async fn self_heal(&self, tx: mpsc::UnboundedSender<AppEvent>) {
        // Skip entirely if the VM isn't reachable — no point in trying.
        if !self.check_vm().await {
            return;
        }
        let script = r#"set +e
out=""
missing=""
# 0) Detect missing iora-* binaries (especially iora-dev-bridge).
#    The watcher will see the `missing:` lines and auto-trigger a build.
for b in iora-dev-bridge iora-home iora-core; do
    if [ ! -x "/usr/bin/$b" ]; then
        missing="${missing}${b} "
    fi
done
if [ -n "$missing" ]; then
    out="${out}missing: ${missing}\n"
fi
# 1) iora-dev-bridge: start it if a unit file exists but it's not active.
bridge_state=$(systemctl is-active iora-dev-bridge 2>/dev/null)
if [ "$bridge_state" != "active" ]; then
    if systemctl list-unit-files iora-dev-bridge.service 2>/dev/null | grep -q iora-dev-bridge; then
        systemctl reset-failed iora-dev-bridge 2>/dev/null
        systemctl start iora-dev-bridge 2>/dev/null
        sleep 1
        new=$(systemctl is-active iora-dev-bridge 2>/dev/null)
        out="${out}bridge ${bridge_state:-missing} -> ${new}\n"
    elif [ -x /usr/bin/iora-dev-bridge ]; then
        # Unit missing but binary present — install a minimal unit and start it.
        cat > /etc/systemd/system/iora-dev-bridge.service <<'UNIT'
[Unit]
Description=IORA Dev Bridge (auto-installed by iora-dev-watch)
After=network-online.target
[Service]
ExecStart=/usr/bin/iora-dev-bridge
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT
        systemctl daemon-reload 2>/dev/null
        systemctl enable --now iora-dev-bridge 2>/dev/null
        new=$(systemctl is-active iora-dev-bridge 2>/dev/null)
        out="${out}bridge installed-unit -> ${new}\n"
    else
        out="${out}bridge unavailable (no unit, no binary)\n"
    fi
fi
# 2) Reset+restart any failed iora-* units.
failed=$(systemctl list-units --failed --no-legend --plain 2>/dev/null | awk '/^iora-/{print $1}')
for u in $failed; do
    systemctl reset-failed "$u" 2>/dev/null
    systemctl restart "$u" 2>/dev/null
    sleep 1
    s=$(systemctl is-active "$u" 2>/dev/null)
    out="${out}restart ${u} -> ${s}\n"
done
# 3) Disk pressure warning.
used=$(df --output=pcent / 2>/dev/null | tail -1 | tr -d ' %')
if [ -n "$used" ] && [ "$used" -ge 90 ]; then
    out="${out}disk root ${used}% full\n"
fi
printf '%s' "$out"
"#;
        if let Ok(output) = self.ssh_exec(script).await {
            let mut missing_crates: HashSet<String> = HashSet::new();
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() { continue; }
                // Detect the `missing: foo bar` marker and turn it into an
                // AutoBuildMissing event so the main loop can kick a build.
                if let Some(rest) = line.strip_prefix("missing:") {
                    for crate_name in rest.split_whitespace() {
                        missing_crates.insert(crate_name.to_string());
                    }
                }
                let _ = tx.send(AppEvent::Log(format!("[HEAL] {line}")));
            }
            if !missing_crates.is_empty() {
                let _ = tx.send(AppEvent::AutoBuildMissing(missing_crates));
            }
        }
    }
}

// ═══ App events ══════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
enum AppEvent {
    Log(String),
    BuildComplete,
    VmReachable(bool),
    ServiceCount(usize),
    ServiceStatus(Vec<(String, bool)>),
    Resource(ResourceData),
    HealthCheckDone,
    FileChange { rust_crates: HashSet<String>, frontend: bool },
    /// Self-heal detected one or more iora-* binaries missing on the VM
    /// and asks the main loop to start an automatic build+deploy for them.
    AutoBuildMissing(HashSet<String>),
}

// ═══ App state ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, PartialEq)]
enum View { Logs, Status, Journal, Commands, Resources }

#[derive(Debug, Clone)]
enum Mode {
    Normal,
    Command { input: String },
    BuildMenu { cursor: usize },
    BuildSelect { cursor: usize, selected: HashSet<usize> },
}

struct AppState {
    backend: Backend,
    auto_deploy: bool,
    do_watch: bool,

    // Runtime status
    vm_online: bool,
    bridge_connected: bool,
    ssh_connected: bool,
    building: bool,
    build_start: Option<Instant>,
    last_build: String,
    active_services: usize,
    service_status: Vec<(String, bool)>,
    last_status_refresh: Option<Instant>,
    bridge_uptime: u64,
    bridge_mem_avail: u64,

    // Watch state
    changed_rust: HashSet<String>,
    changed_fe: bool,
    last_auto_build_trigger: Option<Instant>,

    // UI
    view: View,
    mode: Mode,
    show_help: bool,
    log_buf: VecDeque<String>,
    command_log: VecDeque<String>,
    log_scroll: usize,

    // Resources
    resource_data: ResourceData,
    resource_history: ResourceHistory,

    should_quit: bool,
    dirty: bool,
}

impl AppState {
    fn new(backend: Backend, auto_deploy: bool, do_watch: bool) -> Self {
        let total = backend.services.len();
        Self {
            backend, auto_deploy, do_watch,
            vm_online: false, bridge_connected: false, ssh_connected: false,
            building: false, build_start: None, last_build: "-".into(),
            active_services: 0,
            service_status: vec![("?".into(), false); total],
            last_status_refresh: None,
            bridge_uptime: 0, bridge_mem_avail: 0,
            changed_rust: HashSet::new(), changed_fe: false,
            last_auto_build_trigger: None,
            view: View::Logs, mode: Mode::Normal, show_help: false,
            log_buf: VecDeque::with_capacity(LOG_BUFFER_CAP),
            command_log: VecDeque::with_capacity(CMD_LOG_CAP),
            log_scroll: 0,
            resource_data: ResourceData::default(),
            resource_history: ResourceHistory::new(60),
            should_quit: false, dirty: true,
        }
    }

    fn push_log(&mut self, line: impl Into<String>) {
        if self.log_buf.len() >= LOG_BUFFER_CAP { self.log_buf.pop_front(); }
        self.log_buf.push_back(line.into());
        self.dirty = true;
    }

    fn push_cmd_log(&mut self, line: impl Into<String>) {
        if self.command_log.len() >= CMD_LOG_CAP { self.command_log.pop_front(); }
        self.command_log.push_back(line.into());
        self.dirty = true;
    }
}

// ═══ Helpers ═════════════════════════════════════════════════════════════

fn find_repo_root() -> Result<PathBuf> {
    if let Ok(o) = std::process::Command::new("git").args(["rev-parse", "--show-toplevel"]).output() {
        if o.status.success() {
            return Ok(PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()));
        }
    }
    for a in std::env::current_exe()?.ancestors() {
        if a.join("iora-os/backend/Cargo.toml").exists() || a.join("backend/Cargo.toml").exists() {
            return Ok(a.into());
        }
    }
    anyhow::bail!("no repo root")
}

fn find_workspace(r: &PathBuf) -> Result<PathBuf> {
    for c in &[r.join("iora-os/backend"), r.join("backend")] {
        if c.join("Cargo.toml").exists() { return Ok(c.clone()); }
    }
    anyhow::bail!("no workspace")
}

fn find_frontend(r: &PathBuf) -> Option<PathBuf> {
    for d in &["frontend", "desktop"] {
        let p = r.join(d);
        if p.join("package.json").exists() { return Some(p); }
    }
    None
}

fn discover_services(w: &PathBuf) -> Vec<String> {
    let mut v = Vec::new();
    for sub in &["services", "tools", "apps/system", "dev"] {
        let b = w.join(sub);
        if !b.is_dir() { continue; }
        if let Ok(e) = std::fs::read_dir(&b) {
            for en in e.flatten() {
                let p = en.path();
                if p.is_dir() && p.join("Cargo.toml").exists() {
                    if let Some(n) = p.file_name().and_then(|n| n.to_str()) {
                        if n.starts_with("iora-") && n != "iora-dev-watch" {
                            v.push(n.into());
                        }
                    }
                }
            }
        }
    }
    v.sort(); v.dedup(); v
}

fn start_file_watcher(
    workspace: PathBuf,
    fe: Option<PathBuf>,
    tx: mpsc::UnboundedSender<AppEvent>,
) -> Result<RecommendedWatcher> {
    let dirs: Vec<PathBuf> = ["services", "shared", "tools", "apps", "dev"]
        .iter().map(|s| workspace.join(s)).filter(|p| p.is_dir()).collect();
    let mut w: RecommendedWatcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) { return; }
        let mut rust = HashSet::new();
        let mut frontend = false;
        for p in &ev.paths {
            let s = p.to_string_lossy();
            if s.contains("iora-dev-watch") { continue; }
            if s.ends_with(".rs") {
                for c in p.components().rev() {
                    let cn = c.as_os_str().to_string_lossy();
                    if cn.starts_with("iora-") { rust.insert(cn.to_string()); break; }
                }
            }
            if s.contains("Cargo.toml") || s.contains("Cargo.lock") {
                rust.insert("__workspace__".into());
            }
            if s.ends_with(".tsx") || s.ends_with(".ts") || s.ends_with(".jsx")
                || s.ends_with(".css") || s.ends_with(".html") { frontend = true; }
        }
        if !rust.is_empty() || frontend {
            let _ = tx.send(AppEvent::FileChange { rust_crates: rust, frontend });
        }
    })?;
    w.configure(NotifyConfig::default().with_poll_interval(Duration::from_secs(2)))?;
    for d in &dirs { let _ = w.watch(d, RecursiveMode::Recursive); }
    if let Some(f) = &fe {
        for s in &["src", "public"] {
            let d = f.join(s);
            if d.is_dir() { let _ = w.watch(&d, RecursiveMode::Recursive); }
        }
    }
    Ok(w)
}

// ═══ Background task helpers ═════════════════════════════════════════════

fn spawn_build(
    state: &mut AppState,
    only: Option<HashSet<String>>,
    rust: bool,
    fe: bool,
    tx: mpsc::UnboundedSender<AppEvent>,
) {
    if state.building { state.push_log("[BUILD] Already building"); return; }
    if !state.vm_online { state.push_log("[BUILD] VM offline"); return; }
    state.building = true;
    state.build_start = Some(Instant::now());
    state.last_build = "Building...".into();
    let backend = state.backend.clone();
    let auto_deploy = state.auto_deploy;
    tokio::spawn(async move {
        if rust { backend.build_rust(only, tx.clone()).await; }
        if fe { backend.build_frontend(tx.clone(), auto_deploy).await; }
        if auto_deploy && rust {
            backend.deploy_binaries(tx.clone()).await;
        }
        let _ = tx.send(AppEvent::BuildComplete);
    });
}

fn spawn_deploy(state: &mut AppState, tx: mpsc::UnboundedSender<AppEvent>) {
    if !state.vm_online { state.push_log("[DEPLOY] VM offline"); return; }
    let backend = state.backend.clone();
    tokio::spawn(async move { backend.deploy_binaries(tx).await; });
}

fn spawn_check_vm(state: &AppState, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    tokio::spawn(async move {
        let ok = backend.check_vm().await;
        let _ = tx.send(AppEvent::VmReachable(ok));
        if ok {
            let n = backend.refresh_services().await;
            let _ = tx.send(AppEvent::ServiceCount(n));
        }
        let _ = tx.send(AppEvent::HealthCheckDone);
    });
}

fn spawn_fetch_status(state: &AppState, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    tokio::spawn(async move {
        let st = backend.fetch_service_status().await;
        let _ = tx.send(AppEvent::ServiceStatus(st));
    });
}

fn spawn_health_probe(state: &AppState, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    tokio::spawn(async move {
        if let Ok(h) = backend.ssh_exec("curl -sf --max-time 3 http://127.0.0.1:8126/api/health 2>/dev/null || echo FAIL").await {
            let _ = tx.send(AppEvent::Log(
                if h.contains("\"status\":\"ok\"") { "[HEALTH] ✓ API OK".into() }
                else { "[HEALTH] ✗ API unreachable".into() }
            ));
        }
        if let Ok(d) = backend.ssh_exec("df -h / 2>/dev/null | tail -1").await {
            let _ = tx.send(AppEvent::Log(format!("[HEALTH] Disk: {}", d.trim())));
        }
    });
}

fn spawn_journal(state: &AppState, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    tokio::spawn(async move {
        if let Ok(l) = backend.ssh_exec("journalctl -u iora-home --no-pager -n 30 2>/dev/null").await {
            for line in l.lines() {
                let _ = tx.send(AppEvent::Log(format!("  {}", line)));
            }
        }
    });
}

fn spawn_restart(state: &AppState, svc: String, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    tokio::spawn(async move { backend.restart_service(svc, tx).await; });
}

// ═══ Input / commands ════════════════════════════════════════════════════

fn handle_key(state: &mut AppState, key: KeyEvent, tx: &mpsc::UnboundedSender<AppEvent>) {
    state.dirty = true;

    // Ctrl-C always quits
    if key.modifiers.contains(KeyModifiers::CONTROL) && matches!(key.code, KeyCode::Char('c')) {
        state.should_quit = true;
        return;
    }

    match &mut state.mode.clone() {
        Mode::Command { input } => {
            let mut input = input.clone();
            match key.code {
                KeyCode::Esc | KeyCode::Tab => state.mode = Mode::Normal,
                KeyCode::Enter => {
                    let cmd = input.clone();
                    state.mode = Mode::Normal;
                    state.push_cmd_log(format!("> {}", cmd));
                    run_command(state, &cmd, tx);
                }
                // Filter out control characters so a stray Tab/Enter/Esc that
                // somehow arrives as KeyCode::Char('\t'/'\r'/'\x1b') never
                // pollutes the visible command-line buffer.
                KeyCode::Char(c) if !c.is_control() => {
                    input.push(c);
                    state.mode = Mode::Command { input };
                }
                KeyCode::Backspace => { input.pop(); state.mode = Mode::Command { input }; }
                _ => {}
            }
            return;
        }
        Mode::BuildMenu { cursor } => {
            let cur = *cursor;
            match key.code {
                KeyCode::Esc => state.mode = Mode::Normal,
                KeyCode::Up => state.mode = Mode::BuildMenu { cursor: cur.saturating_sub(1) },
                KeyCode::Down => state.mode = Mode::BuildMenu { cursor: (cur + 1).min(2) },
                KeyCode::Enter => {
                    if cur == 2 {
                        state.mode = Mode::BuildSelect { cursor: 0, selected: HashSet::new() };
                    } else {
                        state.mode = Mode::Normal;
                        let only = if cur == 1 && !state.changed_rust.is_empty() {
                            Some(state.changed_rust.clone())
                        } else { None };
                        state.push_log(format!("[BUILD] {}", ["All", "Changed", "Select"][cur]));
                        spawn_build(state, only, true, true, tx.clone());
                    }
                }
                _ => {}
            }
            return;
        }
        Mode::BuildSelect { cursor, selected } => {
            let mut cur = *cursor;
            let mut sel = selected.clone();
            let n = state.backend.services.len();
            match key.code {
                KeyCode::Esc => { state.mode = Mode::BuildMenu { cursor: 2 }; return; }
                KeyCode::Up => cur = cur.saturating_sub(1),
                KeyCode::Down => cur = (cur + 1).min(n.saturating_sub(1)),
                KeyCode::Char(' ') => {
                    if sel.contains(&cur) { sel.remove(&cur); } else { sel.insert(cur); }
                }
                KeyCode::Char('a') | KeyCode::Char('A') => {
                    if sel.len() == n { sel.clear(); }
                    else { for i in 0..n { sel.insert(i); } }
                }
                KeyCode::Enter => {
                    if sel.is_empty() { state.mode = Mode::BuildMenu { cursor: 2 }; return; }
                    let only: HashSet<String> = sel.iter().map(|&i| state.backend.services[i].clone()).collect();
                    state.mode = Mode::Normal;
                    state.push_log(format!("[BUILD] {} services", only.len()));
                    spawn_build(state, Some(only), true, false, tx.clone());
                    return;
                }
                _ => {}
            }
            state.mode = Mode::BuildSelect { cursor: cur, selected: sel };
            return;
        }
        Mode::Normal => {}
    }

    // Normal-mode keys
    match key.code {
        KeyCode::Esc => state.show_help = false,
        KeyCode::Char('q') | KeyCode::Char('Q') => state.should_quit = true,
        KeyCode::Char('?') => state.show_help = !state.show_help,
        KeyCode::Char('/') => state.mode = Mode::Command { input: String::new() },
        KeyCode::Tab => {
            state.view = match state.view {
                View::Logs => View::Status,
                View::Status => View::Journal,
                View::Journal => View::Commands,
                View::Commands => View::Resources,
                View::Resources => View::Logs,
            };
            state.log_scroll = 0;
            // Refresh status immediately when switching to the Status view
            // so the page is never showing stale data right after a tab.
            if state.view == View::Status && state.vm_online && !state.building {
                spawn_fetch_status(state, tx.clone());
            }
        }
        KeyCode::Up => state.log_scroll = state.log_scroll.saturating_add(1),
        KeyCode::Down => state.log_scroll = state.log_scroll.saturating_sub(1),
        KeyCode::PageUp => state.log_scroll = state.log_scroll.saturating_add(10),
        KeyCode::PageDown => state.log_scroll = state.log_scroll.saturating_sub(10),
        KeyCode::Home => state.log_scroll = state.log_buf.len().saturating_sub(1),
        KeyCode::End => state.log_scroll = 0,
        KeyCode::Char('b') | KeyCode::Char('B') => {
            state.push_log("[BUILD] Full rebuild");
            spawn_build(state, None, true, true, tx.clone());
        }
        KeyCode::Char('r') => state.mode = Mode::BuildMenu { cursor: 0 },
        KeyCode::Char('R') => { state.view = View::Resources; state.log_scroll = 0; }
        KeyCode::Char('c') | KeyCode::Char('C') => {
            state.push_log("[VM] Checking...");
            spawn_check_vm(state, tx.clone());
        }
        KeyCode::Char('d') | KeyCode::Char('D') => spawn_deploy(state, tx.clone()),
        KeyCode::Char('l') | KeyCode::Char('L') => {
            state.auto_deploy = !state.auto_deploy;
            let s = format!("[CONFIG] Auto-deploy: {}", if state.auto_deploy {"ON"} else {"OFF"});
            state.push_log(s);
        }
        KeyCode::Char('w') | KeyCode::Char('W') => {
            state.do_watch = !state.do_watch;
            let s = format!("[CONFIG] Watch: {}", if state.do_watch {"ON"} else {"OFF"});
            state.push_log(s);
        }
        KeyCode::Char('s') | KeyCode::Char('S') => {
            state.view = View::Status; state.log_scroll = 0;
            if state.vm_online { spawn_fetch_status(state, tx.clone()); }
        }
        KeyCode::Char('h') | KeyCode::Char('H') => {
            state.push_log("[HEALTH] Checking...");
            spawn_health_probe(state, tx.clone());
        }
        KeyCode::Char('j') | KeyCode::Char('J') => {
            state.view = View::Journal; state.log_scroll = 0;
            spawn_journal(state, tx.clone());
        }
        KeyCode::Char(d @ '1'..='9') => {
            let idx = (d as u8 - b'1') as usize;
            if idx < state.backend.services.len() && state.vm_online {
                let svc = state.backend.services[idx].clone();
                state.push_log(format!("[RESTART] {svc}"));
                spawn_restart(state, svc, tx.clone());
            }
        }
        _ => {}
    }
}

fn run_command(state: &mut AppState, input: &str, tx: &mpsc::UnboundedSender<AppEvent>) {
    let parts: Vec<&str> = input.trim().split_whitespace().collect();
    if parts.is_empty() { return; }
    match parts[0] {
        "build" | "b" => {
            let mut rust = true; let mut fe = true; let mut changed = false;
            for p in &parts[1..] {
                match *p {
                    "rust" | "r" => fe = false,
                    "fe" | "frontend" | "f" => rust = false,
                    "changed" | "c" => changed = true,
                    "all" | "a" => {}
                    _ => { state.push_log("[CMD] unknown arg"); return; }
                }
            }
            let only = if changed && !state.changed_rust.is_empty() { Some(state.changed_rust.clone()) } else { None };
            spawn_build(state, only, rust, fe, tx.clone());
        }
        "deploy" | "d" => spawn_deploy(state, tx.clone()),
        "restart" => {
            if parts.len() < 2 { state.push_log("[CMD] Usage: restart <service>"); return; }
            spawn_restart(state, parts[1].into(), tx.clone());
        }
        "logs" | "l" => { state.view = View::Logs; state.log_scroll = 0; }
        "status" => { state.view = View::Status; state.log_scroll = 0;
            if state.vm_online { spawn_fetch_status(state, tx.clone()); } }
        "journal" | "j" => { state.view = View::Journal; state.log_scroll = 0; spawn_journal(state, tx.clone()); }
        "commands" | "cmd" => { state.view = View::Commands; state.log_scroll = 0; }
        "resources" => { state.view = View::Resources; state.log_scroll = 0; }
        "connect" | "c" => spawn_check_vm(state, tx.clone()),
        "watch" => {
            state.do_watch = parts.get(1).map_or(true, |&w| w != "off");
            let s = format!("[CMD] Watch: {}", if state.do_watch {"ON"} else {"OFF"});
            state.push_log(s);
        }
        "deploy-toggle" | "dt" => {
            state.auto_deploy = !state.auto_deploy;
            let s = format!("[CMD] Auto-deploy: {}", if state.auto_deploy {"ON"} else {"OFF"});
            state.push_log(s);
        }
        "quit" | "q" | "exit" => state.should_quit = true,
        "help" | "?" => {
            state.push_log("[CMD] build [rust|fe|changed] | deploy | restart <s> | journal | status | logs | commands | resources | connect | watch [on|off] | deploy-toggle | quit");
        }
        _ => { state.push_log(format!("[CMD] Unknown: {} (type help)", parts[0])); }
    }
}

// ═══ Rendering (ratatui) ═════════════════════════════════════════════════

fn ui(f: &mut ratatui::Frame, state: &AppState) {
    let area = f.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),   // header
            Constraint::Length(2),   // tabs
            Constraint::Min(3),      // body
            Constraint::Length(2),   // footer
        ])
        .split(area);

    render_header(f, chunks[0], state);
    render_tabs(f, chunks[1], state);
    match state.view {
        View::Logs => render_logs(f, chunks[2], state),
        View::Status => render_status(f, chunks[2], state),
        View::Journal => render_journal(f, chunks[2], state),
        View::Commands => render_commands(f, chunks[2], state),
        View::Resources => render_resources(f, chunks[2], state),
    }
    render_footer(f, chunks[3], state);

    if state.show_help { render_help(f, area); }
}

fn render_header(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let vm_style = if s.vm_online { Style::default().fg(Color::Green) } else { Style::default().fg(Color::Red) };
    let vm_text = if s.vm_online { "● online" } else { "● offline" };

    let bridge_style = if s.bridge_connected { Style::default().fg(Color::Green) } else { Style::default().fg(Color::DarkGray) };
    let ssh_style = if s.ssh_connected { Style::default().fg(Color::Green) } else { Style::default().fg(Color::DarkGray) };

    let build_text = if s.building {
        let secs = s.build_start.map(|t| t.elapsed().as_secs()).unwrap_or(0);
        format!("Building {}s", secs)
    } else { s.last_build.clone() };
    let dep_style = if s.auto_deploy { Style::default().fg(Color::Green) } else { Style::default().fg(Color::Red) };
    let dep_text = if s.auto_deploy { "ON" } else { "OFF" };
    let watch_style = if s.do_watch { Style::default().fg(Color::Green) } else { Style::default().fg(Color::DarkGray) };
    let watch_text = if s.do_watch { "ON" } else { "OFF" };

    let mem_g = s.bridge_mem_avail as f64 / 1_073_741_824.0;
    let info = if s.bridge_connected && s.bridge_uptime > 0 {
        format!(" ↑{}m  free {:.1}G", s.bridge_uptime / 60, mem_g)
    } else { String::new() };

    let line = Line::from(vec![
        Span::raw(" VM: "),
        Span::styled(vm_text, vm_style),
        Span::raw("  ["),
        Span::styled("B", bridge_style),
        Span::raw("|"),
        Span::styled("S", ssh_style),
        Span::raw("]"),
        Span::styled(info, Style::default().fg(Color::DarkGray)),
        Span::raw("   Build: "),
        Span::styled(build_text, Style::default().fg(Color::Cyan)),
        Span::raw("   Deploy: "),
        Span::styled(dep_text, dep_style),
        Span::raw("   Watch: "),
        Span::styled(watch_text, watch_style),
        Span::raw(format!("   Services: {}/{}", s.active_services, s.backend.services.len())),
    ]);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(Span::styled(" IORA Dev Watch ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)));
    let p = Paragraph::new(line).block(block);
    f.render_widget(p, area);
}

fn render_tabs(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let titles = vec!["Logs", "Status", "Journal", "Commands", "Resources"];
    let idx = match s.view {
        View::Logs => 0, View::Status => 1, View::Journal => 2,
        View::Commands => 3, View::Resources => 4,
    };
    let tabs = Tabs::new(titles)
        .select(idx)
        .style(Style::default().fg(Color::DarkGray))
        .highlight_style(Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD))
        .divider("│");
    f.render_widget(tabs, area);
}

fn log_style(line: &str) -> Style {
    if line.contains("[RUST]") || line.contains("[DEPLOY]") { Style::default().fg(Color::Magenta) }
    else if line.contains("[FE]") || line.contains("[SYSTEM]") || line.contains("[BRIDGE]") { Style::default().fg(Color::Cyan) }
    else if line.contains("[CMD]") || line.contains("[RESTART]") || line.contains("[WATCH]") || line.contains("[CONFIG]") { Style::default().fg(Color::Yellow) }
    else if line.contains("[HEALTH]") || line.contains("[STATUS]") || line.contains("[SSH]") || line.contains("[VM]") || line.contains("[CONN]") { Style::default().fg(Color::Blue) }
    else if line.contains("✓") || line.contains(" OK") { Style::default().fg(Color::Green) }
    else if line.contains("✗") || line.contains("FAILED") { Style::default().fg(Color::Red) }
    else if line.contains("──") { Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD) }
    else { Style::default().fg(Color::Gray) }
}

fn render_logs(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let h = area.height.saturating_sub(2) as usize;
    let total = s.log_buf.len();
    // Newest line is the last; log_scroll counts how many lines below the newest are skipped (scroll-up)
    let end = total.saturating_sub(s.log_scroll);
    let start = end.saturating_sub(h);
    let items: Vec<ListItem> = s.log_buf.range(start..end)
        .map(|l| ListItem::new(Line::styled(l.as_str(), log_style(l))))
        .collect();
    let title = if s.log_scroll > 0 { format!(" Logs [↑{}] ", s.log_scroll) } else { " Logs ".into() };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(title);
    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn render_status(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    use ratatui::layout::{Constraint, Direction, Layout};

    let total = s.backend.services.len();
    let active = s.service_status.iter().filter(|(st, _)| st == "active").count();
    let failed = s.service_status.iter().filter(|(st, _)| st == "failed").count();
    let inactive = s.service_status.iter().filter(|(st, _)| st == "inactive").count();
    let missing_bin = s.service_status.iter().filter(|(_, b)| !*b).count();
    let last_refresh = s.last_status_refresh
        .map(|t| format!("{}s ago", t.elapsed().as_secs()))
        .unwrap_or_else(|| "never".into());

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)])
        .split(area);

    // Summary bar
    let summary = Line::from(vec![
        Span::styled(" Services ",
            Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::raw("  "),
        Span::styled(format!("{active}"), Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
        Span::raw(" active  "),
        Span::styled(format!("{failed}"),
            Style::default().fg(if failed > 0 { Color::Red } else { Color::DarkGray }).add_modifier(Modifier::BOLD)),
        Span::raw(" failed  "),
        Span::styled(format!("{inactive}"), Style::default().fg(Color::Yellow)),
        Span::raw(" inactive  "),
        Span::styled(format!("{missing_bin}"),
            Style::default().fg(if missing_bin > 0 { Color::Magenta } else { Color::DarkGray })),
        Span::raw(" no-binary  /  "),
        Span::styled(format!("{total}"), Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
        Span::raw(" total      refresh: "),
        Span::styled(last_refresh, Style::default().fg(Color::DarkGray)),
        Span::raw("  (auto every 8s)"),
    ]);
    let summary_block = Block::default().borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Service Overview ");
    f.render_widget(Paragraph::new(summary).block(summary_block), chunks[0]);

    // Service list — sorted: failed first, then inactive, then active.
    let mut indexed: Vec<usize> = (0..total).collect();
    indexed.sort_by_key(|&i| {
        let st = s.service_status.get(i).map(|(s, _)| s.as_str()).unwrap_or("?");
        match st {
            "failed" => 0,
            "activating" | "deactivating" => 1,
            "inactive" => 2,
            "active" => 3,
            _ => 4,
        }
    });

    let mut rows: Vec<ListItem> = Vec::with_capacity(total + 1);
    rows.push(ListItem::new(Line::styled(
        format!("  {:<28} {:<12} {:<8} {}", "Service", "Status", "Binary", "Notes"),
        Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
    )));
    for i in indexed {
        let svc = &s.backend.services[i];
        let (status, has_bin) = s.service_status.get(i)
            .map(|(s, b)| (s.as_str(), *b))
            .unwrap_or(("?", false));
        let (marker, st_style) = match status {
            "active"   => ("●", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
            "failed"   => ("×", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
            "inactive" => ("○", Style::default().fg(Color::Yellow)),
            "activating" | "deactivating" => ("◐", Style::default().fg(Color::Blue)),
            _          => ("?", Style::default().fg(Color::DarkGray)),
        };
        let (bin, bin_style) = if has_bin {
            ("yes", Style::default().fg(Color::Gray))
        } else {
            ("no", Style::default().fg(Color::Magenta))
        };
        let notes = if !has_bin {
            "binary missing — auto-build will trigger"
        } else if status == "failed" {
            "will be auto-restarted by self-heal"
        } else { "" };
        rows.push(ListItem::new(Line::from(vec![
            Span::styled(format!(" {} ", marker), st_style),
            Span::styled(format!("{:<28} ", svc), Style::default().fg(Color::White)),
            Span::styled(format!("{:<12} ", status), st_style),
            Span::styled(format!("{:<8} ", bin), bin_style),
            Span::styled(notes.to_string(), Style::default().fg(Color::DarkGray)),
        ])));
    }
    let list_block = Block::default().borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(format!(" Services on {} ", s.backend.vm_host));
    f.render_widget(List::new(rows).block(list_block), chunks[1]);
}

fn render_journal(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    // Reuse log buf showing entries that look like journal lines (indented from journalctl)
    let h = area.height.saturating_sub(2) as usize;
    let items: Vec<ListItem> = s.log_buf.iter().rev().take(h).rev()
        .map(|l| ListItem::new(Line::styled(l.as_str(), log_style(l))))
        .collect();
    let block = Block::default().borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Journal ");
    f.render_widget(List::new(items).block(block), area);
}

fn render_commands(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let h = area.height.saturating_sub(2) as usize;
    let total = s.command_log.len();
    let start = total.saturating_sub(h);
    let items: Vec<ListItem> = s.command_log.range(start..)
        .map(|l| {
            let style = if l.starts_with("> ") {
                Style::default().fg(Color::Yellow)
            } else { Style::default().fg(Color::Gray) };
            ListItem::new(Line::styled(l.as_str(), style))
        }).collect();
    let block = Block::default().borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Commands (press / to enter command mode) ");
    f.render_widget(List::new(items).block(block), area);
}

fn render_resources(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let block = Block::default().borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Resources ");
    let inner = block.inner(area);
    f.render_widget(block, area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2),  // cpu gauge
            Constraint::Length(1),  // cpu sub
            Constraint::Length(2),  // ram gauge
            Constraint::Length(1),  // ram sub
            Constraint::Length(2),  // disk gauge
            Constraint::Length(1),  // disk sub
            Constraint::Min(1),     // history sparklines
        ])
        .split(inner);

    let d = &s.resource_data;

    // CPU
    let cpu_pct = d.cpu_percent.clamp(0.0, 100.0) as u16;
    let cpu = Gauge::default()
        .block(Block::default().title("CPU"))
        .gauge_style(Style::default().fg(Color::Cyan))
        .percent(cpu_pct)
        .label(format!("{:.1}%", d.cpu_percent));
    f.render_widget(cpu, chunks[0]);
    let cpu_sub = Paragraph::new(format!(
        "  load {:.2} {:.2} {:.2}    cores {}/{}",
        d.load_1m, d.load_5m, d.load_15m, d.cpu_cores_used, d.cpu_cores_total.max(1)
    )).style(Style::default().fg(Color::DarkGray));
    f.render_widget(cpu_sub, chunks[1]);

    // RAM
    let ram_pct = if d.ram_total_bytes > 0 {
        (d.ram_used_bytes as f64 / d.ram_total_bytes as f64 * 100.0).clamp(0.0, 100.0) as u16
    } else { 0 };
    let ram = Gauge::default()
        .block(Block::default().title("RAM"))
        .gauge_style(Style::default().fg(Color::Magenta))
        .percent(ram_pct)
        .label(format!(
            "{} / {}",
            resources::format_bytes(d.ram_used_bytes),
            resources::format_bytes(d.ram_total_bytes),
        ));
    f.render_widget(ram, chunks[2]);
    let ram_sub = Paragraph::new(format!("  available {}", resources::format_bytes(d.ram_available_bytes)))
        .style(Style::default().fg(Color::DarkGray));
    f.render_widget(ram_sub, chunks[3]);

    // Disk
    let disk_pct = if d.disk_total_bytes > 0 {
        (d.disk_used_bytes as f64 / d.disk_total_bytes as f64 * 100.0).clamp(0.0, 100.0) as u16
    } else { 0 };
    let disk = Gauge::default()
        .block(Block::default().title("Disk"))
        .gauge_style(Style::default().fg(Color::Yellow))
        .percent(disk_pct)
        .label(format!(
            "{} / {}  {}",
            resources::format_bytes(d.disk_used_bytes),
            resources::format_bytes(d.disk_total_bytes),
            d.disk_mount,
        ));
    f.render_widget(disk, chunks[4]);
    let disk_sub = Paragraph::new(format!("  uptime {}", resources::format_uptime(d.uptime_seconds)))
        .style(Style::default().fg(Color::DarkGray));
    f.render_widget(disk_sub, chunks[5]);

    // Sparkline history (CPU + RAM)
    let cpu_spark = resources::render_sparkline(&s.resource_history.cpu, inner.width as usize - 6);
    let ram_spark = resources::render_sparkline(&s.resource_history.ram, inner.width as usize - 6);
    let sparks = Paragraph::new(vec![
        Line::from(vec![Span::styled("CPU ", Style::default().fg(Color::Cyan)), Span::raw(cpu_spark)]),
        Line::from(vec![Span::styled("RAM ", Style::default().fg(Color::Magenta)), Span::raw(ram_spark)]),
    ]);
    f.render_widget(sparks, chunks[6]);
}

fn render_footer(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let line = match &s.mode {
        Mode::Normal => {
            let status: Span = if s.building { Span::styled("● BUILDING", Style::default().fg(Color::Yellow)) }
                else if !s.vm_online { Span::styled("VM offline — press C", Style::default().fg(Color::Red)) }
                else { Span::styled("● idle", Style::default().fg(Color::Green)) };
            Line::from(vec![
                Span::raw(" "), status,
                Span::styled(
                    "   Q=quit  B=build  D=deploy  S=status  H=health  R=resize-build  J=journal  W=watch  L=auto-deploy  /=cmd  Tab=view  ?=help",
                    Style::default().fg(Color::DarkGray),
                ),
            ])
        }
        Mode::Command { input } => Line::from(vec![
            Span::styled(" / ", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
            Span::raw(input.clone()),
            Span::styled("█", Style::default().fg(Color::Yellow)),
        ]),
        Mode::BuildMenu { cursor } => {
            let items = ["All", "Changed", "Select"];
            let mut spans = vec![Span::styled(" Build: ", Style::default().fg(Color::Cyan))];
            for (i, item) in items.iter().enumerate() {
                let style = if i == *cursor {
                    Style::default().fg(Color::Black).bg(Color::Yellow).add_modifier(Modifier::BOLD)
                } else { Style::default().fg(Color::Gray) };
                spans.push(Span::styled(format!(" {} ", item), style));
            }
            spans.push(Span::styled("   ↑↓ Enter Esc", Style::default().fg(Color::DarkGray)));
            Line::from(spans)
        }
        Mode::BuildSelect { cursor, selected } => {
            let mut spans = vec![Span::styled(" Select: ", Style::default().fg(Color::Cyan))];
            for (i, svc) in s.backend.services.iter().enumerate() {
                let mark = if selected.contains(&i) { "✓" } else { " " };
                let style = if i == *cursor {
                    Style::default().fg(Color::Black).bg(Color::Yellow)
                } else if selected.contains(&i) {
                    Style::default().fg(Color::Green)
                } else { Style::default().fg(Color::DarkGray) };
                let label = svc.strip_prefix("iora-").unwrap_or(svc);
                spans.push(Span::styled(format!(" [{mark}]{label}"), style));
            }
            spans.push(Span::styled("  Space=toggle A=all Enter=build Esc=back",
                Style::default().fg(Color::DarkGray)));
            Line::from(spans)
        }
    };
    f.render_widget(Paragraph::new(line), area);
}

fn render_help(f: &mut ratatui::Frame, area: Rect) {
    let w = (area.width / 2).max(50).min(area.width);
    let h = 18u16.min(area.height);
    let x = (area.width - w) / 2;
    let y = (area.height - h) / 2;
    let rect = Rect::new(x, y, w, h);
    f.render_widget(Clear, rect);
    let keys = vec![
        Line::from(""),
        Line::from(Span::styled("  Help — Keybindings", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from("  /          Command mode (then type 'help')"),
        Line::from("  Tab        Cycle view"),
        Line::from("  B          Full rebuild (Rust + FE)"),
        Line::from("  r          Build menu (All/Changed/Select)"),
        Line::from("  D          Deploy binaries"),
        Line::from("  C          Check VM"),
        Line::from("  S          Status view + refresh"),
        Line::from("  J          Journal (last 30 lines of iora-home)"),
        Line::from("  H          Health probe (API + disk)"),
        Line::from("  W          Toggle watch"),
        Line::from("  L          Toggle auto-deploy"),
        Line::from("  R          Resources view"),
        Line::from("  1-9        Restart service by index"),
        Line::from("  ↑↓ PgUp PgDn Home End   Scroll logs"),
        Line::from("  Q / Esc    Quit / close help"),
    ];
    let block = Block::default().borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(" Help ");
    f.render_widget(Paragraph::new(keys).block(block).wrap(Wrap { trim: false }), rect);
}

// ═══ Main loop ═══════════════════════════════════════════════════════════

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    let args = Args::parse();

    let repo_root = find_repo_root()?;
    let workspace = find_workspace(&repo_root)?;
    let frontend_dir = find_frontend(&repo_root);
    let cache_dir = repo_root.join("iora-os/.cache");
    std::fs::create_dir_all(&cache_dir).ok();
    let ssh_key = args.ssh_key.clone().map(PathBuf::from)
        .unwrap_or_else(|| cache_dir.join("iora-dev-key"));
    let services = discover_services(&workspace);

    let backend = Backend {
        vm_host: args.vm_host.clone(),
        vm_port: args.vm_port,
        ssh_key: ssh_key.clone(),
        repo_root: repo_root.clone(),
        vm_workspace: "/home/iora/iora/iora-os/backend".into(),
        frontend_dir: frontend_dir.clone(),
        services: Arc::new(services),
    };

    let auto_deploy = !args.no_deploy;
    let do_watch = !args.no_watch;
    let mut state = AppState::new(backend.clone(), auto_deploy, do_watch);

    // Windows raw mode fix BEFORE crossterm setup
    #[cfg(windows)]
    win_raw_fix::apply();

    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    #[cfg(windows)]
    win_raw_fix::apply();

    let backend_co = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend_co)?;
    terminal.clear()?;

    // Channels
    let (app_tx, mut app_rx) = mpsc::unbounded_channel::<AppEvent>();
    let (conn_tx, mut conn_rx) = mpsc::unbounded_channel::<ConnEvent>();

    // Initial log
    state.push_log(format!("[BRIDGE] Connecting to bridge at {}:{}...", args.vm_host, args.vm_bridge_port));
    state.push_log(format!("[SSH] Opening persistent master session to {}:{}...", args.vm_host, args.vm_port));
    state.push_log(format!("[SYSTEM] {} services discovered", state.backend.services.len()));

    // Connection managers
    let _bridge = if args.vm_bridge_port > 0 {
        Some(BridgeConnection::start(args.vm_host.clone(), args.vm_bridge_port, conn_tx.clone()))
    } else { None };
    let _ssh = SshSession::start(args.vm_host.clone(), args.vm_port, ssh_key.clone(), conn_tx.clone());

    // File watcher
    let _watcher = if state.do_watch {
        Some(start_file_watcher(workspace.clone(), frontend_dir.clone(), app_tx.clone())?)
    } else { None };

    // Initial VM check + optional build
    {
        let backend = state.backend.clone();
        let tx = app_tx.clone();
        let do_build = !args.no_initial_build;
        let auto_deploy_init = state.auto_deploy;
        state.building = do_build;
        if do_build { state.build_start = Some(Instant::now()); state.last_build = "Building...".into(); }
        tokio::spawn(async move {
            let ok = backend.check_vm().await;
            let _ = tx.send(AppEvent::VmReachable(ok));
            if ok {
                let n = backend.refresh_services().await;
                let _ = tx.send(AppEvent::ServiceCount(n));
                let _ = tx.send(AppEvent::Log(format!("[SYSTEM] {} services active", n)));
                if do_build {
                    let _ = tx.send(AppEvent::Log("[SYSTEM] Starting initial build...".into()));
                    backend.build_rust(None, tx.clone()).await;
                    backend.build_frontend(tx.clone(), auto_deploy_init).await;
                    if auto_deploy_init {
                        backend.deploy_binaries(tx.clone()).await;
                    }
                    let _ = tx.send(AppEvent::BuildComplete);
                }
            } else {
                let _ = tx.send(AppEvent::Log(if cfg!(windows) {
                    "[SYSTEM] SSH offline — start the VM with .\\dev-local.ps1, then press C".into()
                } else {
                    "[SYSTEM] SSH offline — start the VM with ./dev-local.sh, then press C".into()
                }));
                if do_build {
                    let _ = tx.send(AppEvent::BuildComplete);
                }
            }
        });
    }

    // Input events: read on a dedicated OS thread using blocking poll/read.
    // This is the most reliable approach on Windows — the thread is fully
    // independent of the tokio scheduler and stdin polling, so keys are
    // always delivered immediately even when the main task is stuck in a
    // blocking `terminal.draw()` write to stdout.
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<CtEvent>();
    {
        let input_tx = input_tx.clone();
        std::thread::Builder::new()
            .name("iora-dev-watch-input".into())
            .spawn(move || {
                loop {
                    match crossterm::event::poll(Duration::from_millis(200)) {
                        Ok(true) => {
                            match crossterm::event::read() {
                                Ok(ev) => {
                                    if input_tx.send(ev).is_err() { return; }
                                }
                                Err(_) => return,
                            }
                        }
                        Ok(false) => continue,
                        Err(_) => return,
                    }
                }
            })
            .ok();
    }
    drop(input_tx);

    // Tickers
    let mut render_tick = interval(Duration::from_millis(RENDER_INTERVAL_MS));
    render_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut health_tick = interval(Duration::from_secs(VM_HEALTH_INTERVAL_S));
    health_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut resource_tick = interval(Duration::from_secs(RESOURCE_INTERVAL_S));
    resource_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut heal_tick = interval(Duration::from_secs(SELF_HEAL_INTERVAL_S));
    heal_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut status_tick = interval(Duration::from_secs(STATUS_REFRESH_INTERVAL_S));
    status_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let health_in_flight = Arc::new(AtomicBool::new(false));
    let resource_in_flight = Arc::new(AtomicBool::new(false));
    let heal_in_flight = Arc::new(AtomicBool::new(false));
    let status_in_flight = Arc::new(AtomicBool::new(false));

    let mut last_render = Instant::now();

    loop {
        tokio::select! {
            biased;

            // 1. Input events (highest priority for responsiveness).
            //    Comes from the dedicated input task; never blocked by
            //    rendering or app-event drains.
            Some(event) = input_rx.recv() => {
                match event {
                    CtEvent::Key(key) if key.kind == KeyEventKind::Press => {
                        handle_key(&mut state, key, &app_tx);
                    }
                    CtEvent::Resize(_, _) => { state.dirty = true; }
                    _ => {}
                }
                // Drain any extra queued key events so a quick burst of keys
                // (paste, key repeat) is processed before we touch any other
                // branch. Bounded to keep the loop turning.
                let mut n = 0;
                while n < 16 {
                    match input_rx.try_recv() {
                        Ok(CtEvent::Key(k)) if k.kind == KeyEventKind::Press => {
                            handle_key(&mut state, k, &app_tx); n += 1;
                        }
                        Ok(CtEvent::Resize(_, _)) => { state.dirty = true; n += 1; }
                        Ok(_) => { n += 1; }
                        Err(_) => break,
                    }
                }
            }

            // 2. App events (drain bounded — fairness vs. input during cargo floods)
            Some(ev) = app_rx.recv() => {
                handle_app_event(&mut state, ev, &app_tx);
                let mut drained = 1;
                while drained < 32 {
                    match app_rx.try_recv() {
                        Ok(more) => { handle_app_event(&mut state, more, &app_tx); drained += 1; }
                        Err(_) => break,
                    }
                }
                // Hand the executor back so crossterm's input task can deliver
                // pending key events even under sustained log floods.
                tokio::task::yield_now().await;
            }

            // 3. Connection events (same bounded drain)
            Some(ev) = conn_rx.recv() => {
                handle_conn_event(&mut state, ev, &app_tx, &heal_in_flight);
                let mut drained = 1;
                while drained < 16 {
                    match conn_rx.try_recv() {
                        Ok(more) => { handle_conn_event(&mut state, more, &app_tx, &heal_in_flight); drained += 1; }
                        Err(_) => break,
                    }
                }
                tokio::task::yield_now().await;
            }

            // 4. Render tick — also bumps the live build-second counter so the
            //    header updates while a build is in flight (no other event source
            //    triggers a dirty flag during quiet phases of the build).
            _ = render_tick.tick() => {
                if state.building { state.dirty = true; }
                if state.dirty && last_render.elapsed() >= Duration::from_millis(RENDER_INTERVAL_MS) {
                    terminal.draw(|f| ui(f, &state))?;
                    state.dirty = false;
                    last_render = Instant::now();
                }
            }

            // 5. Periodic VM health probe
            _ = health_tick.tick() => {
                if !state.building && !health_in_flight.load(Ordering::Relaxed) {
                    health_in_flight.store(true, Ordering::Relaxed);
                    let backend = state.backend.clone();
                    let tx = app_tx.clone();
                    let was_online = state.vm_online;
                    let flag = health_in_flight.clone();
                    tokio::spawn(async move {
                        let ok = backend.check_vm().await;
                        if ok != was_online {
                            let _ = tx.send(AppEvent::VmReachable(ok));
                        }
                        if ok {
                            let n = backend.refresh_services().await;
                            let _ = tx.send(AppEvent::ServiceCount(n));
                        }
                        flag.store(false, Ordering::Relaxed);
                    });
                }
            }

            // 6. Periodic resource probe (only when on Resources view)
            _ = resource_tick.tick() => {
                if state.view == View::Resources && state.vm_online && !resource_in_flight.load(Ordering::Relaxed) {
                    resource_in_flight.store(true, Ordering::Relaxed);
                    let prev = state.resource_data.clone();
                    let backend = state.backend.clone();
                    let tx = app_tx.clone();
                    let flag = resource_in_flight.clone();
                    tokio::spawn(async move {
                        if let Ok(data) = resources::collect_resources(
                            &backend.vm_host, backend.vm_port, &backend.ssh_key, Some(&prev)
                        ).await {
                            let _ = tx.send(AppEvent::Resource(data));
                        }
                        flag.store(false, Ordering::Relaxed);
                    });
                }
            }

            // 7. Periodic self-heal: auto-start bridge, reset failed iora-* units,
            //    warn on low disk. Skipped during builds so we don't compete for SSH.
            _ = heal_tick.tick() => {
                if !state.building && !heal_in_flight.load(Ordering::Relaxed) {
                    heal_in_flight.store(true, Ordering::Relaxed);
                    let backend = state.backend.clone();
                    let tx = app_tx.clone();
                    let flag = heal_in_flight.clone();
                    tokio::spawn(async move {
                        backend.self_heal(tx).await;
                        flag.store(false, Ordering::Relaxed);
                    });
                }
            }

            // 8. Periodic status refresh: when on Status view, refresh per-service
            //    state every 8 s so the page is always live without manual S.
            _ = status_tick.tick() => {
                if state.view == View::Status && state.vm_online && !state.building
                    && !status_in_flight.load(Ordering::Relaxed)
                {
                    status_in_flight.store(true, Ordering::Relaxed);
                    let backend = state.backend.clone();
                    let tx = app_tx.clone();
                    let flag = status_in_flight.clone();
                    tokio::spawn(async move {
                        let st = backend.fetch_service_status().await;
                        let _ = tx.send(AppEvent::ServiceStatus(st));
                        flag.store(false, Ordering::Relaxed);
                    });
                }
            }
        }

        if state.should_quit { break; }
    }

    // Cleanup
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    println!("bye.");
    Ok(())
}

fn handle_app_event(state: &mut AppState, ev: AppEvent, tx: &mpsc::UnboundedSender<AppEvent>) {
    state.dirty = true;
    match ev {
        AppEvent::Log(line) => state.push_log(line),
        AppEvent::BuildComplete => {
            let dur = state.build_start.map(|t| t.elapsed().as_secs()).unwrap_or(0);
            state.building = false;
            state.build_start = None;
            state.last_build = format!("✓ {}s", dur);
            state.push_log(format!("[SYSTEM] Build complete ({}s)", dur));
        }
        AppEvent::VmReachable(ok) => {
            let was = state.vm_online;
            state.vm_online = ok;
            if ok && !was { state.push_log("[VM] Reachable via SSH"); }
            if !ok && was { state.push_log("[VM] No longer reachable"); }
        }
        AppEvent::ServiceCount(n) => state.active_services = n,
        AppEvent::ServiceStatus(s) => {
            state.active_services = s.iter().filter(|(s, _)| s == "active").count();
            state.service_status = s;
            state.last_status_refresh = Some(Instant::now());
        }
        AppEvent::Resource(d) => {
            let cpu = d.cpu_percent;
            let ram_pct = if d.ram_total_bytes > 0 {
                (d.ram_used_bytes as f64 / d.ram_total_bytes as f64 * 100.0).clamp(0.0, 100.0)
            } else { 0.0 };
            state.resource_history.push(cpu, ram_pct);
            state.resource_data = d;
        }
        AppEvent::HealthCheckDone => { /* legacy — flags now self-reset via Arc<AtomicBool> */ }
        AppEvent::AutoBuildMissing(crates) => {
            // Self-heal detected missing binaries on the VM. Kick a build only
            // if we're not already building and the VM is reachable.
            if !state.building && state.vm_online && !crates.is_empty() {
                let names: Vec<String> = crates.iter().cloned().collect();
                state.push_log(format!(
                    "[AUTO-BUILD] Missing on VM: {} — triggering build+deploy",
                    names.join(", ")
                ));
                spawn_build(state, Some(crates), true, false, tx.clone());
            }
        }
        AppEvent::FileChange { rust_crates, frontend } => {
            for c in &rust_crates {
                if c == "__workspace__" { state.changed_rust.clear(); }
                else { state.changed_rust.insert(c.clone()); }
            }
            if frontend { state.changed_fe = true; }

            // Auto-rebuild debounce: at most once every 2 seconds
            let should = state.do_watch && !state.building && state.vm_online && state.auto_deploy
                && (!state.changed_rust.is_empty() || state.changed_fe);
            let debounce_ok = state.last_auto_build_trigger
                .map(|t| t.elapsed() >= Duration::from_secs(2)).unwrap_or(true);
            if should && debounce_ok {
                state.last_auto_build_trigger = Some(Instant::now());
                state.push_log("[WATCH] Changes detected — auto-rebuilding...");
                let only = if !state.changed_rust.is_empty() { Some(state.changed_rust.clone()) } else { None };
                let want_fe = state.changed_fe;
                state.changed_rust.clear();
                state.changed_fe = false;
                spawn_build(state, only, true, want_fe, tx.clone());
            }
        }
    }
}

fn handle_conn_event(
    state: &mut AppState,
    ev: ConnEvent,
    app_tx: &mpsc::UnboundedSender<AppEvent>,
    heal_in_flight: &Arc<AtomicBool>,
) {
    state.dirty = true;
    match ev {
        ConnEvent::Online { build, hostname } => {
            state.bridge_connected = true;
            if !state.vm_online { state.vm_online = true; }
            state.push_log(format!("[BRIDGE] Connected — {hostname} (build {build})"));
        }
        ConnEvent::Offline => {
            let was_connected = state.bridge_connected;
            state.bridge_connected = false;
            if !state.ssh_connected { state.vm_online = false; }
            state.bridge_uptime = 0;
            state.bridge_mem_avail = 0;
            // Only log the *transition* from online → offline. Subsequent
            // retry-loop Offline emits would otherwise spam the log.
            if was_connected {
                state.push_log("[BRIDGE] Connection lost — auto-reconnecting in background...");
                // Kick a self-heal pass right away: most often the bridge
                // service is simply not running yet (fresh VM boot) and a
                // single `systemctl start iora-dev-bridge` fixes everything.
                if !state.building && !heal_in_flight.load(Ordering::Relaxed) {
                    heal_in_flight.store(true, Ordering::Relaxed);
                    let backend = state.backend.clone();
                    let tx = app_tx.clone();
                    let flag = heal_in_flight.clone();
                    tokio::spawn(async move {
                        backend.self_heal(tx).await;
                        flag.store(false, Ordering::Relaxed);
                    });
                }
            }
        }
        ConnEvent::SshOnline => {
            state.ssh_connected = true;
            if !state.vm_online { state.vm_online = true; }
            state.push_log("[SSH] Master session established");
        }
        ConnEvent::SshOffline => {
            state.ssh_connected = false;
            if !state.bridge_connected { state.vm_online = false; }
            state.push_log("[SSH] Master session lost — auto-reconnecting...");
        }
        ConnEvent::Heartbeat { uptime_seconds, mem_available_bytes, .. } => {
            state.bridge_uptime = uptime_seconds;
            state.bridge_mem_avail = mem_available_bytes;
            if !state.bridge_connected {
                state.bridge_connected = true;
                state.vm_online = true;
            }
            // Heartbeats arrive ~every 5s; don't spam the log buffer.
        }
        ConnEvent::Error(msg) => {
            // Suppress chatty reconnect-retry errors once we already know the
            // bridge is offline. The connection manager keeps trying silently;
            // we'll log again only when the next Online transition happens.
            if state.bridge_connected {
                state.push_log(format!("[CONN] {msg}"));
            }
        }
    }
}

// ═══ Windows raw mode fix ════════════════════════════════════════════════
// crossterm 0.28.x does not set ENABLE_EXTENDED_FLAGS on Windows. Without it,
// the console swallows key events on some Windows builds. We force the flag.
#[cfg(windows)]
mod win_raw_fix {
    use std::ffi::c_void;
    const STD_INPUT_HANDLE: u32 = 0xFFFF_FFF6u32; // -10
    const STD_OUTPUT_HANDLE: u32 = 0xFFFF_FFF5u32; // -11
    const DISABLE_NEWLINE_AUTO_RETURN: u32 = 0x0008;
    const ENABLE_EXTENDED_FLAGS: u32 = 0x0080;
    const ENABLE_QUICK_EDIT_MODE: u32 = 0x0040;

    extern "system" {
        fn GetStdHandle(nStdHandle: u32) -> *mut c_void;
        fn GetConsoleMode(hConsoleHandle: *mut c_void, lpMode: *mut u32) -> i32;
        fn SetConsoleMode(hConsoleHandle: *mut c_void, dwMode: u32) -> i32;
    }

    pub fn apply() {
        unsafe {
            let handle = GetStdHandle(STD_INPUT_HANDLE);
            if !handle.is_null() {
                let mut mode: u32 = 0;
                if GetConsoleMode(handle, &mut mode) != 0 {
                    // Minimal intervention: crossterm's `enable_raw_mode()` already
                    // sets up the correct input flags for its event reader. We only
                    // need to *forcefully disable* QUICK_EDIT_MODE: with QuickEdit
                    // on, any mouse click (even accidental) in the console freezes
                    // program output until Enter is pressed, which makes the TUI
                    // feel randomly unresponsive. ENABLE_EXTENDED_FLAGS is the
                    // master switch that has to be on to make the change stick.
                    mode |= ENABLE_EXTENDED_FLAGS;
                    mode &= !ENABLE_QUICK_EDIT_MODE;
                    SetConsoleMode(handle, mode);
                }
            }
            let out = GetStdHandle(STD_OUTPUT_HANDLE);
            if !out.is_null() {
                let mut mode: u32 = 0;
                if GetConsoleMode(out, &mut mode) != 0 {
                    mode |= DISABLE_NEWLINE_AUTO_RETURN;
                    SetConsoleMode(out, mode);
                }
            }
        }
    }
}
