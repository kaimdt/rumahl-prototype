# rumahl Service Heartbeat Protocol

Every rumahl service self-announces to `rumahl-core` every few seconds. This
document describes the protocol so new services (and external integrations
such as the VS Code extension) can implement or consume it.

## Why

The previous design relied entirely on `rumahl-core` reverse-polling each
service's `/health` endpoint every 30s. That has three problems:

1. Services behind a firewall or in a private namespace are invisible to
   core unless reachable.
2. Failure detection takes up to 30s.
3. Core has to know about every service URL up-front.

The heartbeat protocol fixes all three. Services push a status snapshot
every 5s, core flips them to `Unhealthy` after 20s of silence, and new
services appear in the dashboard as soon as they boot — no static
registration needed.

## Endpoint

```
POST {RUMAHL_CORE_URL}/api/core/services/heartbeat
Content-Type: application/json
```

### Request body (`ServiceHeartbeat`)

| field            | type                  | description                                  |
|------------------|-----------------------|----------------------------------------------|
| `name`           | string                | Logical service name (must be unique)        |
| `url`            | string                | URL the service listens on (used for reverse poll) |
| `description`    | string                | Human-readable description                   |
| `version`        | string                | Build/version identifier                     |
| `status`         | `healthy`/`degraded`/`unhealthy` | Self-reported status              |
| `message`        | string\|null          | Optional one-line context                    |
| `uptime_seconds` | u64                   | Seconds since the process started            |
| `pid`            | u32                   | Process id                                   |
| `host`           | string                | `$HOSTNAME` or `/proc/sys/kernel/hostname`   |
| `metrics`        | `{ string: number }`  | Free-form numeric metrics (cpu, mem_mb, …)   |
| `timestamp`      | RFC-3339 string       | When the snapshot was assembled              |

### Response

```json
{
  "ok": true,
  "interval_hint_seconds": 5,
  "stale_after_seconds": 20,
  "server_time": "..."
}
```

A non-2xx response is treated as a transient failure by the client; it
will exponentially back off (max 60 s) until core recovers.

## Aggregated view

Operators and tools read the live mesh state from:

```
GET {RUMAHL_CORE_URL}/api/core/services/status
```

which returns every known service plus a summary counting healthy /
degraded / unhealthy / stale.

The dev-bridge proxies the same payload at `/dev/services` (token-auth)
and the `rumahl-dev-deploy` daemon re-exposes it at `/api/v1/services` for
the VS Code extension's "Services (live)" tree view.

## Embedding the client

In Rust services using `rumahl-shared`:

```rust
let _hb = rumahl_shared::heartbeat::spawn_default(
    "rumahl-watchdog",
    8094,
    "System & service watchdog",
);
```

Override anything via the full builder:

```rust
HeartbeatClient::spawn(HeartbeatConfig {
    service_name: "rumahl-watchdog".into(),
    service_url:  format!("http://127.0.0.1:{port}"),
    description:  "...".into(),
    interval:     std::time::Duration::from_secs(2),
    ..HeartbeatConfig::default()
});
```

The returned `HeartbeatHandle` can flip the reported status at runtime
(e.g. `Degraded` while a critical dependency is reconnecting) and push
custom metrics:

```rust
hb.set_status(HealthStatus::Degraded, Some("DB reconnecting".into())).await;
hb.set_metric("queue_depth", queue.len() as f64).await;
```

## Environment variables

| variable                          | default                  | description                          |
|-----------------------------------|--------------------------|--------------------------------------|
| `RUMAHL_CORE_URL`                   | `http://127.0.0.1:8090`  | Heartbeat target                     |
| `RUMAHL_HEARTBEAT_INTERVAL_SECS`    | `5`                      | Cadence (clamped to 1–60)            |

## Failure semantics

* The heartbeat task **never** crashes the host service.
* On consecutive failures the cadence backs off exponentially up to 60s.
* The first failure and every power-of-two failure are logged; everything
  else is silent to keep the journal clean during a core upgrade.
* When a heartbeat is received again, the backoff resets and a recovery
  log line is emitted.
* `rumahl-core` flags any service stale after `HEARTBEAT_STALE_AFTER_SECS`
  (20s) and emits `service.stale` on the SSE event bus, so dashboards
  can react in real time.
