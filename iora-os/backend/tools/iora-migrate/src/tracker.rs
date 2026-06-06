use anyhow::Result;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct MigrationRecord {
    pub service: String,
    pub migration: String,
    pub checksum: String,
    pub applied_at: DateTime<Utc>,
    pub execution_time_ms: i32,
}

pub struct MigrationTracker {
    pool: PgPool,
}

#[allow(dead_code)]
impl MigrationTracker {
    pub async fn new(pool: PgPool) -> Result<Self> {
        let tracker = Self { pool };
        tracker.ensure_tracking_table().await?;
        Ok(tracker)
    }

    async fn ensure_tracking_table(&self) -> Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS _iora_migrations (
                id SERIAL PRIMARY KEY,
                service VARCHAR(100) NOT NULL,
                migration VARCHAR(200) NOT NULL,
                checksum VARCHAR(64) NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                execution_time_ms INTEGER NOT NULL,
                applied_by VARCHAR(100),
                rollback_sql TEXT,
                UNIQUE(service, migration)
            );

            CREATE INDEX IF NOT EXISTS idx_migrations_service
                ON _iora_migrations(service);
            CREATE INDEX IF NOT EXISTS idx_migrations_applied
                ON _iora_migrations(applied_at DESC);
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn is_applied(&self, service: &str, migration: &str) -> Result<bool> {
        let exists: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM _iora_migrations
                WHERE service = $1 AND migration = $2
            )
            "#,
        )
        .bind(service)
        .bind(migration)
        .fetch_one(&self.pool)
        .await?;

        Ok(exists)
    }

    pub async fn mark_applied(
        &self,
        service: &str,
        migration: &str,
        checksum: &str,
        execution_time_ms: i32,
        rollback_sql: Option<&str>,
    ) -> Result<()> {
        let applied_by = whoami::username();

        sqlx::query(
            r#"
            INSERT INTO _iora_migrations
                (service, migration, checksum, execution_time_ms, applied_by, rollback_sql)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (service, migration) DO UPDATE SET
                checksum = $3,
                applied_at = NOW(),
                execution_time_ms = $4,
                applied_by = $5,
                rollback_sql = $6
            "#,
        )
        .bind(service)
        .bind(migration)
        .bind(checksum)
        .bind(execution_time_ms)
        .bind(&applied_by)
        .bind(rollback_sql)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_applied_migrations(&self, service: &str) -> Result<Vec<MigrationRecord>> {
        let records = sqlx::query_as::<_, (String, String, String, DateTime<Utc>, i32)>(
            r#"
            SELECT service, migration, checksum, applied_at, execution_time_ms
            FROM _iora_migrations
            WHERE service = $1
            ORDER BY applied_at
            "#,
        )
        .bind(service)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|(service, migration, checksum, applied_at, execution_time_ms)| MigrationRecord {
            service,
            migration,
            checksum,
            applied_at,
            execution_time_ms,
        })
        .collect();

        Ok(records)
    }

    pub async fn get_all_applied(&self) -> Result<Vec<MigrationRecord>> {
        let records = sqlx::query_as::<_, (String, String, String, DateTime<Utc>, i32)>(
            r#"
            SELECT service, migration, checksum, applied_at, execution_time_ms
            FROM _iora_migrations
            ORDER BY service, applied_at
            "#,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|(service, migration, checksum, applied_at, execution_time_ms)| MigrationRecord {
            service,
            migration,
            checksum,
            applied_at,
            execution_time_ms,
        })
        .collect();

        Ok(records)
    }

    pub async fn remove_migration(&self, service: &str, migration: &str) -> Result<()> {
        sqlx::query(
            "DELETE FROM _iora_migrations WHERE service = $1 AND migration = $2",
        )
        .bind(service)
        .bind(migration)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_rollback_sql(&self, service: &str, migration: &str) -> Result<Option<String>> {
        let sql: Option<String> = sqlx::query_scalar(
            "SELECT rollback_sql FROM _iora_migrations WHERE service = $1 AND migration = $2",
        )
        .bind(service)
        .bind(migration)
        .fetch_optional(&self.pool)
        .await?
        .flatten();

        Ok(sql)
    }

    pub async fn validate_checksum(&self, service: &str, migration: &str, expected: &str) -> Result<bool> {
        let stored: Option<String> = sqlx::query_scalar(
            "SELECT checksum FROM _iora_migrations WHERE service = $1 AND migration = $2",
        )
        .bind(service)
        .bind(migration)
        .fetch_optional(&self.pool)
        .await?;

        Ok(stored.as_deref() == Some(expected))
    }

    pub async fn update_checksum(&self, service: &str, migration: &str, checksum: &str) -> Result<()> {
        sqlx::query(
            "UPDATE _iora_migrations SET checksum = $3 WHERE service = $1 AND migration = $2",
        )
        .bind(service)
        .bind(migration)
        .bind(checksum)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

pub fn calculate_checksum(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}
