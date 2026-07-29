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
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::{
    process::Command as TokioCommand,
    sync::{mpsc, oneshot},
    time::interval,
};

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
const SELF_HEAL_INTERVAL_S: u64 = 60;
const STATUS_REFRESH_INTERVAL_S: u64 = 8;

// ═══ CLI ═════════════════════════════════════════════════════════════════

#[derive(Parser, Debug)]
#[command(name = "iora-dev-watch")]
struct Args {
    #[arg(long)]
    no_watch: bool,
    #[arg(long, default_value = "127.0.0.1")]
    vm_host: String,
    #[arg(long, default_value = "2222")]
    vm_port: u16,
    #[arg(long)]
    ssh_key: Option<String>,
    #[arg(long)]
    no_deploy: bool,
    #[arg(long)]
    no_initial_build: bool,
    /// Bridge port (iora-dev-bridge). Set to 0 to disable bridge mode.
    #[arg(long, default_value = "8101")]
    vm_bridge_port: u16,
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
            "-o".into(),
            "StrictHostKeyChecking=no".into(),
            "-o".into(),
            "IdentitiesOnly=yes".into(),
            "-o".into(),
            "BatchMode=yes".into(),
            "-o".into(),
            "LogLevel=ERROR".into(),
            "-o".into(),
            "ConnectTimeout=10".into(),
            "-o".into(),
            "ServerAliveInterval=60".into(),
            "-o".into(),
            "ServerAliveCountMax=60".into(),
            "-o".into(),
            "TCPKeepAlive=yes".into(),
            "-o".into(),
            "AddressFamily=inet".into(),
        ];
        #[cfg(unix)]
        {
            args.push("-o".into());
            args.push("UserKnownHostsFile=/dev/null".into());
        }
        #[cfg(windows)]
        {
            args.push("-o".into());
            args.push("UserKnownHostsFile=NUL".into());
        }
        args.push("-i".into());
        args.push(self.ssh_key.to_string_lossy().into());
        args.push("-p".into());
        args.push(self.vm_port.to_string());
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
        )
        .await
        .context("ssh timeout")??;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    async fn check_vm(&self) -> bool {
        matches!(self.ssh_exec("echo OK").await, Ok(ref s) if s.contains("OK"))
    }

    async fn refresh_services(&self) -> usize {
        if self.services.is_empty() {
            return 0;
        }
        let cmd = format!(
            "for s in {}; do st=$(systemctl is-active \"$s\" 2>/dev/null); [ -n \"$st\" ] || st=unknown; printf '%s\\n' \"$st\"; done",
            self.services.join(" ")
        );
        match self.ssh_exec(&cmd).await {
            Ok(out) => out.lines().filter(|l| *l == "active").count(),
            Err(_) => 0,
        }
    }

    async fn fetch_service_status(&self) -> Vec<(String, bool)> {
        let mut result = Vec::with_capacity(self.services.len());
        if self.services.is_empty() {
            return result;
        }
        // Probe multiple bin directories — IORA OS may use /usr/local/bin or
        // /opt/iora/bin depending on the image. Reporting "binary missing"
        // when it's just installed elsewhere caused phantom auto-builds.
        let script = format!(
            "for s in {}; do \
                bin=no; \
                for d in /usr/bin /usr/local/bin /opt/iora/bin /home/iora/.cargo/bin; do \
                    if [ -x \"$d/$s\" ]; then bin=yes; break; fi; \
                done; \
                st=$(systemctl is-active \"$s\" 2>/dev/null); \
                [ -n \"$st\" ] || st=unknown; \
                printf '%s|%s\\n' \"$st\" \"$bin\"; \
             done",
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
            for _ in self.services.iter() {
                result.push(("?".into(), false));
            }
        }
        result
    }

    fn build_rust_cmd(&self, only: Option<&HashSet<String>>) -> String {
        let mut cmd = format!(
            "cd {} && CARGO_BUILD_JOBS=$(nproc) /home/iora/.cargo/bin/cargo build",
            self.vm_workspace
        );
        if let Some(crates) = only {
            for c in crates {
                cmd.push_str(&format!(" -p {}", c));
            }
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
            "-a".into(),
            "--delete".into(),
            "--exclude=.git".into(),
            "--exclude=target".into(),
            "--exclude=node_modules".into(),
            "--exclude=.cache".into(),
            "--exclude=buildroot-*".into(),
            "--exclude=releases".into(),
            "--exclude=*.img".into(),
            "--exclude=*.qcow2".into(),
            "--exclude=*.iso".into(),
            "--exclude=.iora-dev".into(),
            "--exclude=dist".into(),
            "--exclude=__pycache__".into(),
        ];
        args.push("-e".into());
        args.push(format!("ssh {}", ssh_opts.join(" ")));
        args.push(format!("{}/", self.repo_root.display()));
        args.push(format!("root@{}:/home/iora/iora/", self.vm_host));
        let _ = bg_cmd("rsync")
            .args(&args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        let _ = self
            .ssh_exec("chown -R iora:iora /home/iora/iora 2>/dev/null")
            .await;
    }

    async fn build_rust(&self, only: Option<HashSet<String>>, tx: mpsc::UnboundedSender<AppEvent>) {
        let label = if let Some(ref c) = only {
            format!("{} crates", c.len())
        } else {
            "all".into()
        };
        let _ = tx.send(AppEvent::Log(format!("──[Rust — {}]──", label)));
        let _ = self.ssh_exec("su - iora -c 'test -f /home/iora/.cargo/bin/cargo || curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal' 2>&1").await;

        // Check disk space — clean only incremental cache (not deps/)
        let disk_check = self
            .ssh_exec(
                "df -BG /home/iora/iora/iora-os/backend | tail -1 | awk '{print $4}' | tr -d 'G'",
            )
            .await;
        let free_gb: u32 = disk_check
            .as_ref()
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(99);
        if free_gb < 5 {
            let _ = tx.send(AppEvent::Log(format!(
                "[RUST] Disk low ({free_gb}G free), cleaning incremental cache..."
            )));
            // Remove only incremental compilation cache (~5-10GB), not compiled deps
            let _ = self.ssh_exec("find /home/iora/iora/iora-os/backend/target -type d -name incremental -exec rm -rf {} + 2>/dev/null; find /home/iora/iora/iora-os/backend/target -name '*.d' -delete 2>/dev/null; echo OK").await;
        }

        self.sync_sources(&tx).await;
        let cmd = self.build_rust_cmd(only.as_ref());
        let full = format!("su - iora -c '{}' 2>&1", cmd);
        let _ = tx.send(AppEvent::Log(format!("[RUST] {}", cmd)));

        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut args = self.ssh_args();
        args.push(full);
        let spawn = bg_cmd("ssh")
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();
        let mut child = match spawn {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(AppEvent::Log(format!("[RUST] spawn failed: {e}")));
                return;
            }
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
        let _ = tx.send(AppEvent::Log(if ok {
            "[RUST] ✓ Build OK".into()
        } else {
            "[RUST] ✗ Build FAILED".into()
        }));
    }

    /// Hard-reset deployment state on the VM: wipe persisted bin-hashes and
    /// remove every iora-* binary from the standard install dirs. Used by the
    /// force-redeploy command (Shift-D) when binaries are reported missing
    /// despite a previous deploy claiming success — typically because /usr/bin
    /// is a tmpfs that gets wiped on VM reboot while /var/lib persists.
    async fn wipe_hashes_and_bins(&self, tx: &mpsc::UnboundedSender<AppEvent>) {
        let _ = tx.send(AppEvent::Log(
            "[DEPLOY] Wiping bin-hashes + removing iora-* from /usr/bin /usr/local/bin /opt/iora/bin".into(),
        ));
        let script = r#"set +e
rm -rf /var/lib/iora/.bin-hashes 2>/dev/null
for d in /usr/bin /usr/local/bin /opt/iora/bin; do
    [ -d "$d" ] && find "$d" -maxdepth 1 -name 'iora-*' -type f -delete 2>/dev/null
done
echo "wiped"
"#;
        if let Ok(out) = self.ssh_exec(script).await {
            for line in out.lines() {
                if !line.trim().is_empty() {
                    let _ = tx.send(AppEvent::Log(format!("[DEPLOY] {line}")));
                }
            }
        }
    }

    async fn deploy_binaries(&self, tx: mpsc::UnboundedSender<AppEvent>) {
        let _ = tx.send(AppEvent::Log("[DEPLOY] Deploying...".into()));
        let script = self.deploy_script();
        // Stream the deploy via spawn() instead of ssh_exec(): the script can
        // easily exceed the 60s ssh_exec timeout when 27+ systemd units need
        // daemon-reload/enable/restart. Streaming also gives live progress.
        let cmd = format!(
            "cat > /tmp/iora-deploy.sh << 'DEPLOYEOF'\n{}\nDEPLOYEOF\nbash /tmp/iora-deploy.sh; rc=$?; rm -f /tmp/iora-deploy.sh; exit $rc",
            script
        );
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut args = self.ssh_args();
        args.push(cmd);
        let spawn = bg_cmd("ssh")
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();
        let mut child = match spawn {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(AppEvent::Log(format!("[DEPLOY] ✗ spawn: {e}")));
                return;
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let tx_out = tx.clone();
        let tx_err = tx.clone();
        let t1 = tokio::spawn(async move {
            if let Some(s) = stdout {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx_out.send(AppEvent::Log(format!("[DEPLOY] {line}")));
                }
            }
        });
        let t2 = tokio::spawn(async move {
            if let Some(s) = stderr {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx_err.send(AppEvent::Log(format!("[DEPLOY] ! {line}")));
                }
            }
        });
        let _ = t1.await;
        let _ = t2.await;
        let _ = child.wait().await;
        let active = self.refresh_services().await;
        let _ = tx.send(AppEvent::ServiceCount(active));
    }

    fn deploy_script(&self) -> String {
        let ws = &self.vm_workspace;
        let svc_list = self.services.join(" ");
        format!(
            r#"#!/bin/bash
set +e
mkdir -p /var/lib/iora/.bin-hashes
# Pick a writable system bin dir. /usr/bin is read-only on the IORA OS
# (buildroot squashfs) image; /usr/local/bin is the persistent overlay.
INSTALL_DIR=/usr/bin
if ! touch "$INSTALL_DIR/.iora-write-test" 2>/dev/null; then
    INSTALL_DIR=/usr/local/bin
    mkdir -p "$INSTALL_DIR"
fi
rm -f "$INSTALL_DIR/.iora-write-test" 2>/dev/null
echo "install_dir: $INSTALL_DIR"
deployed=0
skipped=0
restart_list=""
home_changed=0
units_added=0
reload_needed=0
for svc in {svc_list}; do
    # Locate the freshest binary across debug/ and release/.
    bin=""
    for cand in "{ws}/target/debug/$svc" "{ws}/target/release/$svc"; do
        [ -x "$cand" ] && bin="$cand" && break
    done
    if [ -z "$bin" ]; then
        echo "skip $svc (not built)"
        continue
    fi
    short="${{svc#iora-}}"
    cur=$(sha256sum "$bin" | awk '{{print $1}}')
    prev=$(cat "/var/lib/iora/.bin-hashes/$svc" 2>/dev/null)
    # Look for an already-installed copy in any standard bin dir.
    # Must match the dirs probed by fetch_service_status — otherwise we
    # mark as "skip" while Status reports "binary missing".
    installed_at=""
    for d in /usr/bin /usr/local/bin /opt/iora/bin /home/iora/.cargo/bin; do
        if [ -x "$d/$svc" ]; then installed_at="$d/$svc"; break; fi
    done
    # Dev-VMs can boot IORA OS units with hardening drop-ins copied from the
    # image. On this kernel/buildroot combo those namespace options can fail
    # before the binary starts (systemd status=226/NAMESPACE). Keep dev
    # services runnable while preserving the real service units.
    mkdir -p "/etc/systemd/system/$svc.service.d" "/etc/iora/db-credentials" "/opt/iora/build/$svc/data" /tmp/iora-sandboxes /var/log/iora "/var/lib/iora/$svc"
    cat > "/etc/systemd/system/$svc.service.d/30-dev-namespaces.conf" <<'NSDROP'
[Service]
ProtectSystem=no
ProtectHome=no
PrivateTmp=no
PrivateDevices=no
PrivateUsers=no
PrivateMounts=no
PrivateNetwork=no
NoNewPrivileges=no
RestrictNamespaces=no
RestrictAddressFamilies=
SystemCallFilter=
ReadWritePaths=
ReadOnlyPaths=
InaccessiblePaths=
BindPaths=
BindReadOnlyPaths=
TemporaryFileSystem=
NSDROP
    reload_needed=1
    if [ "$cur" = "$prev" ] && [ -n "$installed_at" ]; then
        skipped=$((skipped+1))
        st=$(systemctl is-active "$svc" 2>/dev/null)
        if [ "$st" != "active" ]; then restart_list="$restart_list $svc"; fi
        continue
    fi
    if ! install -m 0755 "$bin" "$INSTALL_DIR/$svc" 2>/tmp/iora-install.err; then
        echo "install FAILED $svc: $(cat /tmp/iora-install.err 2>/dev/null)"
        rm -f /tmp/iora-install.err
        continue
    fi
    rm -f /tmp/iora-install.err
    [ -f "/etc/iora/db-credentials/$svc.env" ] || echo "DATABASE_URL=postgres://root:iora@localhost/iora_$short" > "/etc/iora/db-credentials/$svc.env"
    if [ ! -f "/etc/iora/$svc.env" ]; then
        if [ "$svc" = "iora-home" ]; then
            printf 'DATABASE_URL=postgres://root:iora@localhost:5432/iora_%s\nRUST_LOG=%s=debug\nIORA_BOOTSTRAP_ADMIN_USER=admin\nIORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234\n' "$short" "$svc" > "/etc/iora/$svc.env"
        else
            printf 'DATABASE_URL=postgres://root:iora@localhost:5432/iora_%s\nRUST_LOG=%s=debug\n' "$short" "$svc" > "/etc/iora/$svc.env"
        fi
    fi
    # Auto-install a minimal systemd unit if none exists yet so the binary
    # actually gets started — otherwise install succeeds but Status keeps
    # showing the service as inactive/failed forever. We defer daemon-reload
    # to one batched call at the end (per-iteration reload would take 30+s
    # for 27 services and blow the ssh timeout).
    if ! systemctl list-unit-files "$svc.service" --no-legend 2>/dev/null | grep -q "^$svc\.service"; then
        cat > "/etc/systemd/system/$svc.service" <<UNIT
[Unit]
Description=$svc (auto-installed by iora-dev-watch)
After=network-online.target

[Service]
EnvironmentFile=-/etc/iora/$svc.env
EnvironmentFile=-/etc/iora/db-credentials/$svc.env
ExecStart=$INSTALL_DIR/$svc
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
        units_added=1
    fi
    echo "$cur" > "/var/lib/iora/.bin-hashes/$svc"
    restart_list="$restart_list $svc"
    [ "$svc" = "iora-home" ] && home_changed=1
    deployed=$((deployed+1))
    echo "✓ $svc -> $INSTALL_DIR/$svc"
done
# Single batched daemon-reload (much faster than per-service).
if [ "$units_added" = "1" ]; then
    reload_needed=1
fi
if [ "$reload_needed" = "1" ]; then
    systemctl daemon-reload 2>/dev/null
fi
# Fire restarts in parallel and bound the wait — a stuck service must not
# block the whole deploy past the ssh timeout.
for svc in $restart_list; do
    (
        systemctl reset-failed "$svc" 2>/dev/null
        timeout 8 systemctl restart "$svc" 2>/dev/null \
            || timeout 8 systemctl start "$svc" 2>/dev/null
    ) &
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
"#
        )
    }

    async fn build_frontend(&self, tx: mpsc::UnboundedSender<AppEvent>, auto_deploy: bool) {
        let fe = match &self.frontend_dir {
            Some(d) => d.clone(),
            None => return,
        };
        let _ = tx.send(AppEvent::Log("──[Frontend]──".into()));
        // If dist/ already exists (pre-built by dev-local.ps1), skip build
        if fe.join("dist").is_dir() && !fe.join("node_modules").is_dir() {
            let _ = tx.send(AppEvent::Log(
                "[FE] Using pre-built dist/ (from dev-local.ps1)".into(),
            ));
            if auto_deploy {
                self.deploy_frontend(tx).await;
            }
            return;
        }
        // On Windows, npm is npm.cmd — use cmd /c to invoke it
        #[cfg(windows)]
        let npm_cmd = "cmd";
        #[cfg(not(windows))]
        let npm_cmd = "npm";
        if !fe.join("node_modules").is_dir() {
            let _ = tx.send(AppEvent::Log("[FE] npm install...".into()));
            let mut cmd = bg_cmd(npm_cmd);
            #[cfg(windows)]
            {
                cmd.arg("/c").arg("npm");
            }
            let st = cmd
                .args(["install", "--no-audit", "--no-fund"])
                .current_dir(&fe)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
            if !matches!(st, Ok(s) if s.success()) {
                let _ = tx.send(AppEvent::Log("[FE] ✗ npm install FAILED".into()));
                return;
            }
        }
        let _ = tx.send(AppEvent::Log("[FE] npm run build...".into()));
        let mut cmd = bg_cmd(npm_cmd);
        #[cfg(windows)]
        {
            cmd.arg("/c").arg("npm");
        }
        let out = match cmd
            .args(["run", "build"])
            .current_dir(&fe)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
        {
            Ok(o) => o,
            Err(e) => {
                let _ = tx.send(AppEvent::Log(format!("[FE] npm not available ({e})")));
                // Fallback: check if dist/ exists from dev-local.ps1
                if fe.join("dist").is_dir() {
                    let _ = tx.send(AppEvent::Log("[FE] Using pre-built dist/ instead".into()));
                    if auto_deploy {
                        self.deploy_frontend(tx).await;
                    }
                }
                return;
            }
        };
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if !line.trim().is_empty() {
                let _ = tx.send(AppEvent::Log(format!("[FE] {}", line)));
            }
        }
        if out.status.success() {
            let _ = tx.send(AppEvent::Log("[FE] ✓ Build OK".into()));
            if auto_deploy {
                self.deploy_frontend(tx).await;
            }
        } else {
            let _ = tx.send(AppEvent::Log("[FE] ✗ Build FAILED".into()));
        }
    }

    async fn deploy_frontend(&self, tx: mpsc::UnboundedSender<AppEvent>) {
        let fe = match &self.frontend_dir {
            Some(d) => d.clone(),
            None => return,
        };
        let dist = fe.join("dist");
        if !dist.is_dir() {
            return;
        }
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
            Err(e) => {
                let _ = tx.send(AppEvent::Log(format!("[FE] tar spawn: {e}")));
                return;
            }
        };
        let Some(tar_out) = tar_child.stdout.take() else {
            return;
        };
        #[cfg(unix)]
        let stdin = match tar_out.into_owned_fd() {
            Ok(fd) => std::process::Stdio::from(fd),
            Err(_) => {
                let _ = tx.send(AppEvent::Log("[FE] tar stdout fd error".into()));
                return;
            }
        };
        #[cfg(windows)]
        let stdin = match tar_out.into_owned_handle() {
            Ok(h) => std::process::Stdio::from(h),
            Err(_) => {
                let _ = tx.send(AppEvent::Log("[FE] tar stdout handle error".into()));
                return;
            }
        };
        let status = bg_cmd("ssh")
            .args(&ssh_args)
            .stdin(stdin)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        let _ = tar_child.wait().await;
        let _ = tx.send(AppEvent::Log(if matches!(status, Ok(s) if s.success()) {
            "[FE] ✓ Deployed".into()
        } else {
            "[FE] ✗ Deploy FAILED".into()
        }));
    }

    async fn restart_service(&self, svc: String, tx: mpsc::UnboundedSender<AppEvent>) {
        let cmd = format!(
            "systemctl reset-failed {svc} 2>/dev/null; systemctl restart {svc} 2>/dev/null || systemctl start {svc} 2>/dev/null || true; sleep 1; systemctl is-active {svc} 2>/dev/null | tr -d '\\n'"
        );
        let st = self.ssh_exec(&cmd).await.unwrap_or_else(|_| "?".into());
        let _ = tx.send(AppEvent::Log(format!("[RESTART] {svc} → {st}")));
    }

    async fn service_action(
        &self,
        svc: String,
        action: &'static str,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) {
        let cmd = match action {
            "start" => format!("systemctl start {svc} 2>/dev/null || true; sleep 1; systemctl is-active {svc} 2>/dev/null | tr -d '\\n'"),
            "stop" => format!("systemctl stop {svc} 2>/dev/null || true; sleep 1; systemctl is-active {svc} 2>/dev/null | tr -d '\\n'"),
            _ => format!("systemctl is-active {svc} 2>/dev/null | tr -d '\\n'"),
        };
        let st = self.ssh_exec(&cmd).await.unwrap_or_else(|_| "?".into());
        let _ = tx.send(AppEvent::Log(format!("[SERVICE] {action} {svc} → {st}")));
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
        let svc_list = self.services.join(" ");
        let script = format!(
            r#"set +e
out=""
missing=""
mkdir -p /var/lib/iora/.bin-hashes
# 0) Detect missing iora-* binaries across every standard bin directory.
#    Always include the bridge so it gets auto-bootstrapped even when no
#    services were discovered yet.
for b in iora-dev-bridge {svc_list}; do
    found=""
    for d in /usr/bin /usr/local/bin /opt/iora/bin /home/iora/.cargo/bin; do
        if [ -x "$d/$b" ]; then found="$d/$b"; break; fi
    done
    if [ -z "$found" ]; then
        missing="${{missing}}${{b}} "
        # Drop any stale hash so the next deploy is forced to (re)install.
        rm -f "/var/lib/iora/.bin-hashes/$b"
    fi
done
if [ -n "$missing" ]; then
    out="${{out}}missing: ${{missing}}\n"
fi
# 0b) IORA OS production units are strongly sandboxed. In the dev VM this can
#     fail at systemd namespace setup time (status=226/NAMESPACE), before the
#     service binary is even executed. Keep the real unit files intact and add
#     a dev-only drop-in that relaxes namespace features whenever needed.
reload_needed=0
for svc in {svc_list}; do
    if systemctl list-unit-files "$svc.service" --no-legend 2>/dev/null | grep -q "^$svc\.service"; then
        mkdir -p "/etc/systemd/system/$svc.service.d" /tmp/iora-sandboxes /var/log/iora "/var/lib/iora/$svc" "/opt/iora/build/$svc/data"
        tmp="/tmp/iora-dev-namespaces-$svc.conf"
        cat > "$tmp" <<'NSDROP'
[Service]
ProtectSystem=no
ProtectHome=no
PrivateTmp=no
PrivateDevices=no
PrivateUsers=no
PrivateMounts=no
PrivateNetwork=no
NoNewPrivileges=no
RestrictNamespaces=no
RestrictAddressFamilies=
SystemCallFilter=
ReadWritePaths=
ReadOnlyPaths=
InaccessiblePaths=
BindPaths=
BindReadOnlyPaths=
TemporaryFileSystem=
NSDROP
        dst="/etc/systemd/system/$svc.service.d/30-dev-namespaces.conf"
        if ! cmp -s "$tmp" "$dst" 2>/dev/null; then
            mv "$tmp" "$dst"
            reload_needed=1
            out="${{out}}dev-namespace-relax $svc\n"
        else
            rm -f "$tmp"
        fi
    fi
done
if [ "$reload_needed" = "1" ]; then
    systemctl daemon-reload 2>/dev/null
fi
# 1) iora-dev-bridge: start it if a unit file exists but it's not active.
bridge_state=$(systemctl is-active iora-dev-bridge 2>/dev/null)
if [ "$bridge_state" != "active" ]; then
    if systemctl list-unit-files iora-dev-bridge.service 2>/dev/null | grep -q iora-dev-bridge; then
        systemctl reset-failed iora-dev-bridge 2>/dev/null
        systemctl start iora-dev-bridge 2>/dev/null
        sleep 1
        new=$(systemctl is-active iora-dev-bridge 2>/dev/null)
        out="${{out}}bridge ${{bridge_state:-missing}} -> ${{new}}\n"
    else
        bridge_bin=""
        for d in /usr/bin /usr/local/bin /opt/iora/bin; do
            if [ -x "$d/iora-dev-bridge" ]; then bridge_bin="$d/iora-dev-bridge"; break; fi
        done
        if [ -n "$bridge_bin" ]; then
            cat > /etc/systemd/system/iora-dev-bridge.service <<UNIT
[Unit]
Description=IORA Dev Bridge (auto-installed by iora-dev-watch)
After=network-online.target
[Service]
ExecStart=$bridge_bin
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT
            systemctl daemon-reload 2>/dev/null
            systemctl enable --now iora-dev-bridge 2>/dev/null
            new=$(systemctl is-active iora-dev-bridge 2>/dev/null)
            out="${{out}}bridge installed-unit -> ${{new}}\n"
        else
            out="${{out}}bridge unavailable (no unit, no binary)\n"
        fi
    fi
fi
# 2) Reset+restart configured services that are not active. This handles both
#    failed units and skipped deploys where the binary is already current but
#    the service still needs to be started.
for svc in {svc_list}; do
    systemctl list-unit-files "$svc.service" --no-legend 2>/dev/null | grep -q "^$svc\.service" || continue
    u="$svc.service"
    state=$(systemctl is-active "$u" 2>/dev/null)
    [ "$state" = "active" ] && continue
    systemctl reset-failed "$u" 2>/dev/null
    timeout 8 systemctl restart "$u" 2>/dev/null || timeout 8 systemctl start "$u" 2>/dev/null
    sleep 1
    s=$(systemctl is-active "$u" 2>/dev/null)
    out="${{out}}restart ${{u}} ${{state:-unknown}} -> ${{s}}\n"
done
# 3) Disk pressure warning.
used=$(df --output=pcent / 2>/dev/null | tail -1 | tr -d ' %')
if [ -n "$used" ] && [ "$used" -ge 90 ]; then
    out="${{out}}disk root ${{used}}% full\n"
fi
printf '%s' "$out"
"#
        );
        if let Ok(output) = self.ssh_exec(&script).await {
            let output = output.replace("\\n", "\n");
            let valid_crates: HashSet<String> = self.services.iter().cloned().collect();
            let mut missing_crates: HashSet<String> = HashSet::new();
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                // Detect the `missing: foo bar` marker and turn it into an
                // AutoBuildMissing event so the main loop can kick a build.
                if let Some(rest) = line.strip_prefix("missing:") {
                    for crate_name in rest.split_whitespace() {
                        let crate_name = crate_name.trim_matches(|c: char| c == ',' || c == ';');
                        if valid_crates.contains(crate_name) {
                            missing_crates.insert(crate_name.to_string());
                        }
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
    ServiceLog {
        service: String,
        line: String,
    },
    BuildComplete,
    VmReachable(bool),
    ServiceCount(usize),
    ServiceStatus(Vec<(String, bool)>),
    Resource(ResourceData),
    HealthCheckDone,
    FileChange {
        rust_crates: HashSet<String>,
        frontend: bool,
    },
    /// Self-heal detected one or more iora-* binaries missing on the VM
    /// and asks the main loop to start an automatic build+deploy for them.
    AutoBuildMissing(HashSet<String>),
}

// ═══ App state ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, PartialEq)]
enum View {
    Logs,
    Status,
    ServiceLog,
    Journal,
    Commands,
    Resources,
    Deploy,
}

#[derive(Debug, Clone)]
enum Mode {
    Normal,
    Command {
        input: String,
    },
    BuildMenu {
        cursor: usize,
    },
    BuildSelect {
        cursor: usize,
        selected: HashSet<usize>,
    },
    DeploySelect {
        cursor: usize,
        selected: HashSet<usize>,
    },
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
    service_log_buf: VecDeque<String>,
    service_log_service: Option<String>,
    service_log_stop: Option<oneshot::Sender<()>>,
    command_log: VecDeque<String>,
    log_scroll: usize,
    service_log_scroll: usize,

    // Resources
    resource_data: ResourceData,
    resource_history: ResourceHistory,

    // Deploy tab
    deploy_cursor: usize,
    deploy_selected: HashSet<usize>,
    notify_on_ready: bool,
    status_cursor: usize,
    status_selected: Option<String>,
    help_scroll: usize,

    should_quit: bool,
    dirty: bool,
}

impl AppState {
    fn new(backend: Backend, auto_deploy: bool, do_watch: bool) -> Self {
        let total = backend.services.len();
        Self {
            backend,
            auto_deploy,
            do_watch,
            vm_online: false,
            bridge_connected: false,
            ssh_connected: false,
            building: false,
            build_start: None,
            last_build: "-".into(),
            active_services: 0,
            service_status: vec![("?".into(), false); total],
            last_status_refresh: None,
            bridge_uptime: 0,
            bridge_mem_avail: 0,
            changed_rust: HashSet::new(),
            changed_fe: false,
            last_auto_build_trigger: None,
            view: View::Logs,
            mode: Mode::Normal,
            show_help: false,
            log_buf: VecDeque::with_capacity(LOG_BUFFER_CAP),
            service_log_buf: VecDeque::with_capacity(LOG_BUFFER_CAP),
            service_log_service: None,
            service_log_stop: None,
            command_log: VecDeque::with_capacity(CMD_LOG_CAP),
            log_scroll: 0,
            service_log_scroll: 0,
            resource_data: ResourceData::default(),
            resource_history: ResourceHistory::new(60),
            deploy_cursor: 0,
            deploy_selected: HashSet::new(),
            notify_on_ready: true,
            status_cursor: 0,
            status_selected: None,
            help_scroll: 0,
            should_quit: false,
            dirty: true,
        }
    }

    fn push_log(&mut self, line: impl Into<String>) {
        for sanitized in sanitize_log(&line.into()) {
            // Skip duplicate [HEAL] lines — self-heal runs periodically and
            // would otherwise flood the log with identical restart messages.
            if sanitized.starts_with("[HEAL]") && self.log_buf.back() == Some(&sanitized) {
                continue;
            }
            if self.log_buf.len() >= LOG_BUFFER_CAP {
                self.log_buf.pop_front();
            }
            self.log_buf.push_back(sanitized);
        }
        self.dirty = true;
    }

    fn push_service_log(&mut self, line: impl Into<String>) {
        for sanitized in sanitize_log(&line.into()) {
            if self.service_log_buf.len() >= LOG_BUFFER_CAP {
                self.service_log_buf.pop_front();
            }
            self.service_log_buf.push_back(sanitized);
        }
        self.dirty = true;
    }

    fn stop_service_log(&mut self) {
        if let Some(stop) = self.service_log_stop.take() {
            let _ = stop.send(());
        }
    }

    fn push_cmd_log(&mut self, line: impl Into<String>) {
        for sanitized in sanitize_log(&line.into()) {
            if self.command_log.len() >= CMD_LOG_CAP {
                self.command_log.pop_front();
            }
            self.command_log.push_back(sanitized);
        }
        self.dirty = true;
    }
}

fn service_status_rank(status: &str) -> u8 {
    match status {
        "failed" => 0,
        "activating" | "deactivating" => 1,
        "inactive" => 2,
        "active" => 3,
        _ => 4,
    }
}

fn sorted_status_indices(state: &AppState) -> Vec<usize> {
    let mut indexed: Vec<usize> = (0..state.backend.services.len()).collect();
    indexed.sort_by_key(|&i| {
        let status = state
            .service_status
            .get(i)
            .map(|(s, _)| s.as_str())
            .unwrap_or("?");
        (
            service_status_rank(status),
            state.backend.services[i].as_str(),
        )
    });
    indexed
}

fn selected_status_row(state: &AppState) -> usize {
    let sorted = sorted_status_indices(state);
    if sorted.is_empty() {
        return 0;
    }
    if let Some(selected) = state.status_selected.as_deref() {
        if let Some(row) = sorted
            .iter()
            .position(|&i| state.backend.services[i] == selected)
        {
            return row;
        }
    }
    state.status_cursor.min(sorted.len().saturating_sub(1))
}

fn set_status_cursor(state: &mut AppState, row: usize) {
    let sorted = sorted_status_indices(state);
    if sorted.is_empty() {
        state.status_cursor = 0;
        state.status_selected = None;
        return;
    }
    let row = row.min(sorted.len().saturating_sub(1));
    state.status_cursor = row;
    state.status_selected = Some(state.backend.services[sorted[row]].clone());
}

fn selected_status_service(state: &AppState) -> Option<String> {
    let sorted = sorted_status_indices(state);
    let row = selected_status_row(state);
    sorted.get(row).map(|&i| state.backend.services[i].clone())
}

/// Strip control chars (ANSI escapes, bare \r, NUL, etc.) from a captured
/// line of subprocess output and split it on \r/\n so progress-overwrites
/// (e.g. vite's in-place rewrites) become individual log entries instead of
/// one mangled super-line. Without this, ratatui renders the raw control
/// bytes as visible garbage and adjacent rendered cells appear corrupted.
fn sanitize_log(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    for chunk in raw.split(['\r', '\n']) {
        let mut cleaned = String::with_capacity(chunk.len());
        let mut chars = chunk.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                // ANSI escape — consume until terminator.
                match chars.peek() {
                    Some(&'[') => {
                        chars.next();
                        // CSI: parameters then a final byte 0x40..=0x7e.
                        for cc in chars.by_ref() {
                            let v = cc as u32;
                            if (0x40..=0x7e).contains(&v) {
                                break;
                            }
                        }
                    }
                    Some(&']') => {
                        chars.next();
                        // OSC: terminate at BEL or ESC \\.
                        while let Some(cc) = chars.next() {
                            if cc == '\x07' {
                                break;
                            }
                            if cc == '\x1b' {
                                if matches!(chars.peek(), Some(&'\\')) {
                                    chars.next();
                                }
                                break;
                            }
                        }
                    }
                    _ => {
                        chars.next();
                    }
                }
            } else if c == '\t' {
                cleaned.push(' ');
            } else if !c.is_control() {
                cleaned.push(c);
            }
        }
        let trimmed = cleaned.trim_end();
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
    }
    out
}

// ═══ Helpers ═════════════════════════════════════════════════════════════

fn find_repo_root() -> Result<PathBuf> {
    if let Ok(o) = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
    {
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

#[allow(clippy::ptr_arg)]
fn find_workspace(r: &PathBuf) -> Result<PathBuf> {
    for c in &[r.join("iora-os/backend"), r.join("backend")] {
        if c.join("Cargo.toml").exists() {
            return Ok(c.clone());
        }
    }
    anyhow::bail!("no workspace")
}

#[allow(clippy::ptr_arg)]
fn find_frontend(r: &PathBuf) -> Option<PathBuf> {
    for d in &["frontend", "desktop"] {
        let p = r.join(d);
        if p.join("package.json").exists() {
            return Some(p);
        }
    }
    None
}

#[allow(clippy::ptr_arg)]
fn discover_services(w: &PathBuf) -> Vec<String> {
    let mut v = Vec::new();
    // Only long-running IORA OS systemd targets belong here. CLI/tools crates
    // such as iora-cli, iora-sign or iora-db-manager are buildable packages,
    // but not services the watcher should deploy/restart/status-check.
    for sub in &["services", "apps/system", "dev"] {
        let b = w.join(sub);
        if !b.is_dir() {
            continue;
        }
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
    v.sort();
    v.dedup();
    v
}

fn start_file_watcher(
    workspace: PathBuf,
    fe: Option<PathBuf>,
    tx: mpsc::UnboundedSender<AppEvent>,
    valid_services: Vec<String>,
) -> Result<RecommendedWatcher> {
    let dirs: Vec<PathBuf> = ["services", "shared", "tools", "apps", "dev"]
        .iter()
        .map(|s| workspace.join(s))
        .filter(|p| p.is_dir())
        .collect();
    let service_set: HashSet<String> = valid_services.into_iter().collect();
    let mut w: RecommendedWatcher =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            if !matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                return;
            }
            let mut rust = HashSet::new();
            let mut frontend = false;
            for p in &ev.paths {
                let s = p.to_string_lossy();
                if s.contains("iora-dev-watch") {
                    continue;
                }
                if s.ends_with(".rs") {
                    for c in p.components().rev() {
                        let cn = c.as_os_str().to_string_lossy();
                        if cn.starts_with("iora-") {
                            // If the changed crate is a shared library (not a service binary),
                            // rebuild everything — all services depend on shared crates.
                            if service_set.contains(cn.as_ref()) {
                                rust.insert(cn.to_string());
                            } else {
                                rust.insert("__workspace__".into());
                            }
                            break;
                        }
                    }
                }
                if s.contains("Cargo.toml") || s.contains("Cargo.lock") {
                    rust.insert("__workspace__".into());
                }
                if s.ends_with(".tsx")
                    || s.ends_with(".ts")
                    || s.ends_with(".jsx")
                    || s.ends_with(".css")
                    || s.ends_with(".html")
                {
                    frontend = true;
                }
            }
            if !rust.is_empty() || frontend {
                let _ = tx.send(AppEvent::FileChange {
                    rust_crates: rust,
                    frontend,
                });
            }
        })?;
    w.configure(NotifyConfig::default().with_poll_interval(Duration::from_secs(2)))?;
    for d in &dirs {
        let _ = w.watch(d, RecursiveMode::Recursive);
    }
    if let Some(f) = &fe {
        for s in &["src", "public"] {
            let d = f.join(s);
            if d.is_dir() {
                let _ = w.watch(&d, RecursiveMode::Recursive);
            }
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
    if state.building {
        state.push_log("[BUILD] Already building");
        return;
    }
    if !state.vm_online {
        state.push_log("[BUILD] VM offline");
        return;
    }
    state.building = true;
    state.build_start = Some(Instant::now());
    state.last_build = "Building...".into();
    let backend = state.backend.clone();
    let auto_deploy = state.auto_deploy;
    tokio::spawn(async move {
        if rust {
            backend.build_rust(only, tx.clone()).await;
        }
        if fe {
            backend.build_frontend(tx.clone(), auto_deploy).await;
        }
        if auto_deploy && rust {
            backend.deploy_binaries(tx.clone()).await;
        }
        let _ = tx.send(AppEvent::BuildComplete);
    });
}

fn spawn_deploy(state: &mut AppState, tx: mpsc::UnboundedSender<AppEvent>, force: bool) {
    if !state.vm_online {
        state.push_log("[DEPLOY] VM offline");
        return;
    }
    let backend = state.backend.clone();
    if force {
        state.push_log("[DEPLOY] Force-redeploy: wiping hashes & re-installing all");
    }
    tokio::spawn(async move {
        if force {
            backend.wipe_hashes_and_bins(&tx).await;
        }
        backend.deploy_binaries(tx).await;
    });
}

fn spawn_deploy_selected(state: &AppState, svcs: Vec<String>, tx: mpsc::UnboundedSender<AppEvent>) {
    if !state.vm_online {
        return;
    }
    let backend = state.backend.clone();
    let ws = backend.vm_workspace.clone();
    tokio::spawn(async move {
        let _ = tx.send(AppEvent::Log("[DEPLOY] Deploying selected...".into()));
        for svc in &svcs {
            let cmd = format!(
                "bin={ws}/target/debug/{svc}; [ -f \"$bin\" ] && {{ install -m 0755 \"$bin\" /usr/bin/{svc} && systemctl restart {svc} 2>/dev/null && echo \"DEPLOY: ✓ {svc}\"; }} || echo \"DEPLOY: ✗ {svc} (not built)\"",
            );
            match backend.ssh_exec(&cmd).await {
                Ok(out) => {
                    let _ = tx.send(AppEvent::Log(out.trim().to_string()));
                }
                Err(e) => {
                    let _ = tx.send(AppEvent::Log(format!("[DEPLOY] ✗ {svc}: {e}")));
                }
            }
        }
    });
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
        if let Ok(h) = backend
            .ssh_exec(
                "curl -sf --max-time 3 http://127.0.0.1:8126/api/health 2>/dev/null || echo FAIL",
            )
            .await
        {
            let _ = tx.send(AppEvent::Log(if h.contains("\"status\":\"ok\"") {
                "[HEALTH] ✓ API OK".into()
            } else {
                "[HEALTH] ✗ API unreachable".into()
            }));
        }
        if let Ok(d) = backend.ssh_exec("df -h / 2>/dev/null | tail -1").await {
            let _ = tx.send(AppEvent::Log(format!("[HEALTH] Disk: {}", d.trim())));
        }
    });
}

fn spawn_journal(state: &AppState, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    tokio::spawn(async move {
        if let Ok(l) = backend
            .ssh_exec("journalctl -u iora-home --no-pager -n 30 2>/dev/null")
            .await
        {
            for line in l.lines() {
                let _ = tx.send(AppEvent::Log(format!("  {}", line)));
            }
        }
    });
}

fn spawn_journal_one(state: &AppState, svc: &str, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    let svc = svc.to_string();
    tokio::spawn(async move {
        let cmd = format!(
            "journalctl -u {svc} --no-pager -n 80 2>/dev/null || echo '(no journal for {svc})'"
        );
        if let Ok(l) = backend.ssh_exec(&cmd).await {
            for line in l.lines() {
                let _ = tx.send(AppEvent::Log(format!("  {}", line)));
            }
        }
    });
}

fn spawn_service_live_log(state: &mut AppState, svc: String, tx: mpsc::UnboundedSender<AppEvent>) {
    state.stop_service_log();
    state.service_log_buf.clear();
    state.service_log_scroll = 0;
    state.service_log_service = Some(svc.clone());
    state.view = View::ServiceLog;
    state.push_service_log(format!("[LIVE] {svc} — connecting..."));

    let backend = state.backend.clone();
    let (stop_tx, mut stop_rx) = oneshot::channel();
    state.service_log_stop = Some(stop_tx);

    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let mut args = backend.ssh_args();
        args.push(format!(
            "journalctl -u {svc} --no-pager -n 80 -f 2>&1 || echo '(no journal for {svc})'"
        ));

        let mut child = match bg_cmd("ssh")
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let _ = tx.send(AppEvent::ServiceLog {
                    service: svc,
                    line: format!("[LIVE] spawn failed: {e}"),
                });
                return;
            }
        };

        let Some(stdout) = child.stdout.take() else {
            let _ = tx.send(AppEvent::ServiceLog {
                service: svc.clone(),
                line: "[LIVE] stdout unavailable".into(),
            });
            let _ = child.kill().await;
            return;
        };
        let mut lines = BufReader::new(stdout).lines();
        let _ = tx.send(AppEvent::ServiceLog {
            service: svc.clone(),
            line: "[LIVE] connected".into(),
        });

        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    let _ = child.kill().await;
                    break;
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            let _ = tx.send(AppEvent::ServiceLog { service: svc.clone(), line });
                        }
                        Ok(None) => break,
                        Err(e) => {
                            let _ = tx.send(AppEvent::ServiceLog { service: svc.clone(), line: format!("[LIVE] read failed: {e}") });
                            break;
                        }
                    }
                }
            }
        }
    });
}

fn export_log(state: &AppState) {
    let path = state
        .backend
        .repo_root
        .join("iora-os/.cache/dev-watch-log.txt");
    let mut f = match std::fs::File::create(&path) {
        Ok(f) => f,
        Err(_) => {
            return;
        }
    };
    use std::io::Write;
    for line in &state.log_buf {
        let _ = writeln!(f, "{}", line);
    }
    // Open the file automatically
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("cmd")
            .arg("/c")
            .arg("start")
            .arg("")
            .arg(path.to_str().unwrap_or(""))
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
    }
}

fn spawn_restart(state: &AppState, svc: String, tx: mpsc::UnboundedSender<AppEvent>) {
    let backend = state.backend.clone();
    tokio::spawn(async move {
        backend.restart_service(svc, tx).await;
    });
}

fn spawn_service_action(
    state: &AppState,
    svc: String,
    action: &'static str,
    tx: mpsc::UnboundedSender<AppEvent>,
) {
    let backend = state.backend.clone();
    tokio::spawn(async move {
        backend.service_action(svc, action, tx).await;
    });
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
                KeyCode::Backspace => {
                    input.pop();
                    state.mode = Mode::Command { input };
                }
                _ => {}
            }
            return;
        }
        Mode::BuildMenu { cursor } => {
            let cur = *cursor;
            match key.code {
                KeyCode::Esc => state.mode = Mode::Normal,
                KeyCode::Up => {
                    state.mode = Mode::BuildMenu {
                        cursor: cur.saturating_sub(1),
                    }
                }
                KeyCode::Down => {
                    state.mode = Mode::BuildMenu {
                        cursor: (cur + 1).min(2),
                    }
                }
                KeyCode::Enter => {
                    if cur == 2 {
                        state.mode = Mode::BuildSelect {
                            cursor: 0,
                            selected: HashSet::new(),
                        };
                    } else {
                        state.mode = Mode::Normal;
                        let only = if cur == 1 && !state.changed_rust.is_empty() {
                            Some(state.changed_rust.clone())
                        } else {
                            None
                        };
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
                KeyCode::Esc => {
                    state.mode = Mode::BuildMenu { cursor: 2 };
                    return;
                }
                KeyCode::Up => cur = cur.saturating_sub(1),
                KeyCode::Down => cur = (cur + 1).min(n.saturating_sub(1)),
                KeyCode::Char(' ') => {
                    if sel.contains(&cur) {
                        sel.remove(&cur);
                    } else {
                        sel.insert(cur);
                    }
                }
                KeyCode::Char('a') | KeyCode::Char('A') => {
                    if sel.len() == n {
                        sel.clear();
                    } else {
                        for i in 0..n {
                            sel.insert(i);
                        }
                    }
                }
                KeyCode::Enter => {
                    if sel.is_empty() {
                        state.mode = Mode::BuildMenu { cursor: 2 };
                        return;
                    }
                    let only: HashSet<String> = sel
                        .iter()
                        .map(|&i| state.backend.services[i].clone())
                        .collect();
                    state.mode = Mode::Normal;
                    state.push_log(format!("[BUILD] {} services", only.len()));
                    spawn_build(state, Some(only), true, false, tx.clone());
                    return;
                }
                _ => {}
            }
            state.mode = Mode::BuildSelect {
                cursor: cur,
                selected: sel,
            };
            return;
        }
        Mode::DeploySelect { cursor, selected } => {
            let mut cur = *cursor;
            let mut sel = selected.clone();
            let n = state.backend.services.len();
            match key.code {
                KeyCode::Esc => {
                    state.mode = Mode::Normal;
                    return;
                }
                KeyCode::Up => cur = cur.saturating_sub(1),
                KeyCode::Down => cur = (cur + 1).min(n.saturating_sub(1)),
                KeyCode::Char(' ') => {
                    if sel.contains(&cur) {
                        sel.remove(&cur);
                    } else {
                        sel.insert(cur);
                    }
                }
                KeyCode::Char('a') | KeyCode::Char('A') => {
                    if sel.len() == n {
                        sel.clear();
                    } else {
                        for i in 0..n {
                            sel.insert(i);
                        }
                    }
                }
                KeyCode::Enter => {
                    if sel.is_empty() {
                        state.mode = Mode::Normal;
                        return;
                    }
                    let svcs: Vec<String> = sel
                        .iter()
                        .map(|&i| state.backend.services[i].clone())
                        .collect();
                    state.mode = Mode::Normal;
                    state.push_log(format!("[DEPLOY] {} services", svcs.len()));
                    spawn_deploy_selected(state, svcs, tx.clone());
                    return;
                }
                _ => {}
            }
            state.mode = Mode::DeploySelect {
                cursor: cur,
                selected: sel,
            };
            return;
        }
        Mode::Normal => {}
    }

    // Normal-mode keys
    match key.code {
        KeyCode::Esc => {
            if state.show_help {
                state.show_help = false;
            } else if state.view == View::ServiceLog {
                state.stop_service_log();
                state.view = View::Status;
            }
        }
        KeyCode::Up if state.show_help => {
            state.help_scroll = state.help_scroll.saturating_sub(1);
        }
        KeyCode::Down if state.show_help => {
            state.help_scroll = state.help_scroll.saturating_add(1);
        }
        KeyCode::PageUp if state.show_help => {
            state.help_scroll = state.help_scroll.saturating_sub(6);
        }
        KeyCode::PageDown if state.show_help => {
            state.help_scroll = state.help_scroll.saturating_add(6);
        }
        KeyCode::Home if state.show_help => {
            state.help_scroll = 0;
        }
        KeyCode::End if state.show_help => {
            state.help_scroll = usize::MAX;
        }
        KeyCode::Char('0') if state.show_help => {
            state.help_scroll = 0;
        }
        KeyCode::Char('q') | KeyCode::Char('Q') => state.should_quit = true,
        KeyCode::Char('?') => {
            state.show_help = !state.show_help;
            state.help_scroll = 0;
        }
        KeyCode::Char('/') => {
            state.mode = Mode::Command {
                input: String::new(),
            }
        }
        KeyCode::Tab => {
            state.view = match state.view {
                View::Logs => View::Status,
                View::Status => View::ServiceLog,
                View::ServiceLog => View::Journal,
                View::Journal => View::Commands,
                View::Commands => View::Resources,
                View::Resources => View::Deploy,
                View::Deploy => View::Logs,
            };
            state.log_scroll = 0;
            // Refresh status immediately when switching to the Status view
            // so the page is never showing stale data right after a tab.
            if state.view == View::Status && state.vm_online && !state.building {
                spawn_fetch_status(state, tx.clone());
            }
        }
        KeyCode::BackTab => {
            state.view = match state.view {
                View::Logs => View::Deploy,
                View::Status => View::Logs,
                View::ServiceLog => View::Status,
                View::Journal => View::ServiceLog,
                View::Commands => View::Journal,
                View::Resources => View::Commands,
                View::Deploy => View::Resources,
            };
            state.log_scroll = 0;
        }
        // Deploy view keys
        KeyCode::Char(' ') if state.view == View::Deploy => {
            if state.deploy_selected.contains(&state.deploy_cursor) {
                state.deploy_selected.remove(&state.deploy_cursor);
            } else {
                state.deploy_selected.insert(state.deploy_cursor);
            }
        }
        KeyCode::Char('a') | KeyCode::Char('A') if state.view == View::Deploy => {
            let n = state.backend.services.len();
            if state.deploy_selected.len() == n {
                state.deploy_selected.clear();
            } else {
                for i in 0..n {
                    state.deploy_selected.insert(i);
                }
            }
        }
        KeyCode::Up if state.view == View::Deploy => {
            state.deploy_cursor = state.deploy_cursor.saturating_sub(1);
        }
        KeyCode::Down if state.view == View::Deploy => {
            let n = state.backend.services.len();
            state.deploy_cursor = (state.deploy_cursor + 1).min(n.saturating_sub(1));
        }
        KeyCode::Enter if state.view == View::Deploy => {
            if !state.deploy_selected.is_empty() {
                let svcs: Vec<String> = state
                    .deploy_selected
                    .iter()
                    .map(|&i| state.backend.services[i].clone())
                    .collect();
                state.push_log(format!("[DEPLOY] {} services", svcs.len()));
                spawn_deploy_selected(state, svcs, tx.clone());
            }
        }
        KeyCode::Char('n') | KeyCode::Char('N') => {
            state.notify_on_ready = !state.notify_on_ready;
            state.push_log(format!(
                "[CONFIG] Notify on ready: {}",
                if state.notify_on_ready { "ON" } else { "OFF" }
            ));
        }
        KeyCode::Char('r') if state.view == View::Status => {
            if let Some(svc) = selected_status_service(state) {
                state.push_log(format!("[RESTART] {svc}"));
                spawn_restart(state, svc, tx.clone());
            }
        }
        KeyCode::Char('u') | KeyCode::Char('U') if state.view == View::Status => {
            if let Some(svc) = selected_status_service(state) {
                state.push_log(format!("[SERVICE] start {svc}"));
                spawn_service_action(state, svc, "start", tx.clone());
            }
        }
        KeyCode::Char('k') | KeyCode::Char('K') if state.view == View::Status => {
            if let Some(svc) = selected_status_service(state) {
                state.push_log(format!("[SERVICE] stop {svc}"));
                spawn_service_action(state, svc, "stop", tx.clone());
            }
        }
        KeyCode::Char('d') if state.view == View::Status => {
            if let Some(svc) = selected_status_service(state) {
                state.push_log(format!("[DEPLOY] {svc}"));
                spawn_deploy_selected(state, vec![svc], tx.clone());
            }
        }
        KeyCode::Enter if state.view == View::Status => {
            if let Some(svc) = selected_status_service(state) {
                spawn_service_live_log(state, svc, tx.clone());
            } else {
                state.service_log_buf.clear();
                state.service_log_service = None;
                state.view = View::ServiceLog;
                state.push_service_log("[LIVE] No service selected");
            }
        }
        // L on Status/Deploy: view live journal for selected service
        KeyCode::Char('l') if state.view == View::Status => {
            if let Some(svc) = selected_status_service(state) {
                state.push_log(format!("[JOURNAL] {} — last 80 lines:", svc));
                spawn_journal_one(state, &svc, tx.clone());
            }
        }
        KeyCode::Char('l') if state.view == View::Deploy => {
            if state.deploy_cursor < state.backend.services.len() {
                let svc = state.backend.services[state.deploy_cursor].clone();
                state.push_log(format!("[JOURNAL] {} — last 80 lines:", svc));
                spawn_journal_one(state, &svc, tx.clone());
            }
        }
        // X: export log buffer to file
        KeyCode::Char('x') | KeyCode::Char('X') => {
            export_log(state);
            state.push_log("[EXPORT] Log written to iora-os/.cache/dev-watch-log.txt");
        }
        KeyCode::Up if state.view == View::Status => {
            let row = selected_status_row(state).saturating_sub(1);
            set_status_cursor(state, row);
        }
        KeyCode::Down if state.view == View::Status => {
            let row = selected_status_row(state).saturating_add(1);
            set_status_cursor(state, row);
        }
        KeyCode::Up if state.view == View::ServiceLog => {
            state.service_log_scroll = state.service_log_scroll.saturating_add(1);
        }
        KeyCode::Down if state.view == View::ServiceLog => {
            state.service_log_scroll = state.service_log_scroll.saturating_sub(1);
        }
        KeyCode::PageUp if state.view == View::ServiceLog => {
            state.service_log_scroll = state.service_log_scroll.saturating_add(10);
        }
        KeyCode::PageDown if state.view == View::ServiceLog => {
            state.service_log_scroll = state.service_log_scroll.saturating_sub(10);
        }
        KeyCode::Home if state.view == View::ServiceLog => {
            state.service_log_scroll = state.service_log_buf.len().saturating_sub(1);
        }
        KeyCode::End if state.view == View::ServiceLog => {
            state.service_log_scroll = 0;
        }
        KeyCode::Char('0') if state.view == View::ServiceLog => {
            state.service_log_scroll = 0;
        }
        KeyCode::Up => state.log_scroll = state.log_scroll.saturating_add(1),
        KeyCode::Down => state.log_scroll = state.log_scroll.saturating_sub(1),
        KeyCode::PageUp => state.log_scroll = state.log_scroll.saturating_add(10),
        KeyCode::PageDown => state.log_scroll = state.log_scroll.saturating_sub(10),
        KeyCode::Home => state.log_scroll = state.log_buf.len().saturating_sub(1),
        KeyCode::End => state.log_scroll = 0,
        // '0' jumps back to the newest entry (bottom of Logs / Status).
        KeyCode::Char('0') => state.log_scroll = 0,
        KeyCode::Char('b') | KeyCode::Char('B') => {
            state.push_log("[BUILD] Full rebuild");
            spawn_build(state, None, true, true, tx.clone());
        }
        KeyCode::Char('r') => state.mode = Mode::BuildMenu { cursor: 0 },
        KeyCode::Char('e') => {
            state.view = View::Deploy;
            state.log_scroll = 0;
        }
        KeyCode::Char('E') => {
            state.mode = Mode::DeploySelect {
                cursor: 0,
                selected: HashSet::new(),
            }
        }
        KeyCode::Char('R') => {
            state.view = View::Resources;
            state.log_scroll = 0;
        }
        KeyCode::Char('c') | KeyCode::Char('C') => {
            state.push_log("[VM] Checking...");
            spawn_check_vm(state, tx.clone());
        }
        KeyCode::Char('d') => spawn_deploy(state, tx.clone(), false),
        KeyCode::Char('D') => spawn_deploy(state, tx.clone(), true),
        KeyCode::Char('l') | KeyCode::Char('L') => {
            state.auto_deploy = !state.auto_deploy;
            let s = format!(
                "[CONFIG] Auto-deploy: {}",
                if state.auto_deploy { "ON" } else { "OFF" }
            );
            state.push_log(s);
        }
        KeyCode::Char('w') | KeyCode::Char('W') => {
            state.do_watch = !state.do_watch;
            let s = format!(
                "[CONFIG] Watch: {}",
                if state.do_watch { "ON" } else { "OFF" }
            );
            state.push_log(s);
        }
        KeyCode::Char('s') | KeyCode::Char('S') => {
            state.view = View::Status;
            state.log_scroll = 0;
            if state.vm_online {
                spawn_fetch_status(state, tx.clone());
            }
        }
        KeyCode::Char('h') | KeyCode::Char('H') => {
            state.push_log("[HEALTH] Checking...");
            spawn_health_probe(state, tx.clone());
        }
        KeyCode::Char('j') | KeyCode::Char('J') => {
            state.view = View::Journal;
            state.log_scroll = 0;
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
    let parts: Vec<&str> = input.split_whitespace().collect();
    if parts.is_empty() {
        return;
    }
    match parts[0] {
        "build" | "b" => {
            let mut rust = true;
            let mut fe = true;
            let mut changed = false;
            for p in &parts[1..] {
                match *p {
                    "rust" | "r" => fe = false,
                    "fe" | "frontend" | "f" => rust = false,
                    "changed" | "c" => changed = true,
                    "all" | "a" => {}
                    _ => {
                        state.push_log("[CMD] unknown arg");
                        return;
                    }
                }
            }
            let only = if changed && !state.changed_rust.is_empty() {
                Some(state.changed_rust.clone())
            } else {
                None
            };
            spawn_build(state, only, rust, fe, tx.clone());
        }
        "deploy" | "d" => spawn_deploy(state, tx.clone(), false),
        "redeploy" | "force-deploy" | "force" => spawn_deploy(state, tx.clone(), true),
        "restart" => {
            if parts.len() < 2 {
                state.push_log("[CMD] Usage: restart <service>");
                return;
            }
            spawn_restart(state, parts[1].into(), tx.clone());
        }
        "logs" | "l" => {
            state.view = View::Logs;
            state.log_scroll = 0;
        }
        "status" => {
            state.view = View::Status;
            state.log_scroll = 0;
            if state.vm_online {
                spawn_fetch_status(state, tx.clone());
            }
        }
        "journal" | "j" => {
            state.view = View::Journal;
            state.log_scroll = 0;
            spawn_journal(state, tx.clone());
        }
        "commands" | "cmd" => {
            state.view = View::Commands;
            state.log_scroll = 0;
        }
        "resources" => {
            state.view = View::Resources;
            state.log_scroll = 0;
        }
        "connect" | "c" => spawn_check_vm(state, tx.clone()),
        "watch" => {
            state.do_watch = parts.get(1).is_none_or(|&w| w != "off");
            let s = format!("[CMD] Watch: {}", if state.do_watch { "ON" } else { "OFF" });
            state.push_log(s);
        }
        "deploy-toggle" | "dt" => {
            state.auto_deploy = !state.auto_deploy;
            let s = format!(
                "[CMD] Auto-deploy: {}",
                if state.auto_deploy { "ON" } else { "OFF" }
            );
            state.push_log(s);
        }
        "quit" | "q" | "exit" => state.should_quit = true,
        "help" | "?" => {
            state.push_log("[CMD] build [rust|fe|changed] | deploy | restart <s> | journal | status | logs | commands | resources | connect | watch [on|off] | deploy-toggle | quit");
        }
        _ => {
            state.push_log(format!("[CMD] Unknown: {} (type help)", parts[0]));
        }
    }
}

// ═══ Rendering (ratatui) ═════════════════════════════════════════════════

fn ui(f: &mut ratatui::Frame, state: &AppState) {
    let area = f.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // header
            Constraint::Length(2), // tabs
            Constraint::Min(3),    // body
            Constraint::Length(2), // footer
        ])
        .split(area);

    render_header(f, chunks[0], state);
    render_tabs(f, chunks[1], state);
    match state.view {
        View::Logs => render_logs(f, chunks[2], state),
        View::Status => render_status(f, chunks[2], state),
        View::ServiceLog => render_service_log(f, chunks[2], state),
        View::Journal => render_journal(f, chunks[2], state),
        View::Commands => render_commands(f, chunks[2], state),
        View::Resources => render_resources(f, chunks[2], state),
        View::Deploy => render_deploy(f, chunks[2], state),
    }
    render_footer(f, chunks[3], state);

    if state.show_help {
        render_help(f, area, state);
    }
}

fn render_header(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let vm_style = if s.vm_online {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::Red)
    };
    let vm_text = if s.vm_online {
        "● online"
    } else {
        "● offline"
    };

    let bridge_style = if s.bridge_connected {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::DarkGray)
    };
    let ssh_style = if s.ssh_connected {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let build_text = if s.building {
        let secs = s.build_start.map(|t| t.elapsed().as_secs()).unwrap_or(0);
        format!("Building {}s", secs)
    } else {
        s.last_build.clone()
    };
    let dep_style = if s.auto_deploy {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::Red)
    };
    let dep_text = if s.auto_deploy { "ON" } else { "OFF" };
    let watch_style = if s.do_watch {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::DarkGray)
    };
    let watch_text = if s.do_watch { "ON" } else { "OFF" };

    let mem_g = s.bridge_mem_avail as f64 / 1_073_741_824.0;
    let info = if s.bridge_connected && s.bridge_uptime > 0 {
        format!(" ↑{}m  free {:.1}G", s.bridge_uptime / 60, mem_g)
    } else {
        String::new()
    };

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
        Span::raw(format!(
            "   Services: {}/{}",
            s.active_services,
            s.backend.services.len()
        )),
    ]);
    // Append ready indicator when all services are up
    let all_ready = s.vm_online
        && s.bridge_connected
        && s.ssh_connected
        && !s.building
        && s.active_services == s.backend.services.len();
    let display = if all_ready {
        let mut spans = line.spans.clone();
        spans.push(Span::styled(" │ ", Style::default().fg(Color::DarkGray)));
        spans.push(Span::styled(
            "✓ READY",
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        ));
        Line::from(spans)
    } else {
        line
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(Span::styled(
            " IORA Dev Watch ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
    let p = Paragraph::new(display).block(block);
    f.render_widget(p, area);
}

fn render_tabs(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let titles = vec![
        "Logs",
        "Status",
        "Service Log",
        "Journal",
        "Commands",
        "Resources",
        "Deploy",
    ];
    let idx = match s.view {
        View::Logs => 0,
        View::Status => 1,
        View::ServiceLog => 2,
        View::Journal => 3,
        View::Commands => 4,
        View::Resources => 5,
        View::Deploy => 6,
    };
    let tabs = Tabs::new(titles)
        .select(idx)
        .style(Style::default().fg(Color::DarkGray))
        .highlight_style(
            Style::default()
                .fg(Color::Black)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .divider("│");
    f.render_widget(tabs, area);
}

fn log_style(line: &str) -> Style {
    if line.contains("[RUST]") || line.contains("[DEPLOY]") {
        Style::default().fg(Color::Magenta)
    } else if line.contains("[FE]") || line.contains("[SYSTEM]") || line.contains("[BRIDGE]") {
        Style::default().fg(Color::Cyan)
    } else if line.contains("[CMD]")
        || line.contains("[RESTART]")
        || line.contains("[WATCH]")
        || line.contains("[CONFIG]")
    {
        Style::default().fg(Color::Yellow)
    } else if line.contains("[HEALTH]")
        || line.contains("[STATUS]")
        || line.contains("[SSH]")
        || line.contains("[VM]")
        || line.contains("[CONN]")
    {
        Style::default().fg(Color::Blue)
    } else if line.contains("✓") || line.contains(" OK") {
        Style::default().fg(Color::Green)
    } else if line.contains("✗") || line.contains("FAILED") {
        Style::default().fg(Color::Red)
    } else if line.contains("──") {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::Gray)
    }
}

fn render_logs(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let h = area.height.saturating_sub(2) as usize;
    let total = s.log_buf.len();
    // Newest line is the last; log_scroll counts how many lines below the newest are skipped (scroll-up)
    let end = total.saturating_sub(s.log_scroll);
    let start = end.saturating_sub(h);
    let items: Vec<ListItem> = s
        .log_buf
        .range(start..end)
        .map(|l| ListItem::new(Line::styled(l.as_str(), log_style(l))))
        .collect();
    let title = if s.log_scroll > 0 {
        format!(" Logs [↑{}] ", s.log_scroll)
    } else {
        " Logs ".into()
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(title);
    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

#[allow(clippy::if_same_then_else)]
fn render_status(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    use ratatui::layout::{Constraint, Direction, Layout};

    let total = s.backend.services.len();
    let active = s
        .service_status
        .iter()
        .filter(|(st, _)| st == "active")
        .count();
    let failed = s
        .service_status
        .iter()
        .filter(|(st, _)| st == "failed")
        .count();
    let inactive = s
        .service_status
        .iter()
        .filter(|(st, _)| st == "inactive")
        .count();
    let missing_bin = s.service_status.iter().filter(|(_, b)| !*b).count();
    let last_refresh = s
        .last_status_refresh
        .map(|t| format!("{}s ago", t.elapsed().as_secs()))
        .unwrap_or_else(|| "never".into());

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)])
        .split(area);

    // Summary bar
    let summary = Line::from(vec![
        Span::styled(
            " Services ",
            Style::default()
                .fg(Color::Black)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled(
            format!("{active}"),
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" active  "),
        Span::styled(
            format!("{failed}"),
            Style::default()
                .fg(if failed > 0 {
                    Color::Red
                } else {
                    Color::DarkGray
                })
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" failed  "),
        Span::styled(format!("{inactive}"), Style::default().fg(Color::Yellow)),
        Span::raw(" inactive  "),
        Span::styled(
            format!("{missing_bin}"),
            Style::default().fg(if missing_bin > 0 {
                Color::Magenta
            } else {
                Color::DarkGray
            }),
        ),
        Span::raw(" no-binary  /  "),
        Span::styled(
            format!("{total}"),
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" total      refresh: "),
        Span::styled(last_refresh, Style::default().fg(Color::DarkGray)),
        Span::raw("  (auto every 8s)"),
    ]);
    let summary_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Service Overview ");
    f.render_widget(Paragraph::new(summary).block(summary_block), chunks[0]);

    // Service list — sorted: failed first, then transitioning, inactive, active.
    let indexed = sorted_status_indices(s);
    let selected_row = selected_status_row(s);

    let mut rows: Vec<ListItem> = Vec::with_capacity(total + 1);
    rows.push(ListItem::new(Line::styled(
        format!(
            "  {:<28} {:<12} {:<8} {}",
            "Service", "Status", "Binary", "Notes"
        ),
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )));
    for (row, i) in indexed.into_iter().enumerate() {
        let svc = &s.backend.services[i];
        let (status, has_bin) = s
            .service_status
            .get(i)
            .map(|(s, b)| (s.as_str(), *b))
            .unwrap_or(("?", false));
        let (marker, st_style) = match status {
            "active" => (
                "●",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            "failed" => (
                "×",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ),
            "inactive" => ("○", Style::default().fg(Color::Yellow)),
            "activating" | "deactivating" => ("◐", Style::default().fg(Color::Blue)),
            _ => ("?", Style::default().fg(Color::DarkGray)),
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
        } else {
            ""
        };
        let row_style = if row == selected_row {
            Style::default().bg(Color::DarkGray)
        } else {
            Style::default()
        };
        rows.push(
            ListItem::new(Line::from(vec![
                Span::styled(format!(" {} ", marker), st_style),
                Span::styled(format!("{:<28} ", svc), Style::default().fg(Color::White)),
                Span::styled(format!("{:<12} ", status), st_style),
                Span::styled(format!("{:<8} ", bin), bin_style),
                Span::styled(notes.to_string(), Style::default().fg(Color::DarkGray)),
            ]))
            .style(row_style),
        );
    }
    // Auto-scroll: keep the highlighted row visible.
    // Row 0 is the header — keep it pinned, scroll only the body.
    let body_height = chunks[1].height.saturating_sub(2) as usize; // borders
    let header = rows.remove(0);
    let body_total = rows.len();
    let visible_body = body_height.saturating_sub(1); // header row consumes one
    let cursor = selected_row.min(body_total.saturating_sub(1));
    let start = if body_total <= visible_body {
        0
    } else if cursor < visible_body / 2 {
        0
    } else if cursor >= body_total.saturating_sub(visible_body / 2) {
        body_total.saturating_sub(visible_body)
    } else {
        cursor.saturating_sub(visible_body / 2)
    };
    let end = (start + visible_body).min(body_total);
    let mut visible: Vec<ListItem> = Vec::with_capacity(visible_body + 1);
    visible.push(header);
    if start < end {
        visible.extend(rows.drain(start..end));
    }
    let scroll_hint = if body_total > visible_body {
        format!(
            " Services on {} [{}..{} / {}] ",
            s.backend.vm_host,
            start + 1,
            end,
            body_total
        )
    } else {
        format!(" Services on {} ", s.backend.vm_host)
    };
    let list_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(scroll_hint);
    f.render_widget(List::new(visible).block(list_block), chunks[1]);
}

fn render_journal(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    // Reuse log buf showing entries that look like journal lines (indented from journalctl)
    let h = area.height.saturating_sub(2) as usize;
    let items: Vec<ListItem> = s
        .log_buf
        .iter()
        .rev()
        .take(h)
        .rev()
        .map(|l| ListItem::new(Line::styled(l.as_str(), log_style(l))))
        .collect();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Journal ");
    f.render_widget(List::new(items).block(block), area);
}

fn render_service_log(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let h = area.height.saturating_sub(2) as usize;
    let total = s.service_log_buf.len();
    let scroll = s.service_log_scroll.min(total.saturating_sub(1));
    let end = total.saturating_sub(scroll);
    let start = end.saturating_sub(h);
    let items: Vec<ListItem> = s
        .service_log_buf
        .iter()
        .skip(start)
        .take(end.saturating_sub(start))
        .map(|l| ListItem::new(Line::styled(l.as_str(), log_style(l))))
        .collect();
    let service = s
        .service_log_service
        .as_deref()
        .unwrap_or("no service selected");
    let title = if total > h {
        format!(
            " Live Service Log: {service} [{}..{} / {}] ",
            start + 1,
            end,
            total
        )
    } else {
        format!(" Live Service Log: {service} ")
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(title);
    f.render_widget(List::new(items).block(block), area);
}

fn render_commands(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let h = area.height.saturating_sub(2) as usize;
    let total = s.command_log.len();
    let start = total.saturating_sub(h);
    let items: Vec<ListItem> = s
        .command_log
        .range(start..)
        .map(|l| {
            let style = if l.starts_with("> ") {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default().fg(Color::Gray)
            };
            ListItem::new(Line::styled(l.as_str(), style))
        })
        .collect();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Commands (press / to enter command mode) ");
    f.render_widget(List::new(items).block(block), area);
}

fn render_resources(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" Resources ");
    let inner = block.inner(area);
    f.render_widget(block, area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2), // cpu gauge
            Constraint::Length(1), // cpu sub
            Constraint::Length(2), // ram gauge
            Constraint::Length(1), // ram sub
            Constraint::Length(2), // disk gauge
            Constraint::Length(1), // disk sub
            Constraint::Min(1),    // history sparklines
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
        d.load_1m,
        d.load_5m,
        d.load_15m,
        d.cpu_cores_used,
        d.cpu_cores_total.max(1)
    ))
    .style(Style::default().fg(Color::DarkGray));
    f.render_widget(cpu_sub, chunks[1]);

    // RAM
    let ram_pct = if d.ram_total_bytes > 0 {
        (d.ram_used_bytes as f64 / d.ram_total_bytes as f64 * 100.0).clamp(0.0, 100.0) as u16
    } else {
        0
    };
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
    let ram_sub = Paragraph::new(format!(
        "  available {}",
        resources::format_bytes(d.ram_available_bytes)
    ))
    .style(Style::default().fg(Color::DarkGray));
    f.render_widget(ram_sub, chunks[3]);

    // Disk
    let disk_pct = if d.disk_total_bytes > 0 {
        (d.disk_used_bytes as f64 / d.disk_total_bytes as f64 * 100.0).clamp(0.0, 100.0) as u16
    } else {
        0
    };
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
    let disk_sub = Paragraph::new(format!(
        "  uptime {}",
        resources::format_uptime(d.uptime_seconds)
    ))
    .style(Style::default().fg(Color::DarkGray));
    f.render_widget(disk_sub, chunks[5]);

    // Sparkline history (CPU + RAM)
    let cpu_spark = resources::render_sparkline(&s.resource_history.cpu, inner.width as usize - 6);
    let ram_spark = resources::render_sparkline(&s.resource_history.ram, inner.width as usize - 6);
    let sparks = Paragraph::new(vec![
        Line::from(vec![
            Span::styled("CPU ", Style::default().fg(Color::Cyan)),
            Span::raw(cpu_spark),
        ]),
        Line::from(vec![
            Span::styled("RAM ", Style::default().fg(Color::Magenta)),
            Span::raw(ram_spark),
        ]),
    ]);
    f.render_widget(sparks, chunks[6]);
}

fn render_deploy(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(" Deploy ");
    let inner = block.inner(area);
    f.render_widget(block, area);

    let n = s.backend.services.len();
    let visible_h = inner.height.saturating_sub(1) as usize;
    let mut lines: Vec<Line> = Vec::new();
    for i in 0..n {
        let svc = &s.backend.services[i];
        let label = svc.strip_prefix("iora-").unwrap_or(svc);
        let checked = if s.deploy_selected.contains(&i) {
            "✓"
        } else {
            " "
        };
        let cursor = if i == s.deploy_cursor { ">" } else { " " };
        let style = if i == s.deploy_cursor {
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD)
        } else if s.deploy_selected.contains(&i) {
            Style::default().fg(Color::Green)
        } else {
            Style::default().fg(Color::Gray)
        };
        lines.push(Line::from(vec![
            Span::raw(format!("{cursor} [{checked}] ")),
            Span::styled(label.to_string(), style),
        ]));
    }
    let scroll = (s.deploy_cursor.saturating_sub(visible_h.saturating_sub(1))).min(s.deploy_cursor);
    let visible: Vec<Line> = lines.iter().skip(scroll).take(visible_h).cloned().collect();
    f.render_widget(List::new(visible).block(Block::default()), inner);

    // Footer hint
    let hint = Paragraph::new(
        "Space=toggle  A=all  Enter=deploy  ↑↓=scroll  Tab=next  Esc=back  N=notify",
    )
    .style(Style::default().fg(Color::DarkGray));
    f.render_widget(
        hint,
        Rect {
            y: inner.y + inner.height.saturating_sub(1),
            height: 1,
            ..inner
        },
    );
}

fn render_footer(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let line = match &s.mode {
        Mode::Normal => {
            let status: Span = if s.building {
                Span::styled("● BUILDING", Style::default().fg(Color::Yellow))
            } else if !s.vm_online {
                Span::styled("VM offline — press C", Style::default().fg(Color::Red))
            } else {
                Span::styled("● idle", Style::default().fg(Color::Green))
            };
            let keys = match s.view {
                View::Status => "   ↑↓=select  Enter=live-log  r=restart  u=start  k=stop  d=deploy-selected  L=journal  S=refresh  Tab=view  ?=help",
                View::ServiceLog => "   Live service log  Esc=back/stop  ↑↓/PgUp/PgDn=scroll  0/End=bottom  Tab=view  ?=help",
                View::Deploy => "   Space=toggle  A=all  Enter=deploy selected  E=deploy-select  Tab=view  ?=help",
                _ => "   Q=quit  B=build  D=deploy  Shift+D=force-redeploy  e=deploy-tab  E=deploy-select  S=status  H=health  R=resources  r=build-menu  J=journal  W=watch  L=auto-deploy  0=bottom  /=cmd  Tab=view  ?=help",
            };
            Line::from(vec![
                Span::raw(" "),
                status,
                Span::styled(keys, Style::default().fg(Color::DarkGray)),
            ])
        }
        Mode::Command { input } => Line::from(vec![
            Span::styled(
                " / ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(input.clone()),
            Span::styled("█", Style::default().fg(Color::Yellow)),
        ]),
        Mode::BuildMenu { cursor } => {
            let items = ["All", "Changed", "Select"];
            let mut spans = vec![Span::styled(" Build: ", Style::default().fg(Color::Cyan))];
            for (i, item) in items.iter().enumerate() {
                let style = if i == *cursor {
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Yellow)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::Gray)
                };
                spans.push(Span::styled(format!(" {} ", item), style));
            }
            spans.push(Span::styled(
                "   ↑↓ Enter Esc",
                Style::default().fg(Color::DarkGray),
            ));
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
                } else {
                    Style::default().fg(Color::DarkGray)
                };
                let label = svc.strip_prefix("iora-").unwrap_or(svc);
                spans.push(Span::styled(format!(" [{mark}]{label}"), style));
            }
            spans.push(Span::styled(
                "  Space=toggle A=all Enter=build Esc=back",
                Style::default().fg(Color::DarkGray),
            ));
            Line::from(spans)
        }
        Mode::DeploySelect { cursor, selected } => {
            let mut spans = vec![Span::styled(" Deploy: ", Style::default().fg(Color::Cyan))];
            for (i, svc) in s.backend.services.iter().enumerate() {
                let mark = if selected.contains(&i) { "✓" } else { " " };
                let style = if i == *cursor {
                    Style::default().fg(Color::Black).bg(Color::Yellow)
                } else if selected.contains(&i) {
                    Style::default().fg(Color::Green)
                } else {
                    Style::default().fg(Color::DarkGray)
                };
                let label = svc.strip_prefix("iora-").unwrap_or(svc);
                spans.push(Span::styled(format!(" [{mark}]{label}"), style));
            }
            spans.push(Span::styled(
                "  Space=toggle A=all Enter=deploy Esc=back",
                Style::default().fg(Color::DarkGray),
            ));
            Line::from(spans)
        }
    };
    f.render_widget(Paragraph::new(line), area);
    // If terminal is narrow, render a second hint line
    if area.width < 120 {
        let hint2 = Paragraph::new("  ?=help  X=export-log  N=notify  Status: Enter=live-log r=restart u=start k=stop d=deploy")
            .style(Style::default().fg(Color::DarkGray));
        let r2 = Rect {
            y: area.y + 1,
            height: 1,
            ..area
        };
        f.render_widget(hint2, r2);
    }
}

fn render_help(f: &mut ratatui::Frame, area: Rect, s: &AppState) {
    let w = (area.width / 2).max(50).min(area.width);
    let h = 16u16.min(area.height);
    let x = (area.width - w) / 2;
    let y = (area.height - h) / 2;
    let rect = Rect::new(x, y, w, h);
    f.render_widget(Clear, rect);
    let keys = vec![
        Line::from(""),
        Line::from(Span::styled(
            "  Help — Keybindings",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from("  /          Command mode (then type 'help')"),
        Line::from("  Tab        Next tab    Shift+Tab   Previous tab"),
        Line::from("  B          Full rebuild (Rust + FE)"),
        Line::from("  r          Build menu (All/Changed/Select)"),
        Line::from("  D          Deploy binaries"),
        Line::from("  e / E      Deploy tab / deploy select menu"),
        Line::from("  C          Check VM"),
        Line::from("  S          Status view + refresh"),
        Line::from("  ↑↓ Status  Select service   Enter   Live service log"),
        Line::from("  r/u/k/d Status  Restart/start/stop/deploy selected service"),
        Line::from("  L Status   Journal for selected service"),
        Line::from("  J          Journal (iora-home log)"),
        Line::from("  H          Health probe (API + disk)"),
        Line::from("  W          Toggle watch"),
        Line::from("  N          Toggle notify-on-ready"),
        Line::from("  X          Export log to file"),
        Line::from("  R          Resources view"),
        Line::from("  1-9        Restart service by index"),
        Line::from("  ↑↓ PgUp PgDn Home End   Scroll logs/help"),
        Line::from("  Q / Esc    Quit / close help"),
    ];
    let visible_h = h.saturating_sub(2) as usize;
    let total = keys.len();
    let skip = s.help_scroll.min(total.saturating_sub(visible_h));
    let visible: Vec<Line> = keys.into_iter().skip(skip).take(visible_h).collect();
    let end = skip + visible.len();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(format!(" Help [{}-{}/{}] ", skip + 1, end, total));
    f.render_widget(
        Paragraph::new(visible)
            .block(block)
            .wrap(Wrap { trim: false }),
        rect,
    );
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
    let ssh_key = args
        .ssh_key
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| cache_dir.join("iora-dev-key"));
    let services = discover_services(&workspace);
    let services_for_watcher = services.clone();

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
    state.push_log(format!(
        "[BRIDGE] Connecting to bridge at {}:{}...",
        args.vm_host, args.vm_bridge_port
    ));
    state.push_log(format!(
        "[SSH] Opening persistent master session to {}:{}...",
        args.vm_host, args.vm_port
    ));
    state.push_log(format!(
        "[SYSTEM] {} services discovered",
        state.backend.services.len()
    ));

    // Connection managers
    let _bridge = if args.vm_bridge_port > 0 {
        Some(BridgeConnection::start(
            args.vm_host.clone(),
            args.vm_bridge_port,
            conn_tx.clone(),
        ))
    } else {
        None
    };
    let _ssh = SshSession::start(
        args.vm_host.clone(),
        args.vm_port,
        ssh_key.clone(),
        conn_tx.clone(),
    );

    // File watcher
    let _watcher = if state.do_watch {
        Some(start_file_watcher(
            workspace.clone(),
            frontend_dir.clone(),
            app_tx.clone(),
            services_for_watcher,
        )?)
    } else {
        None
    };

    // Initial VM check + optional build
    {
        let backend = state.backend.clone();
        let tx = app_tx.clone();
        let do_build = !args.no_initial_build;
        let auto_deploy_init = state.auto_deploy;
        state.building = do_build;
        if do_build {
            state.build_start = Some(Instant::now());
            state.last_build = "Building...".into();
        }
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
            .spawn(move || loop {
                match crossterm::event::poll(Duration::from_millis(200)) {
                    Ok(true) => match crossterm::event::read() {
                        Ok(ev) => {
                            if input_tx.send(ev).is_err() {
                                return;
                            }
                        }
                        Err(_) => return,
                    },
                    Ok(false) => continue,
                    Err(_) => return,
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

        if state.should_quit {
            break;
        }
    }

    // Cleanup
    state.stop_service_log();
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
        AppEvent::ServiceLog { service, line } => {
            if state.service_log_service.as_deref() == Some(service.as_str()) {
                state.push_service_log(line);
            }
        }
        AppEvent::BuildComplete => {
            let dur = state
                .build_start
                .map(|t| t.elapsed().as_secs())
                .unwrap_or(0);
            state.building = false;
            state.build_start = None;
            state.last_build = format!("✓ {}s", dur);
            state.push_log(format!("[SYSTEM] Build complete ({}s)", dur));
        }
        AppEvent::VmReachable(ok) => {
            let was = state.vm_online;
            state.vm_online = ok;
            if ok && !was {
                state.push_log("[VM] Reachable via SSH");
                // Newly online — fire self-heal immediately so missing binaries
                // (e.g. /usr/bin wiped by the VM's tmpfs after a reboot) get
                // detected and auto-rebuilt within seconds instead of waiting
                // for the periodic heal tick.
                if !state.building {
                    let backend = state.backend.clone();
                    let txc = tx.clone();
                    tokio::spawn(async move {
                        backend.self_heal(txc).await;
                    });
                }
            }
            if !ok && was {
                state.push_log("[VM] No longer reachable");
            }
        }
        AppEvent::ServiceCount(n) => state.active_services = n,
        AppEvent::ServiceStatus(s) => {
            state.active_services = s.iter().filter(|(s, _)| s == "active").count();
            state.service_status = s;
            state.last_status_refresh = Some(Instant::now());
            let row = selected_status_row(state);
            set_status_cursor(state, row);
        }
        AppEvent::Resource(d) => {
            let cpu = d.cpu_percent;
            let ram_pct = if d.ram_total_bytes > 0 {
                (d.ram_used_bytes as f64 / d.ram_total_bytes as f64 * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            };
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
        AppEvent::FileChange {
            rust_crates,
            frontend,
        } => {
            for c in &rust_crates {
                if c == "__workspace__" {
                    state.changed_rust.clear();
                } else {
                    state.changed_rust.insert(c.clone());
                }
            }
            if frontend {
                state.changed_fe = true;
            }

            // Auto-rebuild debounce: at most once every 2 seconds
            let should = state.do_watch
                && !state.building
                && state.vm_online
                && state.auto_deploy
                && (!state.changed_rust.is_empty() || state.changed_fe);
            let debounce_ok = state
                .last_auto_build_trigger
                .map(|t| t.elapsed() >= Duration::from_secs(2))
                .unwrap_or(true);
            if should && debounce_ok {
                state.last_auto_build_trigger = Some(Instant::now());
                state.push_log("[WATCH] Changes detected — auto-rebuilding...");
                let only = if !state.changed_rust.is_empty() {
                    Some(state.changed_rust.clone())
                } else {
                    None
                };
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
            if !state.vm_online {
                state.vm_online = true;
            }
            state.push_log(format!("[BRIDGE] Connected — {hostname} (build {build})"));
        }
        ConnEvent::Offline => {
            let was_connected = state.bridge_connected;
            state.bridge_connected = false;
            if !state.ssh_connected {
                state.vm_online = false;
            }
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
            if !state.vm_online {
                state.vm_online = true;
            }
            state.push_log("[SSH] Master session established");
        }
        ConnEvent::SshOffline => {
            state.ssh_connected = false;
            if !state.bridge_connected {
                state.vm_online = false;
            }
            state.push_log("[SSH] Master session lost — auto-reconnecting...");
        }
        ConnEvent::Heartbeat {
            uptime_seconds,
            mem_available_bytes,
            ..
        } => {
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
