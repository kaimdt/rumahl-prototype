# Runtime Detection Engine 2.4

The read-only Runtime Detection Engine compares normalized behavior and an immutable Runtime Identity 2.2 snapshot against an immutable App Security Profile 2.3 snapshot. Results use the versioned `ora.runtime-detection.v1` schema.

Detections evaluate process names, executable paths and hashes, shells and interpreters, execution from `/tmp`, child depth, network direction/protocol/port/destination, and filesystem operations. Each finding records a machine-readable code, profile disposition, severity, and detail.

Risk is confidence-aware. A forbidden behavior with high-confidence resolved identity produces maximum risk, while identical behavior attributed with low confidence is reduced. Unknown or conflicting identity is never treated like high-confidence attribution.

Every result references the runtime event, identity snapshot, effective profile snapshot, and all contributing profile versions. `enforcement_requested` is always `false`: Phase 2.4 detects and explains behavior but cannot access Docker, nftables, systemd actions, process signals, quarantine, or the Root Helper.
