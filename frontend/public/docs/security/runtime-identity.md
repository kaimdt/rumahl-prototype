# Runtime Identity and Attribution 2.2

The Runtime Identity Resolver is a standalone, unprivileged enrichment service for `ora.runtime.v2`. It never performs enforcement and never accesses the Docker socket, Root Helper, nftables, systemd actions, process signals, or quarantine storage.

Resolution produces an immutable snapshot keyed by runtime event ID and containing host boot ID, sensor instance ID, process instance ID, exec generation, resolver version, resolution time, identity type, confidence, state, and machine-readable evidence. Later metadata refreshes never rewrite an existing snapshot.

Identity types are `app`, `container`, `system_service`, `host_process`, and `unknown`. Resolution state is `resolved`, `unknown`, or `conflicting`; confidence is `high`, `medium`, `low`, or `unknown`. UID/GID is recorded as evidence but can never independently create high-confidence attribution.

Evidence is obtained read-only from runtime cgroups, container IDs, the rumahl Supervisor app metadata API, systemd unit names embedded in cgroups, executable paths and hashes, namespace context, and UID/GID. The resolver does not call Docker. Full rumahl container registry agreement yields high confidence, while an unmatched container is only a low-confidence `container`. Contradictory high/medium quality subjects produce `conflicting`, never a guess.

The container cache is bounded to 4,096 entries and refreshed every 30 seconds. Evidence older than 60 seconds is stale and cannot resolve an app. Cache replacement invalidates removed or recreated containers. Identity snapshots are bounded to 16,384 entries with FIFO eviction and metrics.

Health and metrics expose metadata refresh failures, stale evidence, resolved/unknown/conflicting totals, and snapshot evictions. Phase 2.2 intentionally does not add profiles, policy decisions, incident correlation, or automated responses.
