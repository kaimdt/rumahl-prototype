// task_resolver.rs – Contextual Task Resolution for IORA Assist
//
// This module does three things:
//
//  1. **Task summarization** – produce a compact, human+AI-readable summary of a
//     user's active tasks that can be injected into the AI system prompt.
//
//  2. **Intent classification** – decide whether a message/conversation is asking
//     to *modify* an existing task (pause, resume, delete, adjust).
//
//  3. **Task matching** – fuzzy-match a natural-language description to the best
//     candidate in the task list, with a confidence score.
//
// The *AI* does the heavy reasoning for ambiguous cases; this module provides
// the plumbing that feeds it the right context and parses its structured output.

use crate::database::tasks::AutonomousTask;
use crate::schedule_engine::extract_duration_days;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Output types ──────────────────────────────────────────────────────────────

/// An action the system wants to execute on an existing task.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskModificationAction {
    /// Permanently disable the task
    Disable,
    /// Temporarily pause the task until `resume_at`
    PauseUntil(DateTime<Utc>),
    /// Re-enable a paused/disabled task
    Resume,
    /// Delete the task permanently
    Delete,
}

impl TaskModificationAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskModificationAction::Disable => "disable",
            TaskModificationAction::PauseUntil(_) => "pause_until",
            TaskModificationAction::Resume => "resume",
            TaskModificationAction::Delete => "delete",
        }
    }
}

/// The resolved intent after matching user text to an existing task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResolution {
    /// The task being referenced (None if we couldn't find a match)
    pub task_id: Option<Uuid>,
    /// Human-readable name of the matched task
    pub task_name: Option<String>,
    /// What to do to the task
    pub action: Option<TaskModificationAction>,
    /// 0.0 – 1.0; if < CONFIRMATION_THRESHOLD the system should ask first
    pub confidence: f64,
    /// If confidence is below threshold: the question to show the user
    pub confirmation_question: Option<String>,
}

/// Below this confidence, the system must ask the user for confirmation.
const CONFIRMATION_THRESHOLD: f64 = 0.65;

// ─── TaskResolver ─────────────────────────────────────────────────────────────

pub struct TaskResolver;

impl TaskResolver {
    /// Produce a compact AI-readable summary of active tasks.
    ///
    /// This is injected into the system prompt so the AI always knows what
    /// tasks exist and can reason about modification requests.
    pub fn summarize_tasks(tasks: &[AutonomousTask]) -> String {
        if tasks.is_empty() {
            return String::from("Der Nutzer hat momentan keine aktiven Aufgaben.");
        }

        let mut out = String::from("### Aktive Aufgaben des Nutzers\n");
        for t in tasks {
            let recur = match t.recurrence_type.as_str() {
                "weekdays" => "Mo–Fr".to_string(),
                "daily"    => "täglich".to_string(),
                "weekly"   => format!("wöchentlich (Tage: {:?})", t.recurrence_days),
                "custom"   => format!("Tage: {:?}", t.recurrence_days),
                _          => "einmalig".to_string(),
            };
            let time_str = t.time_of_day
                .map(|t| format!(", um {}", t.format("%H:%M")))
                .unwrap_or_default();
            let status = if t.paused_temporarily {
                format!(
                    " [PAUSIERT bis {}]",
                    t.paused_until
                        .map(|d| d.format("%d.%m.%Y").to_string())
                        .unwrap_or_else(|| "unbekannt".into())
                )
            } else if !t.enabled {
                " [DEAKTIVIERT]".to_string()
            } else {
                String::new()
            };
            out.push_str(&format!(
                "- ID={} | \"{}\" | {} {}{}{}\n",
                t.id, t.name, recur, time_str,
                t.description.as_deref().map(|d| format!(" | {}", d)).unwrap_or_default(),
                status,
            ));
        }
        out
    }

    /// Build the full system-prompt segment that teaches the AI how to express
    /// task modifications in a structured format.
    pub fn build_system_prompt_section(tasks: &[AutonomousTask]) -> String {
        let task_list = Self::summarize_tasks(tasks);
        format!(
            r#"
{task_list}

### Aufgaben-Steuerung durch die AI
Wenn der Nutzer eine bestehende Aufgabe ändern möchte (deaktivieren, pausieren,
fortsetzen, löschen), gib am **Ende** deiner Antwort einen Befehlsblock aus:

Wenn du **sicher** bist, was der Nutzer meint:
[TASK_ACTION: {{"action":"pause_until","task_id":"UUID","resume_at":"ISO8601","reason":"..."}}]

Wenn du **unsicher** bist, stelle eine Rückfrage und füge einen Bestätigungsblock an:
[TASK_CONFIRM: {{"action":"pause_until","task_id":"UUID","resume_at":"ISO8601","question":"Soll ich …?"}}]

Unterstützte Aktionen: "pause_until", "disable", "resume", "delete"
- "pause_until": Temporäre Deaktivierung bis "resume_at" (ISO 8601 Datum)
- "disable": Dauerhaft deaktivieren
- "resume": Wieder aktivieren
- "delete": Dauerhaft löschen

Nur wenn eine Aufgabe eindeutig gemeint ist, gib einen solchen Block aus.
Wenn der Nutzer keinen Bezug auf bestehende Aufgaben nimmt, lass den Block weg.
Füge diesen Block immer am **Ende** der Antwort ein, und **nur einmal**.
"#
        )
    }

    /// Parse structured action blocks from the AI's raw response text.
    ///
    /// Returns a tuple of:
    /// - The response text with the marker stripped (user-visible)
    /// - An optional `ParsedAiTaskCommand`
    pub fn parse_ai_response(response: &str) -> (String, Option<ParsedAiTaskCommand>) {
        // Try [TASK_ACTION: {...}]
        if let Some(cmd) = parse_marker(response, "TASK_ACTION") {
            let cleaned = strip_marker(response, "TASK_ACTION");
            return (cleaned, Some(ParsedAiTaskCommand {
                requires_confirmation: false,
                ..cmd
            }));
        }

        // Try [TASK_CONFIRM: {...}]
        if let Some(cmd) = parse_marker(response, "TASK_CONFIRM") {
            let cleaned = strip_marker(response, "TASK_CONFIRM");
            return (cleaned, Some(ParsedAiTaskCommand {
                requires_confirmation: true,
                ..cmd
            }));
        }

        (response.to_string(), None)
    }

    /// Attempt to match a natural-language text to an existing task using
    /// lightweight heuristics (time-of-day, day-pattern, keywords).
    ///
    /// Returns the best-matching task id and a confidence in 0.0–1.0, plus a
    /// confirmation question if confidence is below the threshold.
    pub fn resolve_from_text(
        text: &str,
        tasks: &[AutonomousTask],
    ) -> TaskResolution {
        if tasks.is_empty() {
            return TaskResolution {
                task_id: None,
                task_name: None,
                action: None,
                confidence: 0.0,
                confirmation_question: Some(
                    "Du hast noch keine aktiven Aufgaben, die ich ändern könnte.".into()
                ),
            };
        }

        let lower = text.to_lowercase();

        // Score each task
        let mut best: Option<(f64, &AutonomousTask)> = None;
        for task in tasks {
            let score = score_task_match(&lower, task);
            if best.as_ref().map_or(true, |(b, _)| score > *b) {
                best = Some((score, task));
            }
        }

        let (confidence, task) = match best {
            Some(b) => b,
            None => return TaskResolution {
                task_id: None,
                task_name: None,
                action: None,
                confidence: 0.0,
                confirmation_question: Some(
                    "Ich konnte keine passende Aufgabe finden. Welche Aufgabe meinst du?".into()
                ),
            },
        };

        // Determine the action
        let action = detect_modification_action(&lower, task);
        let question = if confidence < CONFIRMATION_THRESHOLD {
            Some(build_confirmation_question(task, &action))
        } else {
            None
        };

        TaskResolution {
            task_id: Some(task.id),
            task_name: Some(task.name.clone()),
            action: Some(action),
            confidence,
            confirmation_question: question,
        }
    }
}

// ─── Parsed AI command ────────────────────────────────────────────────────────

/// The structured command block extracted from the AI response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedAiTaskCommand {
    pub action: String,
    pub task_id: Option<Uuid>,
    pub resume_at: Option<DateTime<Utc>>,
    pub question: Option<String>,
    pub reason: Option<String>,
    pub requires_confirmation: bool,
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Score how well a task matches the user's text.
fn score_task_match(lower: &str, task: &AutonomousTask) -> f64 {
    let mut score: f64 = 0.0;

    // ── Time-of-day match ─────────────────────────────────────────────────────
    if let Some(tod) = task.time_of_day {
        let hhmm = format!("{}:{:02}", tod.hour(), tod.minute());
        let h_only = format!("{} uhr", tod.hour());
        let h_colon = format!("{}:{}", tod.hour(), tod.minute());
        if lower.contains(&hhmm) || lower.contains(&h_colon) {
            score += 0.45;
        } else if lower.contains(&h_only) {
            score += 0.30;
        }
    }

    // ── Recurrence keyword match ──────────────────────────────────────────────
    let recur_match = match task.recurrence_type.as_str() {
        "weekdays" => {
            lower.contains("wecker") || lower.contains("alarm")
                || lower.contains("wochentag") || lower.contains("unter der woche")
                || lower.contains("werktag") || lower.contains("weekday")
        }
        "daily" => lower.contains("täglich") || lower.contains("daily"),
        "weekly" => lower.contains("wöchentlich") || lower.contains("weekly"),
        _ => false,
    };
    if recur_match { score += 0.20; }

    // ── Name / description substring match ───────────────────────────────────
    let task_lower = task.name.to_lowercase();
    let desc_lower = task.description.as_deref().unwrap_or("").to_lowercase();
    let name_words: Vec<&str> = task_lower
        .split_whitespace()
        .filter(|w| w.len() >= 4)
        .collect();
    let matched_words = name_words.iter().filter(|w| lower.contains(**w)).count();
    if !name_words.is_empty() {
        score += 0.25 * (matched_words as f64 / name_words.len() as f64);
    }
    // Short description words
    let desc_words: Vec<&str> = desc_lower.split_whitespace().filter(|w| w.len() >= 5).collect();
    let desc_matches = desc_words.iter().filter(|w| lower.contains(**w)).count();
    if !desc_words.is_empty() {
        score += 0.10 * (desc_matches as f64 / desc_words.len() as f64);
    }

    // ── Task type keywords ────────────────────────────────────────────────────
    if task.task_type == "reminder" || task.task_type == "alarm" {
        if lower.contains("wecker") || lower.contains("alarm")
            || lower.contains("wake") || lower.contains("wecken")
            || lower.contains("reminder") || lower.contains("erinnern")
        {
            score += 0.15;
        }
    }

    score.min(1.0)
}

/// Determine what modification the user wants to make.
fn detect_modification_action(lower: &str, task: &AutonomousTask) -> TaskModificationAction {
    // Determine duration (days), defaulting to 0 if not found
    let days = extract_duration_days(lower).unwrap_or(0);
    let now = Utc::now();

    // Temporary pause with explicit duration
    if days > 0 {
        let disable_words = [
            "deaktiviere", "deaktivieren", "deaktiviert",
            "pausiere", "pausieren", "pause",
            "disable", "turn off", "ausschalten", "abschalten",
        ];
        let vacation_words = [
            "urlaub", "vacation", "holiday", "ferien",
        ];
        if disable_words.iter().any(|w| lower.contains(w))
            || vacation_words.iter().any(|w| lower.contains(w))
        {
            return TaskModificationAction::PauseUntil(now + Duration::days(days));
        }
    }

    // Permanent disable
    let perm_disable = [
        "deaktiviere", "deaktivieren", "disable",
        "ausschalten", "abschalten", "turn off",
        "stoppe", "stopp", "stop",
    ];
    if perm_disable.iter().any(|w| lower.contains(w)) {
        return TaskModificationAction::Disable;
    }

    // Resume / enable
    let resume_words = [
        "aktiviere", "aktivieren", "enable",
        "einschalten", "wieder an", "fortsetzen",
        "resume", "reactivate", "reaktiviere",
    ];
    if resume_words.iter().any(|w| lower.contains(w)) {
        return TaskModificationAction::Resume;
    }

    // Delete
    let delete_words = [
        "lösche", "löschen", "delete", "entferne", "entfernen",
        "remove", "cancel",
    ];
    if delete_words.iter().any(|w| lower.contains(w)) {
        return TaskModificationAction::Delete;
    }

    // Default: temporary pause if it looks like a vacation/duration mention
    if extract_duration_days(lower).is_some() {
        let vacation = ["urlaub", "vacation", "holiday", "ferien", "pause", "frei"];
        if vacation.iter().any(|w| lower.contains(w)) {
            return TaskModificationAction::PauseUntil(
                now + Duration::days(extract_duration_days(lower).unwrap_or(14))
            );
        }
    }

    // Fallback: permanent disable
    TaskModificationAction::Disable
}

/// Build a natural German confirmation question for a detected action.
fn build_confirmation_question(task: &AutonomousTask, action: &TaskModificationAction) -> String {
    let time_str = task.time_of_day
        .map(|t| format!(" um {}:{:02} Uhr", t.hour(), t.minute()))
        .unwrap_or_default();
    let recur_str = match task.recurrence_type.as_str() {
        "weekdays" => " (Mo–Fr)".to_string(),
        "daily"    => " (täglich)".to_string(),
        _ => String::new(),
    };

    match action {
        TaskModificationAction::PauseUntil(until) => {
            let days = (*until - Utc::now()).num_days().max(1);
            format!(
                "Soll ich deinen Wecker{}{} für {} {} deaktivieren?",
                time_str, recur_str, days,
                if days == 1 { "Tag" } else { "Tage" }
            )
        }
        TaskModificationAction::Disable => {
            format!("Soll ich \"{}\" dauerhaft deaktivieren?", task.name)
        }
        TaskModificationAction::Resume => {
            format!("Soll ich \"{}\" wieder aktivieren?", task.name)
        }
        TaskModificationAction::Delete => {
            format!(
                "Soll ich \"{}\" endgültig löschen? Das kann nicht rückgängig gemacht werden.",
                task.name
            )
        }
    }
}

/// Parse `[MARKER: {...}]` from the AI response text.
fn parse_marker(text: &str, marker: &str) -> Option<ParsedAiTaskCommand> {
    let start_tag = format!("[{}:", marker);
    let start = text.find(&start_tag)?;
    let after = &text[start + start_tag.len()..];
    let end = after.find(']')?;
    let json_str = after[..end].trim();

    let v: serde_json::Value = serde_json::from_str(json_str).ok()?;

    let task_id = v.get("task_id")
        .and_then(|x| x.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());

    let resume_at = v.get("resume_at")
        .and_then(|x| x.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    Some(ParsedAiTaskCommand {
        action: v.get("action").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        task_id,
        resume_at,
        question: v.get("question").and_then(|x| x.as_str()).map(str::to_string),
        reason: v.get("reason").and_then(|x| x.as_str()).map(str::to_string),
        requires_confirmation: false,
    })
}

/// Remove a `[MARKER: {...}]` block from text.
fn strip_marker(text: &str, marker: &str) -> String {
    let start_tag = format!("[{}:", marker);
    if let Some(start) = text.find(&start_tag) {
        let after = &text[start + start_tag.len()..];
        if let Some(end_offset) = after.find(']') {
            let end = start + start_tag.len() + end_offset + 1;
            let cleaned = format!("{}{}", &text[..start].trim_end(), &text[end..].trim_start());
            return cleaned.trim().to_string();
        }
    }
    text.to_string()
}

// ─── Public re-export from schedule_engine ────────────────────────────────────
// Placed here to avoid adding a public fn to schedule_engine just for this module.

use chrono::Timelike;
