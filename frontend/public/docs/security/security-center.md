# ORA OS Security Center

## Architecture

The Security Center separates policy, presentation, and privileged enforcement:

1. The integrated system app displays status and submits authenticated actions.
2. `iora-home` authenticates administrators and forwards explicit Security permissions.
3. `iora-security` owns policies, scanner selection, events, scan jobs, and a keyed hash-chained audit log.
4. `iora-security-helper` is the only root component. It listens on a root-owned Unix socket and accepts a closed, validated command enum. It never evaluates shell text.
5. nftables, integrity timers, and the helper continue running without the frontend.

Direct network access to privileged operations is intentionally impossible. The helper's Unix socket is available only to the Security service group on installed systems.

The helper additionally validates Linux peer credentials for every accepted connection. Merely obtaining access to the socket path or joining an unrelated local group is insufficient; the peer UID must be the dedicated `iora-security` service UID.

`iora-security` has its own non-login UID and group; no other ORA service uses that identity. The shared `iora` group is supplementary and grants only access to existing database credentials, not access to the helper socket.

## Firewall and containers

The `inet iora_security` table installs an input and forward hook before Docker's normal forwarding path. Consequently, published ports and container forwarding remain subject to the ORA policy. Baseline rules provide state tracking, deny invalid traffic, restrict exposed TCP ports, and rate-limit new TCP and ICMP traffic. Container-to-container and outbound traffic are explicitly represented in the forward policy.

Policy activation is transactional: the helper writes a candidate, validates it with `nft -c`, activates it, and restores the previous policy if activation fails. Policies containing a global `flush ruleset` are rejected so they cannot erase unrelated safety rules.

## Scanner providers

The scanner layer supports:

- `internal`: SHA-256, size validation, integrity data, and bounded script heuristics;
- `yara`: recursively evaluates the curated rules under `/etc/iora/security/yara`;
- `clamav`: uses bounded per-job `clamscan` execution;
- future providers through the same provider identifier and result model.

Automatic mode always enables the internal provider and YARA when installed. ClamAV is selected only when sufficient memory is currently available and memory pressure is low. An administrator can set a provider to `always` or `disabled` and control priority. Scanner processes receive fixed arguments and approved canonical paths; scanner input cannot inject a shell command.

Automatic ClamAV selection uses `MemAvailable` and Linux PSI memory pressure rather than total installed RAM. Scan inputs are opened with `O_NOFOLLOW`, checked by device and inode, and copied to a root-owned snapshot before an external scanner sees them. Symlink components are rejected.

At most two scans run concurrently, every scan has a 120-second deadline, and source snapshots are limited to 256 MiB. ClamAV additionally limits recursive archive depth to 16, expanded scan data to 256 MiB, individual extracted files to 64 MiB, and archive members to 10,000. Capacity exhaustion rejects new scans instead of building an unbounded queue.

## Response policies

Policies map threat types and minimum severity to one or more actions: log, alert, temporary block, stop process, quarantine, isolate network, block IP, stop service, or lockdown. The defaults use detect, alert, bounded containment, and administrator confirmation. Confirmed modification of critical OS binaries can select the critical lockdown policy.

The helper refuses to stop PID 1 or either Security service. Quarantine moves files into a root-owned store, removes access permissions, and writes separate provenance metadata. Scan and quarantine paths are restricted to ORA-managed roots.

Restore never writes directly back to the original location and never restores original ownership or executable mode. It places the item in a dedicated recovery area with mode `0600` for explicit administrator inspection. The Security health response probes the effective nftables table, scanner availability, integrity-monitor freshness, and the keyed audit chain.

Health is aggregated as `healthy`, `degraded`, or `compromised`. A missing optional scanner degrades service; an ineffective firewall, unavailable helper, or invalid audit chain marks it compromised. Existing nftables policies remain active if either API service stops, while scanner failure does not block unrelated workloads.

Health responses include stable reason codes such as `scanner_unavailable`, `integrity_stale`, `definitions_outdated`, `firewall_ineffective`, and `audit_chain_invalid`. ClamAV definition files older than 48 hours degrade health. Scanner output is continuously drained but only the first 8 KiB of stdout and stderr are retained. Files rejected by size, capacity, timeout, or provider failure produce a `not_scanned` job status with a machine-readable reason code and are never reported as clean.

The keyed event chain makes offline database edits detectable as long as the Security key remains protected. It is not a substitute for TPM-backed signing or a remote append-only witness; those remain later hardening phases.

## Permissions

Security access is divided into read, policy management, scan execution, quarantine management, firewall management, and lockdown management. These permissions are intended for the integrated system app and administrators; plugins must never receive them. `security_admin` is the aggregate administrative role used by the authenticated internal proxy.

## Phase boundaries

Phase 1 provides host and container firewalling, modular malware scans, hash/integrity checks, script heuristics, response policies, quarantine, audit events, and hardened independent services. eBPF runtime enforcement, full IDS/IPS, TPM attestation, Secure Boot, verified root filesystems, and offline recovery remain additive later phases.

### Automated Response (Phase 2.5)

The Security Center overview exposes an `automated_response` status block (interval, passes, evaluated/executed/skipped/transitioned counters). The background loop observes open incident recommendations from `iora-incident-engine`, matches them against enabled policies, and executes the policy actions through the frozen `iora-security-helper` boundary only. No phase-2 component gains a second privileged path; enforcement stays authorized by `iora-security` and is recorded in the keyed audit chain (`automated_response` / `automated_response_skipped` events).
