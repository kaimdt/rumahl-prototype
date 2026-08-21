use crate::profile::{Disposition, FilesystemOperation, NetworkDirection, ProfileSnapshot};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const DETECTION_SCHEMA: &str = "ora.runtime-detection.v1";
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityReference {
    pub snapshot_id: Uuid,
    pub identity_type: String,
    pub identity_id: Option<String>,
    pub confidence: String,
    pub state: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeBehavior {
    pub runtime_event_id: Uuid,
    pub process_instance_id: String,
    pub exec_generation: u32,
    pub process_name: Option<String>,
    pub executable_path: Option<String>,
    pub executable_sha256: Option<String>,
    pub shell_execution: bool,
    pub interpreter_execution: bool,
    pub child_process_depth: u16,
    pub network: Option<ObservedNetwork>,
    pub filesystem: Option<ObservedFilesystem>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservedNetwork {
    pub direction: NetworkDirection,
    pub protocol: String,
    pub port: u16,
    pub destination: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservedFilesystem {
    pub operation: FilesystemOperation,
    pub path: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationRequest {
    pub identity: IdentityReference,
    pub subject_id: String,
    pub behavior: RuntimeBehavior,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Info,
    Low,
    Medium,
    Critical,
}
#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub code: String,
    pub disposition: Disposition,
    pub severity: FindingSeverity,
    pub detail: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct DetectionResult {
    pub schema_version: String,
    pub detection_id: Uuid,
    pub runtime_event_id: Uuid,
    pub identity_snapshot_id: Uuid,
    pub profile_snapshot_id: Uuid,
    pub profile_references: Vec<String>,
    pub evaluated_at: String,
    pub risk_score: u8,
    pub findings: Vec<Finding>,
    pub enforcement_requested: bool,
}

pub fn evaluate(request: &EvaluationRequest, profile: &ProfileSnapshot) -> DetectionResult {
    let p = &profile.effective;
    let b = &request.behavior;
    let mut findings = Vec::new();
    if let Some(name) = &b.process_name {
        let rule = p.processes.iter().find(|r| r.name == *name);
        let mut d = rule.map(|r| r.disposition).unwrap_or(Disposition::Unusual);
        if let Some(rule) = rule {
            if !rule.executable_hashes.is_empty()
                && b.executable_sha256
                    .as_ref()
                    .is_none_or(|hash| !rule.executable_hashes.contains(hash))
            {
                d = Disposition::Forbidden;
            }
        }
        push(
            &mut findings,
            "process_behavior",
            d,
            format!("process={name}"),
        );
    }
    if let Some(path) = &b.executable_path {
        let rule = p
            .executables
            .iter()
            .filter(|r| path.starts_with(&r.path_prefix))
            .max_by_key(|r| r.path_prefix.len());
        let mut d = rule.map(|r| r.disposition).unwrap_or(Disposition::Unusual);
        if let Some(rule) = rule {
            if !rule.sha256.is_empty()
                && b.executable_sha256
                    .as_ref()
                    .is_none_or(|hash| !rule.sha256.contains(hash))
            {
                d = Disposition::Forbidden
            }
        }
        push(
            &mut findings,
            "executable_behavior",
            d,
            format!("executable={path}"),
        );
        if path.starts_with("/tmp/") {
            if let Some(d) = p.runtime.executable_from_tmp {
                push(
                    &mut findings,
                    "executable_from_tmp",
                    d,
                    format!("executable={path}"),
                );
            }
        }
    }
    if b.shell_execution {
        push(
            &mut findings,
            "shell_execution",
            p.runtime.shell_execution.unwrap_or(Disposition::Unusual),
            "shell executed".into(),
        )
    }
    if b.interpreter_execution {
        push(
            &mut findings,
            "interpreter_execution",
            p.runtime
                .interpreter_execution
                .unwrap_or(Disposition::Unusual),
            "interpreter executed".into(),
        )
    }
    if p.runtime
        .child_process_depth
        .is_some_and(|limit| b.child_process_depth > limit)
    {
        push(
            &mut findings,
            "child_process_depth",
            Disposition::Forbidden,
            format!("depth={}", b.child_process_depth),
        )
    }
    if let Some(network) = &b.network {
        let d = p
            .network
            .iter()
            .find(|r| {
                r.direction == network.direction
                    && r.protocol.eq_ignore_ascii_case(&network.protocol)
                    && r.port.is_none_or(|port| port == network.port)
                    && r.destination
                        .as_ref()
                        .is_none_or(|destination| network.destination.as_ref() == Some(destination))
            })
            .map(|r| r.disposition)
            .unwrap_or(Disposition::Unusual);
        push(
            &mut findings,
            "network_behavior",
            d,
            format!("{}:{}", network.protocol, network.port),
        );
    }
    if let Some(filesystem) = &b.filesystem {
        let d = p
            .filesystem
            .iter()
            .filter(|r| {
                r.operation == filesystem.operation && filesystem.path.starts_with(&r.path_prefix)
            })
            .max_by_key(|r| r.path_prefix.len())
            .map(|r| r.disposition)
            .unwrap_or(Disposition::Unusual);
        push(
            &mut findings,
            "filesystem_behavior",
            d,
            format!("path={}", filesystem.path),
        );
    }
    let confidence_factor = match (
        request.identity.confidence.as_str(),
        request.identity.state.as_str(),
    ) {
        ("high", "resolved") => 100,
        ("medium", "resolved") => 75,
        ("low", "resolved") => 40,
        _ => 20,
    };
    let base = findings
        .iter()
        .map(|f| weight(&f.disposition))
        .max()
        .unwrap_or(0);
    let risk_score = ((base * confidence_factor) / 100) as u8;
    DetectionResult {
        schema_version: DETECTION_SCHEMA.into(),
        detection_id: Uuid::new_v4(),
        runtime_event_id: b.runtime_event_id,
        identity_snapshot_id: request.identity.snapshot_id,
        profile_snapshot_id: profile.snapshot_id,
        profile_references: profile
            .component_versions
            .iter()
            .map(|r| format!("{}@{}", r.profile_id, r.profile_version))
            .collect(),
        evaluated_at: Utc::now().to_rfc3339(),
        risk_score,
        findings,
        enforcement_requested: false,
    }
}
fn push(findings: &mut Vec<Finding>, code: &str, disposition: Disposition, detail: String) {
    findings.push(Finding {
        code: code.into(),
        severity: severity(disposition),
        disposition,
        detail,
    })
}
fn weight(d: &Disposition) -> u32 {
    match d {
        Disposition::Observed => 0,
        Disposition::Expected => 0,
        Disposition::Allowed => 10,
        Disposition::Unusual => 60,
        Disposition::Forbidden => 100,
    }
}
fn severity(d: Disposition) -> FindingSeverity {
    match d {
        Disposition::Observed | Disposition::Expected => FindingSeverity::Info,
        Disposition::Allowed => FindingSeverity::Low,
        Disposition::Unusual => FindingSeverity::Medium,
        Disposition::Forbidden => FindingSeverity::Critical,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::*;
    fn fixture(confidence: &str, disposition: Disposition) -> (EvaluationRequest, ProfileSnapshot) {
        let effective = SecurityProfile {
            schema_version: PROFILE_SCHEMA.into(),
            profile_id: Uuid::new_v4(),
            profile_version: 3,
            subject_type: "app".into(),
            subject_id: "nextcloud".into(),
            source: ProfileSource::Administrator,
            source_reference: None,
            created_at: Utc::now().to_rfc3339(),
            processes: vec![ProcessRule {
                name: "sh".into(),
                disposition,
                executable_hashes: vec![],
            }],
            executables: vec![],
            network: vec![],
            filesystem: vec![],
            runtime: RuntimeRules {
                shell_execution: Some(disposition),
                ..Default::default()
            },
        };
        let profile = ProfileSnapshot {
            snapshot_id: Uuid::new_v4(),
            subject_id: "nextcloud".into(),
            component_versions: vec![ProfileReference {
                profile_id: effective.profile_id,
                profile_version: 3,
                source: ProfileSource::Administrator,
            }],
            effective,
            resolved_at: Utc::now().to_rfc3339(),
        };
        let request = EvaluationRequest {
            identity: IdentityReference {
                snapshot_id: Uuid::new_v4(),
                identity_type: "app".into(),
                identity_id: Some("nextcloud".into()),
                confidence: confidence.into(),
                state: "resolved".into(),
            },
            subject_id: "nextcloud".into(),
            behavior: RuntimeBehavior {
                runtime_event_id: Uuid::new_v4(),
                process_instance_id: "p".into(),
                exec_generation: 1,
                process_name: Some("sh".into()),
                executable_path: None,
                executable_sha256: None,
                shell_execution: true,
                interpreter_execution: false,
                child_process_depth: 1,
                network: None,
                filesystem: None,
            },
        };
        (request, profile)
    }
    #[test]
    fn forbidden_high_confidence_is_critical() {
        let (r, p) = fixture("high", Disposition::Forbidden);
        let result = evaluate(&r, &p);
        assert_eq!(result.risk_score, 100);
        assert!(result
            .findings
            .iter()
            .any(|f| f.severity == FindingSeverity::Critical));
        assert!(!result.enforcement_requested)
    }
    #[test]
    fn low_confidence_reduces_automation_risk() {
        let (r, p) = fixture("low", Disposition::Forbidden);
        assert_eq!(evaluate(&r, &p).risk_score, 40)
    }
    #[test]
    fn historical_references_are_recorded() {
        let (r, p) = fixture("high", Disposition::Expected);
        assert_eq!(evaluate(&r, &p).profile_references.len(), 1)
    }
}
