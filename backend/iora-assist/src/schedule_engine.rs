// schedule_engine.rs – Advanced natural-language schedule parser for IORA Assist
//
// Understands German and English patterns such as:
//   "Wecke mich unter der Woche um 6:30 Uhr"
//   "Erinnere mich die nächsten 2 Wochen um 18 Uhr"
//   "Jeden Montag und Donnerstag um 9 Uhr"
//   "Täglich um 8 Uhr für die nächsten 30 Tage"
//   "In 30 Minuten"
//
// Returns a structured `ParsedSchedule` that the memory module can persist.

use chrono::{Datelike, DateTime, Duration, NaiveDate, NaiveTime, Timelike, Utc, Weekday};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Output types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RecurrenceType {
    /// Single one-time trigger
    Once,
    /// Every day
    Daily,
    /// Monday – Friday only
    Weekdays,
    /// Specific days of the week (1 = Mon … 7 = Sun)
    Weekly,
    /// Custom set of days (catches "Montag und Donnerstag")
    Custom,
}

impl RecurrenceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            RecurrenceType::Once => "once",
            RecurrenceType::Daily => "daily",
            RecurrenceType::Weekdays => "weekdays",
            RecurrenceType::Weekly => "weekly",
            RecurrenceType::Custom => "custom",
        }
    }
}

/// Fully-parsed schedule ready to be persisted as an autonomous task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSchedule {
    /// Short display name (up to 100 chars)
    pub name: String,
    /// The original user text kept as description
    pub description: String,
    /// What the task should do (always "reminder" for now)
    pub task_type: String,
    /// How this task recurs
    pub recurrence_type: RecurrenceType,
    /// ISO weekday numbers 1=Mon…7=Sun; empty means "every day"
    pub days_of_week: Vec<u8>,
    /// Local-time-of-day at which the task fires
    pub time_of_day: Option<NaiveTime>,
    /// Absolute UTC timestamp of the very first firing
    pub first_trigger_at: DateTime<Utc>,
    /// Absolute UTC timestamp of the next firing (= first when freshly created)
    pub next_trigger_at: DateTime<Utc>,
    /// Stop recurring after this date (None = unlimited)
    pub recurrence_end_at: Option<DateTime<Utc>>,
    /// Maximum number of times to fire (None = unlimited)
    pub occurrence_limit: Option<i32>,
    /// IANA timezone (default "UTC")
    pub user_timezone: String,
    /// Source input mode
    pub input_mode: String,
    /// Whether a recurring pattern was detected
    pub is_recurring: bool,
}

// ─── ScheduleEngine ───────────────────────────────────────────────────────────

pub struct ScheduleEngine;

impl ScheduleEngine {
    /// Try to parse a natural-language schedule from the combined text of
    /// a user message (and optionally an AI response).
    ///
    /// Returns `None` if no actionable time or task intent is detected.
    pub fn parse(original: &str, user_timezone: &str) -> Option<ParsedSchedule> {
        let lower = original.to_lowercase();

        // ── Gate check: must contain a trigger word ───────────────────────────
        if !has_trigger_word(&lower) {
            return None;
        }

        // ── Extract time-of-day ───────────────────────────────────────────────
        let time_of_day = extract_time_of_day(&lower);

        // ── Determine recurrence pattern ──────────────────────────────────────
        let (recurrence_type, days_of_week) = detect_recurrence(&lower);

        // ── Determine duration / end date ─────────────────────────────────────
        let (recurrence_end_at, occurrence_limit) = detect_duration(&lower);

        // ── Determine first trigger ───────────────────────────────────────────
        let now = Utc::now();

        let first_trigger_at = if recurrence_type == RecurrenceType::Once {
            // For one-shot tasks prefer relative offsets
            if let Some(rel) = extract_relative_offset(&lower) {
                now + rel
            } else if let Some(t) = time_of_day {
                next_occurrence_of_time(now, t, &days_of_week)
            } else {
                return None; // no usable time
            }
        } else {
            // For recurring tasks we need a time-of-day (absolute time required)
            let t = time_of_day?;
            next_occurrence_of_time(now, t, &days_of_week)
        };

        let is_recurring = recurrence_type != RecurrenceType::Once;

        let name = truncate_name(original, 100);

        Some(ParsedSchedule {
            name,
            description: original.to_string(),
            task_type: "reminder".to_string(),
            recurrence_type,
            days_of_week,
            time_of_day,
            first_trigger_at,
            next_trigger_at: first_trigger_at,
            recurrence_end_at,
            occurrence_limit,
            user_timezone: user_timezone.to_string(),
            input_mode: "chat".to_string(),
            is_recurring,
        })
    }

    /// Compute the next firing time for a recurring task, given the last
    /// execution timestamp and the task's schedule.
    pub fn compute_next_trigger(
        schedule: &ParsedSchedule,
        after: DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        if schedule.recurrence_type == RecurrenceType::Once {
            return None; // one-shot tasks don't repeat
        }

        let time = schedule.time_of_day?;

        match schedule.recurrence_type {
            RecurrenceType::Daily => {
                // Next day at the same time
                let candidate = after
                    .date_naive()
                    .checked_add_days(chrono::Days::new(1))?
                    .and_time(time)
                    .and_utc();
                Some(candidate)
            }
            RecurrenceType::Weekdays => {
                next_weekday_occurrence(after, time)
            }
            RecurrenceType::Weekly | RecurrenceType::Custom => {
                next_day_of_week_occurrence(after, time, &schedule.days_of_week)
            }
            RecurrenceType::Once => None,
        }
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Returns true if the text contains at least one task-trigger keyword.
fn has_trigger_word(lower: &str) -> bool {
    const TRIGGER_WORDS: &[&str] = &[
        "erinnere mich",
        "erinner mich",
        "erinnerung",
        "remind me",
        "reminder",
        "alarm",
        "wecker",
        "wecke mich",
        "wake me",
        "benachrichtige mich",
        "notify me",
        "schedule",
        "plane ",
        "wiederhole",
        "täglich",
        "wöchentlich",
        "daily",
        "weekly",
        "aufgabe",
        "task",
    ];
    TRIGGER_WORDS.iter().any(|w| lower.contains(w))
}

/// Extract the time-of-day from text. Understands:
///   "um 6:30 Uhr", "um 18 Uhr", "at 3pm", "at 18:00"
fn extract_time_of_day(lower: &str) -> Option<NaiveTime> {
    // Try HH:MM first (most precise)
    if let Some(t) = parse_hhmm(lower) {
        return Some(t);
    }
    // Then bare hour
    parse_hour(lower)
}

/// Parse "HH:MM" anywhere in text.
fn parse_hhmm(text: &str) -> Option<NaiveTime> {
    for (colon_pos, _) in text.match_indices(':') {
        let after = &text[colon_pos + 1..];
        let m_str: String = after.chars().take(2).collect();
        if m_str.len() != 2 || !m_str.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let before = &text[..colon_pos];
        let h_str = before
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

/// Parse bare hour references: "um 18 uhr", "at 3pm", "at 3 am".
fn parse_hour(text: &str) -> Option<NaiveTime> {
    // German: "um X uhr" / "um X"
    if let Some(pos) = text.find("um ") {
        let after = &text[pos + 3..];
        let num_str: String = after
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(h) = num_str.parse::<u32>() {
            if h < 24 {
                let rest = after[num_str.len()..].trim_start();
                if rest.starts_with("uhr") || rest.is_empty() || rest.starts_with(' ') {
                    return NaiveTime::from_hms_opt(h, 0, 0);
                }
            }
        }
    }

    // English: "at X pm" / "at Xpm"
    if let Some(pos) = text.find("at ") {
        let after = &text[pos + 3..];
        let num_str: String = after
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(mut h) = num_str.parse::<u32>() {
            let rest = after[num_str.len()..].trim_start();
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

    None
}

/// Determine the recurrence pattern and days-of-week from text.
fn detect_recurrence(lower: &str) -> (RecurrenceType, Vec<u8>) {
    // ── Weekdays (Mon-Fri) ────────────────────────────────────────────────────
    let weekday_phrases = [
        "unter der woche",
        "wochentags",
        "wochentag",
        "werktags",
        "werktag",
        "montag bis freitag",
        "monday to friday",
        "monday through friday",
        "weekdays",
        "on weekdays",
        "mon-fri",
        "mon to fri",
    ];
    if weekday_phrases.iter().any(|p| lower.contains(p)) {
        return (RecurrenceType::Weekdays, vec![1, 2, 3, 4, 5]);
    }

    // ── Weekend ───────────────────────────────────────────────────────────────
    let weekend_phrases = [
        "am wochenende",
        "wochenende",
        "samstag und sonntag",
        "weekend",
        "on weekends",
        "saturdays and sundays",
    ];
    if weekend_phrases.iter().any(|p| lower.contains(p)) {
        return (RecurrenceType::Custom, vec![6, 7]);
    }

    // ── Specific named days ───────────────────────────────────────────────────
    let mut days: Vec<u8> = Vec::new();
    let day_names: &[(&str, &str, u8)] = &[
        ("montag",    "monday",    1),
        ("dienstag",  "tuesday",   2),
        ("mittwoch",  "wednesday", 3),
        ("donnerstag","thursday",  4),
        ("freitag",   "friday",    5),
        ("samstag",   "saturday",  6),
        ("sonntag",   "sunday",    7),
        ("mo ",       "mon ",      1),
        ("di ",       "tue ",      2),
        ("mi ",       "wed ",      3),
        ("do ",       "thu ",      4),
        ("fr ",       "fri ",      5),
        ("sa ",       "sat ",      6),
        ("so ",       "sun ",      7),
    ];
    for &(de, en, num) in day_names {
        if lower.contains(de) || lower.contains(en) {
            if !days.contains(&num) {
                days.push(num);
            }
        }
    }
    if days.len() == 1 {
        return (RecurrenceType::Weekly, days);
    }
    if days.len() > 1 {
        days.sort_unstable();
        return (RecurrenceType::Custom, days);
    }

    // ── Daily ────────────────────────────────────────────────────────────────
    let daily_phrases = [
        "täglich",
        "jeden tag",
        "jede nacht",
        "daily",
        "every day",
        "each day",
        "jede stunde",    // hourly - treat as daily for now
        "every hour",
    ];
    if daily_phrases.iter().any(|p| lower.contains(p)) {
        return (RecurrenceType::Daily, vec![]);
    }

    // ── If there's a recurring qualifier without explicit days, default to daily
    let recurring_cues = [
        "die nächsten",
        "the next",
        "für die nächsten",
        "for the next",
        "nächste woche",
        "next week",
        "wiederhole",
        "repeat",
        "regelmäßig",
        "regularly",
    ];
    if recurring_cues.iter().any(|p| lower.contains(p)) {
        return (RecurrenceType::Daily, vec![]);
    }

    (RecurrenceType::Once, vec![])
}

/// Detect how long the recurrence should run.
/// Returns `(end_date, occurrence_limit)`.
fn detect_duration(lower: &str) -> (Option<DateTime<Utc>>, Option<i32>) {
    let now = Utc::now();

    // ── "die nächsten N Wochen" / "for the next N weeks" ─────────────────────
    if let Some(weeks) = extract_number_before(lower, "wochen")
        .or_else(|| extract_number_before(lower, "week"))
        .or_else(|| extract_number_before(lower, "weeks"))
    {
        let end = now + Duration::weeks(weeks);
        return (Some(end), None);
    }

    // ── "die nächsten N Tage" / "for the next N days" ─────────────────────────
    if let Some(days) = extract_number_before(lower, "tagen")
        .or_else(|| extract_number_before(lower, "tage")
        .or_else(|| extract_number_before(lower, " days")))
    {
        let end = now + Duration::days(days);
        return (Some(end), None);
    }

    // ── "N mal" / "N times" ───────────────────────────────────────────────────
    if let Some(n) = extract_number_before(lower, " mal")
        .or_else(|| extract_number_before(lower, " times"))
        .or_else(|| extract_number_before(lower, " time"))
    {
        return (None, Some(n as i32));
    }

    // ── "für einen Monat" / "for a month" ────────────────────────────────────
    if lower.contains("für einen monat")
        || lower.contains("einen monat lang")
        || lower.contains("for a month")
        || lower.contains("for one month")
    {
        let end = now + Duration::days(30);
        return (Some(end), None);
    }

    // ── "für eine Woche" / "for a week" ──────────────────────────────────────
    if lower.contains("für eine woche")
        || lower.contains("eine woche lang")
        || lower.contains("for a week")
        || lower.contains("for one week")
    {
        let end = now + Duration::weeks(1);
        return (Some(end), None);
    }

    (None, None)
}

/// Extract a relative time offset like "in 30 Minuten", "in 2 Stunden".
fn extract_relative_offset(lower: &str) -> Option<Duration> {
    let relative: &[(&str, i64)] = &[
        ("minuten", 60),
        ("minute",  60),
        ("minutes", 60),
        ("mins",    60),
        ("stunden", 3600),
        ("stunde",  3600),
        ("hours",   3600),
        ("hour",    3600),
        ("tagen",   86400),
        ("tag",     86400),
        ("days",    86400),
        ("day",     86400),
    ];
    for &(unit, secs) in relative {
        if let Some(n) = extract_number_before(lower, unit) {
            return Some(Duration::seconds(n * secs));
        }
    }

    if lower.contains("morgen") || lower.contains("tomorrow") {
        return Some(Duration::days(1));
    }
    if lower.contains("übermorgen") || lower.contains("day after tomorrow") {
        return Some(Duration::days(2));
    }

    None
}

/// Find the next UTC datetime that is at or after `after` and matches
/// `time` on any of the allowed weekdays (empty = any day).
fn next_occurrence_of_time(
    after: DateTime<Utc>,
    time: NaiveTime,
    days_of_week: &[u8],
) -> DateTime<Utc> {
    let mut candidate = after.date_naive().and_time(time).and_utc();

    // If that time has already passed today, start from tomorrow
    if candidate <= after {
        candidate = candidate + Duration::days(1);
    }

    if days_of_week.is_empty() {
        return candidate;
    }

    // Walk forward until we hit an allowed day-of-week
    for _ in 0..8 {
        let dow = iso_weekday(candidate.weekday());
        if days_of_week.contains(&dow) {
            return candidate;
        }
        candidate = candidate + Duration::days(1);
    }

    candidate // fallback (should not happen)
}

/// Next Mon-Fri occurrence after `after` at `time`.
fn next_weekday_occurrence(after: DateTime<Utc>, time: NaiveTime) -> Option<DateTime<Utc>> {
    Some(next_occurrence_of_time(after, time, &[1, 2, 3, 4, 5]))
}

/// Next occurrence of a specific set of days-of-week after `after` at `time`.
fn next_day_of_week_occurrence(
    after: DateTime<Utc>,
    time: NaiveTime,
    days: &[u8],
) -> Option<DateTime<Utc>> {
    if days.is_empty() {
        return None;
    }
    Some(next_occurrence_of_time(after, time, days))
}

/// Convert chrono's `Weekday` to ISO weekday number (1=Mon … 7=Sun).
fn iso_weekday(w: Weekday) -> u8 {
    match w {
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
        Weekday::Sun => 7,
    }
}

/// Extract a number immediately before a keyword (e.g. "2" before "Wochen").
fn extract_number_before(text: &str, keyword: &str) -> Option<i64> {
    let pos = text.find(keyword)?;
    let before = text[..pos].trim();
    // Convert written-out German numbers
    let last_token = before.split_whitespace().last()?;
    written_number(last_token)
        .or_else(|| last_token.parse::<i64>().ok())
}

/// Recognise common German written-out numbers.
fn written_number(s: &str) -> Option<i64> {
    match s {
        "ein" | "eine" | "einem" | "einen" | "einer" | "one" | "a" | "an" => Some(1),
        "zwei" | "two" => Some(2),
        "drei" | "three" => Some(3),
        "vier" | "four" => Some(4),
        "fünf" | "five" => Some(5),
        "sechs" | "six" => Some(6),
        "sieben" | "seven" => Some(7),
        "acht" | "eight" => Some(8),
        "neun" | "nine" => Some(9),
        "zehn" | "ten" => Some(10),
        "elf" | "eleven" => Some(11),
        "zwölf" | "twelve" => Some(12),
        "vierzehn" | "fourteen" => Some(14),
        "siebzehn" | "seventeen" => Some(17),
        "zwanzig" | "twenty" => Some(20),
        "dreißig" | "thirty" => Some(30),
        _ => None,
    }
}

/// Truncate at a word boundary.
fn truncate_name(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.trim().to_string();
    }
    let truncated: String = s.chars().take(max_chars).collect();
    match truncated.rfind(' ') {
        Some(p) => truncated[..p].trim().to_string(),
        None => truncated.trim().to_string(),
    }
}

// ─── Multi-message context builder ────────────────────────────────────────────

/// Condense a slice of `(role, content)` message pairs into a single string
/// that can be passed to `ScheduleEngine::parse`.
///
/// We combine the last `limit` messages to keep the context window small.
pub fn build_conversation_context(messages: &[(String, String)], limit: usize) -> String {
    let start = messages.len().saturating_sub(limit);
    messages[start..]
        .iter()
        .map(|(role, content)| format!("[{}] {}", role, content))
        .collect::<Vec<_>>()
        .join(" | ")
}

/// Extract a duration in days from a natural-language phrase.
/// Understands German and English duration patterns and written numbers.
///
/// Examples: "2 Wochen" → 14, "einen Monat" → 30, "30 Tage" → 30
/// Returns `None` if no duration is found.
pub fn extract_duration_days(lower: &str) -> Option<i64> {
    // Weeks
    if let Some(weeks) = extract_number_before(lower, "wochen")
        .or_else(|| extract_number_before(lower, "week"))
        .or_else(|| extract_number_before(lower, "weeks"))
    {
        return Some(weeks * 7);
    }
    // "eine Woche" / "for a week"
    if lower.contains("eine woche") || lower.contains("for a week") || lower.contains("for one week") {
        return Some(7);
    }

    // Months
    if let Some(months) = extract_number_before(lower, "monate")
        .or_else(|| extract_number_before(lower, "monat"))
        .or_else(|| extract_number_before(lower, "month"))
        .or_else(|| extract_number_before(lower, "months"))
    {
        return Some(months * 30);
    }
    if lower.contains("einen monat") || lower.contains("ein monat")
        || lower.contains("for a month") || lower.contains("for one month")
    {
        return Some(30);
    }

    // Days
    if let Some(days) = extract_number_before(lower, "tagen")
        .or_else(|| extract_number_before(lower, "tage"))
        .or_else(|| extract_number_before(lower, " days"))
        .or_else(|| extract_number_before(lower, " day"))
    {
        return Some(days);
    }

    None
}

// ─── Tests ────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Option<ParsedSchedule> {
        ScheduleEngine::parse(s, "UTC")
    }

    #[test]
    fn test_wecke_mich_unter_der_woche() {
        let s = parse("Wecke mich unter der Woche um 6:30 Uhr").unwrap();
        assert_eq!(s.recurrence_type, RecurrenceType::Weekdays);
        assert_eq!(s.days_of_week, vec![1, 2, 3, 4, 5]);
        assert_eq!(s.time_of_day, NaiveTime::from_hms_opt(6, 30, 0));
    }

    #[test]
    fn test_die_naechsten_zwei_wochen() {
        let s = parse("Erinnere mich die nächsten 2 Wochen um 18 Uhr das ich Wasser trinken soll").unwrap();
        assert_eq!(s.recurrence_type, RecurrenceType::Daily);
        assert!(s.recurrence_end_at.is_some());
        assert_eq!(s.time_of_day, NaiveTime::from_hms_opt(18, 0, 0));
    }

    #[test]
    fn test_jeden_montag() {
        let s = parse("Erinnere mich jeden Montag um 9 Uhr").unwrap();
        assert_eq!(s.recurrence_type, RecurrenceType::Weekly);
        assert_eq!(s.days_of_week, vec![1]);
    }

    #[test]
    fn test_relative_in_30_minuten() {
        let s = parse("Erinnere mich in 30 Minuten").unwrap();
        assert_eq!(s.recurrence_type, RecurrenceType::Once);
        assert!(s.first_trigger_at > Utc::now());
    }

    #[test]
    fn test_no_trigger_word() {
        assert!(parse("Was ist das Wetter heute?").is_none());
    }
}
