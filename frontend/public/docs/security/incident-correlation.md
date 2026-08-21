# Incident Correlation 2.5

`rumahl-incident-engine` is a standalone, non-privileged correlator for `ora.runtime-detection.v1`. It produces revisioned `ora.security-incident.v1` records rather than turning every detection into a separate alert.

Correlation combines temporal proximity with causal evidence: process and parent-process instances, exec generations, identity snapshots, container instances, executable hashes, socket cookies, destinations, and detection types. Strong causal keys remain eligible for seven days; weaker contextual matches require multiple shared signals inside a 15-minute window. Repeated detection IDs are idempotent and repeated timeline evidence increments occurrence counts.

Incidents preserve severity independently from attribution confidence. Revisions are durably appended to a service-private JSONL journal and replayed on startup. Each immutable revision records first/last seen, occurrence count, complete bounded timeline, correlation graph, runtime-event IDs, detection IDs, identity snapshots, profile snapshots, profile references, and policy versions.

Lifecycle states are `open`, `investigating`, `contained`, `resolved`, `false_positive`, and `suppressed`. Each transition creates a new revision linked to its predecessor and requires a reason. Marking an incident false-positive never updates a security profile.

The engine may emit typed response recommendations, but `enforcement_requested` is always `false`. It cannot use Docker, nftables, systemd actions, signals, quarantine, or the Root Helper. Any future response must be authorized by `rumahl-security` and executed through the frozen Phase-1 helper boundary.

## Automated Response (Phase 2.5)

`rumahl-security` runs a background response loop (`automated_response` module) that implements slice 2.5 without changing the engine contract:

- Every `RESPONSE_INTERVAL` it lists open incidents over the engine's loopback API and evaluates incidents that carry recommendations against the enabled Security Center policies (`security_policies`).
- A policy applies when its `threat_type` matches the incident's finding codes (`malware`, `network_attack`, `critical_integrity`, `script_execution`) and the incident severity meets `minimum_severity`.
- Executable actions are limited to evidence the correlation record actually carries: `block_ip` (IP destinations only), `isolate_container` (container subjects), `quarantine` (executable path evidence), `stop_service` (system-service subjects with a valid unit name), and `lockdown`. `log`/`alert` are recorded in the keyed audit chain. `stop_process` is never automated because incident evidence keys processes by stable instance ids, not pids; actions without sufficient evidence are skipped and audited as `automated_response_skipped`.
- All enforcement goes through the single frozen helper boundary (`security_center::helper_call`); the module introduces no second privileged path. Successful containment transitions the incident to `contained` (otherwise `investigating`) via the engine's lifecycle API, so operators see the outcome in the timeline.
- Incidents are re-evaluated only when they escalate to a higher severity; the same `(incident, severity)` pair is never acted on twice.

Stores are bounded to 4,096 current incidents, 16,384 immutable revisions, and 2,048 timeline entries per incident. Health and metrics expose correlation, deduplication, eviction, timeline-drop, and lifecycle counters.
