//! IORA Dev Watch — Build, deploy & monitor the Dev VM.
//! Powered by flywheel-compositor: zero-flicker, input never blocked by rendering.

use anyhow::{Context, Result};
use clap::Parser;
use flywheel::{Engine, InputEvent, KeyCode, Rect, Rgb, StreamWidget};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::{HashSet, VecDeque},
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tokio::process::Command as TokioCommand;

// ═══ Colors ══════════════════════════════════════════════════════════════

const FG_CYAN: Rgb = Rgb::new(0, 200, 200);
const FG_GREEN: Rgb = Rgb::new(0, 200, 0);
const FG_YELLOW: Rgb = Rgb::new(220, 220, 0);
const FG_RED: Rgb = Rgb::new(220, 0, 0);
const FG_WHITE: Rgb = Rgb::new(200, 200, 200);
const FG_GRAY: Rgb = Rgb::new(100, 100, 100);
const FG_MAGENTA: Rgb = Rgb::new(200, 0, 200);
const FG_BLUE: Rgb = Rgb::new(60, 120, 220);
const BG_BLACK: Rgb = Rgb::new(0, 0, 0);
const BG_CYAN: Rgb = Rgb::new(0, 80, 80);

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
}

// ═══ Events ══════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
enum AppEvent {
    BuildOutput(String),
    BuildComplete,
    VmStatus(bool),
    FileChange { rust_crates: HashSet<String>, frontend: bool },
    /// Result of fetch_service_status — list of (status, has_binary) in the
    /// same order as `App::services`.
    ServiceStatus(Vec<(String, bool)>),
}

// ═══ Modes & Views ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, PartialEq)]
enum View { Logs, Status, Journal, Commands }

#[derive(Debug, Clone)]
enum Mode {
    Normal,
    Command { input: String, cursor: usize },
    BuildMenu { cursor: usize },
    BuildSelect { cursor: usize, selected: HashSet<usize> },
}

// ═══ App State ═══════════════════════════════════════════════════════════

struct App {
    vm_host: String, vm_port: u16, ssh_key: PathBuf,
    auto_deploy: bool, do_watch: bool, no_initial_build: bool,
    vm_online: bool, building: bool, last_build: String,
    active_services: usize, total_services: usize,
    view: View, mode: Mode,
    services: Vec<String>,
    service_status: Vec<(String, bool)>, // (status, has_binary)
    should_quit: bool, dirty: bool,
    changed_rust: HashSet<String>, changed_fe: bool,
    repo_root: PathBuf, workspace: PathBuf, vm_workspace: String,
    frontend_dir: Option<PathBuf>, cache_dir: PathBuf,
    build_frame: u8, show_help: bool,
    log_scroll_offset: usize,
    command_log: VecDeque<String>,
    build_start: Option<Instant>,
    last_frame_tick: Instant,
    // Log buffer (for status/health/journal snapshots)
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
            vm_host: args.vm_host.clone(), vm_port: args.vm_port, ssh_key,
            auto_deploy: !args.no_deploy, do_watch: !args.no_watch,
            no_initial_build: args.no_initial_build,
            vm_online: false, building: false, last_build: "-".into(),
            active_services: 0, total_services: total,
            view: View::Logs, mode: Mode::Normal,
            services, service_status: vec![("?".into(), false); total],
            should_quit: false, dirty: true,
            changed_rust: HashSet::new(), changed_fe: false,
            repo_root, workspace, vm_workspace: "/home/iora/iora/iora-os/backend".into(),
            frontend_dir, cache_dir, build_frame: 0, show_help: false,
            log_scroll_offset: 0, command_log: VecDeque::with_capacity(200),
            build_start: None,
            last_frame_tick: Instant::now(),
        })
    }

    /// SSH ControlMaster socket path. Keeps one persistent TCP connection
    /// open across all ssh/scp/rsync invocations so we don't pay the
    /// ~100–200ms handshake cost every time (a single deploy fires 20+
    /// commands).
    fn ctl_path(&self) -> String {
        // %C = unique hash of host/port/user, so multiple VMs coexist.
        let dir = self.cache_dir.join("ssh-sockets");
        let _ = std::fs::create_dir_all(&dir);
        format!("{}/cm-%C", dir.display())
    }

    fn ssh_args(&self) -> Vec<String> {
        let ctl = self.ctl_path();
        vec![
            "-o".into(),"StrictHostKeyChecking=no".into(),"-o".into(),"UserKnownHostsFile=/dev/null".into(),
            "-o".into(),"IdentitiesOnly=yes".into(),"-o".into(),"LogLevel=ERROR".into(),
            "-o".into(),"ConnectTimeout=10".into(),"-o".into(),"ServerAliveInterval=30".into(),
            "-o".into(),"AddressFamily=inet".into(),
            "-o".into(),"ControlMaster=auto".into(),
            "-o".into(),format!("ControlPath={}", ctl),
            "-o".into(),"ControlPersist=600".into(),
            "-i".into(),self.ssh_key.to_string_lossy().to_string(),
            "-p".into(),self.vm_port.to_string(),
            format!("root@{}",self.vm_host),
        ]
    }

    // Kept for ad-hoc file pushes / future use; FE deploy now streams over ssh.
    #[allow(dead_code)]
    fn scp_args(&self) -> Vec<String> {
        let ctl = self.ctl_path();
        vec![
            "-o".into(),"StrictHostKeyChecking=no".into(),"-o".into(),"UserKnownHostsFile=/dev/null".into(),
            "-o".into(),"IdentitiesOnly=yes".into(),"-o".into(),"LogLevel=ERROR".into(),
            "-o".into(),"ConnectTimeout=10".into(),
            "-o".into(),"ControlMaster=auto".into(),
            "-o".into(),format!("ControlPath={}", ctl),
            "-o".into(),"ControlPersist=600".into(),
            "-i".into(),self.ssh_key.to_string_lossy().to_string(),
            "-P".into(),self.vm_port.to_string(),"-q".into(),
        ]
    }

    async fn ssh_exec(&self, cmd: &str) -> Result<String> {
        let mut args = self.ssh_args(); args.push(cmd.into());
        let result = tokio::time::timeout(Duration::from_secs(10),
            TokioCommand::new("ssh").args(&args).output()).await.context("timeout")?;
        Ok(String::from_utf8_lossy(&result?.stdout).into())
    }

    async fn check_vm(&mut self) -> bool {
        self.vm_online = self.ssh_exec("echo OK").await.map_or(false, |s| s.contains("OK"));
        self.vm_online
    }

    async fn refresh_services(&mut self) {
        if !self.vm_online { self.active_services = 0; return; }
        if let Ok(o) = self.ssh_exec(&format!("for s in {}; do systemctl is-active $s 2>/dev/null || echo unknown; done", self.services.join(" "))).await {
            self.active_services = o.lines().filter(|l| *l == "active").count();
        }
    }

    /// Single batched SSH call instead of one per service. For ~15 services
    /// this collapses ~15× RTT (≈1s on a loaded VM) into one round trip.
    async fn fetch_service_status(&mut self) {
        self.service_status.clear();
        // Emit one line per service: "<status>|<yes|no>".
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

    /// Build a remote bash script that:
    ///  1. hashes every built binary on the VM (single batch),
    ///  2. emits a SKIP marker for each one that matches the previous hash
    ///     stored under /var/lib/iora/.bin-hashes/,
    ///  3. installs + restarts only the changed binaries,
    ///  4. fixes the iora-home admin role once (marker file), no fixed sleep.
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
# Restart changed services in parallel.
for svc in $restart_list; do
    (systemctl reset-failed "$svc" 2>/dev/null; systemctl restart "$svc" 2>/dev/null || systemctl start "$svc" 2>/dev/null) &
done
wait
# Admin role fix runs once per VM (marker file), only if iora-home changed.
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
            // --no-times skips mtime sync (we don't need it; reduces stat work).
            // No -z: localhost↔VM is loopback, compression just burns CPU.
            "--exclude=.git".into(),"--exclude=target".into(),"--exclude=node_modules".into(),
            "--exclude=.cache".into(),"--exclude=buildroot-*".into(),"--exclude=releases".into(),
            "--exclude=*.img".into(),"--exclude=*.qcow2".into(),"--exclude=*.iso".into(),
            "--exclude=.iora-dev".into(),"--exclude=dist".into(),"--exclude=__pycache__".into(),
        ];
        args.push("-e".into()); args.push(format!("ssh {}", ssh_opts.join(" ")));
        args.push(format!("{}/", self.repo_root.display()));
        args.push(format!("root@{}:/home/iora/iora/", self.vm_host));
        // Async: don't block a tokio worker thread for the duration of the rsync.
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
        // Run build output via channel (non-blocking for main loop and for
        // the tokio runtime: previously this used std::process + sync
        // BufReader inside tokio::spawn, which pinned a worker thread for
        // the entire build (→ minutes of unavailable worker capacity).
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
        // Return immediately — build runs in background, output arrives via channel
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
            // Stream tar directly over SSH (reuses ControlMaster connection).
            // Unpacks to a temp dir on the VM and atomically swaps it in, so
            // the live dist is never empty mid-deploy.
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
                    let status = TokioCommand::new("ssh")
                        .args(&ssh_args)
                        .stdin(std::process::Stdio::from(tar_out.into_owned_fd()?))
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

    fn run_command(&mut self, input: &str, stream: &mut StreamWidget, engine: &mut Engine, tx: &mpsc::UnboundedSender<AppEvent>) {
        let parts: Vec<&str> = input.trim().split_whitespace().collect();
        if parts.is_empty() { return; }
        match parts[0] {
            "build"|"b" => {
                let mut rust=true; let mut fe=true; let mut changed=false;
                let mut i=1; while i<parts.len() {
                    match parts[i] { "rust"|"r"=>{fe=false;i+=1;} "fe"|"frontend"|"f"=>{rust=false;i+=1;}
                    "changed"|"c"=>{changed=true;i+=1;} "all"|"a"=>{i+=1;}
                    _=>{push_log(stream, engine, "[CMD] unknown arg"); return;} }
                }
                if self.building { push_log(stream, engine, "[CMD] Already building"); return; }
                if !self.vm_online { push_log(stream, engine, "[CMD] VM offline"); return; }
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
                if !self.vm_online { push_log(stream, engine, "[CMD] VM offline"); return; }
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
                if parts.len()<2 { push_log(stream, engine, "[CMD] Usage: restart <service>"); return; }
                let svc=parts[1].to_string();
                let (vmh,vmp,sk)=(self.vm_host.clone(),self.vm_port,self.ssh_key.clone());
                let (ws,vmws)=(self.workspace.clone(),self.vm_workspace.clone());
                let (rr,cd,fe2)=(self.repo_root.clone(),self.cache_dir.clone(),self.frontend_dir.clone());
                let svcs=self.services.clone();
                tokio::spawn(async move {
                        let mut a=App::dummy(vmh,vmp,sk,ws,vmws,fe2,rr,cd,svcs);
                        a.vm_online=true;
                        let _st = a.restart_service(&svc).await;
                        // Could send result back, but for now just log
                    
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
                push_log(stream, engine, &format!("[CMD] Watching: {}", if self.do_watch {"ON"} else {"OFF"}));
            }
            "deploy-toggle"|"dt" => {
                self.auto_deploy=!self.auto_deploy; self.dirty=true;
                push_log(stream, engine, &format!("[CMD] Auto-deploy: {}", if self.auto_deploy{"ON"}else{"OFF"}));
            }
            "quit"|"q"|"exit" => { self.should_quit=true; }
            "help"|"?" => {
                push_log(stream, engine, "[CMD] build [rust|fe|changed] | deploy | restart <s> | journal | status | logs | commands | connect | watch [on|off] | deploy-toggle | quit");
            }
            _ => { push_log(stream, engine, &format!("[CMD] Unknown: {} (type help)", parts[0])); }
        }
    }

    fn dummy(vm_host: String, vm_port: u16, ssh_key: PathBuf, workspace: PathBuf, vm_workspace: String,
             frontend_dir: Option<PathBuf>, repo_root: PathBuf, cache_dir: PathBuf, services: Vec<String>) -> Self {
        let total = services.len();
        Self {
            vm_host, vm_port, ssh_key, auto_deploy: true, do_watch: false, no_initial_build: true,
            vm_online: false, building: false, last_build: "-".into(),
            active_services: 0, total_services: total,
            view: View::Logs, mode: Mode::Normal,
            services, service_status: vec![("?".into(), false); total],
            should_quit: false, dirty: true,
            changed_rust: HashSet::new(), changed_fe: false,
            repo_root, workspace, vm_workspace, frontend_dir, cache_dir,
            build_frame: 0, show_help: false,
            log_scroll_offset: 0, command_log: VecDeque::with_capacity(200),
            build_start: None,
            last_frame_tick: Instant::now(),
        }
    }
}

// ═══ Helpers ═════════════════════════════════════════════════════════════

fn push_log(stream: &mut StreamWidget, engine: &mut Engine, msg: &str) {
    // Cached timestamp: updated once per frame in main loop
    let color = if msg.len() > 12 {
        let prefix = &msg[..12];
        if prefix.contains("[RUST]")||prefix.contains("[DEPLOY]") { FG_MAGENTA }
        else if prefix.contains("[FE]")||prefix.contains("[SYSTEM]") { FG_CYAN }
        else if prefix.contains("[CMD]")||prefix.contains("[RESTART]")||prefix.contains("[WATCH]") { FG_YELLOW }
        else if prefix.contains("[HEALTH]")||prefix.contains("[STATUS]") { FG_BLUE }
        else if msg.contains("✓")||msg.contains("OK") { FG_GREEN }
        else if msg.contains("✗")||msg.contains("FAILED") { FG_RED }
        else if msg.contains("──") { FG_CYAN }
        else { FG_WHITE }
    } else { FG_WHITE };
    stream.set_fg(color);
    stream.push(engine, &format!("{}\n", msg));
    stream.set_fg(FG_WHITE);
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

fn render_header(engine: &mut Engine, app: &App) {
    let w = engine.width() as usize;
    if w < 40 { return; }
    let sep = "═".repeat(w.saturating_sub(2));
    engine.draw_text(0, 0, &format!("╔{}╗", sep), FG_CYAN, BG_BLACK);
    engine.draw_text(0, 1, &format!("║ {:<width$} ║", "IORA Dev Watch", width = w-4), FG_CYAN, BG_BLACK);

    let vm_label = if app.vm_online { "● online" } else { "● offline" };
    let vm_fg = if app.vm_online { FG_GREEN } else { FG_RED };
    let dep_label = if app.auto_deploy { "ON " } else { "OFF" };
    let dep_fg = if app.auto_deploy { FG_GREEN } else { FG_RED };
    let bl_label = if app.building {
        let dots = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
        if let Some(start) = app.build_start {
            let secs = start.elapsed().as_secs();
            format!("Building {} {}s", dots[app.build_frame as usize % dots.len()], secs)
        } else {
            format!("Building {}", dots[app.build_frame as usize % dots.len()])
        }
    } else { app.last_build.clone() };

    // Clear line 2, then draw colored segments
    engine.draw_text(0, 2, &" ".repeat(w), FG_WHITE, BG_BLACK);
    engine.draw_text(0, 2, "║ VM: ", FG_WHITE, BG_BLACK);
    engine.draw_text(6, 2, vm_label, vm_fg, BG_BLACK);
    let mut x = 6u16 + vm_label.len() as u16;
    engine.draw_text(x, 2, "  │  Build: ", FG_WHITE, BG_BLACK);
    x += 12;
    engine.draw_text(x, 2, &bl_label, FG_CYAN, BG_BLACK);
    x += bl_label.len() as u16;
    engine.draw_text(x, 2, "  │  Deploy: ", FG_WHITE, BG_BLACK);
    x += 13;
    engine.draw_text(x, 2, dep_label, dep_fg, BG_BLACK);
    x += dep_label.len() as u16;
    if x < w as u16 - 2 {
        engine.draw_text(x, 2, &" ".repeat(w - 2 - x as usize), FG_WHITE, BG_BLACK);
        engine.draw_text(w as u16 - 2, 2, "║", FG_CYAN, BG_BLACK);
    }
    engine.draw_text(0, 3, &format!("╠{}╣", sep), FG_CYAN, BG_BLACK);
}

fn render_status_view(engine: &mut Engine, app: &App) {
    let h=engine.height() as usize;let w=engine.width() as usize;
    for y in 5..h.saturating_sub(2) {
        engine.draw_text(0, y as u16, &" ".repeat(w), FG_WHITE, BG_BLACK);
    }
    let mut y=5u16;
    let skip=app.log_scroll_offset;
    engine.draw_text(1, y, &format!("{:<30} {:<10} {}", "Service", "Status", "Binary"), FG_CYAN, BG_BLACK);
    y+=1;
    engine.draw_text(1, y, &"─".repeat(50), FG_GRAY, BG_BLACK); y+=1;
    for (i, svc) in app.services.iter().enumerate().skip(skip) {
        if y>=h as u16-2{break;}
        let (status, has_bin) = app.service_status.get(i).map_or(("?", false), |(s,b)| (s.as_str(), *b));
        let status_fg = if status == "active" { FG_GREEN } else if status == "failed" { FG_RED } else { FG_GRAY };
        let bin_text = if has_bin { "yes" } else { "no" };
        engine.draw_text(1, y, &format!("{:<30} {:<10} {}", svc, status, bin_text), FG_WHITE, BG_BLACK);
        // Color status
        engine.draw_text(32, y, status, status_fg, BG_BLACK);
        y+=1;
    }
}

fn render_journal_view(engine: &mut Engine, _app: &App) {
    let w=engine.width() as usize;
    for y in 5..engine.height().saturating_sub(2) as usize {
        engine.draw_text(0, y as u16, &" ".repeat(w), FG_WHITE, BG_BLACK);
    }
    engine.draw_text(1, 5, "(journal will appear here when data streams)", FG_GRAY, BG_BLACK);
}

fn render_commands_view(engine: &mut Engine, app: &App) {
    let w=engine.width() as usize;
    let h=engine.height() as usize;
    for y in 5..h.saturating_sub(2) {
        engine.draw_text(0, y as u16, &" ".repeat(w), FG_WHITE, BG_BLACK);
    }
    let max=(h.saturating_sub(7)).max(1);
    let start=(app.command_log.len().saturating_sub(max)).saturating_add(app.log_scroll_offset).min(app.command_log.len().saturating_sub(1));
    let mut y=5u16;
    for line in app.command_log.iter().skip(start).take(max) {
        let t=if line.len()>w{format!("{}…",&line[..w.saturating_sub(1)])}else{line.clone()};
        let fg=if line.starts_with("> "){FG_YELLOW}else{FG_WHITE};
        engine.draw_text(1, y, &t, fg, BG_BLACK);
        y+=1;
    }
    if app.command_log.is_empty() {
        engine.draw_text(1, 5, "(commands will appear here — press / to enter command mode)", FG_GRAY, BG_BLACK);
    }
}

fn render_help_overlay(engine: &mut Engine) {
    let w=engine.width() as usize;
    let bx=4u16; let by=3u16;
    let bw=(w-8) as u16; let bh=14u16;
    // Clear box area
    for y in by..by+bh { engine.draw_text(bx, y, &" ".repeat(bw as usize), FG_WHITE, BG_BLACK); }
    // Border
    let sep="─".repeat(bw as usize -2);
    engine.draw_text(bx, by, &format!("┌{}┐", sep), FG_CYAN, BG_BLACK);
    engine.draw_text(bx, by+1, &format!("│ {:<width$} │", "Help — Keybindings", width=bw as usize-4), FG_CYAN, BG_BLACK);
    engine.draw_text(bx, by+2, &format!("│ {:<width$} │", "", width=bw as usize-4), FG_CYAN, BG_BLACK);
    let keys=[
        ("/","Command mode"),("Tab","Switch view"),("R","Build menu"),
        ("B","Quick rebuild"),("D","Deploy"),("C","VM connect"),
        ("S","Status refresh"),("H","Health check"),("J","Journal"),
        ("L","Toggle deploy"),("1-9","Restart services"),("?","This help"),
        ("↑↓","Scroll"),("PgUp/Dn","Scroll 10"),("0/End","Bottom/Top"),
        ("Esc","Cancel/Close"),("Q","Quit"),
    ];
    for (i,(key,desc)) in keys.iter().enumerate(){
        let line=format!("│  {:<8} {:<width$} │", key, desc, width=bw as usize-13);
        engine.draw_text(bx, by+3+i as u16, &line, FG_WHITE, BG_BLACK);
    }
    engine.draw_text(bx, by+bh-1, &format!("└{}┘", sep), FG_CYAN, BG_BLACK);
}

fn render_tabs(engine: &mut Engine, app: &App) {
    let tabs = [" Logs ", " Status ", " Journal ", " Commands "];
    let mut x = 1u16;
    for (i, label) in tabs.iter().enumerate() {
        let active = match (&app.view, i) {
            (View::Logs, 0) | (View::Status, 1) | (View::Journal, 2) | (View::Commands, 3) => true,
            _ => false,
        };
        let (fg, bg) = if active { (BG_BLACK, BG_CYAN) } else { (FG_GRAY, BG_BLACK) };
        engine.draw_text(x, 4, label, fg, bg);
        x += label.len() as u16;
    }
}

fn render_footer(engine: &mut Engine, app: &App) {
    let w = engine.width() as usize;
    let h = engine.height() as usize;
    if h < 3 { return; }
    let footer_y = h as u16 - 2;

    // Clear footer lines
    engine.draw_text(0, footer_y, &" ".repeat(w), FG_WHITE, BG_BLACK);
    engine.draw_text(0, footer_y + 1, &"─".repeat(w), FG_GRAY, BG_BLACK);

    let mode_text = match &app.mode {
        Mode::Normal => {
            let status = if app.building { "● BUILDING..." } else if !app.vm_online { "VM offline — press C" } else { "● idle" };
            let status_fg = if app.building { FG_YELLOW } else if !app.vm_online { FG_RED } else { FG_GREEN };
            engine.draw_text(2, footer_y, status, status_fg, BG_BLACK);
            format!("  {}  │  {}/{} active  │  Q=quit B=build S=status H=health /=cmd Tab=view",
                status, app.active_services, app.total_services)
        }
        Mode::Command { input, .. } => {
            format!("  / {}", input)
        }
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
                let checked = selected.contains(&i);
                let mark = if checked { "✓" } else { " " };
                s.push_str(&format!(" [{}]{}", mark, &svc[5..]));
            }
            s.push_str("  Space=toggle A=all Enter=build Esc=back");
            s
        }
    };
    engine.draw_text(0, footer_y, &mode_text, FG_GRAY, BG_BLACK);
}

// ═══ Main ════════════════════════════════════════════════════════════════

fn main() -> Result<()> {
    // Shared tokio runtime for all background tasks (no per-task Runtime::new())
    let rt = tokio::runtime::Runtime::new()?;
    let _guard = rt.enter();

    let args = Args::parse();
    let mut app = App::new(&args)?;

    let mut engine = Engine::new()?;
    let w = engine.width() as usize;
    let h = engine.height() as usize;

    // StreamWidget for main log area
    let log_rect = Rect::new(0, 5, w as u16, h.saturating_sub(7) as u16);
    let mut stream = StreamWidget::new(log_rect);
    stream.set_fg(FG_WHITE);

    // Event channel for background tasks
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AppEvent>();

    // File watcher
    let _watcher = if app.do_watch {
        Some(start_file_watcher(app.workspace.clone(), app.frontend_dir.clone(), event_tx.clone())?)
    } else { None };

    // Welcome
    push_log(&mut stream, &mut engine, "[SYSTEM] IORA Dev Watch ready. Checking VM...");

    // Initial render
    engine.clear();
    render_header(&mut engine, &app);
    render_tabs(&mut engine, &app);
    stream.render(engine.buffer_mut());
    render_footer(&mut engine, &app);
    engine.request_redraw();

    // Initial VM check + build
    let tx = event_tx.clone();
    let (vmh, vmp, sk) = (app.vm_host.clone(), app.vm_port, app.ssh_key.clone());
    let (ws, vmws) = (app.workspace.clone(), app.vm_workspace.clone());
    let (rr, cd, fe) = (app.repo_root.clone(), app.cache_dir.clone(), app.frontend_dir.clone());
    let svcs = app.services.clone();
    let do_build = !app.no_initial_build;
    tokio::spawn(async move {
            let mut a = App::dummy(vmh.clone(), vmp, sk.clone(), ws, vmws, fe, rr, cd, svcs);
            if a.check_vm().await {
                let _=tx.send(AppEvent::VmStatus(true));
                let _=tx.send(AppEvent::BuildOutput(format!("[SYSTEM] VM online at {}:{}", vmh, vmp)));
                a.refresh_services().await;
                let _=tx.send(AppEvent::BuildOutput(format!("[SYSTEM] {}/{} services active", a.active_services, a.total_services)));
                if do_build {
                    // Signal building to main app
                    let _=tx.send(AppEvent::BuildOutput("[SYSTEM] Starting initial build...".into()));
                    let _=a.build_rust(None, &tx).await;
                    let _=a.build_frontend(&tx).await;
                    let _=tx.send(AppEvent::BuildComplete);
                }
            } else {
                let _=tx.send(AppEvent::VmStatus(false));
                let _=tx.send(AppEvent::BuildOutput("[SYSTEM] VM offline — start with ./dev-local.sh, then press C".into()));
            }
        
                    });

    // Main loop
    let mut last_vm_check = Instant::now();
    let loop_tx = event_tx.clone();
    loop {
        let mut pending = Vec::new();
        // 0. Poll before anything
        while let Some(event) = engine.poll_input() { pending.push(event); }

        // 1. Drain background events
        while let Ok(event) = event_rx.try_recv() {
            match event {
                AppEvent::BuildOutput(line) => {
                    // Auto-scroll to bottom unless user manually scrolled up
                    if app.log_scroll_offset == 0 {
                        stream.scroll_down(usize::MAX);
                    }
                    push_log(&mut stream, &mut engine, &line);
                    app.dirty = true;
                }
                AppEvent::BuildComplete => {
                    app.building = false;
                    app.build_start = None;
                    app.dirty = true;
                    push_log(&mut stream, &mut engine, "[SYSTEM] Build complete");
                }
                AppEvent::VmStatus(online) => {
                    app.vm_online = online;
                    app.dirty = true;
                }
                AppEvent::ServiceStatus(status) => {
                    app.service_status = status;
                    app.dirty = true;
                }
                AppEvent::FileChange { rust_crates, frontend } => {
                    for c in &rust_crates {
                        if c == "__workspace__" { app.changed_rust.clear(); }
                        else { app.changed_rust.insert(c.clone()); }
                    }
                    if frontend { app.changed_fe = true; }
                    if app.do_watch && !app.building && app.vm_online && app.auto_deploy {
                        if !app.changed_rust.is_empty() || app.changed_fe {
                            push_log(&mut stream, &mut engine, "[WATCH] Changes detected — auto-rebuilding...");
                            app.building = true; app.build_start = Some(Instant::now()); app.dirty = true;
                            let only = if !app.changed_rust.is_empty() { Some(app.changed_rust.clone()) } else { None };
                            let tx2 = loop_tx.clone();
                            let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                            let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                            let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                            let svcs2 = app.services.clone();
                            tokio::spawn(async move {
                                    let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                    a.vm_online = true;
                                    let _=a.build_rust(only, &tx2).await;
                                    let _=a.build_frontend(&tx2).await;
                                    let _=tx2.send(AppEvent::BuildComplete);
                                
                    });
                        }
                    }
                }
            }
        }

        // 1b. Poll after drain (catch keys during event processing)
        while let Some(event) = engine.poll_input() { pending.push(event); }

        // 2. Render full frame if dirty (only clear header/footer — StreamWidget handles its own area)
        if app.dirty {
            let w = engine.width() as usize;
            let h = engine.height() as usize;
            // Clear header rows only (0-4)
            for y in 0..5u16 { engine.draw_text(0, y, &" ".repeat(w), FG_WHITE, BG_BLACK); }
            // Clear footer rows (h-2, h-1)
            for y in (h.saturating_sub(2) as u16)..(h as u16) { engine.draw_text(0, y, &" ".repeat(w), FG_WHITE, BG_BLACK); }
            render_header(&mut engine, &app);
            render_tabs(&mut engine, &app);
            // Render content area based on active view
            match app.view {
                View::Logs => {
                    stream.render(engine.buffer_mut());
                    // Scroll indicator (top-right of log area)
                    if app.log_scroll_offset > 0 {
                        let ind = format!("[↑{} lines | 0=bottom]", app.log_scroll_offset);
                        let x = w.saturating_sub(ind.len() + 2) as u16;
                        engine.draw_text(x, 5, &ind, FG_YELLOW, BG_BLACK);
                    }
                }
                View::Status => { render_status_view(&mut engine, &app);
                    if app.log_scroll_offset > 0 {
                        let ind = format!("[↑{} | 0=top]", app.log_scroll_offset);
                        let x = w.saturating_sub(ind.len() + 2) as u16;
                        engine.draw_text(x, 5, &ind, FG_YELLOW, BG_BLACK);
                    }
                }
                View::Journal => { render_journal_view(&mut engine, &app);
                    if app.log_scroll_offset > 0 {
                        let ind = format!("[↑{} | 0=top]", app.log_scroll_offset);
                        let x = w.saturating_sub(ind.len() + 2) as u16;
                        engine.draw_text(x, 5, &ind, FG_YELLOW, BG_BLACK);
                    }
                }
                View::Commands => { render_commands_view(&mut engine, &app);
                    if app.log_scroll_offset > 0 {
                        let ind = format!("[↑{} | 0=top]", app.log_scroll_offset);
                        let x = w.saturating_sub(ind.len() + 2) as u16;
                        engine.draw_text(x, 5, &ind, FG_YELLOW, BG_BLACK);
                    }
                }
            }
            render_footer(&mut engine, &app);
            if app.show_help { render_help_overlay(&mut engine); }
            engine.request_update();  // faster: diff-only, no full redraw
            app.dirty = false;
        }

        // 2b. Poll after render (catch keys during draw)
        while let Some(event) = engine.poll_input() { pending.push(event); }

        // 3. Process pending input events (collected at loop start)
        for event in pending {
            match event {
                InputEvent::Resize { width, height } => {
                    engine.handle_resize(width, height);
                    engine.clear();
                    stream.set_bounds(Rect::new(0, 5, width, height.saturating_sub(7)));
                    app.dirty = true;
                }
                InputEvent::Key { code, .. } => {
                    app.dirty = true;
                    let is_cmd = matches!(&app.mode, Mode::Command { .. });
                    let is_menu = matches!(&app.mode, Mode::BuildMenu { .. });
                    let is_select = matches!(&app.mode, Mode::BuildSelect { .. });

                    if is_cmd {
                        if let Mode::Command { input, cursor } = &mut app.mode {
                            match code {
                                KeyCode::Esc => app.mode = Mode::Normal,
                                KeyCode::Enter => {
                                    let cmd = input.clone();
                                    app.mode = Mode::Normal;
                                    app.command_log.push_back(format!("> {}", cmd));
                                    if app.command_log.len() > 200 { app.command_log.pop_front(); }
                                    app.run_command(&cmd, &mut stream, &mut engine, &loop_tx);
                                }
                                KeyCode::Char(c) => { input.insert(*cursor, c); *cursor += 1; }
                                KeyCode::Backspace => { if *cursor > 0 { input.remove(*cursor-1); *cursor -= 1; } }
                                KeyCode::Left => { if *cursor > 0 { *cursor -= 1; } }
                                KeyCode::Right => { if *cursor < input.len() { *cursor += 1; } }
                                _ => {}
                            }
                        }
                    } else if is_menu {
                        if let Mode::BuildMenu { cursor } = &mut app.mode {
                            match code {
                                KeyCode::Esc => app.mode = Mode::Normal,
                                KeyCode::Up => { *cursor = cursor.saturating_sub(1); }
                                KeyCode::Down => { *cursor = (*cursor+1).min(2); }
                                KeyCode::Enter => {
                                    let choice = *cursor;
                                    if choice == 2 {
                                        app.mode = Mode::BuildSelect { cursor: 0, selected: HashSet::new() };
                                    } else {
                                        app.mode = Mode::Normal;
                                        if !app.vm_online { push_log(&mut stream, &mut engine, "[BUILD] VM offline"); }
                                        else if app.building { push_log(&mut stream, &mut engine, "[BUILD] Already building"); }
                                        else {
                                            app.building = true; app.build_start = Some(Instant::now());
                                            let only = if choice == 1 && !app.changed_rust.is_empty() { Some(app.changed_rust.clone()) } else { None };
                                            let tx2 = loop_tx.clone();
                                            let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                            let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                            let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                            let svcs2 = app.services.clone();
                                            push_log(&mut stream, &mut engine, &format!("[BUILD] Build: {}", ["All","Changed"][choice]));
                                            tokio::spawn(async move {
                                                    let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                                    a.vm_online = true;
                                                    let _=a.build_rust(only, &tx2).await;
                                                    let _=a.build_frontend(&tx2).await;
                                                    let _=tx2.send(AppEvent::BuildComplete);
                                                
                    });
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else if is_select {
                        if let Mode::BuildSelect { cursor, selected } = &mut app.mode {
                            match code {
                                KeyCode::Esc => app.mode = Mode::BuildMenu { cursor: 2 },
                                KeyCode::Up => { *cursor = cursor.saturating_sub(1); }
                                KeyCode::Down => { *cursor = (*cursor+1).min(app.services.len().saturating_sub(1)); }
                                KeyCode::Char(' ') => {
                                    if selected.contains(cursor) { selected.remove(cursor); }
                                    else { selected.insert(*cursor); }
                                }
                                KeyCode::Char('a') => {
                                    if selected.len() == app.services.len() { selected.clear(); }
                                    else { for i in 0..app.services.len() { selected.insert(i); } }
                                }
                                KeyCode::Enter => {
                                    if selected.is_empty() { app.mode = Mode::BuildMenu { cursor: 2 }; }
                                    else {
                                        let only: HashSet<String> = selected.iter().map(|&i| app.services[i].clone()).collect();
                                        app.mode = Mode::Normal;
                                        if !app.vm_online { push_log(&mut stream, &mut engine, "[BUILD] VM offline"); }
                                        else if app.building { push_log(&mut stream, &mut engine, "[BUILD] Already building"); }
                                        else {
                                            app.building = true; app.build_start = Some(Instant::now());
                                            let tx2 = loop_tx.clone();
                                            let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                            let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                            let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                            let svcs2 = app.services.clone();
                                            push_log(&mut stream, &mut engine, &format!("[BUILD] Build: {} services", only.len()));
                                            tokio::spawn(async move {
                                                    let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                                    a.vm_online = true;
                                                    let _=a.build_rust(Some(only), &tx2).await;
                                                    let _=tx2.send(AppEvent::BuildComplete);
                                                
                    });
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else {
                        // Normal mode keys
                        match code {
                            KeyCode::Esc if app.show_help => { app.show_help = false; app.dirty = true; }
                            KeyCode::Char('q') | KeyCode::Char('Q') => app.should_quit = true,
                            KeyCode::Char('?') => app.show_help = !app.show_help,
                            KeyCode::Char('/') => app.mode = Mode::Command { input: String::new(), cursor: 0 },
                            KeyCode::Tab => {
                                app.view = match app.view {
                                    View::Logs => View::Status,
                                    View::Status => View::Journal,
                                    View::Journal => View::Commands,
                                    View::Commands => View::Logs,
                                };
                            }
                            // Scroll in all views
                            KeyCode::Up if app.view != View::Logs => { app.log_scroll_offset = app.log_scroll_offset.saturating_add(1); app.dirty = true; }
                            KeyCode::Down if app.view != View::Logs => { app.log_scroll_offset = app.log_scroll_offset.saturating_sub(1); app.dirty = true; }
                            KeyCode::End | KeyCode::Char('0') if app.view != View::Logs => { app.log_scroll_offset = 0; app.dirty = true; }
                            KeyCode::Up if app.view == View::Logs => { stream.scroll_up(1); app.log_scroll_offset += 1; app.dirty = true; }
                            KeyCode::Down if app.view == View::Logs => { if app.log_scroll_offset > 0 { stream.scroll_down(1); app.log_scroll_offset -= 1; } app.dirty = true; }
                            KeyCode::PageUp if app.view == View::Logs => { stream.scroll_up(10); app.log_scroll_offset += 10; app.dirty = true; }
                            KeyCode::PageDown if app.view == View::Logs => { let n = app.log_scroll_offset.min(10); stream.scroll_down(n); app.log_scroll_offset -= n; app.dirty = true; }
                            KeyCode::Home if app.view == View::Logs => { stream.scroll_up(usize::MAX); app.log_scroll_offset = usize::MAX; app.dirty = true; }
                            KeyCode::End | KeyCode::Char('0') if app.view == View::Logs => { stream.scroll_down(usize::MAX); app.log_scroll_offset = 0; app.dirty = true; }
                            KeyCode::Char('r') | KeyCode::Char('R') => app.mode = Mode::BuildMenu { cursor: 0 },
                            KeyCode::Char('b') | KeyCode::Char('B') => {
                                if app.building { push_log(&mut stream, &mut engine, "[BUILD] Already building"); }
                                else if !app.vm_online { push_log(&mut stream, &mut engine, "[BUILD] VM offline"); }
                                else {
                                    app.building = true; app.build_start = Some(Instant::now());
                                    push_log(&mut stream, &mut engine, "[BUILD] Full rebuild");
                                    let tx2 = loop_tx.clone();
                                    let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                    let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                    let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                    let svcs2 = app.services.clone();
                                    tokio::spawn(async move {
                                            let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                            a.vm_online = true;
                                            let _=a.build_rust(None, &tx2).await;
                                            let _=a.build_frontend(&tx2).await;
                                            let _=tx2.send(AppEvent::BuildComplete);
                                        
                    });
                                }
                            }
                            KeyCode::Char('c') | KeyCode::Char('C') => {
                                push_log(&mut stream, &mut engine, "[VM] Checking...");
                                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                let svcs2 = app.services.clone();
                                let c_tx = loop_tx.clone();
                                let was_online = app.vm_online;
                                tokio::spawn(async move {
                                        let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                        a.check_vm().await;
                                        if a.vm_online { a.refresh_services().await; }
                                        let _=c_tx.send(AppEvent::BuildOutput(
                                            if a.vm_online { if was_online {"[VM] Connected!"} else {"[VM] Came online!"} }
                                            else {"[VM] Still offline"}.into()
                                        ));
                                    
                    });
                            }
                            KeyCode::Char('d') | KeyCode::Char('D') => {
                                if !app.vm_online { push_log(&mut stream, &mut engine, "[DEPLOY] VM offline"); }
                                else {
                                    let tx2 = loop_tx.clone();
                                    let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                    let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                    let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                    let svcs2 = app.services.clone();
                                    tokio::spawn(async move {
                                            let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                            a.vm_online = true; let _=a.deploy_binaries(&tx2).await;
                                        
                    });
                                }
                            }
                            KeyCode::Char('l') | KeyCode::Char('L') => {
                                app.auto_deploy = !app.auto_deploy;
                                push_log(&mut stream, &mut engine, &format!("[CONFIG] Auto-deploy: {}", if app.auto_deploy {"ON"} else {"OFF"}));
                            }
                            KeyCode::Char('s') | KeyCode::Char('S') => {
                                app.view = View::Status;
                                if app.vm_online {
                                    let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                    let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                    let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                    let svcs2 = app.services.clone();
                                    let tx2 = loop_tx.clone();
                                    tokio::spawn(async move {
                                            let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                            a.fetch_service_status().await;
                                            let _=tx2.send(AppEvent::ServiceStatus(a.service_status.clone()));
                                        
                    });
                                }
                            }
                            KeyCode::Char('h') | KeyCode::Char('H') => {
                                push_log(&mut stream, &mut engine, "[HEALTH] Checking...");
                                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                let svcs2 = app.services.clone();
                                let tx2 = loop_tx.clone();
                                tokio::spawn(async move {
                                        let a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                        if let Ok(h) = a.ssh_exec("curl -sf --max-time 3 http://127.0.0.1:8126/api/health 2>/dev/null || echo FAIL").await {
                                            let _=tx2.send(AppEvent::BuildOutput(if h.contains("\"status\":\"ok\"") {"[HEALTH] ✓ API OK"} else {"[HEALTH] ✗ API unreachable"}.into()));
                                        }
                                        if let Ok(d) = a.ssh_exec("df -h / 2>/dev/null | tail -1").await {
                                            let _=tx2.send(AppEvent::BuildOutput(format!("[HEALTH] Disk: {}", d.trim())));
                                        }
                                    
                    });
                            }
                            KeyCode::Char('j') | KeyCode::Char('J') => {
                                app.view = View::Journal;
                                let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                let svcs2 = app.services.clone();
                                let tx2 = loop_tx.clone();
                                tokio::spawn(async move {
                                        let a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                        if let Ok(l) = a.ssh_exec("journalctl -u iora-home --no-pager -n 30 2>/dev/null").await {
                                            for line in l.lines() { let _=tx2.send(AppEvent::BuildOutput(format!("  {}", line))); }
                                        }
                                    
                    });
                            }
                            KeyCode::Char('1')|KeyCode::Char('2')|KeyCode::Char('3')|KeyCode::Char('4')|
                            KeyCode::Char('5')|KeyCode::Char('6')|KeyCode::Char('7')|KeyCode::Char('8')|KeyCode::Char('9') => {
                                let idx = match code { KeyCode::Char(c) => (c as u8 - b'1') as usize, _ => 0 };
                                if idx < app.services.len() && app.vm_online {
                                    let svc = app.services[idx].clone();
                                    let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
                                    let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
                                    let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
                                    let svcs2 = app.services.clone();
                                    let tx2 = loop_tx.clone();
                                    push_log(&mut stream, &mut engine, &format!("[RESTART] {}", svc));
                                    tokio::spawn(async move {
                                            let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                                            let st = a.restart_service(&svc).await;
                                            let _=tx2.send(AppEvent::BuildOutput(format!("[RESTART] {} → {}", svc, st)));
                                        
                    });
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }

        if app.should_quit { break; }

        // 4. Build animation + VM check
        // Animate spinner at ~10 fps, not every 5 ms loop tick (used to repaint 200×/sec).
        if app.building {
            let now = Instant::now();
            if now.duration_since(app.last_frame_tick) >= Duration::from_millis(100) {
                app.build_frame = app.build_frame.wrapping_add(1);
                app.last_frame_tick = now;
                app.dirty = true;
            }
        }
        if last_vm_check.elapsed() >= Duration::from_secs(6) {
            last_vm_check = Instant::now();
            let (vmh2,vmp2,sk2) = (app.vm_host.clone(),app.vm_port,app.ssh_key.clone());
            let (ws2,vmws2) = (app.workspace.clone(),app.vm_workspace.clone());
            let (rr2,cd2,fe2) = (app.repo_root.clone(),app.cache_dir.clone(),app.frontend_dir.clone());
            let svcs2 = app.services.clone();
            let tx2 = loop_tx.clone();
            let was_online = app.vm_online;  // Capture REAL state
            tokio::spawn(async move {
                    let mut a = App::dummy(vmh2,vmp2,sk2,ws2,vmws2,fe2,rr2,cd2,svcs2);
                    a.check_vm().await;
                    let _=tx2.send(AppEvent::VmStatus(a.vm_online));
                    if a.vm_online { a.refresh_services().await; }
                    if was_online != a.vm_online {
                        let _=tx2.send(AppEvent::BuildOutput(if a.vm_online {"[VM] Came online!"} else {"[VM] Went offline!"}.into()));
                    }
                
                    });
        }

        std::thread::sleep(Duration::from_millis(5));
    }

    // Engine drop handles cleanup automatically
    println!("bye.");
    Ok(())
}
