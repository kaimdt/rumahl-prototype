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

use crate::database::DbPool;
use chrono::{DateTime, Datelike, Duration, NaiveTime, Timelike, Utc};
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
    pub trigger_at: DateTime<Utc>,
    /// E.g. "reminder" | "notify" | "automation"
    pub task_type: String,
    pub config: serde_json::Value,
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
    /// detection layer described in the problem statement.
    pub async fn detect_and_create_tasks(
        &self,
        user_message: &str,
        ai_response: &str,
        user_id: Option<Uuid>,
    ) {
        let combined = format!("{} {}", user_message, ai_response).to_lowercase();

        if let Some(task) = detect_task_intent(user_message, &combined) {
            let req = ActiveTaskRequest {
                user_id,
                name: task.name.clone(),
                description: Some(task.description.clone()),
                trigger_at: task.trigger_at,
                task_type: task.task_type.clone(),
                config: task.config.clone(),
            };
            match self.create_active_task(&req, user_id).await {
                Ok(id) => {
                    tracing::info!(
                        "Auto-detected and created active task '{}' (id={})",
                        task.name,
                        id
                    );
                }
                Err(e) => {
                    tracing::warn!("Failed to create auto-detected task '{}': {}", task.name, e);
                }
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

        let id: Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO autonomous_tasks
                (task_type, name, description, enabled, config,
                 user_id, trigger_at, is_one_shot, origin, next_execution_at, priority)
            VALUES ($1, $2, $3, true, $4,
                    $5, $6, true, 'ai', $6, 1)
            RETURNING id
            "#,
        )
        .bind(&req.task_type)
        .bind(&req.name)
        .bind(&req.description)
        .bind(&req.config)
        .bind(uid)
        .bind(req.trigger_at)
        .fetch_one(&self.db)
        .await?;

        Ok(id)
    }

    /// List active (pending) one-shot tasks for a user.
    pub async fn list_active_tasks(
        &self,
        user_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<serde_json::Value>, sqlx::Error> {
        let rows = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<DateTime<Utc>>, DateTime<Utc>)>(
            r#"
            SELECT id, name, description, trigger_at, created_at
            FROM autonomous_tasks
            WHERE is_one_shot = true
              AND enabled = true
              AND (user_id = $1 OR $1 IS NULL)
              AND (trigger_at IS NULL OR trigger_at > NOW())
            ORDER BY trigger_at ASC NULLS LAST
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.db)
        .await?;

        let tasks = rows
            .into_iter()
            .map(|(id, name, desc, trigger_at, created_at)| {
                serde_json::json!({
                    "id": id,
                    "name": name,
                    "description": desc,
                    "trigger_at": trigger_at,
                    "created_at": created_at,
                })
            })
            .collect();

        Ok(tasks)
    }
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/// Compute a simple relevance score (0.0–1.0) for a memory given query terms.
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

/// Truncate a string at the nearest word boundary at or before `max_chars` characters.
/// Uses character count (not byte count) to handle multi-byte UTF-8 correctly.
fn truncate_at_word_boundary(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.trim().to_string();
    }
    // Collect up to max_chars characters then step back to the last space
    let truncated: String = s.chars().take(max_chars).collect();
    match truncated.rfind(' ') {
        Some(space_pos) => truncated[..space_pos].trim().to_string(),
        None => truncated.trim().to_string(),
    }
}

// ─── Task intent detection ────────────────────────────────────────────────────

struct DetectedTask {
    name: String,
    description: String,
    task_type: String,
    trigger_at: DateTime<Utc>,
    config: serde_json::Value,
}

/// Scan the combined text for time-bound task patterns (German + English).
/// Returns the first match found, if any.
fn detect_task_intent(original: &str, lower: &str) -> Option<DetectedTask> {
    // Guard: must mention a reminder/task trigger word
    let trigger_words = [
        "erinnere mich",
        "erinner mich",
        "erinnerung",
        "remind me",
        "reminder",
        "alarm",
        "wecker",
        "benachrichtige mich",
        "notify me",
        "später",
        "schedule",
        "plane",
        "task",
        "aufgabe",
    ];

    if !trigger_words.iter().any(|w| lower.contains(w)) {
        return None;
    }

    // Try to parse a time reference from the text
    let trigger_at = parse_time_reference(lower)?;

    // Build a brief name from the original text, truncated at a word boundary
    // so we don't split multi-byte characters or leave a partial word.
    let name = truncate_at_word_boundary(original, 100);

    let description = original.to_string();

    Some(DetectedTask {
        name,
        description: description.clone(),
        task_type: "reminder".to_string(),
        trigger_at,
        config: serde_json::json!({
            "reminder_text": description,
            "auto_detected": true,
        }),
    })
}

/// Attempt to extract a `DateTime<Utc>` from natural-language time expressions.
/// Supports common German and English patterns.
fn parse_time_reference(text: &str) -> Option<DateTime<Utc>> {
    let now = Utc::now();

    // ── relative offsets ──────────────────────────────────────────────────────

    // "in X minuten/stunden" / "in X minutes/hours"
    let relative_patterns: &[(&str, i64, &str)] = &[
        ("minuten", 60, "seconds"),
        ("minute", 60, "seconds"),
        ("minutes", 60, "seconds"),
        ("mins", 60, "seconds"),
        ("stunden", 3600, "seconds"),
        ("stunde", 3600, "seconds"),
        ("hours", 3600, "seconds"),
        ("hour", 3600, "seconds"),
        ("tagen", 86400, "seconds"),
        ("tag", 86400, "seconds"),
        ("days", 86400, "seconds"),
        ("day", 86400, "seconds"),
    ];

    for (unit, factor, _) in relative_patterns {
        if let Some(n) = extract_number_before(text, unit) {
            return Some(now + Duration::seconds(n * factor));
        }
    }

    // "morgen" / "tomorrow"
    if text.contains("morgen") || text.contains("tomorrow") {
        return Some(now + Duration::days(1));
    }

    // "übermorgen" / "day after tomorrow"
    if text.contains("übermorgen") || text.contains("day after tomorrow") {
        return Some(now + Duration::days(2));
    }

    // ── absolute clock times ──────────────────────────────────────────────────
    // Patterns: "um 15:30", "um 15 uhr", "at 3pm", "at 15:00"

    // "um HH:MM" or "at HH:MM"
    if let Some(t) = extract_hhmm(text) {
        return Some(combine_with_today_or_tomorrow(now, t));
    }

    // "um X uhr" / "at X am/pm"
    if let Some(t) = extract_hour_only(text) {
        return Some(combine_with_today_or_tomorrow(now, t));
    }

    None
}

/// Extract a number that appears immediately before a keyword.
fn extract_number_before(text: &str, keyword: &str) -> Option<i64> {
    let pos = text.find(keyword)?;
    let before = text[..pos].trim();
    before.split_whitespace().last()?.parse::<i64>().ok()
}

/// Extract HH:MM pattern from text using colon positions to avoid O(n²) scan.
/// Enforces exactly 2 digits for minutes (e.g. "15:09" is valid; "15:9" is not).
fn extract_hhmm(text: &str) -> Option<NaiveTime> {
    for (colon_pos, _) in text.match_indices(':') {
        // Extract potential minute digits immediately after the colon (must be exactly 2)
        let after_colon = &text[colon_pos + 1..];
        let m_str: String = after_colon.chars().take(2).collect();
        if m_str.len() != 2 || !m_str.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }

        // Extract potential hour digits immediately before the colon
        let before_colon = &text[..colon_pos];
        let h_str = before_colon
            .split(|c: char| !c.is_ascii_digit())
            .last()
            .unwrap_or("");
        if h_str.is_empty() {
            continue;
        }

        if let (Ok(h), Ok(m)) = (h_str.parse::<u32>(), m_str.parse::<u32>()) {
            if h < 24 && m < 60 {
                return NaiveTime::from_hms_opt(h, m, 0);
            }
        }
    }
    None
}

/// Extract a bare hour reference: "um 15 uhr", "at 3pm", "at 3 pm".
fn extract_hour_only(text: &str) -> Option<NaiveTime> {
    // German: "um X uhr"
    if let Some(pos) = text.find("um ") {
        let after = &text[pos + 3..];
        let num_str: String = after
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(h) = num_str.parse::<u32>() {
            if h < 24 {
                // Check for " uhr" following
                let rest = &after[num_str.len()..].trim_start();
                if rest.starts_with("uhr") || rest.starts_with(':') || rest.is_empty() {
                    return NaiveTime::from_hms_opt(h, 0, 0);
                }
            }
        }
    }

    // English: "at Xpm" / "at X pm" / "at X am"
    for marker in &["at "] {
        if let Some(pos) = text.find(marker) {
            let after = &text[pos + marker.len()..];
            let num_str: String = after
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(mut h) = num_str.parse::<u32>() {
                let rest = &after[num_str.len()..].trim_start().to_lowercase();
                if rest.starts_with("pm") && h < 12 {
                    h += 12;
                } else if rest.starts_with("am") && h == 12 {
                    h = 0;
                }
                if h < 24 {
                    return NaiveTime::from_hms_opt(h, 0, 0);
                }
            }
        }
    }

    None
}

/// Combine a NaiveTime with today's date; if the time has already passed today,
/// schedule it for tomorrow instead.  Uses `checked_add_days` to safely handle
/// edge cases near date boundaries.
fn combine_with_today_or_tomorrow(now: DateTime<Utc>, time: NaiveTime) -> DateTime<Utc> {
    let today = now.date_naive();
    let candidate = today.and_time(time).and_utc();

    if candidate > now {
        candidate
    } else {
        // Use checked_add_days to avoid potential panics near date boundaries
        match today.checked_add_days(chrono::Days::new(1)) {
            Some(tomorrow) => tomorrow.and_time(time).and_utc(),
            None => {
                tracing::warn!("Date overflow when calculating tomorrow; defaulting to +24h");
                now + Duration::hours(24)
            }
        }
    }
}
