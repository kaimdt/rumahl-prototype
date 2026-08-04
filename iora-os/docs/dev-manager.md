# IORA Dev Manager

`dev-manager.ps1` is the independent control plane for the local QEMU development environment: comparable to a small Proxmox VE instance dedicated to the IORA VM. The existing `dev-local.ps1` remains an internal image/provisioning backend, while lifecycle control, QMP, QGA, health, services, settings, connections, and recovery are owned by the manager.

## Start

```powershell
cd iora-os
pwsh .\dev-manager.ps1
```

The dashboard reconstructs a running VM from `.cache/runtime-state.json`, validates its QEMU process and QMP endpoint, queries QGA, refreshes a changed bridge IP, and only then derives SSH and web endpoints.

For automation, `pwsh .\dev-manager.ps1 -Doctor` runs the same readiness model without opening the menu. `-Once` renders one dashboard snapshot.

## Architecture

```text
dev-manager.ps1 (one user-facing TUI)
├── dev-manager/RuntimeState.psm1  atomic state, validation, endpoints
├── dev-manager/VmChannels.psm1    QMP and QGA transport / guest-exec
├── dev-manager/Readiness.psm1     internal + external health and diagnosis
├── dev-manager/VmLifecycle.psm1    QEMU lifecycle and persistent VM settings
├── dev-local.ps1                  VM provisioning and lifecycle backend
├── dev-sync.sh                    incremental source transport
└── iora-dev-watch                 builds, deploys, restarts, service TUI
```

The runtime state is the shared source of truth, not a replacement for live checks. Every manager refresh validates the PID, QMP and QGA. In bridge mode QGA refreshes the DHCP address and SSH is always derived as `<current LAN IP>:22`. In Slirp mode the endpoint remains `127.0.0.1:<forwarded port>`.

## Readiness model

The environment progresses through `Stopped`, `Starting`, `Booting`, `Provisioning`, `Waiting for network`, `Waiting for dependencies`, `Starting services`, `Degraded`, and `Ready`.

`Ready` requires a live QEMU PID, QMP, QGA, completed guest boot, operational systemd, guest networking and dependencies, healthy IORA units, internal and host-side `iora-home` health, synchronized sources, and an active watcher.

An internally healthy but externally unreachable home service is reported as `Degraded`, with bind-address, firewall, stale bridge address, and routing checks suggested separately.

## QGA-first recovery

The manager uses the guest agent for systemd state, service logs, listening sockets, PostgreSQL readiness, IP discovery, and critical service startup. SSH remains the fastest source-transfer channel, but the watcher falls back to QGA for commands and service control if SSH fails.

Useful manager actions include the Doctor, failed-unit logs, critical phased startup, QMP pause/resume, graceful QMP powerdown, hard stop, snapshot creation, SSH, browser launch, watcher, and source sync.

The VM Control view also exposes the latest QEMU stderr and serial logs. This remains available when guest networking and SSH are unavailable.

## Independent VM control plane

The VM Control view exposes start, pause, resume, reset, graceful guest shutdown, hard process stop, full rebuild, and Golden Snapshot operations. It reads live CPU, memory, and run state from QMP rather than inferring VM state from SSH.

VM resources and defaults are persisted in `.cache/dev-manager-settings.json`. Network mode, RAM, vCPU count, source/build mode, watcher, and sync behavior therefore belong to the manager and are translated into provisioning arguments only when a new VM is created.

SSH is optional. The connection action opens SSH when reachable and otherwise switches to an interactive QGA rescue shell. Service listing, start, stop, restart, health, dependency inspection, and journald access use QGA directly and remain available when the guest network, firewall, or SSH daemon is broken.

## Staged services

The critical startup action executes and validates each unit before continuing:

1. PostgreSQL, Redis, Docker;
2. Secrets, Security, Core, Gateway;
3. Home, API, Files, Connector;
4. Intelligence and Developer App.

This avoids concurrent Cargo/systemd restart storms. `After=` dependencies remain useful for ordering, but the manager additionally checks `systemctl is-active` and final application health.

## Runtime state

`.cache/runtime-state.json` records the QEMU PID, network mode, current address and ports, firmware, accelerator, disk paths, start time, provisioning, watcher, sync, and readiness state. Writes are atomic through a temporary file. A dead PID clears connection-dependent state instead of reusing stale endpoints.

The cache is local runtime data and must not be committed.
