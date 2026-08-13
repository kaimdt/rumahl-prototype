# Security Foundation Architecture Baseline

## Status

Phase 1, **Security Foundation**, is frozen at baseline version `1.0`. The machine-readable contract is stored in `iora-os/security-baseline.json` and enforced by CI. Changes to this baseline require an explicit security review; Phase 2 must not weaken it for implementation convenience.

## Phase 1 ownership

Phase 1 owns the durable enforcement mechanisms:

- host and container-aware nftables policy;
- malware, YARA, hash, heuristic, and integrity scanning;
- quarantine and controlled recovery;
- keyed audit chaining;
- lockdown and administrative recovery;
- Security permissions, health reporting, and CI gates;
- the only privileged enforcement process, `iora-security-helper`.

`iora-security-helper` remains the sole component permitted to perform Security-driven host mutations. It accepts only its reviewed typed protocol through `/run/iora/security-helper.sock`, authenticates the dedicated `iora-security` peer UID, and never accepts executable names, arbitrary argument arrays, or shell programs.

## Phase 2 boundary

Phase 2, **Runtime Protection**, is an observation, context, detection, and orchestration layer. Its data flow is:

```text
Runtime sensors
    -> event normalization
    -> app/container/service identity
    -> app security profiles
    -> detection and policy evaluation
    -> incident correlation
    -> iora-security typed action request
    -> iora-security-helper
    -> host or container
```

Runtime components may collect process ancestry, executable hashes, UID/GID, DNS and network activity, sensitive file activity, and app/container ownership. They may not directly stop processes or containers, modify nftables, write quarantine storage, access the Docker socket, invoke systemd, or introduce another privileged action socket.

An eBPF loader may eventually require narrowly scoped kernel capabilities. That is a sensor deployment concern, not permission to mutate the host. Its event consumer and policy/incident engines must remain unprivileged, and every response must reuse the Phase-1 typed action path.

## Planned Phase 2 slices

1. **2.1 Runtime Sensor:** collect and normalize telemetry without automatic blocking.
2. **2.2 App Identity and Profiles:** attach every event to an ORA app, container, or system service and compare it with declared behavior.
3. **2.3 Runtime Policy Engine:** combine profiles, telemetry, firewall state, and scanner results.
4. **2.4 Incident Engine:** correlate related events into a single incident timeline.
5. **2.5 Automated Response:** request existing typed Phase-1 actions according to policy.

## Review checklist

Every Phase-2 change must demonstrate that it does not:

- add a second root helper or direct root command path;
- grant runtime sensors Docker socket access;
- bypass `iora-security` authorization or policy evaluation;
- duplicate firewall, quarantine, process-control, or container-control code;
- treat raw telemetry events as independent incidents when correlation data exists;
- loosen the dedicated Security UID, socket peer checks, scan limits, audit validation, or recovery guarantees.
