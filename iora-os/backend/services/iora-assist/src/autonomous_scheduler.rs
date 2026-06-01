// Autonomous Scheduler – Time-based and event-triggered agent tasks
// Cron-like scheduling for AI tasks: daily reports, weekly reviews, etc.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc, Timelike, Datelike, Weekday};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::info;

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub schedule: Schedule,
    pub provider: String,
    pub model: String,
    pub enabled: bool,
    pub last_run: Option<DateTime<Utc>>,
    pub next_run: Option<DateTime<Utc>>,
    pub run_count: u32,
    pub success_count: u32,
    pub created_at: DateTime<Utc>,
    /// Notify admin on completion
    pub notify_on_complete: bool,
    /// Maximum runtime in seconds (0 = no limit)
    pub max_runtime_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Schedule {
    /// Run every N minutes
    EveryMinutes(u32),
    /// Run every N hours at specific minute
    EveryHours(u32, u32),
    /// Run at specific time every day
    Daily(u32, u32), // hour, minute
    /// Run on specific days at specific time
    Weekly(Vec<Weekday>, u32, u32), // days, hour, minute
    /// Run on specific day of month
    Monthly(u32, u32, u32), // day_of_month, hour, minute
    /// Cron expression (simplified)
    Cron(String),
    /// Event-triggered (external trigger)
    OnEvent(String),
    /// Run once at specific time
    Once(DateTime<Utc>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRun {
    pub task_id: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub tokens_used: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SchedulerEvent {
    TaskDue { task: ScheduledTask },
    TaskStarted { task_id: String },
    TaskCompleted { task_id: String, run: TaskRun },
    TaskFailed { task_id: String, error: String },
    SchedulerStarted,
    SchedulerStopped,
}

// ─── Scheduler ─────────────────────────────────────────────────────────────

pub struct AutonomousScheduler {
    tasks: RwLock<HashMap<String, ScheduledTask>>,
    run_history: RwLock<Vec<TaskRun>>,
    event_tx: broadcast::Sender<SchedulerEvent>,
    running: RwLock<bool>,
}

impl AutonomousScheduler {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            tasks: RwLock::new(HashMap::new()),
            run_history: RwLock::new(Vec::new()),
            event_tx: tx,
            running: RwLock::new(false),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SchedulerEvent> {
        self.event_tx.subscribe()
    }

    /// Add a scheduled task
    pub fn add_task(&self, mut task: ScheduledTask) -> String {
        let id = task.id.clone();
        task.next_run = self.calculate_next_run(&task.schedule);
        self.tasks.write().insert(id.clone(), task);
        info!("Scheduler: Added task '{}'", id);
        id
    }

    /// Remove a task
    pub fn remove_task(&self, id: &str) {
        self.tasks.write().remove(id);
    }

    /// Enable/disable a task
    pub fn set_enabled(&self, id: &str, enabled: bool) {
        if let Some(task) = self.tasks.write().get_mut(id) {
            task.enabled = enabled;
            if enabled {
                task.next_run = self.calculate_next_run(&task.schedule);
            }
        }
    }

    /// Start the scheduler loop
    pub async fn start(self: Arc<Self>) {
        *self.running.write() = true;
        let _ = self.event_tx.send(SchedulerEvent::SchedulerStarted);
        info!("AutonomousScheduler: Started");

        while *self.running.read() {
            let now = Utc::now();
            let due_tasks: Vec<ScheduledTask> = {
                self.tasks.read()
                    .values()
                    .filter(|t| t.enabled && t.next_run.map_or(false, |nr| nr <= now))
                    .cloned()
                    .collect()
            };

            for mut task in due_tasks {
                info!("Scheduler: Task '{}' is due", task.name);
                let _ = self.event_tx.send(SchedulerEvent::TaskDue { task: task.clone() });

                // Simulate task execution (actual execution handled by agent system)
                task.last_run = Some(now);
                task.next_run = self.calculate_next_run(&task.schedule);
                task.run_count += 1;

                self.tasks.write().insert(task.id.clone(), task);
            }

            tokio::time::sleep(Duration::from_secs(30)).await; // Check every 30s
        }
    }

    /// Stop the scheduler
    pub fn stop(&self) {
        *self.running.write() = false;
        let _ = self.event_tx.send(SchedulerEvent::SchedulerStopped);
        info!("AutonomousScheduler: Stopped");
    }

    /// Record a task run result
    pub fn record_run(&self, task_id: &str, run: TaskRun) {
        if let Some(task) = self.tasks.write().get_mut(task_id) {
            task.last_run = Some(Utc::now());
            if run.success { task.success_count += 1; }
            task.next_run = self.calculate_next_run(&task.schedule);
        }
        self.run_history.write().push(run.clone());

        if run.success {
            let _ = self.event_tx.send(SchedulerEvent::TaskCompleted { task_id: task_id.to_string(), run });
        } else {
            let _ = self.event_tx.send(SchedulerEvent::TaskFailed {
                task_id: task_id.to_string(),
                error: run.error.unwrap_or_default(),
            });
        }
    }

    /// Calculate next run time based on schedule
    fn calculate_next_run(&self, schedule: &Schedule) -> Option<DateTime<Utc>> {
        let now = Utc::now();
        match schedule {
            Schedule::EveryMinutes(m) => Some(now + chrono::Duration::minutes(*m as i64)),
            Schedule::EveryHours(h, m) => {
                let mut next = now + chrono::Duration::hours(*h as i64);
                next = next.with_minute(*m).unwrap_or(next);
                Some(next)
            }
            Schedule::Daily(h, m) => {
                let mut next = now.with_hour(*h)?.with_minute(*m)?;
                if next <= now {
                    next += chrono::Duration::days(1);
                }
                Some(next)
            }
            Schedule::Weekly(days, h, m) => {
                let current_weekday = now.weekday();
                let mut next = now.with_hour(*h)?.with_minute(*m)?;
                for day in days {
                    let days_ahead = (*day as i32 - current_weekday.num_days_from_monday() as i32 + 7) % 7;
                    let candidate = now + chrono::Duration::days(days_ahead as i64);
                    let candidate = candidate.with_hour(*h)?.with_minute(*m)?;
                    if candidate > now {
                        return Some(candidate);
                    }
                }
                next += chrono::Duration::days(7);
                Some(next)
            }
            Schedule::Monthly(dom, h, m) => {
                let mut next = now.with_day(*dom)?.with_hour(*h)?.with_minute(*m)?;
                if next <= now {
                    next = next.with_month(next.month() + 1)?;
                }
                Some(next)
            }
            Schedule::Cron(_expr) => Some(now + chrono::Duration::hours(1)), // Simplified
            Schedule::OnEvent(_) => None, // No automatic next run
            Schedule::Once(dt) => {
                if *dt > now { Some(*dt) } else { None }
            }
        }
    }

    /// Get all scheduled tasks
    pub fn list_tasks(&self) -> Vec<ScheduledTask> {
        self.tasks.read().values().cloned().collect()
    }

    /// Get a task by ID
    pub fn get_task(&self, id: &str) -> Option<ScheduledTask> {
        self.tasks.read().get(id).cloned()
    }

    /// Get run history
    pub fn get_run_history(&self, task_id: Option<&str>, limit: usize) -> Vec<TaskRun> {
        let history = self.run_history.read();
        let filtered: Vec<TaskRun> = match task_id {
            Some(tid) => history.iter().filter(|r| r.task_id == tid).cloned().collect(),
            None => history.iter().cloned().collect(),
        };
        filtered.into_iter().rev().take(limit).collect()
    }

    /// Create default scheduled tasks
    pub fn create_default_tasks(&self) {
        let defaults = vec![
            ScheduledTask {
                id: "daily-code-health".into(),
                name: "Daily Code Health".into(),
                description: "Analyzes yesterday's changes and generates a health report".into(),
                prompt: "Analyze the recent git commits and provide a code health report. Check for: new dependencies, large files, complexity trends, and potential issues.".into(),
                schedule: Schedule::Daily(8, 0),
                provider: "pidev".into(),
                model: "pi-dev".into(),
                enabled: false,
                last_run: None, next_run: None, run_count: 0, success_count: 0,
                created_at: Utc::now(), notify_on_complete: true, max_runtime_secs: 600,
            },
            ScheduledTask {
                id: "weekly-review".into(),
                name: "Weekly Review".into(),
                description: "Summarizes the week's work and suggests next steps".into(),
                prompt: "Review this week's work. Summarize: what was accomplished, what's in progress, what's blocked, and what should be prioritized next week.".into(),
                schedule: Schedule::Weekly(vec![Weekday::Fri], 16, 0),
                provider: "pidev".into(),
                model: "pi-dev".into(),
                enabled: false,
                last_run: None, next_run: None, run_count: 0, success_count: 0,
                created_at: Utc::now(), notify_on_complete: true, max_runtime_secs: 600,
            },
            ScheduledTask {
                id: "security-audit".into(),
                name: "Security Audit".into(),
                description: "Weekly security scan of the codebase".into(),
                prompt: "Scan the codebase for common security issues: hardcoded secrets, SQL injection, XSS, unsafe dependencies, missing input validation. Report findings with severity.".into(),
                schedule: Schedule::Weekly(vec![Weekday::Mon], 9, 0),
                provider: "pidev".into(),
                model: "pi-dev".into(),
                enabled: false,
                last_run: None, next_run: None, run_count: 0, success_count: 0,
                created_at: Utc::now(), notify_on_complete: true, max_runtime_secs: 900,
            },
        ];

        for task in defaults {
            let id = task.id.clone();
            self.add_task(task);
            info!("Scheduler: Created default task '{}'", id);
        }
    }
}
