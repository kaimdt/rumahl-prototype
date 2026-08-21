// instant_task_engine.rs – Real-time Instant Task Worker for ORA Assist
//
// Instant Tasks are created by the AI (or directly by the user) when the AI
// realises it cannot answer a question without fresh external data:
//
//   "Wie ist das Wetter heute?" → no live data → [INSTANT_TASK: ...]
//   "Was sind die neusten Nachrichten?" → same
//   "Suche die aktuellen Charts" → same
//
// The engine:
//  1. Polls the DB for pending instant tasks every few seconds.
//  2. Claims a task (atomic FOR UPDATE SKIP LOCKED), marks it "processing".
//  3. Routes to the appropriate tool (search, weather, news, music, generic).
//  4. Uses the main AI provider to synthesise a concise natural-language answer
//     from the raw tool output.
//  5. Persists the result and broadcasts it over a tokio broadcast channel so
//     SSE subscribers in main.rs get the result in real-time.
//
// Latency thresholds
// ──────────────────
// SLOW_PATH_THRESHOLD_SECS  – after this many seconds without a result the
//                             engine broadcasts a "taking_longer" progress event.
//                             The voice front-end uses this to start the slow-path
//                             conversation immediately (instead of waiting for its
//                             own 4 s timer).
//
// DEFERRED_THRESHOLD_SECS   – after this many seconds the task is marked
//                             "deferred" in the DB.  The engine keeps running; on
//                             completion it queues a notification so the result is
//                             delivered even when the SSE listener has gone away.
//
// The broadcast channel carries `InstantTaskResult` messages keyed by task id.

use crate::database::{instant_tasks as db, notifications, DbPool};
use crate::providers::{AIProvider, ChatMessage};
use crate::tools::{ToolExecutor, ToolRequest, ToolType};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{interval, Duration};
use uuid::Uuid;

/// Broadcast capacity – how many buffered results at most.
const BROADCAST_CAP: usize = 128;

/// Poll interval while tasks are waiting.
const POLL_INTERVAL_SECS: u64 = 2;

/// After this many seconds without a result the engine broadcasts a "taking_longer"
/// progress event to the SSE stream (and the voice front-end activates its slow path).
const SLOW_PATH_THRESHOLD_SECS: u64 = 5;

/// After this many seconds the task is marked "deferred" and the front-end is told
/// to close its SSE stream; the result will arrive via the notification queue later.
const DEFERRED_THRESHOLD_SECS: u64 = 60;

// ─── Result type broadcast to SSE subscribers ─────────────────────────────────

/// Unified event type sent over the broadcast channel.
///
/// `event_type` distinguishes intermediate progress signals from final results:
///   - `"taking_longer"` → the task is still running past SLOW_PATH_THRESHOLD_SECS;
///                          `elapsed_secs` is populated; `status` stays "processing".
///   - `"deferred"`      → the task exceeded DEFERRED_THRESHOLD_SECS; the front-end
///                          should close its SSE stream and wait for a notification.
///   - `"completed"`     → the task finished successfully.
///   - `"failed"`        → the task failed; `error` is populated.
#[derive(Debug, Clone)]
pub struct InstantTaskResult {
    pub task_id: Uuid,
    /// One of: "taking_longer" | "deferred" | "completed" | "failed"
    pub event_type: String,
    pub status: String,      // "processing" | "completed" | "failed" | "deferred"
    pub result_text: String, // Human-readable AI answer (empty for progress events)
    pub result_data: serde_json::Value,
    pub error: Option<String>,
    /// Seconds elapsed since the task started (set for "taking_longer" events).
    pub elapsed_secs: Option<u64>,
}

// ─── Engine ───────────────────────────────────────────────────────────────────

pub struct InstantTaskEngine {
    db: DbPool,
    provider: Arc<RwLock<Box<dyn AIProvider>>>,
    tool_executor: Arc<RwLock<ToolExecutor>>,
    tx: broadcast::Sender<InstantTaskResult>,
    running: Arc<RwLock<bool>>,
}

impl InstantTaskEngine {
    /// Create a new engine.  Call `subscribe()` before `start()` to get a
    /// receiver before any results are broadcast.
    pub fn new(
        db: DbPool,
        provider: Arc<RwLock<Box<dyn AIProvider>>>,
        tool_executor: Arc<RwLock<ToolExecutor>>,
    ) -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAP);
        Self {
            db,
            provider,
            tool_executor,
            tx,
            running: Arc::new(RwLock::new(false)),
        }
    }

    /// Subscribe to completion events.  Cheap – just clones the sender to get
    /// a receiver; can be called many times.
    pub fn subscribe(&self) -> broadcast::Receiver<InstantTaskResult> {
        self.tx.subscribe()
    }

    /// Access the sender so SSE handlers can create their own receivers.
    pub fn sender(&self) -> broadcast::Sender<InstantTaskResult> {
        self.tx.clone()
    }

    /// Start the background polling loop.
    pub async fn start(&self) {
        let mut guard = self.running.write().await;
        if *guard {
            return;
        }
        *guard = true;
        drop(guard);

        let db = self.db.clone();
        let provider = self.provider.clone();
        let tool_executor = self.tool_executor.clone();
        let tx = self.tx.clone();
        let running = self.running.clone();

        tokio::spawn(async move {
            tracing::info!(
                "InstantTaskEngine started, polling every {}s",
                POLL_INTERVAL_SECS
            );
            let mut tick = interval(Duration::from_secs(POLL_INTERVAL_SECS));

            loop {
                tick.tick().await;

                if !*running.read().await {
                    tracing::info!("InstantTaskEngine stopped");
                    break;
                }

                // Drain all pending tasks in this tick
                loop {
                    match db::claim_pending(&db).await {
                        Ok(Some(task)) => {
                            let db2 = db.clone();
                            let provider2 = provider.clone();
                            let tool_executor2 = tool_executor.clone();
                            let tx2 = tx.clone();

                            tokio::spawn(async move {
                                process_task(db2, provider2, tool_executor2, tx2, task).await;
                            });
                        }
                        Ok(None) => break, // No more pending tasks
                        Err(e) => {
                            tracing::error!("Failed to claim instant task: {}", e);
                            break;
                        }
                    }
                }
            }
        });
    }

    /// Stop the engine on the next tick.
    pub async fn stop(&self) {
        *self.running.write().await = false;
    }
}

// ─── Task processor ───────────────────────────────────────────────────────────

async fn process_task(
    db: DbPool,
    provider: Arc<RwLock<Box<dyn AIProvider>>>,
    tool_executor: Arc<RwLock<ToolExecutor>>,
    tx: broadcast::Sender<InstantTaskResult>,
    task: db::InstantTask,
) {
    let task_id = task.id;
    let task_ref = Arc::new(task);

    tracing::info!(
        "Processing instant task {} type={} query={:?}",
        task_id,
        task_ref.task_type,
        task_ref.query
    );

    // Kick off the actual tool work in a separate task; communicate via a oneshot channel.
    let (result_tx, result_rx) = tokio::sync::oneshot::channel::<(String, serde_json::Value)>();
    {
        let tool_executor2 = tool_executor.clone();
        let task2 = task_ref.clone();
        tokio::spawn(async move {
            let output = run_tool(&tool_executor2, &task2).await;
            let _ = result_tx.send(output);
        });
    }

    // Race the oneshot against latency thresholds.
    let slow_dur = Duration::from_secs(SLOW_PATH_THRESHOLD_SECS);
    let defer_dur = Duration::from_secs(DEFERRED_THRESHOLD_SECS);
    let slow_deadline = tokio::time::Instant::now() + slow_dur;
    let defer_deadline = tokio::time::Instant::now() + defer_dur;

    tokio::pin!(result_rx);

    // ── Phase 1: fast window (0 … SLOW_PATH_THRESHOLD_SECS) ──────────────────
    let tool_output = match tokio::time::timeout_at(slow_deadline, &mut result_rx).await {
        Ok(Ok(output)) => {
            // Result arrived quickly – deliver normally, no progress signals needed.
            output
        }
        Ok(Err(_)) => {
            // Channel sender dropped without sending – should not happen.
            tracing::warn!("Instant task {} tool channel closed unexpectedly", task_id);
            return;
        }
        Err(_) => {
            // Slow path: emit "taking_longer" signal.
            tracing::info!(
                "Instant task {} exceeded {}s – emitting taking_longer",
                task_id,
                SLOW_PATH_THRESHOLD_SECS
            );
            let _ = tx.send(InstantTaskResult {
                task_id,
                event_type: "taking_longer".to_string(),
                status: "processing".to_string(),
                result_text: String::new(),
                result_data: serde_json::Value::Null,
                error: None,
                elapsed_secs: Some(SLOW_PATH_THRESHOLD_SECS),
            });

            // ── Phase 2: slow window (SLOW … DEFERRED) ───────────────────────
            match tokio::time::timeout_at(defer_deadline, &mut result_rx).await {
                Ok(Ok(output)) => output,
                Ok(Err(_)) => {
                    tracing::warn!("Instant task {} tool channel closed unexpectedly", task_id);
                    return;
                }
                Err(_) => {
                    // Deferred: mark in DB, broadcast deferred event, then keep waiting.
                    tracing::info!(
                        "Instant task {} exceeded {}s – marking deferred",
                        task_id,
                        DEFERRED_THRESHOLD_SECS
                    );
                    let _ = db::mark_deferred(&db, task_id).await;

                    let _ = tx.send(InstantTaskResult {
                        task_id,
                        event_type: "deferred".to_string(),
                        status: "deferred".to_string(),
                        result_text: String::new(),
                        result_data: serde_json::Value::Null,
                        error: None,
                        elapsed_secs: Some(DEFERRED_THRESHOLD_SECS),
                    });

                    // ── Phase 3: wait indefinitely for actual completion ──────
                    match result_rx.await {
                        Ok(output) => output,
                        Err(_) => {
                            tracing::warn!(
                                "Instant task {} tool channel closed (deferred phase)",
                                task_id
                            );
                            return;
                        }
                    }
                }
            }
        }
    };

    // Synthesise a natural-language answer.
    let result_text = synthesise_answer(
        &provider,
        &task_ref.query,
        &task_ref.task_type,
        &tool_output.0,
    )
    .await;

    // Persist result.
    let (final_status, final_event_type, final_error) = if result_text.starts_with("ERROR:") {
        let err_msg = result_text[6..].trim().to_string();
        let _ = db::fail(&db, task_id, &err_msg).await;
        ("failed".to_string(), "failed".to_string(), Some(err_msg))
    } else {
        let _ = db::complete(&db, task_id, &result_text, tool_output.1.clone()).await;
        ("completed".to_string(), "completed".to_string(), None)
    };

    // Broadcast final result.
    let broadcast_result = InstantTaskResult {
        task_id,
        event_type: final_event_type.clone(),
        status: final_status.clone(),
        result_text: if final_event_type == "completed" {
            result_text.clone()
        } else {
            String::new()
        },
        result_data: tool_output.1.clone(),
        error: final_error.clone(),
        elapsed_secs: None,
    };
    let _ = tx.send(broadcast_result);

    tracing::info!(
        "Instant task {} completed (status={})",
        task_id,
        final_status
    );

    // If the task was deferred OR there are no active SSE listeners, queue a
    // notification so the result is delivered when the user is back online.
    let no_listeners = tx.receiver_count() == 0;
    let was_deferred = {
        // Re-read DB status to check if it was marked deferred during execution
        matches!(
            db::get_by_id(&db, task_id).await,
            Ok(Some(ref t)) if t.notify_on_complete || t.status == "deferred"
        )
    };

    if (no_listeners || was_deferred) && final_event_type == "completed" {
        let notification_msg = format!("ORA hat eine Antwort für dich: {}", result_text);
        if let Err(e) = notifications::queue_notification(
            &db,
            None,
            &notification_msg,
            "instant_task_result",
            1,
            None, // deliver immediately
        )
        .await
        {
            tracing::warn!("Failed to queue deferred instant task notification: {}", e);
        } else {
            tracing::info!(
                "Instant task {} result queued as notification (no_listeners={}, was_deferred={})",
                task_id,
                no_listeners,
                was_deferred
            );
        }
    }
}

// ─── Tool routing ─────────────────────────────────────────────────────────────

/// Run the tool that matches the task type.  Returns `(human_text, raw_json)`.
async fn run_tool(
    tool_executor: &Arc<RwLock<ToolExecutor>>,
    task: &db::InstantTask,
) -> (String, serde_json::Value) {
    let executor = tool_executor.read().await;

    match task.task_type.as_str() {
        "search" | "news" | "music" | "weather" | "generic" => {
            // Compose a good search query
            let query = build_search_query(&task.task_type, &task.query, &task.params);

            let req = ToolRequest {
                tool_type: ToolType::Search,
                params: serde_json::json!({"query": query, "max_results": 5}),
            };

            let result = executor.execute(req).await;

            if result.success {
                let summary = summarise_search_results(&result.data);
                (summary, result.data)
            } else {
                let err = result.error.unwrap_or_else(|| "Search failed".into());
                (format!("ERROR: {}", err), serde_json::Value::Null)
            }
        }
        _ => {
            let req = ToolRequest {
                tool_type: ToolType::Search,
                params: serde_json::json!({"query": &task.query, "max_results": 5}),
            };
            let result = executor.execute(req).await;
            if result.success {
                (summarise_search_results(&result.data), result.data)
            } else {
                (
                    format!("ERROR: {}", result.error.unwrap_or_default()),
                    serde_json::Value::Null,
                )
            }
        }
    }
}

/// Build a more targeted search query based on task type.
fn build_search_query(task_type: &str, base_query: &str, params: &serde_json::Value) -> String {
    match task_type {
        "weather" => {
            let location = params
                .get("location")
                .and_then(|v| v.as_str())
                .unwrap_or("aktuell");
            format!("Wetter heute {} {}", location, base_query)
        }
        "news" => format!("aktuelle Nachrichten {}", base_query),
        "music" => format!("neueste Single Musik {} 2024 2025", base_query),
        _ => base_query.to_string(),
    }
}

/// Turn raw DuckDuckGo JSON into a compact text summary for the AI to work with.
fn summarise_search_results(data: &serde_json::Value) -> String {
    let results = match data.get("results").and_then(|r| r.as_array()) {
        Some(arr) => arr,
        None => return String::from("Keine Suchergebnisse verfügbar."),
    };

    let mut out = String::new();
    for (i, r) in results.iter().take(4).enumerate() {
        let title = r.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let snippet = r.get("snippet").and_then(|v| v.as_str()).unwrap_or("");
        if !title.is_empty() {
            out.push_str(&format!(
                "{}. {}: {}\n",
                i + 1,
                title.trim(),
                snippet.trim()
            ));
        }
    }
    if out.is_empty() {
        "Keine Suchergebnisse gefunden.".to_string()
    } else {
        out
    }
}

// ─── AI answer synthesis ──────────────────────────────────────────────────────

/// Ask the AI to turn raw search output into a concise user-facing answer.
async fn synthesise_answer(
    provider: &Arc<RwLock<Box<dyn AIProvider>>>,
    user_query: &str,
    task_type: &str,
    tool_output: &str,
) -> String {
    if tool_output.starts_with("ERROR:") {
        return tool_output.to_string();
    }

    let system = format!(
        "Du bist ORA, ein smarter Heimassistent. Der Nutzer hat folgende Frage gestellt und du \
         hast die folgenden Suchergebnisse erhalten. Fasse die Antwort kurz und präzise auf \
         Deutsch zusammen. Halte dich an die Fakten aus den Suchergebnissen. \
         Aufgabentyp: {task_type}."
    );

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system,
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!(
                "Meine Frage: {}\n\nSuchergebnisse:\n{}\n\nBitte fasse die Antwort zusammen.",
                user_query, tool_output
            ),
        },
    ];

    match provider.read().await.chat(messages, None).await {
        Ok(resp) => resp.message,
        Err(e) => {
            tracing::warn!("AI synthesis failed for instant task: {}", e);
            // Fall back to raw search summary
            tool_output.to_string()
        }
    }
}
