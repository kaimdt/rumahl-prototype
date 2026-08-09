//! App-Lifecycle-Helfer: Health-Verifizierung, Reconciliation und Background-Monitor.
//!
//! Ziele:
//! - Nach `docker compose up -d` aktiv prüfen, ob die Container wirklich laufen.
//! - Beim Start von `iora-home` den persistierten Status mit der Docker-Realität abgleichen.
//! - Im Hintergrund regelmäßig den tatsächlichen Container-Status erfassen, abgestürzte
//!   Apps automatisch neu starten (mit exponentiellem Backoff) und den persistierten
//!   Status korrigieren, damit die UI nie eine "running"-Lüge anzeigt.
//!
//! Alle Funktionen sind defensiv: Fehlt Docker (lokaler Dev), wird das toleriert und
//! der lokale Modus beibehalten.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::local_appstore::{InstalledApp, LocalAppStore, LogEntry};

/// Tatsächlicher Zustand der Container einer App (aus `docker compose ps`).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct AppDockerStatus {
    /// Anzahl der Services laut compose.
    pub total: usize,
    /// Wieviele Services aktuell `running` sind.
    pub running: usize,
    /// Wieviele Services in `exited` / `dead` sind.
    pub exited: usize,
    /// Wieviele Services Docker als `unhealthy` meldet (sofern Healthcheck definiert).
    pub unhealthy: usize,
    /// Roh-Statuse, key = Service-Name → State-String.
    pub services: HashMap<String, String>,
}

impl AppDockerStatus {
    pub fn all_running(&self) -> bool {
        self.total > 0 && self.running == self.total && self.unhealthy == 0
    }

    pub fn any_failed(&self) -> bool {
        self.exited > 0 || self.unhealthy > 0
    }
}

#[derive(Debug, Deserialize)]
struct ComposePsRow {
    #[serde(default, alias = "Service", alias = "service")]
    service: String,
    #[serde(default, alias = "State", alias = "state")]
    state: String,
    #[serde(default, alias = "Health", alias = "health")]
    health: String,
}

/// Liefert den realen Container-Status für eine App. Probiert beide Compose-Project-Prefixes
/// (`iora-app-`, `iora-bundle-`), damit Bundles und einfache Apps gleichermaßen funktionieren.
///
/// Liefert `None`, wenn Docker nicht installiert ist.
pub async fn docker_compose_status(app_id: &str) -> Option<AppDockerStatus> {
    if let Some(status) = supervisor_compose_status(app_id).await {
        return Some(status);
    }

    for prefix in ["iora-app-", "iora-bundle-"] {
        let project = format!("{prefix}{app_id}");
        let out = tokio::time::timeout(
            std::time::Duration::from_secs(6),
            Command::new("docker")
                .args(["compose", "-p", &project, "ps", "--all", "--format", "json"])
                .output(),
        )
        .await
        .unwrap_or_else(|_| Ok(std::process::Output {
            status: std::process::Command::new("false").status().unwrap_or(std::process::ExitStatus::default()),
            stdout: Vec::new(),
            stderr: b"timeout".to_vec(),
        }));

        match out {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                let trimmed = stdout.trim();
                if trimmed.is_empty() {
                    continue; // dieses Projekt hat keine Container; nächstes Prefix probieren
                }
                let mut status = AppDockerStatus::default();

                // `docker compose ps --format json` liefert ENTWEDER ein JSON-Array
                // (neue Docker-Versionen) ODER eine Zeile pro Container (ältere).
                let rows: Vec<ComposePsRow> = if trimmed.starts_with('[') {
                    serde_json::from_str(trimmed).unwrap_or_default()
                } else {
                    trimmed
                        .lines()
                        .filter_map(|l| serde_json::from_str::<ComposePsRow>(l.trim()).ok())
                        .collect()
                };

                if rows.is_empty() {
                    continue;
                }

                for row in &rows {
                    let state = row.state.to_lowercase();
                    let health = row.health.to_lowercase();
                    if state == "running" || state == "started" {
                        if health == "unhealthy" {
                            status.unhealthy += 1;
                        } else {
                            status.running += 1;
                        }
                    } else if state == "exited" || state == "dead" || state == "removing" {
                        status.exited += 1;
                    }
                    status
                        .services
                        .insert(row.service.clone(), row.state.clone());
                }
                status.total = rows.len();
                return Some(status);
            }
            Ok(_) => continue, // Projekt nicht gefunden – nächstes Prefix
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
            Err(_) => continue,
        }
    }
    // Docker existiert, aber kein Projekt für diese App vorhanden
    Some(AppDockerStatus::default())
}

async fn supervisor_compose_status(app_id: &str) -> Option<AppDockerStatus> {
    let base = std::env::var("IORA_SUPERVISOR_URL")
        .unwrap_or_else(|_| iora_shared_config::system_config::service_url("iora-supervisor", 8097));
    let url = format!(
        "{}/api/supervisor/compose/status/{}",
        base.trim_end_matches('/'),
        app_id
    );

    let response = match reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return None,
    };

    if response.status().is_success() {
        return response.json::<AppDockerStatus>().await.ok();
    }

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let mut services = HashMap::new();
    services.insert(
        "iora-supervisor".to_string(),
        format!("status endpoint failed ({status}): {text}"),
    );
    Some(AppDockerStatus {
        total: 1,
        running: 0,
        exited: 1,
        unhealthy: 0,
        services,
    })
}

/// Wartet nach einem Start aktiv darauf, dass alle Services tatsächlich laufen.
/// Pollt bis zu `max_wait` Sekunden mit 1-Sekunden-Schritten.
///
/// - `Ok(status)` wenn alle Container laufen
/// - `Err(reason)` wenn Timeout oder ein Container exitet ist
/// - `Ok(default)` wenn Docker nicht verfügbar (lokaler Modus)
pub async fn wait_until_running(
    app_id: &str,
    max_wait_secs: u64,
) -> Result<AppDockerStatus, String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(max_wait_secs);
    loop {
        let status = match docker_compose_status(app_id).await {
            Some(s) => s,
            None => return Ok(AppDockerStatus::default()), // Docker n/a → akzeptieren
        };

        if status.all_running() {
            return Ok(status);
        }

        if status.any_failed() {
            return Err(format!(
                "Container für '{app_id}' sind nicht gesund: {} exited, {} unhealthy. Services: {:?}",
                status.exited, status.unhealthy, status.services
            ));
        }

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "Timeout nach {max_wait_secs}s: nur {}/{} Container laufen. Services: {:?}",
                status.running, status.total, status.services
            ));
        }

        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

/// Beim Start von `iora-home` den persistierten Status mit Docker abgleichen.
/// - Apps, die als `running` markiert sind, aber deren Container nicht laufen,
///   werden NICHT automatisch heruntergesetzt; stattdessen wird ein Restart
///   versucht (siehe Background-Monitor) und der Versuch protokolliert.
/// - Apps, die als `stopped` markiert sind, aber laufende Container haben,
///   werden korrekt als `running` geflaggt (Konsistenz nach Crash von iora-home).
pub async fn reconcile_on_startup(store: Arc<LocalAppStore>) {
    let installed = store.list().await;
    for app in installed {
        if app.system {
            continue;
        }
        let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
        if !needs_docker {
            continue;
        }
        let status = match docker_compose_status(&app.id).await {
            Some(s) => s,
            None => return, // Docker nicht installiert → komplett aussteigen
        };

        let actually_running = status.all_running();
        let persisted_running = app.status == "running";

        match (persisted_running, actually_running) {
            (true, false) => {
                store.append_log(
                    &app.id,
                    LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "WARN".to_string(),
                        message: format!(
                            "Reconcile: App war als 'running' markiert, Docker meldet aber nur {}/{} Services. \
                             Background-Monitor wird Wiederanlauf versuchen.",
                            status.running, status.total
                        ),
                        source: "app-runtime".to_string(),
                    },
                );
            }
            (false, true) => {
                // Persistierten Status korrigieren – ohne start() (das würde events feuern, ist aber ok).
                let _ = store.start(&app.id).await;
                store.append_log(
                    &app.id,
                    LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "INFO".to_string(),
                        message: "Reconcile: laufende Container gefunden, Status auf 'running' korrigiert.".into(),
                        source: "app-runtime".to_string(),
                    },
                );
            }
            _ => {}
        }
    }
}

/// Crash-Buchhaltung pro App: zählt Restarts, um exponentielles Backoff anzuwenden.
#[derive(Debug)]
struct CrashTracker {
    /// Anzahl aufeinanderfolgender Auto-Restarts (wird auf 0 gesetzt, sobald App stabil läuft).
    consecutive_restarts: u32,
    /// Zeitpunkt des nächsten erlaubten Restart-Versuchs.
    next_attempt_at: std::time::Instant,
    /// Gesamt-Crashes seit Start von iora-home (Telemetrie).
    total_crashes: u64,
}

impl Default for CrashTracker {
    fn default() -> Self {
        Self {
            consecutive_restarts: 0,
            next_attempt_at: std::time::Instant::now(),
            total_crashes: 0,
        }
    }
}

/// Hintergrund-Task: pollt alle 30 Sekunden den realen Status aller Apps und macht
/// im Crash-Fall einen Restart mit exponentiellem Backoff (max. 5 Versuche, dann
/// wird der Status auf "stopped" gesetzt und ein Error-Log geschrieben).
pub async fn spawn_health_monitor(store: Arc<LocalAppStore>, base_dir: std::path::PathBuf) {
    let trackers: Arc<RwLock<HashMap<String, CrashTracker>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let interval = Duration::from_secs(30);
    const MAX_CONSECUTIVE_RESTARTS: u32 = 5;

    loop {
        tokio::time::sleep(interval).await;
        let installed = store.list().await;

        for app in installed {
            if app.system {
                continue;
            }
            let needs_docker = app.docker_config.is_some() || app.bundle_config.is_some();
            if !needs_docker {
                continue;
            }

            let status = match docker_compose_status(&app.id).await {
                Some(s) => s,
                None => return, // Docker nicht da → Monitor beenden
            };

            // Self-heal the status: an app whose containers exist must never
            // stay stuck in "installing" (e.g. after VM reboots). Enabled apps
            // with all containers running are reported as "running"; disabled
            // apps that are up are reported as "stopped" (CasaOS semantics).
            if app.status != "running" {
                if status.all_running() {
                    let _ = store
                        .set_status(&app.id, if app.enabled { "running" } else { "stopped" })
                        .await;
                } else if app.status == "installing" && status.total > 0 {
                    let _ = store.set_status(&app.id, "stopped").await;
                }
                let mut t = trackers.write().await;
                t.remove(&app.id); // Tracker reset, falls App manuell gestoppt
                continue;
            }

            if status.all_running() {
                // Stabil – Crash-Counter zurücksetzen
                let mut t = trackers.write().await;
                if let Some(tr) = t.get_mut(&app.id) {
                    if tr.consecutive_restarts > 0 {
                        store.append_log(
                            &app.id,
                            LogEntry {
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                level: "INFO".to_string(),
                                message: format!(
                                    "App stabil nach {} Auto-Restart(s).",
                                    tr.consecutive_restarts
                                ),
                                source: "app-runtime".to_string(),
                            },
                        );
                    }
                    tr.consecutive_restarts = 0;
                }
                continue;
            }

            // App ist als running markiert, läuft aber nicht (oder nur teilweise) → Restart erwägen
            let mut t = trackers.write().await;
            let tracker = t.entry(app.id.clone()).or_default();

            if std::time::Instant::now() < tracker.next_attempt_at {
                // Noch im Backoff-Fenster
                continue;
            }

            if tracker.consecutive_restarts >= MAX_CONSECUTIVE_RESTARTS {
                // Aufgeben und Status korrigieren, damit die UI Wahrheit zeigt
                let _ = store.stop(&app.id).await;
                store.append_log(
                    &app.id,
                    LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "ERROR".to_string(),
                        message: format!(
                            "Auto-Restart aufgegeben nach {MAX_CONSECUTIVE_RESTARTS} Versuchen. \
                             Bitte App-Logs prüfen und manuell starten."
                        ),
                        source: "app-runtime".to_string(),
                    },
                );
                tracker.consecutive_restarts = 0;
                continue;
            }

            tracker.consecutive_restarts += 1;
            tracker.total_crashes += 1;
            // Backoff: 5s, 10s, 20s, 40s, 80s
            let backoff_secs = 5u64.saturating_mul(1 << (tracker.consecutive_restarts - 1).min(4));
            tracker.next_attempt_at = std::time::Instant::now() + Duration::from_secs(backoff_secs);
            drop(t);

            store.append_log(
                &app.id,
                LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "WARN".to_string(),
                    message: format!(
                        "Container nicht gesund ({} running / {} total, {} exited, {} unhealthy). \
                         Auto-Restart-Versuch ...",
                        status.running, status.total, status.exited, status.unhealthy
                    ),
                    source: "app-runtime".to_string(),
                },
            );

            let _ = restart_app_inplace(&app, &base_dir, &store).await;
        }
    }
}

/// Direkter Restart aus dem Background-Monitor heraus (umgeht den HTTP-Endpoint).
async fn restart_app_inplace(
    app: &InstalledApp,
    base_dir: &Path,
    store: &Arc<LocalAppStore>,
) -> Result<(), String> {
    // Down (best effort) – probiere beide Project-Prefixes
    for prefix in ["iora-app-", "iora-bundle-"] {
        let _ = Command::new("docker")
            .args(["compose", "-p", &format!("{prefix}{}", app.id), "down"])
            .output()
            .await;
    }

    // Up – nutzt das beim Erst-Start geschriebene compose file
    let compose_dir = base_dir.join(&app.id);
    let compose_path = compose_dir.join("docker-compose.yml");
    if !compose_path.exists() {
        let msg = format!(
            "Compose-File fehlt: {} – kein Auto-Restart möglich.",
            compose_path.display()
        );
        store.append_log(
            &app.id,
            LogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                level: "ERROR".to_string(),
                message: msg.clone(),
                source: "app-runtime".to_string(),
            },
        );
        return Err(msg);
    }

    let project_prefix = "iora-app-";
    let result = Command::new("docker")
        .args([
            "compose",
            "-p",
            &format!("{project_prefix}{}", app.id),
            "up",
            "-d",
        ])
        .current_dir(&compose_dir)
        .output()
        .await;

    match result {
        Ok(o) if o.status.success() => match wait_until_running(&app.id, 15).await {
            Ok(_) => {
                store.append_log(
                    &app.id,
                    LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "INFO".to_string(),
                        message: "Auto-Restart erfolgreich.".into(),
                        source: "app-runtime".to_string(),
                    },
                );
                Ok(())
            }
            Err(e) => {
                store.append_log(
                    &app.id,
                    LogEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        level: "ERROR".to_string(),
                        message: format!("Auto-Restart-Verifizierung fehlgeschlagen: {e}"),
                        source: "app-runtime".to_string(),
                    },
                );
                Err(e)
            }
        },
        Ok(o) => {
            let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
            store.append_log(
                &app.id,
                LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "ERROR".to_string(),
                    message: format!("Auto-Restart fehlgeschlagen: {err}"),
                    source: "app-runtime".to_string(),
                },
            );
            Err(err)
        }
        Err(e) => Err(format!("docker konnte nicht aufgerufen werden: {e}")),
    }
}
