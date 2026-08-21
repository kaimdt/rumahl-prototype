//! Read-only runtime pipeline orchestration (Phase 2 data flow).
//!
//! After normalization, critical runtime events are forwarded to the
//! dedicated Phase-2 services over loopback:
//!
//! ```text
//! normalized event -> rumahl-runtime-identity (resolve)
//!                   -> rumahl-runtime-policy (evaluate)
//!                   -> rumahl-incident-engine (correlate)
//! ```
//!
//! This module is strictly observational: it never mutates the host, never
//! calls the Root Helper, and never touches Docker, nftables or systemd.
//! Every stage is optional — a failure only drops the event from the
//! detection pipeline, never from the emitted event stream.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::warn;
use uuid::Uuid;

use crate::event::{EventClass, NetworkContext, RuntimeEvent};

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

// ─── Identity snapshot (subset of rumahl-runtime-identity) ───────────────────

#[derive(Debug, Clone, Deserialize)]
struct IdentitySnapshot {
    snapshot_id: Uuid,
    identity_type: String,
    identity_id: Option<String>,
    confidence: String,
    state: String,
}

// ─── Policy evaluation (rumahl-runtime-policy contract) ──────────────────────

#[derive(Debug, Serialize)]
struct IdentityReference {
    snapshot_id: Uuid,
    identity_type: String,
    identity_id: Option<String>,
    confidence: String,
    state: String,
}

#[derive(Debug, Serialize)]
struct ObservedNetwork {
    direction: String,
    protocol: String,
    port: u16,
    destination: Option<String>,
}

#[derive(Debug, Serialize)]
struct RuntimeBehavior {
    runtime_event_id: Uuid,
    process_instance_id: String,
    exec_generation: u32,
    process_name: Option<String>,
    executable_path: Option<String>,
    executable_sha256: Option<String>,
    shell_execution: bool,
    interpreter_execution: bool,
    child_process_depth: u16,
    network: Option<ObservedNetwork>,
    filesystem: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct EvaluationRequest {
    identity: IdentityReference,
    subject_id: String,
    behavior: RuntimeBehavior,
}

#[derive(Debug, Clone, Deserialize)]
struct Finding {
    code: String,
    severity: String,
    detail: String,
}

#[derive(Debug, Clone, Deserialize)]
struct DetectionResult {
    schema_version: String,
    detection_id: Uuid,
    runtime_event_id: Uuid,
    identity_snapshot_id: Uuid,
    profile_snapshot_id: Uuid,
    profile_references: Vec<String>,
    evaluated_at: String,
    risk_score: u8,
    findings: Vec<Finding>,
}

// ─── Incident correlation (rumahl-incident-engine contract) ──────────────────

#[derive(Debug, Serialize)]
struct FindingInput {
    code: String,
    severity: String,
    detail: String,
}

#[derive(Debug, Serialize)]
struct DetectionInput {
    schema_version: String,
    detection_id: Uuid,
    runtime_event_id: Uuid,
    identity_snapshot_id: Uuid,
    profile_snapshot_id: Uuid,
    #[serde(default)]
    profile_references: Vec<String>,
    evaluated_at: DateTime<Utc>,
    risk_score: u8,
    findings: Vec<FindingInput>,
}

#[derive(Debug, Serialize)]
struct RuntimeEvidence {
    observed_at: DateTime<Utc>,
    process_instance_id: String,
    parent_process_instance_id: Option<String>,
    exec_generation: u32,
    container_instance_id: Option<String>,
    executable_hash: Option<String>,
    #[serde(default)]
    executable_path: Option<String>,
    socket_cookie: Option<u64>,
    destination: Option<String>,
    summary: String,
}

#[derive(Debug, Serialize)]
struct SubjectEvidence {
    identity_type: String,
    identity_id: Option<String>,
    confidence: String,
    resolution_state: String,
}

#[derive(Debug, Serialize)]
struct CorrelationInput {
    detection: DetectionInput,
    runtime: RuntimeEvidence,
    subject: SubjectEvidence,
    #[serde(default)]
    policy_versions: Vec<String>,
}

// ─── Orchestration ─────────────────────────────────────────────────────────

/// Forwards a normalized critical event through identity -> policy ->
/// incident. Best-effort: every failure is logged and swallowed so the
/// sensor keeps emitting.
pub async fn run(client: &reqwest::Client, event: RuntimeEvent) -> Result<()> {
    let identity_port =
        rumahl_shared_config::system_config::service_port_discovery("rumahl-runtime-identity", 8107);
    let policy_port =
        rumahl_shared_config::system_config::service_port_discovery("rumahl-runtime-policy", 8108);
    let incident_port =
        rumahl_shared_config::system_config::service_port_discovery("rumahl-incident-engine", 8109);

    let snapshot: IdentitySnapshot = post(
        client,
        format!("http://127.0.0.1:{identity_port}/api/runtime/identity/resolve"),
        &event,
    )
    .await?;
    if snapshot.state != "resolved" || snapshot.identity_id.is_none() {
        warn!(
            event_id = %event.event_id,
            state = %snapshot.state,
            "runtime event skipped: identity not resolved"
        );
        return Ok(());
    }

    let request = EvaluationRequest {
        identity: IdentityReference {
            snapshot_id: snapshot.snapshot_id,
            identity_type: snapshot.identity_type.clone(),
            identity_id: snapshot.identity_id.clone(),
            confidence: snapshot.confidence.clone(),
            state: snapshot.state.clone(),
        },
        subject_id: snapshot.identity_id.clone().unwrap_or_default(),
        behavior: RuntimeBehavior {
            runtime_event_id: event.event_id,
            process_instance_id: event.process.process_instance_id.clone(),
            exec_generation: event.process.exec_generation,
            process_name: Some(event.process.command_name.clone()),
            executable_path: event.process.executable.path.clone(),
            executable_sha256: event.process.executable.sha256.clone(),
            shell_execution: is_shell(&event.process.command_name),
            interpreter_execution: is_interpreter(&event.process.command_name),
            child_process_depth: 0,
            network: event.network.as_ref().map(observed_network),
            filesystem: None,
        },
    };
    let detection: DetectionResult = post(
        client,
        format!("http://127.0.0.1:{policy_port}/api/runtime/detections/evaluate"),
        &request,
    )
    .await
    .context("policy evaluation rejected the event")?;

    let container_instance_id = (snapshot.identity_type == "container")
        .then(|| snapshot.identity_id.clone())
        .flatten();
    let input = CorrelationInput {
        detection: DetectionInput {
            schema_version: detection.schema_version,
            detection_id: detection.detection_id,
            runtime_event_id: detection.runtime_event_id,
            identity_snapshot_id: detection.identity_snapshot_id,
            profile_snapshot_id: detection.profile_snapshot_id,
            profile_references: detection.profile_references,
            evaluated_at: DateTime::parse_from_rfc3339(&detection.evaluated_at)
                .map(|value| value.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            risk_score: detection.risk_score,
            findings: detection
                .findings
                .into_iter()
                .map(|finding| FindingInput {
                    code: finding.code,
                    severity: finding.severity,
                    detail: finding.detail,
                })
                .collect(),
        },
        runtime: RuntimeEvidence {
            observed_at: DateTime::parse_from_rfc3339(&event.observed_at)
                .map(|value| value.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            process_instance_id: event.process.process_instance_id.clone(),
            parent_process_instance_id: event.process.parent_process_instance_id.clone(),
            exec_generation: event.process.exec_generation,
            container_instance_id,
            executable_hash: event.process.executable.sha256.clone(),
            executable_path: event.process.executable.path.clone(),
            socket_cookie: event.network.as_ref().map(|network| network.socket_cookie),
            destination: event
                .network
                .as_ref()
                .map(|network| network.remote_address.clone()),
            summary: summarize(&event),
        },
        subject: SubjectEvidence {
            identity_type: snapshot.identity_type,
            identity_id: snapshot.identity_id,
            confidence: snapshot.confidence,
            resolution_state: snapshot.state,
        },
        policy_versions: Vec::new(),
    };
    post::<_, serde_json::Value>(
        client,
        format!("http://127.0.0.1:{incident_port}/api/runtime/incidents/correlate"),
        &input,
    )
    .await
    .context("incident correlation rejected the event")?;
    Ok(())
}

async fn post<T: Serialize, R: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: String,
    body: &T,
) -> Result<R> {
    let response = client
        .post(url)
        .timeout(REQUEST_TIMEOUT)
        .json(body)
        .send()
        .await?
        .error_for_status()
        .context("upstream rejected request")?;
    response.json().await.context("invalid upstream payload")
}

/// Connect attempts are outbound by construction (the tracepoint fires in
/// the connecting process).
fn observed_network(network: &NetworkContext) -> ObservedNetwork {
    ObservedNetwork {
        direction: "outbound".into(),
        protocol: network.protocol.clone(),
        port: network.remote_port,
        destination: Some(network.remote_address.clone()),
    }
}

/// Heuristic: the sensor has no argv visibility, so shells are recognized by
/// process name. This is deliberately conservative (profile rules decide).
fn is_shell(command: &str) -> bool {
    matches!(
        command,
        "sh" | "bash" | "zsh" | "dash" | "fish" | "ksh" | "ash"
    )
}

fn is_interpreter(command: &str) -> bool {
    matches!(
        command,
        "python3" | "python" | "perl" | "ruby" | "node" | "php" | "lua"
    )
}

fn summarize(event: &RuntimeEvent) -> String {
    let class = match event.class {
        EventClass::ProcessStart => "process_start",
        EventClass::ProcessExec => "process_exec",
        EventClass::ProcessExit => "process_exit",
        EventClass::ConnectionAttempt => "connection_attempt",
        EventClass::ConnectionResult => "connection_result",
        EventClass::ExecutableIdentity => "executable_identity",
    };
    format!(
        "{class} pid={} command={}",
        event.process.pid, event.process.command_name
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_and_interpreter_heuristics() {
        assert!(is_shell("bash"));
        assert!(is_shell("sh"));
        assert!(!is_shell("nginx"));
        assert!(is_interpreter("python3"));
        assert!(!is_interpreter("python3.12"));
    }

    #[test]
    fn summary_contains_process_identity() {
        let mut event = RuntimeEvent {
            schema_version: "ora.runtime.v2".into(),
            event_id: Uuid::nil(),
            host_boot_id: Uuid::nil(),
            sensor_instance_id: Uuid::nil(),
            sequence: 1,
            monotonic_ns: 0,
            observed_at: "2026-08-16T00:00:00Z".into(),
            class: EventClass::ProcessStart,
            critical: true,
            process: crate::event::ProcessContext {
                process_instance_id: "p1".into(),
                parent_process_instance_id: None,
                pid: 42,
                ppid: 1,
                process_start_time_ns: 0,
                exec_generation: 1,
                uid: 1000,
                gid: 1000,
                executable: crate::event::ExecutableIdentity {
                    path: None,
                    hash_state: crate::event::HashState::Skipped,
                    sha256: None,
                    reason: None,
                },
                command_name: "bash".into(),
            },
            identity: crate::event::RuntimeIdentity {
                kind: crate::event::IdentityKind::Unknown,
                cgroup_id: 0,
                cgroup_path: None,
                container_id: None,
                app_id: None,
            },
            network: None,
        };
        assert!(summarize(&event).contains("pid=42"));
        event.process.command_name = "bash".into();
        assert!(summarize(&event).contains("command=bash"));
    }
}
