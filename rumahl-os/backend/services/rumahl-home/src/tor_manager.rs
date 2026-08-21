//! Tor hidden-service manager (Umbrel-style Tor integration).
//!
//! When a `tor` binary is available, rumahl runs a private Tor daemon that
//! exposes each installed app's web port as a `.onion` address, so apps can
//! be reached securely from outside the LAN (via the Tor Browser).
//!
//! Architecture:
//!  - one HiddenService per app: `<data>/tor/<app_id>` with a port forward
//!    `<external_port> 127.0.0.1:<external_port>`
//!  - the daemon is started once; `refresh()` regenerates the torrc and
//!    sends SIGHUP whenever the app list changes

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::sync::RwLock;
use tokio::task::spawn_blocking;

pub struct TorManager {
    data_dir: PathBuf,
    daemon_started: RwLock<bool>,
    onions: RwLock<HashMap<String, String>>,
}

impl TorManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            daemon_started: RwLock::new(false),
            onions: RwLock::new(HashMap::new()),
        }
    }

    fn tor_binary() -> Option<String> {
        for candidate in ["/usr/bin/tor", "/usr/local/bin/tor"] {
            if Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
        None
    }

    /// Check availability without starting anything yet.
    pub fn is_available(&self) -> bool {
        TorManager::tor_binary().is_some()
    }

    /// Regenerate the torrc for the given app ports and (re)start/refresh the
    /// daemon. `ports` maps app_id → external web port.
    pub async fn refresh(&self, ports: &HashMap<String, u16>) -> std::io::Result<()> {
        let Some(tor) = TorManager::tor_binary() else {
            return Ok(());
        };
        // Tor refuses to run when these dirs are group/world-readable.
        #[cfg(unix)]
        let chmod700 = |path: &Path| {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
        };
        #[cfg(not(unix))]
        let chmod700 = |_path: &Path| {};
        let _ = std::fs::create_dir_all(&self.data_dir);
        chmod700(&self.data_dir);
        let _ = std::fs::create_dir_all(self.data_dir.join("data"));
        chmod700(&self.data_dir.join("data"));
        let torrc_path = self.data_dir.join("torrc");

        let mut torrc = String::new();
        torrc.push_str("SocksPort 0\n");
        torrc.push_str("ControlPort 0\n");
        torrc.push_str("Log notice stdout\n");
        torrc.push_str("DataDirectory ");
        torrc.push_str(&self.data_dir.join("data").display().to_string());
        torrc.push('\n');

        for (app_id, port) in ports {
            let hs_dir = self.data_dir.join(safe_name(app_id));
            std::fs::create_dir_all(&hs_dir)?;
            chmod700(&hs_dir);
            torrc.push_str(&format!(
                "HiddenServiceDir {}\nHiddenServicePort {} 127.0.0.1:{}\n",
                hs_dir.display(),
                port,
                port
            ));
        }

        std::fs::write(&torrc_path, torrc)?;

        // (Re)start or SIGHUP the daemon so the new config is picked up.
        let started = *self.daemon_started.read().await;
        if started {
            let _ = self.signal_hup();
        } else {
            let log_path = self.data_dir.join("tor.log");
            let log_file = std::fs::File::create(&log_path)
                .map(Stdio::from)
                .unwrap_or(Stdio::null());
            let child = std::process::Command::new(&tor)
                .arg("-f")
                .arg(&torrc_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(log_file)
                .spawn();
            match child {
                Ok(mut child) => {
                    spawn_blocking(move || {
                        let _ = child.wait();
                    });
                    *self.daemon_started.write().await = true;
                    // Give Tor a moment to bootstrap, then read hostname files.
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
                Err(e) => {
                    tracing::warn!("Failed to start tor daemon: {e}");
                }
            }
        }

        // Collect onion addresses.
        let mut onions = HashMap::new();
        for app_id in ports.keys() {
            let hostname_path = self.data_dir.join(safe_name(app_id)).join("hostname");
            if let Ok(content) = std::fs::read_to_string(&hostname_path) {
                let onion = content.trim().to_string();
                if !onion.is_empty() {
                    onions.insert(app_id.clone(), onion);
                }
            }
        }
        *self.onions.write().await = onions;
        Ok(())
    }

    fn signal_hup(&self) -> std::io::Result<()> {
        // SIGHUP to the tor process we started (find by config path).
        let out = std::process::Command::new("pgrep")
            .args(["-f", "tor -f"])
            .output()?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        for pid in stdout.split_whitespace() {
            if let Ok(pid) = pid.parse::<i32>() {
                // Safety: only signal processes whose cmdline contains our torrc.
                let cmd =
                    std::fs::read_to_string(format!("/proc/{pid}/cmdline")).unwrap_or_default();
                if cmd.contains("tor") && cmd.contains("torrc") {
                    let _ = std::process::Command::new("kill")
                        .args(["-HUP", &pid.to_string()])
                        .status();
                }
            }
        }
        Ok(())
    }

    /// Current onion addresses (app_id → ".onion").
    pub async fn onions(&self) -> HashMap<String, String> {
        self.onions.read().await.clone()
    }

    /// Read the .onion hostnames directly from disk — reflects addresses as
    /// soon as Tor has bootstrapped, without waiting for the next refresh.
    pub fn onions_from_disk(&self) -> HashMap<String, String> {
        let mut onions = HashMap::new();
        let Ok(entries) = std::fs::read_dir(&self.data_dir) else {
            return onions;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "data" {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(path.join("hostname")) {
                let onion = content.trim().to_string();
                if !onion.is_empty() {
                    onions.insert(name, onion);
                }
            }
        }
        onions
    }

    pub fn onion_for(&self, app_id: &str) -> Option<String> {
        let rt = tokio::runtime::Handle::try_current().ok()?;
        rt.block_on(async { self.onions.read().await.get(app_id).cloned() })
    }
}

fn safe_name(app_id: &str) -> String {
    app_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
