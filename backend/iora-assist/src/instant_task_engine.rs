// instant_task_engine.rs – Real-time Instant Task Worker for IORA Assist
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
// The broadcast channel carries `InstantTaskResult` messages keyed by task id.

use crate::database::{instant_tasks as db, DbPool};
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

// ─── Result type broadcast to SSE subscribers ─────────────────────────────────

#[derive(Debug, Clone)]
pub struct InstantTaskResult {
    pub task_id: Uuid,
    pub status: String,      // "completed" | "failed"
    pub result_text: String, // Human-readable AI answer
    pub result_data: serde_json::Value,
    pub error: Option<String>,
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
            tracing::info!("InstantTaskEngine started, polling every {}s", POLL_INTERVAL_SECS);
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
    tracing::info!("Processing instant task {} type={} query={:?}", task.id, task.task_type, task.query);

    // 1. Run the appropriate tool
    let (tool_output, raw_data) = run_tool(&tool_executor, &task).await;

    // 2. Synthesise a natural-language answer using the AI provider
    let result_text = synthesise_answer(&provider, &task.query, &task.task_type, &tool_output).await;

    // 3. Persist result
    let broadcast_result = if result_text.starts_with("ERROR:") {
        let _ = db::fail(&db, task.id, &result_text[6..].trim()).await;
        InstantTaskResult {
            task_id: task.id,
            status: "failed".to_string(),
            result_text: String::new(),
            result_data: serde_json::Value::Null,
            error: Some(result_text[6..].trim().to_string()),
        }
    } else {
        let _ = db::complete(&db, task.id, &result_text, raw_data.clone()).await;
        InstantTaskResult {
            task_id: task.id,
            status: "completed".to_string(),
            result_text: result_text.clone(),
            result_data: raw_data,
            error: None,
        }
    };

    // 4. Broadcast (ignore "no receivers" errors)
    let _ = tx.send(broadcast_result);

    tracing::info!("Instant task {} completed (status={})", task.id, broadcast_result_status(&result_text));
}

fn broadcast_result_status(result_text: &str) -> &'static str {
    if result_text.starts_with("ERROR:") { "failed" } else { "completed" }
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
                (format!("ERROR: {}", result.error.unwrap_or_default()), serde_json::Value::Null)
            }
        }
    }
}

/// Build a more targeted search query based on task type.
fn build_search_query(task_type: &str, base_query: &str, params: &serde_json::Value) -> String {
    match task_type {
        "weather" => {
            let location = params.get("location").and_then(|v| v.as_str()).unwrap_or("aktuell");
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
            out.push_str(&format!("{}. {}: {}\n", i + 1, title.trim(), snippet.trim()));
        }
    }
    if out.is_empty() { "Keine Suchergebnisse gefunden.".to_string() } else { out }
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
