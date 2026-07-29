// Database Module for ORA AI
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;
use uuid::Uuid;

pub type DbPool = PgPool;

use iora_shared_config::system_config;

/// Initialize database connection pool
pub async fn init_database() -> Result<DbPool, sqlx::Error> {
    let database_url = system_config::database_url_for("iora-assist");

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

    sqlx::query(include_str!("../migrations/004_temporary_pause.sql"))
        .execute(pool)
        .await?;

    sqlx::query(include_str!("../migrations/005_instant_tasks.sql"))
        .execute(pool)
        .await?;

    sqlx::query(include_str!("../migrations/006_instant_tasks_deferred.sql"))
        .execute(pool)
        .await?;

    // 007 (self_evolution) is loaded by self_evolution::init at runtime; safe to also try here
    // because all CREATE TABLE statements use IF NOT EXISTS. Skip silently if missing.
    let _ = sqlx::query(include_str!("../migrations/007_self_evolution.sql"))
        .execute(pool)
        .await;

    sqlx::query(include_str!(
        "../migrations/008_provider_models_and_secrets.sql"
    ))
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
            "INSERT INTO conversation_threads (user_id) VALUES ($1) RETURNING *",
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
            "#,
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
            "#,
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
        // Extended fields (migration 004 – temporary pause)
        pub paused_until: Option<DateTime<Utc>>,
        pub paused_temporarily: bool,
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
            "#,
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
    pub async fn set_enabled(
        pool: &DbPool,
        task_id: Uuid,
        enabled: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE autonomous_tasks SET enabled = $1, updated_at = NOW() WHERE id = $2")
            .bind(enabled)
            .bind(task_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Temporarily disable a task until `resume_at`.
    /// The task engine will automatically re-enable it when the time comes.
    pub async fn temporary_pause(
        pool: &DbPool,
        task_id: Uuid,
        resume_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE autonomous_tasks
               SET enabled = false,
                   paused_until = $1,
                   paused_temporarily = true,
                   updated_at = NOW()
               WHERE id = $2"#,
        )
        .bind(resume_at)
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Re-enable all tasks whose temporary pause has expired.
    /// Called by the task engine on every tick.
    /// Returns the number of tasks that were auto-resumed.
    pub async fn resume_expired_pauses(pool: &DbPool) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"UPDATE autonomous_tasks
               SET enabled = true,
                   paused_until = NULL,
                   paused_temporarily = false,
                   updated_at = NOW()
               WHERE paused_temporarily = true
                 AND paused_until IS NOT NULL
                 AND paused_until <= NOW()"#,
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
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
            "UPDATE autonomous_tasks SET next_execution_at = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(next_at)
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Fetch a single task by id.
    pub async fn get_by_id(
        pool: &DbPool,
        task_id: Uuid,
    ) -> Result<Option<AutonomousTask>, sqlx::Error> {
        let task =
            sqlx::query_as::<_, AutonomousTask>("SELECT * FROM autonomous_tasks WHERE id = $1")
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
                "#,
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
                "#,
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
            "#,
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
        // Added by migration 008 — present in DB once the migration runs.
        // Optional so legacy rows without values still deserialize cleanly.
        #[serde(default)]
        pub last_model_fetch_at: Option<DateTime<Utc>>,
        #[serde(default)]
        pub last_model_fetch_error: Option<String>,
        #[serde(default)]
        pub model_count: Option<i32>,
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
            "#,
        )
        .bind(purpose)
        .fetch_all(pool)
        .await?;

        Ok(providers)
    }

    pub async fn get_all_enabled_providers(
        pool: &DbPool,
    ) -> Result<Vec<ProviderConfig>, sqlx::Error> {
        let providers = sqlx::query_as::<_, ProviderConfig>(
            "SELECT * FROM provider_configs WHERE enabled = true ORDER BY priority DESC",
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
            "#,
        )
        .bind(provider_type)
        .bind(purpose)
        .bind(config)
        .bind(priority)
        .fetch_one(pool)
        .await?;

        Ok(provider)
    }

    pub async fn update_provider(
        pool: &DbPool,
        id: Uuid,
        provider_type: Option<&str>,
        purpose: Option<&str>,
        config: Option<serde_json::Value>,
        priority: Option<i32>,
        enabled: Option<bool>,
    ) -> Result<Option<ProviderConfig>, sqlx::Error> {
        let provider = sqlx::query_as::<_, ProviderConfig>(
            r#"
            UPDATE provider_configs
            SET provider_type = COALESCE($2, provider_type),
                purpose = COALESCE($3, purpose),
                config = COALESCE($4, config),
                priority = COALESCE($5, priority),
                enabled = COALESCE($6, enabled),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(provider_type)
        .bind(purpose)
        .bind(config)
        .bind(priority)
        .bind(enabled)
        .fetch_optional(pool)
        .await?;
        Ok(provider)
    }

    pub async fn delete_provider(pool: &DbPool, id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM provider_configs WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn get_provider(
        pool: &DbPool,
        id: Uuid,
    ) -> Result<Option<ProviderConfig>, sqlx::Error> {
        let provider =
            sqlx::query_as::<_, ProviderConfig>("SELECT * FROM provider_configs WHERE id = $1")
                .bind(id)
                .fetch_optional(pool)
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
            "#,
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
            "#,
        )
        .bind(limit)
        .fetch_all(pool)
        .await?;

        Ok(notifications)
    }

    pub async fn mark_delivered(pool: &DbPool, notification_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE notification_queue SET delivered = true, delivered_at = NOW() WHERE id = $1",
        )
        .bind(notification_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}

/// Instant Task repository
pub mod instant_tasks {
    use super::*;
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct InstantTask {
        pub id: Uuid,
        pub session_id: Option<String>,
        pub user_id: Option<Uuid>,
        pub task_type: String,
        pub query: String,
        pub params: serde_json::Value,
        pub status: String,
        pub result_text: Option<String>,
        pub result_data: Option<serde_json::Value>,
        pub error_message: Option<String>,
        pub created_at: DateTime<Utc>,
        pub started_at: Option<DateTime<Utc>>,
        pub completed_at: Option<DateTime<Utc>>,
        /// Set to true when the SSE listener disconnected before the result arrived;
        /// the engine will queue a notification on completion.
        pub notify_on_complete: bool,
        /// Timestamp when the task was marked as "deferred" (>1 min threshold).
        pub deferred_at: Option<DateTime<Utc>>,
    }

    /// Create a new instant task and return it.
    pub async fn create(
        pool: &DbPool,
        session_id: Option<&str>,
        user_id: Option<Uuid>,
        task_type: &str,
        query: &str,
        params: serde_json::Value,
    ) -> Result<InstantTask, sqlx::Error> {
        let task = sqlx::query_as::<_, InstantTask>(
            r#"
            INSERT INTO instant_tasks (session_id, user_id, task_type, query, params)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            "#,
        )
        .bind(session_id)
        .bind(user_id)
        .bind(task_type)
        .bind(query)
        .bind(params)
        .fetch_one(pool)
        .await?;

        Ok(task)
    }

    /// Fetch a single instant task by id.
    pub async fn get_by_id(
        pool: &DbPool,
        task_id: Uuid,
    ) -> Result<Option<InstantTask>, sqlx::Error> {
        sqlx::query_as::<_, InstantTask>("SELECT * FROM instant_tasks WHERE id = $1")
            .bind(task_id)
            .fetch_optional(pool)
            .await
    }

    /// Atomically claim one pending task – set status to "processing".
    /// Returns the task if one was claimed, None otherwise.
    pub async fn claim_pending(pool: &DbPool) -> Result<Option<InstantTask>, sqlx::Error> {
        sqlx::query_as::<_, InstantTask>(
            r#"
            UPDATE instant_tasks
            SET status = 'processing', started_at = NOW()
            WHERE id = (
                SELECT id FROM instant_tasks
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING *
            "#,
        )
        .fetch_optional(pool)
        .await
    }

    /// Mark a task as completed with its result.
    pub async fn complete(
        pool: &DbPool,
        task_id: Uuid,
        result_text: &str,
        result_data: serde_json::Value,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE instant_tasks
            SET status = 'completed',
                result_text = $1,
                result_data = $2,
                completed_at = NOW()
            WHERE id = $3
            "#,
        )
        .bind(result_text)
        .bind(result_data)
        .bind(task_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Mark a task as failed.
    pub async fn fail(pool: &DbPool, task_id: Uuid, error: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE instant_tasks
            SET status = 'failed',
                error_message = $1,
                completed_at = NOW()
            WHERE id = $2
            "#,
        )
        .bind(error)
        .bind(task_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// List recent instant tasks for a session.
    pub async fn list_for_session(
        pool: &DbPool,
        session_id: &str,
        limit: i64,
    ) -> Result<Vec<InstantTask>, sqlx::Error> {
        sqlx::query_as::<_, InstantTask>(
            r#"
            SELECT * FROM instant_tasks
            WHERE session_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// Mark a task as "deferred" – the engine exceeded the long-task threshold but
    /// is still running.  The frontend should close its SSE stream; the result will
    /// be delivered via the notification queue when it eventually finishes.
    pub async fn mark_deferred(pool: &DbPool, task_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE instant_tasks
            SET status = 'deferred',
                deferred_at = NOW(),
                notify_on_complete = TRUE
            WHERE id = $1
            "#,
        )
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Set notify_on_complete so the engine knows to deliver the result as a
    /// notification when the SSE listener has disconnected.
    pub async fn set_notify_on_complete(
        pool: &DbPool,
        task_id: Uuid,
        value: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE instant_tasks SET notify_on_complete = $1 WHERE id = $2")
            .bind(value)
            .bind(task_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

// ─── Provider models registry & secrets store ──────────────────────────────

pub mod models_registry {
    use super::*;
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
    pub struct ProviderModelRow {
        pub id: Uuid,
        pub provider_config_id: Uuid,
        pub model_id: String,
        pub model_name: String,
        pub capabilities: serde_json::Value,
        pub last_seen: DateTime<Utc>,
        pub is_live: bool,
        pub created_at: DateTime<Utc>,
    }

    /// Replace the cached models for a provider with a freshly fetched list.
    pub async fn replace_models(
        pool: &DbPool,
        provider_config_id: Uuid,
        models: &[(String, String)],
        is_live: bool,
    ) -> Result<u64, sqlx::Error> {
        let mut tx = pool.begin().await?;
        sqlx::query("DELETE FROM provider_models WHERE provider_config_id = $1")
            .bind(provider_config_id)
            .execute(&mut *tx)
            .await?;
        let mut inserted = 0u64;
        for (model_id, model_name) in models {
            sqlx::query(
                r#"
                INSERT INTO provider_models (provider_config_id, model_id, model_name, is_live)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (provider_config_id, model_id) DO UPDATE
                  SET model_name = EXCLUDED.model_name,
                      last_seen = NOW(),
                      is_live = EXCLUDED.is_live
                "#,
            )
            .bind(provider_config_id)
            .bind(model_id)
            .bind(model_name)
            .bind(is_live)
            .execute(&mut *tx)
            .await?;
            inserted += 1;
        }
        sqlx::query(
            r#"UPDATE provider_configs
               SET model_count = $1, last_model_fetch_at = NOW(), last_model_fetch_error = NULL
               WHERE id = $2"#,
        )
        .bind(inserted as i32)
        .bind(provider_config_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(inserted)
    }

    /// Mark a fetch as failed without wiping previously-known models.
    pub async fn record_fetch_error(
        pool: &DbPool,
        provider_config_id: Uuid,
        error: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE provider_configs
               SET last_model_fetch_at = NOW(), last_model_fetch_error = $1
               WHERE id = $2"#,
        )
        .bind(error)
        .bind(provider_config_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn list_for_provider(
        pool: &DbPool,
        provider_config_id: Uuid,
    ) -> Result<Vec<ProviderModelRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, ProviderModelRow>(
            "SELECT * FROM provider_models WHERE provider_config_id = $1 ORDER BY model_name",
        )
        .bind(provider_config_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn list_all(pool: &DbPool) -> Result<Vec<ProviderModelRow>, sqlx::Error> {
        let rows = sqlx::query_as::<_, ProviderModelRow>(
            "SELECT * FROM provider_models ORDER BY provider_config_id, model_name",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}

pub mod secrets {
    use super::*;

    pub async fn put(pool: &DbPool, key: &str, value: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO persisted_secrets (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value, updated_at = NOW()
            "#,
        )
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn get(pool: &DbPool, key: &str) -> Result<Option<String>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM persisted_secrets WHERE key = $1")
                .bind(key)
                .fetch_optional(pool)
                .await?;
        Ok(row.map(|(v,)| v))
    }

    pub async fn delete(pool: &DbPool, key: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM persisted_secrets WHERE key = $1")
            .bind(key)
            .execute(pool)
            .await?;
        Ok(())
    }
}
