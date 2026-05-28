//! IORA Dev Watch — Build, deploy & monitor the Dev VM.
//! Uses crossterm directly for terminal I/O.
//!
//! Connection architecture:
//!   - HTTP Bridge (port 8101): persistent SSE stream for VM heartbeat/status
//!   - SSH (port 2222): heavy operations only (build, deploy, rsync)
//!   - Auto-reconnect with exponential backoff (1s → 60s max)

mod connection;
mod resources;

use anyhow::{Context, Result};
use clap::Parser;
use connection::{BridgeConnection, ConnEvent, SshSession};
use crossterm::{
    cursor::{Hide, MoveTo, Show},
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind},
    execute, queue,
    style::{Color, Print, ResetColor, SetBackgroundColor, SetForegroundColor},
    terminal::{self, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen},
};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use resources::{ResourceData, ResourceHistory};
use std::{
    collections::{HashSet, VecDeque},
    io::{stdout, Write},
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tokio::process::Command as TokioCommand;

// ═══ Colors ══════════════════════════════════════════════════════════════

const FG_CYAN: Color = Color::Cyan;
const FG_GREEN: Color = Color::Green;
const FG_YELLOW: Color = Color::Yellow;
const FG_RED: Color = Color::Red;
const FG_WHITE: Color = Color::Grey;
const FG_GRAY: Color = Color::DarkGrey;
const FG_MAGENTA: Color = Color::Magenta;
const FG_BLUE: Color = Color::Blue;
const BG_BLACK: Color = Color::Black;
const BG_CYAN: Color = Color::DarkCyan;
const BG_WHITE: Color = Color::Grey;

// ═══ CLI ═════════════════════════════════════════════════════════════════

#[derive(Parser, Debug)]
#[command(name = "iora-dev-watch")]
struct Args {
    #[arg(long)] no_watch: bool,
    #[arg(long)] rust_only: bool,
    #[arg(long)] frontend_only: bool,
    #[arg(long, default_value = "127.0.0.1")] vm_host: String,
    #[arg(long, default_value = "2222")] vm_port: u16,
    #[arg(long)] ssh_key: Option<String>,
    #[arg(long)] no_deploy: bool,
    #[arg(long)] no_initial_build: bool,
    /// Bridge port (iora-dev-bridge, default 8101). Used for persistent
    /// health checks and SSE heartbeats. Set to 0 to disable bridge mode.
    #[arg(long, default_value = "8101")] vm_bridge_port: u16,
}

// ═══ Events ══════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
enum AppEvent {
    BuildOutput(String),
    BuildComplete,
    VmStatus(bool),
    FileChange { rust_crates: HashSet<String>, frontend: bool },
    ServiceStatus(Vec<(String, bool)>),
    ResourceUpdate(ResourceData),
    HealthCheckComplete,
}

// ═══ Modes & Views ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, PartialEq)]
enum View { Logs, Status, Journal, Commands, Resources }

#[derive(Debug, Clone)]
enum Mode {
    Normal,
    Command { input: String, cursor: usize },
    BuildMenu { cursor: usize },
    BuildSelect { cursor: usize, selected: HashSet<usize> },
    Resize { field: ResizeField, value: String, cursor: usize },
}

#[derive(Debug, Clone)]
enum ResizeField { Ram, Cpu, Disk, Confirm }

// ═══ App State ═══════════════════════════════════════════════════════════

struct App {
    vm_host: String, vm_port: u16, vm_bridge_port: u16, ssh_key: PathBuf,
    auto_deploy: bool, do_watch: bool, no_initial_build: bool,
    vm_online: bool, building: bool, last_build: String,
    active_services: usize, total_services: usize,
    view: View, mode: Mode,
    services: Vec<String>,
    service_status: Vec<(String, bool)>,
    should_quit: bool, dirty: bool,
    changed_rust: HashSet<String>, changed_fe: bool,
    repo_root: PathBuf, workspace: PathBuf, vm_workspace: String,
    frontend_dir: Option<PathBuf>, cache_dir: PathBuf,
    show_help: bool,
    log_scroll_offset: usize,
    command_log: VecDeque<String>,
    build_start: Option<Instant>,
    // Bridge connection health
    bridge_uptime: u64,
    bridge_mem_avail: u64,
    bridge_loadavg: String,
    // Independent connection trackers
    ssh_connected: bool,
    bridge_connected: bool,
    // Rate-limit for periodic SSH health checks
    health_check_in_flight: bool,
    // Resource monitoring
    resource_data: ResourceData,
    resource_history: ResourceHistory,
    last_resource_collect: Instant,
}

impl App {
    fn new(args: &Args) -> Result<Self> {
        let repo_root = find_repo_root()?;
        let workspace = find_workspace(&repo_root)?;
        let frontend_dir = find_frontend(&repo_root);
        let cache_dir = repo_root.join("iora-os/.cache");
        std::fs::create_dir_all(&cache_dir).ok();
        let ssh_key = args.ssh_key.clone().map(PathBuf::from)
            .unwrap_or_else(|| cache_dir.join("iora-dev-key"));
        let services = discover_services(&workspace);
        let total = services.len();
        Ok(Self {
            vm_host: args.vm_host.clone(), vm_port: args.vm_port,
            vm_bridge_port: args.vm_bridge_port, ssh_key,
            auto_deploy: !args.no_deploy, do_watch: !args.no_watch,
            no_initial_build: args.no_initial_build,
            vm_online: false, building: false, last_build: "-".into(),
            active_services: 0, total_services: total,
            view: View::Logs, mode: Mode::Normal,
            services, service_status: vec![("?".into(), false); total],
            should_quit: false, dirty: true,
            changed_rust: HashSet::new(), changed_fe: false,
            repo_root, workspace, vm_workspace: "/home/iora/iora/iora-os/backend".into(),
            frontend_dir, cache_dir, show_help: false,
            log_scroll_offset: 0, command_log: VecDeque::with_capacity(200),
            build_start: None,
            bridge_uptime: 0, bridge_mem_avail: 0,
            bridge_loadavg: String::new(),
            ssh_connected: false, bridge_connected: false,
            health_check_in_flight: false,
            resource_data: ResourceData::default(),
            resource_history: ResourceHistory::new(60),
            last_resource_collect: Instant::now(),
        })
    }

    #[cfg(unix)]
    fn ctl_path(&self) -> String {
        let dir = std::path::PathBuf::from("/tmp/iora-ssh");
        let _ = std::fs::create_dir_all(&dir);
        format!("{}/cm-%C", dir.display())
    }

    fn ssh_args(&self) -> Vec<String> {
        let mut args = vec![
            "-o".into(),"StrictHostKeyChecking=no".into(),
            "-o".into(),"IdentitiesOnly=yes".into(),"-o".into(),"LogLevel=ERROR".into(),
            "-o".into(),"ConnectTimeout=10".into(),"-o".into(),"ServerAliveInterval=60".into(),
            "-o".into(),"ServerAliveCountMax=60".into(),"-o".into(),"TCPKeepAlive=yes".into(),
            "-o".into(),"AddressFamily=inet".into(),
        ];
        #[cfg(unix)]
        {
            args.push("-o".into()); args.push("UserKnownHostsFile=/dev/null".into());
        }
        #[cfg(windows)]
        {
            args.push("-o".into()); args.push("UserKnownHostsFile=NUL".into());
        }
        args.push("-i".into()); args.push(self.ssh_key.to_string_lossy().to_string());
        args.push("-p".into()); args.push(self.vm_port.to_string());
        args.push(format!("root@{}",self.vm_host));
        args
    }

    #[allow(dead_code)]
    fn scp_args(&self) -> Vec<String> {
        #[cfg(unix)]
        let ctl = self.ctl_path();

        let mut args = vec![
            "-o".into(),"StrictHostKeyChecking=no".into(),
            "-o".into(),"IdentitiesOnly=yes".into(),"-o".into(),"LogLevel=ERROR".into(),
            "-o".into(),"ConnectTimeout=10".into(),
        ];
        #[cfg(unix)]
        {
            args.push("-o".into()); args.push("UserKnownHostsFile=/dev/null".into());
            args.push("-o".into()); args.push("ControlMaster=auto".into());
            args.push("-o".into()); args.push(format!("ControlPath={}", ctl));
            args.push("-o".into()); args.push("ControlPersist=600".into());
        }
        #[cfg(windows)]
        {
            args.push("-o".into()); args.push("UserKnownHostsFile=NUL".into());
        }
        args.push("-i".into()); args.push(self.ssh_key.to_string_lossy().to_string());
        args.push("-P".into()); args.push(self.vm_port.to_string()); args.push("-q".into());
        args
    }

    async fn ssh_exec(&self, cmd: &str) -> Result<String> {
        let mut args = self.ssh_args(); args.push(cmd.into());
        let result = tokio::time::timeout(Duration::from_secs(60),
            TokioCommand::new("ssh").args(&args).output()).await.context("timeout")?;
        Ok(String::from_utf8_lossy(&result?.stdout).into())
    }

    async fn check_vm(&mut self) -> bool {
        self.vm_online = match self.ssh_exec("echo OK").await {
            Ok(s) => s.contains("OK"),
            Err(_) => false,
        };
        self.vm_online
    }

    async fn refresh_services(&mut self) {
        if !self.vm_online { self.active_services = 0; return; }
        if let Ok(o) = self.ssh_exec(&format!("for s in {}; do systemctl is-active $s 2>/dev/null || echo unknown; done", self.services.join(" "))).await {
            self.active_services = o.lines().filter(|l| *l == "active").count();
        }
    }

    async fn fetch_service_status(&mut self) {
        self.service_status.clear();
        let script = format!(
            "for s in {}; do printf '%s|%s\\n' \"$(systemctl is-active $s 2>/dev/null || echo unknown)\" \"$(test -f /usr/bin/$s && echo yes || echo no)\"; done",
            self.services.join(" "));
        match self.ssh_exec(&script).await {
            Ok(output) => {
                let mut lines = output.lines();
                for _ in &self.services {
                    if let Some(line) = lines.next() {
                        let mut parts = line.splitn(2, '|');
                        let status = parts.next().unwrap_or("?").trim().to_string();
                        let has_bin = parts.next().unwrap_or("no").trim() == "yes";
                        self.service_status.push((status, has_bin));
                    } else {
                        self.service_status.push(("?".into(), false));
                    }
                }
            }
            Err(_) => {
                for _ in &self.services {
                    self.service_status.push(("?".into(), false));
                }
            }
        }
    }

    fn build_rust_cmd(&self, only: Option<&HashSet<String>>) -> String {
        let mut cmd = format!("cd {} && CARGO_BUILD_JOBS=$(nproc) /home/iora/.cargo/bin/cargo build", self.vm_workspace);
        if let Some(crates) = only { for c in crates { cmd.push_str(&format!(" -p {}", c)); } }
        else { cmd.push_str(" --workspace"); }
        cmd
    }

    fn deploy_cmd(&self) -> String {
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
    [ -f "$bin" ] || {{ echo "DEPLOY: skip $svc (not built)"; continue; }}
    short="${{svc#iora-}}"
    cur=$(sha256sum "$bin" | awk '{{print $1}}')
    prev=$(cat "/var/lib/iora/.bin-hashes/$svc" 2>/dev/null)
    if [ "$cur" = "$prev" ] && [ -f "/usr/bin/$svc" ]; then
        echo "DEPLOY: unchanged $svc"
        skipped=$((skipped+1))
        continue
    fi
    install -m 0755 "$bin" "/usr/bin/$svc" || {{ echo "DEPLOY: install FAILED $svc"; continue; }}
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
    echo "DEPLOY: ✓ $svc"
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
echo "DEPLOY_RESULT: deployed=$deployed skipped=$skipped"
"#)
    }

    async fn sync_sources(&self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<()> {
        let _=tx.send(AppEvent::BuildOutput("[RUST] Syncing sources...".into()));
        let ssh_opts:Vec<String>=self.ssh_args().into_iter().rev().skip(1).rev().collect();
        let mut args=vec!["-a".into(),"--delete".into(),
            "--exclude=.git".into(),"--exclude=target".into(),"--exclude=node_modules".into(),
            "--exclude=.cache".into(),"--exclude=buildroot-*".into(),"--exclude=releases".into(),
            "--exclude=*.img".into(),"--exclude=*.qcow2".into(),"--exclude=*.iso".into(),
            "--exclude=.iora-dev".into(),"--exclude=dist".into(),"--exclude=__pycache__".into(),
        ];
        args.push("-e".into()); args.push(format!("ssh {}", ssh_opts.join(" ")));
        args.push(format!("{}/", self.repo_root.display()));
        args.push(format!("root@{}:/home/iora/iora/", self.vm_host));
        let _=TokioCommand::new("rsync").args(&args).status().await;
        let _=self.ssh_exec("chown -R iora:iora /home/iora/iora 2>/dev/null").await;
        Ok(())
    }

    async fn build_rust(&mut self, only: Option<HashSet<String>>, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<bool> {
        let label = if let Some(ref c) = only { format!("{} crates", c.len()) } else { "all".into() };
        let _=tx.send(AppEvent::BuildOutput(format!("──[Rust — {}]──", label)));
        let _=self.ssh_exec("su - iora -c 'test -f /home/iora/.cargo/bin/cargo || curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal' 2>&1").await;
        self.sync_sources(tx).await?;
        let cmd = self.build_rust_cmd(only.as_ref());
        let full = format!("su - iora -c '{}' 2>&1", cmd);
        let _=tx.send(AppEvent::BuildOutput(format!("[RUST] {}", cmd)));
        let ssh_args = self.ssh_args();
        let full_cmd = full;
        let tx2 = tx.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut args = ssh_args;
            args.push(full_cmd);
            let spawn_res = TokioCommand::new("ssh").args(&args)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn();
            if let Ok(mut child) = spawn_res {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let tx_out = tx2.clone();
                let tx_err = tx2.clone();
                let out_task = tokio::spawn(async move {
                    if let Some(s) = stdout {
                        let mut lines = BufReader::new(s).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let _=tx_out.send(AppEvent::BuildOutput(format!("[RUST] {}", line)));
                        }
                    }
                });
                let err_task = tokio::spawn(async move {
                    if let Some(s) = stderr {
                        let mut lines = BufReader::new(s).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let _=tx_err.send(AppEvent::BuildOutput(format!("[RUST] {}", line)));
                        }
                    }
                });
                let _=out_task.await;
                let _=err_task.await;
                let _=child.wait().await;
            }
            let _=tx2.send(AppEvent::BuildComplete);
        });
        self.last_build="Building...".into();
        Ok(true)
    }

    async fn deploy_binaries(&mut self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<()> {
        let _=tx.send(AppEvent::BuildOutput("[DEPLOY] Deploying...".into()));
        let script = self.deploy_cmd();
        let cmd = format!("cat > /tmp/iora-deploy.sh << 'DEPLOYEOF'\n{}\nDEPLOYEOF\nbash /tmp/iora-deploy.sh && rm -f /tmp/iora-deploy.sh", script);
        let _=self.ssh_exec(&cmd).await;
        let _=tx.send(AppEvent::BuildOutput("[DEPLOY] ✓ Done".into()));
        self.refresh_services().await;
        Ok(())
    }

    async fn build_frontend(&mut self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<bool> {
        let fe = match &self.frontend_dir { Some(d) => d.clone(), None => return Ok(false) };
        let _=tx.send(AppEvent::BuildOutput("──[Frontend]──".into()));
        if !fe.join("node_modules").is_dir() {
            let _=tx.send(AppEvent::BuildOutput("[FE] npm install...".into()));
            if !TokioCommand::new("npm").args(["install","--no-audit","--no-fund"]).current_dir(&fe).status().await?.success() {
                let _=tx.send(AppEvent::BuildOutput("[FE] ✗ npm install FAILED".into()));
                return Ok(false);
            }
        }
        let _=tx.send(AppEvent::BuildOutput("[FE] npm run build...".into()));
        let output = TokioCommand::new("npm").args(["run","build"]).current_dir(&fe).output().await?;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if !line.trim().is_empty() { let _=tx.send(AppEvent::BuildOutput(format!("[FE] {}", line))); }
        }
        if output.status.success() {
            let _=tx.send(AppEvent::BuildOutput("[FE] ✓ Build OK".into()));
            self.last_build="✓ FE".into(); self.changed_fe=false;
            if self.auto_deploy && self.vm_online { self.deploy_frontend(tx).await?; }
        } else {
            let _=tx.send(AppEvent::BuildOutput("[FE] ✗ Build FAILED".into()));
        }
        Ok(output.status.success())
    }

    async fn deploy_frontend(&self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<()> {
        if let Some(ref fe) = self.frontend_dir {
            let dist = fe.join("dist"); if !dist.is_dir() { return Ok(()); }
            let remote_unpack = "set -e; mkdir -p /opt/iora/build; \
                tmp=$(mktemp -d /opt/iora/build/.dist-XXXXXX); \
                tar xzf - -C \"$tmp\"; \
                rm -rf /opt/iora/build/dist; \
                mv \"$tmp\" /opt/iora/build/dist; \
                systemctl reload nginx 2>/dev/null || true";
            let mut ssh_args = self.ssh_args();
            ssh_args.push(remote_unpack.into());
            let tar = TokioCommand::new("tar")
                .args(["-czf", "-", "-C", dist.to_str().unwrap(), "."])
                .stdout(std::process::Stdio::piped())
                .spawn();
            if let Ok(mut tar_child) = tar {
                if let Some(tar_out) = tar_child.stdout.take() {
                    #[cfg(unix)]
                    let stdin = std::process::Stdio::from(tar_out.into_owned_fd()?);
                    #[cfg(windows)]
                    let stdin = std::process::Stdio::from(tar_out.into_owned_handle()?);
                    let status = TokioCommand::new("ssh")
                        .args(&ssh_args)
                        .stdin(stdin)
                        .status().await;
                    let _ = tar_child.wait().await;
                    match status {
                        Ok(s) if s.success() => { let _=tx.send(AppEvent::BuildOutput("[FE] ✓ Deployed".into())); }
                        _ => { let _=tx.send(AppEvent::BuildOutput("[FE] ✗ Deploy FAILED".into())); }
                    }
                }
            }
        }
        Ok(())
    }

    async fn restart_service(&mut self, svc: &str) -> String {
        let cmd = format!("systemctl reset-failed {} 2>/dev/null; systemctl restart {} 2>/dev/null || systemctl start {} 2>/dev/null || true; sleep 1; systemctl is-active {} 2>/dev/null | tr -d '\\n'", svc, svc, svc, svc);
        self.ssh_exec(&cmd).await.unwrap_or_else(|_| "?".into())
    }

    fn run_command(&mut self, input: &str, log_buf: &mut Vec<String>, tx: &mpsc::UnboundedSender<AppEvent>) {
        let parts: Vec<&str> = input.trim().split_whitespace().collect();
        if parts.is_empty() { return; }
        match parts[0] {
            "build"|"b" => {
                let mut rust=true; let mut fe=true; let mut changed=false;
                let mut i=1; while i<parts.len() {
                    match parts[i] { "rust"|"r"=>{fe=false;i+=1;} "fe"|"frontend"|"f"=>{rust=false;i+=1;}
                    "changed"|"c"=>{changed=true;i+=1;} "all"|"a"=>{i+=1;}
                    _=>{push_log(log_buf, "[CMD] unknown arg"); return;} }
                }
                if self.building { push_log(log_buf, "[CMD] Already building"); return; }
                if !self.vm_online { push_log(log_buf, "[CMD] VM offline"); return; }
                self.building=true; self.dirty=true;
                let only = if changed && !self.changed_rust.is_empty() { Some(self.changed_rust.clone()) } else { None };
                let tx2=tx.clone(); let (vmh,vmp,sk)=(self.vm_host.clone(),self.vm_port,self.ssh_key.clone());
                let (ws,vmws)=(self.workspace.clone(),self.vm_workspace.clone());
                let (rr,cd,fe2)=(self.repo_root.clone(),self.cache_dir.clone(),self.frontend_dir.clone());
                let svcs=self.services.clone();
                tokio::spawn(async move {
                        let mut a = App::dummy(vmh,vmp,sk,ws,vmws,fe2,rr,cd,svcs);
                        a.vm_online=true;
                        if rust { let _=a.build_rust(only,&tx2).await; }
                        if fe { let _=a.build_frontend(&tx2).await; }
                        let _=tx2.send(AppEvent::BuildComplete);
                    });
            }
            "deploy"|"d" => {
                if !self.vm_online { push_log(log_buf, "[CMD] VM offline"); return; }
                let tx2=tx.clone(); let (vmh,vmp,sk)=(self.vm_host.clone(),self.vm_port,self.ssh_key.clone());
                let (ws,vmws)=(self.workspace.clone(),self.vm_workspace.clone());
                let (rr,cd,fe2)=(self.repo_root.clone(),self.cache_dir.clone(),self.frontend_dir.clone());
                let svcs=self.services.clone();
                tokio::spawn(async move {
                        let mut a=App::dummy(vmh,vmp,sk,ws,vmws,fe2,rr,cd,svcs);
                        a.vm_online=true; let _=a.deploy_binaries(&tx2).await;
                    });
            }
            "restart"|"r" => {
                if parts.len()<2 { push_log(log_buf, "[CMD] Usage: restart <service>"); return; }
                let svc=parts[1].to_string();
                let (vmh,vmp,sk)=(self.vm_host.clone(),self.vm_port,self.ssh_key.clone());
                let (ws,vmws)=(self.workspace.clone(),self.vm_workspace.clone());
                let (rr,cd,fe2)=(self.repo_root.clone(),self.cache_dir.clone(),self.frontend_dir.clone());
                let svcs=self.services.clone();
                tokio::spawn(async move {
                        let mut a=App::dummy(vmh,vmp,sk,ws,vmws,fe2,rr,cd,svcs);
                        a.vm_online=true;
                        let _st = a.restart_service(&svc).await;
                    });
            }
            "journal"|"j" => { self.view=View::Journal; self.dirty=true; }
            "status"|"s" => { self.view=View::Status; self.dirty=true; }
            "logs"|"l" => { self.view=View::Logs; self.dirty=true; }
            "commands"|"cmd" => { self.view=View::Commands; self.dirty=true; }
            "connect"|"c" => {
                let (vmh,vmp,sk)=(self.vm_host.clone(),self.vm_port,self.ssh_key.clone());
                let (ws,vmws)=(self.workspace.clone(),self.vm_workspace.clone());
                let (rr,cd,fe2)=(self.repo_root.clone(),self.cache_dir.clone(),self.frontend_dir.clone());
                let svcs=self.services.clone();
                tokio::spawn(async move {
                        let mut a=App::dummy(vmh,vmp,sk,ws,vmws,fe2,rr,cd,svcs);
                        a.vm_online=true; a.check_vm().await;
                    });
            }
            "watch" => {
                self.do_watch = parts.get(1).map_or(true, |&w| w!="off");
                push_log(log_buf, &format!("[CMD] Watching: {}", if self.do_watch {"ON"} else {"OFF"}));
            }
            "deploy-toggle"|"dt" => {
                self.auto_deploy=!self.auto_deploy; self.dirty=true;
                push_log(log_buf, &format!("[CMD] Auto-deploy: {}", if self.auto_deploy{"ON"}else{"OFF"}));
            }
            "quit"|"q"|"exit" => { self.should_quit=true; }
            "help"|"?" => {
                push_log(log_buf, "[CMD] build [rust|fe|changed] | deploy | restart <s> | journal | status | logs | commands | connect | watch [on|off] | deploy-toggle | quit");
            }
            _ => { push_log(log_buf, &format!("[CMD] Unknown: {} (type help)", parts[0])); }
        }
    }

    fn dummy(vm_host: String, vm_port: u16, ssh_key: PathBuf, workspace: PathBuf, vm_workspace: String,
             frontend_dir: Option<PathBuf>, repo_root: PathBuf, cache_dir: PathBuf, services: Vec<String>) -> Self {
        let total = services.len();
        Self {
            vm_host, vm_port, vm_bridge_port: 8101, ssh_key,
            auto_deploy: true, do_watch: false, no_initial_build: true,
            vm_online: false, building: false, last_build: "-".into(),
            active_services: 0, total_services: total,
            view: View::Logs, mode: Mode::Normal,
            services, service_status: vec![("?".into(), false); total],
            should_quit: false, dirty: true,
            changed_rust: HashSet::new(), changed_fe: false,
            repo_root, workspace, vm_workspace, frontend_dir, cache_dir,
            show_help: false,
            log_scroll_offset: 0, command_log: VecDeque::with_capacity(200),
            build_start: None,
            bridge_uptime: 0, bridge_mem_avail: 0,
            bridge_loadavg: String::new(),
            ssh_connected: false, bridge_connected: false,
            health_check_in_flight: false,
            resource_data: ResourceData::default(),
            resource_history: ResourceHistory::new(60),
            last_resource_collect: Instant::now(),
        }
    }
}

// ═══ Helpers ═════════════════════════════════════════════════════════════

fn push_log(buf: &mut Vec<String>, msg: &str) {
    buf.push(msg.to_string());
    if buf.len() > 5000 { buf.remove(0); }
}

fn find_repo_root() -> Result<PathBuf> {
    if let Ok(o) = std::process::Command::new("git").args(["rev-parse","--show-toplevel"]).output() {
        if o.status.success() { return Ok(PathBuf::from(String::from_utf8_lossy(&o.stdout).trim())); }
    }
    for a in std::env::current_exe()?.ancestors() {
        if a.join("iora-os/backend/Cargo.toml").exists() || a.join("backend/Cargo.toml").exists() { return Ok(a.into()); }
    }
    anyhow::bail!("no repo root")
}
fn find_workspace(r: &PathBuf) -> Result<PathBuf> {
    for c in &[r.join("iora-os/backend"), r.join("backend")] { if c.join("Cargo.toml").exists() { return Ok(c.clone()); } }
    anyhow::bail!("no workspace")
}
fn find_frontend(r: &PathBuf) -> Option<PathBuf> {
    for d in &["frontend","desktop"] { let p = r.join(d); if p.join("package.json").exists() { return Some(p); } }
    None
}
fn discover_services(w: &PathBuf) -> Vec<String> {
    let mut v=Vec::new();
    for sub in &["services","tools","apps/system","dev"] {
        let b=w.join(sub); if !b.is_dir(){continue;}
        if let Ok(e)=std::fs::read_dir(&b){for en in e.flatten(){let p=en.path();
            if p.is_dir()&&p.join("Cargo.toml").exists(){if let Some(n)=p.file_name().and_then(|n|n.to_str()){
                if n.starts_with("iora-")&&n!="iora-dev-watch"{v.push(n.into());}}}}
    }}
    v.sort();v.dedup();v
}

fn start_file_watcher(workspace: PathBuf, fe: Option<PathBuf>, tx: mpsc::UnboundedSender<AppEvent>) -> Result<RecommendedWatcher> {
    let dirs: Vec<PathBuf> = ["services","shared","tools","apps","dev"].iter()
        .map(|s|workspace.join(s)).filter(|p|p.is_dir()).collect();
    let mut w: RecommendedWatcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Modify(_)|EventKind::Create(_)) {
                let mut rust=HashSet::new(); let mut frontend=false;
                for p in &ev.paths {
                    let s=p.to_string_lossy();
                    if s.contains("iora-dev-watch") { continue; }
                    if s.ends_with(".rs") {
                        for c in p.components().rev() {
                            let cn=c.as_os_str().to_string_lossy();
                            if cn.starts_with("iora-") { rust.insert(cn.to_string()); break; }
                        }
                    }
                    if s.contains("Cargo.toml")||s.contains("Cargo.lock") { rust.insert("__workspace__".into()); }
                    if s.ends_with(".tsx")||s.ends_with(".ts")||s.ends_with(".jsx")||s.ends_with(".css")||s.ends_with(".html") { frontend=true; }
                }
                if !rust.is_empty()||frontend { let _=tx.send(AppEvent::FileChange{rust_crates:rust,frontend}); }
            }
        }
    })?;
    w.configure(Config::default().with_poll_interval(Duration::from_secs(2)))?;
    for d in &dirs { let _=w.watch(d, RecursiveMode::Recursive); }
    if let Some(f) = &fe {
        for s in &["src","public"] { let d=f.join(s); if d.is_dir() { let _=w.watch(&d, RecursiveMode::Recursive); } }
    }
    Ok(w)
}

// ═══ Rendering ═══════════════════════════════════════════════════════════

fn render_header(out: &mut impl Write, app: &App, w: u16) -> Result<()> {
    if w < 40 { return Ok(()); }
    let sep = "═".repeat(w.saturating_sub(2) as usize);
    queue!(out,
        MoveTo(0, 0), SetForegroundColor(FG_CYAN), SetBackgroundColor(BG_BLACK),
        Print(format!("╔{}╗", sep)),
        MoveTo(0, 1), Print(format!("║ {:<width$} ║", "IORA Dev Watch", width = w as usize - 4)),
    )?;

    let vm_label = if app.vm_online { "● online" } else { "● offline" };
    let vm_fg = if app.vm_online { FG_GREEN } else { FG_RED };
    let bridge_indicator = if app.bridge_connected { "B" } else { "·" };
    let _bridge_fg = if app.bridge_connected { FG_GREEN } else { FG_GRAY };
    let ssh_indicator = if app.ssh_connected { "S" } else { "·" };
    let _ssh_fg = if app.ssh_connected { FG_GREEN } else { FG_GRAY };
    let bridge_info = if app.bridge_connected && app.bridge_uptime > 0 {
        let mem_gb = app.bridge_mem_avail as f64 / 1_073_741_824.0;
        format!("  ↑{}m  free {:.1}G", app.bridge_uptime / 60, mem_gb)
    } else { String::new() };
    let dep_label = if app.auto_deploy { "ON " } else { "OFF" };
    let dep_fg = if app.auto_deploy { FG_GREEN } else { FG_RED };
    let bl_label = if app.building {
        if let Some(start) = app.build_start {
            format!("Building  {}s", start.elapsed().as_secs())
        } else { "Building...".into() }
    } else { app.last_build.clone() };

    // Row 2: build line segments piece by piece
    queue!(out,
        MoveTo(0, 2), SetForegroundColor(FG_WHITE), SetBackgroundColor(BG_BLACK),
        Print(format!("║ VM: ")),
    )?;
    queue!(out, SetForegroundColor(vm_fg), Print(vm_label))?;
    let mut x = 7u16 + vm_label.len() as u16;
    queue!(out, MoveTo(x, 2), SetForegroundColor(FG_GRAY),
        Print(format!(" [{}{}{}]", bridge_indicator, "|", ssh_indicator)),
    )?;
    x += 4;
    if !bridge_info.is_empty() {
        queue!(out, MoveTo(x, 2), Print(&bridge_info))?;
        x += bridge_info.len() as u16;
    }
    queue!(out, MoveTo(x, 2), SetForegroundColor(FG_WHITE),
        Print("  │  Build: "))?;
    x += 12;
    queue!(out, SetForegroundColor(FG_CYAN), Print(&bl_label))?;
    x += bl_label.len() as u16;
    queue!(out, MoveTo(x, 2), SetForegroundColor(FG_WHITE),
        Print("  │  Deploy: "))?;
    x += 13;
    queue!(out, SetForegroundColor(dep_fg), Print(dep_label))?;
    x += dep_label.len() as u16;
    // Fill remaining space
    if x < w - 1 {
        let pad = " ".repeat((w - 1 - x) as usize);
        queue!(out, MoveTo(x, 2), SetForegroundColor(FG_WHITE), Print(&pad),
            MoveTo(w - 1, 2), SetForegroundColor(FG_CYAN), Print("║"))?;
    }

    // Separator
    queue!(out,
        MoveTo(0, 3), SetForegroundColor(FG_CYAN),
        Print(format!("╠{}╣", sep)),
        ResetColor,
    )?;
    Ok(())
}

fn render_tabs(out: &mut impl Write, app: &App, _w: u16) -> Result<()> {
    let tabs = [" Logs ", " Status ", " Journal ", " Commands ", " Resources "];
    let mut x = 1u16;
    for (i, label) in tabs.iter().enumerate() {
        let active = match (&app.view, i) {
            (View::Logs, 0) | (View::Status, 1) | (View::Journal, 2)
                | (View::Commands, 3) | (View::Resources, 4) => true,
            _ => false,
        };
        queue!(out, MoveTo(x, 4))?;
        if active {
            queue!(out, SetForegroundColor(BG_BLACK), SetBackgroundColor(BG_CYAN), Print(*label))?;
        } else {
            queue!(out, SetForegroundColor(FG_GRAY), SetBackgroundColor(BG_BLACK), Print(*label))?;
        }
        x += label.len() as u16;
    }
    queue!(out, ResetColor)?;
    Ok(())
}

fn render_logs(out: &mut impl Write, app: &App, log_buf: &[String], w: u16, h: u16) -> Result<()> {
    let content_h = h.saturating_sub(7).max(1) as usize;
    // Add 1 extra because the last line might be partial
    let total = log_buf.len().saturating_sub(app.log_scroll_offset);
    let start = total.saturating_sub(content_h + 1);
    let visible: Vec<&String> = log_buf.iter().skip(start).take(content_h + 1).collect();

    for (i, line) in visible.iter().enumerate() {
        let y = 5u16 + i as u16;
        if y >= h.saturating_sub(2) { break; }
        let trunc: String = line.chars().take(w as usize).collect();
        let color = log_color(line);
        queue!(out, MoveTo(0, y), SetForegroundColor(color), SetBackgroundColor(BG_BLACK),
            Print(&trunc), Print(" ".repeat(w.saturating_sub(trunc.len() as u16) as usize)),
        )?;
    }
    // Scroll indicator
    if app.log_scroll_offset > 0 {
        let ind = format!("[↑{} | 0=bottom]", app.log_scroll_offset);
        let x = w.saturating_sub(ind.len() as u16 + 1);
        queue!(out, MoveTo(x, 5), SetForegroundColor(FG_YELLOW), SetBackgroundColor(BG_BLACK), Print(&ind))?;
    }
    queue!(out, ResetColor)?;
    Ok(())
}

fn log_color(msg: &str) -> Color {
    if msg.len() > 12 {
        let prefix = &msg[..12];
        if prefix.contains("[RUST]")||prefix.contains("[DEPLOY]") { FG_MAGENTA }
        else if prefix.contains("[FE]")||prefix.contains("[SYSTEM]") { FG_CYAN }
        else if prefix.contains("[CMD]")||prefix.contains("[RESTART]")||prefix.contains("[WATCH]") { FG_YELLOW }
        else if prefix.contains("[HEALTH]")||prefix.contains("[STATUS]") { FG_BLUE }
        else if msg.contains("✓")||msg.contains("OK") { FG_GREEN }
        else if msg.contains("✗")||msg.contains("FAILED") { FG_RED }
        else if msg.contains("──") { FG_CYAN }
        else { FG_WHITE }
    } else { FG_WHITE }
}

fn render_status_view(out: &mut impl Write, app: &App, _w: u16, h: u16) -> Result<()> {
    let mut y = 5u16;
    let skip = app.log_scroll_offset;
    queue!(out,
        MoveTo(1, y), SetForegroundColor(FG_CYAN), SetBackgroundColor(BG_BLACK),
        Print(format!("{:<30} {:<10} {}", "Service", "Status", "Binary")),
    )?;
    y += 1;
    queue!(out, MoveTo(1, y), SetForegroundColor(FG_GRAY), Print("─".repeat(50)))?;
    y += 1;
    for (i, svc) in app.services.iter().enumerate().skip(skip) {
        if y >= h - 2 { break; }
        let (status, has_bin) = app.service_status.get(i).map_or(("?", false), |(s,b)| (s.as_str(), *b));
        let status_fg = if status == "active" { FG_GREEN } else if status == "failed" { FG_RED } else { FG_GRAY };
        let bin_text = if has_bin { "yes" } else { "no" };
        queue!(out,
            MoveTo(1, y), SetForegroundColor(FG_WHITE), SetBackgroundColor(BG_BLACK),
            Print(format!("{:<30} ", svc)),
            SetForegroundColor(status_fg), Print(format!("{:<10} ", status)),
            SetForegroundColor(FG_WHITE), Print(bin_text),
        )?;
        y += 1;
    }
    queue!(out, ResetColor)?;
    Ok(())
}

fn render_commands_view(out: &mut impl Write, app: &App, w: u16, h: u16) -> Result<()> {
    let max = (h.saturating_sub(7)).max(1) as usize;
    let start = app.command_log.len().saturating_sub(max)
        .saturating_add(app.log_scroll_offset)
        .min(app.command_log.len().saturating_sub(1));
    let mut y = 5u16;
    for line in app.command_log.iter().skip(start).take(max) {
        let t = if line.len() > w as usize { format!("{}…", &line[..w as usize - 1]) } else { line.clone() };
        let fg = if line.starts_with("> ") { FG_YELLOW } else { FG_WHITE };
        queue!(out, MoveTo(1, y), SetForegroundColor(fg), SetBackgroundColor(BG_BLACK), Print(&t))?;
        y += 1;
    }
    if app.command_log.is_empty() {
        queue!(out, MoveTo(1, 5), SetForegroundColor(FG_GRAY), Print("(commands will appear here — press / to enter command mode)"))?;
    }
    queue!(out, ResetColor)?;
    Ok(())
}

fn render_journal_view(out: &mut impl Write, _app: &App, _w: u16, _h: u16) -> Result<()> {
    queue!(out, MoveTo(1, 5), SetForegroundColor(FG_GRAY), SetBackgroundColor(BG_BLACK),
        Print("(journal will appear here when data streams)"),
        ResetColor,
    )?;
    Ok(())
}

fn render_resources_view(out: &mut impl Write, app: &App, w: u16, _h: u16) -> Result<()> {
    let bar_w = (w as usize).saturating_sub(30).min(50).max(10);
    let d = &app.resource_data;
    let mut y: u16 = 5;

    // CPU
    queue!(out,
        MoveTo(1, y), SetForegroundColor(FG_CYAN), SetBackgroundColor(BG_BLACK),
        Print("── CPU ───────────────────────────────────"),
        ResetColor,
    )?;
    y += 1;
    let bar = resources::render_bar(d.cpu_percent, bar_w);
    queue!(out, MoveTo(1, y), SetForegroundColor(FG_WHITE), SetBackgroundColor(BG_BLACK),
        Print(format!("  [{bar}] {:>5.1}%", d.cpu_percent)),
        ResetColor,
    )?;
    y += 1;
    queue!(out, MoveTo(1, y), SetForegroundColor(FG_GRAY),
        Print(format!("  Load: {:.2} {:.2} {:.2}   Cores: {}/{}",
            d.load_1m, d.load_5m, d.load_15m, d.cpu_cores_used, d.cpu_cores_total.max(1))),
        ResetColor,
    )?;
    y += 2;

    // RAM
    queue!(out,
        MoveTo(1, y), SetForegroundColor(FG_CYAN),
        Print("── RAM ───────────────────────────────────"),
        ResetColor,
    )?;
    y += 1;
    let ram_pct = if d.ram_total_bytes > 0 {
        (d.ram_used_bytes as f64 / d.ram_total_bytes as f64 * 100.0).clamp(0.0, 100.0)
    } else { 0.0 };
    let bar = resources::render_bar(ram_pct, bar_w);
    queue!(out, MoveTo(1, y), SetForegroundColor(FG_WHITE),
        Print(format!("  [{bar}] {:>5.1}%", ram_pct)),
        ResetColor,
    )?;
    Ok(())
}

fn render_help_overlay(out: &mut impl Write, w: u16) -> Result<()> {
    let bx = 4u16; let by = 3u16;
    let bw = (w - 8) as usize;
    let sep = "─".repeat(bw.saturating_sub(2));
    queue!(out,
        MoveTo(bx, by), SetForegroundColor(FG_CYAN), SetBackgroundColor(BG_BLACK),
        Print(format!("┌{}┐", sep)),
    )?;
    queue!(out,
        MoveTo(bx, by + 1),
        Print(format!("│ {:<width$} │", "Help — Keybindings", width = bw - 4)),
    )?;
    let keys = [
        ("/","Cmd mode"),("Tab","Switch"),("B","Rebuild"),
        ("D","Deploy"),("C","Connect"),("S","Status"),
        ("H","Health"),("L","Toggle deploy"),("↑↓","Scroll"),
        ("Q","Quit"),("?","Help"),
    ];
    for (i, (key, desc)) in keys.iter().enumerate() {
        queue!(out,
            MoveTo(bx, by + 3 + i as u16),
            Print(format!("│  {:<6} {:<width$} │", key, desc, width = bw - 13)),
        )?;
    }
    queue!(out,
        MoveTo(bx, by + 3 + keys.len() as u16),
        Print(format!("└{}┘", sep)),
        ResetColor,
    )?;
    Ok(())
}

fn render_resize_overlay(out: &mut impl Write, app: &App, w: u16) -> Result<()> {
    if !matches!(&app.mode, Mode::Resize { .. }) { return Ok(()); }
    let bx = 6u16; let by = 5u16;
    let bw = (w - 12) as usize;
    let sep = "─".repeat(bw.saturating_sub(2));
    queue!(out,
        MoveTo(bx, by), SetForegroundColor(FG_CYAN), SetBackgroundColor(BG_BLACK),
        Print(format!("┌{}┐", sep)),
        MoveTo(bx, by + 1), Print(format!("│ {:<width$} │", "Resource Adjustment (requires VM restart)", width = bw - 4)),
    )?;
    if let Mode::Resize { field, value, .. } = &app.mode {
        let ram_fg = if matches!(field, ResizeField::Ram) { FG_YELLOW } else { FG_GRAY };
        let cpu_fg = if matches!(field, ResizeField::Cpu) { FG_YELLOW } else { FG_GRAY };
        queue!(out,
            MoveTo(bx + 2, by + 3), SetForegroundColor(ram_fg), Print("  RAM (MB)"),
            MoveTo(bx + 2, by + 4), SetForegroundColor(cpu_fg), Print("  CPU Cores"),
            MoveTo(bx + 2, by + 6), SetForegroundColor(FG_WHITE),
            Print(format!("  [{value}]")),
        )?;
    }
    queue!(out,
        MoveTo(bx, by + 8),
        Print(format!("└{}┘", sep)),
        ResetColor,
    )?;
    Ok(())
}

fn render_footer(out: &mut impl Write, app: &App, w: u16, h: u16) -> Result<()> {
    if h < 3 { return Ok(()); }
    let y = h - 2;
    let mode_text = match &app.mode {
        Mode::Normal => {
            let status = if app.building { "● BUILDING..." } else if !app.vm_online { "VM offline — press C" } else { "● idle" };
            let status_fg = if app.building { FG_YELLOW } else if !app.vm_online { FG_RED } else { FG_GREEN };
            queue!(out, MoveTo(0, y), SetForegroundColor(FG_GRAY), SetBackgroundColor(BG_BLACK),
                Print(" ".repeat(w as usize)),
                MoveTo(2, y), SetForegroundColor(status_fg), Print(status),
                SetForegroundColor(FG_GRAY),
                Print(format!("  │  {}/{} active  │  Q=quit B=build S=status H=health /=cmd Tab=view",
                    app.active_services, app.total_services)),
            )?;
            String::new()
        }
        Mode::Command { input, .. } => { format!("  / {}", input) }
        Mode::BuildMenu { cursor } => {
            let items = ["[All]", "[Changed]", "[Select]"];
            let mut s = "  Build: ".to_string();
            for (i, item) in items.iter().enumerate() {
                if i == *cursor { s.push_str(&format!("[{}] ", item)); }
                else { s.push_str(&format!(" {}  ", item)); }
            }
            s.push_str(" ↑↓=nav Enter=confirm Esc=cancel");
            s
        }
        Mode::BuildSelect { cursor: _, selected } => {
            let mut s = "  Select: ".to_string();
            for (i, svc) in app.services.iter().enumerate() {
                let mark = if selected.contains(&i) { "✓" } else { " " };
                s.push_str(&format!(" [{}]{}", mark, &svc[5..]));
            }
            s.push_str("  Space=toggle A=all Enter=build Esc=back");
            s
        }
        Mode::Resize { field, .. } => {
            let labels = ["RAM (MB)", "CPU Cores", "Disk (GB)", "Confirm"];
            let idx = match field {
                ResizeField::Ram => 0, ResizeField::Cpu => 1,
                ResizeField::Disk => 2, ResizeField::Confirm => 3,
            };
            format!("  Resize: {}  ↑↓=select Enter=edit/confirm Esc=cancel", labels[idx])
        }
    };
    if !mode_text.is_empty() {
        queue!(out, MoveTo(0, y), SetForegroundColor(FG_GRAY), SetBackgroundColor(BG_BLACK),
            Print(&mode_text),
        )?;
    }
    queue!(out, ResetColor)?;
    Ok(())
}

fn render_all(out: &mut impl Write, app: &App, log_buf: &[String]) -> Result<()> {
    let (w, h) = terminal::size()?;
    // Clear full screen first
    execute!(out, Clear(ClearType::All))?;

    render_header(out, app, w)?;
    render_tabs(out, app, w)?;

    // Clear content area
    for y in 5..h.saturating_sub(2) {
        queue!(out, MoveTo(0, y), SetBackgroundColor(BG_BLACK),
            Print(" ".repeat(w as usize)),
        )?;
    }

    match app.view {
        View::Logs => render_logs(out, app, log_buf, w, h)?,
        View::Status => render_status_view(out, app, w, h)?,
        View::Journal => render_journal_view(out, app, w, h)?,
        View::Commands => render_commands_view(out, app, w, h)?,
        View::Resources => render_resources_view(out, app, w, h)?,
    }

    render_footer(out, app, w, h)?;

    if app.show_help { render_help_overlay(out, w)?; }
    render_resize_overlay(out, app, w)?;

    out.flush()?;
    Ok(())
}

// ═══ Main ════════════════════════════════════════════════════════════════

fn main() -> Result<()> {
    let rt = tokio::runtime::Runtime::new()?;
    let _guard = rt.enter();

    let args = Args::parse();
    let mut app = App::new(&args)?;

    // Windows raw mode fix BEFORE terminal setup (sets ENABLE_EXTENDED_FLAGS)
    #[cfg(windows)]
    let _mode_before = win_raw_fix::apply_and_report();

    // Setup crossterm terminal
    terminal::enable_raw_mode()?;

    // Re-apply AFTER enable_raw_mode() — crossterm 0.28.1 may incorrectly
    // clear flags we need. This is a belt-and-suspenders approach.
    #[cfg(windows)]
    let _mode_after = win_raw_fix::apply_and_report();
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen, Hide, Clear(ClearType::All))?;

    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AppEvent>();
    let (conn_tx, mut conn_rx) = mpsc::unbounded_channel::<ConnEvent>();
    let mut log_buf: Vec<String> = Vec::new();

    // Start bridge
    push_log(&mut log_buf, &format!("[BRIDGE] Connecting to bridge at {}:{}...", app.vm_host, app.vm_bridge_port));
    let _bridge = if app.vm_bridge_port > 0 {
        Some(BridgeConnection::start(app.vm_host.clone(), app.vm_bridge_port, conn_tx.clone()))
    } else { None };

    // Start SSH master
    push_log(&mut log_buf, &format!("[SSH] Opening persistent master session to {}:{}...", app.vm_host, app.vm_port));
    let _ssh_session = SshSession::start(app.vm_host.clone(), app.vm_port, app.ssh_key.clone(), conn_tx.clone());

    // File watcher
    let _watcher = if app.do_watch {
        Some(start_file_watcher(app.workspace.clone(), app.frontend_dir.clone(), event_tx.clone())?)
    } else { None };

    push_log(&mut log_buf, "[SYSTEM] IORA Dev Watch ready. Checking VM...");
    render_all(&mut stdout, &app, &log_buf)?;

    // Initial VM check + initial build
    let tx = event_tx.clone();
    let (vmh, vmp, sk) = (app.vm_host.clone(), app.vm_port, app.ssh_key.clone());
    let (ws, vmws) = (app.workspace.clone(), app.vm_workspace.clone());
    let (rr, cd, fe) = (app.repo_root.clone(), app.cache_dir.clone(), app.frontend_dir.clone());
    let svcs = app.services.clone();
    let do_build = !app.no_initial_build;
    let bridge_port = app.vm_bridge_port;
    tokio::spawn(async move {
        let mut a = App::dummy(vmh.clone(), vmp, sk.clone(), ws, vmws, fe, rr, cd, svcs);
        if bridge_port > 0 {
            if let Ok(()) = connection::health_check(&vmh, bridge_port).await {
                let _ = tx.send(AppEvent::BuildOutput(format!("[BRIDGE] Bridge responsive at {}:{}", vmh, bridge_port)));
            }
        }
        if a.check_vm().await {
            let _ = tx.send(AppEvent::VmStatus(true));
            let _ = tx.send(AppEvent::BuildOutput(format!("[SYSTEM] SSH to {}:{} OK", vmh, vmp)));
            a.refresh_services().await;
            let _ = tx.send(AppEvent::BuildOutput(format!("[SYSTEM] {}/{} services active", a.active_services, a.total_services)));
            if do_build {
                let _ = tx.send(AppEvent::BuildOutput("[SYSTEM] Starting initial build...".into()));
                let _ = a.build_rust(None, &tx).await;
                let _ = a.build_frontend(&tx).await;
                if a.auto_deploy {
                    let _ = a.deploy_binaries(&tx).await;
                }
                let _ = tx.send(AppEvent::BuildComplete);
            }
        } else {
            let _ = tx.send(AppEvent::VmStatus(false));
            let _ = tx.send(AppEvent::BuildOutput(if cfg!(windows) {
                "[SYSTEM] SSH offline — start with .\\dev-local.ps1, then press C".into()
            } else {
                "[SYSTEM] SSH offline — start with ./dev-local.sh, then press C".into()
            }));
        }
    });

    let mut last_vm_check = Instant::now();
    let loop_tx = event_tx.clone();

    // Dedicated input thread — event::read() blocks correctly on Windows
    // console input, while event::poll() can be unreliable in some configs.
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<crossterm::event::Event>();
    std::thread::spawn(move || {
        loop {
            match event::read() {
                Ok(ev) => {
                    if input_tx.send(ev).is_err() { break; }
                }
                Err(_) => break,
            }
        }
    });

    // Main event loop
    loop {
        // Poll input events from the dedicated thread
        while let Ok(ev) = input_rx.try_recv() {
            match ev {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    handle_key(&mut app, key, &mut log_buf, &loop_tx);
                }
                Event::Resize(_, _) => {
                    let _ = render_all(&mut stdout, &app, &log_buf);
                }
                _ => {}
            }
        }

        // Drain async build events
        while let Ok(event) = event_rx.try_recv() {
            match event {
                AppEvent::BuildOutput(line) => {
                    push_log(&mut log_buf, &line);
                    app.dirty = true;
                }
                AppEvent::BuildComplete => {
                    app.building = false;
                    app.build_start = None;
                    push_log(&mut log_buf, "[SYSTEM] Build complete");
                    app.dirty = true;
                }
                AppEvent::VmStatus(online) => {
                    app.vm_online = online;
                    app.dirty = true;
                }
                AppEvent::ServiceStatus(status) => {
                    app.service_status = status;
                    app.dirty = true;
                }
                AppEvent::ResourceUpdate(data) => {
                    let cpu = data.cpu_percent;
                    let ram_pct = if data.ram_total_bytes > 0 {
                        (data.ram_used_bytes as f64 / data.ram_total_bytes as f64 * 100.0).clamp(0.0, 100.0)
                    } else { 0.0 };
                    app.resource_history.push(cpu, ram_pct);
                    app.resource_data = data;
                    app.dirty = true;
                }
                AppEvent::HealthCheckComplete => {
                    app.health_check_in_flight = false;
                }
                AppEvent::FileChange { rust_crates, frontend } => {
                    for c in &rust_crates {
                        if c == "__workspace__" { app.changed_rust.clear(); }
                        else { app.changed_rust.insert(c.clone()); }
                    }
                    if frontend { app.changed_fe = true; }
                    if app.do_watch && !app.building && app.vm_online && app.auto_deploy {
                        if !app.changed_rust.is_empty() || app.changed_fe {
                            push_log(&mut log_buf, "[WATCH] Changes detected — auto-rebuilding...");
                            app.building = true; app.build_start = Some(Instant::now());
                            let only = if !app.changed_rust.is_empty() { Some(app.changed_rust.clone()) } else { None };
                            let tx2 = loop_tx.clone();
                            let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                            let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                            let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                            let svcs2 = app.services.clone();
                            tokio::spawn(async move {
                                let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                a.vm_online = true;
                                let _ = a.build_rust(only, &tx2).await;
                                let _ = a.build_frontend(&tx2).await;
                                let _ = a.deploy_binaries(&tx2).await;
                                let _ = tx2.send(AppEvent::BuildComplete);
                            });
                        }
                    }
                }
            }
        }

        // Drain connection events
        while let Ok(conn_event) = conn_rx.try_recv() {
            match conn_event {
                ConnEvent::Online { build, hostname } => {
                    app.bridge_connected = true;
                    if !app.vm_online { app.vm_online = true; }
                    push_log(&mut log_buf, &format!("[BRIDGE] Connected — {} (build {})", hostname, build));
                    app.dirty = true;
                }
                ConnEvent::Offline => {
                    app.bridge_connected = false;
                    if !app.ssh_connected { app.vm_online = false; }
                    app.bridge_uptime = 0;
                    app.bridge_mem_avail = 0;
                    app.bridge_loadavg.clear();
                    push_log(&mut log_buf, "[BRIDGE] Connection lost — auto-reconnecting...");
                    app.dirty = true;
                }
                ConnEvent::SshOnline => {
                    app.ssh_connected = true;
                    if !app.vm_online { app.vm_online = true; }
                    push_log(&mut log_buf, "[SSH] Master session established");
                    app.dirty = true;
                }
                ConnEvent::SshOffline => {
                    app.ssh_connected = false;
                    if !app.bridge_connected { app.vm_online = false; }
                    push_log(&mut log_buf, "[SSH] Master session lost — auto-reconnecting...");
                    app.dirty = true;
                }
                ConnEvent::Heartbeat { uptime_seconds, mem_available_bytes, loadavg } => {
                    app.bridge_uptime = uptime_seconds;
                    app.bridge_mem_avail = mem_available_bytes;
                    app.bridge_loadavg = loadavg;
                    if !app.bridge_connected { app.bridge_connected = true; app.vm_online = true; }
                    app.dirty = true;
                }
                ConnEvent::Error(msg) => {
                    push_log(&mut log_buf, &format!("[CONN] {}", msg));
                    app.dirty = true;
                }
            }
        }

        // Re-render if dirty
        if app.dirty {
            let _ = render_all(&mut stdout, &app, &log_buf);
            app.dirty = false;
        }

        // Periodic VM health check (skip during builds, 30s minimum interval)
        if !app.building && !app.health_check_in_flight && last_vm_check.elapsed() >= Duration::from_secs(30) {
            last_vm_check = Instant::now();
            app.health_check_in_flight = true;
            let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
            let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
            let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
            let svcs2 = app.services.clone();
            let tx2 = loop_tx.clone();
            let was_online = app.vm_online;
            tokio::spawn(async move {
                let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                a.check_vm().await;
                if a.vm_online {
                    a.refresh_services().await;
                    let _ = tx2.send(AppEvent::BuildOutput(
                        format!("[SSH] {}/{} services active", a.active_services, a.total_services)
                    ));
                }
                // Only emit status changes when VM comes BACK online (not disconnects)
                if !was_online && a.vm_online {
                    let _ = tx2.send(AppEvent::VmStatus(true));
                    let _ = tx2.send(AppEvent::BuildOutput("[SSH] VM reachable via SSH".into()));
                }
                // Signal check complete
                let _ = tx2.send(AppEvent::HealthCheckComplete);
            });
        }

        if app.should_quit { break; }

        std::thread::sleep(Duration::from_millis(100));
    }

    // Cleanup
    terminal::disable_raw_mode()?;
    execute!(stdout, LeaveAlternateScreen, Show)?;
    println!("bye.");
    Ok(())
}

fn handle_key(app: &mut App, key: KeyEvent, log_buf: &mut Vec<String>, tx: &mpsc::UnboundedSender<AppEvent>) {
    app.dirty = true;
    let is_cmd = matches!(&app.mode, Mode::Command { .. });
    let is_menu = matches!(&app.mode, Mode::BuildMenu { .. });
    let is_select = matches!(&app.mode, Mode::BuildSelect { .. });

    if is_cmd {
        if let Mode::Command { input, cursor } = &mut app.mode {
            match key.code {
                KeyCode::Esc | KeyCode::Char('\x1b') => app.mode = Mode::Normal,
                KeyCode::Enter | KeyCode::Char('\r') | KeyCode::Char('\n') => {
                    let cmd = input.clone();
                    app.mode = Mode::Normal;
                    app.command_log.push_back(format!("> {}", cmd));
                    if app.command_log.len() > 200 { app.command_log.pop_front(); }
                    app.run_command(&cmd, log_buf, tx);
                }
                KeyCode::Char(c) => { input.insert(*cursor, c); *cursor += 1; }
                KeyCode::Backspace | KeyCode::Char('\x7f') | KeyCode::Char('\x08') => { if *cursor > 0 { input.remove(*cursor - 1); *cursor -= 1; } }
                KeyCode::Left => { if *cursor > 0 { *cursor -= 1; } }
                KeyCode::Right => { if *cursor < input.len() { *cursor += 1; } }
                _ => {}
            }
        }
    } else if is_menu {
        if let Mode::BuildMenu { cursor } = &mut app.mode {
            match key.code {
                KeyCode::Esc | KeyCode::Char('\x1b') => app.mode = Mode::Normal,
                KeyCode::Up => { *cursor = cursor.saturating_sub(1); }
                KeyCode::Down => { *cursor = (*cursor + 1).min(2); }
                KeyCode::Enter | KeyCode::Char('\r') | KeyCode::Char('\n') => {
                    let choice = *cursor;
                    if choice == 2 {
                        app.mode = Mode::BuildSelect { cursor: 0, selected: HashSet::new() };
                    } else {
                        app.mode = Mode::Normal;
                        if !app.vm_online { push_log(log_buf, "[BUILD] VM offline"); return; }
                        if app.building { push_log(log_buf, "[BUILD] Already building"); return; }
                        app.building = true; app.build_start = Some(Instant::now());
                        let only = if choice == 1 && !app.changed_rust.is_empty() { Some(app.changed_rust.clone()) } else { None };
                        let tx2 = tx.clone();
                        let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                        let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                        let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                        let svcs2 = app.services.clone();
                        push_log(log_buf, &format!("[BUILD] Build: {}", ["All","Changed"][choice]));
                        tokio::spawn(async move {
                            let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                            a.vm_online = true;
                            let _ = a.build_rust(only, &tx2).await;
                            let _ = a.build_frontend(&tx2).await;
                            let _ = tx2.send(AppEvent::BuildComplete);
                        });
                    }
                }
                _ => {}
            }
        }
    } else if is_select {
        if let Mode::BuildSelect { cursor, selected } = &mut app.mode {
            match key.code {
                KeyCode::Esc | KeyCode::Char('\x1b') => app.mode = Mode::BuildMenu { cursor: 2 },
                KeyCode::Up => { *cursor = cursor.saturating_sub(1); }
                KeyCode::Down => { *cursor = (*cursor + 1).min(app.services.len().saturating_sub(1)); }
                KeyCode::Char(' ') => {
                    if selected.contains(cursor) { selected.remove(cursor); }
                    else { selected.insert(*cursor); }
                }
                KeyCode::Char('a') | KeyCode::Char('A') => {
                    if selected.len() == app.services.len() { selected.clear(); }
                    else { for i in 0..app.services.len() { selected.insert(i); } }
                }
                KeyCode::Enter | KeyCode::Char('\r') | KeyCode::Char('\n') => {
                    if selected.is_empty() { app.mode = Mode::BuildMenu { cursor: 2 }; return; }
                    let only: HashSet<String> = selected.iter().map(|&i| app.services[i].clone()).collect();
                    app.mode = Mode::Normal;
                    if !app.vm_online { push_log(log_buf, "[BUILD] VM offline"); return; }
                    if app.building { push_log(log_buf, "[BUILD] Already building"); return; }
                    app.building = true; app.build_start = Some(Instant::now());
                    let tx2 = tx.clone();
                    let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                    let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                    let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                    let svcs2 = app.services.clone();
                    push_log(log_buf, &format!("[BUILD] Build: {} services", only.len()));
                    tokio::spawn(async move {
                        let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                        a.vm_online = true;
                        let _ = a.build_rust(Some(only), &tx2).await;
                        let _ = tx2.send(AppEvent::BuildComplete);
                    });
                }
                _ => {}
            }
        }
    } else {
        // Normal mode keys
        match key.code {
            KeyCode::Esc => { app.show_help = false; }
            // Fallback: crossterm on some Windows configs sends Char('\x1b') instead of Esc
            KeyCode::Char('\x1b') if !is_cmd => { app.show_help = false; }
            KeyCode::Char('q') | KeyCode::Char('Q') => { app.should_quit = true; return; }
            KeyCode::Char('?') => { app.show_help = !app.show_help; }
            KeyCode::Char('/') => { app.mode = Mode::Command { input: String::new(), cursor: 0 }; }
            KeyCode::Tab | KeyCode::Char('\t') => {
                app.view = match app.view {
                    View::Logs => View::Status,
                    View::Status => View::Journal,
                    View::Journal => View::Commands,
                    View::Commands => View::Resources,
                    View::Resources => View::Logs,
                };
            }
            KeyCode::Up => { app.log_scroll_offset = app.log_scroll_offset.saturating_add(1); }
            KeyCode::Down => { app.log_scroll_offset = app.log_scroll_offset.saturating_sub(1); }
            KeyCode::PageUp => { app.log_scroll_offset = app.log_scroll_offset.saturating_add(10); }
            KeyCode::PageDown => { app.log_scroll_offset = app.log_scroll_offset.saturating_sub(10); }
            KeyCode::Home => { app.log_scroll_offset = 0; }
            KeyCode::End => { app.log_scroll_offset = 0; }
            KeyCode::Char('r') => { app.mode = Mode::BuildMenu { cursor: 0 }; }
            KeyCode::Char('R') => { app.view = View::Resources; }
            KeyCode::Char('b') | KeyCode::Char('B') => {
                if app.building { push_log(log_buf, "[BUILD] Already building"); return; }
                if !app.vm_online { push_log(log_buf, "[BUILD] VM offline"); return; }
                app.building = true; app.build_start = Some(Instant::now());
                push_log(log_buf, "[BUILD] Full rebuild");
                let tx2 = tx.clone();
                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                let svcs2 = app.services.clone();
                tokio::spawn(async move {
                    let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                    a.vm_online = true;
                    let _ = a.build_rust(None, &tx2).await;
                    let _ = a.build_frontend(&tx2).await;
                    let _ = tx2.send(AppEvent::BuildComplete);
                });
            }
            KeyCode::Char('c') | KeyCode::Char('C') => {
                push_log(log_buf, "[VM] Checking...");
                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                let svcs2 = app.services.clone();
                let c_tx = tx.clone();
                let was_online = app.vm_online;
                tokio::spawn(async move {
                    let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                    a.check_vm().await;
                    if a.vm_online { a.refresh_services().await; }
                    let _ = c_tx.send(AppEvent::BuildOutput(
                        if a.vm_online { if was_online {"[VM] Connected!"} else {"[VM] Came online!"} }
                        else {"[VM] Still offline"}.into()
                    ));
                });
            }
            KeyCode::Char('d') | KeyCode::Char('D') => {
                if !app.vm_online { push_log(log_buf, "[DEPLOY] VM offline"); return; }
                let tx2 = tx.clone();
                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                let svcs2 = app.services.clone();
                tokio::spawn(async move {
                    let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                    a.vm_online = true; let _ = a.deploy_binaries(&tx2).await;
                });
            }
            KeyCode::Char('l') | KeyCode::Char('L') => {
                app.auto_deploy = !app.auto_deploy;
                push_log(log_buf, &format!("[CONFIG] Auto-deploy: {}", if app.auto_deploy {"ON"} else {"OFF"}));
            }
            KeyCode::Char('s') | KeyCode::Char('S') => {
                app.view = View::Status;
                if app.vm_online {
                    let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                    let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                    let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                    let svcs2 = app.services.clone();
                    let tx2 = tx.clone();
                    tokio::spawn(async move {
                        let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                        a.fetch_service_status().await;
                        let _ = tx2.send(AppEvent::ServiceStatus(a.service_status.clone()));
                    });
                }
            }
            KeyCode::Char('h') | KeyCode::Char('H') => {
                push_log(log_buf, "[HEALTH] Checking...");
                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                let svcs2 = app.services.clone();
                let tx2 = tx.clone();
                tokio::spawn(async move {
                    let a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                    if let Ok(h) = a.ssh_exec("curl -sf --max-time 3 http://127.0.0.1:8126/api/health 2>/dev/null || echo FAIL").await {
                        let _ = tx2.send(AppEvent::BuildOutput(if h.contains("\"status\":\"ok\"") {"[HEALTH] ✓ API OK"} else {"[HEALTH] ✗ API unreachable"}.into()));
                    }
                    if let Ok(d) = a.ssh_exec("df -h / 2>/dev/null | tail -1").await {
                        let _ = tx2.send(AppEvent::BuildOutput(format!("[HEALTH] Disk: {}", d.trim())));
                    }
                });
            }
            KeyCode::Char('j') | KeyCode::Char('J') => {
                app.view = View::Journal;
                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                let svcs2 = app.services.clone();
                let tx2 = tx.clone();
                tokio::spawn(async move {
                    let a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                    if let Ok(l) = a.ssh_exec("journalctl -u iora-home --no-pager -n 30 2>/dev/null").await {
                        for line in l.lines() { let _ = tx2.send(AppEvent::BuildOutput(format!("  {}", line))); }
                    }
                });
            }
            KeyCode::Char('1')|KeyCode::Char('2')|KeyCode::Char('3')|KeyCode::Char('4')|
            KeyCode::Char('5')|KeyCode::Char('6')|KeyCode::Char('7')|KeyCode::Char('8')|KeyCode::Char('9') => {
                let idx = match key.code { KeyCode::Char(c) => (c as u8 - b'1') as usize, _ => 0 };
                if idx < app.services.len() && app.vm_online {
                    let svc = app.services[idx].clone();
                    let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                    let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                    let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                    let svcs2 = app.services.clone();
                    let tx2 = tx.clone();
                    push_log(log_buf, &format!("[RESTART] {}", svc));
                    tokio::spawn(async move {
                        let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                        let st = a.restart_service(&svc).await;
                        let _ = tx2.send(AppEvent::BuildOutput(format!("[RESTART] {} → {}", svc, st)));
                    });
                }
            }
            ref code => {
                push_log(log_buf, &format!("[KEY] {:?}", code));
            }
        }
    }
}

// ═══ Windows raw mode fix ════════════════════════════════════════════
// crossterm 0.28.1 has a bug on Windows where ENABLE_EXTENDED_FLAGS is
// not set during enable_raw_mode(). Without it, ENABLE_QUICK_EDIT_MODE
// is silently ignored and the console driver eats key events instead of
// forwarding them to the application.
// This module applies the fix from crossterm PR #815 manually BEFORE
// crossterm::terminal::enable_raw_mode() is called.
// See: https://github.com/crossterm-rs/crossterm/pull/815
#[cfg(windows)]
mod win_raw_fix {
    use std::ffi::c_void;

    const STD_INPUT_HANDLE: u32 = 0xFFFF_FFF6u32; // -10
    const STD_OUTPUT_HANDLE: u32 = 0xFFFF_FFF5u32; // -11
    const DISABLE_NEWLINE_AUTO_RETURN: u32 = 0x0008;
    const ENABLE_EXTENDED_FLAGS: u32 = 0x0080;
    const ENABLE_INSERT_MODE: u32 = 0x0020;
    const ENABLE_QUICK_EDIT_MODE: u32 = 0x0040;
    const ENABLE_VIRTUAL_TERMINAL_INPUT: u32 = 0x0200;
    const ENABLE_MOUSE_INPUT: u32 = 0x0010;
    const ENABLE_WINDOW_INPUT: u32 = 0x0008;

    extern "system" {
        fn GetStdHandle(nStdHandle: u32) -> *mut c_void;
        fn GetConsoleMode(hConsoleHandle: *mut c_void, lpMode: *mut u32) -> i32;
        fn SetConsoleMode(hConsoleHandle: *mut c_void, dwMode: u32) -> i32;
    }

    /// Apply the missing console mode flags before crossterm initializes.
    /// crossterm 0.28.1 only removes ENABLE_LINE_INPUT, ENABLE_ECHO_INPUT,
    /// and ENABLE_PROCESSED_INPUT. It does NOT set ENABLE_EXTENDED_FLAGS,
    /// which is required for ENABLE_QUICK_EDIT_MODE and proper key event
    /// forwarding on Windows.
    /// Returns current mode flags as hex on success, empty string on failure.
    pub fn apply_and_report() -> String {
        let mut result = String::new();
        unsafe {
            // Fix input handle
            let handle = GetStdHandle(STD_INPUT_HANDLE);
            if !handle.is_null() {
                let mut mode: u32 = 0;
                if GetConsoleMode(handle, &mut mode) != 0 {
                    mode |= ENABLE_EXTENDED_FLAGS | ENABLE_INSERT_MODE | ENABLE_QUICK_EDIT_MODE;
                    // Explicitly DISABLE VT input — it can cause the console
                    // to swallow Tab/Enter/Esc on some Windows builds.
                    mode &= !(ENABLE_VIRTUAL_TERMINAL_INPUT | ENABLE_MOUSE_INPUT | ENABLE_WINDOW_INPUT);
                    SetConsoleMode(handle, mode);
                    result = format!("0x{:08X}", mode);
                }
            }
            // Also fix stdout: disable newline auto-return (containerd/console approach)
            let stdout_handle = GetStdHandle(STD_OUTPUT_HANDLE);
            if !stdout_handle.is_null() {
                let mut mode: u32 = 0;
                if GetConsoleMode(stdout_handle, &mut mode) != 0 {
                    mode |= DISABLE_NEWLINE_AUTO_RETURN;
                    SetConsoleMode(stdout_handle, mode);
                }
            }
        }
        result
    }
}
