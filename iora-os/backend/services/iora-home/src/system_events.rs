//! Persistent, comprehensive system-event log.
//!
//! Captures **every** error / warning / info — from explicit `report_*` calls,
//! from automatic `tracing` interception (so any `error!()` / `warn!()` macro
//! anywhere is also logged), and from frontend client reports — into Postgres
//! tables `system_event_groups` and `system_event_occurrences`.
//!
//! Aggregation model:
//!   * **Groups** are fingerprinted by `(severity, source, message)`. Repeated
//!     identical events increment the group counter and refresh `last_seen`
//!     but never produce duplicate group rows.
//!   * **Occurrences** are appended on every event with full per-event
//!     metadata (origin, user, request path, file/line, error chain, …) so
//!     the raw "what happened in chronological order" view stays intact —
//!     dedup applies only to the grouped error view, not to the log.
//!
//! Hot-path strategy: events are ingested via an unbounded mpsc channel so
//! emitting an event from a `tracing::Layer::on_event` (sync context) is
//! lock-free. A single background task drains the channel and performs the
//! upsert + insert. A small in-memory cache keeps the latest N occurrences
//! ready for the admin UI without a DB round-trip and feeds the WebSocket
//! broadcast that gives connected dashboards instant toast feedback.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use tokio::sync::{mpsc, RwLock};
use tracing::debug;

use crate::db::DbPool;
use crate::websocket::WebSocketManager;

/// How many recent occurrences to keep in memory for the live UI cache.
const HOT_CACHE: usize = 200;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Error,
}

impl Severity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Warning => "warning",
            Severity::Error => "error",
        }
    }

    pub fn from_str_ci(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "error" | "err" => Some(Severity::Error),
            "warning" | "warn" => Some(Severity::Warning),
            "info" => Some(Severity::Info),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// Explicit `report_*` calls from backend handlers / background tasks.
    Backend,
    /// Automatic capture from the `tracing` layer.
    Tracing,
    /// Client-side (frontend) reports POSTed to `/api/admin/system-events/client`.
    Frontend,
}

impl Origin {
    pub fn as_str(&self) -> &'static str {
        match self {
            Origin::Backend => "backend",
            Origin::Tracing => "tracing",
            Origin::Frontend => "frontend",
        }
    }
}

/// Per-occurrence metadata payload. All fields optional so call sites pick
/// only the bits they have.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EventMeta {
    pub user_id: Option<String>,
    pub request_path: Option<String>,
    pub request_method: Option<String>,
    pub status_code: Option<i32>,
    pub file: Option<String>,
    pub line: Option<i32>,
    pub target: Option<String>,
    pub error_chain: Option<String>,
    /// Free-form additional JSON details (entity ids, URLs, payload sizes…).
    pub extra: Option<Value>,
}

/// Raised event prior to persistence — used inside the ingest channel.
#[derive(Debug)]
struct RawIngest {
    severity: Severity,
    source: String,
    message: String,
    origin: Origin,
    meta: EventMeta,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupRow {
    pub fingerprint: String,
    pub severity: Severity,
    pub source: String,
    pub message: String,
    pub count: i64,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub last_details: Option<Value>,
    pub resolved: bool,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OccurrenceRow {
    pub id: i64,
    pub fingerprint: String,
    pub severity: Severity,
    pub source: String,
    pub message: String,
    pub origin: Origin,
    pub details: Option<Value>,
    pub user_id: Option<String>,
    pub request_path: Option<String>,
    pub request_method: Option<String>,
    pub status_code: Option<i32>,
    pub file: Option<String>,
    pub line: Option<i32>,
    pub target: Option<String>,
    pub error_chain: Option<String>,
    pub occurred_at: DateTime<Utc>,
}

// ─── Global sink for the tracing layer ──────────────────────────────
//
// The tracing layer is a static type (`IoraLogLayer`) installed in `main()`
// before `SystemEventLog::new()` runs. To bridge them we keep a global
// `OnceLock<UnboundedSender>` that the layer can write to as soon as the
// log is constructed.
static GLOBAL_SINK: OnceLock<mpsc::UnboundedSender<RawIngest>> = OnceLock::new();

/// Called from the global tracing layer. Returns silently if the system log
/// hasn't been constructed yet (during early boot, before the DB is open).
pub fn capture_from_tracing(severity: Severity, source: &str, message: &str, meta: EventMeta) {
    // Avoid loops: any event coming from this module would otherwise re-enter
    // here forever (the persist path itself emits tracing events on failure).
    if meta
        .target
        .as_deref()
        .map(|t| t.contains("system_events"))
        .unwrap_or(false)
        || source == "system_events"
    {
        return;
    }
    if let Some(tx) = GLOBAL_SINK.get() {
        let _ = tx.send(RawIngest {
            severity,
            source: source.to_string(),
            message: message.to_string(),
            origin: Origin::Tracing,
            meta,
        });
    }
}

pub struct SystemEventLog {
    db: DbPool,
    ws_manager: Arc<WebSocketManager>,
    cache: Arc<RwLock<VecDeque<RawIngest>>>,
    /// Number of events the ingest task has dropped because of DB errors.
    drop_counter: Arc<AtomicU64>,
    /// Fan-out for app lifecycle hooks (`OnSystemEvent`). Same events as the
    /// DB ingest channel, but decoupled so a slow app never blocks the sink.
    hook_tx: mpsc::UnboundedSender<SystemEventHookEvent>,
    hook_rx: std::sync::Mutex<Option<mpsc::UnboundedReceiver<SystemEventHookEvent>>>,
}

/// Lightweight event payload for app lifecycle hooks.
#[derive(Debug, Clone)]
pub struct SystemEventHookEvent {
    pub severity: String,
    pub source: String,
    pub message: String,
}

impl SystemEventLog {
    pub fn new(db: DbPool, ws_manager: Arc<WebSocketManager>) -> Arc<Self> {
        let (hook_tx, hook_rx) = mpsc::unbounded_channel::<SystemEventHookEvent>();
        let log = Arc::new(Self {
            db,
            ws_manager,
            cache: Arc::new(RwLock::new(VecDeque::with_capacity(HOT_CACHE))),
            drop_counter: Arc::new(AtomicU64::new(0)),
            hook_tx,
            hook_rx: std::sync::Mutex::new(Some(hook_rx)),
        });

        // Install global sink for the tracing layer (only the first call
        // wins; subsequent constructions, e.g. in tests, are ignored).
        let (tx, rx) = mpsc::unbounded_channel::<RawIngest>();
        if GLOBAL_SINK.set(tx).is_err() {
            debug!("system_events: global sink already installed");
        }

        let me = log.clone();
        tokio::spawn(async move { me.run_ingest_loop(rx).await });

        log
    }

    /// Take the app-hook event stream (single consumer — the iora-home
    /// startup task that dispatches `OnSystemEvent` lifecycle hooks).
    pub fn subscribe_hooks(&self) -> Option<mpsc::UnboundedReceiver<SystemEventHookEvent>> {
        self.hook_rx.lock().unwrap().take()
    }

    fn fan_out(&self, severity: &Severity, source: &str, message: &str) {
        let _ = self.hook_tx.send(SystemEventHookEvent {
            severity: severity.as_str().to_string(),
            source: source.to_string(),
            message: message.to_string(),
        });
    }

    // ── Public emit API ───────────────────────────────────────────────

    pub async fn report_error(&self, source: &str, message: impl Into<String>) {
        self.emit(
            Severity::Error,
            source,
            message.into(),
            EventMeta::default(),
        )
        .await;
    }

    pub async fn report_error_with(
        &self,
        source: &str,
        message: impl Into<String>,
        details: Value,
    ) {
        let meta = EventMeta {
            extra: Some(details),
            ..Default::default()
        };
        self.emit(Severity::Error, source, message.into(), meta)
            .await;
    }

    /// Report an error with the full `std::error::Error` cause chain
    /// flattened into the `error_chain` metadata field.
    pub async fn report_error_chain(
        &self,
        source: &str,
        message: impl Into<String>,
        err: &(dyn std::error::Error + 'static),
    ) {
        let mut chain = String::new();
        let mut cur: Option<&dyn std::error::Error> = Some(err);
        while let Some(e) = cur {
            if !chain.is_empty() {
                chain.push_str("\n  caused by: ");
            }
            chain.push_str(&e.to_string());
            cur = e.source();
        }
        let meta = EventMeta {
            error_chain: Some(chain),
            ..Default::default()
        };
        self.emit(Severity::Error, source, message.into(), meta)
            .await;
    }

    pub async fn report_warn(&self, source: &str, message: impl Into<String>) {
        self.emit(
            Severity::Warning,
            source,
            message.into(),
            EventMeta::default(),
        )
        .await;
    }

    pub async fn report_warn_with(&self, source: &str, message: impl Into<String>, details: Value) {
        let meta = EventMeta {
            extra: Some(details),
            ..Default::default()
        };
        self.emit(Severity::Warning, source, message.into(), meta)
            .await;
    }

    pub async fn report_info(&self, source: &str, message: impl Into<String>) {
        self.emit(Severity::Info, source, message.into(), EventMeta::default())
            .await;
    }

    /// Generic emit with full metadata control.
    pub async fn emit(&self, severity: Severity, source: &str, message: String, meta: EventMeta) {
        self.fan_out(&severity, source, &message);
        if let Some(tx) = GLOBAL_SINK.get() {
            let _ = tx.send(RawIngest {
                severity,
                source: source.to_string(),
                message,
                origin: Origin::Backend,
                meta,
            });
        }
    }

    /// Ingest path for frontend-reported errors.
    pub async fn report_from_client(
        &self,
        severity: Severity,
        source: &str,
        message: String,
        meta: EventMeta,
    ) {
        self.fan_out(&severity, source, &message);
        if let Some(tx) = GLOBAL_SINK.get() {
            let _ = tx.send(RawIngest {
                severity,
                source: source.to_string(),
                message,
                origin: Origin::Frontend,
                meta,
            });
        }
    }

    // ── Background ingest loop ────────────────────────────────────────

    async fn run_ingest_loop(self: Arc<Self>, mut rx: mpsc::UnboundedReceiver<RawIngest>) {
        while let Some(ev) = rx.recv().await {
            if let Err(e) = self.persist(&ev).await {
                self.drop_counter.fetch_add(1, Ordering::Relaxed);
                // Use eprintln rather than tracing macros — going through
                // tracing here would re-enter `capture_from_tracing`.
                eprintln!(
                    "[system_events] persistence failed for [{}/{}]: {} :: {}",
                    ev.severity.as_str(),
                    ev.source,
                    ev.message,
                    e
                );
            }
        }
    }

    async fn persist(&self, ev: &RawIngest) -> sqlx::Result<()> {
        let fp = fingerprint(ev.severity, &ev.source, &ev.message);
        let details_json: Option<Value> = ev.meta.extra.clone().or_else(|| {
            // Build a synthetic details blob from inline metadata when no
            // explicit `extra` was provided so the API consumer always sees
            // *something* even for tracing-captured events.
            let mut obj = serde_json::Map::new();
            if let Some(v) = &ev.meta.user_id {
                obj.insert("user_id".into(), json!(v));
            }
            if let Some(v) = &ev.meta.request_path {
                obj.insert("request_path".into(), json!(v));
            }
            if let Some(v) = &ev.meta.request_method {
                obj.insert("request_method".into(), json!(v));
            }
            if let Some(v) = &ev.meta.status_code {
                obj.insert("status_code".into(), json!(v));
            }
            if let Some(v) = &ev.meta.file {
                obj.insert("file".into(), json!(v));
            }
            if let Some(v) = &ev.meta.line {
                obj.insert("line".into(), json!(v));
            }
            if let Some(v) = &ev.meta.target {
                obj.insert("target".into(), json!(v));
            }
            if let Some(v) = &ev.meta.error_chain {
                obj.insert("error_chain".into(), json!(v));
            }
            if obj.is_empty() {
                None
            } else {
                Some(Value::Object(obj))
            }
        });

        // UPSERT group + return current count.
        let group_row = sqlx::query(
            r#"
            INSERT INTO system_event_groups
                (fingerprint, severity, source, message, count, first_seen, last_seen, last_details)
            VALUES ($1, $2, $3, $4, 1, NOW(), NOW(), $5)
            ON CONFLICT (fingerprint) DO UPDATE SET
                count = system_event_groups.count + 1,
                last_seen = NOW(),
                last_details = EXCLUDED.last_details,
                resolved = FALSE,
                resolved_at = NULL,
                resolved_by = NULL
            RETURNING count, last_seen
            "#,
        )
        .bind(&fp)
        .bind(ev.severity.as_str())
        .bind(&ev.source)
        .bind(&ev.message)
        .bind(details_json.clone())
        .fetch_one(&self.db)
        .await?;

        let group_count: i64 = group_row.try_get("count")?;
        let last_seen: DateTime<Utc> = group_row.try_get("last_seen")?;

        // Insert occurrence row — every individual occurrence kept.
        sqlx::query(
            r#"
            INSERT INTO system_event_occurrences
                (fingerprint, severity, source, message, details, origin,
                 user_id, request_path, request_method, status_code, file, line, target, error_chain, occurred_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
            "#,
        )
        .bind(&fp)
        .bind(ev.severity.as_str())
        .bind(&ev.source)
        .bind(&ev.message)
        .bind(details_json.clone())
        .bind(ev.origin.as_str())
        .bind(&ev.meta.user_id)
        .bind(&ev.meta.request_path)
        .bind(&ev.meta.request_method)
        .bind(ev.meta.status_code)
        .bind(&ev.meta.file)
        .bind(ev.meta.line)
        .bind(&ev.meta.target)
        .bind(&ev.meta.error_chain)
        .execute(&self.db)
        .await?;

        // Update hot cache.
        {
            let mut buf = self.cache.write().await;
            if buf.len() >= HOT_CACHE {
                buf.pop_front();
            }
            buf.push_back(RawIngest {
                severity: ev.severity,
                source: ev.source.clone(),
                message: ev.message.clone(),
                origin: ev.origin,
                meta: ev.meta.clone(),
            });
        }

        // Broadcast to connected admins / dashboards.
        let payload = json!({
            "type": "system_event",
            "event": {
                "fingerprint": fp,
                "severity": ev.severity.as_str(),
                "source": ev.source,
                "message": ev.message,
                "origin": ev.origin.as_str(),
                "occurred_at": last_seen.to_rfc3339(),
                "group_count": group_count,
                "user_id": ev.meta.user_id,
                "request_path": ev.meta.request_path,
                "status_code": ev.meta.status_code,
                "file": ev.meta.file,
                "line": ev.meta.line,
                "target": ev.meta.target,
                "error_chain": ev.meta.error_chain,
                "details": details_json,
            }
        });
        self.ws_manager.broadcast_json(&payload).await;

        Ok(())
    }

    // ── Query API ─────────────────────────────────────────────────────

    /// Grouped (deduplicated) error/warning/info view, newest activity first.
    pub async fn list_groups(
        &self,
        min_severity: Option<Severity>,
        only_unresolved: bool,
        limit: i64,
    ) -> sqlx::Result<Vec<GroupRow>> {
        let mut sql = String::from(
            "SELECT fingerprint, severity, source, message, count, first_seen, last_seen, \
             last_details, resolved, resolved_at, resolved_by FROM system_event_groups WHERE 1=1",
        );
        if let Some(sev) = min_severity {
            sql.push_str(match sev {
                Severity::Error => " AND severity = 'error'",
                Severity::Warning => " AND severity IN ('warning','error')",
                Severity::Info => " AND severity IN ('info','warning','error')",
            });
        }
        if only_unresolved {
            sql.push_str(" AND resolved = FALSE");
        }
        sql.push_str(" ORDER BY last_seen DESC LIMIT ");
        sql.push_str(&limit.to_string());

        let rows = sqlx::query(&sql).fetch_all(&self.db).await?;
        Ok(rows
            .into_iter()
            .map(|r| GroupRow {
                fingerprint: r.try_get("fingerprint").unwrap_or_default(),
                severity: r
                    .try_get::<String, _>("severity")
                    .ok()
                    .and_then(|s| Severity::from_str_ci(&s))
                    .unwrap_or(Severity::Info),
                source: r.try_get("source").unwrap_or_default(),
                message: r.try_get("message").unwrap_or_default(),
                count: r.try_get("count").unwrap_or(0),
                first_seen: r.try_get("first_seen").unwrap_or_else(|_| Utc::now()),
                last_seen: r.try_get("last_seen").unwrap_or_else(|_| Utc::now()),
                last_details: r.try_get("last_details").ok(),
                resolved: r.try_get("resolved").unwrap_or(false),
                resolved_at: r.try_get("resolved_at").ok(),
                resolved_by: r.try_get("resolved_by").ok(),
            })
            .collect())
    }

    /// Raw chronological log of all individual occurrences. As requested by
    /// the user, occurrences are **not** deduplicated here — every event is
    /// kept exactly as it happened.
    pub async fn list_occurrences(
        &self,
        min_severity: Option<Severity>,
        fingerprint: Option<&str>,
        origin: Option<Origin>,
        limit: i64,
    ) -> sqlx::Result<Vec<OccurrenceRow>> {
        let mut sql = String::from(
            "SELECT id, fingerprint, severity, source, message, details, origin, user_id, \
             request_path, request_method, status_code, file, line, target, error_chain, occurred_at \
             FROM system_event_occurrences WHERE 1=1",
        );
        if let Some(sev) = min_severity {
            sql.push_str(match sev {
                Severity::Error => " AND severity = 'error'",
                Severity::Warning => " AND severity IN ('warning','error')",
                Severity::Info => " AND severity IN ('info','warning','error')",
            });
        }
        if fingerprint.is_some() {
            sql.push_str(" AND fingerprint = $1");
        }
        if let Some(o) = origin {
            sql.push_str(&format!(" AND origin = '{}'", o.as_str()));
        }
        sql.push_str(" ORDER BY occurred_at DESC LIMIT ");
        sql.push_str(&limit.to_string());

        let mut q = sqlx::query(&sql);
        if let Some(fp) = fingerprint {
            q = q.bind(fp);
        }
        let rows = q.fetch_all(&self.db).await?;
        Ok(rows
            .into_iter()
            .map(|r| OccurrenceRow {
                id: r.try_get("id").unwrap_or(0),
                fingerprint: r.try_get("fingerprint").unwrap_or_default(),
                severity: r
                    .try_get::<String, _>("severity")
                    .ok()
                    .and_then(|s| Severity::from_str_ci(&s))
                    .unwrap_or(Severity::Info),
                source: r.try_get("source").unwrap_or_default(),
                message: r.try_get("message").unwrap_or_default(),
                origin: r
                    .try_get::<String, _>("origin")
                    .ok()
                    .map(|o| match o.as_str() {
                        "frontend" => Origin::Frontend,
                        "tracing" => Origin::Tracing,
                        _ => Origin::Backend,
                    })
                    .unwrap_or(Origin::Backend),
                details: r.try_get("details").ok(),
                user_id: r.try_get("user_id").ok(),
                request_path: r.try_get("request_path").ok(),
                request_method: r.try_get("request_method").ok(),
                status_code: r.try_get("status_code").ok(),
                file: r.try_get("file").ok(),
                line: r.try_get("line").ok(),
                target: r.try_get("target").ok(),
                error_chain: r.try_get("error_chain").ok(),
                occurred_at: r.try_get("occurred_at").unwrap_or_else(|_| Utc::now()),
            })
            .collect())
    }

    /// High-level summary counts for the admin dashboard header.
    pub async fn stats(&self) -> sqlx::Result<Value> {
        let row = sqlx::query(
            r#"
            SELECT
                (SELECT COUNT(*) FROM system_event_groups) AS total_groups,
                (SELECT COUNT(*) FROM system_event_groups WHERE resolved = FALSE) AS unresolved_groups,
                (SELECT COUNT(*) FROM system_event_groups WHERE severity = 'error' AND resolved = FALSE) AS unresolved_errors,
                (SELECT COUNT(*) FROM system_event_groups WHERE severity = 'warning' AND resolved = FALSE) AS unresolved_warnings,
                (SELECT COUNT(*) FROM system_event_occurrences) AS total_occurrences,
                (SELECT COUNT(*) FROM system_event_occurrences WHERE occurred_at > NOW() - INTERVAL '1 hour') AS occurrences_last_hour,
                (SELECT COUNT(*) FROM system_event_occurrences WHERE occurred_at > NOW() - INTERVAL '24 hours') AS occurrences_last_day
            "#,
        )
        .fetch_one(&self.db)
        .await?;

        Ok(json!({
            "total_groups":          row.try_get::<i64, _>("total_groups").unwrap_or(0),
            "unresolved_groups":     row.try_get::<i64, _>("unresolved_groups").unwrap_or(0),
            "unresolved_errors":     row.try_get::<i64, _>("unresolved_errors").unwrap_or(0),
            "unresolved_warnings":   row.try_get::<i64, _>("unresolved_warnings").unwrap_or(0),
            "total_occurrences":     row.try_get::<i64, _>("total_occurrences").unwrap_or(0),
            "occurrences_last_hour": row.try_get::<i64, _>("occurrences_last_hour").unwrap_or(0),
            "occurrences_last_day":  row.try_get::<i64, _>("occurrences_last_day").unwrap_or(0),
            "ingest_drops":          self.drop_counter.load(Ordering::Relaxed),
        }))
    }

    pub async fn mark_resolved(&self, fingerprint: &str, user: &str) -> sqlx::Result<u64> {
        let res = sqlx::query(
            "UPDATE system_event_groups SET resolved = TRUE, resolved_at = NOW(), resolved_by = $2 WHERE fingerprint = $1",
        )
        .bind(fingerprint)
        .bind(user)
        .execute(&self.db)
        .await?;
        Ok(res.rows_affected())
    }

    pub async fn unmark_resolved(&self, fingerprint: &str) -> sqlx::Result<u64> {
        let res = sqlx::query(
            "UPDATE system_event_groups SET resolved = FALSE, resolved_at = NULL, resolved_by = NULL WHERE fingerprint = $1",
        )
        .bind(fingerprint)
        .execute(&self.db)
        .await?;
        Ok(res.rows_affected())
    }

    pub async fn clear_all(&self) -> sqlx::Result<()> {
        sqlx::query(
            "TRUNCATE system_event_occurrences, system_event_groups RESTART IDENTITY CASCADE",
        )
        .execute(&self.db)
        .await?;
        self.cache.write().await.clear();
        Ok(())
    }

    pub async fn delete_group(&self, fingerprint: &str) -> sqlx::Result<u64> {
        let res = sqlx::query("DELETE FROM system_event_groups WHERE fingerprint = $1")
            .bind(fingerprint)
            .execute(&self.db)
            .await?;
        Ok(res.rows_affected())
    }
}

fn fingerprint(severity: Severity, source: &str, message: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(severity.as_str().as_bytes());
    hasher.update(b"|");
    hasher.update(source.as_bytes());
    hasher.update(b"|");
    hasher.update(message.as_bytes());
    let digest = hasher.finalize();
    // 16-char prefix — collision-safe for hundreds of millions of distinct
    // events while staying short enough to use in URLs and UI.
    digest
        .iter()
        .take(8)
        .map(|b| format!("{:02x}", b))
        .collect()
}
