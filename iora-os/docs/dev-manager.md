# IORA Dev Manager

`iora-dev-manager` is the cross-platform Rust control plane for the local QEMU development environment: comparable to a small Proxmox VE instance dedicated to the IORA VM. It provides the same ratatui/crossterm interface on Windows, macOS, and Linux. QEMU launch, lifecycle control, QMP, QGA, health, services, connections, snapshots, recovery, and presentation are owned by one compiled program.

## Start

```shell
cd iora-os/backend
cargo run -p iora-dev-manager -- --root ..
```

On Windows, `iora-os/dev-manager.ps1` automatically launches the compiled Rust manager or builds it through Cargo. Its former PowerShell menu remains a compatibility fallback when Rust is unavailable; set `IORA_DEV_MANAGER_LEGACY=1` only when that fallback is explicitly needed.

The dashboard reconstructs a running VM from `.cache/runtime-state.json`, validates its QEMU process and QMP endpoint, queries QGA, refreshes a changed bridge IP, and only then derives SSH and web endpoints.

For automation, `cargo run -p iora-dev-manager -- --root .. --doctor` runs the same readiness model without opening the TUI.

## Architecture

```text
iora-dev-manager (one Rust TUI on Windows, macOS and Linux)
├── state.rs                       atomic state, validation, endpoints
├── channels.rs                    TCP/Unix QMP and QGA transport
├── manager.rs                     lifecycle, health, process and host integration
├── main.rs                        event loop and ratatui application
└── iora-dev-watch                 reusable build/deploy implementation
```

The runtime state is the shared source of truth, not a replacement for live checks. Every manager refresh validates the PID, QMP and QGA. In bridge mode QGA refreshes the DHCP address and SSH is always derived as `<current LAN IP>:22`. In Slirp mode the endpoint remains `127.0.0.1:<forwarded port>`.

## Readiness model

The environment progresses through `Stopped`, `Starting`, `Booting`, `Provisioning`, `Waiting for network`, `Waiting for dependencies`, `Starting services`, `Degraded`, and `Ready`.

`Ready` requires a live QEMU PID, QMP, QGA, operational systemd, guest networking, and successful internal and host-side `iora-home` health. SSH is reported independently and is not required for VM administration.

An internally healthy but externally unreachable home service is reported as `Degraded`, with bind-address, firewall, stale bridge address, and routing checks suggested separately.

## QGA-first recovery

The manager uses the guest agent for systemd state, service logs, listening sockets, PostgreSQL readiness, IP discovery, and critical service startup. On Windows it uses the QGA/QMP TCP channels; on macOS and Linux it automatically uses the existing Unix sockets. SSH remains an optional interactive connection.

The Rust TUI provides native QEMU launch, the live Doctor, failed-unit logs, QMP pause/resume/reset, QGA-first graceful shutdown, hard stop, SSH, QGA rescue commands, browser launch, and compressed Golden Snapshots. It never starts `dev-local.ps1` or `dev-local.sh` to perform VM lifecycle operations.

The log view reads journald through QGA and falls back to the host-side manager log when the guest channel is unavailable.

## Independent VM control plane

The Rust VM view exposes start, pause, resume, reset, graceful guest shutdown, hard process stop, SSH, browser launch, and the QGA rescue prompt. Hypervisor actions go directly through QMP rather than being inferred from SSH.

QEMU configuration is cross-platform and native. `IORA_DEV_QEMU`, `IORA_DEV_QEMU_IMG`, `IORA_DEV_ACCEL`, `IORA_DEV_RAM`, `IORA_DEV_CPUS`, and `IORA_DEV_TAP` override binary, acceleration, resources, and bridge adapter without adding more launcher scripts.

SSH is optional. Press `g` to execute a root rescue command through QGA without network access. Service listing, restart, health inspection, failed-unit diagnosis, and journald access use QGA directly and remain available when the guest network, firewall, or SSH daemon is broken.

## Script consolidation

Rust is the user-facing and cross-platform source of truth. The existing PowerShell and shell files are retained only for backward compatibility and initial legacy image creation; the manager does not invoke them. A prepared `.cache/iora-dev-vm.qcow2` can be started, controlled, diagnosed, and snapshotted entirely from the Rust process. New development-server functionality belongs in `iora-dev-manager` rather than in another platform-specific script.

## Staged services in the compatibility backend

The critical startup action executes and validates each unit before continuing:

1. PostgreSQL, Redis, Docker;
2. Secrets, Security, Core, Gateway;
3. Home, API, Files, Connector;
4. Intelligence and Developer App.

This avoids concurrent Cargo/systemd restart storms. `After=` dependencies remain useful for ordering, but the manager additionally checks `systemctl is-active` and final application health.

## Runtime state

`.cache/runtime-state.json` records the QEMU PID, network mode, current address and ports, firmware, accelerator, disk paths, start time, provisioning, watcher, sync, and readiness state. Writes are atomic through a temporary file. A dead PID clears connection-dependent state instead of reusing stale endpoints.

The cache is local runtime data and must not be committed.
