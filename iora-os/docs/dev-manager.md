# IORA Dev Manager

`iora-dev-manager` is the cross-platform Rust control plane for the local QEMU development environment: comparable to a small Proxmox VE instance dedicated to the IORA VM. It provides the same ratatui/crossterm interface on Windows, macOS, and Linux. Existing platform scripts remain transitional image/provisioning backends; lifecycle control, QMP, QGA, health, services, connections, recovery, and presentation are owned by one compiled program.

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
├── dev-local.ps1 / dev-local.sh   transitional provisioning backends
├── dev-sync.sh                    incremental source transport
└── iora-dev-watch                 builds, deploys, restarts, service TUI
```

The runtime state is the shared source of truth, not a replacement for live checks. Every manager refresh validates the PID, QMP and QGA. In bridge mode QGA refreshes the DHCP address and SSH is always derived as `<current LAN IP>:22`. In Slirp mode the endpoint remains `127.0.0.1:<forwarded port>`.

## Readiness model

The environment progresses through `Stopped`, `Starting`, `Booting`, `Provisioning`, `Waiting for network`, `Waiting for dependencies`, `Starting services`, `Degraded`, and `Ready`.

`Ready` requires a live QEMU PID, QMP, QGA, operational systemd, guest networking, and successful internal and host-side `iora-home` health. SSH is reported independently and is not required for VM administration.

An internally healthy but externally unreachable home service is reported as `Degraded`, with bind-address, firewall, stale bridge address, and routing checks suggested separately.

## QGA-first recovery

The manager uses the guest agent for systemd state, service logs, listening sockets, PostgreSQL readiness, IP discovery, and critical service startup. On Windows it uses the QGA/QMP TCP channels; on macOS and Linux it automatically uses the existing Unix sockets. SSH remains an optional interactive connection.

The Rust TUI currently provides the live Doctor, failed-unit logs, QMP pause/resume/reset, QGA-first graceful shutdown, hard stop, SSH, QGA rescue commands, and browser launch. Golden snapshots, resource settings, phased startup, watcher, and source-sync operations remain available through the compatibility interface until their provisioning implementations have moved into Rust.

The log view reads journald through QGA and falls back to the host-side manager log when the guest channel is unavailable.

## Independent VM control plane

The Rust VM view exposes start, pause, resume, reset, graceful guest shutdown, hard process stop, SSH, browser launch, and the QGA rescue prompt. Hypervisor actions go directly through QMP rather than being inferred from SSH.

The compatibility layer persists VM resources and defaults in `.cache/dev-manager-settings.json`. These settings remain readable during migration; their Rust-native settings view is the next consolidation step.

SSH is optional. Press `g` to execute a root rescue command through QGA without network access. Service listing, restart, health inspection, failed-unit diagnosis, and journald access use QGA directly and remain available when the guest network, firewall, or SSH daemon is broken.

## Migration from scripts

Rust is now the user-facing and cross-platform source of truth. The existing PowerShell and shell implementations are deliberately retained as provisioning adapters so image creation, cloud-init, bridge setup, and old automation continue to work during migration. New lifecycle, health, connection, diagnosis, and TUI functionality belongs in `iora-dev-manager`; the adapters can be reduced as their remaining provisioning responsibilities are moved into Rust.

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
