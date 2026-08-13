#!/usr/bin/env python3
"""Fail CI when Phase 2 introduces a second privileged enforcement path."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OS_ROOT = ROOT / "iora-os"
BACKEND = OS_ROOT / "backend"
BASELINE = json.loads((OS_ROOT / "security-baseline.json").read_text())


def fail(message: str) -> None:
    raise SystemExit(f"security baseline violation: {message}")


def validate_manifest() -> None:
    allowed = BASELINE["privileged_enforcement_components"]
    if allowed != ["iora-security-helper"]:
        fail("the privileged enforcement allow-list requires security review")
    helper = BACKEND / "services" / allowed[0]
    if not (helper / "Cargo.toml").is_file():
        fail("the approved privileged helper is missing")
    source = (helper / "src" / "main.rs").read_text()
    if BASELINE["privileged_socket"] not in source:
        fail("the helper socket moved outside the reviewed boundary")
    if 'account_id("/etc/passwd", "iora-security")' not in source:
        fail("the helper no longer authenticates the dedicated Security UID")


def validate_phase_2_components() -> None:
    services = BACKEND / "services"
    forbidden = BASELINE["forbidden_phase_2_source_markers"]
    for prefix in BASELINE["phase_2_component_prefixes"]:
        for component in services.glob(f"{prefix}*"):
            for path in component.rglob("*"):
                if not path.is_file() or path.suffix not in {".rs", ".toml", ".service", ".sh"}:
                    continue
                contents = path.read_text(errors="replace")
                for marker in forbidden:
                    if marker in contents:
                        fail(f"{path.relative_to(ROOT)} contains forbidden root marker {marker!r}")
    sensor = services / "iora-runtime-sensor"
    if sensor.exists():
        source = (sensor / "src" / "main.rs").read_text()
        schema = (sensor / "src" / "event.rs").read_text()
        ebpf = (sensor / "ebpf" / "runtime.bpf.c").read_text()
        for required in ("QUEUE_CAPACITY", "dropped_critical", "source_connected"):
            if required not in source:
                fail(f"runtime sensor lost required backpressure field {required}")
        if 'SCHEMA_VERSION: &str = "ora.runtime.v2"' not in schema:
            fail("runtime event schema version changed without review")
        for required in ("process_instance_id", "host_boot_id", "sensor_instance_id", "exec_generation", "socket_cookie"):
            if required not in schema:
                fail(f"runtime event schema lost correlation field {required}")
        for forbidden_helper in ("bpf_send_signal", "bpf_override_return", "BPF_MAP_TYPE_DEVMAP"):
            if forbidden_helper in ebpf:
                fail(f"read-only eBPF program contains enforcement primitive {forbidden_helper}")
    resolver = services / "iora-runtime-identity"
    if resolver.exists():
        source = (resolver / "src" / "main.rs").read_text()
        for required in ("Confidence", "ResolutionState", "EvidenceKind", "CONTAINER_TTL", "SNAPSHOT_CAPACITY"):
            if required not in source:
                fail(f"runtime identity resolver lost required contract {required}")
        for forbidden in ("/var/run/docker.sock", "Command::new", "/run/iora/security-helper.sock", "/var/lib/iora-security/quarantine"):
            if forbidden in source:
                fail(f"runtime identity resolver contains forbidden capability marker {forbidden}")
    policy = services / "iora-runtime-policy"
    if policy.exists():
        source = "\n".join(path.read_text() for path in (policy / "src").glob("*.rs"))
        for required in ("ora.security-profile.v1", "ora.runtime-detection.v1", "ProfileSource", "Disposition", "enforcement_requested"):
            if required not in source:
                fail(f"runtime policy engine lost required contract {required}")
        for forbidden in ("/var/run/docker.sock", "Command::new", "/run/iora/security-helper.sock", "/var/lib/iora-security/quarantine"):
            if forbidden in source:
                fail(f"runtime policy engine contains forbidden capability marker {forbidden}")
    incidents = services / "iora-incident-engine"
    if incidents.exists():
        source = "\n".join(path.read_text() for path in (incidents / "src").glob("*.rs"))
        for required in ("ora.security-incident.v1", "IncidentState", "CORRELATOR_VERSION", "enforcement_requested"):
            if required not in source:
                fail(f"incident engine lost required contract {required}")
        for forbidden in ("/var/run/docker.sock", "Command::new", "/run/iora/security-helper.sock", "/var/lib/iora-security/quarantine"):
            if forbidden in source:
                fail(f"incident engine contains forbidden capability marker {forbidden}")


def validate_runtime_contract() -> None:
    contract = BASELINE["runtime_sensor_contract"]
    for capability in (
        "may_execute_host_actions",
        "may_access_docker_socket",
        "may_modify_firewall",
        "may_write_quarantine",
    ):
        if contract.get(capability) is not False:
            fail(f"runtime sensor capability {capability} must remain false")
    exception = BASELINE["runtime_sensor_privileged_exception"]
    if exception["allowed_capabilities"] != ["CAP_BPF", "CAP_PERFMON"]:
        fail("the eBPF loader capability allow-list changed")
    if "CAP_SYS_ADMIN" not in exception["forbidden_capabilities"]:
        fail("the eBPF loader must explicitly forbid CAP_SYS_ADMIN")
    policy_contract = BASELINE["runtime_policy_contract"]
    for capability in (
        "may_execute_host_actions",
        "may_access_docker_socket",
        "may_modify_firewall",
        "may_write_quarantine",
    ):
        if policy_contract.get(capability) is not False:
            fail(f"runtime policy capability {capability} must remain false")
    incident_contract = BASELINE["incident_engine_contract"]
    for capability in (
        "may_execute_host_actions",
        "may_modify_profiles",
        "may_call_root_helper",
    ):
        if incident_contract.get(capability) is not False:
            fail(f"incident engine capability {capability} must remain false")


if __name__ == "__main__":
    validate_manifest()
    validate_runtime_contract()
    validate_phase_2_components()
    print("Security Foundation boundary is intact")
