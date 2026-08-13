use anyhow::Result;
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

const RESOLVER_VERSION: &str = "ora.identity.v1";
const SNAPSHOT_CAPACITY: usize = 16_384;
const CONTAINER_CACHE_CAPACITY: usize = 4_096;
const CONTAINER_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize)]
struct RuntimeEvent {
    schema_version: String,
    event_id: Uuid,
    host_boot_id: Uuid,
    sensor_instance_id: Uuid,
    sequence: u64,
    process: ProcessContext,
    identity: RuntimeIdentity,
    network: Option<NetworkContext>,
}
#[derive(Debug, Clone, Deserialize)]
struct ProcessContext {
    process_instance_id: String,
    exec_generation: u32,
    pid: u32,
    uid: u32,
    gid: u32,
    executable: ExecutableIdentity,
}
#[derive(Debug, Clone, Deserialize)]
struct ExecutableIdentity {
    path: Option<String>,
    sha256: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
struct RuntimeIdentity {
    cgroup_id: u64,
    cgroup_path: Option<String>,
    container_id: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
struct NetworkContext {
    network_namespace: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum IdentityType {
    App,
    Container,
    SystemService,
    HostProcess,
    Unknown,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Confidence {
    High,
    Medium,
    Low,
    Unknown,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ResolutionState {
    Resolved,
    Unknown,
    Conflicting,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum EvidenceKind {
    ContainerRegistry,
    Cgroup,
    SystemdUnit,
    ExecutableOwnership,
    Namespace,
    UserIdentity,
}

#[derive(Debug, Clone, Serialize)]
struct Evidence {
    kind: EvidenceKind,
    source: String,
    value: String,
    subject_id: Option<String>,
    observed_at: String,
    stale: bool,
}
#[derive(Debug, Clone, Serialize)]
struct IdentitySnapshot {
    snapshot_id: Uuid,
    runtime_event_id: Uuid,
    event_sequence: u64,
    host_boot_id: Uuid,
    sensor_instance_id: Uuid,
    process_instance_id: String,
    exec_generation: u32,
    identity_type: IdentityType,
    identity_id: Option<String>,
    confidence: Confidence,
    state: ResolutionState,
    evidence: Vec<Evidence>,
    resolver_version: String,
    resolved_at: String,
}

#[derive(Debug, Clone)]
struct ContainerRecord {
    container_id: String,
    app_id: String,
    created: i64,
    fetched_at: Instant,
}
#[derive(Default)]
struct Metrics {
    resolved: AtomicU64,
    unknown: AtomicU64,
    conflicting: AtomicU64,
    stale_evidence: AtomicU64,
    evicted_snapshots: AtomicU64,
    metadata_refresh_failures: AtomicU64,
}
struct SnapshotStore {
    order: VecDeque<Uuid>,
    values: HashMap<Uuid, IdentitySnapshot>,
}
impl SnapshotStore {
    fn new() -> Self {
        Self {
            order: VecDeque::new(),
            values: HashMap::new(),
        }
    }
    fn insert_if_absent(&mut self, value: IdentitySnapshot, metrics: &Metrics) -> IdentitySnapshot {
        if let Some(existing) = self.values.get(&value.runtime_event_id) {
            return existing.clone();
        }
        while self.order.len() >= SNAPSHOT_CAPACITY {
            if let Some(id) = self.order.pop_front() {
                self.values.remove(&id);
                metrics.evicted_snapshots.fetch_add(1, Ordering::Relaxed);
            }
        }
        self.order.push_back(value.runtime_event_id);
        self.values.insert(value.runtime_event_id, value.clone());
        value
    }
}

#[derive(Clone)]
struct AppState {
    snapshots: Arc<RwLock<SnapshotStore>>,
    containers: Arc<RwLock<HashMap<String, ContainerRecord>>>,
    metrics: Arc<Metrics>,
    client: reqwest::Client,
    started_at: Instant,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let state = AppState {
        snapshots: Arc::new(RwLock::new(SnapshotStore::new())),
        containers: Arc::new(RwLock::new(HashMap::new())),
        metrics: Arc::new(Metrics::default()),
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()?,
        started_at: Instant::now(),
    };
    tokio::spawn(refresh_loop(state.clone()));
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/runtime/identity/resolve", post(resolve_handler))
        .route(
            "/api/runtime/identity/snapshots/:event_id",
            get(snapshot_handler),
        )
        .route("/api/runtime/identity/metrics", get(metrics_handler))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(state);
    let port = iora_shared_config::system_config::service_port("iora-runtime-identity", 8107);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let _heartbeat = iora_shared_heartbeat::spawn_default(
        "iora-runtime-identity",
        port,
        "Read-only runtime attribution",
    );
    info!(port, "IORA runtime identity resolver started");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn refresh_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        if let Err(error) = refresh_containers(&state).await {
            state
                .metrics
                .metadata_refresh_failures
                .fetch_add(1, Ordering::Relaxed);
            warn!(%error,"container metadata refresh failed");
        }
    }
}
async fn refresh_containers(state: &AppState) -> Result<()> {
    let url = iora_shared_config::system_config::service_url("iora-supervisor", 8097);
    let value: serde_json::Value = state
        .client
        .get(format!("{url}/api/supervisor/apps"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut next = HashMap::new();
    for app in value
        .get("apps")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
    {
        let Some(container_id) = app.get("container_id").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(app_id) = app.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        if container_id == "unknown" || app_id == "unknown" {
            continue;
        }
        next.insert(
            container_id.to_owned(),
            ContainerRecord {
                container_id: container_id.to_owned(),
                app_id: app_id.to_owned(),
                created: app
                    .get("created")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0),
                fetched_at: Instant::now(),
            },
        );
        if next.len() >= CONTAINER_CACHE_CAPACITY {
            break;
        }
    }
    *state.containers.write().await = next;
    Ok(())
}

async fn resolve_handler(
    State(state): State<AppState>,
    Json(event): Json<RuntimeEvent>,
) -> Result<Json<IdentitySnapshot>, (axum::http::StatusCode, String)> {
    if event.schema_version != "ora.runtime.v2" {
        return Err((
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "unsupported runtime schema".into(),
        ));
    }
    let snapshot = resolve(&event, &state).await;
    match snapshot.state {
        ResolutionState::Resolved => state.metrics.resolved.fetch_add(1, Ordering::Relaxed),
        ResolutionState::Unknown => state.metrics.unknown.fetch_add(1, Ordering::Relaxed),
        ResolutionState::Conflicting => state.metrics.conflicting.fetch_add(1, Ordering::Relaxed),
    };
    let stored = state
        .snapshots
        .write()
        .await
        .insert_if_absent(snapshot, &state.metrics);
    Ok(Json(stored))
}
async fn snapshot_handler(
    State(state): State<AppState>,
    Path(event_id): Path<Uuid>,
) -> Result<Json<IdentitySnapshot>, axum::http::StatusCode> {
    state
        .snapshots
        .read()
        .await
        .values
        .get(&event_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

async fn resolve(event: &RuntimeEvent, state: &AppState) -> IdentitySnapshot {
    let now = Utc::now().to_rfc3339();
    let mut evidence = Vec::new();
    let mut candidates: HashMap<String, (IdentityType, u32)> = HashMap::new();
    if let Some(container_id) = event.identity.container_id.as_deref() {
        let containers = state.containers.read().await;
        if let Some(record) = find_container(container_id, &containers) {
            let stale = record.fetched_at.elapsed() > CONTAINER_TTL;
            if stale {
                state.metrics.stale_evidence.fetch_add(1, Ordering::Relaxed);
            }
            evidence.push(Evidence {
                kind: EvidenceKind::ContainerRegistry,
                source: "iora-supervisor:/api/supervisor/apps".into(),
                value: format!("{};created={}", record.container_id, record.created),
                subject_id: Some(record.app_id.clone()),
                observed_at: now.clone(),
                stale,
            });
            if !stale {
                candidates.insert(record.app_id.clone(), (IdentityType::App, 100));
            }
        } else {
            evidence.push(Evidence {
                kind: EvidenceKind::Cgroup,
                source: "runtime_event.identity.container_id".into(),
                value: container_id.into(),
                subject_id: None,
                observed_at: now.clone(),
                stale: false,
            });
            candidates.insert(container_id.into(), (IdentityType::Container, 60));
        }
    }
    if let Some(cgroup) = event.identity.cgroup_path.as_deref() {
        evidence.push(Evidence {
            kind: EvidenceKind::Cgroup,
            source: "runtime_event.identity.cgroup_path".into(),
            value: cgroup.into(),
            subject_id: None,
            observed_at: now.clone(),
            stale: false,
        });
        if let Some(unit) = systemd_unit(cgroup) {
            evidence.push(Evidence {
                kind: EvidenceKind::SystemdUnit,
                source: "cgroup".into(),
                value: unit.clone(),
                subject_id: Some(unit.clone()),
                observed_at: now.clone(),
                stale: false,
            });
            candidates.insert(unit, (IdentityType::SystemService, 90));
        }
    }
    if let Some(path) = event.process.executable.path.as_deref() {
        let value = event
            .process
            .executable
            .sha256
            .as_ref()
            .map(|hash| format!("{path};sha256={hash}"))
            .unwrap_or_else(|| path.into());
        evidence.push(Evidence {
            kind: EvidenceKind::ExecutableOwnership,
            source: "runtime_event.process.executable".into(),
            value,
            subject_id: None,
            observed_at: now.clone(),
            stale: false,
        });
        if path.starts_with("/opt/iora/build/") {
            let id = path
                .trim_start_matches("/opt/iora/build/")
                .split('/')
                .next()
                .unwrap_or("unknown")
                .to_owned();
            candidates.insert(id, (IdentityType::SystemService, 80));
        }
    }
    evidence.push(Evidence {
        kind: EvidenceKind::Namespace,
        source: "runtime_event.identity".into(),
        value: format!(
            "cgroup_id={};network_namespace={}",
            event.identity.cgroup_id,
            event
                .network
                .as_ref()
                .map(|network| network.network_namespace)
                .unwrap_or(0)
        ),
        subject_id: None,
        observed_at: now.clone(),
        stale: false,
    });
    evidence.push(Evidence {
        kind: EvidenceKind::UserIdentity,
        source: "runtime_event.process".into(),
        value: format!("uid={};gid={}", event.process.uid, event.process.gid),
        subject_id: None,
        observed_at: now.clone(),
        stale: false,
    });
    let distinct: Vec<_> = candidates
        .iter()
        .filter(|(_, (_, score))| *score >= 80)
        .collect();
    let (identity_type, identity_id, confidence, resolution) = if distinct.len() > 1 {
        (
            IdentityType::Unknown,
            None,
            Confidence::Unknown,
            ResolutionState::Conflicting,
        )
    } else if let Some((id, (kind, score))) = candidates.iter().max_by_key(|(_, (_, score))| score)
    {
        let confidence = if *score >= 100 {
            Confidence::High
        } else if *score >= 80 {
            Confidence::Medium
        } else {
            Confidence::Low
        };
        (
            kind.clone(),
            Some(id.clone()),
            confidence,
            ResolutionState::Resolved,
        )
    } else if event.process.pid > 0 {
        (
            IdentityType::HostProcess,
            event.process.executable.path.clone(),
            Confidence::Low,
            ResolutionState::Resolved,
        )
    } else {
        (
            IdentityType::Unknown,
            None,
            Confidence::Unknown,
            ResolutionState::Unknown,
        )
    };
    IdentitySnapshot {
        snapshot_id: Uuid::new_v4(),
        runtime_event_id: event.event_id,
        event_sequence: event.sequence,
        host_boot_id: event.host_boot_id,
        sensor_instance_id: event.sensor_instance_id,
        process_instance_id: event.process.process_instance_id.clone(),
        exec_generation: event.process.exec_generation,
        identity_type,
        identity_id,
        confidence,
        state: resolution,
        evidence,
        resolver_version: RESOLVER_VERSION.into(),
        resolved_at: now,
    }
}

fn find_container<'a>(
    id: &str,
    containers: &'a HashMap<String, ContainerRecord>,
) -> Option<&'a ContainerRecord> {
    let matches: Vec<_> = containers
        .values()
        .filter(|record| {
            record.container_id == id
                || record.container_id.starts_with(id)
                || id.starts_with(&record.container_id)
        })
        .collect();
    (matches.len() == 1).then(|| matches[0])
}
fn systemd_unit(cgroup: &str) -> Option<String> {
    cgroup
        .split('/')
        .find(|part| part.ends_with(".service"))
        .map(str::to_owned)
}
async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let failures = state
        .metrics
        .metadata_refresh_failures
        .load(Ordering::Relaxed);
    Json(
        serde_json::json!({"status":if failures==0{"healthy"}else{"degraded"},"resolver_version":RESOLVER_VERSION,"container_cache_entries":state.containers.read().await.len(),"metadata_refresh_failures":failures,"uptime_seconds":state.started_at.elapsed().as_secs()}),
    )
}
async fn metrics_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"snapshot_capacity":SNAPSHOT_CAPACITY,"container_cache_capacity":CONTAINER_CACHE_CAPACITY,"resolved":state.metrics.resolved.load(Ordering::Relaxed),"unknown":state.metrics.unknown.load(Ordering::Relaxed),"conflicting":state.metrics.conflicting.load(Ordering::Relaxed),"stale_evidence":state.metrics.stale_evidence.load(Ordering::Relaxed),"evicted_snapshots":state.metrics.evicted_snapshots.load(Ordering::Relaxed),"metadata_refresh_failures":state.metrics.metadata_refresh_failures.load(Ordering::Relaxed)}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(
        container: Option<&str>,
        cgroup: Option<&str>,
        path: Option<&str>,
        pid: u32,
        start: &str,
        generation: u32,
    ) -> RuntimeEvent {
        RuntimeEvent {
            schema_version: "ora.runtime.v2".into(),
            event_id: Uuid::new_v4(),
            host_boot_id: Uuid::nil(),
            sensor_instance_id: Uuid::nil(),
            sequence: 1,
            process: ProcessContext {
                process_instance_id: start.into(),
                exec_generation: generation,
                pid,
                uid: 1000,
                gid: 1000,
                executable: ExecutableIdentity {
                    path: path.map(str::to_owned),
                    sha256: None,
                },
            },
            identity: RuntimeIdentity {
                cgroup_id: 1,
                cgroup_path: cgroup.map(str::to_owned),
                container_id: container.map(str::to_owned),
            },
            network: None,
        }
    }
    fn state(records: Vec<ContainerRecord>) -> AppState {
        let (events, _) = tokio::sync::broadcast::channel::<()>(1);
        drop(events);
        AppState {
            snapshots: Arc::new(RwLock::new(SnapshotStore::new())),
            containers: Arc::new(RwLock::new(
                records
                    .into_iter()
                    .map(|record| (record.container_id.clone(), record))
                    .collect(),
            )),
            metrics: Arc::new(Metrics::default()),
            client: reqwest::Client::new(),
            started_at: Instant::now(),
        }
    }
    #[tokio::test]
    async fn pid_reuse_keeps_snapshots_distinct() {
        let state = state(vec![]);
        let a = resolve(&event(None, None, None, 42, "instance-a", 0), &state).await;
        let b = resolve(&event(None, None, None, 42, "instance-b", 0), &state).await;
        assert_ne!(a.process_instance_id, b.process_instance_id)
    }
    #[test]
    fn container_recreation_does_not_match_old_full_id() {
        let old = ContainerRecord {
            container_id: "aaaaaaaaaaaa1111".into(),
            app_id: "app".into(),
            created: 1,
            fetched_at: Instant::now(),
        };
        let mut map = HashMap::new();
        map.insert(old.container_id.clone(), old);
        assert!(find_container("bbbbbbbbbbbb2222", &map).is_none())
    }
    #[tokio::test]
    async fn stale_mapping_never_resolves_app() {
        let record = ContainerRecord {
            container_id: "aaaaaaaaaaaa1111".into(),
            app_id: "app".into(),
            created: 1,
            fetched_at: Instant::now() - CONTAINER_TTL - Duration::from_secs(1),
        };
        let snapshot = resolve(
            &event(Some("aaaaaaaaaaaa1111"), None, None, 1, "x", 0),
            &state(vec![record]),
        )
        .await;
        assert_ne!(snapshot.identity_type, IdentityType::App)
    }
    #[tokio::test]
    async fn conflicting_high_quality_evidence_is_explicit() {
        let record = ContainerRecord {
            container_id: "aaaaaaaaaaaa1111".into(),
            app_id: "photos".into(),
            created: 1,
            fetched_at: Instant::now(),
        };
        let snapshot = resolve(
            &event(
                Some("aaaaaaaaaaaa1111"),
                Some("/system.slice/iora-home.service"),
                None,
                1,
                "x",
                0,
            ),
            &state(vec![record]),
        )
        .await;
        assert_eq!(snapshot.state, ResolutionState::Conflicting)
    }
    #[tokio::test]
    async fn unknown_is_not_guessed_from_uid() {
        let snapshot = resolve(&event(None, None, None, 0, "x", 0), &state(vec![])).await;
        assert_eq!(snapshot.state, ResolutionState::Unknown);
        assert_eq!(snapshot.confidence, Confidence::Unknown)
    }
    #[tokio::test]
    async fn uid_alone_never_produces_high_confidence() {
        let snapshot = resolve(&event(None, None, None, 1, "x", 0), &state(vec![])).await;
        assert_ne!(snapshot.confidence, Confidence::High)
    }
    #[tokio::test]
    async fn snapshot_is_tied_to_exec_generation() {
        let snapshot = resolve(
            &event(None, None, Some("/usr/bin/test"), 1, "instance", 7),
            &state(vec![]),
        )
        .await;
        assert_eq!(snapshot.exec_generation, 7);
        assert_eq!(snapshot.process_instance_id, "instance")
    }

    #[tokio::test]
    async fn existing_event_snapshot_is_immutable() {
        let state = state(vec![]);
        let runtime_event = event(None, None, Some("/usr/bin/first"), 1, "instance", 0);
        let first = resolve(&runtime_event, &state).await;
        let mut changed_event = runtime_event.clone();
        changed_event.process.executable.path = Some("/usr/bin/changed".into());
        let changed = resolve(&changed_event, &state).await;
        let mut store = state.snapshots.write().await;
        let stored_first = store.insert_if_absent(first, &state.metrics);
        let stored_second = store.insert_if_absent(changed, &state.metrics);

        assert_eq!(stored_first.snapshot_id, stored_second.snapshot_id);
        assert_eq!(stored_second.identity_id.as_deref(), Some("/usr/bin/first"));
    }
}
