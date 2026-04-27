// AI Memory Module for IORA Assist
//
// Two core responsibilities:
//  1. Persistent memory – store and retrieve key facts across conversation sessions.
//  2. Intelligent context injection – automatically surface the most relevant memories
//     and inject them into the AI system prompt before each chat turn.
//
// Additionally provides *task detection*: after every AI response the module scans
// both the user message and the AI reply for time-bound task intent (reminders,
// scheduled actions, etc.) and creates an autonomous task if one is detected.
//
// Supports both single-message detection and multi-message conversation context.

use crate::database::DbPool;
use crate::schedule_engine::{build_conversation_context, ParsedSchedule, RecurrenceType, ScheduleEngine};
use chrono::{DateTime, Duration, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum number of memories to inject per chat turn.
const MAX_INJECTED_MEMORIES: usize = 8;

/// Minimum relevance score (0.0–1.0) for a memory to be injected.
const MIN_RELEVANCE_SCORE: f64 = 0.1;

// ─── Data types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AiMemory {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub key: String,
    pub value: String,
    pub category: String,
    pub importance: i32,
    pub source: String,
    pub tags: Vec<String>,
    pub last_accessed: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMemoryRequest {
    pub user_id: Option<Uuid>,
    pub key: String,
    pub value: String,
    /// One of: "fact" | "preference" | "instruction" | "context"
    pub category: Option<String>,
    /// 1–10; higher = more important. Defaults to 5.
    pub importance: Option<i32>,
    /// One of: "ai" | "user" | "system". Defaults to "ai".
    pub source: Option<String>,
    pub tags: Option<Vec<String>>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTaskRequest {
    pub user_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    /// UTC timestamp of first/only trigger
    pub trigger_at: DateTime<Utc>,
    /// "reminder" | "notify" | "automation"
    pub task_type: String,
    pub config: serde_json::Value,
    // ── Recurrence fields (from schedule engine) ──────────────────────────────
    /// "once" | "daily" | "weekdays" | "weekly" | "custom"
    pub recurrence_type: Option<String>,
    /// ISO weekday numbers 1=Mon…7=Sun
    pub recurrence_days: Option<Vec<u8>>,
    /// Local time-of-day at which recurring tasks fire
    pub time_of_day: Option<NaiveTime>,
    /// Stop recurring after this timestamp
    pub recurrence_end_at: Option<DateTime<Utc>>,
    /// Maximum number of executions
    pub occurrence_limit: Option<i32>,
    /// IANA timezone
    pub user_timezone: Option<String>,
    /// "chat" | "voice" | "conversation"
    pub input_mode: Option<String>,
}

// ─── MemoryManager ────────────────────────────────────────────────────────────

pub struct MemoryManager {
    db: DbPool,
}

impl MemoryManager {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────

    /// Create or update a memory (upsert by user_id + key).
    pub async fn store(
        &self,
        req: &CreateMemoryRequest,
    ) -> Result<AiMemory, sqlx::Error> {
        let category = req.category.as_deref().unwrap_or("fact");
        let importance = req.importance.unwrap_or(5);
        let source = req.source.as_deref().unwrap_or("ai");
        let tags: Vec<String> = req.tags.clone().unwrap_or_default();

        let memory = sqlx::query_as::<_, AiMemory>(
            // COALESCE(user_id::TEXT, 'global') maps NULL user_id to the string 'global',
            // so both user-specific memories (e.g. user A's "user_name") and global memories
            // (shared across all users, stored with user_id = NULL) can have the same `key`
            // without conflicting with each other.
            r#"
            INSERT INTO ai_memories
                (user_id, key, value, category, importance, source, tags, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (COALESCE(user_id::TEXT, 'global'), key) DO UPDATE
                SET value        = EXCLUDED.value,
                    category     = EXCLUDED.category,
                    importance   = EXCLUDED.importance,
                    tags         = EXCLUDED.tags,
                    expires_at   = EXCLUDED.expires_at,
                    updated_at   = NOW()
            RETURNING *
            "#,
        )
        .bind(req.user_id)
        .bind(&req.key)
        .bind(&req.value)
        .bind(category)
        .bind(importance)
        .bind(source)
        .bind(&tags)
        .bind(req.expires_at)
        .fetch_one(&self.db)
        .await?;

        Ok(memory)
    }

    /// List all non-expired memories for a user (or global ones when user_id is None).
    pub async fn list(
        &self,
        user_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AiMemory>, sqlx::Error> {
        let memories = sqlx::query_as::<_, AiMemory>(
            r#"
            SELECT * FROM ai_memories
            WHERE (user_id = $1 OR user_id IS NULL)
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY importance DESC, last_accessed DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.db)
        .await?;

        Ok(memories)
    }

    /// Delete a memory by id.
    pub async fn delete(&self, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM ai_memories WHERE id = $1")
            .bind(id)
            .execute(&self.db)
            .await?;
        Ok(())
    }

    /// Full-text search: return memories whose key/value/tags contain any of the query terms.
    pub async fn search(
        &self,
        query: &str,
        user_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AiMemory>, sqlx::Error> {
        let pattern = format!("%{}%", query.to_lowercase());

        let memories = sqlx::query_as::<_, AiMemory>(
            r#"
            SELECT * FROM ai_memories
            WHERE (user_id = $1 OR user_id IS NULL)
              AND (expires_at IS NULL OR expires_at > NOW())
              AND (
                    LOWER(key)   LIKE $2
                 OR LOWER(value) LIKE $2
                 OR EXISTS (
                        SELECT 1 FROM UNNEST(tags) t
                        WHERE LOWER(t) LIKE $2
                    )
              )
            ORDER BY importance DESC, last_accessed DESC
            LIMIT $3
            "#,
        )
        .bind(user_id)
        .bind(&pattern)
        .bind(limit)
        .fetch_all(&self.db)
        .await?;

        Ok(memories)
    }

    // ── Intelligent Context Injection ─────────────────────────────────────────

    /// Given the user's latest message, retrieve the most relevant memories and
    /// prepend them to the AI system prompt.
    pub async fn inject_into_prompt(
        &self,
        base_prompt: &str,
        user_message: &str,
        user_id: Option<Uuid>,
    ) -> String {
        let relevant = self.find_relevant(user_message, user_id).await;

        if relevant.is_empty() {
            return base_prompt.to_string();
        }

        let mut memory_block = String::from(
            "\n\n### Gespeichertes Wissen (AI Memory)\n\
             Die folgenden Informationen wurden aus früheren Gesprächen gespeichert und \
             sind für diese Unterhaltung möglicherweise relevant:\n",
        );

        for mem in &relevant {
            memory_block.push_str(&format!("- [{}] {}: {}\n", mem.category, mem.key, mem.value));
        }

        memory_block.push_str(
            "\nNutze dieses Wissen, um präzisere und personalisierte Antworten zu geben. \
             Aktualisiere oder ergänze das Memory, wenn der Nutzer neue wichtige \
             Informationen teilt.\n",
        );

        format!("{}{}", base_prompt, memory_block)
    }

    /// Score and rank memories by relevance to the user's message.
    async fn find_relevant(
        &self,
        user_message: &str,
        user_id: Option<Uuid>,
    ) -> Vec<AiMemory> {
        // Fetch all candidate memories (limit to 200 for performance)
        let all = match self.list(user_id, 200).await {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("Failed to fetch memories for injection: {}", e);
                return Vec::new();
            }
        };

        // Normalize the query: replace punctuation with spaces so that e.g.
        // "home,automation" becomes ["home", "automation"] rather than one term.
        let normalized: String = user_message
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' { c } else { ' ' })
            .collect();
        let query_terms: Vec<&str> = normalized
            .split_whitespace()
            .filter(|t| t.len() >= 3)
            .collect();

        let mut scored: Vec<(f64, AiMemory)> = all
            .into_iter()
            .filter_map(|mem| {
                let score = relevance_score(&mem, &query_terms);
                if score >= MIN_RELEVANCE_SCORE {
                    Some((score, mem))
                } else {
                    None
                }
            })
            .collect();

        // Sort descending by score, then by importance
        scored.sort_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.1.importance.cmp(&a.1.importance))
        });

        scored
            .into_iter()
            .take(MAX_INJECTED_MEMORIES)
            .map(|(_, mem)| mem)
            .collect()
    }

    // ── Post-chat memory extraction ───────────────────────────────────────────

    /// Analyse the AI's response and the user's message for facts that should be
    /// persisted. This uses simple pattern matching; in production you would call
    /// a dedicated AI extraction endpoint.
    pub async fn auto_extract_from_conversation(
        &self,
        user_message: &str,
        ai_response: &str,
        user_id: Option<Uuid>,
    ) {
        let combined = format!("{} {}", user_message, ai_response).to_lowercase();

        // Detect name statements: "ich bin X" / "I am X" / "mein name ist X"
        if let Some(name) = extract_name(&combined) {
            let _ = self
                .store(&CreateMemoryRequest {
                    user_id,
                    key: "user_name".to_string(),
                    value: name,
                    category: Some("fact".to_string()),
                    importance: Some(8),
                    source: Some("ai".to_string()),
                    tags: Some(vec!["name".to_string(), "user".to_string()]),
                    expires_at: None,
                })
                .await;
        }

        // Detect preferences: "ich mag/liebe X" / "I like/love X"
        if let Some(pref) = extract_preference(user_message) {
            let _ = self
                .store(&CreateMemoryRequest {
                    user_id,
                    key: format!("preference_{}", sanitize_key(&pref)),
                    value: pref,
                    category: Some("preference".to_string()),
                    importance: Some(6),
                    source: Some("ai".to_string()),
                    tags: Some(vec!["preference".to_string()]),
                    expires_at: None,
                })
                .await;
        }
    }

    // ── Active Task Detection & Creation ─────────────────────────────────────

    /// Scan user message and AI response for task/reminder intent and create an
    /// autonomous task in the database when found.  This acts as the fallback
    /// detection layer: if the AI did not explicitly create a task, this function
    /// still catches it via NLP.
    pub async fn detect_and_create_tasks(
        &self,
        user_message: &str,
        ai_response: &str,
        user_id: Option<Uuid>,
    ) {
        // Combine user + AI text and run the schedule engine
        let combined = format!("{} {}", user_message, ai_response);
        if let Some(sched) = ScheduleEngine::parse(&combined, "UTC") {
            let req = schedule_to_task_request(&sched, user_id, "chat");
            match self.create_active_task(&req, user_id).await {
                Ok(id) => tracing::info!(
                    "Auto-detected active task '{}' (id={}) recurrence={}",
                    sched.name,
                    id,
                    sched.recurrence_type.as_str()
                ),
                Err(e) => tracing::warn!("Failed to persist auto-detected task: {}", e),
            }
        }
    }

    /// Detect a task from a slice of (role, content) conversation messages.
    /// Useful when a task is constructed across several turns (multi-message).
    pub async fn detect_from_conversation(
        &self,
        messages: &[(String, String)],
        user_id: Option<Uuid>,
        input_mode: &str,
    ) -> Option<Uuid> {
        // Build combined context from the last 8 messages
        let context = build_conversation_context(messages, 8);
        let sched = ScheduleEngine::parse(&context, "UTC")?;

        let req = schedule_to_task_request(&sched, user_id, input_mode);
        match self.create_active_task(&req, user_id).await {
            Ok(id) => {
                tracing::info!(
                    "Conversation-derived task '{}' (id={}) recurrence={}",
                    sched.name,
                    id,
                    sched.recurrence_type.as_str()
                );
                Some(id)
            }
            Err(e) => {
                tracing::warn!("Failed to persist conversation-derived task: {}", e);
                None
            }
        }
    }

    /// Persist a user-requested active task to the database.
    pub async fn create_active_task(
        &self,
        req: &ActiveTaskRequest,
        user_id: Option<Uuid>,
    ) -> Result<Uuid, sqlx::Error> {
        let uid = user_id.or(req.user_id);
        let is_one_shot = req.recurrence_type.as_deref().unwrap_or("once") == "once";
        let recurrence_type = req.recurrence_type.as_deref().unwrap_or("once");
        let recurrence_days = serde_json::to_value(
            req.recurrence_days.clone().unwrap_or_default(),
        ).unwrap_or(serde_json::json!([]));
        let user_timezone = req.user_timezone.as_deref().unwrap_or("UTC");
        let input_mode = req.input_mode.as_deref().unwrap_or("chat");

        let id: Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO autonomous_tasks (
                task_type, name, description, enabled, config,
                user_id, trigger_at, is_one_shot, origin, next_execution_at, priority,
                recurrence_type, recurrence_days, time_of_day,
                recurrence_end_at, occurrence_limit, user_timezone, input_mode
            )
            VALUES ($1, $2, $3, true, $4,
                    $5, $6, $7, 'ai', $6, 1,
                    $8, $9, $10,
                    $11, $12, $13, $14)
            RETURNING id
            "#,
        )
        .bind(&req.task_type)
        .bind(&req.name)
        .bind(&req.description)
        .bind(&req.config)
        .bind(uid)
        .bind(req.trigger_at)
        .bind(is_one_shot)
        .bind(recurrence_type)
        .bind(recurrence_days)
        .bind(req.time_of_day)
        .bind(req.recurrence_end_at)
        .bind(req.occurrence_limit)
        .bind(user_timezone)
        .bind(input_mode)
        .fetch_one(&self.db)
        .await?;

        Ok(id)
    }

    /// List active tasks for a user (includes paused ones so the dashboard can show them).
    pub async fn list_active_tasks(
        &self,
        user_id: Option<Uuid>,
        include_paused: bool,
        limit: i64,
    ) -> Result<Vec<serde_json::Value>, sqlx::Error> {
        let tasks =
            crate::database::tasks::list_user_tasks(&self.db, user_id, include_paused, limit)
                .await?;

        let out = tasks
            .into_iter()
            .map(|t| {
                serde_json::json!({
                    "id": t.id,
                    "name": t.name,
                    "description": t.description,
                    "enabled": t.enabled,
                    "task_type": t.task_type,
                    "trigger_at": t.trigger_at,
                    "next_execution_at": t.next_execution_at,
                    "recurrence_type": t.recurrence_type,
                    "recurrence_days": t.recurrence_days,
                    "recurrence_end_at": t.recurrence_end_at,
                    "time_of_day": t.time_of_day.map(|tod| tod.to_string()),
                    "occurrence_count": t.occurrence_count,
                    "occurrence_limit": t.occurrence_limit,
                    "user_timezone": t.user_timezone,
                    "input_mode": t.input_mode,
                    "origin": t.origin,
                    "priority": t.priority,
                    "created_at": t.created_at,
                })
            })
            .collect();

        Ok(out)
    }

    /// Pause or resume a task.
    pub async fn set_task_enabled(
        &self,
        task_id: Uuid,
        enabled: bool,
    ) -> Result<(), sqlx::Error> {
        crate::database::tasks::set_enabled(&self.db, task_id, enabled).await
    }

    /// Temporarily pause a task until `resume_at`.
    pub async fn temporary_pause_task(
        &self,
        task_id: Uuid,
        resume_at: DateTime<Utc>,
    ) -> Result<(), sqlx::Error> {
        crate::database::tasks::temporary_pause(&self.db, task_id, resume_at).await
    }

    /// Delete a task permanently.
    pub async fn delete_task(&self, task_id: Uuid) -> Result<(), sqlx::Error> {
        crate::database::tasks::delete(&self.db, task_id).await
    }

    /// Update a task's name, description, or next execution time.
    pub async fn update_task(
        &self,
        task_id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
        next_execution_at: Option<DateTime<Utc>>,
    ) -> Result<(), sqlx::Error> {
        crate::database::tasks::update_task(&self.db, task_id, name, description, next_execution_at).await
    }

    /// Build a system-prompt segment that includes:
    ///  1. The user's active task list (for AI awareness)
    ///  2. Instructions on how the AI should express task modifications
    pub async fn build_tasks_system_prompt(&self, user_id: Option<Uuid>) -> String {
        use crate::task_resolver::TaskResolver;
        let tasks = match crate::database::tasks::list_user_tasks(&self.db, user_id, true, 50).await {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("Failed to load tasks for system prompt: {}", e);
                return String::new();
            }
        };
        TaskResolver::build_system_prompt_section(&tasks)
    }
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/// Convert a `ParsedSchedule` from the schedule engine into an `ActiveTaskRequest`.
pub fn schedule_to_task_request(
    sched: &ParsedSchedule,
    user_id: Option<Uuid>,
    input_mode: &str,
) -> ActiveTaskRequest {
    ActiveTaskRequest {
        user_id,
        name: sched.name.clone(),
        description: Some(sched.description.clone()),
        trigger_at: sched.first_trigger_at,
        task_type: sched.task_type.clone(),
        config: serde_json::json!({
            "reminder_text": sched.description,
            "auto_detected": true,
            "recurrence_type": sched.recurrence_type.as_str(),
        }),
        recurrence_type: Some(sched.recurrence_type.as_str().to_string()),
        recurrence_days: if sched.days_of_week.is_empty() {
            None
        } else {
            Some(sched.days_of_week.clone())
        },
        time_of_day: sched.time_of_day,
        recurrence_end_at: sched.recurrence_end_at,
        occurrence_limit: sched.occurrence_limit,
        user_timezone: Some(sched.user_timezone.clone()),
        input_mode: Some(input_mode.to_string()),
    }
}
fn relevance_score(mem: &AiMemory, query_terms: &[&str]) -> f64 {
    if query_terms.is_empty() {
        return 0.0;
    }

    let searchable = format!(
        "{} {} {}",
        mem.key.to_lowercase(),
        mem.value.to_lowercase(),
        mem.tags.join(" ").to_lowercase()
    );

    let matches = query_terms
        .iter()
        .filter(|&&term| term.len() >= 3 && searchable.contains(&term.to_lowercase()))
        .count();

    let base = matches as f64 / query_terms.len() as f64;

    // Boost by importance (max 0.3 extra)
    let importance_boost = (mem.importance as f64 - 1.0) / 9.0 * 0.3;

    // Recency boost: memories accessed in the last 24 h get a small bonus
    let hours_since_access = (Utc::now() - mem.last_accessed).num_hours();
    let recency_boost = if hours_since_access < 24 { 0.1 } else { 0.0 };

    (base + importance_boost + recency_boost).min(1.0)
}

/// Attempt to extract the user's name from a combined message string.
fn extract_name(text: &str) -> Option<String> {
    for pattern in &[
        "mein name ist ",
        "ich heiße ",
        "ich bin ",
        "my name is ",
        "i am ",
        "call me ",
    ] {
        if let Some(pos) = text.find(pattern) {
            let after = &text[pos + pattern.len()..];
            let name: String = after
                .split(|c: char| c == ',' || c == '.' || c == '\n' || c == '!')
                .next()
                .unwrap_or("")
                .split_whitespace()
                .take(2) // first name (+ optional last name)
                .collect::<Vec<_>>()
                .join(" ");
            if !name.is_empty() && name.len() < 40 {
                return Some(titlecase(&name));
            }
        }
    }
    None
}

/// Extract a simple preference from the user message.
fn extract_preference(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    for pattern in &[
        "ich mag ",
        "ich liebe ",
        "ich bevorzuge ",
        "i like ",
        "i love ",
        "i prefer ",
    ] {
        if let Some(pos) = lower.find(pattern) {
            let after = &text[pos + pattern.len()..];
            let pref: String = after
                .split(|c: char| c == ',' || c == '.' || c == '\n')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !pref.is_empty() && pref.len() < 120 {
                return Some(pref);
            }
        }
    }
    None
}

/// Sanitize a string so it can be used as a memory key.
fn sanitize_key(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .take(40)
        .collect::<String>()
        .to_lowercase()
}

/// Simple title-case helper.
fn titlecase(s: &str) -> String {
    s.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
