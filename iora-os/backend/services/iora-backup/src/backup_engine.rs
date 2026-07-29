//! Backup engine: creates compressed tar.gz archives of selected content
//! (Postgres dumps, system config dirs, user data, app data).
//!
//! Designed to run inside the iora-os container with read access to the
//! relevant volumes; falls back to a manifest-only "logical" backup when
//! a path is missing so it never panics on incomplete deployments.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::{DateTime, Utc};
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BackupOptions {
    pub include_databases: bool,
    pub include_docker_volumes: bool,
    pub include_system_config: bool,
    pub include_user_data: bool,
    pub include_apps: bool,
    /// Optional override for the backup output directory.
    pub backup_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub id: Uuid,
    pub name: String,
    pub local_path: PathBuf,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
    pub manifest: serde_json::Value,
}

pub struct BackupEngine {
    backup_dir: PathBuf,
    /// Postgres connection string used for `pg_dump`.
    database_url: String,
}

impl BackupEngine {
    pub fn new(backup_dir: PathBuf, database_url: String) -> Self {
        let _ = fs::create_dir_all(&backup_dir);
        Self {
            backup_dir,
            database_url,
        }
    }

    #[allow(dead_code)]
    pub fn backup_dir(&self) -> &Path {
        &self.backup_dir
    }

    /// Create a new backup archive. Blocking — call from `spawn_blocking`.
    pub fn create_backup(&self, name: &str, opts: &BackupOptions) -> anyhow::Result<BackupResult> {
        let id = Uuid::new_v4();
        let dir = opts
            .backup_dir
            .clone()
            .unwrap_or_else(|| self.backup_dir.clone());
        fs::create_dir_all(&dir)?;
        let safe_name = sanitize_filename(name);
        let stem = format!(
            "{}_{}_{}",
            safe_name,
            Utc::now().format("%Y%m%d-%H%M%S"),
            &id.to_string()[..8]
        );
        let archive_path = dir.join(format!("{stem}.tar.gz"));

        let file = fs::File::create(&archive_path)?;
        let enc = GzEncoder::new(file, Compression::default());
        let mut tar = tar::Builder::new(enc);

        let mut manifest = serde_json::Map::new();
        manifest.insert("id".into(), serde_json::Value::String(id.to_string()));
        manifest.insert("name".into(), serde_json::Value::String(name.to_string()));
        manifest.insert(
            "created_at".into(),
            serde_json::Value::String(Utc::now().to_rfc3339()),
        );
        let mut sections: Vec<serde_json::Value> = Vec::new();

        if opts.include_databases {
            match self.dump_postgres_to_tar(&mut tar) {
                Ok(bytes) => sections.push(serde_json::json!({
                    "section": "databases",
                    "ok": true,
                    "bytes": bytes,
                })),
                Err(e) => {
                    warn!("postgres dump failed: {e}");
                    sections.push(serde_json::json!({
                        "section": "databases",
                        "ok": false,
                        "error": e.to_string(),
                    }));
                }
            }
        }

        for (flag, label, candidates) in [
            (
                opts.include_docker_volumes,
                "docker_volumes",
                vec!["/var/lib/iora/volumes", "/var/iora/volumes"],
            ),
            (
                opts.include_system_config,
                "system_config",
                vec!["/etc/iora", "/var/lib/iora/config"],
            ),
            (
                opts.include_user_data,
                "user_data",
                vec!["/var/lib/iora/data", "/data/iora"],
            ),
            (
                opts.include_apps,
                "apps",
                vec!["/var/lib/iora/apps", "/data/iora/apps"],
            ),
        ] {
            if !flag {
                continue;
            }
            let mut found_any = false;
            for path in &candidates {
                let p = Path::new(path);
                if p.exists() {
                    if let Err(e) = tar.append_dir_all(label, p) {
                        warn!("failed to add {label} from {path}: {e}");
                        sections.push(serde_json::json!({
                            "section": label,
                            "ok": false,
                            "path": path,
                            "error": e.to_string(),
                        }));
                    } else {
                        sections.push(serde_json::json!({
                            "section": label,
                            "ok": true,
                            "path": path,
                        }));
                        found_any = true;
                        break;
                    }
                }
            }
            if !found_any {
                sections.push(serde_json::json!({
                    "section": label,
                    "ok": false,
                    "error": "no candidate path exists on this system",
                    "candidates": candidates,
                }));
            }
        }

        manifest.insert("sections".into(), serde_json::Value::Array(sections));

        // Embed the manifest itself in the archive for full self-description.
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest_bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, "MANIFEST.json", &manifest_bytes[..])?;

        // Finalise the gz stream + flush.
        let enc = tar.into_inner()?;
        let mut file = enc.finish()?;
        file.flush()?;
        let size_bytes = fs::metadata(&archive_path)?.len();

        info!(
            "backup created: {} ({} bytes)",
            archive_path.display(),
            size_bytes
        );

        Ok(BackupResult {
            id,
            name: name.to_string(),
            local_path: archive_path,
            size_bytes,
            created_at: Utc::now(),
            manifest: serde_json::Value::Object(manifest),
        })
    }

    /// Restore is non-destructive by default: we extract the tar.gz into
    /// `<backup_dir>/restore-<id>/` and the operator can promote files
    /// manually. Avoids destroying live data accidentally.
    ///
    /// Hardened via [`iora_shared_upload::SecureUploadStore`]: every
    /// tar entry is validated (no `..`, no absolute paths, no symlinks,
    /// per-file/total/entry-count caps) before being unpacked.
    pub fn restore_backup(&self, archive_path: &Path) -> anyhow::Result<PathBuf> {
        use iora_shared_upload::{SecureUploadStore, TarExtractLimits};

        let id = Uuid::new_v4();
        let scope = format!("restore-{}", id);

        let store = SecureUploadStore::new(&self.backup_dir)?;
        let file = fs::File::open(archive_path)?;
        let limits = TarExtractLimits {
            // Backups can be large but must still be bounded; refuse single
            // entries above 4 GiB and archives above 50 GiB.
            max_total_uncompressed: 50 * 1024 * 1024 * 1024,
            max_per_file: 4 * 1024 * 1024 * 1024,
            max_entries: 1_000_000,
            max_path_components: 64,
            allow_symlinks: false,
        };

        let target = store
            .extract_tar_gz(&scope, file, &limits)
            .map_err(|e| anyhow::anyhow!("restore failed: {}", e))?;

        info!("backup restored to staging dir: {}", target.display());
        Ok(target)
    }

    fn dump_postgres_to_tar<W: Write>(&self, tar: &mut tar::Builder<W>) -> anyhow::Result<usize> {
        // Use pg_dump if available; fall back to a logical "info"
        // marker so the section is still recorded.
        let out = Command::new("pg_dump")
            .arg("--format=plain")
            .arg("--no-owner")
            .arg(&self.database_url)
            .output();
        let bytes = match out {
            Ok(o) if o.status.success() => o.stdout,
            Ok(o) => {
                anyhow::bail!(
                    "pg_dump exit {}: {}",
                    o.status,
                    String::from_utf8_lossy(&o.stderr).trim()
                );
            }
            Err(e) => anyhow::bail!("pg_dump spawn failed: {e}"),
        };
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o600);
        header.set_cksum();
        tar.append_data(&mut header, "databases/postgres.sql", &bytes[..])?;
        Ok(bytes.len())
    }
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
