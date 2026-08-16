#[cfg(target_os = "linux")]
mod event;

use anyhow::Result;

#[cfg(not(target_os = "linux"))]
fn main() -> Result<()> {
    anyhow::bail!("iora-runtime-sensor is a Linux-only service: it consumes kernel eBPF telemetry over a Unix socket")
}

#[cfg(target_os = "linux")]
mod linux {
    use anyhow::Result;
    use axum::{
        extract::State,
        response::sse::{Event, KeepAlive, Sse},
        routing::get,
        Json, Router,
    };
    use event::*;
    use serde::Serialize;
    use sha2::{Digest, Sha256};
    use std::{
        convert::Infallible,
        path::Path,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
        time::Duration,
    };
    use tokio::{
        io::{AsyncBufReadExt, BufReader},
        net::{UnixListener, UnixStream},
        sync::{broadcast, mpsc, RwLock},
    };
    use tokio_stream::{wrappers::BroadcastStream, StreamExt};
    use tracing::{info, warn};
    use uuid::Uuid;

    const INGEST_SOCKET: &str = "/run/iora/runtime-sensor/ebpf-events.sock";
    const QUEUE_CAPACITY: usize = 4096;
    const HASH_QUEUE_CAPACITY: usize = 128;
    const SUBSCRIBER_CAPACITY: usize = 1024;
    const MAX_HASH_BYTES: u64 = 256 * 1024 * 1024;

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "snake_case")]
    enum HealthStatus {
        Healthy,
        Degraded,
    }

    #[derive(Default)]
    struct Metrics {
        received: AtomicU64,
        emitted: AtomicU64,
        dropped_critical: AtomicU64,
        dropped_noncritical: AtomicU64,
        dropped_hash_jobs: AtomicU64,
        subscriber_lag: AtomicU64,
        invalid_events: AtomicU64,
    }

    #[derive(Clone)]
    struct AppState {
        metrics: Arc<Metrics>,
        source_connected: Arc<RwLock<bool>>,
        events: broadcast::Sender<RuntimeEvent>,
        host_boot_id: Uuid,
        sensor_instance_id: Uuid,
        started_at: std::time::Instant,
    }

    struct HashJob {
        base: RuntimeEvent,
        path: String,
    }

    #[tokio::main]
    async fn main() -> Result<()> {
        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .init();
        tokio::fs::create_dir_all("/run/iora/runtime-sensor").await?;
        if Path::new(INGEST_SOCKET).exists() {
            tokio::fs::remove_file(INGEST_SOCKET).await?;
        }
        let listener = UnixListener::bind(INGEST_SOCKET)?;
        set_mode(INGEST_SOCKET, 0o600)?;
        let (queue_tx, queue_rx) = mpsc::channel(QUEUE_CAPACITY);
        let (hash_tx, hash_rx) = mpsc::channel(HASH_QUEUE_CAPACITY);
        let (events, _) = broadcast::channel(SUBSCRIBER_CAPACITY);
        let state = AppState {
            metrics: Arc::new(Metrics::default()),
            source_connected: Arc::new(RwLock::new(false)),
            events,
            host_boot_id: read_boot_id(),
            sensor_instance_id: Uuid::new_v4(),
            started_at: std::time::Instant::now(),
        };
        tokio::spawn(accept_ebpf_events(listener, queue_tx, state.clone()));
        tokio::spawn(normalize_events(queue_rx, hash_tx, state.clone()));
        tokio::spawn(hash_worker(hash_rx, state.clone()));
        let app = Router::new()
            .route("/health", get(health))
            .route("/api/runtime/events", get(event_stream))
            .route("/api/runtime/metrics", get(metrics))
            .with_state(state);
        let port = iora_shared_config::system_config::service_port("iora-runtime-sensor", 8106);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
        let _heartbeat = iora_shared_heartbeat::spawn_default(
            "iora-runtime-sensor",
            port,
            "Read-only eBPF runtime telemetry",
        );
        info!(port, "IORA runtime sensor consumer started");
        axum::serve(listener, app).await?;
        Ok(())
    }

    fn read_boot_id() -> Uuid {
        std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .ok()
            .and_then(|value| Uuid::parse_str(value.trim()).ok())
            .unwrap_or_else(Uuid::nil)
    }
    fn set_mode(path: &str, mode: u32) -> Result<()> {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
        Ok(())
    }

    async fn accept_ebpf_events(
        listener: UnixListener,
        sender: mpsc::Sender<KernelEvent>,
        state: AppState,
    ) {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            *state.source_connected.write().await = true;
            if let Err(error) = read_source(stream, &sender, &state).await {
                warn!(%error,"eBPF event source disconnected");
            }
            *state.source_connected.write().await = false;
        }
    }
    async fn read_source(
        stream: UnixStream,
        sender: &mpsc::Sender<KernelEvent>,
        state: &AppState,
    ) -> Result<()> {
        let mut lines = BufReader::new(stream).lines();
        while let Some(line) = lines.next_line().await? {
            let event = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => {
                    state.metrics.invalid_events.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };
            state.metrics.received.fetch_add(1, Ordering::Relaxed);
            enqueue_event(sender, event, &state.metrics);
        }
        Ok(())
    }
    fn is_critical(class: &EventClass) -> bool {
        matches!(
            class,
            EventClass::ProcessStart
                | EventClass::ProcessExec
                | EventClass::ConnectionAttempt
                | EventClass::ConnectionResult
        )
    }
    fn enqueue_event(sender: &mpsc::Sender<KernelEvent>, event: KernelEvent, metrics: &Metrics) {
        let critical = is_critical(&event.class);
        if sender.try_send(event).is_err() {
            if critical {
                metrics.dropped_critical.fetch_add(1, Ordering::Relaxed);
            } else {
                metrics.dropped_noncritical.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    async fn normalize_events(
        mut receiver: mpsc::Receiver<KernelEvent>,
        hash_sender: mpsc::Sender<HashJob>,
        state: AppState,
    ) {
        let sequence = AtomicU64::new(1);
        while let Some(raw) = receiver.recv().await {
            let mut event = normalize(raw, sequence.fetch_add(1, Ordering::Relaxed), &state).await;
            if matches!(
                event.class,
                EventClass::ProcessStart | EventClass::ProcessExec
            ) {
                if let Some(path) = event.process.executable.path.clone() {
                    event.process.executable.hash_state = HashState::Pending;
                    if hash_sender
                        .try_send(HashJob {
                            base: event.clone(),
                            path,
                        })
                        .is_err()
                    {
                        state
                            .metrics
                            .dropped_hash_jobs
                            .fetch_add(1, Ordering::Relaxed);
                        event.process.executable.hash_state = HashState::Skipped;
                        event.process.executable.reason = Some("hash_queue_full".into());
                    }
                }
            }
            emit(&state, event);
        }
    }
    async fn hash_worker(mut receiver: mpsc::Receiver<HashJob>, state: AppState) {
        while let Some(job) = receiver.recv().await {
            let (hash_state, sha256, reason) = hash_executable(&job.path).await;
            let mut event = job.base;
            event.event_id = Uuid::new_v4();
            event.class = EventClass::ExecutableIdentity;
            event.observed_at = chrono::Utc::now().to_rfc3339();
            event.process.executable.hash_state = hash_state;
            event.process.executable.sha256 = sha256;
            event.process.executable.reason = reason;
            emit(&state, event);
        }
    }
    fn emit(state: &AppState, event: RuntimeEvent) {
        state.metrics.emitted.fetch_add(1, Ordering::Relaxed);
        let _ = state.events.send(event);
    }

    async fn normalize(raw: KernelEvent, sequence: u64, state: &AppState) -> RuntimeEvent {
        let cgroup_path = read_cgroup(raw.pid).await;
        let container_id = cgroup_path.as_deref().and_then(container_id_from_cgroup);
        let instance_id =
            process_instance_id(state.host_boot_id, raw.pid, raw.process_start_time_ns);
        let parent_process_instance_id = (raw.ppid > 0).then(|| {
            process_instance_id(
                state.host_boot_id,
                raw.ppid,
                read_start_time_ns(raw.ppid).unwrap_or(0),
            )
        });
        let executable_path = raw.executable.or_else(|| {
            std::fs::read_link(format!("/proc/{}/exe", raw.pid))
                .ok()
                .map(|path| path.to_string_lossy().into_owned())
        });
        let network = raw.remote_address.map(|remote_address| NetworkContext {
            connection_state: connection_state(&raw.class, raw.result_errno),
            result_errno: raw.result_errno,
            protocol: raw.protocol.unwrap_or_else(|| "unknown".into()),
            local_address: raw.local_address,
            local_port: raw.local_port,
            remote_address,
            remote_port: raw.remote_port.unwrap_or(0),
            address_family: raw.address_family.unwrap_or_else(|| "unknown".into()),
            network_namespace: raw.network_namespace,
            socket_cookie: raw.socket_cookie,
        });
        RuntimeEvent {
            schema_version: SCHEMA_VERSION.into(),
            event_id: Uuid::new_v4(),
            host_boot_id: state.host_boot_id,
            sensor_instance_id: state.sensor_instance_id,
            sequence,
            monotonic_ns: raw.monotonic_ns,
            observed_at: chrono::Utc::now().to_rfc3339(),
            critical: is_critical(&raw.class),
            class: raw.class,
            process: ProcessContext {
                process_instance_id: instance_id,
                parent_process_instance_id,
                pid: raw.pid,
                ppid: raw.ppid,
                process_start_time_ns: raw.process_start_time_ns,
                exec_generation: raw.exec_generation,
                uid: raw.uid,
                gid: raw.gid,
                executable: ExecutableIdentity {
                    path: executable_path,
                    hash_state: HashState::Skipped,
                    sha256: None,
                    reason: Some("not_requested".into()),
                },
                command_name: raw.command_name,
            },
            identity: RuntimeIdentity {
                kind: if container_id.is_some() {
                    IdentityKind::Container
                } else if cgroup_path.is_some() {
                    IdentityKind::System
                } else {
                    IdentityKind::Unknown
                },
                cgroup_id: raw.cgroup_id,
                cgroup_path,
                container_id,
                app_id: None,
            },
            network,
        }
    }

    fn process_instance_id(boot_id: Uuid, pid: u32, start: u64) -> String {
        hex::encode(Sha256::digest(
            format!("{boot_id}:{pid}:{start}").as_bytes(),
        ))
    }
    fn connection_state(class: &EventClass, result: Option<i32>) -> ConnectionState {
        if matches!(class, EventClass::ConnectionAttempt) {
            ConnectionState::Attempt
        } else {
            match result {
                Some(0) => ConnectionState::Success,
                Some(115) => ConnectionState::InProgress,
                Some(_) => ConnectionState::Failed,
                None => ConnectionState::Attempt,
            }
        }
    }
    fn read_start_time_ns(pid: u32) -> Option<u64> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let after = stat.rsplit_once(") ")?.1;
        let ticks = after.split_whitespace().nth(19)?.parse::<u64>().ok()?;
        Some(ticks.saturating_mul(10_000_000))
    }
    async fn read_cgroup(pid: u32) -> Option<String> {
        tokio::fs::read_to_string(format!("/proc/{pid}/cgroup"))
            .await
            .ok()?
            .lines()
            .next()?
            .splitn(3, ':')
            .nth(2)
            .map(str::to_owned)
    }
    fn container_id_from_cgroup(value: &str) -> Option<String> {
        value
            .split(|character| character == '/' || character == '-')
            .find(|part| {
                part.len() >= 12
                    && part.len() <= 64
                    && part.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
            .map(str::to_owned)
    }
    async fn hash_executable(path: &str) -> (HashState, Option<String>, Option<String>) {
        let metadata = match tokio::fs::metadata(path).await {
            Ok(value) => value,
            Err(_) => return (HashState::Failed, None, Some("metadata_unavailable".into())),
        };
        if !metadata.is_file() {
            return (HashState::Skipped, None, Some("not_regular_file".into()));
        }
        if metadata.len() > MAX_HASH_BYTES {
            return (HashState::Skipped, None, Some("file_too_large".into()));
        }
        match tokio::fs::read(path).await {
            Ok(bytes) => (
                HashState::Available,
                Some(hex::encode(Sha256::digest(bytes))),
                None,
            ),
            Err(_) => (HashState::Failed, None, Some("read_failed".into())),
        }
    }

    async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
        let connected = *state.source_connected.read().await;
        let critical = state.metrics.dropped_critical.load(Ordering::Relaxed);
        let hash_drops = state.metrics.dropped_hash_jobs.load(Ordering::Relaxed);
        let mut reasons = Vec::new();
        if !connected {
            reasons.push("kernel_source_disconnected");
        }
        if critical > 0 {
            reasons.push("critical_telemetry_lost");
        }
        if hash_drops > 0 {
            reasons.push("hash_enrichment_lost");
        }
        let status = if reasons.is_empty() {
            HealthStatus::Healthy
        } else {
            HealthStatus::Degraded
        };
        Json(
            serde_json::json!({"status":status,"reasons":reasons,"schema_version":SCHEMA_VERSION,"host_boot_id":state.host_boot_id,"sensor_instance_id":state.sensor_instance_id,"source_connected":connected,"critical_events_dropped":critical,"hash_jobs_dropped":hash_drops,"uptime_seconds":state.started_at.elapsed().as_secs()}),
        )
    }
    async fn metrics(State(state): State<AppState>) -> Json<serde_json::Value> {
        Json(
            serde_json::json!({"queue_capacity":QUEUE_CAPACITY,"hash_queue_capacity":HASH_QUEUE_CAPACITY,"received":state.metrics.received.load(Ordering::Relaxed),"emitted":state.metrics.emitted.load(Ordering::Relaxed),"dropped_critical":state.metrics.dropped_critical.load(Ordering::Relaxed),"dropped_noncritical":state.metrics.dropped_noncritical.load(Ordering::Relaxed),"dropped_hash_jobs":state.metrics.dropped_hash_jobs.load(Ordering::Relaxed),"subscriber_lag":state.metrics.subscriber_lag.load(Ordering::Relaxed),"invalid_events":state.metrics.invalid_events.load(Ordering::Relaxed)}),
        )
    }
    async fn event_stream(
        State(state): State<AppState>,
    ) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
        let metrics = state.metrics.clone();
        let stream =
            BroadcastStream::new(state.events.subscribe()).filter_map(move |item| match item {
                Ok(event) => Some(Ok(Event::default()
                    .id(event.event_id.to_string())
                    .event("runtime_event")
                    .json_data(event)
                    .unwrap())),
                Err(_) => {
                    metrics.subscriber_lag.fetch_add(1, Ordering::Relaxed);
                    None
                }
            });
        Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        fn state() -> AppState {
            let (events, _) = broadcast::channel(8);
            AppState {
                metrics: Arc::new(Metrics::default()),
                source_connected: Arc::new(RwLock::new(false)),
                events,
                host_boot_id: Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
                sensor_instance_id: Uuid::nil(),
                started_at: std::time::Instant::now(),
            }
        }
        fn raw(class: EventClass) -> KernelEvent {
            KernelEvent {
                class,
                monotonic_ns: 42,
                pid: u32::MAX,
                ppid: 1,
                process_start_time_ns: 99,
                exec_generation: 2,
                uid: 1000,
                gid: 1000,
                cgroup_id: 7,
                command_name: "test".into(),
                executable: Some("/missing".into()),
                remote_address: Some("2001:db8::1".into()),
                remote_port: Some(443),
                local_address: None,
                local_port: None,
                protocol: Some("tcp".into()),
                address_family: Some("ipv6".into()),
                network_namespace: 8,
                socket_cookie: 9,
                result_errno: Some(111),
            }
        }
        #[test]
        fn schema_is_stable() {
            assert_eq!(SCHEMA_VERSION, "ora.runtime.v2")
        }
        #[test]
        fn process_identity_survives_pid_reuse() {
            let boot = Uuid::nil();
            assert_ne!(
                process_instance_id(boot, 42, 100),
                process_instance_id(boot, 42, 200)
            );
        }
        #[test]
        fn exec_generation_is_explicit() {
            assert_eq!(raw(EventClass::ProcessExec).exec_generation, 2)
        }
        #[test]
        fn connection_outcome_is_preserved() {
            assert_eq!(
                connection_state(&EventClass::ConnectionResult, Some(0)),
                ConnectionState::Success
            );
            assert_eq!(
                connection_state(&EventClass::ConnectionResult, Some(111)),
                ConnectionState::Failed
            );
            assert_eq!(
                connection_state(&EventClass::ConnectionResult, Some(115)),
                ConnectionState::InProgress
            );
        }
        #[tokio::test]
        async fn normalized_event_contains_generations() {
            let event = normalize(raw(EventClass::ConnectionResult), 1, &state()).await;
            assert_eq!(event.identity.kind, IdentityKind::Unknown);
            assert_eq!(event.process.exec_generation, 2);
            assert_eq!(event.network.unwrap().socket_cookie, 9);
        }
        #[tokio::test]
        async fn oversized_hash_is_explicitly_skipped() {
            let path = std::env::temp_dir().join(format!("iora-large-{}", std::process::id()));
            let file = std::fs::File::create(&path).unwrap();
            file.set_len(MAX_HASH_BYTES + 1).unwrap();
            let result = hash_executable(path.to_str().unwrap()).await;
            assert_eq!(result.0, HashState::Skipped);
            assert_eq!(result.2.as_deref(), Some("file_too_large"));
            std::fs::remove_file(path).unwrap();
        }
    }
}
