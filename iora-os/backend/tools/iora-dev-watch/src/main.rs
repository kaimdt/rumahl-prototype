//! IORA Dev Watch TUI — Build, deploy & monitor the Dev VM.
//!
//! Modes:  Normal (keys)  |  Command (/)  |  Build Menu (R)
//! Views:  Logs (default)  |  Status  |  Journal (Tab to cycle)
//! Features: autocomplete, log scrolling, progress bars, mouse support

use anyhow::{Context, Result};
use chrono::Local;
use clap::Parser;
use crossterm::{
    event::{self, Event, KeyCode, MouseEventKind, MouseButton},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Paragraph, Clear},
    Terminal, Frame,
};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::{
    process::Command as TokioCommand,
    sync::mpsc,
    time::interval,
};

// ═══ CLI ═════════════════════════════════════════════════════════════════

#[derive(Parser, Debug)]
#[command(name = "iora-dev-watch")]
struct Args {
    #[arg(long)] no_watch: bool, #[arg(long)] rust_only: bool, #[arg(long)] frontend_only: bool,
    #[arg(long, default_value = "127.0.0.1")] vm_host: String,
    #[arg(long, default_value = "2222")] vm_port: u16,
    #[arg(long)] ssh_key: Option<String>, #[arg(long)] no_deploy: bool,
    #[arg(long)] no_initial_build: bool,
}

// ═══ Events ══════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
enum AppEvent {
    Key(KeyCode),
    FileChange { rust_crates: HashSet<String>, frontend: bool },
    BuildOutput(String),
    BuildComplete,
    #[allow(dead_code)] JournalLine { line: String },
    ServiceStatus(HashMap<String, ServiceInfo>),
    MouseClick { _row: u16, _col: u16 },
    MouseScroll { _row: u16, _col: u16, _delta: i16 },
    Resize,
}

// ═══ UI ══════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, PartialEq)] enum View { Logs, Status, Journal, Commands }
#[derive(Debug, Clone)]
enum Mode {
    Normal,
    Command { input: String, cursor: usize, suggestions: Vec<String>, selected_suggestion: usize },
    BuildMenu { cursor: usize },
    BuildSelect { cursor: usize, selected: HashSet<usize> },
}

const COMMANDS: &[(&str, &str)] = &[
    ("build", "build [rust|fe|all|changed] — Trigger builds"),
    ("deploy", "deploy — Deploy binaries to VM"),
    ("restart", "restart <service> — Restart a service"),
    ("journal", "journal — Switch to Journal view"),
    ("status", "status — Switch to Status view"),
    ("logs", "logs — Switch to Logs view"),
    ("commands", "commands — Switch to Commands view"),
    ("connect", "connect — Reconnect to VM"),
    ("watch", "watch [on|off] — Toggle file watching"),
    ("deploy-toggle", "deploy-toggle — Toggle auto-deploy"),
    ("quit", "quit — Exit"),
    ("help", "help — Show help"),
];

fn get_suggestions(input: &str) -> Vec<&'static str> {
    if input.is_empty() { return vec![]; }
    let lower = input.to_lowercase();
    COMMANDS.iter().filter(|(n,_)| n.starts_with(&lower)).map(|(n,_)| *n).collect()
}

struct Theme;
impl Theme {
    const CYAN: Color = Color::Cyan; const GREEN: Color = Color::Green;
    const YELLOW: Color = Color::Yellow; const RED: Color = Color::Red;
    const MAGENTA: Color = Color::Magenta; const BLUE: Color = Color::Blue;
    const DARK_GRAY: Color = Color::DarkGray; const WHITE: Color = Color::White;
    const BLACK: Color = Color::Black;
}

#[derive(Debug, Clone, Default)] struct ServiceInfo { status: String, has_binary: bool }

// ═══ App ═════════════════════════════════════════════════════════════════

#[allow(dead_code)]
struct App {
    vm_host: String, vm_port: u16, ssh_key: PathBuf,
    auto_deploy: bool, do_watch: bool, no_initial_build: bool,
    vm_online: bool, building: bool, last_build: String,
    active_services: usize, total_services: usize,
    view: View, mode: Mode,
    logs: VecDeque<String>, command_log: VecDeque<String>, journal_buf: VecDeque<String>,
    services: Vec<String>, should_quit: bool, dirty: bool,
    show_help: bool, build_frame: u8, log_count: u32,
    last_dirty: std::time::Instant, cached_ts: String,
    log_scroll_offset: usize,
    build_start: Option<Instant>, build_progress: (u32, u32), build_eta: String,
    service_status: HashMap<String, ServiceInfo>,
    changed_rust: HashSet<String>, changed_fe: bool,
    repo_root: PathBuf, workspace: PathBuf, vm_workspace: String,
    frontend_dir: Option<PathBuf>, cache_dir: PathBuf,
    rust_build_n: u32, fe_build_n: u32,
}

impl App {
    fn new(args: &Args) -> Result<Self> {
        let repo_root = find_repo_root()?; let workspace = find_workspace(&repo_root)?;
        let frontend_dir = find_frontend(&repo_root); let cache_dir = repo_root.join("iora-os/.cache");
        std::fs::create_dir_all(&cache_dir).ok();
        let ssh_key = args.ssh_key.clone().map(PathBuf::from).unwrap_or_else(|| cache_dir.join("iora-dev-key"));
        let services = discover_services(&workspace);
        Ok(Self {
            vm_host: args.vm_host.clone(), vm_port: args.vm_port, ssh_key,
            auto_deploy: !args.no_deploy, do_watch: !args.no_watch, no_initial_build: args.no_initial_build,
            vm_online: false, building: false, last_build: "-".into(),
            active_services: 0, total_services: services.len(),
            view: View::Logs, mode: Mode::Normal,
            logs: VecDeque::with_capacity(500), command_log: VecDeque::with_capacity(500),
            journal_buf: VecDeque::with_capacity(200),
            services, should_quit: false, dirty: true, show_help: false, build_frame: 0, log_count: 0, last_dirty: std::time::Instant::now(), cached_ts: String::new(),
            log_scroll_offset: 0, build_start: None, build_progress: (0,0), build_eta: String::new(),
            service_status: HashMap::new(), changed_rust: HashSet::new(), changed_fe: false,
            repo_root, workspace, vm_workspace: "/home/iora/iora/iora-os/backend".into(),
            frontend_dir, cache_dir, rust_build_n: 0, fe_build_n: 0,
        })
    }
    fn log(&mut self, msg: &str) {
        if msg.trim().is_empty() { return; }
        if self.logs.len() >= 500 { self.logs.pop_front(); }
        // Use cached timestamp (updated once per draw cycle)
        self.logs.push_back(format!("{}  {}", self.cached_ts, msg));
        if !self.building || self.last_dirty.elapsed()>=Duration::from_millis(100){
            self.dirty=true;self.last_dirty=std::time::Instant::now();
        }
    }
    fn journal_add(&mut self, line: &str) {
        let ts = Local::now().format("%H:%M:%S");
        let clean = strip_ansi(line);
        if self.journal_buf.len() >= 200 { self.journal_buf.pop_front(); }
        self.journal_buf.push_back(format!("{}  {}", ts, clean));
    }
    fn cmd_log(&mut self, msg: &str) {
        let ts = Local::now().format("%H:%M:%S");
        if self.command_log.len() >= 500 { self.command_log.pop_front(); }
        self.command_log.push_back(format!("{}  {}", ts, msg));
        self.dirty = true;
    }

    fn ssh_args(&self) -> Vec<String> { vec![
        "-o".into(),"StrictHostKeyChecking=no".into(),"-o".into(),"UserKnownHostsFile=/dev/null".into(),
        "-o".into(),"IdentitiesOnly=yes".into(),"-o".into(),"LogLevel=ERROR".into(),
        "-o".into(),"ConnectTimeout=10".into(),"-o".into(),"ServerAliveInterval=30".into(),
        "-o".into(),"AddressFamily=inet".into(),
        "-i".into(),self.ssh_key.to_string_lossy().to_string(),
        "-p".into(),self.vm_port.to_string(), format!("root@{}",self.vm_host),
    ]}
    fn scp_args(&self) -> Vec<String> { vec![
        "-o".into(),"StrictHostKeyChecking=no".into(),"-o".into(),"UserKnownHostsFile=/dev/null".into(),
        "-o".into(),"IdentitiesOnly=yes".into(),"-o".into(),"LogLevel=ERROR".into(),
        "-o".into(),"ConnectTimeout=10".into(),
        "-i".into(),self.ssh_key.to_string_lossy().to_string(),
        "-P".into(),self.vm_port.to_string(),"-q".into(),
    ]}

    async fn ssh_exec(&self, cmd: &str) -> Result<String> {
        let mut args = self.ssh_args(); args.push(cmd.into());
        tokio::time::timeout(Duration::from_secs(10), TokioCommand::new("ssh").args(&args).output())
            .await.context("ssh timeout")?.context("ssh failed")
            .map(|o| String::from_utf8_lossy(&o.stdout).into())
    }
    async fn ssh_lines(&self, cmd: &str, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<bool> {
        let mut args = self.ssh_args(); args.push(cmd.into());
        let mut child = TokioCommand::new("ssh").args(&args)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn()?;
        let tx1=tx.clone(); let tx2=tx.clone();
        tokio::spawn(pipe_lines(child.stdout.take().unwrap(),tx1));
        tokio::spawn(pipe_lines_stderr(child.stderr.take().unwrap(),tx2));
        Ok(child.wait().await?.success())
    }
    async fn check_vm(&mut self) -> bool {
        self.vm_online = tokio::task::spawn_blocking({
            let a = self.ssh_args();
            move || std::process::Command::new("ssh").args(&a).arg("echo OK").output()
                .map(|o| String::from_utf8_lossy(&o.stdout).contains("OK")).unwrap_or(false)
        }).await.unwrap_or(false);
        self.vm_online
    }
    async fn refresh_services(&mut self) {
        if !self.vm_online { self.active_services=0; return; }
        if let Ok(o)=self.ssh_exec(&format!("for s in {}; do systemctl is-active $s 2>/dev/null || echo unknown; done",self.services.join(" "))).await {
            self.active_services = o.lines().filter(|l|*l=="active").count();
        }
    }

    fn build_rust_cmd(&self, only: Option<&HashSet<String>>) -> String {
        // Use nproc for simplicity (avoids awk quoting issues inside su -c)
        let mut cmd = format!("cd {} && CARGO_BUILD_JOBS=$(nproc) /home/iora/.cargo/bin/cargo build", self.vm_workspace);
        if let Some(crates)=only { for c in crates { cmd.push_str(&format!(" -p {}",c)); } }
        else { cmd.push_str(" --workspace"); }
        cmd
    }
    fn deploy_cmd(&self) -> String {
        let mut script=String::from("#!/bin/bash\nset -e\ndeployed=0\n");
        for svc in &self.services {
            let short=svc.strip_prefix("iora-").unwrap_or(svc);
            script.push_str(&format!(
                "if test -f {ws}/target/debug/{svc}; then\n  install -m 0755 {ws}/target/debug/{svc} /usr/bin/{svc}\n  mkdir -p /etc/iora/db-credentials /opt/iora/build/{svc}/data\n  [ -f /etc/iora/db-credentials/{svc}.env ] || echo 'DATABASE_URL=postgres://root:iora@localhost/iora_{short}' > /etc/iora/db-credentials/{svc}.env\n  [ -f /etc/iora/{svc}.env ] || printf 'DATABASE_URL=postgres://root:iora@localhost:5432/iora_{short}\\nRUST_LOG={svc}=debug\\nIORA_BOOTSTRAP_ADMIN_USER=admin\\nIORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234\\n' > /etc/iora/{svc}.env\n  systemctl reset-failed {svc} 2>/dev/null\n  systemctl restart {svc} 2>/dev/null || systemctl start {svc} 2>/dev/null || true\n  deployed=$((deployed+1))\n  echo 'deployed {svc}'\nelse\n  echo 'skip {svc}'\nfi\n",
                ws=self.vm_workspace,svc=svc,short=short
            ));
        }
        script.push_str("sleep 2\nsu - postgres -c \"psql iora_home -c 'UPDATE users SET role='\\''admin'\\'' WHERE username='\\''admin'\\'' AND role!='\\''admin'\\''' \" 2>/dev/null || true\necho \"DEPLOY_RESULT: deployed=$deployed\"\n");
        // Write script to temp file via heredoc, execute, cleanup
        format!("cat > /tmp/iora-deploy.sh << 'DEPLOYEOF'\n{}\nDEPLOYEOF\nbash /tmp/iora-deploy.sh && rm -f /tmp/iora-deploy.sh", script)
    }
    async fn sync_sources(&self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<()> {
        let _=tx.send(AppEvent::BuildOutput("[RUST] Syncing sources...".into()));
        // ssh_args ends with "root@host" — strip that for rsync -e
        let ssh_opts:Vec<String>=self.ssh_args().into_iter().rev().skip(1).rev().collect();
        let mut args=vec!["-az".into(),"--delete".into(),
            "--exclude=.git".into(),"--exclude=target".into(),"--exclude=node_modules".into(),
            "--exclude=.cache".into(),"--exclude=buildroot-*".into(),"--exclude=releases".into(),
            "--exclude=*.img".into(),"--exclude=*.qcow2".into(),"--exclude=*.iso".into(),
            "--exclude=.iora-dev".into(),
        ];
        args.extend_from_slice(&["-e".into(),format!("ssh {}",ssh_opts.join(" "))]);
        args.push(format!("{}/",self.repo_root.display()));
        args.push(format!("root@{}:/home/iora/iora/",self.vm_host));
        let _=TokioCommand::new("rsync").args(&args).status().await?;
        let _=self.ssh_exec("chown -R iora:iora /home/iora/iora 2>/dev/null").await;
        Ok(())
    }
    async fn build_rust(&mut self, only: Option<HashSet<String>>, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<bool> {
        self.rust_build_n+=1; self.build_start=Some(Instant::now()); self.build_progress=(0,0);
        let label=if let Some(ref c)=only {format!("{} crates",c.len())} else {"all".into()};
        let _=tx.send(AppEvent::BuildOutput(format!("──[Rust #{} — {}]──",self.rust_build_n,label)));
        let _=self.ssh_exec("su - iora -c 'test -f /home/iora/.cargo/bin/cargo || curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal' 2>&1").await;
        self.sync_sources(tx).await?;
        let cmd=self.build_rust_cmd(only.as_ref());
        let full=format!("su - iora -c '{}' 2>&1",cmd);
        let _=tx.send(AppEvent::BuildOutput(format!("[RUST] {}",cmd)));
        let ok=self.ssh_lines(&full,tx).await?;
        if ok {
            let _=tx.send(AppEvent::BuildOutput("[RUST] ✓ Build OK".into()));
            self.last_build="✓ Rust".into();
            if self.auto_deploy { self.deploy_binaries(tx).await?; }
            self.changed_rust.clear();
        } else { let _=tx.send(AppEvent::BuildOutput("[RUST] ✗ Build FAILED".into())); self.last_build="✗ Rust".into(); }
        self.build_start=None; self.build_progress=(0,0); self.build_eta.clear();
        Ok(ok)
    }
    async fn build_frontend(&mut self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<bool> {
        let fe=match &self.frontend_dir {Some(d)=>d.clone(),None=>return Ok(false)};
        self.fe_build_n+=1; self.build_start=Some(Instant::now());
        let _=tx.send(AppEvent::BuildOutput(format!("──[Frontend #{}]──",self.fe_build_n)));
        if !fe.join("node_modules").is_dir() {
            let _=tx.send(AppEvent::BuildOutput("[FE] npm install...".into()));
            if !TokioCommand::new("npm").args(["install","--no-audit","--no-fund"]).current_dir(&fe).status().await?.success(){
                let _=tx.send(AppEvent::BuildOutput("[FE] ✗ npm install FAILED".into())); return Ok(false);
            }
        }
        let _=tx.send(AppEvent::BuildOutput("[FE] npm run build...".into()));
        let mut child=TokioCommand::new("npm").args(["run","build"]).current_dir(&fe)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn()?;
        let tx1=tx.clone(); let tx2=tx.clone();
        tokio::spawn(pipe_lines(child.stdout.take().unwrap(),tx1));
        tokio::spawn(pipe_lines_stderr(child.stderr.take().unwrap(),tx2));
        let ok=child.wait().await?.success();
        if ok {
            let _=tx.send(AppEvent::BuildOutput("[FE] ✓ Build OK".into()));
            self.last_build="✓ FE".into(); self.changed_fe=false;
            if self.auto_deploy&&self.vm_online { self.deploy_frontend(tx).await?; }
        } else { let _=tx.send(AppEvent::BuildOutput("[FE] ✗ Build FAILED".into())); }
        self.build_start=None;
        Ok(ok)
    }
    async fn deploy_binaries(&mut self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<()> {
        let _=tx.send(AppEvent::BuildOutput("[DEPLOY] Deploying...".into()));
        let _=self.ssh_lines(&self.deploy_cmd(),tx).await;
        let _=tx.send(AppEvent::BuildOutput("[DEPLOY] ✓ Done".into()));
        self.refresh_services().await; Ok(())
    }
    async fn deploy_frontend(&self, tx: &mpsc::UnboundedSender<AppEvent>) -> Result<()> {
        if let Some(ref fe)=self.frontend_dir {
            let dist=fe.join("dist"); if !dist.is_dir(){return Ok(());}
            let tar=self.cache_dir.join("iora-frontend.tar.gz");
            let _=TokioCommand::new("tar").args(["-czf",tar.to_str().unwrap(),"-C",dist.to_str().unwrap(),"."]).status().await;
            let mut a=self.scp_args(); a.push(tar.to_str().unwrap().into());
            a.push(format!("root@{}:/tmp/iora-frontend.tar.gz",self.vm_host));
            let _=TokioCommand::new("scp").args(&a).status().await;
            let _=self.ssh_exec("mkdir -p /opt/iora/build/dist && rm -rf /opt/iora/build/dist/* && tar xzf /tmp/iora-frontend.tar.gz -C /opt/iora/build/dist && rm -f /tmp/iora-frontend.tar.gz && systemctl restart iora-home 2>/dev/null || systemctl start iora-home 2>/dev/null || true && systemctl reload nginx 2>/dev/null || true").await;
            let _=tx.send(AppEvent::BuildOutput("[FE] ✓ Deployed".into()));
            let _=std::fs::remove_file(&tar);
        }
        Ok(())
    }
    async fn restart_service(&mut self, svc: &str, tx: &mpsc::UnboundedSender<AppEvent>) {
        let cmd=format!("systemctl reset-failed {} 2>/dev/null; systemctl restart {} 2>/dev/null || systemctl start {} 2>/dev/null || true; sleep 1; systemctl is-active {} 2>/dev/null | tr -d '\\n'",svc,svc,svc,svc);
        if let Ok(st)=self.ssh_exec(&cmd).await {let _=tx.send(AppEvent::BuildOutput(format!("[RESTART] {} → {}",svc,st.trim())));}
        self.refresh_services().await;
    }
    async fn start_journal_stream(&self, tx: mpsc::UnboundedSender<AppEvent>) -> Result<()> {
        let mut args=self.ssh_args();
        args.push("journalctl -u iora-home -f --no-pager -n 0 --no-hostname -o cat 2>/dev/null".into());
        let mut child=TokioCommand::new("ssh").args(&args)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn()?;
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt,BufReader};
            let mut r=BufReader::new(child.stdout.take().unwrap()).lines();
            while let Ok(Some(line))=r.next_line().await {
                if tx.send(AppEvent::JournalLine{line:strip_ansi(&line)}).is_err(){break;}
            }
        });
        Ok(())
    }

    fn run_command(&mut self, input: &str, tx: &mpsc::UnboundedSender<AppEvent>) {
        let parts: Vec<&str>=input.trim().split_whitespace().collect();
        if parts.is_empty(){return;}
        self.cmd_log(&format!("> {}",input));
        match parts[0] {
            "build"|"b"=>{
                let mut rust=true;let mut fe=true;let mut changed=false;
                let mut i=1;while i<parts.len(){match parts[i]{
                    "rust"|"r"=>{fe=false;i+=1;}"fe"|"frontend"|"f"=>{rust=false;i+=1;}
                    "changed"|"c"=>{changed=true;i+=1;}"all"|"a"=>{i+=1;}
                    _=>{self.cmd_log(&format!("unknown: {}",parts[i]));return;}
                }}
                if self.building{self.cmd_log("Already building");return;}
                if !self.vm_online{self.cmd_log("VM offline");return;}
                self.building=true;
                let only=if changed&&!self.changed_rust.is_empty(){Some(self.changed_rust.clone())}else if changed{None}else{None};
                let tx2=tx.clone();let ctx=self.ctx_clone();
                tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;
                    if rust{let _=a.build_rust(only,&tx2).await;} if fe{let _=a.build_frontend(&tx2).await;let _=tx2.send(AppEvent::BuildComplete);}});
            }
            "deploy"|"d"=>{if !self.vm_online{self.cmd_log("VM offline");return;} let tx2=tx.clone();let ctx=self.ctx_clone();
                tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;let _=a.deploy_binaries(&tx2).await;});}
            "restart"|"r"=>{if parts.len()<2{self.cmd_log("Usage: restart <service>");return;}
                let svc=parts[1].to_string();let tx2=tx.clone();let ctx=self.ctx_clone();
                tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;a.restart_service(&svc,&tx2).await;});}
            "journal"|"j"=>{self.view=View::Journal;self.cmd_log("Switched to Journal");}
            "status"|"s"=>{self.view=View::Status;self.cmd_log("Status view");}
            "logs"|"l"=>{self.view=View::Logs;self.cmd_log("Logs view");}
            "commands"|"cmd"=>{self.view=View::Commands;self.cmd_log("Commands view");}
            "connect"|"c"=>{self.cmd_log("Reconnecting...");}
            "watch"=>{self.do_watch=parts.get(1).map_or(true,|&w|w!="off");
                self.cmd_log(&format!("Watching: {}",if self.do_watch{"ON"}else{"OFF"}));}
            "deploy-toggle"|"dt"=>{self.auto_deploy=!self.auto_deploy;
                self.cmd_log(&format!("Auto-deploy: {}",if self.auto_deploy{"ON"}else{"OFF"}));}
            "quit"|"q"|"exit"=>{self.should_quit=true;}
            "help"|"?"=>{self.cmd_log("Commands: build [rust|fe|changed] | deploy | restart <s> | journal | status | logs | commands | connect | watch [on|off] | deploy-toggle | quit");}
            _=>{self.cmd_log(&format!("Unknown: {} (type help)",parts[0]));}
        }
        self.dirty=true;
    }
    fn ctx_clone(&self) -> AppCtx { AppCtx {
        vm_host:self.vm_host.clone(),vm_port:self.vm_port,ssh_key:self.ssh_key.clone(),
        workspace:self.workspace.clone(),vm_workspace:self.vm_workspace.clone(),
        frontend_dir:self.frontend_dir.clone(),repo_root:self.repo_root.clone(),
        cache_dir:self.cache_dir.clone(),services:self.services.clone(),
    }}
}

struct AppCtx { vm_host:String,vm_port:u16,ssh_key:PathBuf,workspace:PathBuf,vm_workspace:String,
    frontend_dir:Option<PathBuf>,repo_root:PathBuf,cache_dir:PathBuf,services:Vec<String> }

fn ctx_to_app(ctx:AppCtx)->App {
    let total=ctx.services.len();
    App { vm_host:ctx.vm_host,vm_port:ctx.vm_port,ssh_key:ctx.ssh_key,
        auto_deploy:true,do_watch:false,no_initial_build:true,
        vm_online:false,building:false,last_build:"-".into(),
        active_services:0,total_services:total,
        view:View::Logs,mode:Mode::Normal,
        logs:VecDeque::with_capacity(500),command_log:VecDeque::with_capacity(500),
        journal_buf:VecDeque::with_capacity(200),
        services:ctx.services,should_quit:false,dirty:true,show_help:false,build_frame:0,log_count:0,last_dirty:std::time::Instant::now(),cached_ts:String::new(),
        log_scroll_offset:0,build_start:None,build_progress:(0,0),build_eta:String::new(),
        service_status:HashMap::new(),changed_rust:HashSet::new(),changed_fe:false,
        repo_root:ctx.repo_root,workspace:ctx.workspace,vm_workspace:ctx.vm_workspace,
        frontend_dir:ctx.frontend_dir,cache_dir:ctx.cache_dir,
        rust_build_n:0,fe_build_n:0,
    }
}

fn find_repo_root()->Result<PathBuf>{
    if let Ok(o)=std::process::Command::new("git").args(["rev-parse","--show-toplevel"]).output(){
        if o.status.success(){return Ok(PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()));}
    }
    for a in std::env::current_exe()?.ancestors(){
        if a.join("iora-os/backend/Cargo.toml").exists()||a.join("backend/Cargo.toml").exists(){return Ok(a.into());}
    }
    anyhow::bail!("no repo root")
}
fn find_workspace(r:&PathBuf)->Result<PathBuf>{
    for c in &[r.join("iora-os/backend"),r.join("backend")]{if c.join("Cargo.toml").exists(){return Ok(c.clone());}}
    anyhow::bail!("no workspace")
}
fn find_frontend(r:&PathBuf)->Option<PathBuf>{
    for d in &["frontend","desktop"]{let p=r.join(d);if p.join("package.json").exists(){return Some(p);}} None
}
fn strip_ansi(s:&str)->String{
    let mut result=String::with_capacity(s.len());let mut chars=s.chars().peekable();
    while let Some(c)=chars.next(){
        if c=='\x1b'&&chars.peek()==Some(&'['){chars.next();
            while let Some(&nc)=chars.peek(){if nc.is_ascii_digit()||nc==';'||nc=='?'{chars.next();}else{break;}}
            chars.next();
        }else{result.push(c);}
    }
    result
}
fn discover_services(w:&PathBuf)->Vec<String>{
    let mut v=Vec::new();
    for sub in &["services","tools","apps/system","dev"]{
        let b=w.join(sub);if !b.is_dir(){continue;}
        if let Ok(e)=std::fs::read_dir(&b){for en in e.flatten(){let p=en.path();
            if p.is_dir()&&p.join("Cargo.toml").exists(){if let Some(n)=p.file_name().and_then(|n|n.to_str()){if n.starts_with("iora-")&&n!="iora-dev-watch"{v.push(n.into());}}}}
    }}
    v.sort();v.dedup();v
}

async fn pipe_lines(pipe:tokio::process::ChildStdout,tx:mpsc::UnboundedSender<AppEvent>){
    use tokio::io::{AsyncBufReadExt,BufReader};
    let mut r=BufReader::new(pipe).lines();
    while let Ok(Some(line))=r.next_line().await{if !line.trim().is_empty(){let _=tx.send(AppEvent::BuildOutput(line));}}
}
async fn pipe_lines_stderr(pipe:tokio::process::ChildStderr,tx:mpsc::UnboundedSender<AppEvent>){
    use tokio::io::{AsyncBufReadExt,BufReader};
    let mut r=BufReader::new(pipe).lines();
    while let Ok(Some(line))=r.next_line().await{if !line.trim().is_empty(){let _=tx.send(AppEvent::BuildOutput(line));}}
}

fn start_file_watcher(workspace:PathBuf,fe:Option<PathBuf>,tx:mpsc::UnboundedSender<AppEvent>)->Result<RecommendedWatcher>{
    let dirs:Vec<PathBuf>=["services","shared","tools","apps","dev"].iter().map(|s|workspace.join(s)).filter(|p|p.is_dir()).collect();
    let mut w:RecommendedWatcher=notify::recommended_watcher(move |res:notify::Result<notify::Event>|{
        if let Ok(ev)=res{if matches!(ev.kind,EventKind::Modify(_)|EventKind::Create(_)){
            let mut rust=HashSet::new();let mut frontend=false;
            for p in &ev.paths{let s=p.to_string_lossy();
                // Ignore changes to dev-watch itself
                if s.contains("iora-dev-watch"){continue;}
                if s.ends_with(".rs"){for c in p.components().rev(){let cn=c.as_os_str().to_string_lossy();if cn.starts_with("iora-")&&cn!="iora-dev-watch"{rust.insert(cn.to_string());break;}}}
                if s.contains("Cargo.toml")||s.contains("Cargo.lock"){rust.insert("__workspace__".into());}
                if s.ends_with(".tsx")||s.ends_with(".ts")||s.ends_with(".jsx")||s.ends_with(".css")||s.ends_with(".html"){frontend=true;}
            }
            if !rust.is_empty()||frontend{let _=tx.send(AppEvent::FileChange{rust_crates:rust,frontend});}
        }}
    })?;
    w.configure(Config::default().with_poll_interval(Duration::from_secs(2)))?;
    for d in &dirs{let _=w.watch(d,RecursiveMode::Recursive);}
    if let Some(f)=&fe{for s in &["src","public"]{let d=f.join(s);if d.is_dir(){let _=w.watch(&d,RecursiveMode::Recursive);}}}
    Ok(w)
}

// ═══ TUI Rendering ═══════════════════════════════════════════════════════

fn render_ui(f:&mut Frame,app:&App){
    let area=f.area();
    let footer_h=match &app.mode{Mode::Command{suggestions,..} if !suggestions.is_empty()=>4u16,Mode::Command{..}=>3u16,_=>2u16};
    let chunks=Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Length(2),Constraint::Length(3),Constraint::Min(3),Constraint::Length(footer_h)])
        .split(area);
    render_tabs(f,chunks[0],app);
    render_header(f,chunks[1],app);
    match app.view{View::Logs=>render_logs(f,chunks[2],app),View::Status=>render_status_view(f,chunks[2],app),
        View::Journal=>render_journal_view(f,chunks[2],app),View::Commands=>render_commands_view(f,chunks[2],app)}
    render_footer(f,chunks[3],app);
    if app.show_help{render_help_overlay(f,area);}
}

fn render_tabs(f:&mut Frame,area:Rect,app:&App){
    let as_style=Style::default().fg(Theme::BLACK).bg(Theme::CYAN).add_modifier(Modifier::BOLD);
    let is_style=Style::default().fg(Theme::DARK_GRAY);
    let labels=[("Logs",View::Logs),("Status",View::Status),("Journal",View::Journal),("Commands",View::Commands)];
    let spans:Vec<Span>=labels.iter().map(|(l,v)|if app.view==*v{Span::styled(format!(" [{}] ",l),as_style)}else{Span::styled(format!("  {}  ",l),is_style)}).collect();
    f.render_widget(Paragraph::new(Line::from(spans)),area);
}

fn render_header(f:&mut Frame,area:Rect,app:&App){
    let w=area.width as usize;let sep="═".repeat(w.saturating_sub(2));
    let (vc,vt)=if app.vm_online{(Theme::GREEN,"● online")}else{(Theme::RED,"● offline")};
    let (dc,dt)=if app.auto_deploy{(Theme::GREEN,"ON")}else{(Theme::RED,"OFF")};
    let bl=if app.building{
        if app.build_progress.1>0{
            let pct=(app.build_progress.0 as f64/app.build_progress.1 as f64*100.0)as u32;
            let bar_w=10usize;let filled=(pct as usize*bar_w/100).min(bar_w);
            let bar="█".repeat(filled)+&"░".repeat(bar_w-filled);
            if !app.build_eta.is_empty(){format!("Building [{}] {}% ~{}",bar,pct,app.build_eta)}
            else{format!("Building [{}] {}%",bar,pct)}
        }else{
            let dots=["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
            format!("Building {} ",dots[(app.build_frame as usize/3)%dots.len()])
        }
    }else{app.last_build.clone()};
    let pad=(w as i32-56).max(0)as usize;
    let lines=vec![
        Line::from(Span::styled(format!("╔{}╗",sep),Style::default().fg(Theme::CYAN).add_modifier(Modifier::BOLD))),
        Line::from(vec![Span::raw("║ VM: "),Span::styled(vt,Style::default().fg(vc)),
            Span::raw(format!("  │  Build: {}  │  Deploy: ",bl)),
            Span::styled(dt,Style::default().fg(dc)),Span::raw(" ".repeat(pad)),Span::raw("║"),
        ]),
        Line::from(Span::styled(format!("╠{}╣",sep),Style::default().fg(Theme::CYAN))),
    ];
    f.render_widget(Paragraph::new(Text::from(lines)),area);
}

fn render_logs(f:&mut Frame,area:Rect,app:&App){
    let max=area.height as usize;let w=area.width as usize;let total=app.logs.len();
    let auto_start=total.saturating_sub(max);
    let start=if app.log_scroll_offset==0{auto_start}else{(total.saturating_sub(max).saturating_sub(app.log_scroll_offset)).min(total.saturating_sub(1))};
    let lines:Vec<Line>=app.logs.iter().skip(start).take(max).map(|s|{
        let t=if s.len()>w{format!("{}…",&s[..w.saturating_sub(1)])}else{s.clone()};
        // Fast color: check prefix only (first 12 chars)
        let prefix=&t[..t.len().min(12)];
        let style=if prefix.contains("[RUST]")||prefix.contains("[DEPLOY]"){Style::default().fg(Theme::MAGENTA)}
        else if prefix.contains("[FE]")||prefix.contains("[SYSTEM]"){Style::default().fg(Theme::CYAN)}
        else if prefix.contains("[RESTART]")||prefix.contains("[CMD]")||prefix.contains("[WATCH]"){Style::default().fg(Theme::YELLOW)}
        else if prefix.contains("[HEALTH]")||prefix.contains("[STATUS]")||prefix.contains("[JOURNAL]"){Style::default().fg(Theme::BLUE)}
        else if prefix.contains("[VM]")||prefix.contains("[BUILD]"){Style::default().fg(Theme::CYAN)}
        else{Style::default().fg(Theme::WHITE)};
        Line::from(Span::styled(t,style))
    }).collect();
    f.render_widget(Paragraph::new(Text::from(lines)),area);
    if app.log_scroll_offset>0{
        let ind=format!("[scrolled ↑{} | 0/End=bottom]",app.log_scroll_offset);
        let ia=Rect{x:area.width.saturating_sub(ind.len()as u16+1),y:area.y,width:ind.len()as u16+1,height:1};
        f.render_widget(Paragraph::new(Span::styled(ind,Style::default().fg(Theme::YELLOW).bg(Theme::BLACK))),ia);
    }
}

fn render_status_view(f:&mut Frame,area:Rect,app:&App){
    let mut lines=vec![
        Line::from(Span::styled(format!("  {:<30} {:<12} {}","Service","Status","Binary"),Style::default().fg(Theme::CYAN).add_modifier(Modifier::BOLD))),
        Line::from(Span::styled("  ".to_string()+&"─".repeat(52),Style::default().fg(Theme::DARK_GRAY))),
    ];
    for svc in &app.services{
        let info=app.service_status.get(svc);
        let (status,color,binary)=if let Some(i)=info{
            let c=match i.status.as_str(){"active"=>Theme::GREEN,"failed"=>Theme::RED,"activating"|"reloading"=>Theme::YELLOW,_=>Theme::DARK_GRAY};
            (i.status.as_str(),c,if i.has_binary{"✓"}else{"-"})
        }else{("?",Theme::DARK_GRAY,"?")};
        lines.push(Line::from(vec![Span::styled(format!("  {:<30} ",svc),Style::default().fg(Theme::WHITE)),
            Span::styled(format!("{:<12}",status),Style::default().fg(color)),
            Span::styled(binary.to_string(),Style::default().fg(Theme::DARK_GRAY)),]));
    }
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(if app.service_status.is_empty(){"  Press S to load service status from VM"}else{"  Press S to refresh status"},Style::default().fg(Theme::DARK_GRAY))));
    f.render_widget(Paragraph::new(Text::from(lines)),area);
}

fn render_journal_view(f:&mut Frame,area:Rect,app:&App){
    let max=area.height as usize;let start=app.journal_buf.len().saturating_sub(max);let w=area.width as usize;
    let lines:Vec<Line>=app.journal_buf.iter().skip(start).take(max).map(|s|{
        let t=if s.len()>w{format!("{}…",&s[..w.saturating_sub(1)])}else{s.clone()};
        Line::from(Span::styled(t,Style::default().fg(Theme::WHITE)))
    }).collect();
    if lines.is_empty(){f.render_widget(Paragraph::new("  (no journal data — press J or type /journal)"),area);}
    else{f.render_widget(Paragraph::new(Text::from(lines)),area);}
}

fn render_commands_view(f:&mut Frame,area:Rect,app:&App){
    let max=area.height as usize;let start=app.command_log.len().saturating_sub(max);let w=area.width as usize;
    let lines:Vec<Line>=app.command_log.iter().skip(start).take(max).map(|s|{
        let t=if s.len()>w{format!("{}…",&s[..w.saturating_sub(1)])}else{s.clone()};
        let style=if s.starts_with("> "){Style::default().fg(Theme::YELLOW).add_modifier(Modifier::BOLD)}else{Style::default().fg(Theme::WHITE)};
        Line::from(Span::styled(t,style))
    }).collect();
    if lines.is_empty(){f.render_widget(Paragraph::new("  No commands yet — press / to enter command mode"),area);}
    else{f.render_widget(Paragraph::new(Text::from(lines)),area);}
}

fn render_footer(f:&mut Frame,area:Rect,app:&App){
    let w=area.width as usize;
    match &app.mode{
        Mode::Normal=>{
            let (sc,si)=if app.building{(Theme::YELLOW,"● BUILDING...")}else if !app.vm_online{(Theme::RED,"VM offline — press C")}else{(Theme::GREEN,"● idle")};
            let lines=vec![
                Line::from(vec![Span::raw("  "),Span::styled(si,Style::default().fg(sc)),
                    Span::raw(format!("  │  {}/{} active  │  ",app.active_services,app.total_services)),
                    Span::styled("/=cmd Tab=view R=build Q=quit ?=help",Style::default().fg(Theme::DARK_GRAY)),]),
                Line::from(Span::styled("─".repeat(w),Style::default().fg(Theme::DARK_GRAY))),
            ];
            f.render_widget(Paragraph::new(Text::from(lines)),area);
        }
        Mode::Command{input,cursor,suggestions,selected_suggestion}=>{
            let mut lines=Vec::new();
            if !suggestions.is_empty(){
                let mut sl=String::from("  suggestions: ");
                for (i,s) in suggestions.iter().enumerate(){
                    if i==*selected_suggestion{sl.push_str(&format!("[{}] ",s));}
                    else{sl.push_str(&format!("{} ",s));}
                }
                sl.push_str("  Tab=autocomplete ↑↓=cycle");
                lines.push(Line::from(Span::styled(sl,Style::default().fg(Theme::DARK_GRAY))));
            }
            let prompt=format!("  / {}",input);
            let display=if prompt.len()>w-2{format!("{}…",&prompt[..w-3])}else{prompt.clone()};
            let cm=cursor+4;
            if cm<display.len(){
                lines.push(Line::from(vec![
                    Span::styled(display[..cm].to_string(),Style::default().fg(Theme::YELLOW)),
                    Span::styled(display[cm..cm+1].to_string(),Style::default().fg(Theme::BLACK).bg(Theme::YELLOW)),
                    Span::styled(display[cm+1..].to_string(),Style::default().fg(Theme::YELLOW)),
                ]));
            }else{lines.push(Line::from(Span::styled(display,Style::default().fg(Theme::YELLOW))));}
            lines.push(Line::from(Span::styled("─".repeat(w),Style::default().fg(Theme::DARK_GRAY))));
            f.render_widget(Paragraph::new(Text::from(lines)),area);
        }
        Mode::BuildSelect{cursor,selected}=>{
            let mut all:Vec<Span>=vec![Span::styled("  Select: ",Style::default().fg(Theme::CYAN))];
            for (i,svc) in app.services.iter().enumerate(){
                let checked=selected.contains(&i);
                let mark=if checked{"✓"}else{" "};
                let style=if i==*cursor{Style::default().fg(Theme::BLACK).bg(Theme::CYAN)}else if checked{Style::default().fg(Theme::GREEN)}else{Style::default().fg(Theme::DARK_GRAY)};
                all.push(Span::styled(format!(" [{}]{}",mark,&svc[5..]),style));
            }
            all.push(Span::styled("  Space=toggle A=all/none Enter=build Esc=back",Style::default().fg(Theme::DARK_GRAY)));
            let lines=vec![Line::from(all),Line::from(Span::styled("─".repeat(w),Style::default().fg(Theme::DARK_GRAY)))];
            f.render_widget(Paragraph::new(Text::from(lines)),area);
        }
        Mode::BuildMenu{cursor}=>{
            let items=["[All]","[Changed]","[Select]"];
            let spans:Vec<Span>=items.iter().enumerate().map(|(i,l)|if i==*cursor{Span::styled(format!(" {} ",l),Style::default().fg(Theme::BLACK).bg(Theme::CYAN))}else{Span::styled(format!("  {}  ",l),Style::default().fg(Theme::DARK_GRAY))}).collect();
            let mut all=vec![Span::styled("  Build: ",Style::default().fg(Theme::CYAN))];
            all.extend(spans);
            all.push(Span::styled("  ↑↓=nav Enter=confirm Esc=cancel",Style::default().fg(Theme::DARK_GRAY)));
            let lines=vec![
                Line::from(all),
                Line::from(Span::styled("─".repeat(w),Style::default().fg(Theme::DARK_GRAY))),
            ];
            f.render_widget(Paragraph::new(Text::from(lines)),area);
        }
    }
}

fn render_help_overlay(f:&mut Frame,area:Rect){
    let w=46u16;let h=14u16;
    let x=area.width.saturating_sub(w)/2;let y=area.height.saturating_sub(h)/2;
    let popup=Rect{x,y,width:w.min(area.width),height:h.min(area.height)};
    f.render_widget(Clear,popup);
    let help=vec![
        Line::from(Span::styled("┌─── Help ──────────────────────────┐",Style::default().fg(Theme::CYAN).add_modifier(Modifier::BOLD))),
        Line::from(Span::styled("│  /  Command mode    Tab  Switch view │",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  R  Build menu      B    Quick build │",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  D  Deploy          C    VM connect  │",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  S  Status refresh  H    Health check│",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  J  Journal         L    Toggle deploy│",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  1-9 Restart svc    Esc  Close overlay│",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  ↑↓ Scroll logs     0/End=bottom    │",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  ?  This help       Q    Quit        │",Style::default().fg(Theme::WHITE))),
        Line::from(Span::styled("│  Tab=autocomplete in command mode    │",Style::default().fg(Theme::DARK_GRAY))),
        Line::from(Span::styled("└────────────────────────────────────┘",Style::default().fg(Theme::CYAN))),
        Line::from(Span::styled("   Press any key to close",Style::default().fg(Theme::DARK_GRAY))),
    ];
    f.render_widget(Paragraph::new(Text::from(help)),popup);
}

fn process_event(
    app: &mut App, event: AppEvent,
    tx: &mpsc::UnboundedSender<AppEvent>,
    journal_task: &mut Option<tokio::task::JoinHandle<()>>,
) {
    match event {
        AppEvent::BuildOutput(line) => app.log(&line),
        AppEvent::BuildComplete => { app.building = false; app.log("[SYSTEM] Build finished"); }
        AppEvent::ServiceStatus(info) => { app.service_status = info; app.log("[STATUS] Service status refreshed"); }
        AppEvent::JournalLine{line} => app.journal_add(&line),
        AppEvent::Resize => {}
        AppEvent::MouseClick{_row,_col} => {
            if _row<=1{
                let views=[View::Logs,View::Status,View::Journal,View::Commands];
                let idx=(_col/11)as usize;
                if idx<views.len(){app.view=views[idx].clone();}
            }
        }
        AppEvent::MouseScroll{_delta,..} => {
            if app.view==View::Logs{
                if _delta<0{app.log_scroll_offset=(app.log_scroll_offset+3).min(app.logs.len().saturating_sub(10));}
                else{app.log_scroll_offset=app.log_scroll_offset.saturating_sub(3);}
            }
        }
        AppEvent::FileChange{rust_crates,frontend} => {
            for c in &rust_crates{if c=="__workspace__"{app.changed_rust.clear();}else{app.changed_rust.insert(c.clone());}}
            if frontend{app.changed_fe=true;}
            if app.do_watch&&!app.building&&app.vm_online&&app.auto_deploy{
                if !app.changed_rust.is_empty()||app.changed_fe{
                    app.log("[WATCH] Changes detected — auto-rebuilding...");app.building=true;
                    let only=if !app.changed_rust.is_empty(){Some(app.changed_rust.clone())}else{None};
                    let tx2=tx.clone();let ctx=app.ctx_clone();
                    tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;
                        let _=a.build_rust(only,&tx2).await;let _=a.build_frontend(&tx2).await;let _=tx2.send(AppEvent::BuildComplete);let _=tx2.send(AppEvent::BuildComplete);});
                }
            }
        }
        AppEvent::Key(code) => {
            // ? toggles help
            if code==KeyCode::Char('?'){app.show_help=!app.show_help;return;}
            if code==KeyCode::Esc&&app.show_help{app.show_help=false;return;}

            // Mode-dependent
            let mut handled=false;
            let mut next_mode:Option<Mode>=None;
            match &mut app.mode {
                Mode::Command{input,cursor,suggestions,selected_suggestion}=>{
                    *suggestions=get_suggestions(input).iter().map(|s|s.to_string()).collect();
                    *selected_suggestion = (*selected_suggestion).min(suggestions.len().saturating_sub(1));
                    handled=true;
                    match code {
                        KeyCode::Esc=>app.mode=Mode::Normal,
                        KeyCode::Enter=>{let cmd=input.clone();app.mode=Mode::Normal;let tx2=tx.clone();app.run_command(&cmd,&tx2);}
                        KeyCode::Tab=>{if !suggestions.is_empty(){*input=suggestions[*selected_suggestion].clone();*cursor=input.len();*suggestions=get_suggestions(input).iter().map(|s|s.to_string()).collect();}}
                        KeyCode::Up=>{if !suggestions.is_empty(){*selected_suggestion=selected_suggestion.saturating_sub(1);*input=suggestions[*selected_suggestion].clone();*cursor=input.len();}}
                        KeyCode::Down=>{if !suggestions.is_empty(){*selected_suggestion=(*selected_suggestion+1).min(suggestions.len()-1);*input=suggestions[*selected_suggestion].clone();*cursor=input.len();}}
                        KeyCode::Char(c)=>{input.insert(*cursor,c);*cursor+=1;}
                        KeyCode::Backspace=>{if *cursor>0{input.remove(*cursor-1);*cursor-=1;}}
                        KeyCode::Left=>{if *cursor>0{*cursor-=1;}}
                        KeyCode::Right=>{if *cursor<input.len(){*cursor+=1;}}
                        KeyCode::Home=>{*cursor=0;}
                        KeyCode::End=>{*cursor=input.len();}
                        _=>{handled=false;}
                    }
                }
                Mode::BuildMenu{cursor}=>{
                    handled=true;
                    match code {
                        KeyCode::Esc=>app.mode=Mode::Normal,
                        KeyCode::Up=>{*cursor=cursor.saturating_sub(1);}
                        KeyCode::Down=>{*cursor=(*cursor+1).min(2);}
                        KeyCode::Enter=>{
                            let choice=*cursor;
                            if choice==2{app.mode=Mode::BuildSelect{cursor:0,selected:HashSet::new()};return;}
                            app.mode=Mode::Normal;
                            if !app.vm_online{app.log("[BUILD] VM offline");return;}
                            if app.building{app.log("[BUILD] Already building");return;}
                            app.building=true;app.log(&format!("[BUILD] Build: {}",["All","Changed"][choice]));
                            let tx2=tx.clone();let ctx=app.ctx_clone();
                            let only=if choice==1&&!app.changed_rust.is_empty(){Some(app.changed_rust.clone())}else{None};
                            tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;let _=a.build_rust(only,&tx2).await;let _=a.build_frontend(&tx2).await;let _=tx2.send(AppEvent::BuildComplete);});
                        }
                        _=>{}
                    }
                }
                Mode::BuildSelect{cursor,selected}=>{
                    handled=true;
                    match code {
                        KeyCode::Esc=>next_mode=Some(Mode::BuildMenu{cursor:2}),
                        KeyCode::Up=>{*cursor=cursor.saturating_sub(1);}
                        KeyCode::Down=>{*cursor=(*cursor+1).min(app.services.len().saturating_sub(1));}
                        KeyCode::Char(' ')=>{
                            if selected.contains(cursor){selected.remove(cursor);}
                            else{selected.insert(*cursor);}
                        }
                        KeyCode::Char('a')=>{
                            if selected.len()==app.services.len(){selected.clear();}
                            else{for i in 0..app.services.len(){selected.insert(i);}}
                        }
                        KeyCode::Enter=>{
                            if selected.is_empty(){next_mode=Some(Mode::BuildMenu{cursor:2});}
                            else{
                                let only:HashSet<String>=selected.iter().map(|&i|app.services[i].clone()).collect();
                                app.log(&format!("[BUILD] Build: {} services",only.len()));
                                if !app.vm_online{app.log("[BUILD] VM offline");}
                                else if app.building{app.log("[BUILD] Already building");}
                                else{
                                    app.building=true;
                                    let tx2=tx.clone();let ctx=app.ctx_clone();
                                    tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;let _=a.build_rust(Some(only),&tx2).await;let _=tx2.send(AppEvent::BuildComplete);});
                                }
                                next_mode=Some(Mode::Normal);
                            }
                        }
                        _=>{}
                    }
                }
                Mode::Normal=>{}
            }
            if handled{return;}

            if let Some(m)=next_mode{app.mode=m;return;}

            // Normal mode keys
            match code {
                KeyCode::Char('q')|KeyCode::Char('Q')=>app.should_quit=true,
                // Log scrolling
                KeyCode::Up if app.view==View::Logs=>{let max=10usize;app.log_scroll_offset=(app.log_scroll_offset+1).min(app.logs.len().saturating_sub(max));}
                KeyCode::Down if app.view==View::Logs=>{app.log_scroll_offset=app.log_scroll_offset.saturating_sub(1);}
                KeyCode::PageUp if app.view==View::Logs=>{let half=5usize;app.log_scroll_offset=(app.log_scroll_offset+half).min(app.logs.len().saturating_sub(10));}
                KeyCode::PageDown if app.view==View::Logs=>{app.log_scroll_offset=app.log_scroll_offset.saturating_sub(5);}
                KeyCode::Home if app.view==View::Logs=>{app.log_scroll_offset=app.logs.len().saturating_sub(10);}
                KeyCode::End if app.view==View::Logs=>{app.log_scroll_offset=0;}
                KeyCode::Char('0') if app.view==View::Logs=>{app.log_scroll_offset=0;}
                KeyCode::Char('/')=>app.mode=Mode::Command{input:String::new(),cursor:0,suggestions:Vec::new(),selected_suggestion:0},
                KeyCode::Tab|KeyCode::BackTab=>{
                    let views=[View::Logs,View::Status,View::Journal,View::Commands];
                    let cur=views.iter().position(|v|*v==app.view).unwrap_or(0);
                    let next=if code==KeyCode::Tab{(cur+1)%views.len()}else{(cur+views.len()-1)%views.len()};
                    app.view=views[next].clone();
                    if next!=1{if let Some(h)=journal_task.take(){h.abort();}}
                    if app.view==View::Status&&app.vm_online{let tx2=tx.clone();let svcs=app.services.clone();let ssha=app.ssh_args();
                        tokio::spawn(async move{let mut info=HashMap::new();for svc in svcs{let mut a=ssha.clone();
                            a.push(format!("systemctl is-active {} 2>/dev/null | tr -d '\\n'; echo -n '|'; test -f /usr/bin/{} && echo yes || echo no",svc,svc));
                            if let Ok(Ok(o))=tokio::time::timeout(Duration::from_secs(5),TokioCommand::new("ssh").args(&a).output()).await{
                                let out=String::from_utf8_lossy(&o.stdout);let parts:Vec<&str>=out.split('|').collect();
                                info.insert(svc.clone(),ServiceInfo{status:parts.first().unwrap_or(&"?").trim().to_string(),has_binary:parts.get(1).unwrap_or(&"no").trim()=="yes"});}}
                            let _=tx2.send(AppEvent::ServiceStatus(info));});}
                }
                KeyCode::Char('r')|KeyCode::Char('R')=>app.mode=Mode::BuildMenu{cursor:0},
                KeyCode::Char('b')|KeyCode::Char('B')=>{
                    if app.building{app.log("[BUILD] Already building");}else if !app.vm_online{app.log("[BUILD] VM offline");}
                    else{app.building=true;app.log("[BUILD] Full rebuild");let tx2=tx.clone();let ctx=app.ctx_clone();
                        tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;let _=a.build_rust(None,&tx2).await;let _=a.build_frontend(&tx2).await;let _=tx2.send(AppEvent::BuildComplete);});}
                }
                KeyCode::Char('c')|KeyCode::Char('C')=>{
                    app.log("[VM] Connecting...");
                    let tx2=tx.clone(); let ctx=app.ctx_clone();
                    tokio::spawn(async move{
                        let mut a=ctx_to_app(ctx);
                        let was=a.vm_online; a.check_vm().await;
                        if a.vm_online{a.refresh_services().await;}
                        let _=tx2.send(AppEvent::BuildOutput(
                            if a.vm_online{if !was{"[VM] Came online!"}else{"[VM] Connected!"}}
                            else{"[VM] Still offline"}.into()
                        ));
                    });
                }
                KeyCode::Char('d')|KeyCode::Char('D')=>{
                    if !app.vm_online{app.log("[DEPLOY] VM offline");}else{let tx2=tx.clone();let ctx=app.ctx_clone();
                        tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;let _=a.deploy_binaries(&tx2).await;});}
                }
                KeyCode::Char('l')|KeyCode::Char('L')=>{app.auto_deploy=!app.auto_deploy;app.log(&format!("[CONFIG] Auto-deploy: {}",if app.auto_deploy{"ON"}else{"OFF"}));}
                KeyCode::Char('s')|KeyCode::Char('S')=>{
                    app.log("[STATUS] Refreshing...");app.view=View::Status;
                    if app.vm_online{let tx2=tx.clone();let svcs=app.services.clone();let ssha=app.ssh_args();
                        tokio::spawn(async move{let mut info=HashMap::new();for svc in svcs{let mut a=ssha.clone();
                            a.push(format!("systemctl is-active {} 2>/dev/null | tr -d '\\n'; echo -n '|'; test -f /usr/bin/{} && echo yes || echo no",svc,svc));
                            if let Ok(Ok(o))=tokio::time::timeout(Duration::from_secs(5),TokioCommand::new("ssh").args(&a).output()).await{
                                let out=String::from_utf8_lossy(&o.stdout);let parts:Vec<&str>=out.split('|').collect();
                                info.insert(svc.clone(),ServiceInfo{status:parts.first().unwrap_or(&"?").trim().to_string(),has_binary:parts.get(1).unwrap_or(&"no").trim()=="yes"});}}
                            let _=tx2.send(AppEvent::ServiceStatus(info));});}
                }
                KeyCode::Char('h')|KeyCode::Char('H')=>{app.log("[HEALTH] Health check");
                    if app.vm_online{
                        let tx2=tx.clone(); let ctx=app.ctx_clone();
                        tokio::spawn(async move{
                            let a=ctx_to_app(ctx);
                            if let Ok(h)=a.ssh_exec("curl -sf --max-time 3 http://127.0.0.1:8126/api/health 2>/dev/null || echo FAIL").await{
                                let _=tx2.send(AppEvent::BuildOutput(format!("  {}",if h.contains("\"status\":\"ok\""){"✓ API OK"}else{"✗ API unreachable"})));
                            }
                            if let Ok(d)=a.ssh_exec("df -h / 2>/dev/null | tail -1").await{
                                let _=tx2.send(AppEvent::BuildOutput(format!("  Disk: {}",d.trim())));
                            }
                        });
                    }else{app.log("  VM offline");}
                }
                KeyCode::Char('j')|KeyCode::Char('J')=>{app.view=View::Journal;
                    if app.vm_online{if let Some(h)=journal_task.take(){h.abort();}let tx2=tx.clone();let ctx=app.ctx_clone();
                        *journal_task=Some(tokio::spawn(async move{let a=ctx_to_app(ctx);let _=a.start_journal_stream(tx2).await;}));}
                    else{app.log("[JOURNAL] VM offline");}
                }
                KeyCode::Char('1')|KeyCode::Char('2')|KeyCode::Char('3')|KeyCode::Char('4')|
                KeyCode::Char('5')|KeyCode::Char('6')|KeyCode::Char('7')|KeyCode::Char('8')|KeyCode::Char('9')=>{
                    let idx=match code{KeyCode::Char(c)=>(c as u8-b'1')as usize,_=>0};
                    if idx<app.services.len()&&app.vm_online{let svc=app.services[idx].clone();let tx2=tx.clone();let ctx=app.ctx_clone();
                        tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;a.restart_service(&svc,&tx2).await;});}
                }
                _=>{}
            }
        }
    }
}

// ═══ Main ════════════════════════════════════════════════════════════════

#[tokio::main]
async fn main()->Result<()>{
    let args=Args::parse();let mut app=App::new(&args)?;
    enable_raw_mode()?;let mut stdout=std::io::stdout();
    execute!(stdout,EnterAlternateScreen,crossterm::event::EnableMouseCapture)?;
    let backend=CrosstermBackend::new(stdout);let mut terminal=Terminal::new(backend)?;

    let (event_tx,mut event_rx)=mpsc::unbounded_channel::<AppEvent>();

    let _watcher=if app.do_watch{Some(start_file_watcher(app.workspace.clone(),app.frontend_dir.clone(),event_tx.clone())?)}else{None};
    app.log("[SYSTEM] IORA Dev Watch ready. Checking VM...");app.dirty=true;
    if app.check_vm().await{app.log(&format!("[SYSTEM] VM online at {}:{}",app.vm_host,app.vm_port));app.refresh_services().await;
        app.log(&format!("[SYSTEM] {}/{} services active",app.active_services,app.total_services));}
    else{app.log("[SYSTEM] VM offline — start with ./dev-local.sh, then press C");}
    if !app.no_initial_build&&app.vm_online{let tx=event_tx.clone();let ctx=app.ctx_clone();app.building=true;app.dirty=true;
        tokio::spawn(async move{let mut a=ctx_to_app(ctx);a.vm_online=true;let _=a.build_rust(None,&tx).await;let _=a.build_frontend(&tx).await;let _=tx.send(AppEvent::BuildComplete);let _=tx.send(AppEvent::BuildOutput("[SYSTEM] Initial build complete".into()));let _=tx.send(AppEvent::BuildComplete);});}

    // Main loop: ratatui demo pattern — draw first, then poll for keys
    let poll_rate=Duration::from_millis(16); // responsive polling
    let mut last_tick=std::time::Instant::now();
    let mut last_vm_check=std::time::Instant::now();
    let mut journal_task:Option<tokio::task::JoinHandle<()>>=None;

    loop{
        // 1. Check keys FIRST (instant, non-blocking)
        while event::poll(Duration::from_millis(0)).unwrap_or(false){
            if let Ok(Event::Key(key))=event::read(){
                app.dirty=true;
                process_event(&mut app,AppEvent::Key(key.code),&event_tx,&mut journal_task);
            }
        }

        // 2. Drain a few background events
        for _ in 0..10{
            match event_rx.try_recv(){
                Ok(event)=>{process_event(&mut app,event,&event_tx,&mut journal_task);}
                Err(_)=>break
            }
        }

        // 3. Draw if dirty
        if app.dirty{
            app.cached_ts=Local::now().format("%H:%M:%S").to_string();
            terminal.draw(|f|render_ui(f,&app))?;
            app.dirty=false;
        }

        // 4. Wait for input (short timeout, unblocks on any key)
        let timeout=poll_rate.saturating_sub(last_tick.elapsed());
        if event::poll(timeout).unwrap_or(false){
            match event::read(){
                Ok(Event::Key(key))=>{app.dirty=true;process_event(&mut app,AppEvent::Key(key.code),&event_tx,&mut journal_task);}
                Ok(Event::Mouse(m))=>match m.kind{
                    MouseEventKind::Down(MouseButton::Left)=>process_event(&mut app,AppEvent::MouseClick{_row:m.row,_col:m.column},&event_tx,&mut journal_task),
                    MouseEventKind::ScrollDown=>process_event(&mut app,AppEvent::MouseScroll{_row:m.row,_col:m.column,_delta:-1},&event_tx,&mut journal_task),
                    MouseEventKind::ScrollUp=>process_event(&mut app,AppEvent::MouseScroll{_row:m.row,_col:m.column,_delta:1},&event_tx,&mut journal_task),
                    _=>{}
                },
                Ok(Event::Resize(_,_))=>{},
                _=>{}
            }
        }else{
            last_tick=std::time::Instant::now();
            if app.building{app.build_frame=app.build_frame.wrapping_add(1);}
        }

        // 4. VM check every 6 seconds
        if last_vm_check.elapsed()>=Duration::from_secs(6){
            last_vm_check=std::time::Instant::now();
            let was_online=app.vm_online;let tx2=event_tx.clone();let ctx=app.ctx_clone();
            tokio::spawn(async move{
                let mut a=ctx_to_app(ctx);a.vm_online=was_online;
                let was=a.vm_online;a.check_vm().await;
                if a.vm_online{a.refresh_services().await;}
                if was!=a.vm_online{let _=tx2.send(AppEvent::BuildOutput(if a.vm_online{"[VM] Came online!"}else{"[VM] Went offline!"}.into()));}
            });
        }

        if app.should_quit{break;}
    }

    disable_raw_mode()?;execute!(terminal.backend_mut(),LeaveAlternateScreen,crossterm::event::DisableMouseCapture)?;
    println!("bye.");Ok(())
}
