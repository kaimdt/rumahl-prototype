use anyhow::{Context, Result};
use sqlx::PgPool;

pub struct UserManager {
    pool: PgPool,
}

impl UserManager {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create_or_update_user(
        &self,
        username: &str,
        password: &str,
        database: &str,
        conn_limit: i32,
        allow_ddl: bool,
        allow_temp: bool,
    ) -> Result<()> {
        // Check if user exists
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1)",
        )
        .bind(username)
        .fetch_one(&self.pool)
        .await?;

        if exists {
            // Update password
            sqlx::query(&format!("ALTER USER \"{}\" WITH PASSWORD $1", username))
                .bind(password)
                .execute(&self.pool)
                .await
                .context("Failed to update user password")?;

            // Update connection limit
            sqlx::query(&format!("ALTER USER \"{}\" WITH CONNECTION LIMIT {}", username, conn_limit))
                .execute(&self.pool)
                .await?;

            tracing::debug!("Updated user: {}", username);
        } else {
            // Create user with restrictions
            let create_sql = format!(
                "CREATE USER \"{}\" WITH PASSWORD $1 CONNECTION LIMIT {}",
                username, conn_limit
            );

            sqlx::query(&create_sql)
                .bind(password)
                .execute(&self.pool)
                .await
                .context("Failed to create user")?;

            tracing::info!("Created user: {}", username);
        }

        // Grant necessary privileges
        self.grant_privileges(username, database, allow_ddl, allow_temp).await?;

        // Apply security restrictions
        self.apply_security_restrictions(username).await?;

        Ok(())
    }

    async fn grant_privileges(
        &self,
        username: &str,
        database: &str,
        allow_ddl: bool,
        allow_temp: bool,
    ) -> Result<()> {
        // Connect and grant database access
        sqlx::query(&format!("GRANT CONNECT ON DATABASE \"{}\" TO \"{}\"", database, username))
            .execute(&self.pool)
            .await?;

        // For schema privileges, we need to connect to the target database
        // This is a simplified version - in production you'd connect to each DB
        let privileges = if allow_ddl {
            // Full access for services that run migrations
            vec![
                format!("GRANT ALL ON DATABASE \"{}\" TO \"{}\"", database, username),
            ]
        } else {
            // Read/write only for regular services
            vec![
                format!("GRANT CONNECT ON DATABASE \"{}\" TO \"{}\"", database, username),
            ]
        };

        for priv_sql in privileges {
            sqlx::query(&priv_sql)
                .execute(&self.pool)
                .await
                .context(format!("Failed to grant privilege: {}", priv_sql))?;
        }

        if allow_temp {
            sqlx::query(&format!("GRANT TEMP ON DATABASE \"{}\" TO \"{}\"", database, username))
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    async fn apply_security_restrictions(&self, username: &str) -> Result<()> {
        // Disable superuser
        sqlx::query(&format!("ALTER USER \"{}\" WITH NOSUPERUSER", username))
            .execute(&self.pool)
            .await?;

        // Disable REPLICATION
        sqlx::query(&format!("ALTER USER \"{}\" WITH NOREPLICATION", username))
            .execute(&self.pool)
            .await?;

        // Disable BYPASSRLS
        sqlx::query(&format!("ALTER USER \"{}\" WITH NOBYPASSRLS", username))
            .execute(&self.pool)
            .await?;

        // Disable CREATEDB unless specifically needed
        sqlx::query(&format!("ALTER USER \"{}\" WITH NOCREATEDB", username))
            .execute(&self.pool)
            .await?;

        // Disable CREATEROLE
        sqlx::query(&format!("ALTER USER \"{}\" WITH NOCREATEROLE", username))
            .execute(&self.pool)
            .await?;

        tracing::debug!("Applied security restrictions to {}", username);
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn revoke_all_privileges(&self, username: &str, database: &str) -> Result<()> {
        sqlx::query(&format!("REVOKE ALL ON DATABASE \"{}\" FROM \"{}\"", database, username))
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn list_user_connections(&self, username: &str) -> Result<Vec<String>> {
        let conns: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT datname
            FROM pg_stat_activity
            WHERE usename = $1
            "#,
        )
        .bind(username)
        .fetch_all(&self.pool)
        .await?;

        Ok(conns.into_iter().map(|(db,)| db).collect())
    }

    #[allow(dead_code)]
    pub async fn terminate_user_connections(&self, username: &str) -> Result<usize> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE usename = $1 AND pid <> pg_backend_pid()
            "#,
        )
        .bind(username)
        .fetch_one(&self.pool)
        .await?;

        Ok(count as usize)
    }
}
