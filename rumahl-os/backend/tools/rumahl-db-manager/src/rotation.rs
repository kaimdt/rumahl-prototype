use anyhow::Result;
use sqlx::PgPool;
use std::path::Path;

use crate::config::RotationConfig;

pub struct PasswordRotation {
    pool: PgPool,
    config: RotationConfig,
}

impl PasswordRotation {
    pub fn new(pool: PgPool, config: RotationConfig) -> Self {
        Self { pool, config }
    }

    pub async fn rotate_service(&self, service: &str, notify: bool) -> Result<()> {
        tracing::info!("Rotating password for service: {}", service);

        // Get current user info
        let user_info: Option<(String, String, String)> = sqlx::query_as(
            "SELECT username, database_name, password_hash FROM _rumahl_db_users WHERE service = $1",
        )
        .bind(service)
        .fetch_optional(&self.pool)
        .await?;

        let (username, database, _old_password_hash) = match user_info {
            Some(info) => info,
            None => {
                tracing::warn!("Service {} not found in tracking database", service);
                return Ok(());
            }
        };

        // Generate new password
        let new_password = self.generate_strong_password();

        // Update PostgreSQL user
        sqlx::query(&format!("ALTER USER \"{}\" WITH PASSWORD $1", username))
            .bind(&new_password)
            .execute(&self.pool)
            .await?;

        // Update tracking database
        let password_hash = self.hash_password(&new_password);
        let next_rotation =
            chrono::Utc::now() + chrono::Duration::days(self.config.interval_days as i64);

        sqlx::query(
            r#"
            UPDATE _rumahl_db_users
            SET password_hash = $1,
                last_rotated = NOW(),
                next_rotation = $2,
                rotation_count = rotation_count + 1
            WHERE service = $3
            "#,
        )
        .bind(&password_hash)
        .bind(next_rotation)
        .bind(service)
        .execute(&self.pool)
        .await?;

        // Mark old password as expired in history
        sqlx::query(
            r#"
            UPDATE _rumahl_password_history
            SET valid_until = NOW(),
                replaced_at = NOW()
            WHERE service = $1 AND valid_until IS NULL
            "#,
        )
        .bind(service)
        .execute(&self.pool)
        .await?;

        // Add new password to history
        sqlx::query("INSERT INTO _rumahl_password_history (service, password_hash) VALUES ($1, $2)")
            .bind(service)
            .bind(&password_hash)
            .execute(&self.pool)
            .await?;

        // Write new credentials
        self.write_credentials(service, &username, &new_password, &database)
            .await?;

        // Notify service to reload (if requested)
        if notify {
            self.notify_service_reload(service).await?;
        }

        // Clean up old password history (keep grace period)
        self.cleanup_old_passwords(service).await?;

        tracing::info!("Password rotated successfully for {}", service);
        Ok(())
    }

    pub async fn rotate_all(&self, notify: bool) -> Result<usize> {
        let services: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT service
            FROM _rumahl_db_users
            WHERE next_rotation <= NOW() OR next_rotation IS NULL
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut count = 0;
        for (service,) in services {
            if let Err(e) = self.rotate_service(&service, notify).await {
                tracing::error!("Failed to rotate password for {}: {}", service, e);
            } else {
                count += 1;
            }
        }

        Ok(count)
    }

    async fn write_credentials(
        &self,
        service: &str,
        username: &str,
        password: &str,
        database: &str,
    ) -> Result<()> {
        let conn_str = format!(
            "postgres://{}:{}@localhost:5432/{}",
            username, password, database
        );

        let cred_dir = Path::new("/etc/ora/db-credentials");
        std::fs::create_dir_all(cred_dir)?;

        let cred_file = cred_dir.join(format!("{}.env", service));
        std::fs::write(&cred_file, format!("DATABASE_URL={}\n", conn_str))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&cred_file, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    }

    async fn notify_service_reload(&self, service: &str) -> Result<()> {
        // Try to reload via systemd
        let output = tokio::process::Command::new("systemctl")
            .arg("reload-or-restart")
            .arg(format!("{}.service", service))
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                tracing::info!("Notified {} to reload", service);
                Ok(())
            }
            Ok(out) => {
                tracing::warn!(
                    "Failed to notify {}: {}",
                    service,
                    String::from_utf8_lossy(&out.stderr)
                );
                Ok(()) // Non-fatal
            }
            Err(e) => {
                tracing::warn!("systemctl not available: {}", e);
                Ok(()) // Non-fatal
            }
        }
    }

    async fn cleanup_old_passwords(&self, service: &str) -> Result<()> {
        let grace_cutoff =
            chrono::Utc::now() - chrono::Duration::hours(self.config.grace_period_hours as i64);

        sqlx::query(
            r#"
            DELETE FROM _rumahl_password_history
            WHERE service = $1
              AND valid_until IS NOT NULL
              AND valid_until < $2
            "#,
        )
        .bind(service)
        .bind(grace_cutoff)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    fn generate_strong_password(&self) -> String {
        use rand::Rng;
        const CHARSET: &[u8] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+";
        let mut rng = rand::thread_rng();

        let mut password: Vec<u8> = (0..self.config.min_password_length)
            .map(|_| {
                let idx = rng.gen_range(0..CHARSET.len());
                CHARSET[idx]
            })
            .collect();

        // Ensure at least one uppercase, lowercase, digit, and special char
        password[0] = b'A' + rng.gen_range(0..26);
        password[1] = b'a' + rng.gen_range(0..26);
        password[2] = b'0' + rng.gen_range(0..10);
        password[3] = b"!@#$%^&*"[rng.gen_range(0..8)];

        // Shuffle
        use rand::seq::SliceRandom;
        password.shuffle(&mut rng);

        String::from_utf8(password).unwrap()
    }

    fn hash_password(&self, password: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        hex::encode(hasher.finalize())
    }
}
