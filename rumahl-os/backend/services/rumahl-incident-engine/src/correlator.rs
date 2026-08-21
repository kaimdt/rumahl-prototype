use crate::model::*;
use chrono::{Duration, Utc};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const INCIDENT_CAPACITY: usize = 4_096;
pub const REVISION_CAPACITY: usize = 16_384;
pub const TIMELINE_CAPACITY: usize = 2_048;
const TEMPORAL_WINDOW: Duration = Duration::minutes(15);
const STRONG_LINK_WINDOW: Duration = Duration::days(7);

#[derive(Default)]
pub struct Metrics {
    pub correlated: u64,
    pub created: u64,
    pub deduplicated: u64,
    pub evicted: u64,
    pub timeline_dropped: u64,
    pub lifecycle_updates: u64,
}
#[derive(Default)]
pub struct IncidentStore {
    latest: HashMap<Uuid, IncidentRecord>,
    revisions: HashMap<Uuid, IncidentRecord>,
    latest_order: VecDeque<Uuid>,
    revision_order: VecDeque<Uuid>,
    detection_index: HashMap<Uuid, Uuid>,
    journal_path: Option<PathBuf>,
    pub metrics: Metrics,
}

impl IncidentStore {
    pub fn load_journal(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref().to_owned();
        let mut store = Self {
            journal_path: Some(path.clone()),
            ..Self::default()
        };
        let file = match File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(store),
            Err(error) => return Err(format!("incident journal open failed: {error}")),
        };
        for line in BufReader::new(file).lines() {
            let line = line.map_err(|error| format!("incident journal read failed: {error}"))?;
            let incident: IncidentRecord = serde_json::from_str(&line)
                .map_err(|error| format!("incident journal validation failed: {error}"))?;
            store.restore_revision(incident);
        }
        Ok(store)
    }
    pub fn ingest(&mut self, input: CorrelationInput) -> Result<IncidentRecord, String> {
        validate(&input)?;
        if let Some(id) = self
            .detection_index
            .get(&input.detection.detection_id)
            .copied()
        {
            self.metrics.deduplicated += 1;
            return self
                .latest
                .get(&id)
                .cloned()
                .ok_or_else(|| "incident index is inconsistent".into());
        }
        let matched = self.best_match(&input);
        let incident = if let Some(id) = matched {
            self.metrics.correlated += 1;
            let current = self
                .latest
                .get(&id)
                .cloned()
                .ok_or_else(|| "incident disappeared".to_string())?;
            self.extend(current, &input)
        } else {
            self.metrics.created += 1;
            new_incident(&input)
        };
        self.store_revision(incident.clone())?;
        Ok(incident)
    }
    pub fn transition(
        &mut self,
        id: Uuid,
        request: LifecycleRequest,
    ) -> Result<IncidentRecord, String> {
        if request.reason.trim().is_empty() {
            return Err("lifecycle reason is required".into());
        }
        let current = self
            .latest
            .get(&id)
            .cloned()
            .ok_or_else(|| "incident not found".to_string())?;
        if !allowed_transition(current.state, request.state) {
            return Err("invalid incident lifecycle transition".into());
        }
        let mut next = current.clone();
        next.previous_revision_id = Some(current.record_id);
        next.record_id = Uuid::new_v4();
        next.revision += 1;
        next.state = request.state;
        next.response_state = format!("lifecycle:{}:{}", next.revision, request.reason);
        self.metrics.lifecycle_updates += 1;
        self.store_revision(next.clone())?;
        Ok(next)
    }
    pub fn get(&self, id: &Uuid) -> Option<&IncidentRecord> {
        self.latest.get(id)
    }
    pub fn list(&self) -> Vec<IncidentRecord> {
        let mut values: Vec<_> = self.latest.values().cloned().collect();
        values.sort_by_key(|i| std::cmp::Reverse(i.last_seen));
        values
    }
    fn best_match(&self, input: &CorrelationInput) -> Option<Uuid> {
        self.latest
            .values()
            .filter(|i| {
                matches!(
                    i.state,
                    IncidentState::Open | IncidentState::Investigating | IncidentState::Contained
                )
            })
            .filter_map(|i| {
                let age = input
                    .runtime
                    .observed_at
                    .signed_duration_since(i.last_seen)
                    .abs();
                let strong = strong_links(i, input);
                let weak = weak_links(i, input);
                let eligible = (strong > 0 && age <= STRONG_LINK_WINDOW)
                    || (weak >= 2 && age <= TEMPORAL_WINDOW);
                eligible.then_some((
                    i.incident_id,
                    strong * 100 + weak * 10 - (age.num_minutes().unsigned_abs().min(9) as u32),
                ))
            })
            .max_by_key(|(_, score)| *score)
            .map(|(id, _)| id)
    }
    fn extend(&mut self, mut incident: IncidentRecord, input: &CorrelationInput) -> IncidentRecord {
        incident.previous_revision_id = Some(incident.record_id);
        incident.record_id = Uuid::new_v4();
        incident.revision += 1;
        incident.first_seen = incident.first_seen.min(input.runtime.observed_at);
        incident.last_seen = incident.last_seen.max(input.runtime.observed_at);
        incident.severity = incident.severity.max(severity(input));
        incident.confidence = incident.confidence.max(input.subject.confidence);
        incident.occurrence_count += 1;
        incident.detection_ids.insert(input.detection.detection_id);
        incident
            .runtime_event_ids
            .insert(input.detection.runtime_event_id);
        incident
            .identity_snapshot_ids
            .insert(input.detection.identity_snapshot_id);
        incident
            .profile_snapshot_ids
            .insert(input.detection.profile_snapshot_id);
        incident
            .profile_references
            .extend(input.detection.profile_references.iter().cloned());
        incident
            .policy_versions
            .extend(input.policy_versions.iter().cloned());
        merge_graph(&mut incident.correlation, input);
        let key = timeline_key(input);
        if let Some(entry) = incident
            .timeline
            .iter_mut()
            .find(|entry| timeline_entry_key(entry) == key)
        {
            entry.occurrence_count += 1;
            self.metrics.deduplicated += 1
        } else {
            if incident.timeline.len() >= TIMELINE_CAPACITY {
                incident.timeline.remove(0);
                self.metrics.timeline_dropped += 1
            }
            incident.timeline.push(timeline(input));
            incident.timeline.sort_by_key(|e| e.timestamp)
        }
        incident
            .recommended_responses
            .extend(recommendations(input));
        incident
    }
    fn store_revision(&mut self, incident: IncidentRecord) -> Result<(), String> {
        if let Some(path) = &self.journal_path {
            let mut file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|error| format!("incident journal append failed: {error}"))?;
            serde_json::to_writer(&mut file, &incident)
                .map_err(|error| format!("incident journal serialization failed: {error}"))?;
            file.write_all(b"\n")
                .and_then(|_| file.sync_data())
                .map_err(|error| format!("incident journal sync failed: {error}"))?;
        }
        self.restore_revision(incident);
        Ok(())
    }
    fn restore_revision(&mut self, incident: IncidentRecord) {
        for detection in &incident.detection_ids {
            self.detection_index
                .insert(*detection, incident.incident_id);
        }
        let revision_id = incident.record_id;
        while self.revision_order.len() >= REVISION_CAPACITY {
            if let Some(old) = self.revision_order.pop_front() {
                self.revisions.remove(&old);
            }
        }
        self.revision_order.push_back(revision_id);
        self.revisions.insert(revision_id, incident.clone());
        if !self.latest.contains_key(&incident.incident_id) {
            while self.latest_order.len() >= INCIDENT_CAPACITY {
                if let Some(old) = self.latest_order.pop_front() {
                    if let Some(removed) = self.latest.remove(&old) {
                        for detection in removed.detection_ids {
                            self.detection_index.remove(&detection);
                        }
                        self.metrics.evicted += 1
                    }
                }
            }
            self.latest_order.push_back(incident.incident_id)
        }
        self.latest.insert(incident.incident_id, incident);
    }
}
fn validate(i: &CorrelationInput) -> Result<(), String> {
    if i.detection.schema_version != "ora.runtime-detection.v1" {
        return Err("unsupported detection schema".into());
    }
    if i.detection.risk_score > 100 {
        return Err("risk score exceeds 100".into());
    }
    if i.runtime.process_instance_id.trim().is_empty() {
        return Err("process instance is required".into());
    }
    Ok(())
}
fn new_incident(i: &CorrelationInput) -> IncidentRecord {
    let mut graph = CorrelationGraph::default();
    merge_graph(&mut graph, i);
    let severity = severity(i);
    IncidentRecord {
        schema_version: INCIDENT_SCHEMA.into(),
        record_id: Uuid::new_v4(),
        incident_id: Uuid::new_v4(),
        revision: 1,
        previous_revision_id: None,
        state: IncidentState::Open,
        severity,
        confidence: i.subject.confidence,
        title: title(i),
        created_at: Utc::now(),
        first_seen: i.runtime.observed_at,
        last_seen: i.runtime.observed_at,
        subject: i.subject.clone(),
        detection_ids: BTreeSet::from([i.detection.detection_id]),
        runtime_event_ids: BTreeSet::from([i.detection.runtime_event_id]),
        identity_snapshot_ids: BTreeSet::from([i.detection.identity_snapshot_id]),
        profile_snapshot_ids: BTreeSet::from([i.detection.profile_snapshot_id]),
        profile_references: i.detection.profile_references.iter().cloned().collect(),
        policy_versions: i.policy_versions.iter().cloned().collect(),
        occurrence_count: 1,
        timeline: vec![timeline(i)],
        correlation: graph,
        recommended_responses: recommendations(i),
        response_state: "not_requested".into(),
        correlator_version: CORRELATOR_VERSION.into(),
        enforcement_requested: false,
    }
}
fn merge_graph(g: &mut CorrelationGraph, i: &CorrelationInput) {
    g.process_instances
        .insert(i.runtime.process_instance_id.clone());
    g.process_generations.insert(format!(
        "{}@{}",
        i.runtime.process_instance_id, i.runtime.exec_generation
    ));
    g.identity_snapshots
        .insert(i.detection.identity_snapshot_id);
    if let Some(v) = &i.runtime.parent_process_instance_id {
        g.parent_process_instances.insert(v.clone());
        g.process_instances.insert(v.clone());
        g.causal_edges.insert(format!(
            "process:{v}->spawned:process:{}",
            i.runtime.process_instance_id
        ));
    }
    if let Some(v) = &i.runtime.container_instance_id {
        g.container_instances.insert(v.clone());
    }
    if let Some(v) = i.runtime.socket_cookie {
        g.socket_cookies.insert(v);
        g.causal_edges.insert(format!(
            "process:{}->opened:socket:{v}",
            i.runtime.process_instance_id
        ));
    }
    if let Some(v) = &i.runtime.executable_hash {
        g.executable_hashes.insert(v.clone());
        g.causal_edges.insert(format!(
            "process:{}->executed:sha256:{v}",
            i.runtime.process_instance_id
        ));
    }
    if let Some(v) = &i.runtime.executable_path {
        g.executable_paths.insert(v.clone());
        g.causal_edges.insert(format!(
            "process:{}->read:path:{v}",
            i.runtime.process_instance_id
        ));
    }
    if let Some(v) = &i.runtime.destination {
        g.destinations.insert(v.clone());
        g.causal_edges.insert(format!(
            "process:{}->connected:destination:{v}",
            i.runtime.process_instance_id
        ));
    }
    g.detection_types
        .extend(i.detection.findings.iter().map(|f| f.code.clone()));
}
fn strong_links(i: &IncidentRecord, input: &CorrelationInput) -> u32 {
    let r = &input.runtime;
    u32::from(
        i.correlation
            .process_instances
            .contains(&r.process_instance_id),
    ) + u32::from(
        i.correlation
            .process_generations
            .contains(&format!("{}@{}", r.process_instance_id, r.exec_generation)),
    ) + r.parent_process_instance_id.as_ref().map_or(0, |v| {
        u32::from(i.correlation.process_instances.contains(v))
    }) + r
        .socket_cookie
        .map_or(0, |v| u32::from(i.correlation.socket_cookies.contains(&v)))
        + r.executable_hash.as_ref().map_or(0, |v| {
            u32::from(i.correlation.executable_hashes.contains(v))
        })
}
fn weak_links(i: &IncidentRecord, input: &CorrelationInput) -> u32 {
    u32::from(i.subject.identity_id == input.subject.identity_id)
        + u32::from(
            i.correlation
                .identity_snapshots
                .contains(&input.detection.identity_snapshot_id),
        )
        + input.runtime.container_instance_id.as_ref().map_or(0, |v| {
            u32::from(i.correlation.container_instances.contains(v))
        })
        + input
            .runtime
            .destination
            .as_ref()
            .map_or(0, |v| u32::from(i.correlation.destinations.contains(v)))
        + u32::from(
            input
                .detection
                .findings
                .iter()
                .any(|f| i.correlation.detection_types.contains(&f.code)),
        )
}
fn severity(i: &CorrelationInput) -> Severity {
    i.detection
        .findings
        .iter()
        .map(|f| f.severity)
        .max()
        .unwrap_or(match i.detection.risk_score {
            90..=100 => Severity::Critical,
            70..=89 => Severity::High,
            40..=69 => Severity::Medium,
            1..=39 => Severity::Low,
            _ => Severity::Info,
        })
}
fn title(i: &CorrelationInput) -> String {
    let subject = i
        .subject
        .identity_id
        .as_deref()
        .unwrap_or("unknown subject");
    let behavior = i
        .detection
        .findings
        .first()
        .map(|f| f.code.as_str())
        .unwrap_or("runtime anomaly");
    format!("{behavior} detected for {subject}")
}
fn timeline(i: &CorrelationInput) -> TimelineEntry {
    TimelineEntry {
        timestamp: i.runtime.observed_at,
        detection_id: i.detection.detection_id,
        runtime_event_id: i.detection.runtime_event_id,
        summary: i.runtime.summary.clone(),
        occurrence_count: 1,
    }
}
fn timeline_key(i: &CorrelationInput) -> String {
    i.runtime.summary.clone()
}
fn timeline_entry_key(e: &TimelineEntry) -> String {
    e.summary.clone()
}
fn recommendations(i: &CorrelationInput) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    if severity(i) >= Severity::High {
        out.insert("isolate_subject".into());
    }
    if i.runtime.destination.is_some() {
        out.insert("review_remote_destination".into());
    }
    if i.runtime.executable_hash.is_some() {
        out.insert("scan_and_quarantine_executable".into());
    }
    out
}
fn allowed_transition(from: IncidentState, to: IncidentState) -> bool {
    use IncidentState::*;
    matches!(
        (from, to),
        (
            Open,
            Investigating | Contained | Resolved | FalsePositive | Suppressed
        ) | (
            Investigating,
            Contained | Resolved | FalsePositive | Suppressed
        ) | (Contained, Investigating | Resolved | FalsePositive)
            | (Resolved, Investigating)
            | (FalsePositive, Investigating)
            | (Suppressed, Investigating)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    fn input(
        detection: Uuid,
        process: &str,
        parent: Option<&str>,
        destination: Option<&str>,
        minute: i64,
    ) -> CorrelationInput {
        CorrelationInput {
            detection: DetectionInput {
                schema_version: "ora.runtime-detection.v1".into(),
                detection_id: detection,
                runtime_event_id: Uuid::new_v4(),
                identity_snapshot_id: Uuid::new_v4(),
                profile_snapshot_id: Uuid::new_v4(),
                profile_references: vec!["profile@3".into()],
                evaluated_at: Utc.timestamp_opt(1_700_000_000 + minute * 60, 0).unwrap(),
                risk_score: 95,
                findings: vec![FindingInput {
                    code: "shell_execution".into(),
                    severity: Severity::Critical,
                    detail: "shell".into(),
                }],
            },
            runtime: RuntimeEvidence {
                observed_at: Utc.timestamp_opt(1_700_000_000 + minute * 60, 0).unwrap(),
                process_instance_id: process.into(),
                parent_process_instance_id: parent.map(str::to_owned),
                exec_generation: 1,
                container_instance_id: Some("container-a".into()),
                executable_hash: Some("abc".into()),
                executable_path: Some("/opt/rumahl/apps/nextcloud/bin/nextcloud".into()),
                socket_cookie: None,
                destination: destination.map(str::to_owned),
                summary: "suspicious shell activity".into(),
            },
            subject: SubjectEvidence {
                identity_type: "app".into(),
                identity_id: Some("nextcloud".into()),
                confidence: Confidence::Medium,
                resolution_state: "resolved".into(),
            },
            policy_versions: vec!["runtime-policy@7".into()],
        }
    }
    #[test]
    fn causal_process_chain_correlates() {
        let mut store = IncidentStore::default();
        let first = store
            .ingest(input(Uuid::new_v4(), "php", None, None, 0))
            .unwrap();
        let second = store
            .ingest(input(
                Uuid::new_v4(),
                "sh",
                Some("php"),
                Some("185.1.1.1:443"),
                1,
            ))
            .unwrap();
        assert_eq!(first.incident_id, second.incident_id);
        assert_eq!(second.occurrence_count, 2);
        assert_eq!(second.timeline[0].occurrence_count, 2)
    }
    #[test]
    fn repeated_detection_is_idempotent() {
        let mut store = IncidentStore::default();
        let id = Uuid::new_v4();
        let first = store
            .ingest(input(id, "curl", None, Some("1.2.3.4:4444"), 0))
            .unwrap();
        let second = store
            .ingest(input(id, "curl", None, Some("1.2.3.4:4444"), 0))
            .unwrap();
        assert_eq!(first.record_id, second.record_id);
        assert_eq!(second.occurrence_count, 1)
    }
    #[test]
    fn strong_key_correlates_slow_activity() {
        let mut store = IncidentStore::default();
        let first = store
            .ingest(input(Uuid::new_v4(), "curl", None, None, 0))
            .unwrap();
        let second = store
            .ingest(input(Uuid::new_v4(), "curl", None, None, 60))
            .unwrap();
        assert_eq!(first.incident_id, second.incident_id)
    }
    #[test]
    fn unrelated_activity_creates_separate_incident() {
        let mut store = IncidentStore::default();
        let first = store
            .ingest(input(Uuid::new_v4(), "one", None, None, 0))
            .unwrap();
        let mut other = input(Uuid::new_v4(), "two", None, None, 60);
        other.runtime.container_instance_id = Some("container-b".into());
        other.runtime.executable_hash = Some("def".into());
        other.subject.identity_id = Some("immich".into());
        let second = store.ingest(other).unwrap();
        assert_ne!(first.incident_id, second.incident_id)
    }
    #[test]
    fn severity_and_confidence_remain_separate() {
        let mut store = IncidentStore::default();
        let incident = store
            .ingest(input(Uuid::new_v4(), "sh", None, None, 0))
            .unwrap();
        assert_eq!(incident.severity, Severity::Critical);
        assert_eq!(incident.confidence, Confidence::Medium)
    }
    #[test]
    fn false_positive_does_not_change_profiles_or_enforce() {
        let mut store = IncidentStore::default();
        let incident = store
            .ingest(input(Uuid::new_v4(), "sh", None, None, 0))
            .unwrap();
        let next = store
            .transition(
                incident.incident_id,
                LifecycleRequest {
                    state: IncidentState::FalsePositive,
                    reason: "reviewed".into(),
                },
            )
            .unwrap();
        assert_eq!(next.state, IncidentState::FalsePositive);
        assert!(!next.enforcement_requested);
        assert_eq!(next.profile_references, incident.profile_references)
    }
    #[test]
    fn lifecycle_revisions_are_immutable() {
        let mut store = IncidentStore::default();
        let incident = store
            .ingest(input(Uuid::new_v4(), "sh", None, None, 0))
            .unwrap();
        let next = store
            .transition(
                incident.incident_id,
                LifecycleRequest {
                    state: IncidentState::Investigating,
                    reason: "triage".into(),
                },
            )
            .unwrap();
        assert_eq!(next.previous_revision_id, Some(incident.record_id));
        assert_ne!(next.record_id, incident.record_id);
        assert_eq!(next.revision, 2)
    }
    #[test]
    fn append_only_journal_restores_incident_revisions() {
        let path = std::env::temp_dir().join(format!("rumahl-incidents-{}.jsonl", Uuid::new_v4()));
        let mut store = IncidentStore::load_journal(&path).unwrap();
        let incident = store
            .ingest(input(Uuid::new_v4(), "sh", None, None, 0))
            .unwrap();
        let transitioned = store
            .transition(
                incident.incident_id,
                LifecycleRequest {
                    state: IncidentState::Investigating,
                    reason: "triage".into(),
                },
            )
            .unwrap();
        let restored = IncidentStore::load_journal(&path).unwrap();

        assert_eq!(
            restored.get(&incident.incident_id).unwrap().record_id,
            transitioned.record_id
        );
        std::fs::remove_file(path).unwrap();
    }
}
