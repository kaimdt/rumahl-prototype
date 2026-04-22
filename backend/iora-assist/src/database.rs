// Database Module for ORA AI
use sqlx::{postgres::PgPoolOptions, PgPool, Postgres};
use std::time::Duration;
use uuid::Uuid;

pub type DbPool = PgPool;

/// Initialize database connection pool
pub async fn init_database() -> Result<DbPool, sqlx::Error> {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://iora:iora_password@localhost:5432/iora_assist".to_string());

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
        .await?;

    // Run migrations
    run_migrations(&pool).await?;

    Ok(pool)
}

/// Run database migrations
async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(include_str!("../migrations/001_ora_ai_schema.sql"))
        .execute(pool)
        .await?;

    sqlx::query(include_str!("../migrations/002_memory_and_tasks.sql"))
        .execute(pool)
        .await?;

    sqlx::query(include_str!("../migrations/003_recurring_tasks.sql"))
        .execute(pool)
        .await?;

    tracing::info!("Database migrations completed successfully");
    Ok(())
}

/// Conversation thread repository
pub mod conversations {
    use super::*;
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct ConversationThread {
        pub id: Uuid,
        pub user_id: Option<Uuid>,
        pub started_at: DateTime<Utc>,
        pub last_activity: DateTime<Utc>,
        pub context: serde_json::Value,
        pub active: bool,
        pub created_at: DateTime<Utc>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct ConversationMessage {
        pub id: Uuid,
        pub thread_id: Uuid,
        pub role: String,
        pub content: String,
        pub provider: Option<String>,
        pub initiated_by: Option<String>,
        pub timestamp: DateTime<Utc>,
        pub metadata: serde_json::Value,
        pub created_at: DateTime<Utc>,
    }

    pub async fn create_thread(
        pool: &DbPool,
        user_id: Option<Uuid>,
    ) -> Result<ConversationThread, sqlx::Error> {
        let thread = sqlx::query_as::<_, ConversationThread>(
            "INSERT INTO conversation_threads (user_id) VALUES ($1) RETURNING *"
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?;

        Ok(thread)
    }

    pub async fn add_message(
        pool: &DbPool,
        thread_id: Uuid,
        role: &str,
        content: &str,
        provider: Option<&str>,
        initiated_by: Option<&str>,
    ) -> Result<ConversationMessage, sqlx::Error> {
        let message = sqlx::query_as::<_, ConversationMessage>(
            r#"
            INSERT INTO conversation_messages
            (thread_id, role, content, provider, initiated_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            "#
        )
        .bind(thread_id)
        .bind(role)
        .bind(content)
        .bind(provider)
        .bind(initiated_by)
        .fetch_one(pool)
        .await?;

        // Update thread last activity
        sqlx::query("UPDATE conversation_threads SET last_activity = NOW() WHERE id = $1")
            .bind(thread_id)
            .execute(pool)
            .await?;

        Ok(message)
    }

    pub async fn get_thread_messages(
        pool: &DbPool,
        thread_id: Uuid,
        limit: i64,
    ) -> Result<Vec<ConversationMessage>, sqlx::Error> {
        let messages = sqlx::query_as::<_, ConversationMessage>(
            r#"
            SELECT * FROM conversation_messages
            WHERE thread_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
            "#
        )
        .bind(thread_id)
        .bind(limit)
        .fetch_all(pool)
        .await?;

        Ok(messages)
    }
}

/// Autonomous tasks repository
pub mod tasks {
    use super::*;
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct AutonomousTask {
        pub id: Uuid,
        pub task_type: String,
        pub name: String,
        pub description: Option<String>,
        pub schedule: Option<String>,
        pub enabled: bool,
        pub assigned_provider: Option<String>,
        pub config: serde_json::Value,
        pub last_executed_at: Option<DateTime<Utc>>,
        pub next_execution_at: Option<DateTime<Utc>>,
        pub created_at: DateTime<Utc>,
        pub updated_at: DateTime<Utc>,
        // Extended fields (migration 002)
        pub user_id: Option<Uuid>,
        pub trigger_at: Option<DateTime<Utc>>,
        pub is_one_shot: bool,
        pub origin: String,
        pub priority: i32,
        // Extended fields (migration 003 – recurrence)
        pub recurrence_type: String,
        pub recurrence_days: serde_json::Value,
        pub time_of_day: Option<chrono::NaiveTime>,
        pub recurrence_end_at: Option<DateTime<Utc>>,
        pub occurrence_limit: Option<i32>,
        pub occurrence_count: i32,
        pub user_timezone: String,
        pub input_mode: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct TaskExecution {
        pub id: Uuid,
        pub task_id: Uuid,
        pub executed_at: DateTime<Utc>,
        pub provider_used: Option<String>,
        pub result: serde_json::Value,
        pub success: bool,
        pub error_message: Option<String>,
        pub execution_duration_ms: Option<i32>,
        pub created_at: DateTime<Utc>,
    }

    pub async fn get_enabled_tasks(pool: &DbPool) -> Result<Vec<AutonomousTask>, sqlx::Error> {
        let tasks = sqlx::query_as::<_, AutonomousTask>(
            "SELECT * FROM autonomous_tasks WHERE enabled = true ORDER BY priority DESC, created_at"
        )
        .fetch_all(pool)
        .await?;

        Ok(tasks)
    }

    pub async fn record_execution(
        pool: &DbPool,
        task_id: Uuid,
        provider_used: Option<&str>,
        result: serde_json::Value,
        success: bool,
        error_message: Option<&str>,
        duration_ms: Option<i32>,
    ) -> Result<TaskExecution, sqlx::Error> {
        let execution = sqlx::query_as::<_, TaskExecution>(
            r#"
            INSERT INTO task_executions
            (task_id, provider_used, result, success, error_message, execution_duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#
        )
        .bind(task_id)
        .bind(provider_used)
        .bind(result)
        .bind(success)
        .bind(error_message)
        .bind(duration_ms)
        .fetch_one(pool)
        .await?;

        // Update task last_executed_at and occurrence_count
        sqlx::query(
            "UPDATE autonomous_tasks SET last_executed_at = NOW(), occurrence_count = occurrence_count + 1 WHERE id = $1"
        )
        .bind(task_id)
        .execute(pool)
        .await?;

        Ok(execution)
    }

    /// Set the `enabled` flag on a task (pause or resume).
    pub async fn set_enabled(pool: &DbPool, task_id: Uuid, enabled: bool) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE autonomous_tasks SET enabled = $1, updated_at = NOW() WHERE id = $2"
        )
        .bind(enabled)
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Delete a task by id.
    pub async fn delete(pool: &DbPool, task_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM autonomous_tasks WHERE id = $1")
            .bind(task_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Update the `next_execution_at` of a recurring task after it fires.
    pub async fn update_next_execution(
        pool: &DbPool,
        task_id: Uuid,
        next_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE autonomous_tasks SET next_execution_at = $1, updated_at = NOW() WHERE id = $2"
        )
        .bind(next_at)
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Fetch a single task by id.
    pub async fn get_by_id(pool: &DbPool, task_id: Uuid) -> Result<Option<AutonomousTask>, sqlx::Error> {
        let task = sqlx::query_as::<_, AutonomousTask>(
            "SELECT * FROM autonomous_tasks WHERE id = $1"
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?;
        Ok(task)
    }

    /// List all user-visible active tasks (one-shot and recurring), including paused ones.
    pub async fn list_user_tasks(
        pool: &DbPool,
        user_id: Option<Uuid>,
        include_paused: bool,
        limit: i64,
    ) -> Result<Vec<AutonomousTask>, sqlx::Error> {
        let tasks = if include_paused {
            sqlx::query_as::<_, AutonomousTask>(
                r#"
                SELECT * FROM autonomous_tasks
                WHERE (origin IN ('user', 'ai'))
                  AND (user_id = $1 OR $1 IS NULL)
                ORDER BY COALESCE(trigger_at, next_execution_at) ASC NULLS LAST
                LIMIT $2
                "#
            )
            .bind(user_id)
            .bind(limit)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, AutonomousTask>(
                r#"
                SELECT * FROM autonomous_tasks
                WHERE (origin IN ('user', 'ai'))
                  AND enabled = true
                  AND (user_id = $1 OR $1 IS NULL)
                ORDER BY COALESCE(trigger_at, next_execution_at) ASC NULLS LAST
                LIMIT $2
                "#
            )
            .bind(user_id)
            .bind(limit)
            .fetch_all(pool)
            .await?
        };
        Ok(tasks)
    }

    /// Update task name, description, or schedule fields.
    pub async fn update_task(
        pool: &DbPool,
        task_id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
        next_execution_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE autonomous_tasks
            SET name = COALESCE($1, name),
                description = COALESCE($2, description),
                next_execution_at = COALESCE($3, next_execution_at),
                updated_at = NOW()
            WHERE id = $4
            "#
        )
        .bind(name)
        .bind(description)
        .bind(next_execution_at)
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

/// Provider configuration repository
pub mod providers {
    use super::*;
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct ProviderConfig {
        pub id: Uuid,
        pub provider_type: String,
        pub purpose: String,
        pub config: serde_json::Value,
        pub priority: i32,
        pub enabled: bool,
        pub created_at: DateTime<Utc>,
        pub updated_at: DateTime<Utc>,
    }

    pub async fn get_providers_for_purpose(
        pool: &DbPool,
        purpose: &str,
    ) -> Result<Vec<ProviderConfig>, sqlx::Error> {
        let providers = sqlx::query_as::<_, ProviderConfig>(
            r#"
            SELECT * FROM provider_configs
            WHERE purpose = $1 AND enabled = true
            ORDER BY priority DESC
            "#
        )
        .bind(purpose)
        .fetch_all(pool)
        .await?;

        Ok(providers)
    }

    pub async fn get_all_enabled_providers(pool: &DbPool) -> Result<Vec<ProviderConfig>, sqlx::Error> {
        let providers = sqlx::query_as::<_, ProviderConfig>(
            "SELECT * FROM provider_configs WHERE enabled = true ORDER BY priority DESC"
        )
        .fetch_all(pool)
        .await?;

        Ok(providers)
    }

    pub async fn create_provider(
        pool: &DbPool,
        provider_type: &str,
        purpose: &str,
        config: serde_json::Value,
        priority: i32,
    ) -> Result<ProviderConfig, sqlx::Error> {
        let provider = sqlx::query_as::<_, ProviderConfig>(
            r#"
            INSERT INTO provider_configs
            (provider_type, purpose, config, priority, enabled)
            VALUES ($1, $2, $3, $4, true)
            RETURNING *
            "#
        )
        .bind(provider_type)
        .bind(purpose)
        .bind(config)
        .bind(priority)
        .fetch_one(pool)
        .await?;

        Ok(provider)
    }
}

/// Notification queue repository
pub mod notifications {
    use super::*;
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct Notification {
        pub id: Uuid,
        pub user_id: Option<Uuid>,
        pub message: String,
        pub priority: i32,
        pub notification_type: String,
        pub delivered: bool,
        pub delivered_at: Option<DateTime<Utc>>,
        pub created_at: DateTime<Utc>,
        pub deliver_at: DateTime<Utc>,
        pub expires_at: Option<DateTime<Utc>>,
        pub metadata: serde_json::Value,
    }

    pub async fn queue_notification(
        pool: &DbPool,
        user_id: Option<Uuid>,
        message: &str,
        notification_type: &str,
        priority: i32,
        deliver_at: Option<DateTime<Utc>>,
    ) -> Result<Notification, sqlx::Error> {
        let notification = sqlx::query_as::<_, Notification>(
            r#"
            INSERT INTO notification_queue
            (user_id, message, notification_type, priority, deliver_at)
            VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
            RETURNING *
            "#
        )
        .bind(user_id)
        .bind(message)
        .bind(notification_type)
        .bind(priority)
        .bind(deliver_at)
        .fetch_one(pool)
        .await?;

        Ok(notification)
    }

    pub async fn get_pending_notifications(
        pool: &DbPool,
        limit: i64,
    ) -> Result<Vec<Notification>, sqlx::Error> {
        let notifications = sqlx::query_as::<_, Notification>(
            r#"
            SELECT * FROM notification_queue
            WHERE delivered = false AND deliver_at <= NOW()
            ORDER BY priority DESC, deliver_at ASC
            LIMIT $1
            "#
        )
        .bind(limit)
        .fetch_all(pool)
        .await?;

        Ok(notifications)
    }

    pub async fn mark_delivered(pool: &DbPool, notification_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE notification_queue SET delivered = true, delivered_at = NOW() WHERE id = $1"
        )
        .bind(notification_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}
