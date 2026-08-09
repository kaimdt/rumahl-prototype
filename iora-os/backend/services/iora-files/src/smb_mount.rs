//! SMB/CIFS network-drive mounting for the Files app (Windows-style).
//!
//! Requires: cifs-utils + a sudoers entry allowing the service user to run
//! `mount`/`umount` without a password. Mounts live under a data directory
//! and are managed per-drive with a small JSON registry.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MOUNTS_ROOT: &str = "/opt/iora/data/iora-files/mounts";

#[derive(Serialize, Deserialize, Clone)]
pub struct MountRecord {
    pub id: String,
    pub ip: String,
    pub share: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct MountStatus {
    pub id: String,
    pub ip: String,
    pub share: String,
    pub name: String,
    pub mounted: bool,
}

#[derive(Serialize)]
pub struct MountFileEntry {
    pub name: String,
    pub is_folder: bool,
    pub size_bytes: u64,
}

fn mounts_root() -> PathBuf {
    PathBuf::from(MOUNTS_ROOT)
}

fn mount_dir(id: &str) -> PathBuf {
    mounts_root().join(id)
}

fn registry_path(id: &str) -> PathBuf {
    mounts_root().join(format!("{id}.json"))
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Register a new mount (creates the directory + runs `mount -t cifs`).
/// Credentials are optional — without them the mount uses guest access.
pub async fn mount_share(ip: &str, share: &str, username: Option<&str>, password: Option<&str>) -> Result<MountRecord, String> {
    let id = format!("net-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("0"));
    let dir = mount_dir(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;

    let name = share
        .trim_matches(|c: char| c.is_whitespace() || c == '/')
        .to_string();

    // Mount as the service user via sudo (NOPASSWD entry set up by the OS).
    let opts = match (username, password) {
        (Some(user), Some(pass)) if !user.is_empty() => {
            format!("username={user},password={pass},uid=1000,gid=1000,iocharset=utf8,vers=3.0")
        }
        _ => "guest,uid=1000,gid=1000,iocharset=utf8,vers=3.0".to_string(),
    };
    let status = tokio::process::Command::new("sudo")
        .args([
            "mount",
            "-t",
            "cifs",
            &format!("//{ip}/{share}"),
            dir.to_str().unwrap_or(""),
            "-o",
            &opts,
        ])
        .output()
        .await
        .map_err(|e| format!("mount cmd: {e}"))?;

    if !status.status.success() {
        let _ = std::fs::remove_dir_all(&dir);
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!(
            "Mount fehlgeschlagen: {}",
            stderr.trim().lines().last().unwrap_or("unbekannter Fehler")
        ));
    }

    let record = MountRecord { id: id.clone(), ip: ip.to_string(), share: share.to_string(), name };
    let json = serde_json::to_string_pretty(&record).unwrap_or_default();
    let _ = std::fs::write(registry_path(&id), json);
    Ok(record)
}

/// Unmount + remove the mount directory and registry entry.
pub async fn unmount_mount(id: &str) -> Result<(), String> {
    if !safe_id(id) {
        return Err("invalid id".into());
    }
    let dir = mount_dir(id);
    if dir.exists() {
        let _ = tokio::process::Command::new("sudo")
            .args(["umount", dir.to_str().unwrap_or("")])
            .output()
            .await;
    }
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(registry_path(id));
    Ok(())
}

/// List all registered mounts with their mounted state.
pub async fn list_mounts() -> Vec<MountStatus> {
    let mut mounts = Vec::new();
    let Ok(entries) = std::fs::read_dir(mounts_root()) else {
        return mounts;
    };
    let mut records = HashMap::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(record) = serde_json::from_str::<MountRecord>(&content) {
                    records.insert(record.id.clone(), record);
                }
            }
        }
    }
    for (id, record) in records {
        let dir = mount_dir(&id);
        let mounted = dir.exists() && is_mountpoint(&dir);
        mounts.push(MountStatus {
            id,
            ip: record.ip,
            share: record.share,
            name: record.name,
            mounted,
        });
    }
    mounts.sort_by(|a, b| a.name.cmp(&b.name));
    mounts
}

fn is_mountpoint(dir: &Path) -> bool {
    // Cheap heuristic: a mounted cifs dir contains the share root marker.
    std::fs::metadata(dir.join(".hidden")).is_ok()
        || std::fs::read_dir(dir).map(|mut d| d.next().is_some()).unwrap_or(false)
}

/// List files inside a mounted network drive.
pub fn list_mount_files(id: &str) -> Result<Vec<MountFileEntry>, String> {
    if !safe_id(id) {
        return Err("invalid id".into());
    }
    let dir = mount_dir(id);
    if !dir.is_dir() {
        return Err("mount nicht gefunden".into());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        files.push(MountFileEntry {
            name,
            is_folder: meta.is_dir(),
            size_bytes: meta.len(),
        });
    }
    files.sort_by(|a, b| b.is_folder.cmp(&a.is_folder).then(a.name.cmp(&b.name)));
    Ok(files)
}

/// Read a file from a mounted drive (by relative path).
pub fn read_mount_file(id: &str, rel_path: &str) -> Result<Vec<u8>, String> {
    if !safe_id(id) {
        return Err("invalid id".into());
    }
    let base = mount_dir(id);
    let candidate = base.join(rel_path.trim_start_matches('/'));
    // Prevent path traversal.
    if !candidate.starts_with(&base) {
        return Err("invalid path".into());
    }
    std::fs::read(&candidate).map_err(|e| e.to_string())
}
