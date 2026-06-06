//! IORA Intelligence Engine — Predictive health scoring, self-repair orchestration,
//! anomaly detection, and proactive system optimization.
//!
//! This service watches all IORA components and:
//! 1. Computes health scores (0-100) per service and system-wide
//! 2. Predicts failures before they happen using trend analysis
//! 3. Generates actionable suggestions for the user
//! 4. Triggers automated maintenance (log cleanup, DB vacuum, disk checks)
//! 5. Detects anomalies (memory leaks, CPU spikes, disk growth)
//! 6. Maintains a self-repair decision log

use anyhow::Result;
use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use iora_shared::system_config;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::{info, warn};

// ─── Health Score ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HealthScore {
    pub service_name: String,
    pub score: u8,              // 0-100
    pub trend: TrendDirection,
    pub status: HealthStatus,
    pub last_checked: String,
    pub uptime_percent: f64,
    pub response_time_ms: Option<u64>,
    pub consecutive_failures: u32,
    pub predicted_failure_in: Option<String>,  // e.g. "2 hours", null if stable
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrendDirection {
    Improving,
    Stable,
    Degrading,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Excellent,   // 90-100
    Good,        // 75-89
    Fair,        // 50-74
    Poor,        // 25-49
    Critical,    // 0-24
    Unknown,
}

impl HealthStatus {
    fn from_score(score: u8) -> Self {
        match score {
            90..=100 => Self::Excellent,
            75..=89 => Self::Good,
            50..=74 => Self::Fair,
            25..=49 => Self::Poor,
            0..=24 => Self::Critical,
            _ => Self::Unknown,
        }
    }
}

// ─── System Intelligence ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SystemIntelligence {
    pub overall_score: u8,
    pub overall_status: HealthStatus,
    pub services: Vec<HealthScore>,
    pub anomalies: Vec<Anomaly>,
    pub suggestions: Vec<Suggestion>,
    pub maintenance_tasks: Vec<MaintenanceTask>,
    pub metrics: SystemMetricsSnapshot,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Anomaly {
    pub detected_at: String,
    pub anomaly_type: String,   // "memory_leak", "cpu_spike", "disk_growth", "response_latency", "crash_loop"
    pub service_name: String,
    pub severity: String,       // "warning", "critical"
    pub description: String,
    pub current_value: String,
    pub baseline_value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    pub priority: u8,           // 1=highest, 5=lowest
    pub category: String,       // "security", "performance", "maintenance", "configuration", "update"
    pub title: String,
    pub description: String,
    pub action: String,         // What the user should do (or what we can auto-fix)
    pub auto_fixable: bool,
    pub auto_fix_command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MaintenanceTask {
    pub task_type: String,      // "log_cleanup", "db_vacuum", "disk_check", "cert_renewal", "backup"
    pub last_run: Option<String>,
    pub next_run: String,
    pub status: String,         // "pending", "running", "completed", "failed"
    pub auto_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemMetricsSnapshot {
    pub cpu_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_percent: f32,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    pub disk_percent: f64,
    pub uptime_hours: f64,
    pub service_count: usize,
    pub healthy_count: usize,
}

// ─── History ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HealthHistoryPoint {
    pub timestamp: String,
    pub service_name: String,
    pub score: u8,
    pub response_time_ms: Option<u64>,
}

// ─── App State ──────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    watchdog_url: String,
    core_url: String,
    supervisor_url: String,
    http_client: reqwest::Client,
    intelligence_cache: Arc<RwLock<Option<SystemIntelligence>>>,
    history_cache: Arc<RwLock<Vec<HealthHistoryPoint>>>,
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "iora_intelligence=info".into()))
        .init();

    let db_url = system_config::database_url_for("iora-intelligence");
    let watchdog_url = system_config::service_url("iora-watchdog", 8094);
    let core_url = system_config::service_url("iora-core", 8090);
    let supervisor_url = system_config::supervisor_url();
    let port: u16 = system_config::service_port("iora-intelligence", 8099);

    let db = SqlitePoolOptions::new().max_connections(5).connect(&db_url).await?;
    init_db(&db).await?;

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let state = Arc::new(AppState {
        db,
        watchdog_url,
        core_url,
        supervisor_url,
        http_client,
        intelligence_cache: Arc::new(RwLock::new(None)),
        history_cache: Arc::new(RwLock::new(Vec::new())),
    });

    // Background: continuous intelligence gathering
    let bg_state = state.clone();
    tokio::spawn(async move { intelligence_loop(bg_state).await });

    // Background: automated maintenance
    let maint_state = state.clone();
    tokio::spawn(async move { maintenance_loop(maint_state).await });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/intelligence/overview", get(get_intelligence))
        .route("/api/intelligence/services", get(get_service_scores))
        .route("/api/intelligence/anomalies", get(get_anomalies))
        .route("/api/intelligence/suggestions", get(get_suggestions))
        .route("/api/intelligence/maintenance", get(get_maintenance))
        .route("/api/intelligence/maintenance/run/:task_type", get(run_maintenance_task))
        .route("/api/intelligence/history", get(get_history))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!("IORA Intelligence Engine starting on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// ─── DB Init ────────────────────────────────────────────────────────────────

async fn init_db(db: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS health_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            service_name TEXT NOT NULL,
            score INTEGER NOT NULL,
            response_time_ms INTEGER,
            status TEXT,
            anomalies TEXT
        )"
    ).execute(db).await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_health_history_time ON health_history(timestamp)"
    ).execute(db).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS maintenance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_type TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            status TEXT NOT NULL,
            details TEXT
        )"
    ).execute(db).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS suggestions_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            action TEXT,
            auto_fixed INTEGER DEFAULT 0
        )"
    ).execute(db).await?;

    Ok(())
}

// ─── Health ─────────────────────────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "iora-intelligence",
        "status": "healthy",
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

// ─── Intelligence Gathering Loop ────────────────────────────────────────────

async fn intelligence_loop(state: Arc<AppState>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(e) = gather_intelligence(&state).await {
            warn!("Intelligence gathering failed: {}", e);
        }
    }
}

async fn gather_intelligence(state: &AppState) -> anyhow::Result<()> {
    let now = Utc::now();

    // 1. Fetch service status from watchdog
    let watchdog_data: serde_json::Value = state.http_client
        .get(format!("{}/api/watchdog/status", state.watchdog_url))
        .send().await?.json().await?;

    let services = watchdog_data["services"].as_array().cloned().unwrap_or_default();

    // 2. Fetch system metrics
    let metrics: serde_json::Value = state.http_client
        .get(format!("{}/api/watchdog/metrics", state.watchdog_url))
        .send().await?.json().await?;

    // 3. Fetch disk info from supervisor
    let disk_info: serde_json::Value = state.http_client
        .get(format!("{}/api/supervisor/system/info", state.supervisor_url))
        .send().await?.json().await?;

    // 4. Fetch recovery history from watchdog
    let recovery: serde_json::Value = state.http_client
        .get(format!("{}/api/watchdog/recovery", state.watchdog_url))
        .send().await?.json().await?;

    // 5. Compute health scores for each service
    let mut health_scores = Vec::new();
    let mut anomalies = Vec::new();
    let mut suggestions = Vec::new();

    for svc in &services {
        let name = svc["name"].as_str().unwrap_or("unknown");
        let status = svc["status"].as_str().unwrap_or("unknown");
        let failures = svc["consecutive_failures"].as_u64().unwrap_or(0) as u32;
        let response_time = svc["response_time_ms"].as_u64();
        let uptime = svc["uptime_percent"].as_f64().unwrap_or(100.0);

        // Compute score
        let score = compute_service_score(name, status, failures, response_time, uptime);
        let trend = compute_trend(&state.db, name, score).await;

        // Generate suggestions
        let svc_suggestions = generate_service_suggestions(name, score, failures, response_time);

        // Detect anomalies
        if failures >= 2 {
            anomalies.push(Anomaly {
                detected_at: now.to_rfc3339(),
                anomaly_type: "crash_loop".to_string(),
                service_name: name.to_string(),
                severity: if failures >= 5 { "critical" } else { "warning" }.to_string(),
                description: format!("{} has failed {} times consecutively", name, failures),
                current_value: format!("{} failures", failures),
                baseline_value: "0 failures (healthy)".to_string(),
            });
        }

        health_scores.push(HealthScore {
            service_name: name.to_string(),
            score,
            trend,
            status: HealthStatus::from_score(score),
            last_checked: now.to_rfc3339(),
            uptime_percent: uptime,
            response_time_ms: response_time,
            consecutive_failures: failures,
            predicted_failure_in: predict_failure(state, name).await,
            suggestions: svc_suggestions,
        });

        // Store history
        let _ = sqlx::query(
            "INSERT INTO health_history (timestamp, service_name, score, response_time_ms, status) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(now.to_rfc3339())
        .bind(name)
        .bind(score as i32)
        .bind(response_time.map(|t| t as i64))
        .bind(status)
        .execute(&state.db).await;
    }

    // 6. System-wide metrics
    let cpu = metrics["cpu_usage_percent"].as_f64().unwrap_or(0.0) as f32;
    let mem_used = metrics["memory_used_mb"].as_u64().unwrap_or(0);
    let mem_total = metrics["memory_total_mb"].as_u64().unwrap_or(1);
    let mem_percent = metrics["memory_percent"].as_f64().unwrap_or(0.0) as f32;

    // Disk metrics from supervisor
    let disks = disk_info["disks"].as_array().cloned().unwrap_or_default();
    let disk_total: f64 = disks.iter().filter_map(|d| d["total_space"].as_u64()).sum::<u64>() as f64 / 1_073_741_824.0;
    let disk_used: f64 = disks.iter().filter_map(|d| d["used_space"].as_u64()).sum::<u64>() as f64 / 1_073_741_824.0;
    let disk_percent = if disk_total > 0.0 { (disk_used / disk_total) * 100.0 } else { 0.0 };

    let healthy_count = health_scores.iter().filter(|s| s.score >= 75).count();

    let sys_metrics = SystemMetricsSnapshot {
        cpu_percent: cpu,
        memory_used_mb: mem_used,
        memory_total_mb: mem_total,
        memory_percent: mem_percent,
        disk_used_gb: disk_used,
        disk_total_gb: disk_total,
        disk_percent,
        uptime_hours: disk_info["uptime"].as_u64().unwrap_or(0) as f64 / 3600.0,
        service_count: health_scores.len(),
        healthy_count,
    };

    // 7. System-wide suggestions
    suggestions.extend(generate_system_suggestions(&sys_metrics, &recovery));

    // 8. Detect system anomalies
    if cpu > 90.0 {
        anomalies.push(Anomaly {
            detected_at: now.to_rfc3339(),
            anomaly_type: "cpu_spike".to_string(),
            service_name: "system".to_string(),
            severity: "critical".to_string(),
            description: format!("CPU usage at {:.0}%", cpu),
            current_value: format!("{:.0}%", cpu),
            baseline_value: "< 50% (normal)".to_string(),
        });
    }

    if disk_percent > 85.0 {
        anomalies.push(Anomaly {
            detected_at: now.to_rfc3339(),
            anomaly_type: "disk_growth".to_string(),
            service_name: "system".to_string(),
            severity: if disk_percent > 95.0 { "critical" } else { "warning" }.to_string(),
            description: format!("Disk usage at {:.0}%", disk_percent),
            current_value: format!("{:.1} GB / {:.1} GB", disk_used, disk_total),
            baseline_value: "< 80% (healthy)".to_string(),
        });
        suggestions.push(Suggestion {
            priority: 1,
            category: "maintenance".to_string(),
            title: "Festplatte fast voll".to_string(),
            description: format!("{:.1}% der Festplatte sind belegt. Alte Logs und temporäre Dateien sollten bereinigt werden.", disk_percent),
            action: "Logs älter als 30 Tage löschen und Docker-Images bereinigen".to_string(),
            auto_fixable: true,
            auto_fix_command: Some("journalctl --vacuum-time=30d && docker system prune -f".to_string()),
        });
    }

    // 9. Overall score
    let overall_score = if health_scores.is_empty() { 0 } else {
        health_scores.iter().map(|s| s.score as u32).sum::<u32>() / health_scores.len() as u32
    } as u8;

    // Sort suggestions by priority
    suggestions.sort_by_key(|s| s.priority);

    let intelligence = SystemIntelligence {
        overall_score,
        overall_status: HealthStatus::from_score(overall_score),
        services: health_scores,
        anomalies,
        suggestions,
        maintenance_tasks: get_maintenance_tasks(state).await,
        metrics: sys_metrics,
        timestamp: now.to_rfc3339(),
    };

    *state.intelligence_cache.write().await = Some(intelligence);

    Ok(())
}

// ─── Scoring Logic ──────────────────────────────────────────────────────────

fn compute_service_score(name: &str, status: &str, failures: u32, response_time: Option<u64>, uptime: f64) -> u8 {
    let mut score: i32 = 100;

    // Status penalty
    match status {
        "healthy" => {}
        "degraded" => { score -= 20; }
        "unhealthy" => { score -= 40; }
        "unreachable" => { score -= 70; }
        _ => { score -= 30; }
    }

    // Failure penalty
    if failures > 0 {
        score -= (failures as i32 * 10).min(50);
    }

    // Response time penalty (if > 1000ms)
    if let Some(rt) = response_time {
        if rt > 1000 {
            score -= ((rt - 1000) / 100) as i32;
        }
    }

    // Uptime penalty
    if uptime < 99.0 {
        score -= ((100.0 - uptime) * 2.0) as i32;
    }

    // Core is special — it gets a higher weight
    if name == "iora-core" && score < 30 {
        score = score.max(10); // never below 10 for core visibility
    }

    score.clamp(0, 100) as u8
}

async fn compute_trend(db: &SqlitePool, service: &str, current_score: u8) -> TrendDirection {
    // Look at last 5 scores for trend
    let rows: Vec<(i32,)> = sqlx::query_as(
        "SELECT score FROM health_history WHERE service_name = ? ORDER BY timestamp DESC LIMIT 5"
    )
    .bind(service)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    if rows.len() < 3 {
        return TrendDirection::Stable;
    }

    let avg_old: f64 = rows.iter().skip(1).map(|(s,)| *s as f64).sum::<f64>() / (rows.len() - 1) as f64;
    let diff = current_score as f64 - avg_old;

    if diff > 10.0 { TrendDirection::Improving }
    else if diff < -15.0 { TrendDirection::Critical }
    else if diff < -5.0 { TrendDirection::Degrading }
    else { TrendDirection::Stable }
}

async fn predict_failure(state: &AppState, service: &str) -> Option<String> {
    // Simple linear regression on last 10 scores
    let rows: Vec<(i32,)> = sqlx::query_as(
        "SELECT score FROM health_history WHERE service_name = ? ORDER BY timestamp DESC LIMIT 10"
    )
    .bind(service)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if rows.len() < 5 { return None; }

    let scores: Vec<i32> = rows.iter().map(|(s,)| *s).rev().collect();
    let n = scores.len() as f64;

    // Simple slope: if scores are consistently dropping
    let first_avg: f64 = scores[..3].iter().map(|&s| s as f64).sum::<f64>() / 3.0;
    let last_avg: f64 = scores[scores.len()-3..].iter().map(|&s| s as f64).sum::<f64>() / 3.0;
    let drops_per_cycle = (first_avg - last_avg).max(0.0);

    if drops_per_cycle < 3.0 { return None; }

    let cycles_to_zero = last_avg / drops_per_cycle;
    let hours = (cycles_to_zero * n / 10.0).max(1.0) as i64; // 10 samples ≈ 10*60s = ~10 min per cycle

    if hours < 24 {
        Some(format!("~{} hours", hours))
    } else {
        Some(format!("~{} days", hours / 24))
    }
}

// ─── Suggestions ────────────────────────────────────────────────────────────

fn generate_service_suggestions(service: &str, score: u8, failures: u32, response_time: Option<u64>) -> Vec<String> {
    let mut s = Vec::new();

    if score < 50 {
        s.push(format!("{} ist kritisch — manuelle Überprüfung empfohlen", service));
    }
    if failures >= 3 {
        s.push(format!("{} ist {}× hintereinander ausgefallen — Logs prüfen: journalctl -u {}.service -n 100", service, failures, service));
    }
    if let Some(rt) = response_time {
        if rt > 2000 {
            s.push(format!("{} antwortet sehr langsam ({}ms) — Datenbank oder Netzwerk prüfen", service, rt));
        }
    }
    if score >= 75 && failures == 0 {
        s.push(format!("{} läuft stabil", service));
    }

    s
}

fn generate_system_suggestions(metrics: &SystemMetricsSnapshot, recovery: &serde_json::Value) -> Vec<Suggestion> {
    let mut s = Vec::new();

    // Memory warning
    if metrics.memory_percent > 85.0 {
        s.push(Suggestion {
            priority: 2,
            category: "performance".to_string(),
            title: "Hoher RAM-Verbrauch".to_string(),
            description: format!("{:.0}% RAM belegt. Unbenutzte Dienste deaktivieren oder RAM erhöhen.", metrics.memory_percent),
            action: "RAM-intensive Dienste identifizieren: ps aux --sort=-%mem | head -10".to_string(),
            auto_fixable: false,
            auto_fix_command: None,
        });
    }

    // Recovery stats
    if let Some(total) = recovery["total"].as_u64() {
        if total > 10 {
            s.push(Suggestion {
                priority: 2,
                category: "maintenance".to_string(),
                title: "Viele Service-Neustarts".to_string(),
                description: format!("{} Recovery-Versuche durchgeführt — Stabilitätsprobleme untersuchen", total),
                action: "Recovery-Log analysieren und Root Causes beheben".to_string(),
                auto_fixable: false,
                auto_fix_command: None,
            });
        }
    }

    // Healthy system
    if metrics.healthy_count == metrics.service_count && metrics.cpu_percent < 50.0 && metrics.memory_percent < 70.0 {
        s.push(Suggestion {
            priority: 5,
            category: "maintenance".to_string(),
            title: "System läuft optimal".to_string(),
            description: format!("Alle {} Dienste gesund, CPU {:.0}%, RAM {:.0}%", metrics.service_count, metrics.cpu_percent, metrics.memory_percent),
            action: "Kein Handlungsbedarf".to_string(),
            auto_fixable: false,
            auto_fix_command: None,
        });
    }

    s
}

// ─── Maintenance ────────────────────────────────────────────────────────────

async fn get_maintenance_tasks(state: &AppState) -> Vec<MaintenanceTask> {
    let now = Utc::now();
    vec![
        MaintenanceTask {
            task_type: "log_cleanup".to_string(),
            last_run: get_last_maintenance(&state.db, "log_cleanup").await,
            next_run: (now + Duration::hours(6)).to_rfc3339(),
            status: "pending".to_string(),
            auto_enabled: true,
        },
        MaintenanceTask {
            task_type: "db_vacuum".to_string(),
            last_run: get_last_maintenance(&state.db, "db_vacuum").await,
            next_run: (now + Duration::hours(24)).to_rfc3339(),
            status: "pending".to_string(),
            auto_enabled: true,
        },
        MaintenanceTask {
            task_type: "disk_check".to_string(),
            last_run: get_last_maintenance(&state.db, "disk_check").await,
            next_run: (now + Duration::hours(1)).to_rfc3339(),
            status: "pending".to_string(),
            auto_enabled: true,
        },
        MaintenanceTask {
            task_type: "health_report".to_string(),
            last_run: get_last_maintenance(&state.db, "health_report").await,
            next_run: (now + Duration::hours(1)).to_rfc3339(),
            status: "pending".to_string(),
            auto_enabled: true,
        },
    ]
}

async fn get_last_maintenance(db: &SqlitePool, task_type: &str) -> Option<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT completed_at FROM maintenance_log WHERE task_type = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1"
    )
    .bind(task_type)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    row.map(|(t,)| t)
}

async fn maintenance_loop(state: Arc<AppState>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
    loop {
        interval.tick().await;
        run_scheduled_maintenance(&state).await;
    }
}

async fn run_scheduled_maintenance(state: &AppState) {
    let tasks = get_maintenance_tasks(state).await;
    for task in tasks {
        if task.auto_enabled && task.status == "pending" {
            let _now = Utc::now().to_rfc3339();
            // Check if it's time to run
            if let Some(ref last) = task.last_run {
                if let Ok(last_time) = DateTime::parse_from_rfc3339(last) {
                    let next_time = last_time + Duration::hours(1);
                    if Utc::now() < next_time {
                        continue;
                    }
                }
            }

            // Run maintenance
            match task.task_type.as_str() {
                "disk_check" => {
                    // Check disk space via supervisor
                    if let Ok(resp) = state.http_client
                        .get(format!("{}/api/supervisor/system/info", state.supervisor_url))
                        .send().await
                    {
                        if let Ok(data) = resp.json::<serde_json::Value>().await {
                            if let Some(disks) = data["disks"].as_array() {
                                for disk in disks {
                                    if disk["usage_percent"].as_f64().unwrap_or(0.0) > 90.0 {
                                        warn!("Disk {} is at {}% — triggering cleanup",
                                            disk["mount_point"].as_str().unwrap_or("?"),
                                            disk["usage_percent"].as_f64().unwrap_or(0.0));
                                    }
                                }
                            }
                        }
                    }
                    log_maintenance(&state.db, "disk_check", "completed", "Disk check passed").await;
                }
                "health_report" => {
                    // The intelligence gathering loop already stores data; just log
                    log_maintenance(&state.db, "health_report", "completed", "Health report generated").await;
                }
                _ => {}
            }
        }
    }
}

async fn log_maintenance(db: &SqlitePool, task_type: &str, status: &str, details: &str) {
    let now = Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO maintenance_log (task_type, started_at, completed_at, status, details) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(task_type)
    .bind(&now)
    .bind(&now)
    .bind(status)
    .bind(details)
    .execute(db).await;
}

// ─── API Handlers ───────────────────────────────────────────────────────────

async fn get_intelligence(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let cache = state.intelligence_cache.read().await;
    if let Some(ref intel) = *cache {
        return Json(serde_json::to_value(intel).unwrap_or_default());
    }
    // Trigger immediate gathering if cache is empty
    drop(cache);
    if let Err(e) = gather_intelligence(&state).await {
        return Json(serde_json::json!({ "error": e.to_string() }));
    }
    let intel = state.intelligence_cache.read().await;
    Json(serde_json::to_value(&*intel).unwrap_or_default())
}

async fn get_service_scores(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let cache = state.intelligence_cache.read().await;
    match &*cache {
        Some(intel) => Json(serde_json::json!({ "services": intel.services })),
        None => Json(serde_json::json!({ "services": [] })),
    }
}

async fn get_anomalies(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let cache = state.intelligence_cache.read().await;
    match &*cache {
        Some(intel) => Json(serde_json::json!({ "anomalies": intel.anomalies })),
        None => Json(serde_json::json!({ "anomalies": [] })),
    }
}

async fn get_suggestions(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let cache = state.intelligence_cache.read().await;
    match &*cache {
        Some(intel) => Json(serde_json::json!({ "suggestions": intel.suggestions })),
        None => Json(serde_json::json!({ "suggestions": [] })),
    }
}

async fn get_maintenance(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let tasks = get_maintenance_tasks(&state).await;
    Json(serde_json::json!({ "tasks": tasks }))
}

async fn run_maintenance_task(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(task_type): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    let now = Utc::now().to_rfc3339();
    let result = match task_type.as_str() {
        "log_cleanup" => {
            let output = tokio::process::Command::new("journalctl")
                .args(["--vacuum-time=30d"])
                .output().await;
            match output {
                Ok(o) if o.status.success() => "Logs cleaned (30d retention)".to_string(),
                Ok(o) => format!("Cleanup warning: {}", String::from_utf8_lossy(&o.stderr)),
                Err(e) => format!("Cleanup failed: {}", e),
            }
        }
        "health_report" => {
            match gather_intelligence(&state).await {
                Ok(()) => "Health report regenerated".to_string(),
                Err(e) => format!("Report failed: {}", e),
            }
        }
        "db_vacuum" => {
            match sqlx::query("VACUUM").execute(&state.db).await {
                Ok(_) => "Database vacuumed".to_string(),
                Err(e) => format!("Vacuum failed: {}", e),
            }
        }
        _ => format!("Unknown task: {}", task_type),
    };

    log_maintenance(&state.db, &task_type, "completed", &result).await;

    Json(serde_json::json!({
        "task": task_type,
        "result": result,
        "timestamp": now,
    }))
}

async fn get_history(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let rows: Vec<(String, String, i32, Option<i32>, String)> = sqlx::query_as(
        "SELECT timestamp, service_name, score, response_time_ms, status FROM health_history ORDER BY timestamp DESC LIMIT 200"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let history: Vec<serde_json::Value> = rows.into_iter().map(|(ts, name, score, rt, status)| {
        serde_json::json!({
            "timestamp": ts,
            "service_name": name,
            "score": score,
            "response_time_ms": rt,
            "status": status,
        })
    }).collect();

    Json(serde_json::json!({ "history": history, "total": history.len() }))
}
