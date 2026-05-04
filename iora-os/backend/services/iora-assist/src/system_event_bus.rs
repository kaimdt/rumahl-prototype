// System Event Bus – Unified event stream for all IORA background activity
// Enables the admin to see everything the system does: agent tasks, pi.dev sessions,
// subagent activity, security events, task scheduling, evolution cycles, etc.

use std::sync::Arc;

use serde::Serialize;
use tokio::sync::broadcast;

/// A single system event – lightweight, structured, streamable
#[derive(Debug, Clone, Serialize)]
pub struct SystemEvent {
    /// Unique event ID
    pub id: String,
    /// High-level category: agent, pidev, subagent, security, task, evolution, system, github, acp
    pub category: String,
    /// Sub-category for filtering: task_id, session_id, agent_id, etc.
    pub source: String,
    /// Event type within the category: created, started, completed, failed, output, progress, etc.
    pub event_type: String,
    /// Human-readable summary (one line)
    pub summary: String,
    /// Optional detail (tool output, error message, etc.)
    pub detail: Option<String>,
    /// Severity: info, success, warn, error
    pub severity: String,
    /// Progress percentage (0.0 - 1.0) for progress events
    pub progress: Option<f32>,
    /// ISO 8601 timestamp
    pub timestamp: String,
}

impl SystemEvent {
    pub fn new(category: &str, source: &str, event_type: &str, summary: &str, severity: &str) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            category: category.to_string(),
            source: source.to_string(),
            event_type: event_type.to_string(),
            summary: summary.to_string(),
            detail: None,
            severity: severity.to_string(),
            progress: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn with_detail(mut self, detail: &str) -> Self {
        self.detail = Some(detail.to_string());
        self
    }

    pub fn with_progress(mut self, progress: f32) -> Self {
        self.progress = Some(progress);
        self
    }
}

/// Global system event bus – single broadcast channel for all background activity
pub struct SystemEventBus {
    tx: broadcast::Sender<SystemEvent>,
}

impl SystemEventBus {
    /// Create a new event bus with the given buffer size
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self { tx }
    }

    /// Publish a system event (non-blocking, uses broadcast)
    pub fn publish(&self, event: SystemEvent) {
        let _ = self.tx.send(event);
    }

    /// Subscribe to the event stream – returns a receiver for SSE
    pub fn subscribe(&self) -> broadcast::Receiver<SystemEvent> {
        self.tx.subscribe()
    }

    // ─── Convenience publishers ────────────────────────────────────────────

    /// Agent task event
    pub fn agent_event(&self, task_id: &str, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("agent", task_id, event_type, summary, severity));
    }

    /// Pi.dev session event
    pub fn pidev_event(&self, session_id: &str, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("pidev", session_id, event_type, summary, severity));
    }

    /// Subagent event
    pub fn subagent_event(&self, agent_id: &str, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("subagent", agent_id, event_type, summary, severity));
    }

    /// Security event
    pub fn security_event(&self, source: &str, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("security", source, event_type, summary, severity));
    }

    /// Task scheduling event
    pub fn task_event(&self, task_id: &str, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("task", task_id, event_type, summary, severity));
    }

    /// System-level event (startup, shutdown, health, config changes)
    pub fn system_event(&self, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("system", "iora-assist", event_type, summary, severity));
    }

    /// GitHub operation event
    pub fn github_event(&self, repo: &str, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("github", repo, event_type, summary, severity));
    }

    /// Evolution cycle event
    pub fn evolution_event(&self, event_type: &str, summary: &str, severity: &str) {
        self.publish(SystemEvent::new("evolution", "self-evolution", event_type, summary, severity));
    }

    /// Tool execution output line (from agent, pi.dev, subagent)
    pub fn tool_output(&self, source: &str, tool: &str, output: &str, severity: &str) {
        self.publish(
            SystemEvent::new("tool", source, tool, output, severity)
        );
    }
}
