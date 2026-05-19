use anyhow::{Context, Result};
use rand::Rng;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::path::Path;

use crate::config::DbConfig;
use crate::rotation::PasswordRotation;
use crate::user_manager::UserManager;

pub struct DatabaseManager {
    pool: PgPool,
    config: DbConfig,
    user_manager: UserManager,
    rotation: PasswordRotation,
}

impl DatabaseManager {
    pub async fn new(admin_url: &str, config_path: &Path) -> Result<Self> {
        let pool = PgPool::connect(admin_url)
            .await
            .context("Failed to connect to PostgreSQL as admin")?;

        let config = DbConfig::load_or_create(config_path)?;

        // Create tracking tables if they don't exist
        Self::ensure_tracking_tables(&pool).await?;

        let user_manager = UserManager::new(pool.clone());
        let rotation = PasswordRotation::new(pool.clone(), config.rotation.clone());

        Ok(Self {
            pool,
            config,
            user_manager,
            rotation,
        })
    }

    async fn ensure_tracking_tables(pool: &PgPool) -> Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS _iora_db_users (
                service VARCHAR(100) PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                database_name VARCHAR(100) NOT NULL,
                password_hash VARCHAR(64) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_rotated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                next_rotation TIMESTAMPTZ NOT NULL,
                rotation_count INTEGER NOT NULL DEFAULT 0,
                conn_limit INTEGER NOT NULL DEFAULT 20
            );

            CREATE TABLE IF NOT EXISTS _iora_password_history (
                id SERIAL PRIMARY KEY,
                service VARCHAR(100) NOT NULL,
                password_hash VARCHAR(64) NOT NULL,
                valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                valid_until TIMESTAMPTZ,
                replaced_at TIMESTAMPTZ,
                FOREIGN KEY (service) REFERENCES _iora_db_users(service) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_password_history_service
                ON _iora_password_history(service);
            CREATE INDEX IF NOT EXISTS idx_password_history_valid
                ON _iora_password_history(service, valid_until)
                WHERE valid_until IS NULL;
            "#,
        )
        .execute(pool)
        .await
        .context("Failed to create tracking tables")?;

        Ok(())
    }

    pub async fn initialize_all(&self, force: bool) -> Result<()> {
        tracing::info!("Initializing all service databases and users...");

        for (service_name, service_config) in &self.config.services {
            let db_name = self.config.get_database_name(service_name);
            let user_name = self.config.get_user_name(service_name);

            tracing::info!("Setting up {} -> {}", service_name, db_name);

            // Create database if it doesn't exist
            self.create_database_if_not_exists(&db_name, force).await?;

            // Generate password
            let password = Self::generate_password(self.config.rotation.min_password_length);

            // Create or update user
            self.user_manager
                .create_or_update_user(
                    &user_name,
                    &password,
                    &db_name,
                    service_config.conn_limit,
                    service_config.allow_ddl,
                    service_config.allow_temp_tables,
                )
                .await?;

            // Track in our system
            self.track_user(service_name, &user_name, &db_name, &password, service_config.conn_limit)
                .await?;

            // Write connection string to service-specific location
            self.write_connection_string(service_name, &user_name, &password, &db_name)
                .await?;
        }

        Ok(())
    }

    async fn create_database_if_not_exists(&self, db_name: &str, force: bool) -> Result<()> {
        // Check if database exists
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)",
        )
        .bind(db_name)
        .fetch_one(&self.pool)
        .await?;

        if exists && !force {
            tracing::debug!("Database {} already exists", db_name);
            return Ok(());
        }

        if exists && force {
            tracing::warn!("Dropping existing database: {}", db_name);
            // Terminate existing connections
            sqlx::query(&format!(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}'",
                db_name
            ))
            .execute(&self.pool)
            .await?;

            sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", db_name))
                .execute(&self.pool)
                .await?;
        }

        // Create database
        sqlx::query(&format!("CREATE DATABASE \"{}\" ENCODING 'UTF8'", db_name))
            .execute(&self.pool)
            .await
            .context(format!("Failed to create database {}", db_name))?;

        tracing::info!("Created database: {}", db_name);
        Ok(())
    }

    async fn track_user(
        &self,
        service: &str,
        username: &str,
        database: &str,
        password: &str,
        conn_limit: i32,
    ) -> Result<()> {
        let password_hash = Self::hash_password(password);
        let next_rotation = chrono::Utc::now()
            + chrono::Duration::days(self.config.rotation.interval_days as i64);

        sqlx::query(
            r#"
            INSERT INTO _iora_db_users
                (service, username, database_name, password_hash, next_rotation, conn_limit)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (service) DO UPDATE SET
                username = $2,
                database_name = $3,
                password_hash = $4,
                last_rotated = NOW(),
                next_rotation = $5,
                rotation_count = _iora_db_users.rotation_count + 1,
                conn_limit = $6
            "#,
        )
        .bind(service)
        .bind(username)
        .bind(database)
        .bind(&password_hash)
        .bind(next_rotation)
        .bind(conn_limit)
        .execute(&self.pool)
        .await?;

        // Add to password history
        sqlx::query(
            r#"
            INSERT INTO _iora_password_history (service, password_hash)
            VALUES ($1, $2)
            "#,
        )
        .bind(service)
        .bind(&password_hash)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn write_connection_string(
        &self,
        service: &str,
        username: &str,
        password: &str,
        database: &str,
    ) -> Result<()> {
        let conn_str = format!("postgres://{}:{}@localhost:5432/{}", username, password, database);

        // Write to /etc/iora/db-credentials/{service}.env
        let cred_dir = Path::new("/etc/iora/db-credentials");
        std::fs::create_dir_all(cred_dir)?;

        let cred_file = cred_dir.join(format!("{}.env", service));
        std::fs::write(&cred_file, format!("DATABASE_URL={}\n", conn_str))?;

        // Set restrictive permissions (root only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&cred_file, std::fs::Permissions::from_mode(0o600))?;
        }

        tracing::debug!("Wrote credentials to {}", cred_file.display());
        Ok(())
    }

    pub async fn rotate_service_password(&self, service: &str, notify: bool) -> Result<()> {
        self.rotation.rotate_service(service, notify).await
    }

    pub async fn rotate_all_passwords(&self, notify: bool) -> Result<usize> {
        self.rotation.rotate_all(notify).await
    }

    pub async fn print_status(&self) -> Result<()> {
        let users: Vec<(String, String, String, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>, i32, i32)> =
            sqlx::query_as(
                r#"
                SELECT service, username, database_name, created_at, next_rotation, rotation_count, conn_limit
                FROM _iora_db_users
                ORDER BY service
                "#,
            )
            .fetch_all(&self.pool)
            .await?;

        println!("\n{:─<100}", "");
        println!("{:<20} {:<25} {:<25} {:<12} {:<8}", "Service", "Username", "Database", "Next Rotation", "Rotations");
        println!("{:─<100}", "");

        for (service, username, database, _created, next_rot, rot_count, _conn_limit) in users {
            let days_until = (next_rot - chrono::Utc::now()).num_days();
            let status = if days_until < 7 {
                format!("⚠️  {} days", days_until)
            } else {
                format!("✓  {} days", days_until)
            };

            println!(
                "{:<20} {:<25} {:<25} {:<12} {:<8}",
                service, username, database, status, rot_count
            );
        }

        println!("{:─<100}\n", "");
        Ok(())
    }

    pub async fn create_service(&self, service: &str, db_name: &str, conn_limit: i32) -> Result<()> {
        self.create_database_if_not_exists(db_name, false).await?;

        let user_name = self.config.get_user_name(service);
        let password = Self::generate_password(self.config.rotation.min_password_length);

        self.user_manager
            .create_or_update_user(&user_name, &password, db_name, conn_limit, false, true)
            .await?;

        self.track_user(service, &user_name, db_name, &password, conn_limit)
            .await?;

        self.write_connection_string(service, &user_name, &password, db_name)
            .await?;

        Ok(())
    }

    pub async fn drop_service(&self, service: &str) -> Result<()> {
        let user_info: Option<(String, String)> = sqlx::query_as(
            "SELECT username, database_name FROM _iora_db_users WHERE service = $1",
        )
        .bind(service)
        .fetch_optional(&self.pool)
        .await?;

        if let Some((username, db_name)) = user_info {
            // Drop user
            sqlx::query(&format!("DROP USER IF EXISTS \"{}\"", username))
                .execute(&self.pool)
                .await?;

            // Drop database
            sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", db_name))
                .execute(&self.pool)
                .await?;

            // Remove from tracking
            sqlx::query("DELETE FROM _iora_db_users WHERE service = $1")
                .bind(service)
                .execute(&self.pool)
                .await?;

            // Remove credentials file
            let cred_file = Path::new("/etc/iora/db-credentials").join(format!("{}.env", service));
            let _ = std::fs::remove_file(cred_file);

            tracing::info!("Dropped user {} and database {}", username, db_name);
        }

        Ok(())
    }

    pub async fn export_connection_strings(&self, format: &str) -> Result<String> {
        let users: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT service, username, database_name FROM _iora_db_users ORDER BY service",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut output = String::new();

        for (service, username, db_name) in users {
            // Read password from credentials file
            let cred_file = Path::new("/etc/iora/db-credentials").join(format!("{}.env", service));
            let content = std::fs::read_to_string(&cred_file)
                .context(format!("Failed to read {}", cred_file.display()))?;
            let password = content
                .lines()
                .find(|l| l.starts_with("DATABASE_URL="))
                .and_then(|l| l.split(':').nth(2))
                .and_then(|l| l.split('@').next())
                .unwrap_or("***");

            match format {
                "env" => {
                    let key = format!("{}_DB_URL", service.to_uppercase().replace('-', "_"));
                    output.push_str(&format!(
                        "{}=postgres://{}:{}@localhost:5432/{}\n",
                        key, username, password, db_name
                    ));
                }
                "json" => {
                    // Simple JSON output
                    output.push_str(&format!(
                        "  \"{}\": \"postgres://{}:***@localhost:5432/{}\",\n",
                        service, username, db_name
                    ));
                }
                "systemd" => {
                    output.push_str(&format!(
                        "[Service]\nEnvironment=DATABASE_URL=postgres://{}:{}@localhost:5432/{}\n\n",
                        username, password, db_name
                    ));
                }
                _ => {
                    anyhow::bail!("Unknown format: {}", format);
                }
            }
        }

        Ok(output)
    }

    pub async fn backup_all_databases(&self, backup_dir: &Path) -> Result<Vec<String>> {
        let databases: Vec<(String,)> = sqlx::query_as(
            "SELECT datname FROM pg_database WHERE datname LIKE 'iora_%'",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut files = Vec::new();
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");

        for (db_name,) in databases {
            let filename = format!("{}_{}.sql", db_name, timestamp);
            let filepath = backup_dir.join(&filename);

            // Use pg_dump via command
            let output = tokio::process::Command::new("pg_dump")
                .arg(&db_name)
                .arg("-f")
                .arg(&filepath)
                .output()
                .await?;

            if !output.status.success() {
                tracing::error!("Failed to backup {}: {}", db_name, String::from_utf8_lossy(&output.stderr));
                continue;
            }

            files.push(filename);
        }

        Ok(files)
    }

    pub async fn check_rotation_schedule(&self) -> Result<()> {
        let due: Vec<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
            r#"
            SELECT service, next_rotation
            FROM _iora_db_users
            WHERE next_rotation < NOW() + INTERVAL '7 days'
            ORDER BY next_rotation
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        if due.is_empty() {
            println!("✓ No password rotations due in the next 7 days");
            return Ok(());
        }

        println!("\n⚠️  Password rotations due:\n");
        for (service, next_rot) in due {
            let days = (next_rot - chrono::Utc::now()).num_days();
            if days < 0 {
                println!("  {} - OVERDUE by {} days", service, -days);
            } else {
                println!("  {} - in {} days", service, days);
            }
        }
        println!();

        Ok(())
    }

    fn generate_password(length: usize) -> String {
        const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
        let mut rng = rand::thread_rng();
        (0..length)
            .map(|_| {
                let idx = rng.gen_range(0..CHARSET.len());
                CHARSET[idx] as char
            })
            .collect()
    }

    fn hash_password(password: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        hex::encode(hasher.finalize())
    }
}
