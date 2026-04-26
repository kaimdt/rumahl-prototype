use std::path::{Path, PathBuf};
use std::process::Command;
use flate2::Compression;
use flate2::write::GzEncoder;
use tar::Builder;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum BackupError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database backup failed: {0}")]
    DatabaseBackup(String),

    #[error("Docker operation failed: {0}")]
    DockerError(String),

    #[error("Backup file not found: {0}")]
    FileNotFound(String),

    #[error("Invalid backup format: {0}")]
    InvalidFormat(String),
}

pub type Result<T> = std::result::Result<T, BackupError>;

#[derive(Debug, Clone)]
pub struct BackupOptions {
    pub include_databases: bool,
    pub include_docker_volumes: bool,
    pub include_system_config: bool,
    pub include_user_data: bool,
    pub include_apps: bool,
}

pub struct BackupEngine {
    temp_dir: PathBuf,
}

impl BackupEngine {
    pub fn new() -> Self {
        Self {
            temp_dir: PathBuf::from("/tmp/iora-backups"),
        }
    }

    /// Create a complete backup
    pub async fn create_backup(
        &self,
        backup_id: &Uuid,
        output_path: &str,
        options: BackupOptions,
    ) -> Result<u64> {
        info!("Creating backup {} with options: {:?}", backup_id, options);

        // Create temporary directory for backup staging
        let staging_dir = self.temp_dir.join(backup_id.to_string());
        tokio::fs::create_dir_all(&staging_dir).await?;

        let mut total_size = 0u64;

        // Backup databases
        if options.include_databases {
            info!("Backing up databases...");
            match self.backup_databases(&staging_dir).await {
                Ok(size) => {
                    total_size += size;
                    info!("Database backup completed: {} bytes", size);
                }
                Err(e) => {
                    error!("Database backup failed: {}", e);
                    return Err(e);
                }
            }
        }

        // Backup Docker volumes
        if options.include_docker_volumes {
            info!("Backing up Docker volumes...");
            match self.backup_docker_volumes(&staging_dir).await {
                Ok(size) => {
                    total_size += size;
                    info!("Docker volumes backup completed: {} bytes", size);
                }
                Err(e) => {
                    error!("Docker volumes backup failed: {}", e);
                    return Err(e);
                }
            }
        }

        // Backup system configuration
        if options.include_system_config {
            info!("Backing up system configuration...");
            match self.backup_system_config(&staging_dir).await {
                Ok(size) => {
                    total_size += size;
                    info!("System config backup completed: {} bytes", size);
                }
                Err(e) => {
                    error!("System config backup failed: {}", e);
                    return Err(e);
                }
            }
        }

        // Backup user data
        if options.include_user_data {
            info!("Backing up user data...");
            match self.backup_user_data(&staging_dir).await {
                Ok(size) => {
                    total_size += size;
                    info!("User data backup completed: {} bytes", size);
                }
                Err(e) => {
                    error!("User data backup failed: {}", e);
                    return Err(e);
                }
            }
        }

        // Backup apps
        if options.include_apps {
            info!("Backing up apps...");
            match self.backup_apps(&staging_dir).await {
                Ok(size) => {
                    total_size += size;
                    info!("Apps backup completed: {} bytes", size);
                }
                Err(e) => {
                    error!("Apps backup failed: {}", e);
                    return Err(e);
                }
            }
        }

        // Create compressed tar archive
        info!("Creating compressed archive...");
        let archive_size = self.create_archive(&staging_dir, output_path).await?;

        // Cleanup staging directory
        if let Err(e) = tokio::fs::remove_dir_all(&staging_dir).await {
            warn!("Failed to cleanup staging directory: {}", e);
        }

        info!("Backup {} created successfully: {} bytes", backup_id, archive_size);
        Ok(archive_size)
    }

    /// Restore from backup
    pub async fn restore_backup(
        &self,
        backup_path: &str,
        options: BackupOptions,
    ) -> Result<()> {
        info!("Restoring from backup: {}", backup_path);

        // Extract archive to temporary directory
        let restore_id = Uuid::new_v4();
        let staging_dir = self.temp_dir.join(format!("restore_{}", restore_id));
        tokio::fs::create_dir_all(&staging_dir).await?;

        info!("Extracting backup archive...");
        self.extract_archive(backup_path, &staging_dir).await?;

        // Restore databases
        if options.include_databases {
            info!("Restoring databases...");
            self.restore_databases(&staging_dir).await?;
        }

        // Restore Docker volumes
        if options.include_docker_volumes {
            info!("Restoring Docker volumes...");
            self.restore_docker_volumes(&staging_dir).await?;
        }

        // Restore system configuration
        if options.include_system_config {
            info!("Restoring system configuration...");
            self.restore_system_config(&staging_dir).await?;
        }

        // Restore user data
        if options.include_user_data {
            info!("Restoring user data...");
            self.restore_user_data(&staging_dir).await?;
        }

        // Restore apps
        if options.include_apps {
            info!("Restoring apps...");
            self.restore_apps(&staging_dir).await?;
        }

        // Cleanup staging directory
        if let Err(e) = tokio::fs::remove_dir_all(&staging_dir).await {
            warn!("Failed to cleanup staging directory: {}", e);
        }

        info!("Restore completed successfully");
        Ok(())
    }

    /// Backup all databases
    async fn backup_databases(&self, staging_dir: &Path) -> Result<u64> {
        let db_dir = staging_dir.join("databases");
        tokio::fs::create_dir_all(&db_dir).await?;

        let databases = vec![
            "iora_home",
            "iora_core",
            "iora_security",
            "iora_secrets",
            "iora_backup",
        ];

        let mut total_size = 0u64;

        for db_name in databases {
            let output_file = db_dir.join(format!("{}.sql", db_name));

            info!("Backing up database: {}", db_name);

            // Use pg_dump to backup database
            let output = Command::new("pg_dump")
                .env("PGPASSWORD", std::env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "changeme".to_string()))
                .arg("-h").arg(std::env::var("POSTGRES_HOST").unwrap_or_else(|_| "postgres".to_string()))
                .arg("-U").arg(std::env::var("POSTGRES_USER").unwrap_or_else(|_| "iora".to_string()))
                .arg("-d").arg(db_name)
                .arg("--no-owner")
                .arg("--no-acl")
                .arg("-f").arg(&output_file)
                .output()
                .map_err(|e| BackupError::DatabaseBackup(e.to_string()))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Ignore "does not exist" errors for optional databases
                if !stderr.contains("does not exist") {
                    return Err(BackupError::DatabaseBackup(stderr.to_string()));
                }
            } else {
                let metadata = tokio::fs::metadata(&output_file).await?;
                total_size += metadata.len();
            }
        }

        Ok(total_size)
    }

    /// Backup Docker volumes
    async fn backup_docker_volumes(&self, staging_dir: &Path) -> Result<u64> {
        let volumes_dir = staging_dir.join("volumes");
        tokio::fs::create_dir_all(&volumes_dir).await?;

        // Get list of IORA volumes
        let output = Command::new("docker")
            .args(&["volume", "ls", "--format", "{{.Name}}"])
            .output()
            .map_err(|e| BackupError::DockerError(e.to_string()))?;

        if !output.status.success() {
            return Err(BackupError::DockerError("Failed to list volumes".to_string()));
        }

        let volumes = String::from_utf8_lossy(&output.stdout);
        let mut total_size = 0u64;

        for volume_name in volumes.lines() {
            // Only backup IORA volumes
            if !volume_name.starts_with("home-assistant-dashb_") && !volume_name.contains("iora") {
                continue;
            }

            info!("Backing up volume: {}", volume_name);

            let output_file = volumes_dir.join(format!("{}.tar", volume_name));

            // Use docker run to backup volume
            let status = Command::new("docker")
                .args(&[
                    "run", "--rm",
                    "-v", &format!("{}:/volume", volume_name),
                    "-v", &format!("{}:/backup", volumes_dir.display()),
                    "busybox",
                    "tar", "-cf", &format!("/backup/{}.tar", volume_name), "-C", "/volume", ".",
                ])
                .status()
                .map_err(|e| BackupError::DockerError(e.to_string()))?;

            if !status.success() {
                warn!("Failed to backup volume: {}", volume_name);
                continue;
            }

            if let Ok(metadata) = tokio::fs::metadata(&output_file).await {
                total_size += metadata.len();
            }
        }

        Ok(total_size)
    }

    /// Backup system configuration
    async fn backup_system_config(&self, staging_dir: &Path) -> Result<u64> {
        let config_dir = staging_dir.join("config");
        tokio::fs::create_dir_all(&config_dir).await?;

        let mut total_size = 0u64;

        // Backup configuration files
        let config_files = vec![
            "/etc/iora/manifest.json",
            "/etc/iora-version",
            "/etc/iora/build-info.json",
            "/mnt/data/iora/docker-compose.yml",
        ];

        for config_file in config_files {
            if let Ok(content) = tokio::fs::read(config_file).await {
                let filename = Path::new(config_file).file_name().unwrap();
                let dest = config_dir.join(filename);
                tokio::fs::write(&dest, &content).await?;
                total_size += content.len() as u64;
            }
        }

        // Backup environment variables
        if let Ok(content) = tokio::fs::read("/mnt/data/iora/.env").await {
            tokio::fs::write(config_dir.join(".env"), &content).await?;
            total_size += content.len() as u64;
        }

        Ok(total_size)
    }

    /// Backup user data
    async fn backup_user_data(&self, staging_dir: &Path) -> Result<u64> {
        let data_dir = staging_dir.join("userdata");
        tokio::fs::create_dir_all(&data_dir).await?;

        let mut total_size = 0u64;

        // Backup user files from /var/lib/iora
        let iora_data = PathBuf::from("/var/lib/iora");
        if iora_data.exists() {
            // Copy directory recursively
            match copy_dir_recursive(&iora_data, &data_dir).await {
                Ok(size) => total_size += size,
                Err(e) => warn!("Failed to backup user data: {}", e),
            }
        }

        Ok(total_size)
    }

    /// Backup apps
    async fn backup_apps(&self, staging_dir: &Path) -> Result<u64> {
        let apps_dir = staging_dir.join("apps");
        tokio::fs::create_dir_all(&apps_dir).await?;

        let mut total_size = 0u64;

        // Backup app data from /var/lib/iora/apps
        let apps_data = PathBuf::from("/var/lib/iora/apps");
        if apps_data.exists() {
            match copy_dir_recursive(&apps_data, &apps_dir).await {
                Ok(size) => total_size += size,
                Err(e) => warn!("Failed to backup apps: {}", e),
            }
        }

        Ok(total_size)
    }

    /// Restore databases
    async fn restore_databases(&self, staging_dir: &Path) -> Result<()> {
        let db_dir = staging_dir.join("databases");
        if !db_dir.exists() {
            return Ok(());
        }

        let mut entries = tokio::fs::read_dir(&db_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("sql") {
                continue;
            }

            let db_name = path.file_stem().unwrap().to_str().unwrap();
            info!("Restoring database: {}", db_name);

            // Use psql to restore database
            let output = Command::new("psql")
                .env("PGPASSWORD", std::env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "changeme".to_string()))
                .arg("-h").arg(std::env::var("POSTGRES_HOST").unwrap_or_else(|_| "postgres".to_string()))
                .arg("-U").arg(std::env::var("POSTGRES_USER").unwrap_or_else(|_| "iora".to_string()))
                .arg("-d").arg(db_name)
                .arg("-f").arg(&path)
                .output()
                .map_err(|e| BackupError::DatabaseBackup(e.to_string()))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!("Failed to restore database {}: {}", db_name, stderr);
            }
        }

        Ok(())
    }

    /// Restore Docker volumes
    async fn restore_docker_volumes(&self, staging_dir: &Path) -> Result<()> {
        let volumes_dir = staging_dir.join("volumes");
        if !volumes_dir.exists() {
            return Ok(());
        }

        let mut entries = tokio::fs::read_dir(&volumes_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("tar") {
                continue;
            }

            let volume_name = path.file_stem().unwrap().to_str().unwrap();
            info!("Restoring volume: {}", volume_name);

            // Create volume if it doesn't exist
            let _ = Command::new("docker")
                .args(&["volume", "create", volume_name])
                .output();

            // Restore volume data
            let status = Command::new("docker")
                .args(&[
                    "run", "--rm",
                    "-v", &format!("{}:/volume", volume_name),
                    "-v", &format!("{}:/backup", volumes_dir.display()),
                    "busybox",
                    "tar", "-xf", &format!("/backup/{}.tar", volume_name), "-C", "/volume",
                ])
                .status()
                .map_err(|e| BackupError::DockerError(e.to_string()))?;

            if !status.success() {
                warn!("Failed to restore volume: {}", volume_name);
            }
        }

        Ok(())
    }

    /// Restore system configuration
    async fn restore_system_config(&self, staging_dir: &Path) -> Result<()> {
        let config_dir = staging_dir.join("config");
        if !config_dir.exists() {
            return Ok(());
        }

        // Restore configuration files
        let mut entries = tokio::fs::read_dir(&config_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let filename = path.file_name().unwrap().to_str().unwrap();

            // Determine destination path
            let dest = match filename {
                "manifest.json" => PathBuf::from("/etc/iora/manifest.json"),
                "iora-version" => PathBuf::from("/etc/iora-version"),
                "build-info.json" => PathBuf::from("/etc/iora/build-info.json"),
                "docker-compose.yml" => PathBuf::from("/mnt/data/iora/docker-compose.yml"),
                ".env" => PathBuf::from("/mnt/data/iora/.env"),
                _ => continue,
            };

            if let Ok(content) = tokio::fs::read(&path).await {
                // Create parent directory if needed
                if let Some(parent) = dest.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                tokio::fs::write(&dest, content).await?;
                info!("Restored config file: {}", filename);
            }
        }

        Ok(())
    }

    /// Restore user data
    async fn restore_user_data(&self, staging_dir: &Path) -> Result<()> {
        let data_dir = staging_dir.join("userdata");
        if !data_dir.exists() {
            return Ok(());
        }

        let dest = PathBuf::from("/var/lib/iora");
        tokio::fs::create_dir_all(&dest).await?;

        copy_dir_recursive(&data_dir, &dest).await?;

        Ok(())
    }

    /// Restore apps
    async fn restore_apps(&self, staging_dir: &Path) -> Result<()> {
        let apps_dir = staging_dir.join("apps");
        if !apps_dir.exists() {
            return Ok(());
        }

        let dest = PathBuf::from("/var/lib/iora/apps");
        tokio::fs::create_dir_all(&dest).await?;

        copy_dir_recursive(&apps_dir, &dest).await?;

        Ok(())
    }

    /// Create compressed tar archive
    async fn create_archive(&self, source_dir: &Path, output_path: &str) -> Result<u64> {
        let tar_gz = std::fs::File::create(output_path)?;
        let enc = GzEncoder::new(tar_gz, Compression::default());
        let mut tar = Builder::new(enc);

        tar.append_dir_all(".", source_dir)?;
        tar.finish()?;

        let metadata = tokio::fs::metadata(output_path).await?;
        Ok(metadata.len())
    }

    /// Extract tar.gz archive
    async fn extract_archive(&self, archive_path: &str, dest_dir: &Path) -> Result<()> {
        use flate2::read::GzDecoder;
        use tar::Archive;

        let tar_gz = std::fs::File::open(archive_path)?;
        let tar = GzDecoder::new(tar_gz);
        let mut archive = Archive::new(tar);

        archive.unpack(dest_dir)?;

        Ok(())
    }
}

/// Recursively copy directory
async fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<u64> {
    tokio::fs::create_dir_all(dst).await?;

    let mut total_size = 0u64;
    let mut entries = tokio::fs::read_dir(src).await?;

    while let Some(entry) = entries.next_entry().await? {
        let ty = entry.file_type().await?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            total_size += copy_dir_recursive(&src_path, &dst_path).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path).await?;
            let metadata = tokio::fs::metadata(&dst_path).await?;
            total_size += metadata.len();
        }
    }

    Ok(total_size)
}
