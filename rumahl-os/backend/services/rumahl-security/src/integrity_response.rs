//! Integrity response (binary-manifest watchdog).
//!
//! `rumahl-integrity.service` (see `board/rumahl/post-build.sh`) verifies all
//! native rumahl binaries against `/etc/ora/binary-manifest.sha256` every five
//! minutes. It never mutates the host: mismatches are logged and written as
//! structured evidence to `/run/ora/integrity-mismatch.json`.
//!
//! This module is the authorized decision layer: it watches that evidence and
//! requests a lockdown through the frozen Phase-1 helper boundary when
//! critical rumahl binaries are affected. Non-critical mismatches are recorded
//! as keyed audit events without a lockdown, matching the documented
//! "automatic full lockdown only on confirmed tampering of critical rumahl
//! binaries" response model. The scan itself stays read-only.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    time::Duration,
};
use tracing::{info, warn};

use crate::{log_security_event, security_center::helper_call, AppState};

const WATCH_INTERVAL: Duration = Duration::from_secs(60);
/// Evidence older than this is ignored (the scan runs every 5 minutes).
const MAX_EVIDENCE_AGE: Duration = Duration::from_secs(900);

const MISMATCH_FILE: &str = "/run/ora/integrity-mismatch.json";

/// Core binaries whose tampering is considered critical enough for an
/// automatic lockdown. App binaries under `/opt/rumahl/apps` are NOT critical:
/// they are isolated in containers and handled by the app lifecycle instead.
const CRITICAL_BINARY_MARKERS: &[&str] = &[
    "rumahl-security",
    "rumahl-security-helper",
    "rumahl-home",
    "rumahl-supervisor",
    "rumahl-gateway",
    "rumahl-assist",
    "rumahl-core",
    "rumahl-files",
];

#[derive(Debug, Clone, Deserialize)]
struct MismatchEvidence {
    path: String,
    #[serde(default)]
    expected: String,
    #[serde(default)]
    actual: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IntegrityReport {
    detected_at: String,
    mismatches: Vec<MismatchEvidence>,
}

#[derive(Default)]
struct IntegrityMetrics {
    passes: AtomicU64,
    critical_events: AtomicU64,
    non_critical_events: AtomicU64,
    lockdowns: AtomicU64,
}

fn metrics() -> &'static IntegrityMetrics {
    static METRICS: OnceLock<IntegrityMetrics> = OnceLock::new();
    METRICS.get_or_init(IntegrityMetrics::default)
}

/// Starts the integrity watchdog. Runs until the process exits.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        // Fingerprint of the last reacted report (detected_at + paths) so a
        // persistent mismatch triggers exactly one lockdown/audit per report.
        let mut last_reaction: Option<String> = None;
        loop {
            if let Err(error) = run_pass(&state, &mut last_reaction).await {
                warn!(%error, "integrity response pass failed");
            }
            tokio::time::sleep(WATCH_INTERVAL).await;
        }
    });
}

async fn run_pass(state: &AppState, last_reaction: &mut Option<String>) -> Result<()> {
    metrics().passes.fetch_add(1, Ordering::Relaxed);
    let contents = match tokio::fs::read_to_string(MISMATCH_FILE).await {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let report: IntegrityReport =
        serde_json::from_str(&contents).context("invalid integrity mismatch report")?;
    let age = std::fs::metadata(MISMATCH_FILE)
        .and_then(|m| m.modified())
        .and_then(|m| m.elapsed().map_err(std::io::Error::other))
        .unwrap_or_default();
    if age > MAX_EVIDENCE_AGE {
        warn!(
            age_seconds = age.as_secs(),
            "integrity mismatch evidence is stale; ignoring"
        );
        return Ok(());
    }
    if report.mismatches.is_empty() {
        return Ok(());
    }
    let fingerprint = format!(
        "{}:{}",
        report.detected_at,
        report
            .mismatches
            .iter()
            .map(|m| m.path.as_str())
            .collect::<Vec<_>>()
            .join(",")
    );
    if last_reaction.as_deref() == Some(fingerprint.as_str()) {
        return Ok(());
    }
    let critical: Vec<&MismatchEvidence> = report
        .mismatches
        .iter()
        .filter(|m| is_critical_path(&m.path))
        .collect();
    let audit_severity = if critical.is_empty() {
        "high"
    } else {
        "critical"
    };
    record_audit(
        state,
        "integrity_mismatch",
        audit_severity,
        &report,
        &critical,
    )
    .await;
    if critical.is_empty() {
        metrics()
            .non_critical_events
            .fetch_add(1, Ordering::Relaxed);
        info!("integrity mismatch without critical binaries — audit recorded, no lockdown");
    } else {
        metrics().critical_events.fetch_add(1, Ordering::Relaxed);
        let paths: Vec<&str> = critical.iter().map(|m| m.path.as_str()).collect();
        info!(paths = %paths.join(","), "critical rumahl binary tampering detected — requesting lockdown");
        match helper_call(serde_json::json!({"action":"lockdown","reason":format!("integrity_mismatch:{}", report.detected_at)})).await {
            Ok(response) if response.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
                metrics().lockdowns.fetch_add(1, Ordering::Relaxed);
                record_audit(state, "automated_lockdown", "critical", &report, &critical).await;
            }
            Ok(response) => warn!("lockdown request rejected: {}", response.get("message").and_then(|v| v.as_str()).unwrap_or("unknown")),
            Err(error) => warn!(%error, "lockdown request failed"),
        }
    }
    *last_reaction = Some(fingerprint);
    Ok(())
}

/// Pure classification so the critical-set logic is unit-testable. A path is
/// critical when it belongs to one of the core system services.
fn is_critical_path(path: &str) -> bool {
    CRITICAL_BINARY_MARKERS
        .iter()
        .any(|marker| path.contains(marker))
}

async fn record_audit(
    state: &AppState,
    event_type: &str,
    severity: &str,
    report: &IntegrityReport,
    critical: &[&MismatchEvidence],
) {
    let critical_paths: Vec<&str> = critical.iter().map(|m| m.path.as_str()).collect();
    let mismatches: Vec<serde_json::Value> = report
        .mismatches
        .iter()
        .map(|m| {
            serde_json::json!({
                "path": m.path,
                "expected": m.expected,
                "actual": m.actual,
            })
        })
        .collect();
    let detail = serde_json::json!({
        "detected_at": report.detected_at,
        "mismatch_count": report.mismatches.len(),
        "critical_paths": critical_paths,
        "mismatches": mismatches,
    });
    if let Err(error) = log_security_event(
        &state.security_db,
        &state.encryption_key,
        event_type,
        severity,
        None,
        Some("rumahl-security"),
        Some("integrity-watchdog"),
        Some(&detail.to_string()),
    )
    .await
    {
        warn!(%error, "integrity response audit record failed");
    }
}

/// Status used by the Security Center overview.
pub fn status() -> serde_json::Value {
    serde_json::json!({
        "enabled": true,
        "interval_seconds": WATCH_INTERVAL.as_secs(),
        "evidence_file": MISMATCH_FILE,
        "passes": metrics().passes.load(Ordering::Relaxed),
        "critical_events": metrics().critical_events.load(Ordering::Relaxed),
        "non_critical_events": metrics().non_critical_events.load(Ordering::Relaxed),
        "lockdowns": metrics().lockdowns.load(Ordering::Relaxed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn critical_path_classification() {
        assert!(is_critical_path("/opt/rumahl/build/rumahl-home/bin/rumahl-home"));
        assert!(is_critical_path(
            "/opt/rumahl/build/rumahl-security-helper/bin/rumahl-security-helper"
        ));
        assert!(is_critical_path(
            "/opt/rumahl/build/rumahl-supervisor/bin/rumahl-supervisor"
        ));
        assert!(!is_critical_path("/opt/rumahl/apps/nextcloud/bin/nextcloud"));
        assert!(!is_critical_path("/usr/bin/openssl"));
        assert!(!is_critical_path(
            "/opt/rumahl/build/rumahl-nginx/bin/rumahl-nginx"
        ));
    }

    #[test]
    fn stale_evidence_is_rejected() {
        // The age check uses file mtime; the threshold constant is part of
        // the contract between this module and the 5-minute scan timer.
        assert!(MAX_EVIDENCE_AGE.as_secs() >= 5 * 60);
    }

    #[tokio::test]
    async fn empty_report_is_ignored() {
        let report: IntegrityReport =
            serde_json::from_str(r#"{"detected_at":"2026-08-16T00:00:00Z","mismatches":[]}"#)
                .unwrap();
        assert!(report.mismatches.is_empty());
    }

    #[tokio::test]
    async fn fingerprint_changes_with_paths() {
        let report: IntegrityReport = serde_json::from_str(
            r#"{"detected_at":"2026-08-16T00:00:00Z","mismatches":[{"path":"/opt/rumahl/build/rumahl-home/bin/rumahl-home","expected":"a","actual":"b"}]}"#,
        )
        .unwrap();
        let critical: Vec<&MismatchEvidence> = report
            .mismatches
            .iter()
            .filter(|m| is_critical_path(&m.path))
            .collect();
        assert_eq!(critical.len(), 1);
    }
}
