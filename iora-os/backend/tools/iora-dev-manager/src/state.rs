use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// Persistent Dev Manager configuration (`dev-manager.json` in the iora-os
/// root). Controls VM sizing for NEW disk creations (first boot / reinstall)
/// and the live VM defaults. The dashboard edits this via `/api/settings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DevManagerConfig {
    /// Virtual disk size for newly created VM disks (GB).
    pub default_disk_gb: u64,
    /// RAM for the VM when no IORA_DEV_RAM env override is set (GB).
    pub default_ram_gb: u64,
    /// vCPU count when no IORA_DEV_CPUS env override is set.
    pub default_cpus: u32,
    /// Auto-start the VM when the daemon boots.
    pub autostart: bool,
    /// SFTP user for the guest file access link (default root).
    pub sftp_user: String,
    /// Extra host ports forwarded to the guest (comma separated).
    pub extra_ports: String,
}

impl Default for DevManagerConfig {
    fn default() -> Self {
        Self {
            default_disk_gb: 40,
            default_ram_gb: 8,
            default_cpus: 4,
            autostart: false,
            sftp_user: "root".into(),
            extra_ports: String::new(),
        }
    }
}

impl DevManagerConfig {
    pub fn load(root: &Path) -> Self {
        fs::read_to_string(root.join(CONFIG_FILE))
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, root: &Path) -> Result<()> {
        let path = root.join(CONFIG_FILE);
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(self)?)?;
        fs::rename(temporary, path)?;
        Ok(())
    }
}

pub const CONFIG_FILE: &str = "dev-manager.json";


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NetworkMode {
    Slirp,
    Bridge,
}

impl Default for NetworkMode {
    fn default() -> Self {
        Self::Slirp
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct PortMapping {
    pub host: u16,
    pub guest: u16,
    pub label: Option<String>,
}

impl Default for PortMapping {
    fn default() -> Self {
        Self {
            host: 0,
            guest: 0,
            label: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RuntimeState {
    pub version: u8,
    pub pid: Option<u32>,
    pub lifecycle: String,
    pub network_mode: NetworkMode,
    pub vm_host: String,
    pub ssh_port: u16,
    pub home_port: u16,
    pub qga_port: u16,
    pub qmp_port: u16,
    pub vnc_port: Option<u16>,
    pub vnc_ws_port: Option<u16>,
    pub firmware: Option<String>,
    pub acceleration: Option<String>,
    pub vm_disk: Option<PathBuf>,
    pub golden_snapshot: Option<PathBuf>,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub provisioned: bool,
    pub watcher_status: String,
    pub sync_status: String,
    pub last_ready_at: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub forwarded_ports: Vec<serde_json::Value>,
    /// Host ports that were requested for Slirp forwarding but skipped
    /// (busy on the host or requested twice) - the VM still boots, the
    /// services stay reachable inside the VM.
    pub skipped_ports: Vec<serde_json::Value>,
    /// Whether the idempotent guest self-heal fixes (guard patch, SSH
    /// hardening, net watchdog) were applied for the current VM start.
    pub guest_fixes_applied: bool,
    pub cache_path: Option<PathBuf>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            version: 1,
            pid: None,
            lifecycle: "Stopped".into(),
            network_mode: NetworkMode::Slirp,
            vm_host: "127.0.0.1".into(),
            ssh_port: 2222,
            home_port: 8126,
            qga_port: 8109,
            qmp_port: 8130,
            vnc_port: None,
            vnc_ws_port: None,
            firmware: None,
            acceleration: None,
            vm_disk: None,
            golden_snapshot: None,
            started_at: None,
            updated_at: None,
            provisioned: false,
            watcher_status: "Stopped".into(),
            sync_status: "Stopped".into(),
            last_ready_at: None,
            last_sync_at: None,
            last_error: None,
            forwarded_ports: vec![],
            skipped_ports: vec![],
            guest_fixes_applied: false,
            cache_path: None,
        }
    }
}

impl RuntimeState {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let parent = path.parent().context("runtime state path has no parent")?;
        fs::create_dir_all(parent)?;
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(self)?)?;
        fs::rename(temporary, path)?;
        Ok(())
    }

    pub fn connection(&self) -> (&str, u16, u16) {
        match self.network_mode {
            NetworkMode::Bridge => (&self.vm_host, 22, 8126),
            NetworkMode::Slirp => ("127.0.0.1", self.ssh_port, self.home_port),
        }
    }

    pub fn process_alive(&self) -> bool {
        self.pid.is_some_and(process_alive)
    }
}

#[cfg(unix)]
pub fn process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .is_ok_and(|s| s.success())
}
#[cfg(windows)]
pub fn process_alive(pid: u32) -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bridge_never_reuses_slirp_ssh_port() {
        let state = RuntimeState {
            network_mode: NetworkMode::Bridge,
            vm_host: "192.168.1.5".into(),
            ssh_port: 2222,
            ..Default::default()
        };
        assert_eq!(state.connection(), ("192.168.1.5", 22, 8126));
    }
    #[test]
    fn missing_state_uses_safe_stopped_defaults() {
        assert_eq!(
            RuntimeState::load(Path::new("/not/a/real/state.json")).lifecycle,
            "Stopped"
        );
    }
}
