# Incident Correlation 2.5

`iora-incident-engine` is a standalone, non-privileged correlator for `ora.runtime-detection.v1`. It produces revisioned `ora.security-incident.v1` records rather than turning every detection into a separate alert.

Correlation combines temporal proximity with causal evidence: process and parent-process instances, exec generations, identity snapshots, container instances, executable hashes, socket cookies, destinations, and detection types. Strong causal keys remain eligible for seven days; weaker contextual matches require multiple shared signals inside a 15-minute window. Repeated detection IDs are idempotent and repeated timeline evidence increments occurrence counts.

Incidents preserve severity independently from attribution confidence. Revisions are durably appended to a service-private JSONL journal and replayed on startup. Each immutable revision records first/last seen, occurrence count, complete bounded timeline, correlation graph, runtime-event IDs, detection IDs, identity snapshots, profile snapshots, profile references, and policy versions.

Lifecycle states are `open`, `investigating`, `contained`, `resolved`, `false_positive`, and `suppressed`. Each transition creates a new revision linked to its predecessor and requires a reason. Marking an incident false-positive never updates a security profile.

The engine may emit typed response recommendations, but `enforcement_requested` is always `false`. It cannot use Docker, nftables, systemd actions, signals, quarantine, or the Root Helper. Any future response must be authorized by `iora-security` and executed through the frozen Phase-1 helper boundary.

Stores are bounded to 4,096 current incidents, 16,384 immutable revisions, and 2,048 timeline entries per incident. Health and metrics expose correlation, deduplication, eviction, timeline-drop, and lifecycle counters.
