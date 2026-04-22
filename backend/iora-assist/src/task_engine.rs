// Autonomous Task Engine
// Executes scheduled tasks in the background without user intervention

use crate::database::{DbPool, tasks as db_tasks};
use crate::orchestrator::ProviderOrchestrator;
use crate::providers::ChatMessage;
use crate::schedule_engine::{ParsedSchedule, RecurrenceType, ScheduleEngine};
use chrono::{DateTime, NaiveTime, Utc};
use serde_json::Value;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use uuid::Uuid;

pub struct TaskEngine {
    db: DbPool,
    orchestrator: Arc<ProviderOrchestrator>,
    running: Arc<tokio::sync::RwLock<bool>>,
}

impl TaskEngine {
    pub fn new(db: DbPool, orchestrator: Arc<ProviderOrchestrator>) -> Self {
        Self {
            db,
            orchestrator,
            running: Arc::new(tokio::sync::RwLock::new(false)),
        }
    }

    /// Start the task engine in the background
    pub async fn start(&self) {
        let mut is_running = self.running.write().await;
        if *is_running {
            tracing::warn!("Task engine is already running");
            return;
        }
        *is_running = true;
        drop(is_running);

        let db = self.db.clone();
        let orchestrator = self.orchestrator.clone();
        let running = self.running.clone();

        tokio::spawn(async move {
            tracing::info!("Task engine started");
            let mut tick_interval = interval(Duration::from_secs(60)); // Check every minute

            loop {
                tick_interval.tick().await;

                if !*running.read().await {
                    tracing::info!("Task engine stopped");
                    break;
                }

                if let Err(e) = Self::execute_pending_tasks(&db, &orchestrator).await {
                    tracing::error!("Error executing pending tasks: {}", e);
                }

                // Auto-resume tasks whose temporary pause has expired
                match crate::database::tasks::resume_expired_pauses(&db).await {
                    Ok(n) if n > 0 => tracing::info!("Auto-resumed {} temporarily paused task(s)", n),
                    Ok(_) => {}
                    Err(e) => tracing::warn!("Failed to resume expired pauses: {}", e),
                }
            }
        });
    }

    /// Stop the task engine
    pub async fn stop(&self) {
        let mut is_running = self.running.write().await;
        *is_running = false;
        tracing::info!("Task engine stop requested");
    }

    /// Execute all pending tasks
    async fn execute_pending_tasks(
        db: &DbPool,
        orchestrator: &Arc<ProviderOrchestrator>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let tasks = db_tasks::get_enabled_tasks(db).await?;
        let now = Utc::now();

        for task in tasks {
            // Determine when the task should next run:
            //   - One-shot user/AI tasks carry a specific `trigger_at` timestamp.
            //   - Recurring system tasks use `next_execution_at` (derived from their cron schedule).
            // `trigger_at` takes precedence so that user-requested reminders fire at the
            // exact time requested rather than the cron-calculated slot.
            let exec_time = task
                .trigger_at
                .as_ref()
                .or(task.next_execution_at.as_ref());

            if let Some(next_exec) = exec_time {
                if *next_exec > now {
                    continue; // Not yet time
                }
            }

            tracing::info!("Executing autonomous task: {} ({})", task.name, task.task_type);

            let start_time = std::time::Instant::now();
            let result = Self::execute_task(db, orchestrator, &task).await;
            let duration_ms = start_time.elapsed().as_millis() as i32;

            // Record execution
            let success = result.is_ok();
            let error_message = result.as_ref().err().map(|e| e.to_string());
            let result_data = result.unwrap_or_else(|_| Value::Null);

            if let Err(e) = db_tasks::record_execution(
                db,
                task.id,
                task.assigned_provider.as_deref(),
                result_data,
                success,
                error_message.as_deref(),
                Some(duration_ms),
            )
            .await
            {
                tracing::error!("Failed to record task execution: {}", e);
            }

            // Disable one-shot tasks after execution.
            // For recurring tasks, calculate the next execution time and update the DB.
            if task.is_one_shot || task.recurrence_type == "once" {
                if let Err(e) = db_tasks::set_enabled(&db, task.id, false).await {
                    tracing::error!("Failed to disable one-shot task {}: {}", task.id, e);
                }
            } else {
                // Check occurrence limit
                let next_count = task.occurrence_count + 1;
                let limit_reached = task
                    .occurrence_limit
                    .map(|lim| next_count >= lim)
                    .unwrap_or(false);
                let end_reached = task
                    .recurrence_end_at
                    .map(|end| now >= end)
                    .unwrap_or(false);

                if limit_reached || end_reached {
                    tracing::info!(
                        "Recurring task '{}' completed (limit={:?}, end_reached={})",
                        task.name,
                        task.occurrence_limit,
                        end_reached
                    );
                    if let Err(e) = db_tasks::set_enabled(&db, task.id, false).await {
                        tracing::error!("Failed to disable completed recurring task {}: {}", task.id, e);
                    }
                } else {
                    // Advance to next trigger using the schedule engine
                    let next_at = compute_next_trigger_for_task(&task, now);
                    if let Err(e) = db_tasks::update_next_execution(&db, task.id, next_at).await {
                        tracing::error!("Failed to advance recurring task {}: {}", task.id, e);
                    } else {
                        tracing::debug!(
                            "Recurring task '{}' next execution at {:?}",
                            task.name,
                            next_at
                        );
                    }
                }
            }
        }

        Ok(())
    }

    /// Execute a specific task
    async fn execute_task(
        db: &DbPool,
        orchestrator: &Arc<ProviderOrchestrator>,
        task: &db_tasks::AutonomousTask,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        match task.task_type.as_str() {
            "monitor" => Self::execute_monitor_task(db, orchestrator, task).await,
            "calendar" => Self::execute_calendar_task(db, orchestrator, task).await,
            "suggest" => Self::execute_suggest_task(db, orchestrator, task).await,
            "reminder" => Self::execute_reminder_task(db, orchestrator, task).await,
            "notify" => Self::execute_notify_task(db, orchestrator, task).await,
            _ => {
                tracing::warn!("Unknown task type: {}", task.task_type);
                Ok(Value::Null)
            }
        }
    }

    /// Execute a monitoring task
    async fn execute_monitor_task(
        db: &DbPool,
        orchestrator: &Arc<ProviderOrchestrator>,
        task: &db_tasks::AutonomousTask,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let entities = task.config.get("check_entities")
            .and_then(|e| e.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let prompt = format!(
            "Monitor the following smart home entities and report any anomalies or concerns: {:?}. \
            Check for unusual states, unexpected changes, or potential issues.",
            entities
        );

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }];

        let response = orchestrator
            .execute_chat(messages, Some("You are a home monitoring assistant.".to_string()), None)
            .await?;

        // Queue notification if anomalies found
        if response.message.to_lowercase().contains("anomaly")
            || response.message.to_lowercase().contains("concern")
            || response.message.to_lowercase().contains("issue")
        {
            if let Err(e) = crate::database::notifications::queue_notification(
                db,
                None, // broadcast to all users
                &response.message,
                "alert",
                1, // medium priority
                None,
            )
            .await
            {
                tracing::error!("Failed to queue notification: {}", e);
            }
        }

        Ok(serde_json::json!({
            "message": response.message,
            "provider": response.provider,
        }))
    }

    /// Execute a calendar check task
    async fn execute_calendar_task(
        db: &DbPool,
        orchestrator: &Arc<ProviderOrchestrator>,
        task: &db_tasks::AutonomousTask,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let lookahead_hours = task.config.get("lookahead_hours")
            .and_then(|h| h.as_i64())
            .unwrap_or(24);

        let prompt = format!(
            "Check the user's calendar for upcoming events in the next {} hours. \
            Notify if there are any important events, meetings, or reminders.",
            lookahead_hours
        );

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }];

        let response = orchestrator
            .execute_chat(messages, Some("You are a calendar assistant.".to_string()), None)
            .await?;

        // Queue notification for upcoming events
        if response.message.to_lowercase().contains("event")
            || response.message.to_lowercase().contains("meeting")
        {
            if let Err(e) = crate::database::notifications::queue_notification(
                db,
                None,
                &response.message,
                "reminder",
                0, // normal priority
                None,
            )
            .await
            {
                tracing::error!("Failed to queue notification: {}", e);
            }
        }

        Ok(serde_json::json!({
            "message": response.message,
            "provider": response.provider,
        }))
    }

    /// Execute an automation suggestion task
    async fn execute_suggest_task(
        db: &DbPool,
        orchestrator: &Arc<ProviderOrchestrator>,
        task: &db_tasks::AutonomousTask,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let min_confidence = task.config.get("min_confidence")
            .and_then(|c| c.as_f64())
            .unwrap_or(0.7);

        let prompt = format!(
            "Analyze the smart home usage patterns and suggest new automations. \
            Only suggest automations with confidence level above {}. \
            Consider time of day, entity usage patterns, and user behavior.",
            min_confidence
        );

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }];

        let response = orchestrator
            .execute_chat(messages, Some("You are an automation expert assistant.".to_string()), None)
            .await?;

        Ok(serde_json::json!({
            "message": response.message,
            "provider": response.provider,
            "min_confidence": min_confidence,
        }))
    }

    /// Execute a reminder task
    async fn execute_reminder_task(
        _db: &DbPool,
        orchestrator: &Arc<ProviderOrchestrator>,
        task: &db_tasks::AutonomousTask,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let reminder_text = task.config.get("reminder_text")
            .and_then(|t| t.as_str())
            .unwrap_or("Check task configuration");

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: format!("Generate a friendly reminder: {}", reminder_text),
        }];

        let response = orchestrator
            .execute_chat(messages, Some("You are a helpful reminder assistant.".to_string()), None)
            .await?;

        Ok(serde_json::json!({
            "message": response.message,
            "provider": response.provider,
        }))
    }

    /// Execute a notification task
    async fn execute_notify_task(
        db: &DbPool,
        _orchestrator: &Arc<ProviderOrchestrator>,
        task: &db_tasks::AutonomousTask,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let message = task.config.get("message")
            .and_then(|m| m.as_str())
            .ok_or("Missing message in notification task config")?;

        let priority = task.config.get("priority")
            .and_then(|p| p.as_i64())
            .unwrap_or(0) as i32;

        if let Err(e) = crate::database::notifications::queue_notification(
            db,
            None,
            message,
            "info",
            priority,
            None,
        )
        .await
        {
            tracing::error!("Failed to queue notification: {}", e);
        }

        Ok(serde_json::json!({
            "message": message,
            "queued": true,
        }))
    }
}

/// Schedule calculator for cron-like expressions
pub struct ScheduleCalculator;

impl ScheduleCalculator {
    /// Calculate next execution time from a cron expression
    /// Simplified implementation - in production, use a cron library
    pub fn next_execution(cron_expr: &str, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
        // Parse simple cron expressions like "*/15 * * * *" (every 15 minutes)
        // For now, we'll implement basic patterns

        let parts: Vec<&str> = cron_expr.split_whitespace().collect();
        if parts.len() != 5 {
            return None;
        }

        // Simplified: handle only minute intervals for now
        if parts[0].starts_with("*/") {
            if let Ok(minutes) = parts[0].trim_start_matches("*/").parse::<i64>() {
                return Some(from + chrono::Duration::minutes(minutes));
            }
        }

        // Handle hourly patterns like "0 * * * *"
        if parts[0] == "0" && parts[1] == "*" {
            return Some(from + chrono::Duration::hours(1));
        }

        // Handle daily patterns like "0 0 * * *"
        if parts[0] == "0" && parts[1] == "0" {
            return Some(from + chrono::Duration::days(1));
        }

        None
    }
}

// ─── Recurrence helper ────────────────────────────────────────────────────────

/// Compute the next trigger timestamp for a recurring task by delegating to the
/// schedule engine.  Falls back to a simple "+24 hours" if the task has no
/// recognisable schedule data.
fn compute_next_trigger_for_task(
    task: &db_tasks::AutonomousTask,
    after: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    // Build a minimal ParsedSchedule from the task DB row
    let recurrence_type = match task.recurrence_type.as_str() {
        "daily"    => RecurrenceType::Daily,
        "weekdays" => RecurrenceType::Weekdays,
        "weekly"   => RecurrenceType::Weekly,
        "custom"   => RecurrenceType::Custom,
        _          => return None, // "once" and unknown → no next occurrence
    };

    // Parse days_of_week from JSONB (stored as JSON array of u8)
    let days_of_week: Vec<u8> = task
        .recurrence_days
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    // ISO weekday values are 1–7; reject anything outside that range
                    let n = v.as_u64()?;
                    if (1..=7).contains(&n) { u8::try_from(n).ok() } else { None }
                })
                .collect()
        })
        .unwrap_or_default();

    let time_of_day: Option<NaiveTime> = task.time_of_day;

    let sched = ParsedSchedule {
        name: task.name.clone(),
        description: task.description.clone().unwrap_or_default(),
        task_type: task.task_type.clone(),
        recurrence_type,
        days_of_week,
        time_of_day,
        first_trigger_at: after,
        next_trigger_at: after,
        recurrence_end_at: task.recurrence_end_at,
        occurrence_limit: task.occurrence_limit,
        user_timezone: task.user_timezone.clone(),
        input_mode: task.input_mode.clone(),
        is_recurring: true,
    };

    ScheduleEngine::compute_next_trigger(&sched, after)
}
