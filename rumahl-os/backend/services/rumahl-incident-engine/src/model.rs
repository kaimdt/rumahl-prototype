use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use uuid::Uuid;

pub const INCIDENT_SCHEMA: &str = "ora.security-incident.v1";
pub const CORRELATOR_VERSION: &str = "ora.incident-correlator.v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    Unknown,
    Low,
    Medium,
    High,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IncidentState {
    Open,
    Investigating,
    Contained,
    Resolved,
    FalsePositive,
    Suppressed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindingInput {
    pub code: String,
    pub severity: Severity,
    pub detail: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionInput {
    pub schema_version: String,
    pub detection_id: Uuid,
    pub runtime_event_id: Uuid,
    pub identity_snapshot_id: Uuid,
    pub profile_snapshot_id: Uuid,
    #[serde(default)]
    pub profile_references: Vec<String>,
    pub evaluated_at: DateTime<Utc>,
    pub risk_score: u8,
    #[serde(default)]
    pub findings: Vec<FindingInput>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEvidence {
    pub observed_at: DateTime<Utc>,
    pub process_instance_id: String,
    pub parent_process_instance_id: Option<String>,
    pub exec_generation: u32,
    pub container_instance_id: Option<String>,
    pub executable_hash: Option<String>,
    #[serde(default)]
    pub executable_path: Option<String>,
    pub socket_cookie: Option<u64>,
    pub destination: Option<String>,
    pub summary: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubjectEvidence {
    pub identity_type: String,
    pub identity_id: Option<String>,
    pub confidence: Confidence,
    pub resolution_state: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelationInput {
    pub detection: DetectionInput,
    pub runtime: RuntimeEvidence,
    pub subject: SubjectEvidence,
    #[serde(default)]
    pub policy_versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TimelineEntry {
    pub timestamp: DateTime<Utc>,
    pub detection_id: Uuid,
    pub runtime_event_id: Uuid,
    pub summary: String,
    pub occurrence_count: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CorrelationGraph {
    pub process_instances: BTreeSet<String>,
    pub process_generations: BTreeSet<String>,
    pub parent_process_instances: BTreeSet<String>,
    pub container_instances: BTreeSet<String>,
    pub identity_snapshots: BTreeSet<Uuid>,
    pub socket_cookies: BTreeSet<u64>,
    pub executable_hashes: BTreeSet<String>,
    #[serde(default)]
    pub executable_paths: BTreeSet<String>,
    pub destinations: BTreeSet<String>,
    pub detection_types: BTreeSet<String>,
    pub causal_edges: BTreeSet<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncidentRecord {
    pub schema_version: String,
    pub record_id: Uuid,
    pub incident_id: Uuid,
    pub revision: u64,
    pub previous_revision_id: Option<Uuid>,
    pub state: IncidentState,
    pub severity: Severity,
    pub confidence: Confidence,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub subject: SubjectEvidence,
    pub detection_ids: BTreeSet<Uuid>,
    pub runtime_event_ids: BTreeSet<Uuid>,
    pub identity_snapshot_ids: BTreeSet<Uuid>,
    pub profile_snapshot_ids: BTreeSet<Uuid>,
    pub profile_references: BTreeSet<String>,
    pub policy_versions: BTreeSet<String>,
    pub occurrence_count: u64,
    pub timeline: Vec<TimelineEntry>,
    pub correlation: CorrelationGraph,
    pub recommended_responses: BTreeSet<String>,
    pub response_state: String,
    pub correlator_version: String,
    pub enforcement_requested: bool,
}
#[derive(Debug, Clone, Deserialize)]
pub struct LifecycleRequest {
    pub state: IncidentState,
    pub reason: String,
}
