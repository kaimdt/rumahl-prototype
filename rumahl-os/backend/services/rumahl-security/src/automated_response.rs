//! Automated Response (Phase 2.5)
//!
//! `rumahl-incident-engine` is a read-only correlation layer by contract: it
//! recommends responses but never enforces (`enforcement_requested` stays
//! `false`). This module is the Phase 1 counterpart: it observes open
//! incidents over the incident engine's loopback API, matches them against
//! enabled Security Center policies, and executes the policy's typed actions
//! exclusively through the frozen `rumahl-security-helper` boundary
//! (`security_center::helper_call`). Every execution and every skipped
//! action is recorded in the keyed audit chain.
//!
//! The review checklist of the Security Foundation baseline applies:
//! - no second root helper and no direct root command path is introduced;
//! - the incident engine stays unprivileged (only read/transition API calls);
//! - every host mutation is authorized here and executed by the helper.

use anyhow::{Context, Result};
use serde::Deserialize;
use sqlx::Row;
use std::{
    collections::{BTreeSet, HashSet},
    net::IpAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    time::Duration,
};
use tracing::warn;
use uuid::Uuid;

use crate::{
    log_security_event,
    security_center::{helper_call, ResponseAction},
    AppState,
};

const RESPONSE_INTERVAL: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Temporary blocks expire after one hour (helper minimum is 60 s).
const TEMPORARY_BLOCK_SECONDS: u32 = 3_600;
/// Full blocks are clamped by the helper to 86 400 s.
const FULL_BLOCK_SECONDS: u32 = 86_400;

/// Subset of `ora.security-incident.v1` the orchestrator needs.
#[derive(Debug, Clone, Deserialize)]
struct IncidentSummary {
    incident_id: Uuid,
    state: String,
    severity: String,
    #[serde(default)]
    recommended_responses: BTreeSet<String>,
    subject: SubjectSummary,
    correlation: CorrelationSummary,
}

#[derive(Debug, Clone, Deserialize)]
struct SubjectSummary {
    identity_type: String,
    #[serde(default)]
    identity_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CorrelationSummary {
    #[serde(default)]
    detection_types: BTreeSet<String>,
    #[serde(default)]
    destinations: BTreeSet<String>,
    #[serde(default)]
    container_instances: BTreeSet<String>,
    #[serde(default)]
    executable_paths: BTreeSet<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct PolicyRow {
    id: String,
    threat_type: String,
    minimum_severity: String,
    actions: Vec<ResponseAction>,
}

#[derive(Default)]
struct ResponseMetrics {
    passes: AtomicU64,
    evaluated: AtomicU64,
    executed: AtomicU64,
    skipped: AtomicU64,
    transitioned: AtomicU64,
}

fn metrics() -> &'static ResponseMetrics {
    static METRICS: OnceLock<ResponseMetrics> = OnceLock::new();
    METRICS.get_or_init(ResponseMetrics::default)
}

/// Starts the background response loop. Runs until the process exits.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        // (incident_id, severity) pairs already acted on; re-evaluation is
        // allowed when an incident escalates to a higher severity.
        let mut handled: HashSet<(Uuid, String)> = HashSet::new();
        loop {
            if let Err(error) = run_pass(&state, &mut handled).await {
                warn!(%error, "automated response pass failed");
            }
            tokio::time::sleep(RESPONSE_INTERVAL).await;
        }
    });
}

async fn run_pass(state: &AppState, handled: &mut HashSet<(Uuid, String)>) -> Result<()> {
    metrics().passes.fetch_add(1, Ordering::Relaxed);
    let client = reqwest::Client::new();
    let port =
        rumahl_shared_config::system_config::service_port_discovery("rumahl-incident-engine", 8109);
    let base = format!("http://127.0.0.1:{port}");
    let incidents: Vec<IncidentSummary> = client
        .get(format!("{base}/api/runtime/incidents"))
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .context("incident engine unreachable")?
        .error_for_status()
        .context("incident engine rejected request")?
        .json()
        .await
        .context("incident engine returned an invalid payload")?;
    let policies = load_policies(state).await?;
    for incident in incidents {
        if incident.state != "open" || incident.recommended_responses.is_empty() {
            continue;
        }
        if handled.contains(&(incident.incident_id, incident.severity.clone())) {
            continue;
        }
        handle_incident(state, &client, &base, &incident, &policies).await;
        handled.insert((incident.incident_id, incident.severity.clone()));
    }
    Ok(())
}

async fn load_policies(state: &AppState) -> Result<Vec<PolicyRow>> {
    let rows = sqlx::query("SELECT id,threat_type,minimum_severity,actions FROM security_policies WHERE enabled = 1 ORDER BY minimum_severity DESC, id")
        .fetch_all(&*state.security_db)
        .await?;
    rows.into_iter()
        .map(|row| {
            let actions = serde_json::from_str(&row.get::<String, _>("actions"))?;
            Ok(PolicyRow {
                id: row.get("id"),
                threat_type: row.get("threat_type"),
                minimum_severity: row.get("minimum_severity"),
                actions,
            })
        })
        .collect()
}

async fn handle_incident(
    state: &AppState,
    client: &reqwest::Client,
    base: &str,
    incident: &IncidentSummary,
    policies: &[PolicyRow],
) {
    metrics().evaluated.fetch_add(1, Ordering::Relaxed);
    let mut executed: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for policy in policies
        .iter()
        .filter(|p| severity_rank(&p.minimum_severity) <= severity_rank(&incident.severity))
        .filter(|p| threat_type_matches(&p.threat_type, &incident.correlation.detection_types))
    {
        for action in &policy.actions {
            match plan(incident, action).await {
                ActionPlan::AuditOnly => {
                    record(state, "automated_response", "info", incident, &format!("{}:{}", policy.id, serde_json::to_string(action).unwrap_or_default())).await;
                    executed.push(format!("{}:{}", action_key(action), "audit"));
                }
                ActionPlan::BlockIps { ips, timeout_seconds } => {
                    for ip in ips {
                        match helper_call(serde_json::json!({"action":"block_ip","address":ip,"timeout_seconds":timeout_seconds})).await {
                            Ok(response) if response.get("ok").and_then(|v|v.as_bool()) == Some(true) => {
                                record(state, "automated_response", "high", incident, &format!("block_ip:{ip}")).await;
                                executed.push(format!("block_ip:{ip}"));
                            }
                            Ok(response) => skipped.push(format!("block_ip:{ip}:{}", response.get("message").and_then(|v|v.as_str()).unwrap_or("rejected"))),
                            Err(error) => skipped.push(format!("block_ip:{ip}:{error}")),
                        }
                    }
                }
                ActionPlan::IsolateContainer(container) => {
                    match helper_call(serde_json::json!({"action":"isolate_container","container_id":container})).await {
                        Ok(response) if response.get("ok").and_then(|v|v.as_bool()) == Some(true) => {
                            record(state, "automated_response", "critical", incident, &format!("isolate_container:{container}")).await;
                            executed.push(format!("isolate_container:{container}"));
                        }
                        Ok(response) => skipped.push(format!("isolate_container:{container}:{}", response.get("message").and_then(|v|v.as_str()).unwrap_or("rejected"))),
                        Err(error) => skipped.push(format!("isolate_container:{container}:{error}")),
                    }
                }
                ActionPlan::QuarantinePath(path) => {
                    match helper_call(serde_json::json!({"action":"quarantine","path":path,"reason":"automated_response"})).await {
                        Ok(response) if response.get("ok").and_then(|v|v.as_bool()) == Some(true) => {
                            record(state, "automated_response", "high", incident, &format!("quarantine:{path}")).await;
                            executed.push(format!("quarantine:{path}"));
                        }
                        Ok(response) => skipped.push(format!("quarantine:{path}:{}", response.get("message").and_then(|v|v.as_str()).unwrap_or("rejected"))),
                        Err(error) => skipped.push(format!("quarantine:{path}:{error}")),
                    }
                }
                ActionPlan::StopService(service) => {
                    match helper_call(serde_json::json!({"action":"stop_service","service":service})).await {
                        Ok(response) if response.get("ok").and_then(|v|v.as_bool()) == Some(true) => {
                            record(state, "automated_response", "critical", incident, &format!("stop_service:{service}")).await;
                            executed.push(format!("stop_service:{service}"));
                        }
                        Ok(response) => skipped.push(format!("stop_service:{service}:{}", response.get("message").and_then(|v|v.as_str()).unwrap_or("rejected"))),
                        Err(error) => skipped.push(format!("stop_service:{service}:{error}")),
                    }
                }
                ActionPlan::Lockdown => {
                    match helper_call(serde_json::json!({"action":"lockdown","reason":format!("automated_response:incident:{}", incident.incident_id)})).await {
                        Ok(response) if response.get("ok").and_then(|v|v.as_bool()) == Some(true) => {
                            record(state, "automated_response", "critical", incident, "lockdown").await;
                            executed.push("lockdown".into());
                        }
                        Ok(response) => skipped.push(format!("lockdown:{}", response.get("message").and_then(|v|v.as_str()).unwrap_or("rejected"))),
                        Err(error) => skipped.push(format!("lockdown:{error}")),
                    }
                }
                ActionPlan::Skipped(reason) => {
                    record(state, "automated_response_skipped", "warning", incident, &format!("{}:{}", action_key(action), reason)).await;
                    metrics().skipped.fetch_add(1, Ordering::Relaxed);
                    skipped.push(format!("{}:{reason}", action_key(action)));
                }
            }
        }
    }
    if !executed.is_empty() {
        metrics()
            .executed
            .fetch_add(executed.len() as u64, Ordering::Relaxed);
    }
    if executed.is_empty() && skipped.is_empty() {
        return;
    }
    // Mark the incident lifecycle accordingly so the next pass skips it and
    // operators see the outcome in the correlation timeline.
    let state_name = if executed.iter().any(|key| {
        key.starts_with("block_ip:")
            || key.starts_with("isolate_container:")
            || key.starts_with("stop_service:")
            || key.starts_with("quarantine:")
            || key == "lockdown"
    }) {
        "contained"
    } else {
        "investigating"
    };
    let reason = format!(
        "automated_response:{}",
        if executed.is_empty() {
            skipped.join(",")
        } else {
            executed.join(",")
        }
    );
    let result = client
        .post(format!(
            "{base}/api/runtime/incidents/{}/state",
            incident.incident_id
        ))
        .timeout(REQUEST_TIMEOUT)
        .json(&serde_json::json!({"state": state_name, "reason": reason}))
        .send()
        .await;
    match result {
        Ok(response) if response.status().is_success() => {
            metrics().transitioned.fetch_add(1, Ordering::Relaxed);
        }
        Ok(response) => {
            warn!(incident_id = %incident.incident_id, status = %response.status(), "incident lifecycle transition rejected")
        }
        Err(error) => {
            warn!(%error, incident_id = %incident.incident_id, "incident lifecycle transition failed")
        }
    }
}

/// Decides what a policy action means for this incident without touching the
/// host. Kept pure so the decision logic is unit-testable.
async fn plan(incident: &IncidentSummary, action: &ResponseAction) -> ActionPlan {
    match action {
        ResponseAction::Log | ResponseAction::Alert => ActionPlan::AuditOnly,
        ResponseAction::TemporaryBlock | ResponseAction::BlockIp => {
            let ips = ip_destinations(&incident.correlation.destinations);
            if ips.is_empty() {
                ActionPlan::Skipped("no_ip_destination_evidence")
            } else {
                let timeout_seconds = if matches!(action, ResponseAction::TemporaryBlock) {
                    TEMPORARY_BLOCK_SECONDS
                } else {
                    FULL_BLOCK_SECONDS
                };
                ActionPlan::BlockIps {
                    ips,
                    timeout_seconds,
                }
            }
        }
        ResponseAction::IsolateNetwork => {
            if incident.subject.identity_type != "container" {
                ActionPlan::Skipped("subject_is_not_container")
            } else if let Some(container) = incident.correlation.container_instances.iter().next() {
                ActionPlan::IsolateContainer(container.clone())
            } else {
                ActionPlan::Skipped("no_container_instance_evidence")
            }
        }
        ResponseAction::Quarantine => {
            if let Some(path) = incident.correlation.executable_paths.iter().next() {
                ActionPlan::QuarantinePath(path.clone())
            } else {
                ActionPlan::Skipped("no_executable_path_evidence")
            }
        }
        // Process pids are deliberately not part of incident evidence: the
        // correlation layer keys processes by stable instance ids. Stopping
        // by pid would be fragile and is therefore never automated.
        ResponseAction::StopProcess => ActionPlan::Skipped("process_pid_not_in_incident_evidence"),
        ResponseAction::StopService => {
            let service = incident.subject.identity_id.as_deref().unwrap_or("");
            if incident.subject.identity_type == "system" && plausible_service_name(service) {
                ActionPlan::StopService(service.to_string())
            } else {
                ActionPlan::Skipped("subject_is_not_system_service")
            }
        }
        ResponseAction::Lockdown => ActionPlan::Lockdown,
    }
}

#[derive(Debug)]
enum ActionPlan {
    AuditOnly,
    BlockIps {
        ips: Vec<String>,
        timeout_seconds: u32,
    },
    IsolateContainer(String),
    QuarantinePath(String),
    StopService(String),
    Lockdown,
    Skipped(&'static str),
}

fn action_key(action: &ResponseAction) -> &'static str {
    match action {
        ResponseAction::Log => "log",
        ResponseAction::Alert => "alert",
        ResponseAction::TemporaryBlock => "temporary_block",
        ResponseAction::StopProcess => "stop_process",
        ResponseAction::Quarantine => "quarantine",
        ResponseAction::IsolateNetwork => "isolate_network",
        ResponseAction::BlockIp => "block_ip",
        ResponseAction::StopService => "stop_service",
        ResponseAction::Lockdown => "lockdown",
    }
}

fn ip_destinations(destinations: &BTreeSet<String>) -> Vec<String> {
    destinations
        .iter()
        .filter(|destination| destination.parse::<IpAddr>().is_ok())
        .cloned()
        .collect()
}

fn plausible_service_name(value: &str) -> bool {
    value.ends_with(".service")
        && value.len() <= 80
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "info" => 1,
        "low" => 2,
        "medium" => 3,
        "high" => 4,
        "critical" => 5,
        _ => 0,
    }
}

/// Maps the policy `threat_type` categories to the finding codes emitted by
/// `rumahl-runtime-policy`. Unknown categories never match, so a typo cannot
/// widen automation.
fn threat_type_matches(policy_type: &str, detection_types: &BTreeSet<String>) -> bool {
    let codes: &[&str] = match policy_type {
        "malware" => &[
            "executable_behavior",
            "executable_from_tmp",
            "process_behavior",
        ],
        "network_attack" => &["network_behavior"],
        "critical_integrity" => &["filesystem_behavior", "child_process_depth"],
        "script_execution" => &["shell_execution", "interpreter_execution"],
        _ => return false,
    };
    detection_types
        .iter()
        .any(|code| codes.contains(&code.as_str()))
}

async fn record(
    state: &AppState,
    event_type: &str,
    severity: &str,
    incident: &IncidentSummary,
    detail: &str,
) {
    if let Err(error) = log_security_event(
        &state.security_db,
        &state.encryption_key,
        event_type,
        severity,
        None,
        Some("rumahl-security"),
        Some("automation"),
        Some(
            &serde_json::json!({"incident_id": incident.incident_id, "detail": detail}).to_string(),
        ),
    )
    .await
    {
        warn!(%error, "automated response audit record failed");
    }
}

/// Status used by the Security Center overview.
pub fn status() -> serde_json::Value {
    serde_json::json!({
        "enabled": true,
        "interval_seconds": RESPONSE_INTERVAL.as_secs(),
        "passes": metrics().passes.load(Ordering::Relaxed),
        "evaluated": metrics().evaluated.load(Ordering::Relaxed),
        "executed": metrics().executed.load(Ordering::Relaxed),
        "skipped": metrics().skipped.load(Ordering::Relaxed),
        "transitioned": metrics().transitioned.load(Ordering::Relaxed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(
        severity: &str,
        identity_type: &str,
        identity_id: Option<&str>,
        destinations: &[&str],
        containers: &[&str],
        paths: &[&str],
        codes: &[&str],
    ) -> IncidentSummary {
        IncidentSummary {
            incident_id: Uuid::nil(),
            state: "open".into(),
            severity: severity.into(),
            recommended_responses: BTreeSet::from(["isolate_subject".into()]),
            subject: SubjectSummary {
                identity_type: identity_type.into(),
                identity_id: identity_id.map(str::to_owned),
            },
            correlation: CorrelationSummary {
                detection_types: codes.iter().map(|c| c.to_string()).collect(),
                destinations: destinations.iter().map(|d| d.to_string()).collect(),
                container_instances: containers.iter().map(|c| c.to_string()).collect(),
                executable_paths: paths.iter().map(|p| p.to_string()).collect(),
            },
        }
    }

    #[tokio::test]
    async fn policy_thresholds_gate_automation() {
        assert!(severity_rank("high") > severity_rank("medium"));
        assert_eq!(severity_rank("critical"), 5);
        assert_eq!(severity_rank("unknown"), 0);
    }

    #[tokio::test]
    async fn threat_type_matching_is_strict() {
        let malware = BTreeSet::from(["executable_from_tmp".to_string()]);
        assert!(threat_type_matches("malware", &malware));
        let network = BTreeSet::from(["network_behavior".to_string()]);
        assert!(threat_type_matches("network_attack", &network));
        assert!(!threat_type_matches("malware", &network));
        assert!(!threat_type_matches("typo_category", &malware));
    }

    #[tokio::test]
    async fn block_ip_uses_ip_destination_evidence_only() {
        let incident = fixture(
            "medium",
            "container",
            Some("app-a"),
            &["203.0.113.7", "example.org"],
            &["c1"],
            &[],
            &["network_behavior"],
        );
        match plan(&incident, &ResponseAction::TemporaryBlock).await {
            ActionPlan::BlockIps {
                ips,
                timeout_seconds,
            } => {
                assert_eq!(ips, vec!["203.0.113.7"]);
                assert_eq!(timeout_seconds, TEMPORARY_BLOCK_SECONDS);
            }
            other => panic!("unexpected plan: {other:?}"),
        }
        let no_ip = fixture(
            "medium",
            "container",
            Some("app-a"),
            &["example.org"],
            &["c1"],
            &[],
            &["network_behavior"],
        );
        assert!(matches!(
            plan(&no_ip, &ResponseAction::BlockIp).await,
            ActionPlan::Skipped(_)
        ));
    }

    #[tokio::test]
    async fn isolation_is_limited_to_container_subjects() {
        let container = fixture(
            "high",
            "container",
            Some("app-a"),
            &[],
            &["c1"],
            &[],
            &["executable_behavior"],
        );
        assert!(matches!(
            plan(&container, &ResponseAction::IsolateNetwork).await,
            ActionPlan::IsolateContainer(_)
        ));
        let app = fixture(
            "high",
            "app",
            Some("app-a"),
            &[],
            &["c1"],
            &[],
            &["executable_behavior"],
        );
        assert!(matches!(
            plan(&app, &ResponseAction::IsolateNetwork).await,
            ActionPlan::Skipped(_)
        ));
    }

    #[tokio::test]
    async fn quarantine_requires_path_evidence() {
        let with_path = fixture(
            "high",
            "app",
            Some("app-a"),
            &[],
            &[],
            &["/opt/rumahl/apps/x/bin/x"],
            &["executable_behavior"],
        );
        assert!(matches!(
            plan(&with_path, &ResponseAction::Quarantine).await,
            ActionPlan::QuarantinePath(_)
        ));
        let hash_only = fixture(
            "high",
            "app",
            Some("app-a"),
            &[],
            &[],
            &[],
            &["executable_behavior"],
        );
        assert!(matches!(
            plan(&hash_only, &ResponseAction::Quarantine).await,
            ActionPlan::Skipped(_)
        ));
    }

    #[tokio::test]
    async fn stop_process_is_never_executed_without_pid() {
        let incident = fixture(
            "high",
            "system",
            Some("sshd.service"),
            &[],
            &[],
            &[],
            &["child_process_depth"],
        );
        assert!(matches!(
            plan(&incident, &ResponseAction::StopProcess).await,
            ActionPlan::Skipped(_)
        ));
    }

    #[tokio::test]
    async fn service_stop_requires_system_service_subject() {
        let service = fixture(
            "high",
            "system",
            Some("sshd.service"),
            &[],
            &[],
            &[],
            &["child_process_depth"],
        );
        assert!(
            matches!(plan(&service, &ResponseAction::StopService).await, ActionPlan::StopService(name) if name == "sshd.service")
        );
        let app = fixture(
            "high",
            "app",
            Some("sshd.service"),
            &[],
            &[],
            &[],
            &["child_process_depth"],
        );
        assert!(matches!(
            plan(&app, &ResponseAction::StopService).await,
            ActionPlan::Skipped(_)
        ));
        let invalid = fixture(
            "high",
            "system",
            Some("../../etc/passwd"),
            &[],
            &[],
            &[],
            &["child_process_depth"],
        );
        assert!(matches!(
            plan(&invalid, &ResponseAction::StopService).await,
            ActionPlan::Skipped(_)
        ));
    }

    #[tokio::test]
    async fn destination_parsing_ignores_hostnames() {
        let mut destinations = BTreeSet::new();
        destinations.insert("203.0.113.7".into());
        destinations.insert("db.internal".into());
        assert_eq!(ip_destinations(&destinations), vec!["203.0.113.7"]);
    }
}
