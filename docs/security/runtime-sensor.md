# Runtime Sensor 2.1b

The first Runtime Protection component is observation-only. Its CO-RE eBPF programs observe process execution, process exit, and outbound `connect(2)` tracepoints and write fixed-size records to a bounded kernel ring buffer. They contain no enforcement maps or mutation helpers.

The unprivileged `rumahl-runtime-sensor` consumer normalizes records into schema `ora.runtime.v2`. Each event has a UUID event ID, host boot ID, sensor instance ID, monotonic sequence, wall and monotonic timestamps, process and parent IDs, UID/GID, cgroup identity, optional container identifier, and network context.

Process identity is stable across PID reuse: `process_instance_id` is derived from the host boot ID, PID, and kernel process start time. Parent identity uses the same model. Fork, exec, and exit are distinct event classes; repeated execs retain the process instance and increment `exec_generation`.

Executable hashing is asynchronous. Lifecycle telemetry is emitted immediately with hash state `pending`, then a separate `executable_identity` enrichment event reports `available`, `skipped`, or `failed` with a reason. The bounded hash queue cannot stall ingestion.

Network telemetry distinguishes `connection_attempt` from `connection_result`; results are `success`, `failed`, or `in_progress`. The schema carries local and remote address/port, protocol, address family, network namespace, socket cookie, and errno. IPv4, IPv6, successful, failed, and non-blocking attempts share this correlation model. Unknown protocol or socket metadata remains explicit rather than being guessed.

App identity is intentionally unresolved in 2.1: events are `system`, `container`, or `unknown`, while `app_id` remains empty. No Docker socket is used. A later resolver owns rumahl app attribution, and uncertain activity must remain `unknown`.

The user-space queue holds 4,096 records, the hash enrichment queue holds 128 jobs, and subscriber delivery holds 1,024 records. Process start, execution, and network attempt/result are critical classes. Queue loss increments separate critical/non-critical counters; any critical loss changes health to `degraded`. A disconnected kernel source or lost hash enrichment also degrades health with a stable reason code. No sampling is applied to critical classes.

The service binds its health, metrics, and SSE event API only to loopback. It cannot access the Root Helper, Docker socket, nftables, systemd, quarantine, process control, or container control. Phase-1 enforcement remains exclusively behind `rumahl-security`.

The eBPF loader is a separately reviewed deployment boundary allowed only `CAP_BPF` and `CAP_PERFMON`; `CAP_SYS_ADMIN`, `CAP_NET_ADMIN`, and `CAP_KILL` are forbidden. The consumer itself runs without capabilities under the dedicated `rumahl-security` account with systemd sandboxing.

## Deployment (2.1c)

`rumahl-runtime-sensor-ebpf-loader` is a small C program built with libbpf (Buildroot package in the external tree, `BR2_PACKAGE_RUMAHL_RUNTIME_SENSOR_EBPF_LOADER`, requires `libbpf`, `host-clang` and `host-bpftool`). It loads `runtime.bpf.o` (compiled from `runtime.bpf.c` with `vmlinux.h` generated from the built kernel via `bpftool btf dump`), consumes the ring buffer and forwards every record as one JSON line over the sensor's Unix socket. The wire format is shared through `ebpf/runtime_event.h`; the JSON contract mirrors `KernelEvent` in `src/event.rs`.

The loader runs as a systemd service (`rumahl-runtime-sensor-ebpf-loader.service`) with `AmbientCapabilities=CAP_BPF CAP_PERFMON`, `CapabilityBoundingSet=CAP_BPF CAP_PERFMON`, `NoNewPrivileges`, `ProtectSystem=strict` and `MemoryDenyWriteExecute`. It performs no host mutations and never execs anything; the sensor reconnects transparently if the service restarts.

Enrichment limits: connect tracepoints do not expose the socket fd, so the loader reports protocol as `tcp` (UDP datagrams use `sendto` and are not captured) and socket cookie as `0` (unknown).

## Detection pipeline (2.1d)

Critical normalized events are forwarded over loopback to the read-only Phase-2 services:

```text
rumahl-runtime-sensor (normalize)
  -> rumahl-runtime-identity  POST /api/runtime/identity/resolve
  -> rumahl-runtime-policy    POST /api/runtime/detections/evaluate
  -> rumahl-incident-engine   POST /api/runtime/incidents/correlate
```

Events whose identity cannot be resolved (or that have no profile) stop at that stage and remain visible in the SSE stream. Every stage is best-effort with short timeouts: a failing stage drops the event from detection but never blocks event emission. The sensor performs no host mutations at any point.
